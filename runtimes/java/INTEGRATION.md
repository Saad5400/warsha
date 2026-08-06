# Integrating the Java runtime into the app

`runtimes/java` is the production Java engine for Warsha: CheerpJ 4.3 (a WASM
**Java 17** JVM) plus ECJ 3.46.0 as the compiler, in a **classic** Web Worker,
implementing the app's `Runtime` contract. No server; the app's bundler consumes
the TypeScript source directly. Two assets are produced at build time and never
committed: `ecj.jar` (fetched) and `warsha-boot.jar` (compiled — this one needs
a JDK 17+ on the build machine, see §"2026-08-06: Java 17").

## 2026-08-06: Java 17

Warsha ran on Java 8 until this date, because that is CheerpJ's default and
because "just pass `version: 17`" does not work. What it takes, and what it
costs, in full:

**CheerpJ ships a JRE, not a JDK.** There is no `jdk.compiler` in any of its
images — `com.sun.tools.javac.Main` is absent and
`ToolProvider.getSystemJavaCompiler()` returns `null` — which is why Warsha
carries ECJ at all. On Java 8 that was the end of it: ECJ read the platform out
of `rt.jar`, an ordinary zip.

**On Java 9+ the platform is a packed module image, and ECJ cannot open it
here.** Two checks fail, each in a different layer:

1. `org.eclipse.jdt.internal.compiler.util.Jdk` identifies a JDK by reading
   `<java.home>/release`. CheerpJ has no `release` file → ECJ reports
   `invalid location for system libraries: /lt/17` before compiling a line.
2. The JDK's *own* `JrtFileSystemProvider` demands `<java.home>/lib/jrt-fs.jar`
   whenever handed a `java.home` other than the running JVM's — exactly what
   ECJ hands it. CheerpJ has no `jrt-fs.jar` → `IOException: /lt/17/lib/jrt-fs.jar
   not exist`.

`/lt/` is read-only, so neither file can be supplied where it is wanted. The
running JVM's own image, however, opens with no `jrt-fs.jar` at all
(`FileSystems.getFileSystem("jrt:/")` → 50 modules, ~20 000 classes). So
[`bootstrap/Platform.java`](src/bootstrap/Platform.java) builds a `java.home`
under `/files/` containing only a `release` file, points ECJ at it with
`--system`, and pre-seeds `JRTUtil.JRT_FILE_SYSTEMS` for that path with the
running image — so the provider call that wants `jrt-fs.jar` is never made.
Stock, unmodified ECJ then compiles at `-17`.

**The bootstrap had to stop being compiled in the browser.** `Platform.prepare()`
must run inside the same JVM invocation as the compile, and every
`cheerpjRunMain` gets a fresh classloader — so there was no invocation left in
which our code could prepare anything before ECJ's own `main` ran. The
`warsha.*` classes therefore ship prebuilt in `warsha-boot.jar`
([`build-bootstrap.sh`](build-bootstrap.sh), `javac --release 17 -Werror`), and
the whole IndexedDB stamp cache that existed to avoid that compile is deleted
along with it. A **jar**, not a directory of `.class` files: `/app/` is the web
server over HTTP, HTTP has no directory listing, and a directory classpath entry
resolves nothing (measured: `ClassNotFoundException` for a class that was
definitely being served).

**What it costs and what it buys.** Same rig, same QA suite, Java 8 → Java 17:

| `tools/qa/verify-java.mjs` | Java 8 | Java 17 |
|---|---|---|
| Cold first visit: Run → prompt | 16.1 s | 24.0 s |
| Warm reload → Run | 7.5 s | 21.8 s |
| Run after Stop/kill | 3.8 s | 17.8 s |
| **Second run, same session** | **0.1 s** | **0.1 s** |
| Compile error round-trip | — | 1.8 s |

Execution throughput is *better* on 17 (collections roughly 1.7× faster,
strings faster, arithmetic level) and the engine download is smaller (13.6 MB
against Java 8's 18.7 MB). The regression is entirely the **first compile of a
session**, and it is paid once per JVM — repeat runs are unchanged.

### Where the first compile actually goes (measured 2026-08-06)

The first explanation written here was wrong, and it is worth recording why:
the guess was that a modular runtime reads every platform type out of the
packed image on first touch. A probe (`runtimes/java/probe/`, throwaway) took
that apart in the browser and it is not true.

| phase, fresh JVM | ms |
| --- | --- |
| `cheerpjInit` | 600 |
| open `jrt:/` | 300 |
| read 150 `java.util` class files from the image | 216 |
| read the same 150 again | 73 |
| **full walk of `/modules`** (20 963 files, 50 modules) | **760** |
| **ECJ's own `ClasspathJrt.initialize()`** | **790** |
| `Platform.prepare()` — a 21-byte write into `/files/` | 1 150 |
| loading 10 named ECJ classes (`Parser` alone: 1 380) | 4 900 |
| first `BatchCompiler.compile` of `class Tiny {}`, after all of the above | 5 200 |
| second compile, a real Scanner + collections program | 1 900 |
| third compile, same program | 250 |

The module image is under a second, end to end. Raw reads out of it run at
~1.4 ms per class file. What costs 12 s is **CheerpJ 17 loading and preparing
ECJ's own classes** — the same compiler bytes cost 3.1 s on CheerpJ 8 and 2.2 s
on CheerpJ 11 (identical ECJ 3.26.0 jar, ten `Class.forName` calls, no compile).
Java 17's runtime is simply ~2× slower at this than Java 8's and ~3× slower
than Java 11's, and it is the dominant term.

Two consequences follow, and both are load-bearing:

- **`ct.sym` is not the lever.** It was written up here as the next thing to
  try; it would replace ~800 ms of module-image work with zip reads and change
  nothing about the 12 s. Dropped.
- **Trimming `ecj.jar` is not the lever either.** The JVM loads classes lazily,
  so classes a compile never touches already cost nothing.

The cost is irreducible *per JVM*, which means the only real fix is to stop
paying it per JVM. Three changes do that, and together they take a page refresh
followed by Run from ~20 s to **0.8 s**:

- **The compile-reuse cache now outlives the JVM.** `Build` writes the project
  hash into the run directory it just built (`key.txt`), and `gcOldRuns` already
  leaves exactly one of those behind, so the first Run of a fresh JVM adopts it.
  An unchanged project is launched without ECJ being loaded at all. The key is
  only ever trusted as far as `projectKey()` agrees with it, so a stale one
  costs a compile and can never run the wrong classes.
- **The warm-up yields to a real Run.** Commands are serialised inside the JVM,
  so a warm-up already in flight made the student wait out all ~12 s of it. It
  is now scheduled 1.2 s after boot and cancelled outright if a Run arrives
  first — and re-scheduled after that run finishes, so the next *edit* still
  gets a warm compiler.
- **`Platform` writes its `release` file once ever, not once per JVM.** `/files/`
  is IndexedDB and survives both a reload and a Stop, so every visit after the
  first is one existence check instead of a 1.1–1.4 s create.

Serving that `release` file as a static asset under `/app/` was tried and
reverted: ECJ also probes `<java.home>/lib/ext` and `lib/endorsed`, and any host
with an SPA fallback answers 200 for those, so CheerpJ logged *"HTTP server does
not support the 'Range' header. CheerpJ cannot run."* twice per compile.
IndexedDB knows exactly what exists and stays silent.

The rest of it is `jvm.worker.js`'s background warm-up, which is why
`WARM_SOURCE` there is not an empty class: it references `Scanner`, the
collections, `String.format`, boxing and an exception, because warming an empty
class left a three-file Scanner program still paying nearly the whole bill.
After the warm-up completes a student's first compile is ~2.5 s; the exposure is
a student who presses Run before it finishes.

**The remaining lever, not yet built:** split the compiler and the student's
program into two workers. Stop is `worker.terminate()` — the only kill CheerpJ
has — so today it throws away the warm ECJ along with the runaway loop, and the
next Run pays the full ~15 s again. A runner worker never loads ECJ, so killing
one costs a `cheerpjInit` (~0.6 s) instead. The handoff is already proven to
work: a second CheerpJ JVM in a second worker sees files the first wrote to
`/files/`, live, with no reopen, including binary payloads (verified
2026-08-06). The cost is two resident JVMs, which is a real question on a phone.

**Pins that are now load-bearing.** ECJ 3.46.0 is pinned by sha256 in
`fetch-compiler.sh` because `JRT_FILE_SYSTEMS` is a private static field that
exists in the 3.4x series and not earlier (3.33 has no such field);
`Platform.prepare()` throws a named error rather than degrading if it is gone.
`build-bootstrap.sh` needs a JDK 17+ (the Dockerfile installs
`default-jdk-headless`), and `warsha-boot.jar`'s bytecode target must match
CheerpJ's runtime version.

## 2026-08-06: the resident Server + persistent bootstrap cache

The engine was reworked for speed; **timings quoted in later sections predate
this and are kept as history** — the current numbers are in this section. Three
findings drove it, all measured on 2026-08-05/06 (Chrome 150 headless/Linux,
`dist/` on localhost):

1. **Every `cheerpjRunMain` call gets a fresh classloader** (a static set in
   one call reads `false` in the next). The old one-main-per-phase design
   therefore reloaded ECJ and re-paid its warm-up on *every* compile — the
   "warm" 2.0–3.5 s student compile was ~1.7 s of reloading ECJ. This also
   falsifies the old §9.2 rationale that the bootstrap compile "doubles as the
   warm-up": it warmed a classloader that no later compile ever saw.
2. `/files/` (IndexedDB) persists across page loads, so the in-browser
   bootstrap compile — 5–10 s on *every* load — only ever needed to happen
   once per device per deploy.
3. The run phase itself was ~0.4 s of reloading `warsha.*` + student classes
   through yet another fresh main.

What changed (`jvm.worker.js`, `bootstrap/Server.java`, `Build.java`,
`Launcher.java`, `Stamp.java`) — note the bootstrap cache described here was
**removed on the same day** by the Java 17 work above; the resident Server and
the compile-reuse cache are still current:

- **One resident main, `warsha.Server`**, started once per worker, parks on the
  async `Bridge.nextCommand` native and handles every run as a command:
  `Build.buildOrReuse` → `Launcher.launch` (a fresh `URLClassLoader` over the
  run's `out/`, so runs still can never see each other's classes). ECJ loads
  once per session and stays JIT-warm.
- ~~**Starting Server IS the bootstrap-cache probe.**~~ **Superseded.** The
  bootstrap is no longer compiled in the browser at all, so there is nothing to
  cache and no stamp: `warsha-boot.jar` ships prebuilt and Server starts from
  it. `Stamp.java` is deleted. See the Java 17 section for why the in-browser
  compile could not survive the move.
- **Unchanged sources skip ECJ entirely**: `Build.buildOrReuse` hashes the
  staged project (entry + every path + content, order-normalized) and relaunches
  the previous run's output when it matches the last successful compile of this
  JVM. Any edit/add/delete misses and takes the full fresh-directory path, so
  the stale-class guarantees are unchanged.
- **The ECJ warm-up runs in the background** after `ready` (a throwaway
  compile through the same resident path), serialized on the command queue, so
  a Run pressed immediately queues behind it — never worse than the old design,
  and free whenever the student spends a few seconds reading first.
- **The app pre-warms silently** (`App.tsx`): when the entry file is Java,
  `load()` is called ~1.5 s after hydration with a no-op progress listener.

Current numbers (same rig; the user-visible steps are Run click → first
`Scanner` prompt in the real app):

| Step | Before | Now |
|---|---|---|
| `load()`, first visit ever (nothing cached) | 7.8 s | ~8.4 s (unchanged: bootstrap compile + stamp probe) |
| `load()` on a revisit (bootstrap cached) | 4.8 s | **0.9 s** |
| Student compile, warm | 2.0–2.3 s | **0.2–0.5 s** |
| Run phase of a non-interactive program | ~0.4 s | **~10 ms** |
| In-app: re-run, same session | 2.6 s | **0.0–0.1 s** (unchanged sources: no compile at all) |
| In-app: reload → Run immediately | 7.4–7.6 s | **~4.1 s** (queued behind the background warm-up) |
| In-app: reload → a few seconds of reading → Run | 7.4–7.6 s | **0.6 s** |
| In-app: kill() → Run at once → finished run | 4.2–5.1 s | **0.8 s** |
| First visit ever: Run → prompt | 18.9 s | ~12 s (one-time per device per deploy) |

Progress-phase consequences: a revisit emits **no progress events at all**
(boot and the Server probe finish under the 250 ms announce gate), and the
`compile` phase now fires only on a cache miss — see the phase table below,
which has been updated. The harness self-test is 51/51 as of this rework; check
5j (JIT-noise filter proof) is session-scoped now that ECJ's refused parser
method loads once per session instead of once per compile.

Cache correctness: the stamp changes with any bootstrap source byte, the jar
path or the CDN base (`STAMP_SCHEMA` bumps it by hand if ever needed), so a
deploy invalidates cleanly; an interrupted cache write fails Server's
force-load-and-check and recompiles; `validate.sh` still compiles the same
sources offline with `javac --release 17 -Werror`.

```
runtimes/java/
  src/index.ts              <- the only import the shell needs
  src/javaRuntime.ts        JavaRuntime (implements Runtime)
  src/types.ts              mirror of app/src/runtime/types.ts
  src/jvm.worker.js         the CheerpJ worker (plain JS, and CLASSIC -- see §2)
  src/bootstrap/*.java      Bridge / Build / Launcher / Platform / Server / Traces, run inside the JVM
  fetch-compiler.sh         downloads + sha256-verifies ecj.jar
  build-bootstrap.sh        compiles the bootstrap into warsha-boot.jar (needs a JDK)
  validate.sh               offline gate: compiles the bootstrap, self-tests
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

`fetch-compiler.sh [dest]` downloads ECJ 3.46.0 from Maven Central and verifies
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
| First visit ever (nothing cached anywhere) | all three: `download` (with bytes), `boot`, `compile` |
| Revisit (engine in HTTP cache, bootstrap classes in IndexedDB) | **none** — boot and the Server probe finish under the gate |
| Revisit with IndexedDB cleared but the HTTP cache alive | **exactly one**: `compile` |
| `load()` called when the runtime is already booted | none; resolves immediately |

`download` and `boot` are announced only if they last longer than 250 ms, so a
cache hit stays silent instead of flashing a bar. The `compile` phase is
deliberately **never** gated, because when it fires at all (bootstrap-cache miss:
first visit, new deploy, evicted IndexedDB) it always costs seconds. Budget a
spinner or elapsed timer for it, and do not treat "no progress events" as
anything but a cached engine.

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

**Measured timings** (Chrome 151/Windows, LAN-served, busy machine — a floor).
**HISTORICAL: pre-rework numbers**; see "2026-08-06" at the top for current ones:

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
which is what dropping the LAN latency on CheerpJ's many Range requests buys.
**Also HISTORICAL — pre-rework:**

| In-app step | Measured |
|---|---|
| Cold: Run click → first `Scanner` prompt | **10.7–13.6 s** |
| Second run in the same session → first prompt | **2.6–2.8 s** (no progress block at all) |
| Warm reload (engine cached, fresh worker) → output | **7.4–7.6 s** |
| Student compile error → diagnostics on screen | **3.3 s** |
| `kill()`, Run pressed at once → finished run | **4.2–5.1 s** |
| Python cold in the same session, after Java | **2.1–2.6 s** |
| Java again after Python ran | **2.5–2.7 s** |

The dominant cost was ECJ, not the download and not the student's code. Two
readings of that (historical) table changed with the 2026-08-06 rework:

- **The bootstrap compile used to be the whole loading experience** (~7–10 s
  warm, 19.8 s cold). It is now a cache-miss event: first visit, new deploy, or
  evicted IndexedDB. When it fires it still costs the same seconds, so the
  loading screen must still be designed for it — it just no longer fires on
  every load.
- **Student compiles were stable at ~3.5 s** whatever the project, because the
  cost was reloading ECJ per compile, not the code. Resident-server compiles
  are 0.2–0.5 s, and an unchanged project skips the compile entirely.

**Call `load()` early — while the student is reading the lesson.** It is
idempotent, concurrent calls share one boot, and calling it when already warm
resolves immediately. `run()` calls it internally if needed. The app now does
this itself (`App.tsx` pre-warms silently ~1.5 s after hydration when the entry
is Java), which is what turns a reload-then-Run from ~4 s into ~0.6 s: the boot
and the background ECJ warm-up overlap the student's reading time.

**`kill()` costs a re-warm — now a cheap one.** It is `worker.terminate()`
(0–1 ms; it stops a `while (true) {}` that no cooperative mechanism could
touch), the session ends with `onExit(null)`, and a replacement worker starts
booting immediately. The replacement hits the bootstrap cache, so a Run pressed
at once finished in **0.8 s** measured in-app (it was 12.5 s when the respawn
recompiled the bootstrap). Two consequences:

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

**Uncaught exceptions read exactly as they do in a terminal — except for the
line number, which CheerpJ cannot give us.** The output is byte-for-byte what
`java` prints for classes carrying a `SourceFile` attribute and no line table
(`javac -g:source`), which has been diffed against a real JDK. A divide by zero
two student frames deep, verbatim:

```
Exception in thread "main" java.lang.ArithmeticException: / by zero
	at models.Calculator.divide(Calculator.java)
	at app.Crash.main(Crash.java)
```

Two things have to be reconstructed to get there, because CheerpJ withholds
both regardless of `-g` — measured directly, not read anywhere:

| Withheld | Rebuilt by | How |
| --- | --- | --- |
| `getFileName() == null` on every frame | `warsha.Traces` | `warsha.Build` indexes every **top-level type** in the project against the file it was declared in (`classes.tsv`), so `models.Shape` declared inside `Shapes.java` reports `(Shapes.java)` — which no simple-name guess could get right. Inner, local, anonymous and lambda classes resolve through the name before the first `$`. Anything not in the index (JDK frames above student code) falls back to `<SimpleName>.java`, which is what javac would have recorded for it anyway. |
| `getMessage() == null` on implicit exceptions | `warsha.Traces.restoredMessage` | **One rule only.** A message-less `ArithmeticException` becomes `/ by zero` — the VM throws that bare for integer `/` and `%` and nothing else, and real java says `/ by zero` for both. The class is matched exactly, so a student's own `extends ArithmeticException` is untouched. Every other missing message stays missing: a bare `NullPointerException` is what every JVM before 14 printed, and inventing text would be worse than authentic. Explicitly thrown messages survive CheerpJ untouched and are never rewritten. |

`getLineNumber() == 0` is **not** worked around. There is no `(line unknown)`
and no apologetic `(Unknown Source)`; a frame simply ends at the file name,
which is a shape real java produces. Recovering true line numbers would need
bytecode instrumentation — see ROADMAP; it is a v0.2 investigation, not a
compiler flag we are missing.

Frames are filtered **in Java**, where they are still structured objects rather
than text: `warsha.*`, `sun.reflect.*`, `jdk.internal.reflect.*` and
`java.lang.reflect.*` are dropped, then everything below the deepest student
frame. Platform frames *above* student code survive, because
`at java.lang.Integer.parseInt` is the useful half of a bad-input crash.

Cause chains, suppressed exceptions and the `... N more` collapsing follow
`Throwable.printStackTrace` step for step, over the filtered traces:

```
Exception in thread "main" java.lang.IllegalStateException: could not place order 7
	at app.Order.place(Order.java)
	at app.Order.main(Order.java)
Caused by: java.lang.IllegalArgumentException: no order with id 7
	at models.Repo.find(Repo.java)
	... 2 more
```

An exception on a thread the student started reports that thread's real name
(`Exception in thread "Thread-0" …`), through a default
`UncaughtExceptionHandler` the launcher installs. The main thread is always
called `main`, hardcoded — CheerpJ runs `cheerpjRunMain` on a thread of its own
naming, and no student should be shown that.

**None of this is JS string-munging.** `javaRuntime.ts` passes the stderr
channel through untouched; rewriting only ever happens on the separate `diag`
channel, for compiler paths. Both the harness and `tools/qa/verify-java.mjs`
assert the whole block as **one exact string**, because the previous rendering
drifted into something no JVM has ever printed while every individual
substring assertion still passed.

**CheerpJ's "JIT failure" noise never reaches the student.** ECJ's parser has one
generated method CheerpJ's JIT refuses, so it logs two alarming lines on *every*
compile (40 of 72 console lines in one self-test run were this noise). Program
output and compiler diagnostics travel on their own channels (Bridge natives), so
console text is structurally incapable of reaching the student's pane; it is
forwarded to the optional `onInternalLog` callback instead. The harness asserts
both that the noise occurs and that it stays out of the output, so the protection
cannot silently rot.

**Java 17.** CheerpJ's runtime reports `17.0.19-internal`. `var`, records,
sealed types, `instanceof` pattern matching, switch expressions, text blocks and
`List.of` all compile and run — asserted by the harness's `java17` scenario and
proven in-app. Pattern matching *in switch* is Java 21 and is correctly rejected.
ECJ 3.46.0 is pinned by sha256 because `Platform.java` depends on an internal of
the 3.4x series; see the Java 17 section at the top.

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
bootstrap in-browser — since 2026-08-06, once per device per deploy, cached in
`/files/warsha/` thereafter.** The original reasons to compile in-browser on
*every* `load()` were: (a) `*.jar` is gitignored repo-wide, so a prebuilt jar
would need either an exception or a JDK in the build pipeline — **this is the
one that gave way**: Java 17 made the in-browser compile impossible, so the
Dockerfile now installs a JDK and `build-bootstrap.sh` produces
`warsha-boot.jar` (still gitignored, built rather than committed); (b) the
bootstrap compile
"doubles as the compiler warm-up" — **falsified**: each `cheerpjRunMain` gets a
fresh classloader, so the warmed ECJ was thrown away before any student compile
ever ran; (c) an IndexedDB class cache with a version stamp is a stale-stamp
hazard — moot now that there is no class cache at all. See "2026-08-06" at the
top. `validate.sh` still compiles the same sources offline with
`javac --release 17 -Werror` so mistakes are caught before the browser.

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

**§9.3's "compile only changed files" is still NOT implemented — but
"compile nothing when NOTHING changed" is (2026-08-06).** Per-file incremental
compilation against a persistent output directory reintroduces exactly the
stale-class hazard the per-run directory exists to eliminate (a dependent class
compiled against a signature that no longer exists), and with resident-server
compiles at 0.2–0.5 s the saving would be noise. The all-or-nothing reuse in
`Build.buildOrReuse` has no such hazard: it only ever relaunches the *complete*
output of the last successful compile, keyed on an exact hash of the entry plus
every path and content, and any difference — including a deleted file — misses
the cache and rebuilds into a fresh directory, so a deleted file cannot
resurrect.

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

"Run self-test (all scenarios)" runs **51 assertions** covering: the committed
`content/templates/java-oop` verbatim including its `Scanner` read; prompt-then-read
three times including `nextInt()` and a line built from three `print` calls; the
same class name in two packages; a compile error in a nested file (path, line,
caret, nothing runs); an uncaught exception two student frames deep (filtered
trace, no JIT noise, and proof the noise occurred — session-scoped since the
resident Server loads ECJ's JIT-refused parser once per session, not once per
compile); infinite loop → kill → run again; `System.exit(3)` → recovery; and
per-run directory cleanup.
The harness self-test last showed 51/51, on Chrome 150 headless/Linux during the
2026-08-06 resident-server rework (run the harness to reproduce).
`window.harness` exposes the same API for scripted checks.

Other checks worth keeping:

```
./fetch-compiler.sh    # ecj.jar (needed by the two below)
./build-bootstrap.sh   # warsha-boot.jar -- needs a JDK 17+
./validate.sh          # compiles the bootstrap with javac --release 17 -Werror + self-tests
npm run check          # node --check on the worker, generated-file freshness
npm run typecheck      # tsc -p tsconfig.json
```

The `.java` files under `src/bootstrap/` are the source of truth; they are
compiled into `warsha-boot.jar` at build time, so a change to them needs
`./build-bootstrap.sh` re-run before the harness or the app will pick it up.
