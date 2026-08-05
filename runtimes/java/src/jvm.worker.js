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
 * Starting Server doubles as the bootstrap-cache probe: /files/ is IndexedDB-
 * backed and persists across page loads, so the compiled warsha.* classes are
 * usually still there from an earlier session. Server checks the stamp hash
 * compiled into them (see bootstrap/Stamp.java); only a mismatch -- or classes
 * missing entirely -- pays the in-browser bootstrap compile. That compile used
 * to be the whole loading experience on EVERY page load; now it is a
 * per-deploy, per-device cost.
 * =========================================================================
 */

const CDN_BASE = 'https://cjrtnc.leaningtech.com/4.3/'
const COMPILER_MAIN = 'org.eclipse.jdt.internal.compiler.batch.Main'

/* Bump to invalidate every cached bootstrap: it feeds the stamp hash. */
const STAMP_SCHEMA = 'warsha-bootstrap-v1'

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
 * 34-93ms warm, and a stamped bootstrap makes the Server probe the only other
 * boot work -- so announcing a phase the instant it starts would flash a bar
 * on screen for work that was already done.
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
let bootstrapSources = null
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
      bootstrapSources = message.bootstrapSources
      boot(message.cdnBase || CDN_BASE).catch((error) => {
        post({ type: 'fatal', duringBoot: true, text: describe(error) })
      })
      return

    case 'run':
      enqueueCommandWork(() =>
        compileAndRun(message).catch((error) => {
          post({ type: 'fatal', text: describe(error) })
        }),
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
  // and the Server probe of a stamped bootstrap is similarly quick, so a bar
  // that appears and vanishes inside 100ms would read as a glitch.
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

  const stamp = stampOf(cdnBase)
  bootstrapSources = withStamp(bootstrapSources, stamp)

  // Probe the persisted bootstrap by starting the Server against it.
  const warmStarted = performance.now()
  let outcome = await startServer(stamp)
  bootGate.cancel()

  let warmMs = 0
  if (outcome !== 0) {
    // Cache miss: classes absent (first visit, or a cleared IndexedDB), from
    // other sources (a new deploy), or unlinkable (an interrupted compile).
    // Every one of those answers the same way: compile the bootstrap, then
    // the Server MUST start.
    await compileBootstrap()
    warmMs = performance.now() - warmStarted
    outcome = await startServer(stamp)
    if (outcome !== 0) {
      throw new Error(
        `the Warsha Java bootstrap failed to start after a fresh compile (code ${outcome}). ` +
          'This is a Warsha bug, not a problem with your program.',
      )
    }
  }

  post({ type: 'ready', initMs, warmMs })

  // ECJ's first compile of a session pays its warm-up (loading its own classes
  // over the virtual filesystem) whatever it compiles. Pay it now, in the
  // background, on a throwaway source -- not on the student's first Run. The
  // command chain serializes this behind-the-scenes compile with real runs, so
  // a Run pressed immediately just waits for it, which still beats the old
  // design where the SAME wait happened before load() ever resolved.
  enqueueCommandWork(() => warmCompiler())
}

/**
 * Starts warsha.Server against whatever /files/ holds and reports how that
 * went: 0 running, 2 stamp mismatch, 3 exited without reporting (classes
 * missing or broken -- CheerpJ surfaces ClassNotFoundException as a settled
 * main, not a rejection), any other number a reported startup failure.
 */
function startServer(stamp) {
  serverLive = false

  // Boot-time only, so no commands are in flight: drop any waiter left over
  // from a previous attempt, or it would steal this attempt's report.
  for (const phase of Object.keys(phaseWaiters)) delete phaseWaiters[phase]

  const settled = cheerpjRunMain('warsha.Server', '/files/:' + compilerJarPath, stamp).then(
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

// --- the bootstrap cache stamp ----------------------------------------------

/**
 * Hash of everything that determines what the compiled bootstrap IS: the
 * schema version, the compiler jar path, the engine base, and every bootstrap
 * source byte (with Stamp.java still holding its committed placeholder, so the
 * value is deterministic). FNV-1a twice with different seeds; this fingerprints
 * deploys against each other, it defends against nothing adversarial.
 */
function stampOf(cdnBase) {
  const parts = [STAMP_SCHEMA, compilerJarPath, cdnBase]
  for (const name of Object.keys(bootstrapSources).sort()) {
    parts.push(name, bootstrapSources[name])
  }
  const text = parts.join(' ')
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0
  }
  return hex32(h1) + hex32(h2)
}

function hex32(n) {
  return ('0000000' + n.toString(16)).slice(-8)
}

/** A copy of the bootstrap sources with the real stamp compiled into Stamp.java. */
function withStamp(sources, stamp) {
  const copy = {}
  let replaced = false
  for (const name of Object.keys(sources)) {
    let content = sources[name]
    if (content.indexOf('"dev-placeholder"') >= 0) {
      content = content.replace('"dev-placeholder"', JSON.stringify(stamp))
      replaced = true
    }
    copy[name] = content
  }
  if (!replaced) {
    // Without the stamp the Server would refuse to start after every compile.
    throw new Error('bootstrap sources are missing the Stamp placeholder')
  }
  return copy
}

// --- the bootstrap compile (cache-miss path only) ----------------------------

/**
 * Compiles the Warsha bootstrap classes (Bridge, Build, Launcher, Server,
 * Stamp, Traces) into /files/warsha/, where they PERSIST: /files/ is
 * IndexedDB-backed, so the next page load starts the Server straight from
 * these classes and skips this compile entirely. Only a new deploy (the stamp
 * changes) or an evicted IndexedDB pays it again.
 *
 * ECJ is driven through its main() here, unlike student compiles: the
 * programmatic entry point lives in Build, which does not exist yet.
 */
async function compileBootstrap() {
  // NOT gated, unlike the download and boot phases: when this runs it always
  // costs seconds, so there is no cache hit to stay quiet about, and staying
  // quiet would mean seconds of dead air.
  post({ type: 'progress', phase: 'compile', message: 'Preparing the Java compiler…' })

  const paths = []
  for (const [name, content] of Object.entries(bootstrapSources)) {
    const path = '/str/' + name
    addStringFile(path, content)
    paths.push(path)
  }

  // -d /files/ (the root) because the compiler will not create its own output
  // directory and JS cannot mkdir under /files/. Bootstrap classes therefore
  // land in /files/warsha/, which is also why per-run directories are named
  // warsha-run-<runId> -- Build's cleanup must never walk into /files/warsha.
  const code = await cheerpjRunMain(
    COMPILER_MAIN,
    compilerJarPath,
    ...paths,
    '-d', '/files/',
    '-cp', compilerJarPath, // Build imports ECJ's BatchCompiler
    '-1.8',
    '-g',
    '-encoding', 'UTF-8',
    '-proc:none',
    '-nowarn',
  )

  // ECJ exits -1 on failure, javac exits 1: never test for === 1.
  if (code !== 0) {
    throw new Error(
      `the Warsha Java bootstrap failed to compile (compiler exit ${code}). ` +
        'This is a Warsha bug, not a problem with your program.',
    )
  }
}

/**
 * The background ECJ warm-up: one throwaway compile through the same resident
 * Build path a real run takes. Failures are logged and swallowed -- the worst
 * case is that the student's first compile is as slow as it always was.
 */
async function warmCompiler() {
  if (!serverLive) return
  const runId = 'warm0'
  addStringFile(`/str/w${runId}_0.java`, 'public class WarshaWarm { public static void main(String[] args) {} }\n')
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
  const compileWait = waitPhase('compile')
  const compileStarted = performance.now()
  sendCommand(`run\t${runId}\t${entryPath}`)
  const compileStatus = await Promise.race([compileWait, serverExited.then(() => 'dead')])
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
