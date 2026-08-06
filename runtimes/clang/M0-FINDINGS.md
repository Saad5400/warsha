# C/C++ engine — M0 spike findings

Measured in a real browser (the in-app Chromium), served by `harness/serve.mjs`
under **COOP: same-origin + COEP: credentialless** (so `crossOriginIsolated ===
true`, as the app's coi-serviceworker gives). Toolchain: **`@wasmer/sdk`** (loaded
from unpkg for the spike) running the **`clang/clang`** Wasmer package. Two harness
pages: `index.html`/`main.js` (staged latency profiler) and `cpp.html`/`cpp.js`
(the decisive no-timeout C++ test).

## What the toolchain is

`@wasmer/sdk` + `Wasmer.fromRegistry('clang/clang')`. The package ships these
commands (from `clang.commands`):

```
clang, clang-16, lld, llvm-ar, llvm-nm, wasm-ld
```

So it is **clang 16**, and there is **no `clang++` command** — C++ is compiled by
invoking `clang -std=c++NN` on a `.cpp` (clang selects the C++ driver from the
extension). Compile model, confirmed working:

```js
const clang = await Wasmer.fromRegistry('clang/clang')
const dir = new Directory()
await dir.writeFile('a.c', source)
const inst = await clang.entrypoint.run({ args: ['/project/a.c','-o','/project/a.wasm'], mount: { '/project': dir } })
const { code, stdout, stderr } = await inst.wait()          // clang diagnostics here
const wasm = await dir.readFile('a.wasm')                    // the WASI executable
const prog = await Wasmer.fromFile(wasm)
const out  = await (await prog.entrypoint.run()).wait()      // run it, out.stdout
```

## Confirmed working

| Fact | Measurement |
|---|---|
| `crossOriginIsolated` under COOP/COEP | **true** |
| `@wasmer/sdk` init (warm HTTP cache) | ~45 ms (1.0 s cold) |
| `clang/clang` package download | ~8.3 s cold, ~5.2 s warm (browser HTTP cache) |
| **C** compile + run (`printf`) | cold **21.8 s**, output `hello from C`, exit 0, 47 KB wasm |
| First C compile with `#include <stdio.h>` (fresh worker) | **~24 s** |
| C++ compile, **no headers** (`int main(){}`) | **691 ms** |

The big one-time cost is **NOT compilation** — a header-free C++ compile is 691 ms.
It is the **first demand-load of the WASI sysroot** (system headers + libc)
out of the package's virtual filesystem: the first compile that does
`#include <stdio.h>` pays ~24 s, and thereafter C compiles are sub-second. This is
a **one-time-per-worker warm cost**, exactly the shape Warsha's loader already
handles (Java/C# pay a similar cold boot behind the progress UI).

## The C++ problem (the #1 risk, confirmed real)

The **first libc++ header compile is impractically slow cold**:

| Attempt | Result |
|---|---|
| `<vector>` + `<string>`, `-std=c++17` | **> 90 s** (hit the profiler's timeout) |
| `<iostream>`, `-std=c++20` (first naive run) | **> 6 min**, never observed to finish |

libc++'s headers are far larger than C's, so the first-time demand-load +
decompress + parse dwarfs the C sysroot cost. A JS-side `Promise.race` timeout
does **not** abort it — the SDK's wasm worker keeps churning underneath, which
also wedges any queued next compile. So the compile must be allowed to run to
completion or the worker killed (`terminate()`), not "timed out" in JS.

### Decisive C++ test (no timeout, `harness/cpp.js`) — VERDICT: cold compile is CPU-bound and impractical

Ran a clean `<iostream>` compile with **no JS timeout**, after warming the C
sysroot, and watched it to **6+ minutes without completing**. During that whole
window **network was idle** — only the initial SDK blob loads, zero CDN/header
fetches. So the cost is **purely CPU** inside wasm-hosted clang 16 instantiating
libc++'s templates, *not* lazy header downloading. Two consequences:

- **Self-hosting the package will NOT fix C++ compile time** (it is not I/O
  bound). It only fixes offline/same-origin, which matters independently.
- The only real lever is a **precompiled header (PCH)**: parse libc++'s common
  headers **once at package-staging time on a build machine**, ship the `.pch`,
  and compile student code with `-include-pch` so the per-compile cost skips
  libc++ re-parsing. This is unproven with this package and is its own R&D
  milestone. A *runtime* prewarm does not help if each fresh compile re-parses
  libc++ from scratch (which the 6-min-with-no-caching behaviour suggests).

**Bottom line:** C++ (`<iostream>` and the STL students actually use) is **not
shippable on this toolchain without a working PCH path**. C is unaffected.

## stdin (interactive) — RESOLVED: self-host execution, don't use the SDK runner

Three findings pinned the architecture (harness: `stdin.js`, `wasi.js`, `target.js`,
`wasix.js`):

1. **The SDK's live stdin is broken for blocking reads.** `stdin.js` tested a scanf
   program three ways: batch `run({ stdin: 'Warsha\nMecca\n' })` **works** (exit 0,
   correct output); live `instance.stdin.getWriter().write(...)` (awaited, and
   write-both-then-close) both **TIMED OUT** — bytes are echoed to stdout but never
   delivered to the blocked `scanf`. So through the SDK runner, only *batch* stdin is
   possible — no live prompt/response.

2. **The package emits WASIX, not plain WASI** (`target.js`). Every working target
   (`default`, `--target=wasm32-wasi`, `wasm32-unknown-wasi`, `-mexec-model=command`)
   produces imports `wasi_snapshot_preview1.*` **+ `wasix_32v1.{callback_signal,
   futex_wait,futex_wake,futex_wake_all}` + imported `env.memory` (shared)**.
   `wasm32-wasip1` fails (`cannot open crt1.o` — no such sysroot). So the binaries are
   bound to Wasmer's WASIX runtime; a stock WASI shim can't run them unmodified.

3. **We CAN self-host execution** (`wasix.js`) — the winning path. Use the SDK **only
   to compile**; run the `.wasm` ourselves under **`@bjorn3/browser_wasi_shim@0.4.2`**
   (API: `fd_read(size)→{ret,data}`, `fd_write(data)→{ret,nwritten}`), by:
   - parsing the imported memory's limits from the binary and supplying our own
     `new WebAssembly.Memory({ initial, maximum, shared:true })` as `env.memory`
     (measured: min 2 pages, max 65536, shared);
   - stubbing `wasix_32v1.*` as `() => 0` (single-threaded student code never contends
     a futex, so the stubs are never meaningfully exercised);
   - wiring our own `Fd` subclasses for stdout/stderr (`fd_write`) and **stdin
     (`fd_read`)**.

   Result: `printf` → exit 0 `"hello wasix 4\n"`; `scanf` with a buffered stdin `Fd` →
   exit 0 `"Your name: Hi, Warsha!\nYour city: Warsha in Mecca\n"`. **Our custom stdin
   `Fd` feeds `scanf` correctly.**

**M1 stdin mechanism:** run the shim on the engine's module worker; the stdin `Fd`'s
`fd_read` blocks on a `SharedArrayBuffer` via `Atomics.wait` until the main thread
posts a line and `Atomics.notify`s — the identical protocol Python and C# already use
in this repo (`STATE_EMPTY/LINE/EOF`). This gives true interactive prompt/response,
consistent with the other engines. (The guest's shared `env.memory` and our stdin SAB
are two separate shared buffers; the worker blocking in `fd_read` is fine — it's a
worker, not the main thread.)

## Implications for the engine (M1)

1. **C is viable now.** One-time ~24 s sysroot warm, then sub-second compiles;
   runs correctly. This alone could ship as a "C" tile with C++ still "soon".
2. **C++ needs the cold libc++ cost solved before it can ship**, via one or more:
   - **Pre-warm at load:** during the engine-download progress UI, run a throwaway
     `#include <iostream>` compile once so the libc++ sysroot is resident; student
     compiles then pay only the warm cost. Viability hinges on the warm number
     (the decisive test measures it).
   - **Precompiled header (PCH):** ship/build a PCH of the common includes and
     compile student code with `-include-pch`, skipping re-parse.
   - **`terminate()` not JS-timeout** for Stop, since the worker ignores a raced
     promise rejection.
3. **Self-hosting / offline:** `Wasmer.fromFile()` loads a package from a `.webc`,
   so the clang package can be fetched at build time and served same-origin under
   `app/public/warsha-clang/` (gitignored, like `ecj.jar` / the dotnet bundle),
   keeping the same-origin + offline story. (Not exercised in M0; M3 item.)
4. **Two-phase run** (compile → run) with clang diagnostics streamed to stderr and
   a non-zero exit on compile failure — same contract as ECJ / Roslyn.

## Recommendation

**Split the deliverable: ship C, defer C++.**

- **C → M1/M2 now.** Build `ClangRuntime` (one module worker, SAB stdin, two-phase
  compile→run, kill/dispose/respawn), wire `c` → `ready` in the shell (the engine
  is one `ClangRuntime`; expose only `.c` for now). C hits Java's bar: ~24 s
  one-time warm behind the loader, sub-second warm compiles, correct run + stdin.
- **C++ → its own R&D milestone (M0.5), keep the `cpp` tile "soon".** Gate it on a
  proven PCH path that brings a `<iostream>` student compile under a few seconds.
  If no PCH path pans out with this package, C++ waits for a faster in-browser
  toolchain (a newer/threaded clang wasm build) — do not hold C hostage to it.

This mirrors the original scoping instinct (C/C++ as a distinct, riskier track)
and matches how C# was de-risked: prove the toolchain in M0 before wide wiring.

## Licensing (for THIRD-PARTY.md at M3)

- **LLVM/clang** — Apache-2.0 WITH LLVM-exception (redistributable).
- **`@wasmer/sdk`** — MIT.
- The `clang/clang` Wasmer package bundles LLVM + a WASI sysroot (wasi-libc, and
  libc++ if present) — confirm each component's licence when self-hosting the webc.
