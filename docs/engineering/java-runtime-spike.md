# Warsha Java-in-the-browser spike — CheerpJ 4.3

> **Historical record, kept for its findings.** This documents the throwaway
> prototype that established whether Java-in-the-browser was possible at all. The
> spike's own code lived in `spikes/java/` and has been deleted; references below to
> "the files in this directory" describe that removed prototype, not the shipping
> code. The production implementation it led to is
> [`runtimes/java/`](../../runtimes/java/), documented in
> [`runtimes/java/INTEGRATION.md`](../../runtimes/java/INTEGRATION.md), which
> supersedes this document wherever the two disagree.
>
> **One conclusion here is now wrong.** The licensing paragraph assumes Warsha would
> be a commercial multi-person product needing a paid CheerpJ license. Warsha shipped
> as a free Apache-2.0 open-source project, which falls under CheerpJ's Community
> License FOSS category instead. See
> [`docs/legal/THIRD-PARTY.md`](../legal/THIRD-PARTY.md) for the current analysis and
> the obligations that actually apply.

**Verdict: VIABLE-WITH-CAVEATS.** Multi-file Java (packages + inheritance across
packages) compiles and runs 100% client-side, with real interactive stdin and a
real kill switch. All three of Education's prompt-before-read criteria **pass**
(§5.1). Two caveats are serious enough to decide on before building:
**(1) licensing — Warsha is a commercial multi-person product, so this needs a
paid CheerpJ commercial licence, and self-hosting the runtime is forbidden
without one; (2) runtime exceptions carry no line numbers at all** (§8.2, with
the frame-filtering recipe Education asked for).

Everything below was measured in Chrome on Linux against the files in this
directory, not taken from documentation.

The compiler is **ECJ (Eclipse Compiler for Java) 3.26.0, EPL-2.0** — see §8.3.
The spike originally used a JDK `tools.jar` that turned out to be an Oracle build
(`Created-By: 1.8.0_131 (Oracle Corporation)`), which is not redistributable.
That file has been deleted and every acceptance test re-run on ECJ.

---

## 1. What was proven to work

Run `./fetch-compiler.sh` once, then `python3 serve.py 8081`, then open
<http://localhost:8081/index.html>.

| Requirement | Status | Mechanism |
|---|---|---|
| 3 files, 2 packages, `Student extends Person` | works | ECJ in the browser |
| Compile in browser | works | `cheerpjRunMain("org.eclipse.jdt.internal.compiler.batch.Main", ...)` |
| Run `app.Main`, stream stdout/stderr | works | `System.out`/`err` → JS natives → page |
| Interactive stdin mid-run (`Scanner`, 2+ lines) | works | async JS native blocks the JVM |
| Partial line (no `\n`) visible **before** read blocks | works | flush on every write (§5.1) |
| Blocking read never sees spurious EOF | works | verified blocked 6 s, no exception (§5.1) |
| Typed input echoable inline | works | page echoes it; CheerpJ has no tty (§5.1) |
| Stop/kill an infinite loop | works | `worker.terminate()` (0.5–0.8 ms) |

Observed output (screenshot: `spike-working.jpg`), proving cross-package
polymorphism and mid-execution stdin:

```
=== Warsha Java spike (worker) === build-token=WORKER-1
java.version = 1.8.0_492-internal
  -> Person Layla (41)
     instanceof Student? false
  -> Student Omar (20) majoring in Computer Science
     instanceof Student? true
Enter your name: Hello, Sara Al-Otaibi!          <- typed into the page mid-run
Enter your age: Created: Student Sara Al-Otaibi (19) majoring in Warsha 101
Superclass method getName() -> Sara Al-Otaibi
=== done, exit 0 ===
```

### Files

| File | Role |
|---|---|
| `index.html` | **the spike.** JVM in a Web Worker, real kill. |
| `jvm.worker.js` | worker: CheerpJ init, compiler invocation, stdin/stdout natives |
| `sources.js` | the hardcoded Java sources (student project + Warsha runtime) |
| `mainthread.html` | same flow without a worker — kept to demonstrate the freeze |
| `serve.py` | static server **with HTTP Range support** (required, see §7) |
| `fetch-compiler.sh` | downloads + checksums `ecj.jar` (EPL-2.0). **Run this first.** |
| `ecj.jar` | the compiler, 3.1 MB. Not committed — `*.jar` is gitignored. |
| `spike-prompt-test.jpg` | screenshot of the prompt-then-read acceptance run |

---

## 2. Exact versions

- Loader: `https://cjrtnc.leaningtech.com/4.3/loader.js` (CheerpJ **4.3**, current
  release as of 2026-07-30; it loads `cj3.js` + `cj3.wasm` from the same path).
- Java runtime: **Java 8** — `System.getProperty("java.version")` reports
  `1.8.0_492-internal`. This is `loader.js`'s default (`cj3InitOptions = {version:8}`).
  `cheerpjInit({version: 11})` / `17` are documented but **untested here**.
- Compiler: **ECJ 3.26.0**, `org.eclipse.jdt.internal.compiler.batch.Main`, from
  `/app/ecj.jar` (EPL-2.0, §8.3). A JDK `tools.jar` + `com.sun.tools.javac.Main`
  also works — that is what Leaning Technologies' own JavaFiddle does — but the
  readily available JDK 8 `tools.jar` builds are Oracle's and not redistributable.

---

## 3. Compile API (the part that matters)

The shape of the recipe comes from JavaFiddle's bundle (which uses javac); this is
the verified ECJ version:

```js
await cheerpjInit({ status: "none", natives: { /* see §5 */ } });

// sources into the JS->Java bridge filesystem
cheerpOSAddStringFile("/str/Main.java", new TextEncoder().encode(src));

// compile
const rc = await cheerpjRunMain(
  "org.eclipse.jdt.internal.compiler.batch.Main",  // ECJ batch compiler
  "/app/ecj.jar",                                  // classpath for ECJ itself
  "/str/Main.java", "/str/Person.java", "/str/Student.java",
  "-d", "/files/",       // output dir for .class files (must already exist, §4)
  "-g",                  // debug info (does not buy line numbers, §8.2)
  "-1.8",                // source/target level
  "-proc:none", "-nowarn"
);                       // 0 = success, non-zero = failure (ECJ uses -1, §8.3)

// run
const exit = await cheerpjRunMain("warsha.Launcher", "/files/", "app.Main");
```

Both calls return a real promise resolving to the process exit code. ECJ resolves
`java.*` automatically: `sun.boot.class.path` is populated by CheerpJ
(`/lt/8/jre/lib/rt.jar:...`), so no `-bootclasspath` is needed.

**Compiler diagnostics carry file, line and caret**, so they map straight back to
the editor (ECJ's format; see §8.3 for javac's). Getting hold of the text is
fiddly — see §5.

---

## 4. Virtual filesystem — the two constraints that shaped the design

| Mount | Java | JS | Persistent | Notes |
|---|---|---|---|---|
| `/app/` | read | read | no (HTTP) | maps to the web server root; **needs HTTP Range** |
| `/files/` | read+write | read via `cjFileBlob` only | yes (IndexedDB) | where `.class` files go |
| `/str/` | read only | write via `cheerpOSAddStringFile` | no | how sources get in |

Both `cheerpOSAddStringFile` and `cheerpjAddStringFile` exist in 4.3 and are
interchangeable; the docs use the former.

**Constraint 1 — `/str/` is a flat namespace.** `cheerpOSAddStringFile("/str/models/Person.java", ...)`
"succeeds" but Java cannot see the file: `javac: file not found: /str/models/Person.java`.
There are no directories under `/str/`. Sources must be written flat.
This is survivable because javac does not require sources to live in
package-shaped directories — only that the *basename* matches the public class
name. It breaks for a project with two same-named classes in different packages
(`app/Item.java` + `models/Item.java`), which is entirely plausible in a
teaching product.
*Production fix:* have a prebuilt Java bootstrap read the flat `/str/` files and
copy them into package-shaped directories under `/files/` (Java **can** mkdir
there), then compile from `/files/`.

**Constraint 2 — javac will not create its `-d` directory** (`javac: directory
not found: /files/t1`) and `/files/` is read-only from JS, so JS cannot mkdir it
either. Hence `-d /files/` (the root, which always exists); javac then creates
the package subdirectories itself. Since `/files/` is IndexedDB-backed and
persistent, `.class` files from previous sessions linger — a stale class can make
a broken project look like it still runs. **Production needs an explicit cleanup
step** (from Java, or a versioned output dir). During this spike freshness was
verified by changing a `build-token` string in the source and confirming the new
token appeared in the output.

---

## 5. stdin, stdout, stderr

### stdin — async JS natives, and they really do block the JVM

This was the biggest unknown: `cheerpjInit` has **no** stdin option, and the word
"stdin" does not appear anywhere in `cj3.js`. The mechanism that works:

1. Declare a native method in Java and use it to feed `System.setIn`, so student
   code keeps using plain `new Scanner(System.in)`:

```java
public static native String readLine();   // in warsha.Bridge
```

2. Implement it in JS, registered at init. **CheerpJ awaits the promise**, so the
   Java thread is genuinely parked — verified: the program printed
   `Enter your name:` and stopped there until a line was typed into the page.

```js
await cheerpjInit({ natives: {
  async Java_warsha_Bridge_readLine() { return await nextLineFromTheUI(); }  // null = EOF
}});
```

Naming is `Java_<fully_qualified_class_with_underscores>_<method>`; first arg is a
`lib` handle (`self` follows for instance methods), and JS/Java strings convert
automatically. No `SharedArrayBuffer`/`Atomics.wait` is needed — which matters,
because that would demand COOP/COEP headers a plain static host may not offer.

**Sharp edge that cost real debugging time:** overriding only `InputStream.read()`
is not enough. The default bulk `read(byte[],off,len)` keeps calling `read()`
until it has `len` bytes or hits EOF, so `Scanner`'s 1024-byte request asked the
user for lines forever and the program never advanced. `read(byte[],off,len)`
**must** be overridden to return only what is buffered (see `Bridge` in
`sources.js`).

### 5.1 `print` then `read` with no newline — Education's acceptance criteria

All three criteria **pass**, tested with `app.Prompt` ("Prompt-then-read test"
button) which does `System.out.print("Name: ")` immediately followed by
`sc.nextLine()`, three times, including a token read (`nextInt`) and an echo
built from three separate `print` calls. Screenshot: `spike-prompt-test.jpg`.

**(1) The partial line is on screen before the read blocks.** Asserted from an
ordered event timeline (`window.__timeline`), not by eye — the page records every
worker message in sequence:

```
{ kind: "out",          text: "Name: ", t: 49486.9 }   <- partial line, no \n
{ kind: "stdinRequest", text: "",       t: 49492.7 }   <- read blocks 5.8 ms later
```

The `out` chunk carrying `"Name: "` always precedes the `stdinRequest`, so the
student sees the prompt before typing. **This only works because
`NativeOut.write` flushes on every call.** The flush rule matters:

- `PrintStream` with `autoFlush=true` flushes on `println` and on newline bytes —
  **not** on `print("Name: ")`. Relying on autoflush alone means the prompt sits
  in the buffer until the *next* newline, which typically arrives *after* the
  read returns. Students would type blind. This is exactly the failure Education
  is worried about, and it is a property of our stream implementation, not of
  CheerpJ.
- So `NativeOut` calls the JS native on **every** `write(byte[],off,len)` and
  `write(int)`, with no buffering. Correctness over throughput; the cost is
  measured in §7 (one async native call per write).
- Practical consequence for any rewrite: if someone later wraps stdout in a
  `BufferedOutputStream` to speed up output-heavy programs (a reasonable idea),
  they **must** keep an unbuffered path or flush before every blocking read, or
  this acceptance test silently regresses. Worth an automated test.

**(2) A blocking read waits; it never sees EOF.** With no input pending, the
program stayed blocked for a full 6 s with zero new events, no
`NoSuchElementException`, and no progress past the read. EOF is only ever
produced when JS explicitly sends `null` (the "Send EOF" button), because
`Bridge.readLine()` returns `null` only then. There is no way for CheerpJ to
manufacture an end-of-stream on its own: `System.in` is our own `InputStream`,
and it blocks in the JS native until the UI resolves the promise. `nextInt()`
behaves the same as `nextLine()`.

**(3) Typed input is echoed inline — but the page must do it.** CheerpJ has no
tty, so nothing echoes what the user typed; without help the transcript reads
`Name: Hello, Sara!` with the actual input missing. `index.html` therefore echoes
each submitted line into the output pane itself (styled blue) as it is sent to
the worker. Result — a transcript indistinguishable from a terminal:

```
Name: Sara Al-Otaibi                 <- "Sara Al-Otaibi" echoed locally
[echo] you typed: Sara Al-Otaibi
Age: 19
[echo] age parsed as int: 19
City: Riyadh
[echo] Riyadh <- printed with three separate calls, no newline until here
PROMPT-TEST-OK Sara Al-Otaibi/19/Riyadh
```

**Caveat to design around:** local echo is a guess about what the program will
consume. It is correct for line-oriented `Scanner` use, which is all a beginner
course does. It would be wrong for a program that reads raw characters, echoes
selectively, or implements a password prompt — there Warsha would echo input the
program intended to hide. If we ever ship "hidden input" exercises, the echo must
become opt-out per exercise.

### stdout/stderr — two different mechanisms

- **With a DOM (`mainthread.html`):** CheerpJ writes `System.out`/`System.err`
  into an element with `id="console"`, appending text nodes. Undocumented, but
  it is what JavaFiddle relies on. No stream separation.
- **In a worker (no DOM):** that element cannot exist. Java-side redirection to
  natives works and is better anyway — it gives real `out`/`err` separation and
  prompt-accurate flushing:

```java
System.setOut(new PrintStream(new NativeOut(false), true, "UTF-8"));
```

Flush on *every* write, not just newlines, or `System.out.print("Enter name: ")`
prompts arrive late (`PrintStream` autoflush only triggers on newline). This is
load-bearing for Education's acceptance criteria — see §5.1.

- **The compiler's own output is a third case.** ECJ (like javac) runs via its own
  `main()`, so it never sees the redirected streams, and in a worker there is no
  `#console` either — CheerpJ falls back to the JS `console`. Compiler diagnostics
  are only visible because `jvm.worker.js` wraps `console.log/info/warn/error` and
  forwards them, filtering CheerpJ's own `JIT failure` noise out of the student's
  pane (§8.3). *Production fix:* call the compiler's programmatic entry point
  (`BatchCompiler.compile(args, out, err, progress)` for ECJ, or the JSR-199
  `JavaCompiler` + `DiagnosticListener`) from a prebuilt bootstrap class instead of
  going through `main()`; that yields structured diagnostics instead of scraped
  text and removes the console-hook hack entirely.

---

## 6. Kill / Stop

**`cheerpjInit` can only be called once per JS context** — a second call throws
`CheerpJ: Already initialized` — and the entire exposed API surface of
`loader.js` (`cheerpjRunMain/RunJar/RunLibrary/CreateDisplay/cjFileBlob/
cjGetRuntimeResources/cjGetProguardConfiguration/dumpMethod/dumpClass/
dumpAllThreads`) contains **no terminate, interrupt, or exit call**. There is no
cooperative kill either: a Java loop that performs no I/O never yields.

**Verified, not assumed:** in `mainthread.html`, `app.Loop` (`while(true) i++;`)
hard-freezes the tab. Even a purely synchronous `Runtime.evaluate` against that
tab timed out after 45 s — the renderer main thread is wedged, so the Stop
button can never be clicked and the tab has to be closed. (This test was run on
an isolated loopback origin so it could not take other tabs' renderer down with
it.)

**The fix is to host the JVM in a Web Worker**, which works fine in 4.3:

- `importScripts("https://cjrtnc.leaningtech.com/4.3/loader.js")` — it must be a
  **classic** worker. `loader.js` defines `cheerpjInit` inside an
  `if (!self.cj3LoaderPath) { ... }` block, which is only hoisted to global scope
  under sloppy-mode classic-script rules; in a module worker it stays
  block-scoped and `cheerpjInit` is invisible.
- `worker.terminate()` **killed the spinning JVM in 0.7 ms**, and respawning a
  fresh worker to `ready` took **54 ms** (runtime files are HTTP-cached). The UI
  thread stayed responsive throughout — a click handler ran in ~1 ms while the
  Java loop was spinning.

Limitations of this kill: it destroys the whole JVM, so anything in memory is
lost (fine — `.class` files live in IndexedDB) and the next run pays worker
re-init (~50-150 ms warm). `terminate()` cannot be refused, which is exactly what
a student IDE needs.

A caveat for the UI: a backgrounded Chrome tab throttles timers to roughly 1/s,
which stalls the liveness ticker in `index.html` and can look like a freeze. Only
read that ticker with the tab focused.

---

## 7. Measured performance (Chrome, Linux desktop, local server)

Cold = unvisited origin, empty HTTP cache partition. Warm = reload.

Compiler column: **ECJ** is the shipped choice; javac numbers are from the
original Oracle-`tools.jar` run, kept for comparison (§8.3).

| Phase | Cold | Warm |
|---|---|---|
| `cheerpjInit` in worker (spawn → ready) | 1122 ms (1416 ms) | 34–93 ms (48–145 ms) |
| First compile of the session, ECJ, 10 files | 10.7–11.6 s | 7.8 s |
| Later compiles in same session, ECJ | — | **4.0–6.4 s** |
| (javac, same 8-file workload, for comparison) | 11.8 s | 3.0–4.4 s |
| javac, 3 student files only, runtime prebuilt | — | **2.2–2.7 s** |
| Run `app.Main` / `app.Boom` (compute) | ~1.3 s | 0.77–0.90 s |
| "Compile & Run" click → first stdin prompt | 13.4 s | ~6 s |
| `worker.terminate()` → respawned & ready | — | **0.5–0.8 ms → 48–54 ms** |
| Output throughput (`println` via native) | — | 2000 lines in 203–614 ms = **101–307 µs/line** |

Output throughput varied 3x between runs on identical code (203 ms vs 614 ms for
2000 lines), presumably JIT state — treat 300 µs/line as the pessimistic figure.

Reading of this: **the first compile in a session costs ~11 s and is dominated by
the compiler loading its own classes over the virtual FS**, not by the student's
code. Two mitigations, both cheap:

1. **Pre-warm the compiler in the background at IDE startup** (compile a dummy
   file while the student is still typing). Every subsequent compile is then
   ~4-6 s with ECJ.
2. **Compile the 5 Warsha runtime classes once**, not on every run, and compile
   only the student's changed files against `-cp /files/`. Measured with javac:
   2.2-2.7 s versus 3.0-4.4 s for the full set. The same saving should apply to
   ECJ; not separately measured.

Also worth knowing: `/app/` **requires HTTP Range support**. Against
`python3 -m http.server` (no Range) CheerpJ logs
`Network error for .../ecj.jar: HTTP server does not support the 'Range' header.
CheerpJ cannot run.` — it then recovers by refetching the whole jar, which with
the old 18 MB `tools.jar` inflated the cold compile from 11.8 s to 14.8 s. Hence
`serve.py`. Real static hosts (S3, Cloudflare Pages, Netlify, GitHub Pages) all
support Range, so this is a local-dev artifact. Moving to ECJ shrinks the
compiler download on the critical path of a student's first compile from 18.3 MB
to 3.1 MB, which matters on a school connection.

Output at 307 µs/line (pessimistic) means a program printing 100k lines would
spend ~30 s in I/O alone (every `println` is one async native = one JVM
suspend/resume). Buffer Java-side before shipping — **but see §5.1: any buffering
must not delay a partial-line prompt past a blocking read.**

---

## 8. Caveats, ranked by how much they should worry us

### 8.1 Licensing — the real blocker (business, not technical)

> **CEO ruling (2026-07-30):** this section's conclusion assumed Warsha is a
> commercial product. It is not — Warsha is an Apache-2.0 FOSS educational
> project (see LICENSE and docs/legal/THIRD-PARTY.md), which falls under the
> "Free and Open-Source Software projects" category below, per the same source
> this section cites. **No commercial licence is required for Warsha itself.**
> The analysis below remains valuable and correct for: private forks by schools,
> any future commercialization, and the self-hosting prohibition (which applies
> to us regardless — CDN dependency stands). docs/legal/THIRD-PARTY.md is the
> authoritative document on this question.

From <https://cheerpj.com/docs/licensing>: CheerpJ Core is free under the
**CheerpJ Community License**, which covers only:

- individuals (including one-person companies), personal or revenue-generating;
- Free and Open-Source Software projects;
- technical evaluations (not yet in production or public).

Attribution ("give appropriate credits") is required. A **commercial licence** is
needed for multi-person companies building commercial applications, internal
company applications, redistribution/OEM, **and self-hosting the runtime**.

For Warsha this means:

- This spike is fine (evaluation). **Shipping is not** — we are a company
  building a commercial product, so budget for a commercial licence and get a
  quote before committing the architecture.
- Self-hosting is prohibited without that licence, so the product has a **hard
  runtime dependency on `cjrtnc.leaningtech.com`**: their CDN outage = nobody can
  run code, and true offline/PWA use is off the table. For classrooms with poor
  connectivity that is a product-level risk, not just an ops one.
- `cheerpjInit` has a `licenseKey` option documented as removing "the
  non-commercial license message". Nothing appeared in our console-only runs, but
  expect a visible notice in some (probably GUI/display) modes.

### 8.2 Runtime exceptions have no line numbers — verified, and it hurts

**Full uncaught-exception output**, exactly as it reaches the page (from
`app.Boom`, an integer divide by zero, compiled with `-g`):

```
java.lang.ArithmeticException
	at app.Boom.main(Unknown Source)
	at sun.reflect.NativeMethodAccessorImpl.invoke(Unknown Source)
	at sun.reflect.DelegatingMethodAccessorImpl.invoke(Unknown Source)
	at java.lang.reflect.Method.invoke(Unknown Source)
	at warsha.Launcher.main(Unknown Source)
```

**Frame anatomy: 5 frames, of which exactly 1 is the student's.** One student
frame on top, then 3 reflection frames, then 1 Warsha frame — the 4
infrastructure frames exist because `warsha.Launcher` invokes the student's
`main` reflectively. Filtering rule for the UI (drop, in this order):

- any frame whose class starts with `warsha.` — our own launcher/bridge;
- any frame whose class starts with `sun.reflect.` or `java.lang.reflect.`;
- everything below the last remaining student frame.

That reduces the display to `at app.Boom.main`, which is all a student can act
on. The count is stable (always these 4) as long as the launcher keeps using
reflection; a `URLClassLoader` + direct call would still need reflection to reach
`main`, so plan on filtering rather than eliminating them.

**No line numbers, and no messages.** Probed directly from Java:
`StackTraceElement.getFileName() == null` and `getLineNumber() == 0`, for both
`new Throwable().getStackTrace()[0]` and a caught exception's trace — while
`getClassName()`/`getMethodName()` are correct. Compiling with `-g` (and with
javac's `-g` before the ECJ swap) changes nothing, so this is CheerpJ's stack
walker, not a compiler flag we are missing. Worse, implicit exception messages
are missing too — `ArithmeticException.getMessage()` is `null`, where a real JVM
says `/ by zero`. So the best we can render for a beginner is:

```
java.lang.ArithmeticException
	at app.Boom.main    (line unknown)
```

For beginners, "your program crashed somewhere in main" is a bad experience, and
it cannot be fixed from our side by a compiler flag. Compile *errors* are
unaffected (exact line + caret). Possible mitigations to investigate: bytecode
instrumentation to track a current-line variable, or wrapping student code in
handlers that add context. Neither is cheap. **This should be raised before the
architecture is locked in.**

### 8.3 The compiler jar: what it is, its licence, and how the app gets it

**Resolved.** The spike originally used an 18.3 MB `tools.jar` pulled from
`javafiddle.leaningtech.com`. Its manifest reads
`Created-By: 1.8.0_131 (Oracle Corporation)` — an **Oracle** JDK build, which is
**not redistributable**. It has been deleted from this directory and is not in git
history.

**Now used: ECJ, the Eclipse Compiler for Java.**

| | |
|---|---|
| Artifact | `org.eclipse.jdt:ecj:3.26.0` (`ecj.jar`, 3 133 846 bytes) |
| Licence | **EPL-2.0** — redistributable (`about.html` inside the jar states it) |
| Origin | Maven Central, `repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.26.0/` |
| sha256 | `ac0ba5876eaf7ebb47749a0d1be179c51f194b9dd0b875d1c09e1b530f5a2db5` |
| sha1 (upstream) | `4837be609a3368a0f7e7cf0dc1bdbc7fe94993de` |
| Main class | `org.eclipse.jdt.internal.compiler.batch.Main` |

**Why 3.26.0 specifically:** it is the last ECJ release whose own class files are
Java 8 (class major 52). 3.27.0+ are major 55 (Java 11) and cannot run on
CheerpJ's Java 8 runtime. Verified by reading the class header, not guessed. If we
move CheerpJ to `version: 11`/`17`, a newer ECJ becomes available.

**How the app obtains it — build time, never committed.** `fetch-compiler.sh`
downloads it from Maven Central and verifies the sha256 (it deletes the file and
fails on mismatch). The same script is what CI should run, publishing `ecj.jar`
as a static asset at the web root so CheerpJ reads it as `/app/ecj.jar`. Rejected
alternatives: committing the jar (repo-wide `*.jar` gitignore, and it bloats the
repo), and fetching it from Maven Central at runtime from the browser (adds a
third-party runtime dependency and a CORS/availability failure mode on top of the
CheerpJ CDN one).

EPL-2.0 obligations for shipping it: keep the licence notice, state that the file
is unmodified ECJ, and offer its source (Eclipse publishes `ecj-3.26.0-sources.jar`
at the same coordinates — link to it rather than host it). Attribution belongs in
the same third-party notices file as the CheerpJ credit required by §8.1.

**ECJ vs javac, measured.** Both work. ECJ is 6x smaller to download but **not
faster** — warm compiles 4.0–6.4 s versus javac's 3.0–4.4 s. Reason:

```
JIT failure - please report a bug: Class (0xafed38):
  org/eclipse/jdt/internal/compiler/parser/Parser, method: consumeRule(I)V
```

CheerpJ's JIT refuses ECJ's enormous generated `Parser.consumeRule` method and
interprets it instead. Harmless but it costs compile speed, and the message is
printed to the JS console on **every** compile — `jvm.worker.js` filters
`/^JIT failure|please report a bug/` into the spike log so it never lands in the
student's output pane. **Do not remove that filter**, or every compile prepends
two alarming lines to the student's program output.

Diagnostics format differs from javac and is arguably clearer — still file, line
and caret, so still mappable to the editor:

```
----------
1. ERROR in /str/Main.java (at line 10)
	System.out.println(n)         // ';' expected
	                    ^
Syntax error, insert ";" to complete Statement
----------
1 problem (1 error)
```

One behavioural difference to code against: **ECJ exits `-1` on compile failure**,
where javac exits `1`. Treat "not 0" as failure; never test for `== 1`.

If compile speed becomes the binding constraint, the fallback is a Temurin
OpenJDK 8 `tools.jar` (GPLv2 + Classpath Exception, redistributable, 18.3 MB) —
legally acceptable, 6x the download, and it avoids the JIT failure.

### 8.4 iPad — NOT verified here (this is the gap in this spike)

Everything above is desktop Chrome on Linux. Nothing was run on an iPad, so the
target device is still unproven. Known risks to test on real hardware next:

- On iPadOS every browser, Chrome included, is WebKit. Desktop-Chrome results do
  not transfer. CheerpJ documents Safari support and 4.3 added touch/virtual
  keyboard work, but that is about Java GUIs, not our console use.
- **Memory** is the main worry: a WASM JVM plus the compiler in a WebKit tab,
  where Safari is far quicker to kill tabs than Chrome. Peak usage was not
  measured; do that first. ECJ helps here too — 3.1 MB of compiler rather than
  18.3 MB.
- **IndexedDB persistence is unreliable on iOS** (eviction for sites that are not
  installed to the home screen). Since `.class` output and any student project
  storage live in `/files/`, assume it can vanish and treat IndexedDB as a cache,
  never as the only copy of a student's work.
- Compile times will be worse than the desktop numbers in §7. An 11 s cold /
  4-6 s warm compile on this laptop could be well over 10 s per compile on an
  iPad, which changes the product's feel. The ECJ `JIT failure` fallback (§8.3)
  may hurt more on WebKit than it does here.
- No `SharedArrayBuffer` is required by this design, so COOP/COEP headers are not
  needed — one fewer static-hosting constraint.

### 8.5 Smaller things

- Java 8 only in this spike; students writing `var` (Java 10+), records, or
  switch expressions will get compile errors. `version: 11`/`17` exist but need a
  matching compiler artifact (a newer ECJ) and re-testing.
- Stale `.class` files in `/files/` persist across sessions (§4).
- Same-name classes in different packages break the flat-`/str/` approach (§4).
- The JVM dies on kill, so "restart and keep going" semantics need the worker
  respawn path (already implemented, 48-54 ms).
- CheerpJ prints `JIT failure` noise on the same channel as compiler output; the
  filter that hides it from students must survive refactors (§8.3).
- Local stdin echo is a UI decision, not a runtime feature — it must be
  suppressible for any exercise that reads input the program means to hide (§5.1).

---

## 9. Recommended architecture if we proceed

1. **JVM in a dedicated Web Worker**, one per run session; `terminate()` is the
   Stop button. Non-negotiable — without it a student's `while(true)` kills the
   tab.
2. **Ship a small prebuilt `warsha-bootstrap.jar`** (compiled offline) that runs
   inside that JVM and owns: copying flat `/str/` sources into package-shaped
   dirs under `/files/`, invoking the compiler programmatically with a diagnostics
   listener (structured errors, no console scraping), installing the stdin/stdout
   natives, and loading + running the student's main class via a `URLClassLoader`.
   This removes the flat-namespace limit, the diagnostics hack, and the
   chicken-and-egg of needing compiled helper classes.
3. **Pre-warm the compiler** at IDE startup and compile only changed files.
4. **Keep stdout unbuffered up to any blocking read** (§5.1), and echo submitted
   stdin lines into the transcript in the UI. If output throughput becomes a
   problem, buffer only between reads — with a regression test for the
   prompt-before-read case.
5. **Filter stack traces** to the student's own frames and label the missing line
   number honestly (§8.2); filter CheerpJ's `JIT failure` noise (§8.3).
6. **Keep the compiler out of the repo:** `fetch-compiler.sh` at build time,
   `ecj.jar` deployed as a static asset, third-party notices for EPL-2.0 (ECJ)
   and the CheerpJ Community/commercial credit.
7. **Get a CheerpJ commercial quote, and validate on a real iPad, before writing
   product code.** Those two are what turn this verdict from
   VIABLE-WITH-CAVEATS into VIABLE or NOT-VIABLE.

---

## 10. Acceptance-test log (re-run on ECJ, 2026-07-30)

Every row below was asserted programmatically in the browser after the compiler
swap, not carried over from the javac run.

| Test | Result |
|---|---|
| 3 files / 2 packages compile, ECJ | exit 0 |
| Cross-package inheritance + polymorphism | `Student Omar (20) majoring in Computer Science`, `instanceof Student? true` |
| stdin round-trip, 2 lines mid-run | `Hello, Sara Al-Otaibi!` → `Created: Student Sara Al-Otaibi (19)`, exit 0 |
| Partial line visible before read blocks | `out "Name: "` at t=49486.9 ms, `stdinRequest` at t=49492.7 ms |
| Blocked read waits 6 s, no EOF/exception | still blocked, 0 new events, no `NoSuchElementException` |
| `nextInt()` token read | `[echo] age parsed as int: 19` |
| Inline echo from 3 separate `print` calls | `[echo] Riyadh <- printed with three separate calls...` |
| stdin echoed into transcript by the page | `Name: Sara Al-Otaibi` on one line |
| `JIT failure` noise kept out of program output | absent from output pane, present in spike log |
| Compile error diagnostics | `1. ERROR in /str/Main.java (at line 10)` + caret, exit -1 |
| Uncaught exception | exit 1, 5 frames, 1 student frame, no line numbers |
| Kill an infinite loop | `terminate()` 0.5–0.8 ms, respawn ready 48 ms, UI responsive throughout |
| Output throughput | 2000 `println` in 203 ms |
