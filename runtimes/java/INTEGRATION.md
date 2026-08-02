# Integrating the Java runtime into the app

`runtimes/java` is the production Java engine for Warsha: CheerpJ 4.3 (a WASM
Java 8 JVM) plus ECJ 3.26.0 as the compiler, in a **classic** Web Worker,
implementing the app's `Runtime` contract. No server, no build step of its own —
the app's bundler consumes the TypeScript source directly. One asset has to be
fetched at build time (`ecj.jar`, never committed).

```
runtimes/java/
  src/index.ts              <- the only import the shell needs
  src/javaRuntime.ts        JavaRuntime (implements Runtime)
  src/types.ts              mirror of app/src/runtime/types.ts
  src/jvm.worker.js         the CheerpJ worker (plain JS, and CLASSIC -- see §2)
  src/bootstrap/*.java      Bridge / Build / Launcher, run inside the JVM
  src/bootstrap.generated.ts  GENERATED from the above, committed
  fetch-compiler.sh         downloads + sha256-verifies ecj.jar
  validate.sh               offline gate: compiles the bootstrap, 28 self-tests
  serve.mjs                 harness server, HTTP Range (and optional COOP/COEP)
  harness/                  standalone test page, see "Running the harness"
```

## How the numbers below were obtained

Everything in this document was re-measured on **2026-07-31** by driving the
harness through the contract in **Chrome 151 on a Windows desktop (16 cores)**,
with the harness served off the Linux dev box by `serve.mjs` over a **LAN
address**, and with other builds running on that box at the same time. Treat the
timings as a pessimistic floor rather than a promise: the LAN hop adds latency to
every one of the many HTTP Range requests CheerpJ makes against `ecj.jar`, which
is exactly the traffic that dominates a cold compile.

Three things were **not** verified in that pass. **Two have since been closed** by
wiring this runtime into the app for real (Vite 8.2 production build, `dist/` served
on `localhost`, Chrome 150/Linux, 31/31 in-app checks):

- ~~**No Vite build and no `vite dev` run.**~~ **CLOSED.** §1–§2 have now been
  executed against a real Vite 8.2 build and drive the real app. The wiring below
  is what shipped; three findings are folded in and marked **VERIFIED** /
  **DEVIATION** where they sit.
- ~~**No truly cross-origin-isolated context** (§4).~~ **CLOSED.** The app serves
  `coi-serviceworker` for Python's sake, so the page really is
  `crossOriginIsolated === true` over `localhost`, and this runtime boots and runs
  there unharmed under `COEP: require-corp` — see §4.
- **No iPad.** Chrome/desktop only, the same gap the spike had. Still open.

## 1. Wire it into the registry

`app/src/runtime/index.ts` currently has `java: new FakeRuntime('java')`. Swap in
the real engine:

```ts
import { JavaRuntime } from '../../../runtimes/java/src'

const registry: Record<LangId, Runtime> = {
  java: new JavaRuntime({ workerUrl: new URL('warsha-jvm.worker.js', document.baseURI).href }),
  python: new PythonRuntime(),
}
```

`JavaRuntime` structurally satisfies `app/src/runtime/types.ts`, so no cast and
no adapter — typechecked here against a copy of that contract in `src/types.ts`,
kept so this module doesn't reach into `app/`. If the contract changes, change
both files **and** the `FromWorker` union in `javaRuntime.ts`; that union is the
one place the worker protocol meets the contract, and it is where the Python
runtime once lost every progress report to a silently renamed field.

One instance per app is right: it owns one worker and reuses it across runs.

## 2. The worker must stay CLASSIC — and Python's must stay a module

This is the one genuinely awkward part of wiring both runtimes into one Vite app,
and it is worth understanding before touching `vite.config.ts`.

CheerpJ's `loader.js` declares `cheerpjInit` inside an
`if (!self.cj3LoaderPath) { … }` block. That reaches global scope only under
sloppy-mode **classic**-script hoisting; in a module worker it stays
block-scoped and `cheerpjInit` is simply never defined. The symptom is a
`ReferenceError` deep inside boot, or nothing at all. The loader must also arrive
via `importScripts`, which only exists in a classic worker.

The Python runtime needs the exact opposite (`{ type: 'module' }`), and Vite's
`worker.format` is a **single global setting**. You cannot satisfy both through
Vite's worker pipeline. The fix is to keep this worker out of that pipeline
entirely:

**Copy `src/jvm.worker.js` to `app/public/warsha-jvm.worker.js`** and pass its
URL as `workerUrl`. Files in `public/` are copied verbatim and served as-is, so
the file stays a classic script and `worker.format: 'es'` (which Python needs)
never touches it. The worker has no imports of its own, so it does not need
bundling.

`app/package.json` needed an asset step. **VERIFIED — this is now in `app/package.json`
exactly as written and runs on every build:**

```jsonc
// app/package.json
"scripts": {
  "prebuild": "npm run assets",
  "predev":   "npm run assets",
  "assets": "cp ../runtimes/java/src/jvm.worker.js public/warsha-jvm.worker.js && ../runtimes/java/fetch-compiler.sh public"
}
```

Both products of that step are **gitignored** (`app/.gitignore` lists
`public/warsha-jvm.worker.js` and `public/ecj.jar`): the worker is a verbatim copy
of `src/jvm.worker.js`, so committing it would let a stale duplicate drift out of
sync with the source of truth, and `*.jar` is gitignored repo-wide for licensing.
`fetch-compiler.sh` is idempotent — it re-verifies the sha256 and skips the
download when the jar is already correct, so `prebuild` costs nothing after the
first run.

**DEVIATION from the last paragraph of this section (harmless, worth knowing).**
Vite emits the worker **twice**. The `public/` copy lands at `dist/warsha-jvm.worker.js`
as intended, and Vite *additionally* emits `dist/assets/jvm.worker-<hash>.js` because
`DEFAULT_WORKER_URL`'s `new URL('./jvm.worker.js', import.meta.url)` is statically
analysable, so Rollup follows it as an asset reference even though nothing loads it.
Verified with `cmp`: that emitted file is **byte-identical** to the source, i.e. Vite
passed it through untouched rather than running it through the worker pipeline — which
also confirms this section's claim that the default `workerUrl` would work under Vite.
The cost of the duplicate is 16 kB of dead weight in `dist/`; the explicit `workerUrl`
is still preferred because it does not depend on that heuristic holding.

`app/vite.config.ts` already carries both settings this needs, for Python's sake:
`worker: { format: 'es' }` (harmless here, since the Java worker bypasses the
pipeline) and `server: { fs: { allow: ['..'] } }`, without which `vite dev` 403s
anything under `runtimes/` and the failure surfaces as the misleading
`worker failed to start (no message; check the console)`.

The module's default `workerUrl` is `new URL('./jvm.worker.js', import.meta.url)`
resolved **outside** any `new Worker(...)` call, so a bundler treats it as a
plain asset and the worker is constructed from a variable — Vite's
module-worker transform never fires. That default is what the harness uses (via
esbuild) and it should work under Vite too, but the `public/` copy above is the
arrangement that is guaranteed not to depend on bundler asset heuristics. Prefer
it.

## 3. ecj.jar — where it comes from and where it must land

`fetch-compiler.sh [dest]` downloads ECJ 3.26.0 from Maven Central and verifies
its sha256 (`ac0ba587…f5a2db5`, 3,133,846 bytes — re-verified against the file in
this directory), deleting the file and failing on mismatch. **It must run at
build time**, in CI and in local dev setup; `*.jar` is gitignored repo-wide and
the jar must stay that way.

The jar has to be served **at the deployed site root**, because CheerpJ's `/app/`
mount maps to the web server root, not to the page's directory. With the app
deployed at the root of its domain, `app/public/ecj.jar` is exactly right and the
default `compilerJarPath: '/app/ecj.jar'` works unchanged.

**If the app is deployed under a sub-path** (e.g. GitHub Pages at
`user.github.io/warsha/`), `/app/` still means the server root, so the jar is at
`/warsha/ecj.jar` and you must say so:

```ts
new JavaRuntime({ compilerJarPath: '/app/warsha/ecj.jar' })
```

Getting this wrong fails at `load()` with a CheerpJ network error, not silently.

**The host must support HTTP Range.** CheerpJ reads the jar in byte ranges;
against a server that ignores `Range` it logs `HTTP server does not support the
'Range' header. CheerpJ cannot run.` and then refetches the whole jar, making
every compile look seconds slower. S3, Cloudflare Pages, Netlify and GitHub Pages
all support it. `python3 -m http.server` does **not** — hence `serve.mjs`.
`vite preview` does, verified against the built `dist/`: a
`Range: bytes=100-199` request for `/ecj.jar` answers
`206 Partial Content` + `Content-Range: bytes 100-199/3133846`. So the app's own
preview server is a faithful stand-in for a real static host here.

Licensing: ECJ is EPL-2.0 (redistributable); CheerpJ is used under its Community
Licence, which covers FOSS projects and requires attribution, and **forbids
self-hosting the runtime** — so `cjrtnc.leaningtech.com` is a hard runtime
dependency and true offline use is off the table. Both notices belong in
`docs/legal/THIRD-PARTY.md`.

## 4. Cross-origin isolation: this runtime doesn't need it, and survives it

This runtime blocks the JVM with an async CheerpJ native, not `Atomics.wait`, so
it needs **no `SharedArrayBuffer`, no COOP/COEP and no `coi-serviceworker`** —
the harness runs in a page where `crossOriginIsolated === false`.

But the app turns isolation on globally for Python's sake (`coi-serviceworker` in
`app/index.html`), which puts this worker under `COEP: require-corp` whether it
wants to be or not. That policy blocks cross-origin subresources unless they are
CORS-checked or carry `Cross-Origin-Resource-Policy`, and `importScripts` fetches
**no-cors** — precisely the failure mode `app/vite.config.ts` warns about. The
CheerpJ CDN answers with what is needed:

```
access-control-allow-origin: *
cross-origin-resource-policy: cross-origin      # on loader.js, cj3.js and cj3.wasm
```

So the loader, the engine and `ecj.jar` (same-origin) should all load under
isolation. **CONFIRMED end to end.** Serving the app's `dist/` on `localhost` (a
secure context) with its `coi-serviceworker` active gives
`crossOriginIsolated === true`, and in that page the Java runtime booted, compiled
and ran the template interactively with no asset blocked — alongside Python's
module worker in the same page. COEP does not trouble this runtime in practice:
`importScripts` fetches the loader no-cors, but the shim rewrites the CDN response
headers and CheerpJ's CDN sends `cross-origin-resource-policy: cross-origin`
anyway.

One piece of expected noise, so nobody mistakes it for a fault: CheerpJ probes a
handful of optional JVM filesystem paths that do not exist on its CDN
(`/etc/localtime`, `/8/lib/ext`, `/8/jre/lib`, `/8/lib/endorsed`,
`/8/lib/currency.properties`), which fail and produce ~38 `Network error for null:
TypeError: Failed to fetch` **console** errors per session. They are re-emitted by
this module's own console hook (`jvm.worker.js`, the `console[level]` wrapper), are
forwarded to `onInternalLog`, and — as the Bridge-channel design guarantees —
never reach the student's output pane. Verified: the student console stayed clean
through all of it.

## 5. Using it

```ts
const java = new JavaRuntime({ workerUrl: '…/warsha-jvm.worker.js' })

await java.load((p) => setLoadingProgress(p))
//  { phase:'download', message:'Downloading Java engine (one-time)…', loaded, total }
//  { phase:'boot',     message:'Starting the Java engine…' }
//  { phase:'compile',  message:'Preparing the Java compiler…' }

const session = await java.run(files, 'app/Main.java', {
  onStdout: (text) => console.append(text),       // chunks, not lines
  onStderr: (text) => console.append(text, 'err'),
  onStdinRequest: () => console.focusInputLine(),
  onExit: (code) => {                             // 0 ok | non-zero error | null killed
    console.append(code === null ? '[stopped]' : `[exit ${code}]`)
    setRunning(false)
  },
})

session.writeStdin(line)   // resumes the blocked Scanner read
session.kill()             // Stop button
java.dispose()             // leaving the page, or switching language
```

`files` is the whole project (`SourceFile[]`, paths relative like
`models/Person.java`). Non-`.java` files are ignored. The entry must be a
`.java` file in the set; its main class is derived from its **`package`
declaration**, not its directory, so a file at the project root with
`package app;` still works.

### Progress reporting shape

`onProgress` receives the **structured `LoadProgress` object**
(`{ phase, message, loaded?, total? }`) from `src/types.ts`, never a bare string.
The plumbing supports it end to end: `app/src/runtime/types.ts` declares the same
union and `normalizeProgress` wraps the legacy string arm, so nothing in the shell
has to parse prose. Two things to know:

- The `download` phase carries a **real** `loaded` byte count and a `total` that
  comes from **hardcoded sizes of the pinned CheerpJ 4.3 assets**. It has to: the
  CDN lists `content-length` in `access-control-expose-headers` but never actually
  sends the header (responses are gzip/chunked — checked with
  `Accept-Encoding: identity` too), so `content-length` reads as `null` and the
  total is unknowable from the response. Measured cold, the counter ran
  `210,118 → 1,038,813` against `total: 1,038,813` and the total was never
  dropped, which also confirms the pinned sizes still match the CDN. If `loaded`
  ever exceeds the expected `total`, `total` is dropped rather than shown wrong —
  so **treat `total` as optional and fall back to an indeterminate sweep**.
- `boot` and `compile` have no byte counts at all, and `compile` is the long one.

**What you actually receive, by situation** — this matters for the loading UI and
it is not what an earlier draft of this document claimed:

| Situation | Progress events |
|---|---|
| Cold origin, nothing cached | all three: `download` (with bytes), `boot`, `compile` |
| Reload with the engine in the HTTP cache | **exactly one**: `compile` |
| `load()` called when the runtime is already booted | none; resolves immediately |

`download` and `boot` are announced only if they last longer than 250 ms, so a
cache hit stays silent instead of flashing a bar. The `compile` phase is
deliberately **never** gated, because it costs seconds on every fresh worker (the
bootstrap is compiled in the browser, see "Deviations"). So a warm reload does
show one progress line for ~7–10 s: budget a spinner or elapsed timer for it, and
do not treat "no progress events" as anything but an already-booted runtime.

**The elapsed timer turned out to be mandatory, and the app now has one.** Measured
in-app before it existed: the progress block was continuously on screen (blank for
at most 400 ms, during the handover between phases) but its text did not change for
**7.2–10.0 s** while the bootstrap compiled, because `compile` reports no byte
counts and fires once. A frozen string under a looping CSS sweep is
indistinguishable from a hang and breaks DESIGN-SPEC §7.6's "something numeric
changes at least every two seconds". `app/src/components/ProgressBlock.tsx` now
counts the seconds of the current phase whenever there is no determinate bar
(`useElapsedSeconds`), which cut the longest static stretch to **900 ms**. Any other
shell consuming this runtime needs the same thing — the runtime cannot supply it,
since there is genuinely nothing to report between "compile started" and "compile
finished".

## Behaviour notes for the console UI

**Engine size is ~1.0 MB, not tens of MB.** Verified byte-exact by fetching them:
`cj3.js` 666,055 B + `cj3.wasm` 372,758 B + `loader.js` 7,521 B = **1,046,334 B**
from the CheerpJ CDN, plus **3,133,846 B** of `ecj.jar` from your own origin. All
are HTTP-cacheable (`max-age=31536000` on the CDN). This is roughly a tenth of the
Python runtime's 11.6 MiB, so the loading screen does not need to be designed
around a huge download — it needs to be designed around **compile time**, which is
the real cost here.

**Measured timings** (Chrome 151/Windows, LAN-served, busy machine — a floor):

| Phase | Measured |
|---|---|
| `load()` on a cold origin (nothing cached) | **22.0 s** = init 2.2 s (incl. the 1.0 MB download) + bootstrap compile **19.8 s** |
| `load()` on a reload with the engine cached | **7.3–9.7 s** = init 39–85 ms + bootstrap compile **7.0–9.6 s** |
| `load()` when already booted | ~0 ms, silent |
| Cold: Run click → first `Scanner` prompt on screen | **27.0 s** |
| Warm reload: Run click → first prompt | **11.1 s** |
| Second run in the same session → first prompt | **4.3–4.4 s** |
| Student compile, 1–3 files (7 samples) | **3.35–3.62 s** |
| Run of a non-interactive program | **0.78–1.01 s** |
| `kill()` → `onExit(null)` | **0–1 ms** |
| `kill()`, Run pressed immediately → finished run | **12.5–12.7 s** |
| `kill()`, ~14 s of thinking time, then Run → finished run | **4.4 s** |
| 2000 × `System.out.println` | **1.01 s** of run time, 4000 `onStdout` calls |
| Whole 43-check self-test suite | **56–75 s** |

**Measured again in the real app**, `dist/` served over `localhost` (Chrome
150/Linux, no LAN hop, quiet machine) — the same shape, roughly half the wall clock,
which is what dropping the LAN latency on CheerpJ's many Range requests buys:

| In-app step | Measured |
|---|---|
| Cold: Run click → first `Scanner` prompt | **10.7–13.6 s** |
| Second run in the same session → first prompt | **2.6–2.8 s** (no progress block at all) |
| Warm reload (engine cached, fresh worker) → output | **7.4–7.6 s** |
| Student compile error → diagnostics on screen | **3.3 s** |
| `kill()`, Run pressed at once → finished run | **4.2–5.1 s** |
| Python cold in the same session, after Java | **2.1–2.6 s** |
| Java again after Python ran | **2.5–2.7 s** |

The dominant cost is ECJ, not the download and not the student's code. Two
readings of that table are worth internalising:

- **The bootstrap compile is the whole loading experience.** ~7–10 s warm, and
  **19.8 s on a genuinely cold cache**, where ECJ is also reading its own classes
  out of `ecj.jar` over the network for the first time. The spike measured ~11 s
  cold on loopback/Linux and this document's earlier draft claimed 7.3 s; the
  honest range across every boot observed here is 7.0 s (warm, quiet) to 19.8 s
  (cold, LAN, busy). Design the loading screen for the top of that range.
- **Student compiles are stable at ~3.5 s** once warm, whatever the project — a
  3-file project and a 1-file project cost the same, because the cost is ECJ, not
  the code.

**Call `load()` early — while the student is reading the lesson.** It is
idempotent, concurrent calls share one boot, and calling it when already warm
resolves immediately. `run()` calls it internally if needed, so the only reason
to call it yourself is to show progress. Not pre-warming means the student's
first Run costs 27 s cold / 11 s warm instead of ~4.5 s.

**`kill()` costs a full re-warm.** It is `worker.terminate()` (0–1 ms; it stops a
`while (true) {}` that no cooperative mechanism could touch), the session ends
with `onExit(null)`, and a replacement worker starts booting immediately. The
next `run()` waits for whatever is left of that boot *and* a fresh compiler
warm-up — **12.5–12.7 s to a finished run** if Run is pressed at once, versus
4.4 s if the student spends ~14 s thinking first, because the respawn overlaps
their thinking. Two consequences:

- Keep Run disabled until your `run()` promise resolves; a second call in that
  window is rejected with `A Java program is already running; kill() it before
  running another.` (Verified, including two `run()` calls issued in the same tick
  during a cold boot — the second is refused rather than silently corrupting the
  first run's session.)
- Show progress during the re-warm by calling `load(onProgress)` again — it
  attaches to the in-flight respawn and replays its latest message. Without that
  the UI looks frozen for ~12 s after a Stop.

**`dispose()` is not `kill()`.** `kill()` respawns, because the student is
expected to press Run again. `dispose()` reports a live session as
`onExit(null)`, terminates the worker and starts **nothing** — use it when the
page is closing or the shell switches to Python, or you leave a fresh JVM booting
behind a runtime nobody is using. A later `load()`/`run()` boots again from
scratch (verified: 7.3 s, then a normal run).

**Output arrives per Java write, not per line, and is never buffered.**
`System.out.print("Name: ")` with no newline reaches `onStdout` *before* the
following `nextLine()` blocks — verified with real typed input for `nextLine()`,
`nextInt()`, and a line assembled from three separate `print` calls. This is a
property of our stream implementation, not of CheerpJ: `PrintStream`'s autoflush
only fires on a newline, so anyone who later wraps stdout in a
`BufferedOutputStream` for throughput **must** keep an unbuffered path or flush
before every blocking read, or students start typing blind. The harness asserts
this in four places; keep those tests.

Because there is no buffering, one `println` is **two** `onStdout` calls (the text,
then the line separator) and one `postMessage` each: 2000 `println` produced 4000
callbacks. **Coalesce in the console component** — accumulate chunks and paint on
`requestAnimationFrame`. There is no output cap, unlike the Python runtime's
2 MiB limit, so a runaway `while (true) System.out.println(…)` keeps posting until
Stop; the console must not do per-chunk DOM work.

**Echo submitted input yourself, at the cursor.** CheerpJ has no tty, so nothing
echoes what the student typed; without help the transcript reads
`Your name: Hello, Warsha!` with the input missing. Write the line into the
console at the current position the moment the user submits it, in its own span.
This is a UI decision, and it must be suppressible for any exercise that reads
input the program means to hide (a password prompt would otherwise be echoed).

**A blocked read waits; it never sees a spurious EOF.** The only EOF path is the
extra `session.writeEof()` (not part of the contract — use it if you add an EOF
button). `writeStdin` outside a pending read is ignored — verified by sending two
lines at one prompt: the program consumed the first and stayed blocked at the
next prompt rather than eating the second — and the queue is cleared between runs,
so nothing a student typed at the end of one program can be read by the next.

**Compile errors** arrive on `onStderr` in ECJ's format, with paths rewritten to
the student's own file names and line numbers and carets intact:

```
----------
1. ERROR in models/Broken.java (at line 7)
        return n * 2
                   ^
Syntax error, insert ";" to complete BlockStatements
----------
1 problem (1 error)
```

The session then ends with `onExit(1)` and **nothing runs**. No `/files/` or
`/str/` path ever appears (asserted). The `----------` separators are ECJ's own;
they are left in place rather than reformatted, so what the student sees is what
the compiler said. If Education wants them gone, that is a display-layer change.

**Runtime exceptions have NO line numbers. This is the runtime's worst
limitation and it cannot be fixed from our side.** CheerpJ's stack walker
reports `getFileName() == null` and `getLineNumber() == 0` for every frame,
regardless of `-g`. Implicit exception messages are missing too — a real JVM says
`ArithmeticException: / by zero`, CheerpJ gives a null message. The rendering,
verified verbatim for a divide-by-zero two student frames deep:

```
java.lang.ArithmeticException
	at models.Calculator.divide (line unknown)
	at app.Crash.main (line unknown)
```

Frames are filtered **in Java**, where they are still structured objects rather
than text: `warsha.*`, `sun.reflect.*`, `jdk.internal.reflect.*` and
`java.lang.reflect.*` are dropped, then everything below the deepest student
frame. Platform frames *above* student code survive, because
`at java.lang.Integer.parseInt` is the useful half of a bad-input crash. Cause
chains are rendered with `Caused by:` and the same filter. For a beginner, "your
program crashed somewhere in `divide`" is still a poor experience — **this should
be raised with Product**, since no compiler flag fixes it.

**CheerpJ's "JIT failure" noise never reaches the student.** ECJ's parser has one
generated method CheerpJ's JIT refuses, so it logs two alarming lines on *every*
compile (40 of 72 console lines in one self-test run were this noise). Program
output and compiler diagnostics travel on their own channels (Bridge natives), so
console text is structurally incapable of reaching the student's pane; it is
forwarded to the optional `onInternalLog` callback instead. The harness asserts
both that the noise occurs and that it stays out of the output, so the protection
cannot silently rot.

**Java 8 only.** CheerpJ's runtime reports `1.8.0`, so `var` (Java 10+), records,
switch expressions, text blocks and `List.of` are **compile errors** — confirmed
by compiling `var name = "…";`, which fails with `var cannot be resolved to a
type` at the right line in the student's own file. Course content must stay within
Java 8. ECJ 3.26.0 is pinned because it is the last release whose own class files
are Java 8; moving to `cheerpjInit({version: 11})` would need a newer ECJ and
full re-testing.

**Each run gets a fresh output directory.** `/files/` is IndexedDB-backed and
persists across sessions, so a stale `.class` could otherwise make a broken
project look like it still runs. Every run compiles into
`/files/warsha-run-<runId>/out/` and older run directories are deleted — verified
working, not assumed (the harness asserts `deleted>0 failed=0`, and 16 cleanup
reports in one suite run were all `failed=0`). Editing a file between runs takes
effect; a file removed from the set is really gone.

**Student code shares a classpath with `warsha.*`.** A student could call
`warsha.Bridge` directly and spoof a status or read another run's output.
Irrelevant for a teaching tool, noted so nobody is surprised.

**A student's `System.exit(3)` is handled.** It surfaces as `onExit(3)`, and
because the shared JVM went with it the worker is marked tainted and replaced
before the next run — verified end to end, including a further interactive run
afterwards.

**Not tested on an iPad.** Risks in order: **memory** (a WASM JVM plus ECJ in a
WebKit tab, and Safari kills tabs readily; peak usage was never measured);
**compile times**, 3.5 s warm and up to 20 s cold here and likely worse there,
which changes the product's feel; and **IndexedDB eviction** on iOS for sites not
installed to the home screen — treat `/files/` as a cache, never as the only copy
of a student's work. No `SharedArrayBuffer` is needed, so that is one fewer
constraint than Python has.

## Deviations from the spike (§9 of [`docs/engineering/java-runtime-spike.md`](../../docs/engineering/java-runtime-spike.md)), and why

**§9.2 said ship a prebuilt `warsha-bootstrap.jar`. This module compiles the
bootstrap in-browser on every `load()` instead.** Reasons: (a) `*.jar` is
gitignored repo-wide, so a prebuilt jar would need either an exception or a JDK
in the build pipeline, and a static-site CI has no JDK; (b) the first ECJ compile
of a session costs seconds *whatever* it compiles, because the cost is ECJ loading
its own classes over the virtual filesystem — so compiling something we actually
need is strictly better than the dummy compile §9.3 recommends for warm-up;
(c) caching the `.class` files in IndexedDB with a version stamp was considered
and rejected as a correctness hazard (a stale-stamp bug would be very hard to
diagnose) that buys nothing, since the warm-up has to happen anyway. Net effect:
one `load()`, one compile, no jar, no cache invalidation. The price is paid in the
loading screen: this is why a warm start is not silent, and why the cold figure is
19.8 s rather than a fast cache hit. `validate.sh` compiles the same sources
offline with `javac --release 8 -Werror` so mistakes are caught before the browser.

**§9.2 said stage sources into package-shaped directories. This module preserves
the student's own directory layout instead.** The problem being solved is the
same — `/str/` is a flat namespace, so `app/Item.java` and `models/Item.java`
cannot both be written there — but the compiler only requires that a *public
class match its file name*, not that directories match packages. Mirroring the
student's tree under `/files/warsha-run-<id>/src/` fixes the collision **and**
makes ECJ report the student's exact relative path, so diagnostics need only a
prefix strip rather than a package-to-path mapping that would be wrong whenever a
file's directory and `package` disagree. Verified: two `Item` classes in two
packages compile and run as distinct classes.

**§5 said the compiler's diagnostics need console scraping. This module uses
ECJ's programmatic entry point.** `BatchCompiler.compile(String[], PrintWriter,
PrintWriter, CompilationProgress)` writes into writers we own, so diagnostics
never touch the JS console and the console hook is no longer load-bearing for
correctness. ECJ writes problems to the **err** writer (measured: out 0 bytes,
err 260 bytes on a type error); `validate.sh` pins that so an ECJ upgrade that
changed the channel would fail offline rather than silently blank every
diagnostic.

**Nothing calls `System.exit`.** One CheerpJ JVM serves every run in a session,
so an exit in our bootstrap would strand all later runs. `Bridge.phaseDone`
reports status through a native instead.

**§9.3's "compile only changed files" is NOT implemented.** Every run compiles
the whole project. With warm compiles at ~3.5 s for a small project the saving is
small, and incremental compilation against a persistent output directory
reintroduces exactly the stale-class hazard the per-run directory exists to
eliminate. Worth revisiting only if real projects get big enough for it to
matter; it should come with a test that a deleted file cannot resurrect.

**Stack-trace filtering happens in Java, not by regex on text** (§8.2 described
the rule, not the location). `StackTraceElement.getClassName()` is exact, where a
regex over rendered text would be fooled by a student class named
`ReflectionDemo`.

## Running the harness

```
cd runtimes/java
./fetch-compiler.sh      # once; ecj.jar is never committed
node build.mjs
node serve.mjs 8085      # http://localhost:8085/harness/  (HTTP Range supported)
node serve.mjs 8085 --coi   # same, plus COOP/COEP -- see §4
```

`node build.mjs` needs esbuild; it finds the copy in `runtimes/python/node_modules`
if `runtimes/java` has no `node_modules` of its own.

"Run self-test (all scenarios)" runs **43 assertions** covering: the committed
`content/templates/java-oop` verbatim including its `Scanner` read; prompt-then-read
three times including `nextInt()` and a line built from three `print` calls; the
same class name in two packages; a compile error in a nested file (path, line,
caret, nothing runs); an uncaught exception two student frames deep (filtered
trace, no JIT noise, and proof the noise occurred); infinite loop → kill → run
again; `System.exit(3)` → recovery; and per-run directory cleanup.
The harness self-test last showed 43/43 (screenshot evidence is no longer
committed; run the harness to reproduce it); the same
43/43 was reproduced twice on Chrome 151/Windows during the verification
described above — once before and once after the two fixes noted in §5 and in
"Behaviour notes" — along with hand-typed runs of the template and the prompt
scenario.
`window.harness` exposes the same API for scripted checks.

Other checks worth keeping:

```
./validate.sh          # compiles the bootstrap with javac --release 8 -Werror + 28 self-tests
npm run check          # node --check on the worker, generated-file freshness, bootstrap compile
npm run typecheck      # tsc -p tsconfig.json
```

`npm run check` fails if `src/bootstrap.generated.ts` is stale — the `.java` files
under `src/bootstrap/` are the source of truth and the generated `.ts` is
committed so the app needs no build step.
