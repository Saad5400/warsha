# Integrating the C# runtime into the app

`runtimes/csharp` is the production C# engine for Warsha: the **.NET 9
WebAssembly runtime** (Mono, single-threaded) hosting the **Roslyn** compiler,
in a **module** Web Worker, implementing the app's `Runtime` contract. User `.cs`
files are compiled in-browser into one assembly and executed; there is no server.

```
runtimes/csharp/
  src/index.ts             <- the only import the shell needs
  src/csharpRuntime.ts     CSharpRuntime (implements Runtime); mirrors PythonRuntime
  src/types.ts             mirror of app/src/runtime/types.ts (no import into app/)
  src/dotnet.worker.js     the module worker: boots dotnet.js, streams IO, blocks stdin
  harness/                 the .NET project (compiles to the _framework bundle) + a
    Warsha.CSharp.csproj    standalone test page
    Program.cs              Runner: Roslyn compile + AssemblyLoadContext + Console redirect
    wwwroot/                index.html + main.js (harness driver) + serve.mjs (COOP/COEP)
  build.sh                 publishes the engine, stages _framework + worker into the app
  M0-FINDINGS.md           the spike/M1/M2 measurements this doc summarises
```

## 1. Wire it into the registry

`app/src/runtime/index.ts` (the whole seam):

```ts
import { CSharpRuntime } from '../../../runtimes/csharp/src'

const registry: Record<LangId, Runtime> = {
  // …
  csharp: new CSharpRuntime({ workerUrl: new URL('warsha-dotnet/dotnet.worker.js', document.baseURI).href }),
}
```

`CSharpRuntime` structurally satisfies `app/src/runtime/types.ts` — no cast, no
adapter — typechecked against the copy in `src/types.ts`. If the contract
changes, change **both** files **and** the `FromWorker` union in
`csharpRuntime.ts`. `langForPath` maps `.cs` → `csharp`; `entryCandidates` offers
a `.cs` file with a `Main` method or the conventional `Program.cs`.

One instance per app is right: it owns one worker and reuses it across runs.

## 2. The worker is a MODULE worker, loaded by URL

`dotnet.js` is an ES module, so the worker **must** be `{ type: 'module' }`
(like Python's, unlike Java's classic worker). But it is loaded by **URL** from
`public/` (like Java's), not bundled: the worker does
`import './_framework/dotnet.js'`, and that relative import only resolves when the
worker and its `_framework/` tree sit together as static files. A bundler that
pulled the worker into its graph would break that path. So `build.sh` stages both
into `app/public/warsha-dotnet/`, and `csharpRuntime.ts` constructs the worker
from a plain URL string — Vite's module-worker transform never fires.

Same-origin is also why **COEP `require-corp` is a non-issue**: the worker and
every `_framework` asset are same-origin, so nothing needs a CORP header. (Python
and Java pull their runtimes cross-origin and depend on CDN CORP; C# does not.)

## 3. Building the bundle — `build.sh`, and the SDK

`build.sh [dest]` (default `app/public/warsha-dotnet`) runs
`dotnet publish -c Release` on `harness/Warsha.CSharp.csproj`, then copies the
published `_framework/` and the canonical `src/dotnet.worker.js` into `dest`. It
is wired into `app/package.json`'s `assets` script, so `prebuild`/`predev` stage
it automatically. It is idempotent (a content stamp skips the ~5 s republish when
nothing changed) and **degrades gracefully without the SDK**: if `dotnet` is
absent but a bundle is already staged, it uses that and only refreshes the worker.

**Prerequisite:** the **.NET 9 SDK + `wasm-tools` workload**. Install user-local
with the official script (no sudo), then the workload:

```
curl -fsSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 9.0 --install-dir "$HOME/.dotnet"
export DOTNET_ROOT="$HOME/.dotnet"; export PATH="$HOME/.dotnet:$PATH"
dotnet workload install wasm-tools wasm-experimental
```

**CI decision (open):** the static-site pipeline has no .NET SDK. Either add it to
the build image, or commit/stage the published `_framework/` as a release
artifact and let `build.sh`'s graceful path serve it. `public/warsha-dotnet/` is
gitignored today (large build product), matching `ecj.jar`.

## 4. Two csproj knobs that are mandatory (do not remove)

1. **`<WasmEnableWebcil>false</WasmEnableWebcil>`.** The default WebCIL format
   renames assemblies to `*.wasm` and wraps their metadata; Roslyn's
   `MetadataReference` cannot parse that. Off → real PE `*.dll` in `_framework/`,
   which the worker fetches as Roslyn references.
2. **`<WasmFingerprintAssets>false</WasmFingerprintAssets>`.** The default appends
   a content hash to each filename (`System.Console.4clfxtwg1x.dll`), which breaks
   fetching a reference by plain name. Off → stable `System.Console.dll`. (A later
   refinement can keep fingerprinting and read the name→file map from
   `getConfig()` in the worker.)

## 5. How compile + run works (`Program.cs` `Runner`)

- `Run(paths[], contents[], entry)` parses each `.cs` into a `SyntaxTree`, then
  `CSharpCompilation.Create(...).Emit(MemoryStream)` with
  **`concurrentBuild: false`** — mandatory on the single-threaded wasm runtime,
  else `PlatformNotSupportedException: Cannot wait on monitors on this runtime`.
- Reference assemblies are handed in from JS: the worker fetches a curated set of
  BCL `.dll`s from `_framework/` (already browser-cached from boot) and calls
  `AddReference`. `netstandard` + `System.Runtime` + `System.Private.CoreLib`
  forward most types; the rest cover common namespaces.
- A compile error streams its diagnostics to `onStderr` and ends the run with
  `onExit(1)` — nothing executes (same contract as Java's ECJ errors).
- On success: `AssemblyLoadContext(collectible)` loads the emitted assembly,
  `Console.Out`/`Error` are redirected to unbuffered writers that push each write
  to JS, `Console.In` is set to a blocking reader, and the entry point is invoked.
  The ALC is unloaded after each run.

**Never read `Console.In`.** Its getter calls `GetOrCreateReader()`, which throws
`Operation is not supported on this platform` on browser wasm (there is no default
stdin). `Console.SetIn(reader)` works and is all we need; `Console.ReadLine()`
then routes through our reader. `Console.Out`/`Error` getters are fine.

## 6. Blocking stdin — the SharedArrayBuffer protocol

Identical layout to `runtimes/python`: a `SharedArrayBuffer` with
`ctrl[0]` = state (`0` empty / `1` line / `2` EOF), `ctrl[1]` = byte length, and a
64 KiB data region. When user code calls `Console.ReadLine()`, the C# reader calls
the synchronous `warsha.readLine` `[JSImport]`, whose JS implementation posts
`stdin-request` to the main thread and then **parks the worker thread on
`Atomics.wait`**. The main thread's `writeStdin(line)` writes UTF-8 bytes into the
buffer, stores the length + `STATE_LINE`, and `Atomics.notify`s — waking the
worker, which decodes and returns the line (without the trailing newline).
`writeEof()` signals `STATE_EOF`, and `ReadLine()` returns `null`.

Because the worker thread blocks, **`SharedArrayBuffer` / cross-origin isolation
is required** — same as Python. Without it `load()` rejects with a clear message.
`coi-serviceworker` supplies the isolation on a header-less static host.

## 7. Measured behaviour (Chrome, `dist/` on `vite preview`, `crossOriginIsolated`)

| Step | Measured |
|---|---|
| Boot to `dotnet.create()` (warm HTTP cache) | ~0.4 s |
| Roslyn compile, warm | **~140 ms** (25× faster than Java's ECJ) |
| **Cold** Run-click → first `Console.ReadLine` prompt (OOP starter, 2 files) | **~13 s** (incl. ~37 MB download + boot + ref-load + compile + run) |
| Interactive: typed line → program continues | prompt-and-answer land on one line |
| Compile error → diagnostics + `onExit(1)` | nothing runs |

Bundle size: `_framework/` is **66 MB uncompressed** (172 untrimmed DLLs incl.
Roslyn ~9.5 MB); ~37 MB is actually fetched, brotli-compressing to roughly
**~13–15 MB** on a real static host. Within Java's-bar expectation.

## 8. Behaviour notes for the console UI

- **Output streams per write, unbuffered** — `Console.Write("Your name: ")` with
  no newline reaches the console *before* the following `ReadLine()` blocks, so the
  student types on the prompt line. Coalesce chunks in the console component
  (the shell already does, on `requestAnimationFrame`).
- **`kill()` respawns; `dispose()` does not** — same lifecycle as Python. `kill()`
  terminates the worker mid-`Atomics.wait` and starts a replacement, so the next
  Run pays a re-warm. `dispose()` (page closing / language switch away) tears down
  with no replacement.
- **Exit codes**: `0` clean, the program's code if it returns `int` /
  `Environment.Exit`, `1` on a compile error or unhandled exception, `null` when
  killed.

## Open items (M3)

- **QA parity**: add a `csharp` path to `tools/qa` mirroring
  `console-check.mjs` / `verify-java.mjs` (template runs end to end, prompt-then-
  read, compile error, kill+rerun). Not yet added.
- **Size trim**: enable `PublishTrimmed` and trim the BCL; Roslyn resists trimming
  (~9.5 MB floor), so expect ~15–25 MB uncompressed after trim. Measure that the
  reference set still resolves typical student code.
- **Offline**: `_framework` is same-origin, so the shell cache already stores it
  best-effort (Java's bar). Add `_framework` to the precache list for guaranteed
  offline if desired.
- **Interactive latency**: measure prompt→next-prompt round-trip in the app; tune
  the 250 ms `Atomics.wait` poll or pre-warm the reader path if it lags.
- **Reference set**: currently a curated list; consider deriving it from
  `getConfig()` resources so every runtime assembly is referenceable.
```
