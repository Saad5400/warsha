# C# runtime — M0 spike findings

Date: 2026-08-04. Machine: Zorin OS 18.1 (Ubuntu), x86_64, Chrome (Browser pane).
Goal: prove the .NET-wasm + Roslyn toolchain compiles and runs user C# in the
browser under Warsha's cross-origin-isolation / COEP sandbox. **All proven.**

## Environment established (reusable)

- **.NET 9.0.316 SDK** installed user-local at `~/.dotnet` via the official
  `dotnet-install.sh` (no sudo, no system packages). Use with
  `export DOTNET_ROOT=$HOME/.dotnet; export PATH=$HOME/.dotnet:$PATH`.
- Workloads `wasm-tools` + `wasm-experimental` (9.0.18) installed.
- Project: `runtimes/csharp/harness/` — `dotnet new wasmbrowser`, SDK
  `Microsoft.NET.Sdk.WebAssembly`, `net9.0`, refs `Microsoft.CodeAnalysis.CSharp`
  4.11.0. Build: `dotnet publish -c Release -o ./publish`. Serve:
  `node serve.mjs 8087` (COOP/COEP, root `publish/wwwroot`).

## Results (measured in the Browser pane, `crossOriginIsolated === true`)

| Check | Result |
|---|---|
| Runtime boot (warm cache) | **605 ms** to `dotnet.create()` |
| Reference load (8 DLLs from `_framework`) | 40 ms, 8/8 |
| `Console.WriteLine` compile+run (first) | **949 ms** → `hello from roslyn` |
| LINQ program compile+run (second) | **139 ms** → correct result |
| Compile error | real diagnostic `(1,40): error CS1525: …` |
| Runtime exception | caught, surfaced with `System.Exception: boom at P.Main()` |

Roslyn compile is ~140 ms warm — **far faster than Java's ~3.5 s ECJ**. The
one-time cost is the download, not the compile.

## Two build knobs that were necessary (keep them)

1. **`<WasmEnableWebcil>false</WasmEnableWebcil>`** — default WebCIL renames
   assemblies to `*.wasm` and wraps the metadata; Roslyn's `MetadataReference`
   cannot parse that. Off → real PE `*.dll` in `_framework/` that Roslyn reads.
2. **`<WasmFingerprintAssets>false</WasmFingerprintAssets>`** — default appends a
   content hash (`System.Console.4clfxtwg1x.dll`), which breaks fetching a
   reference by plain name. Off → stable `System.Console.dll`. (Alternative for
   M1: keep fingerprinting and read the name→file map from `getConfig()`.)

## Roslyn wiring that works (Program.cs `Runner`)

`CSharpCompilation.Create(..., new CSharpCompilationOptions(OutputKind.ConsoleApplication,
concurrentBuild:false))` → `Emit(MemoryStream)` → `AssemblyLoadContext(collectible)`
`.LoadFromStream` → invoke `assembly.EntryPoint` → capture via `Console.SetOut`.
**`concurrentBuild:false` is mandatory** on the single-threaded wasm runtime, else
`PlatformNotSupportedException: Cannot wait on monitors on this runtime`.

## Size (the number that shapes the loading UI)

- `_framework/` on disk: **66 MB** (172 untrimmed DLLs, incl. Roslyn
  CodeAnalysis 2.98 MB + CSharp 6.52 MB).
- Over the wire this spike fetched **~37 MB uncompressed** (185 requests) — the
  spike server sends **no compression**. On a real static host with brotli the
  managed DLLs compress to roughly **~13–15 MB**. Within "tens of MB" / Java's
  bar, as agreed.
- **M1 trimming target:** enable `PublishTrimmed` and trim the BCL; Roslyn itself
  resists trimming (~9.5 MB floor), so expect ~15–25 MB uncompressed after trim.

## Carried into M1

- Blocking `Console.ReadLine()` over `SharedArrayBuffer` + `Atomics.wait`, with
  the runtime on a **module Web Worker** (mirror `runtimes/python`).
- Multi-file projects: parse each `.cs` into its own `SyntaxTree`, compile as one
  assembly; Roslyn resolves the single entry point.
- Full reference set (or read `getConfig()` resources) so common student APIs
  (collections, LINQ, text, tasks) resolve.
- Stream stdout/stderr incrementally (custom `TextWriter` → JS callback) instead
  of returning one string at the end, so long output and prompts appear live.

---

# M1 findings (engine complete)

Date: 2026-08-04. Same machine/browser. **All proven in the Browser pane.**

## What was built

- `runtimes/csharp/src/` — the engine package: `types.ts` (contract mirror),
  `csharpRuntime.ts` (`CSharpRuntime`, mirrors `PythonRuntime`: idempotent load,
  run, kill+respawn, dispose, SAB stdin, FromWorker union), `dotnet.worker.js`
  (canonical module worker), `index.ts`. Typechecks clean under the Java
  package's tsconfig.
- `Program.cs` `Runner.Run(paths, contents, entry)` — multi-file Roslyn compile
  into one assembly, streaming stdout/stderr via `[JSImport]` callbacks, blocking
  `Console.ReadLine()` via a synchronous `[JSImport]` backed by `Atomics.wait`.

## Verified interactively (harness drives the worker with a scripted stdin)

| Scenario | Result |
|---|---|
| prompt-then-read on one line | `Your name: ` printed, blocked, resumed → `Hello, Warsha!` |
| two `int.Parse(Console.ReadLine())` | `a + b = 42` (buffered Read path) |
| multi-file (Program.cs + Greeter.cs) | one assembly, cross-file call works |
| `while (ReadLine() != null)` + EOF | `total lines: 3` |
| compile error | `Program.cs(1,40): error CS1525`, exit 1, nothing ran |

## The one bug found and fixed

`Console.In`'s getter throws `Operation is not supported on this platform` on
browser wasm (it calls `GetOrCreateReader()`; there is no default stdin). **Never
read `Console.In`.** `Console.SetIn(reader)` works, and `Console.ReadLine()` then
routes through our reader. Each run installs a fresh reader; nothing to restore.
(`Console.Out`/`Console.Error` getters are fine — only `In` throws.)

## Perf item to measure in M2 (real app)

Interactive round-trip latency looked high in the harness (a 3-read loop ran
~4 s, vs 28 ms for a non-interactive multi-file run). Likely first-JIT of the
reader path plus the harness's own `setTimeout` per answer, not the SAB round
trip (Python uses the identical 250 ms `Atomics.wait` poll and is snappy). **To
do:** measure real Run-click→prompt and prompt→next-prompt latency in the app; if
the 250 ms poll or JIT shows as lag, tune the poll or pre-warm the reader path.

---

# M2 findings (wired into the app, verified end-to-end)

Date: 2026-08-04. `dist/` built and served on `vite preview` (COOP/COEP via
coi-serviceworker), driven in the Browser pane. `crossOriginIsolated === true`.

## Wiring done (7 edits + templates + engine bundle)

- `languages.ts`: `csharp` → `ready`, `version: '.NET 9 · Roslyn'`.
- `runtime/index.ts`: `LangId` + registry `csharp: new CSharpRuntime({workerUrl})`,
  `langForPath` `.cs`, `.cs` entry detection (Main regex or `Program.cs`).
- `editor/setup.ts`: `EditorLang` + `.cs` → `csharp`, grammar via
  `StreamLanguage.define(clike.csharp)` (`@codemirror/legacy-modes`, newly added dep).
- `LangIcons.tsx`: `IconCSharp` (stroked "C#") + `IconLang`/`LangIcon` case.
- `FileBadge.tsx`: `cs` → `csharp`.
- `app/package.json` `assets`: appends `runtimes/csharp/build.sh public/warsha-dotnet`.
- `app/.gitignore`: `public/warsha-dotnet/`.
- Templates: `content/templates/csharp-{basics,methods,starter}` + `templates.ts`
  entries (strings byte-identical, verified) + `Template.lang` union.
- `runtimes/csharp/build.sh` publishes the engine and stages `_framework` + the
  worker; idempotent (content stamp), degrades gracefully without the SDK.

`tsc --noEmit` clean; `npm run build` succeeds; bundle lands in `dist/warsha-dotnet/`.

## Verified in the real app (OOP starter, 2 files, interactive)

| Step | Result |
|---|---|
| Picker | C# is a **ready** tile ("C# · .NET 9 · Roslyn"); 3 starters grouped by level |
| Create | `Program.cs` + `Shapes.cs`; Run enabled (entry = Program.cs) |
| Editor | C# syntax highlighting active (clike grammar); 3 C# glyph badges render |
| Run (cold) | **12.9 s** click→first prompt (incl. ~37 MB download + boot + compile) |
| Output | `Circle: area = 12.57`, `Rectangle: area = 12.00`, `Total area = 24.57` (Math.PI, inheritance, `List<Shape>` all correct) |
| Interactive | blocked on `Console.ReadLine()`; typed `Saad` echoed on the prompt line → `Hello, Saad!` |
| Exit | `Finished. (exit code 0)`; **no console errors** |

C# is functionally shipped. Remaining: M3 (QA suites, INTEGRATION.md, ARCHITECTURE
+ THIRD-PARTY docs, offline caching, size trim).
