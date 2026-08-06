/* Warsha Java runtime -- the CheerpJ JVM, hosted in a Web Worker.
 *
 * ============================ READ THIS FIRST ============================
 * This file MUST be loaded as a CLASSIC worker: `new Worker(url)` with NO
 * `{ type: 'module' }`, and CheerpJ's loader MUST arrive via importScripts.
 *
 * loader.js declares cheerpjInit inside an `if (!self.cj3LoaderPath) { ... }`
 * block. That only reaches global scope under sloppy-mode classic-script
 * hoisting rules; in a module worker it stays block-scoped and `cheerpjInit` is
 * simply not defined. The failure is silent and confusing, so it is worth being
 * explicit: this is the OPPOSITE of runtimes/python, whose worker must be a
 * module. Under Vite that difference matters -- `worker.format` is a single
 * global setting -- see INTEGRATION.md.
 *
 * Why a worker at all: cheerpjInit() can only be called once per JS context
 * ("CheerpJ: Already initialized") and CheerpJ 4.3 exposes no terminate,
 * interrupt or exit call. A Java `while (true) {}` performs no I/O and so never
 * yields, which hard-freezes whichever event loop the JVM runs on -- verified,
 * the tab becomes unrecoverable. worker.terminate() is the only real kill.
 *
 * ======================= THE RESIDENT SERVER DESIGN ======================
 * Each cheerpjRunMain call gets a FRESH classloader (measured: a static set in
 * one call reads false in the next), so the old one-main-per-phase design
 * reloaded ECJ on every compile and re-paid its multi-second warm-up on every
 * single Run. Instead, ONE long-lived main -- warsha.Server -- is started after
 * boot and stays parked on the async Bridge.nextCommand native; every run is a
 * command into that loop, so ECJ loads once per session and stays JIT-warm.
 *
 * The Warsha bootstrap classes arrive PREBUILT in warsha-boot.jar (built by
 * build-bootstrap.sh, deployed at the site root beside ecj.jar). They used to
 * be compiled in the browser on first visit and cached in IndexedDB behind a
 * source hash. That is gone: on Java 17 ECJ can only see the platform classes
 * after warsha.Platform.prepare() has run inside the same JVM invocation, and
 * the fresh-classloader rule above means there is no invocation in which our
 * code could have prepared anything before ECJ's own main ran. Shipping the
 * classes also removes 5-15s from a first visit and deletes the entire stamp
 * cache along with it.
 * =========================================================================
 */

const CDN_BASE = 'https://cjrtnc.leaningtech.com/4.3/'

/* CheerpJ's Java runtime. 8, 11 and 17 are offered; 17 is the newest, and the
 * only one Warsha has ever shipped other than 8. Changing this is NOT a flag
 * flip -- the compiler cannot see the platform classes on 9+ without
 * warsha.Platform, and warsha-boot.jar's bytecode target has to match. */
const JAVA_VERSION = 17

/* Prebuilt Warsha bootstrap. A jar, not a directory: /app/ is the web server
 * over HTTP, which has no directory listing, so a directory classpath entry
 * resolves nothing. See build-bootstrap.sh. */
const DEFAULT_BOOT_JAR_PATH = '/app/warsha-boot.jar'

/* Engine assets worth measuring, for a determinate progress bar.
 *
 * Streaming them ourselves reports real byte counts and leaves them in the HTTP
 * cache for cheerpjInit, which then does NOT download them again: they are
 * served with `cache-control: max-age=31536000`, and a repeat fetch measured
 * 2 ms against 208 ms for the first one.
 *
 * The byte SIZES have to be hardcoded. The CDN sends
 * `access-control-allow-origin: *` and even lists content-length in
 * `access-control-expose-headers`, but it never actually SENDS a Content-Length
 * (responses are gzip/chunked; verified with `Accept-Encoding: identity` too), so
 * `response.headers.get('content-length')` is null and there is no way to learn
 * the total from the response itself. These are the measured sizes of the
 * PINNED 4.3 assets; if they are ever wrong the code below falls back to
 * reporting `loaded` with no total, which degrades the UI to an indeterminate
 * sweep rather than showing a bar that lies. */
const MEASURED_ASSETS = [
  { name: 'cj3.wasm', bytes: 372758 },
  { name: 'cj3.js', bytes: 666055 },
  // Per-runtime native module: each Java version has its own cj3n<version>.wasm
  // and the loader fetches whichever `version` selects. It is the single
  // biggest asset, so leaving it out made the bar finish at ~24% and stall.
  { name: `cj3n${JAVA_VERSION}.wasm`, bytes: 3227431 },
]

/* Noise CheerpJ emits on the JS console, which must never reach a student.
 * ECJ's parser has one enormous generated method (Parser.consumeRule) that
 * CheerpJ's JIT refuses, so it logs a "JIT failure - please report a bug" line
 * and falls back to the interpreter on EVERY compile. Harmless, alarming, and
 * it would otherwise sit directly above the program's first line of output.
 *
 * Nothing from the console is forwarded to the student's console in this
 * runtime -- program output arrives through the Bridge natives and compiler
 * diagnostics through Bridge.writeDiag -- so console text goes to the
 * 'internal' channel only, for the harness and for debugging. That makes the
 * filter structural rather than a regex someone can accidentally delete, but
 * the regex is kept so genuine noise is also labelled as such. */
const RUNTIME_NOISE = /^JIT failure|please report a bug/

const post = (msg) => self.postMessage(msg)

/* A warm start must be SILENT: the shell treats a visible progress block on
 * run #2 as evidence that caching is broken (app/ARCHITECTURE.md §2). Cached
 * assets resolve in tens of milliseconds, cheerpjInit itself came back in
 * 34-93ms warm, and a prebuilt bootstrap makes starting the Server the only
 * other boot work -- so announcing a phase the instant it starts would flash a
 * bar on screen for work that was already done.
 *
 * Every phase announcement is therefore delayed and cancelled if the phase
 * finishes first. Byte-level updates are also gated on the announcement having
 * fired, so a cache hit emits no progress at all rather than a single 100%
 * report. */
const ANNOUNCE_AFTER_MS = 250

function announceAfter(payload) {
  let fired = false
  const timer = setTimeout(() => {
    fired = true
    post(payload)
  }, ANNOUNCE_AFTER_MS)
  return {
    get announced() {
      return fired
    },
    cancel() {
      clearTimeout(timer)
    },
  }
}

for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    original(...args)
    const text = args.map(String).join(' ')
    post({ type: 'internal', level, text, noise: RUNTIME_NOISE.test(text) })
  }
}

// --- state -----------------------------------------------------------------

let compilerJarPath = '/app/ecj.jar'
let bootJarPath = DEFAULT_BOOT_JAR_PATH
let initStarted = false

/** Resolves the pending Bridge.readLine(). */
let stdinWaiter = null
/** Lines submitted before Java asked for them. `null` entries mean EOF. */
const stdinQueue = []

/** Resolves the Server loop's pending Bridge.nextCommand(). */
let commandWaiter = null
/** Commands submitted before the Server asked for one. */
const commandQueue = []

/** phase name -> FIFO of resolvers waiting on Bridge.phaseDone for it. */
const phaseWaiters = Object.create(null)

/** Settles (with the JVM's exit code) when the Server main returns or dies. */
let serverExited = null
/** True from the Server reporting phase "server" 0 until its main settles. */
let serverLive = false

/**
 * Serializes everything sent into the Server's single-threaded loop: the
 * boot-time warm-up compile and every run. A Run pressed while the warm-up is
 * still compiling simply queues behind it -- never two commands in flight.
 */
let commandChain = Promise.resolve()

function enqueueCommandWork(work) {
  const next = commandChain.then(work, work)
  // Keep the chain alive whatever `work` did; each job reports its own errors.
  commandChain = next.catch(() => {})
  return next
}

// --- natives ---------------------------------------------------------------
// Naming is Java_<fully.qualified.Class with underscores>_<method>. The first
// argument is a CheerpJ library handle. CheerpJ AWAITS async natives, which is
// what genuinely parks the Java thread on a read -- no SharedArrayBuffer and no
// Atomics.wait, so no COOP/COEP headers are required of the host.

async function Java_warsha_Bridge_readLine() {
  if (stdinQueue.length) return stdinQueue.shift()
  post({ type: 'stdin-request' })
  return await new Promise((resolve) => {
    stdinWaiter = resolve
  })
}

async function Java_warsha_Bridge_writeOut(lib, text) {
  post({ type: 'stdout', text })
}

async function Java_warsha_Bridge_writeErr(lib, text) {
  post({ type: 'stderr', text })
}

async function Java_warsha_Bridge_writeDiag(lib, text) {
  post({ type: 'diag', text })
}

async function Java_warsha_Bridge_phaseDone(lib, phase, code) {
  const waiters = phaseWaiters[String(phase)]
  if (waiters && waiters.length) waiters.shift()(Number(code))
  // No waiter means nobody asked (e.g. a report after the run was abandoned);
  // dropping it is correct -- each phase is awaited before the next command.
}

async function Java_warsha_Bridge_nextCommand() {
  if (commandQueue.length) return commandQueue.shift()
  return await new Promise((resolve) => {
    commandWaiter = resolve
  })
}

async function Java_warsha_Bridge_writeInternal(lib, text) {
  post({ type: 'internal', level: 'log', text: String(text), noise: false })
}

/** One-shot promise for the next phaseDone report of `phase`. */
function waitPhase(phase) {
  return new Promise((resolve) => {
    if (!phaseWaiters[phase]) phaseWaiters[phase] = []
    phaseWaiters[phase].push(resolve)
  })
}

function sendCommand(command) {
  if (commandWaiter) {
    const waiter = commandWaiter
    commandWaiter = null
    waiter(command)
  } else {
    commandQueue.push(command)
  }
}

// --- messages from the main thread ------------------------------------------

self.onmessage = (event) => {
  const message = event.data
  switch (message.type) {
    case 'init':
      if (initStarted) return
      initStarted = true
      compilerJarPath = message.compilerJarPath || compilerJarPath
      bootJarPath = message.bootJarPath || bootJarPath
      boot(message.cdnBase || CDN_BASE).catch((error) => {
        post({ type: 'fatal', duringBoot: true, text: describe(error) })
      })
      return

    case 'run':
      // A run outranks the warm-up. If the warm-up has not been sent to the
      // Server yet, drop it: commands are serialised inside the JVM, so a
      // warm-up already in flight would make this run wait out the whole ~12s
      // ECJ load -- which is exactly what a student sees when they refresh and
      // press Run. Their own project may not even need ECJ (Build reuses the
      // previous session's compiled output when nothing changed), and finding
      // that out takes milliseconds.
      cancelPendingWarmUp()
      enqueueCommandWork(() =>
        compileAndRun(message)
          .catch((error) => {
            post({ type: 'fatal', text: describe(error) })
          })
          // Whatever the run needed, the NEXT compile still wants a warm ECJ.
          .finally(() => scheduleWarmUp(0)),
      )
      return

    case 'stdin': {
      // message.line === null is EOF.
      const waiter = stdinWaiter
      if (waiter) {
        stdinWaiter = null
        waiter(message.line)
      } else {
        stdinQueue.push(message.line)
      }
      return
    }
  }
}

// --- boot ------------------------------------------------------------------

async function boot(cdnBase) {
  const started = performance.now()

  await prefetchEngine(cdnBase)

  // Gated like the download: cheerpjInit came back in 34-93ms on a warm cache
  // and starting the prebuilt Server is similarly quick, so a bar that appears
  // and vanishes inside 100ms would read as a glitch.
  // (importScripts blocks this thread, so the timer can only fire once the
  // loader is in and we are inside cheerpjInit.)
  const bootGate = announceAfter({
    type: 'progress',
    phase: 'boot',
    message: 'Starting the Java engine…',
  })

  // Classic script, on purpose and non-negotiably -- see the file header.
  importScripts(cdnBase + 'loader.js')

  await cheerpjInit({
    status: 'none',
    version: JAVA_VERSION,
    natives: {
      Java_warsha_Bridge_readLine,
      Java_warsha_Bridge_writeOut,
      Java_warsha_Bridge_writeErr,
      Java_warsha_Bridge_writeDiag,
      Java_warsha_Bridge_phaseDone,
      Java_warsha_Bridge_nextCommand,
      Java_warsha_Bridge_writeInternal,
    },
  })
  const initMs = performance.now() - started

  // The bootstrap is prebuilt, so this either works or the deploy is broken.
  const warmStarted = performance.now()
  const outcome = await startServer()
  bootGate.cancel()

  if (outcome !== 0) {
    throw new Error(
      `the Warsha Java engine failed to start (code ${outcome}). warsha-boot.jar is ` +
        'missing, truncated, or was built against a different runtime. This is a ' +
        'Warsha bug, not a problem with your program.',
    )
  }
  const warmMs = performance.now() - warmStarted

  post({ type: 'ready', initMs, warmMs })

  // ECJ's first compile of a session pays its warm-up (loading its own classes
  // over the virtual filesystem) whatever it compiles. Pay it now, in the
  // background, on a throwaway source -- not on the student's first Run. The
  // command chain serializes this behind-the-scenes compile with real runs, so
  // a Run pressed immediately just waits for it, which still beats the old
  // design where the SAME wait happened before load() ever resolved.
  scheduleWarmUp(WARM_UP_DELAY_MS)
}

/* How long the warm-up waits before claiming the JVM.
 *
 * Long enough that a student who reloads and hits Run straight away gets in
 * first -- the Server is single-threaded, so whoever is in the JVM owns it
 * until they are done, and the warm-up owns it for ~12s. Short enough that a
 * student who is reading their code has a warm compiler by the time they edit
 * anything. */
const WARM_UP_DELAY_MS = 1200

let warmUpTimer = null
let warmedUp = false

function scheduleWarmUp(delayMs) {
  if (warmedUp || warmUpTimer !== null) return
  warmUpTimer = setTimeout(() => {
    warmUpTimer = null
    warmedUp = true
    enqueueCommandWork(() => warmCompiler())
  }, delayMs)
}

function cancelPendingWarmUp() {
  if (warmUpTimer === null) return
  clearTimeout(warmUpTimer)
  warmUpTimer = null
}

/**
 * Starts warsha.Server from the prebuilt bootstrap jar and reports how that
 * went: 0 running, 3 exited without reporting (jar missing or broken --
 * CheerpJ surfaces ClassNotFoundException as a settled main, not a rejection),
 * any other number a reported startup failure.
 */
function startServer() {
  serverLive = false

  // Boot-time only, so no commands are in flight: drop any waiter left over
  // from a previous attempt, or it would steal this attempt's report.
  for (const phase of Object.keys(phaseWaiters)) delete phaseWaiters[phase]

  const settled = cheerpjRunMain('warsha.Server', bootJarPath + ':' + compilerJarPath).then(
    (code) => (typeof code === 'number' ? code : 1),
    () => 1,
  )
  serverExited = settled.then((code) => {
    serverLive = false
    return code
  })

  // phaseDone("server", ...) is called by Java strictly before its main can
  // return, and CheerpJ awaits the native -- so when both happen, the phase
  // report wins this race. The exit branch fires only when the report never
  // came: no Server class, or a bootstrap too broken to reach it.
  return Promise.race([
    waitPhase('server'),
    serverExited.then((code) => (code === 0 ? 3 : code)),
  ]).then((code) => {
    if (code === 0) serverLive = true
    return code
  })
}

/**
 * Streams the two large engine assets to report real byte progress, then leaves
 * them in the HTTP cache for cheerpjInit. Best effort: any failure here is
 * downgraded to an indeterminate message and cheerpjInit fetches them itself.
 */
async function prefetchEngine(cdnBase) {
  const label = 'Downloading Java engine (one-time)…'
  const gate = announceAfter({ type: 'progress', phase: 'download', message: label })
  try {
    const responses = await Promise.all(
      MEASURED_ASSETS.map((asset) => fetch(cdnBase + asset.name, { cache: 'force-cache' })),
    )
    if (responses.some((response) => !response.ok)) throw new Error('engine prefetch failed')

    // Content-Length is not exposed cross-origin (see MEASURED_ASSETS), so the
    // total comes from the pinned sizes. Dropped the moment reality disagrees,
    // so the UI degrades to an indeterminate sweep rather than a bar that lies.
    let total = MEASURED_ASSETS.reduce((sum, asset) => sum + asset.bytes, 0)

    let loaded = 0
    let lastReport = 0
    const report = (force) => {
      // Silent on a cache hit: if the download never got slow enough to be
      // announced, it must not emit byte counts either.
      if (!gate.announced) return
      const now = performance.now()
      if (!force && now - lastReport < 120) return
      lastReport = now
      post({ type: 'progress', phase: 'download', message: label, loaded, total })
    }

    await Promise.all(
      responses.map(async (response) => {
        // No body reader (very old browsers): just drain it.
        if (!response.body) {
          await response.arrayBuffer()
          return
        }
        const reader = response.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          loaded += value.byteLength
          if (total !== undefined && loaded > total) total = undefined
          report(false)
        }
      }),
    )
    report(true)
  } catch {
    if (gate.announced) post({ type: 'progress', phase: 'download', message: label })
  } finally {
    gate.cancel()
  }
}


/**
 * The background ECJ warm-up: one throwaway compile through the same resident
 * Build path a real run takes. Failures are logged and swallowed -- the worst
 * case is that the student's first compile is as slow as it always was.
 *
 * WHAT IT COMPILES MATTERS, and it did not used to. On Java 8 ECJ read the
 * platform out of rt.jar and an empty class was warm-up enough. On Java 17 the
 * platform comes out of the packed module image, and the expensive part is the
 * FIRST touch of each platform type in a session -- measured: an empty class
 * warmed in ~2s and still left a three-file Scanner program taking ~16s, while
 * the same program compiled again in the same session took ~0.3s.
 *
 * So the warm-up references what a teaching project actually references. It
 * makes the warm-up itself slower, which is fine: it runs in the background
 * while the student is reading their code, and it is the only way the first Run
 * of a session is not the slow one.
 */
const WARM_SOURCE = `import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Scanner;

public class WarshaWarm {
    static class Item {
        private final String name;
        private final int count;
        Item(String name, int count) { this.name = name; this.count = count; }
        String name() { return name; }
        @Override public String toString() { return String.format("%s x%d", name, count); }
        @Override public boolean equals(Object o) {
            return o instanceof Item && Objects.equals(name, ((Item) o).name);
        }
        @Override public int hashCode() { return Objects.hash(name); }
    }

    interface Described { String describe(); }

    static class Named implements Described {
        public String describe() { return "named"; }
    }

    public static void main(String[] args) throws Exception {
        Scanner input = new Scanner(System.in);
        List<Item> items = new ArrayList<Item>(Arrays.asList(new Item("a", 1)));
        Map<String, Item> byName = new HashMap<String, Item>();
        for (Item item : items) byName.put(item.name(), item);
        StringBuilder text = new StringBuilder();
        text.append(byName).append(Math.max(1, items.size())).append(new Named().describe());
        double value = Double.parseDouble("1.5") + Integer.parseInt("2");
        System.out.println(text + " " + value + " " + input.hasNextLine());
        try {
            throw new IllegalStateException("warm");
        } catch (RuntimeException e) {
            System.err.println(e.getMessage());
        }
    }
}
`

async function warmCompiler() {
  if (!serverLive) return
  const runId = 'warm0'
  addStringFile(`/str/w${runId}_0.java`, WARM_SOURCE)
  addStringFile(`/str/warsha-manifest-${runId}.tsv`, `w${runId}_0.java\tWarshaWarm.java`)
  const started = performance.now()
  const warmed = waitPhase('warm')
  sendCommand(`warm\t${runId}\tWarshaWarm.java`)
  const code = await Promise.race([warmed, serverExited.then(() => 'dead')])
  post({
    type: 'internal',
    level: 'log',
    text: `warsha-warmup: ${Math.round(performance.now() - started)}ms code=${code}`,
    noise: false,
  })
}

// --- run -------------------------------------------------------------------

async function compileAndRun({ runId, files, entryPath }) {
  // The Server main died earlier in the session (a student System.exit whose
  // run already reported, or a fatal). The runtime replaces this worker when
  // told; make sure it is told rather than hanging a run forever.
  if (!serverLive) {
    post({ type: 'done', exit: 1, compileMs: 0, runMs: 0, tainted: true })
    return
  }

  // 0. Drop anything stdin-related left over from the previous run.
  //
  // stdinQueue holds lines the student typed ahead of the program asking for
  // them. A program that exits without consuming them (typing two lines at a
  // prompt that only reads one, or a console that sends EOF when a run ends)
  // would otherwise leave them here, and the NEXT run's first read would be
  // answered from this queue instead of waiting for the student -- silently
  // consuming input nobody typed for it, or seeing an immediate EOF and
  // throwing NoSuchElementException. Both look exactly like the failures the
  // stdin design is required to prevent, so the queue is per-run.
  stdinQueue.length = 0
  stdinWaiter = null

  // 1. Sources into /str/, the only mount JS can write.
  //
  // /str/ is a FLAT namespace: "/str/models/Person.java" appears to be accepted
  // but Java cannot open it. So each file gets an opaque unique name and a
  // manifest carries the real relative path; warsha.Build replays that into a
  // real directory tree under /files/. Names are unique per run because there
  // is no way to delete a /str/ entry, and silently compiling a previous run's
  // source would be the worst possible bug.
  const manifest = []
  for (let i = 0; i < files.length; i++) {
    const flatName = `w${runId}_${i}.java`
    addStringFile('/str/' + flatName, files[i].content)
    manifest.push(`${flatName}\t${files[i].path}`)
  }
  addStringFile(`/str/warsha-manifest-${runId}.tsv`, manifest.join('\n'))

  // 2. Compile (or reuse: Build skips ECJ when the staged project is identical
  //    to the last successfully compiled one). The Server reports through
  //    Bridge.phaseDone; its main settling instead means the JVM died under us.
  //    This is the ONLY phase that can take double-digit seconds on a warm
  //    engine: a JVM that has not compiled yet has to load ECJ's classes first,
  //    ~12s of it on CheerpJ 17 (INTEGRATION.md). It used to report nothing at
  //    all, so the console sat on "Output will appear here…" for the whole of
  //    it. Gated by announceAfter like every other phase, so the common case --
  //    a warm compile, or a reuse hit that skips ECJ entirely -- stays silent.
  const compileWait = waitPhase('compile')
  const compileGate = announceAfter({
    type: 'progress',
    phase: 'compile',
    message: 'Compiling your code…',
  })
  const compileStarted = performance.now()
  sendCommand(`run\t${runId}\t${entryPath}`)
  const compileStatus = await Promise.race([compileWait, serverExited.then(() => 'dead')])
  compileGate.cancel()
  const compileMs = performance.now() - compileStarted

  if (compileStatus === 'dead') {
    post({ type: 'done', exit: 1, compileMs, runMs: 0, tainted: true })
    return
  }
  if (compileStatus !== 0) {
    post({ type: 'compile-failed', code: compileStatus, compileMs })
    return
  }

  // 3. Run. The Server launches immediately after reporting the compile, so
  //    the clock starts here. A settled Server main during this wait means the
  //    student's own code called System.exit() and took the shared JVM down
  //    with it -- CheerpJ hands us the exit code as the main's result. This
  //    worker cannot be trusted for another run, so say so and let the main
  //    thread respawn it.
  const runWait = waitPhase('run')
  const runStarted = performance.now()
  const runStatus = await Promise.race([
    runWait,
    serverExited.then((code) => ({ died: true, code })),
  ])
  const runMs = performance.now() - runStarted

  if (typeof runStatus === 'object') {
    post({ type: 'done', exit: runStatus.code, compileMs, runMs, tainted: true })
    return
  }
  post({ type: 'done', exit: runStatus, compileMs, runMs, tainted: false })
}

// --- helpers ---------------------------------------------------------------

function addStringFile(path, content) {
  // Both spellings exist in 4.3 and are interchangeable; the docs use the first.
  const add = self.cheerpOSAddStringFile || self.cheerpjAddStringFile
  add(path, new TextEncoder().encode(content))
}

function describe(error) {
  if (!error) return 'unknown worker error'
  return String((error && error.stack) || error)
}
