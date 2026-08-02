# Integrating the Python runtime into the app

`runtimes/python` is the production Python engine for Warsha: Pyodide 314.0.3
(CPython 3.14) in a module Web Worker, implementing the app's `Runtime` contract.
No server, no build step of its own — the app's bundler consumes the TypeScript
source directly.

Everything below was verified in Chrome against a real Vite 6.4 build **and** a
real `vite dev` server, not reasoned about. Where a step is a hard requirement
rather than a preference, the failure you get without it is named.

```
runtimes/python/
  src/index.ts            <- the only import the shell needs
  src/pythonRuntime.ts    PythonRuntime (implements Runtime)
  src/types.ts            mirror of app/src/runtime/types.ts
  src/worker.js           the Pyodide worker (plain JS on purpose)
  harness/                standalone test page, see "Running the harness"
```

## 1. Wire it into the registry

`app/src/runtime/index.ts` — swap the fake for the real engine:

```ts
import { PythonRuntime } from '../../../runtimes/python/src'

const registry: Record<LangId, Runtime> = {
  java: new FakeRuntime('java'),
  python: new PythonRuntime(),
}
```

`PythonRuntime` structurally satisfies `app/src/runtime/types.ts`, so no cast and
no adapter. `src/types.ts` is a copy of that contract kept here so this module
doesn't reach into `app/`; if the contract changes, change **all three** —
`types.ts`, the `FromWorker` union in `pythonRuntime.ts`, and `worker.js`. The
progress upgrade landed in `types.ts` + `worker.js` only, leaving
`pythonRuntime.ts` forwarding a `msg.text` the worker had stopped sending, so
every progress report arrived as `undefined` and the progress block silently never
rendered. `onMessage` is the one place the worker protocol meets the contract.

One instance per app is right: it owns one worker and reuses it across runs.

## 2. vite.config.ts — three additions

```ts
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es' },              // (a)
  server: {
    port: 8083,
    fs: { allow: ['..'] },               // (b)
  },
})
```

**(a) `worker: { format: 'es' }` — required.** Vite's default is
`worker.format: 'iife'`. The module resolves its worker with
`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`, which
Vite discovers, bundles and hashes on its own (verified: `dist/assets/worker-<hash>.js`,
and `{type:"module"}` survives into the built call). But with the default format
the emitted worker chunk is wrapped in an IIFE and Vite rewrites `import.meta.url`
inside it — you are one refactor away from the classic-worker failure mode that
cost the spike a day (`importScripts` fetches no-cors, coi-serviceworker passes
opaque responses through untouched, and under `COEP: require-corp` the Pyodide
loader is blocked). With `format: 'es'` the chunk stays a real ES module. A module
worker is mandatory here, not a preference.

**(b) `server.fs.allow: ['..']` — required for `vite dev`.** `runtimes/` sits
outside the app's Vite root, and the worker is fetched by the browser as a raw
file rather than through the module graph, so the dev server refuses it:

```
403 Restricted -- The request url ".../runtimes/python/src/worker.js"
is outside of Vite serving allow list.
```

The symptom in the app is `worker failed to start (no message; check the console)`
from `load()`. Note the `.ts` files are served fine without this, so the failure
looks selective. `'..'` is resolved against the app root, i.e. the repo root.
Production builds are unaffected.

`build.target: 'es2022'` and `base: './'` are already what the app uses and both
are fine as-is.

## 3. index.html — coi-serviceworker

Copy `runtimes/python/harness/coi-serviceworker.js` (vendored v0.1.7, unmodified)
to **`app/public/coi-serviceworker.js`**, and add it as the first thing in `<head>`:

```html
<head>
  <meta charset="utf-8" />
  <script src="./coi-serviceworker.js"></script>
  ...
</head>
```

- It **must** live in `public/`. If you drop it next to `index.html` instead, Vite
  warns `can't be bundled without type="module" attribute`, leaves the `<script>`
  tag in `dist/index.html`, and does not copy the file — a 404 in production and
  no `SharedArrayBuffer`. Verified both ways.
- It **must** be a plain synchronous `<script>`: it reads
  `document.currentScript.src` to register itself, so `async`, `defer`, `type=module`
  and bundling all break it. It also has to run before anything touches
  `SharedArrayBuffer`.
- It gives the page `COOP: same-origin` + `COEP: credentialless` *or*
  `require-corp` (it degrades between them by itself), which is what makes
  `crossOriginIsolated === true` on a static host that sends no headers at all.
- If the host does send real COOP/COEP headers, the shim no-ops — keeping it is
  harmless and removes the first-visit reload.
- **HTTPS is non-negotiable in production** (secure context required;
  localhost/127.0.0.1 qualify in dev). Without it the shim bails out silently and
  `load()` rejects with the "needs cross-origin isolation" error.

Nothing else changes: no `vite-plugin-*`, no COOP/COEP headers from the host, no
Pyodide npm dependency (the assets come from jsDelivr, which already sends
`access-control-allow-origin: *` and `cross-origin-resource-policy: cross-origin`).

## 4. Using it

```ts
const python = new PythonRuntime()          // optionally { indexURL } to self-host

await python.load((p) => setLoadingProgress(p))
//   { phase: 'download', message: 'Downloading Python (11 MB, one-time)...',
//     loaded: 2_547_136, total: 12_150_000 }   repeatedly, ~10x/second
//   then { phase: 'boot', message: 'Starting Python...' }   (no byte counts)

const session = await python.run(files, 'main.py', {
  onStdout: (text) => console.append(text),      // chunks, not lines
  onStderr: (text) => console.append(text, 'err'),
  onStdinRequest: () => console.focusInputLine(),
  onExit:  (code) => {                            // 0 ok | non-zero error | null killed
    console.append(code === null ? '[stopped]' : `[exit ${code}]`)
    setRunning(false)
  },
})

session.writeStdin(line)   // resumes the blocked input()
session.kill()             // Stop button
```

`files` is the whole project (`SourceFile[]`, paths relative like
`helpers/shapes.py`); folder structure is recreated in the worker FS, so
`from helpers.shapes import Circle` works, with or without `__init__.py`.

## Behaviour notes for the console UI

**First visit costs one automatic page reload.** coi-serviceworker installs
itself, then reloads to get the isolation headers. Anything the page held in
memory at that moment is lost, so don't start expensive work before
`crossOriginIsolated === true`. Subsequent visits don't reload.

**Load timings** (Chrome/Linux, fast connection — a floor, not a promise): cold
~2.2 s and ~11.6 MiB (`pyodide.asm.wasm` 9.15 MiB + `python_stdlib.zip` 2.43 MiB),
warm ~1.2–1.8 s of pure wasm compile + Python init. The download is
HTTP-cacheable; the compile is not. Design the loading screen for 11 MB on school
wifi.

**`load()` is idempotent and safe to call before every run.** Concurrent calls
share one boot. Calling it when already warm resolves immediately without
emitting progress. `run()` calls it internally if needed, so the only reason to
call it yourself is to show progress.

**`kill()` costs a re-warm.** It is `worker.terminate()` (~1 ms, kills a
`while True:` loop and a worker parked in `Atomics.wait` alike), the session ends
with `onExit(null)`, and a replacement worker starts booting immediately. A
`run()` right after a kill waits for whatever is left of that boot — **measured
1315 ms in the harness**. There is no way to preserve interpreter state across a
kill; the new Python is clean, and the file set is rewritten on every run anyway.
Two consequences for the UI:

- Keep Run disabled until your `run()` promise resolves. `run()` awaits the
  respawn for you, but a user who can click Run twice in that window gets an
  `already running` rejection from the second call.
- If you want progress during the re-warm, call `load(onProgress)` again — it
  attaches to the in-flight respawn and replays its latest message.

**Output arrives per Python write, not per line.** `print(x, end="")`, an
`input()` prompt and a direct `sys.stdout.write()` all reach `onStdout` before
the read blocks, with no `flush=True` needed anywhere (verified for all four
shapes). That is deliberate: the worker forwards the exact bytes Python emitted
and does not buffer, because a worker blocked in `runPython` cannot run a timer
to flush later. **Coalesce in the console component instead** — accumulate the
chunks and paint on `requestAnimationFrame` — otherwise a tight print loop causes
DOM jank. A runaway program is bounded at 2 MiB of forwarded output per run,
after which one `[Warsha: output limit ...]` line is emitted on stderr and the
rest is dropped until Stop.

**Echo submitted input yourself, at the cursor.** The worker never echoes. Write
the line into the console at the current position the moment the user submits, in
its own span, so a prompt and its answer share one line
(`Your name: Warsha`) and student input can be coloured differently.

**stdin lines are capped at 64 KiB.** Longer lines are truncated on a code-point
boundary and a note goes to `onStderr`. `writeStdin` outside a pending
`input()` is ignored, so a stray Enter can't queue a phantom line.

**`input()` blocks; it can never hit EOF by accident.** The only EOF path is the
extra `session.writeEof()` (not part of the contract — use it if you add an EOF
button; otherwise a program reading to EOF is ended with Stop).

**Errors.** An uncaught exception writes a CPython-identical traceback to
`onStderr` and exits non-zero, with the student's own relative paths and correct
line numbers, including 3.14's fine-grained carets:

```
Traceback (most recent call last):
  File "main.py", line 4, in <module>
    explode(0)
    ~~~~~~~^^^
  File "helpers/boom.py", line 3, in explode
    raise ValueError(f"factor must be positive, got {factor}")
ValueError: factor must be positive, got 0
```

A `SyntaxError` matches `python main.py` exactly — no `Traceback` header, and
nothing in the file runs:

```
  File "main.py", line 2
    for i in range(3)
                     ^
SyntaxError: expected ':'
```

`sys.exit(3)` surfaces as `onExit(3)`; `sys.exit("message")` prints the message on
stderr and exits 1. No FS paths leak into any of this.

**"CPython-identical" is measured, not asserted.** 19 crash shapes were run in
this runtime and, separately, under a real `python3.14` on the same sources,
and the two stderr streams compared byte for byte:
`Traceback` header, frame order, source lines, 3.14 carets and anchors, chained
exceptions (`from`, and the implicit "During handling of…"), `SyntaxError`,
import-time errors, `assert`, `RecursionError`'s `[Previous line repeated N more
times]`, `__del__`'s "Exception ignored while calling deallocator", a student's
own `exec()` (`"<string>"` survives), non-ASCII messages and file names, and
warnings. **16 of 19 are byte-identical.** Two normalisations are applied to the
reference first, both of them deliberate Warsha behaviour rather than fidelity
gaps: the project prefix (Warsha shows project-relative paths) and the stdlib
prefix (`/usr/lib` here, `/lib` in Pyodide).

The three that are not identical, and why none of them is fixable from here:

| Case | Difference | Cause |
| --- | --- | --- |
| `open("missing.txt")` | `[Errno 44]` where CPython says `[Errno 2]` | Emscripten's libc numbers `ENOENT` 44. The number is inside the `OSError` message that CPython itself builds; rewriting it would mean editing the text of a student's exception, which is a line worth not crossing. The words after it are identical. |
| `RecursionError` | `[Previous line repeated 25 more times]` where CPython says 26 | The student's `<module>` starts one frame deeper here, because it runs inside `_warsha_run` rather than as the process entry point. Matching the count would mean matching the whole host stack depth. |
| `RecursionError` | keeps the `~~~^^^` anchor on the first frame, where CPython drops it | A CPython **micro-version** difference, not ours: Pyodide 314.0.3 bundles 3.14.2, and 3.14.6 suppresses anchors while handling a `RecursionError`. Verified by running the same file under 3.12, 3.14.2 and 3.14.6. |

**Pyodide's own frames never reach a student.** `pyodide/webloop.py` and friends
are the browser emulation layer and have no CPython counterpart, so a frame from
them in a traceback is the Python equivalent of showing a student our launcher.
The runner filters any frame whose file sits under `pyodide/` or `_pyodide/` and
outside the project dir — a file the student themselves named `pyodide.py` is
never hidden. The filter runs over the whole cause chain via
`traceback.TracebackException`, which is the same machinery `format_exception`
uses, so output is unchanged in the ordinary case where there is nothing to
filter. Only one known path reaches it today: `asyncio.run()` (see below).

**Source lines are re-read every run.** Everything a student sees a source line
in — tracebacks, and the line under a warning — gets it from `linecache`, which
is keyed by file name and lives as long as the interpreter. One interpreter
serves every run here, unlike `python main.py`, so the runner clears that cache
alongside its `sys.modules` purge. Without it a warning in run 2 printed a line
out of run 1's program (tracebacks happened to escape because `traceback` calls
`linecache.checkcache()` itself and `warnings` does not). The harness asserts
this across two consecutive runs; it cannot be caught by running one program.

**`asyncio.run()` fails fast and cleanly, on purpose** (task #21, CEO decision,
2026-08-02: option (b), detect and fail fast). The runner calls into Python
synchronously, so Pyodide can never stack-switch to actually drive a coroutine
— and left alone, `asyncio.run()` and `loop.run_until_complete()` both call
`loop.create_task()` *before* they discover that and raise, which schedules the
coroutine onto the browser's event loop via a plain callback outside this call
stack entirely. That callback still fires later — after the run that triggered
it has already finished and posted `done` — and since `sys.stdout`/`sys.stderr`
are wired to whichever run is *then* active, the coroutine's real exception (or
asyncio's own "Task exception was never retrieved") used to land in a run the
student never asked it to (measured, contaminating the *next* program's
output).

The fix, installed once at boot in `worker.js` (search "asyncio guard"),
replaces `asyncio.run`, `WebLoop.run_until_complete` and `WebLoop.run_forever`
outright rather than catching the `RuntimeError` after the fact: none of them
ever create a task, so there is nothing left to fire late.
`WebLoop.call_exception_handler` is silenced too, as a second line of defence.
A student who calls `asyncio.run(main())` now sees exactly one line, at normal
traceback position —

```
Traceback (most recent call last):
  File "main.py", line 9, in <module>
    asyncio.run(main())
RuntimeError: asyncio is not supported in Warsha yet — use ordinary (synchronous) code
```

— and the coroutine's body never runs at all, in this run or any later one.
`_warsha_internal_frame` was extended to filter by frame *name* (any
`_warsha_*` function), not just by path, so the guard's own frame stays
invisible the same way Pyodide's `webloop.py` frames already were. Covered by
harness scenarios `asyncio-run` / `asyncio-clean-after` (checks 6a–6g) — the
second one exists solely to prove the bleed is gone, by running immediately
after the first with no delay and demanding byte-identical output. Nothing in
the curriculum uses `asyncio`; genuinely supporting it would mean moving the
runner to `runPythonAsync`, which collides with the synchronous `Atomics.wait`
that makes `input()` block — still not on the table.

**Each run starts from a clean project dir and clean user modules.** Editing
`helpers/shapes.py` between runs takes effect, and a file you removed from the
file set is really gone (no stale import, no stale `__pycache__`). `__name__` is
`"__main__"` in the entry file. The entry may be nested (`pkg/main.py` importing
`pkg.helper` works); imports always resolve from the project root, so keep the
entry at the root unless you mean package-relative imports.

**Not tested on an iPad** (Chrome/Linux only). The known risks, in order: memory
(~11.6 MiB of assets become a much bigger wasm + Python heap, and a tab iPadOS
reclaims pays a full re-boot); a worker parked in `Atomics.wait` while the student
switches apps may stall until resume; and the on-screen keyboard needs
`visualViewport`-aware layout with `autocapitalize`/`autocorrect` off on the stdin
input. `SharedArrayBuffer` needs Safari 15.2+.

## Self-hosting Pyodide (optional, later)

`new PythonRuntime({ indexURL: '/pyodide/' })` points the loader at a same-origin
copy (`pyodide.mjs`, `pyodide.asm.wasm`, `pyodide.asm.js`, `python_stdlib.zip`,
`pyodide-lock.json`). That removes a third party from the critical path and makes
everything same-origin, at ~11.6 MiB in the repo. Any *other* cross-origin asset
added later must send `Cross-Origin-Resource-Policy` or it will be blocked under
COEP.

## Running the harness

```
cd runtimes/python
npm install          # esbuild + typescript, for the harness build only
npm run build:harness
node serve.mjs 8084  # http://localhost:8084/harness/  (sends no COOP/COEP headers)
```

The page drives the module through the contract only. "Run self-test (all
scenarios)" runs 27 assertions: the committed `content/templates/python-starter`
verbatim (multi-file import + its `input()`), `input()` twice, the four
partial-line-prompt cases, an uncaught traceback, a warning, and infinite loop →
kill → run again. The suite last ran **27/27** on Chrome 151 / Linux.

The warning scenario is the odd one out and must stay where it is, straight
after `traceback`: it is the only check that spans two runs, and it exists to
catch a stale `linecache` serving the *previous* program's source line. Run it
first and it passes whether or not the bug is present.
`window.harness` exposes the same API for scripted checks.

Other checks worth keeping: `npm run check` (`node --check src/worker.js` — the
runner is a Python program inside a `String.raw` template, so one stray backtick
silently breaks the whole worker with no error message) and `npm run typecheck`.
