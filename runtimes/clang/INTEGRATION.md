# C runtime (clang-wasm) — integration notes

Peer of `runtimes/java`, `runtimes/python`, `runtimes/csharp`. Implements the app's
`Runtime` contract (`app/src/runtime/types.ts`) and is registered under the id `c` in
`app/src/runtime/index.ts`. It runs student **C** entirely on the device — no server.

See `M0-FINDINGS.md` for the spike that chose the toolchain and settled the stdin
architecture, and `PLAN.md` for the original design.

## What it is

- **Compiler:** the [`clang/clang`](https://wasmer.io/wasmer/clang) Wasmer package
  (clang 16 + wasm-ld + a WASI sysroot), driven through
  [`@wasmer/sdk`](https://github.com/wasmerio/wasmer-js).
- **Executor:** we run the compiled module **ourselves** under
  [`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim), *not*
  through the SDK's runner (see "Why self-host" below).

One `ClangRuntime` instance owns one **module worker** (`src/clang.worker.js`). The
worker downloads the toolchain once, warms the WASI sysroot, and is reused across runs.

## Two-phase run

1. **Compile.** All project `.c` files (plus a tiny synthetic `__warsha_rt.c`, below)
   are written into a Wasmer `Directory`, mounted at `/project`, and compiled with
   `clang -O1 -Wl,--export-memory ... -lm -o /project/out.wasm`. clang diagnostics
   stream to **stderr**; a non-zero exit ends the run with **exit code 1** and nothing
   executes — the same contract as ECJ (Java) and Roslyn (C#). Headers (`.h`) ride along
   in the mount so `#include "…"` resolves; they are never entry points.
2. **Run.** The worker instantiates `out.wasm` and runs it to completion **on the worker
   thread**. A normal `return N` / `exit(N)` surfaces as **exit code N**.

`entryCandidates` offers the `.c` that declares `main`; all `.c` compile and link
together into one program (one `main` per project, like the other engines).

## Why self-host execution (the WASIX story)

The `clang/clang` package emits **WASIX**, not plain `wasm32-wasi`: the output imports
`wasi_snapshot_preview1.*` **plus** `wasix_32v1.{futex_wait,futex_wake,futex_wake_all,
callback_signal}` and a **shared** `env.memory`. Two consequences:

- The SDK's own runner is the only thing that natively runs WASIX — **but its live
  stdin never delivers to a blocked `scanf`** (only batch `run({stdin})` works, which
  rules out interactive prompt/response). Confirmed in the M0 spike.
- So we run the module ourselves under a WASI shim, which lets us own the stdin fd. To
  make WASIX output run under the (preview1) shim we: parse the imported memory's limits
  from the binary and supply our own `new WebAssembly.Memory({…, shared:true})` as
  `env.memory`; **stub** the `wasix_32v1.*` funcs as `() => 0` (a single-threaded student
  program never contends a futex); and wire our own `Fd`s for stdin/stdout/stderr. The
  preview1 syscalls the shim implements are ABI-compatible with what the output imports.

## stdin — interactive, over a SharedArrayBuffer

Same protocol as the Python/C# workers (`STATE_EMPTY/LINE/EOF`, `Atomics.wait/notify`),
so it needs **cross-origin isolation** (`crossOriginIsolated === true`; coi-serviceworker
provides it). The difference: C reads a **byte stream** (scanf/getchar/fread), not lines,
so the delivered bytes keep their trailing `\n`, and the stdin `Fd.fd_read` returns bytes
from the current line until drained, then parks for the next.

**stdout is unbuffered.** wasi-libc is musl-based and does not flush a line-buffered
stdout when stdin is read (a glibc-ism), so a `printf("Enter: ")` prompt with no `\n`/
`fflush` would never show before the program blocks. A synthetic `__warsha_rt.c`
constructor calls `setvbuf(stdout/stderr, _IONBF)` so every write reaches the host
immediately; the host then **coalesces** those writes (flush on threshold, before a stdin
read, and at exit) so bulk output stays fast. Student source is untouched.

## Lifecycle

`kill()` = `worker.terminate()` (kills the thread even mid-`Atomics.wait` or mid-CPU-loop
— a `while(1){}` runs on the worker thread) + a **silent respawn**, so the next `run()`
only pays the re-warm. `dispose()` terminates without respawning (page going away).

## Staging & assets

`npm run assets` copies `src/clang.worker.js` verbatim to
`app/public/warsha-clang.worker.js` (peer of `warsha-jvm.worker.js`); the runtime loads it
by URL. The worker currently imports `@wasmer/sdk` and `browser_wasi_shim` from **unpkg**
(CDN), which works under the app's COEP-credentialless isolation. Versions are pinned in
the worker's import URLs.

## Known follow-ups

- **Self-host the toolchain (M3).** Fetch `@wasmer/sdk`, the WASI shim, and the
  `clang/clang` `.webc` at build time and serve them same-origin (like `ecj.jar` /
  `warsha-dotnet/`). Removes the CDN dependency and is what makes C work **offline**
  (the service worker only caches same-origin + the two runtime CDNs, so the current
  unpkg loads are not cached). Self-hosting does *not* change compile time.
- **QA.** A `verify-c.mjs` (peer of `verify-csharp.mjs`) driving the built app: Run →
  output, interactive `scanf`, compile error → stderr + exit 1, Stop → respawn.
- **C++ is deferred**, gated on a precompiled-header path — see `M0-FINDINGS.md`.
