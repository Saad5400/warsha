# Add C / C++ support (clang-wasm engine)

Status: **M0 (spike)**. This is the design record; findings land in `M0-FINDINGS.md`.

## Context

`app/src/languages.ts` lists **C** and **C++** as dimmed "soon" tiles. A language
is `ready` only once a real in-browser engine implementing the `Runtime`
contract (`app/src/runtime/types.ts`) is registered in `app/src/runtime/index.ts`
— Warsha is server-free, static, offline-capable, so there is no backend to
compile on. Python = Pyodide, Java = CheerpJ+ECJ, C# = .NET-wasm + Roslyn.

Per the original scoping, C and C++ are **one engine** (both are clang front
ends), a peer under `runtimes/clang/`, matching Java's bar on size/offline (a
large one-time download with a progress UI; offline best-effort).

Unlike C# (which shipped a ready wasm runtime + Roslyn) and like Java (which
fetches ECJ), the C/C++ toolchain is **fetched as a prebuilt wasm artifact** —
this machine has only native clang 18, no wasm/wasi toolchain. The whole risk
surface is the toolchain, so M0 proves it before any wiring.

## Chosen toolchain: the Wasmer JS SDK (`@wasmer/sdk`) + the `clang/clang` package

Two-step, entirely in-browser, no server:

1. **Compile** — run the `clang/clang` Wasmer package (full clang + `wasm-ld`)
   over the student's source mounted in a virtual `Directory`, producing a WASI
   `.wasm` executable.
2. **Run** — load that `.wasm` with `Wasmer.fromFile()` and execute it under
   WASI, wiring its `stdin`/`stdout`/`stderr` streams to Warsha's console.

Confirmed from Wasmer's docs/blog:
- `Wasmer.fromRegistry("clang/clang")` → `entrypoint.run({ args, mount })`
  compiles; `project.readFile("out.wasm")` → `Wasmer.fromFile()` → `run()` runs.
- `clang/clang` is **~100 MB uncompressed, ~30 MB compressed** — within C#'s
  ~37 MB bar.
- Interactive I/O: `instance.stdin.getWriter()` + `instance.stdout/stderr`
  `ReadableStream`s (Wasmer's own xterm.js tutorial drives an interactive C
  program this way) — so `scanf` / `std::cin` can block and resume like Java's
  `Scanner` and C#'s `Console.ReadLine`.
- **Offline / same-origin:** `Wasmer.fromFile()` loads a package from a `.webc`
  file, so the clang package can be fetched at BUILD time and served same-origin
  under `app/public/warsha-clang/` (gitignored, like `ecj.jar` / the dotnet
  bundle) instead of hitting Wasmer's registry at runtime. This keeps the
  same-origin + offline story the other engines have.

Rejected alternatives:
- **twr-wasm** — a build-time toolchain (you compile ahead of time); it cannot
  compile arbitrary student code in the browser. Wrong model.
- **binji/wasm-clang** — proven but clang 8, hand-rolled memfs/lld glue we'd own
  forever; weaker C++ stdlib story. Wasmer is maintained and handles FS + process
  spawning + streams for us.
- **CheerpX / WebVM / container2wasm** — a full x86 VM to run gcc; hundreds of MB,
  far past the bar.

## Architecture: `runtimes/clang/` (new engine, peer of csharp/java/python)

```
runtimes/clang/
  src/index.ts            the only import the shell needs
  src/clangRuntime.ts     ClangRuntime (implements Runtime); mirrors CSharpRuntime
  src/types.ts            mirror of app/src/runtime/types.ts (no import into app/)
  src/clang.worker.js     module worker: @wasmer/sdk, compile (clang) then run
                          (WASI), stream stdout, block stdin on the SAB
  harness/                the standalone spike/driver page (this is M0)
    serve.mjs             COOP/COEP static server (crossOriginIsolated)
    index.html + main.js  compile+run C and C++, report timings/sizes/stdin
  fetch-toolchain.sh      stage the clang .webc under app/public/warsha-clang/
  PLAN.md / M0-FINDINGS.md / INTEGRATION.md
```

`ClangRuntime` copies `CSharpRuntime`'s shape: one module worker per app,
idempotent `load(onProgress)`, `run(files, entry, io)`, `kill()` (terminate +
silent respawn), `dispose()`, the `FromWorker` union, and the **SAB stdin
protocol** (`STATE_EMPTY/LINE/EOF`, `Atomics.wait`). Two engine-specific twists:

- **Two phases per run** (compile → run) instead of one. Compile errors stream
  clang's diagnostics to `onStderr` and end with `onExit(1)`, nothing runs — same
  contract as ECJ / Roslyn errors. The worker owns both phases.
- **Which stdin blocks:** the *run* phase blocks on stdin (the compile phase does
  not read stdin), so the SAB protocol wraps the WASI stdin fd during run only.
  Whether `@wasmer/sdk` streams satisfy the blocking-read contract cleanly, or we
  must drive stdin via the SAB + a custom fd, is an M0 question.

`c` and `cpp` both map to this one engine; the file extension picks the clang
driver (`clang` vs `clang++`) and default std flags.

## Shell wiring (M2 — after M0/M1 prove the engine)

| File | Change |
| --- | --- |
| `languages.ts` | Flip `c` and `cpp` to `status: 'ready'`, add versions (e.g. `clang 18 · C17`, `clang 18 · C++20`). |
| `runtime/index.ts` | Add `'c'`/`'cpp'` to `LangId`; register both → one `ClangRuntime`; `langForPath`: `.c`→`c`, `.cc/.cpp/.cxx/.hpp/.h`→`cpp` (a `.h`-only project is ambiguous — default cpp); `entryCandidates`: a `.c`/`.cpp` with `int main(`. |
| `editor/setup.ts` | `.c`/`.cpp` → clike grammar via `@codemirror/legacy-modes/mode/clike` (already used for C#). |
| `ui/LangIcons.tsx` | `IconC` + `IconCpp` (Devicon `c-plain` / `cplusplus-plain`), monochrome. |
| `FileBadge.tsx` | `c`/`cpp`/`cc`/`h`/`hpp` → tones. |
| `app/package.json` (`assets`) | Append `runtimes/clang/fetch-toolchain.sh public/warsha-clang` (idempotent, sha-verified). |
| `coi-serviceworker.js` | clang assets are same-origin → already covered; add to precache only if guaranteed offline is wanted. |

## Templates (M2)

`content/templates/c-*` and `cpp-*` — console programs with a `scanf`/`std::cin`
so the stdin path is exercised. Then regenerate `app/src/templates.ts` (add
`'c'`/`'cpp'` to `Template.lang`).

## Milestones

- **M0 — spike (prove the toolchain).** Standalone harness: load `@wasmer/sdk`,
  compile+run a C `printf` hello AND a **C++ `<iostream>`** hello, under
  `crossOriginIsolated`. Confirms: C++ actually works (libc++ present), COI/CORP
  behaviour, real download size, cold/warm compile+run timings, and that
  interactive stdin is drivable. **← current step.**
- **M1 — full engine.** `ClangRuntime` + `types.ts` + `clang.worker.js` +
  `index.ts`: SAB blocking stdin, compile diagnostics → stderr, kill/dispose/
  respawn, exit codes, C vs C++ driver selection. Drive via the harness.
- **M2 — shell integration.** The wiring table + templates + badges/glyphs.
- **M3 — QA, offline, docs.** `tools/qa/verify-clang.mjs` (mirror
  `verify-csharp.mjs`); `fetch-toolchain.sh` self-hosting; `INTEGRATION.md`;
  update `app/ARCHITECTURE.md` + `docs/legal/THIRD-PARTY.md` (LLVM/clang
  Apache-2.0-with-LLVM-exception, Wasmer SDK MIT).

## Open questions (resolve in M0)

1. **C++ stdlib** — does `clang/clang` ship libc++ + headers so `<iostream>`,
   `<vector>`, `<string>` compile and link? (Biggest risk. If C-only, C++ needs a
   separate sysroot or a different package.)
2. **Interactive stdin** — do the SDK's stdin/stdout streams give a clean blocking
   read for `scanf`, or must we own the WASI stdin fd over the SAB?
3. **Self-hosting** — can the full `clang/clang` `.webc` (with deps) be fetched
   once and loaded via `fromFile()` same-origin, for offline + no CDN at runtime?
4. **COI/CORP** — does the SDK's own worker/wasm loading work under the app's
   coi-serviceworker COOP/COEP? (Same-origin self-hosting should make it a
   non-issue, as with C#.)
5. **Latency** — cold clang boot + compile + link + run round-trip. Java's bar is
   7–20 s; C#'s cold is ~2–13 s. M0 measures the real number.
