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
 * =========================================================================
 */

const CDN_BASE = 'https://cjrtnc.leaningtech.com/4.3/'
const COMPILER_MAIN = 'org.eclipse.jdt.internal.compiler.batch.Main'

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
 * assets resolve in tens of milliseconds and cheerpjInit itself came back in
 * 34-93ms warm, so announcing a phase the instant it starts would flash a
 * download bar on screen for work that was already done.
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

/** Set by Bridge.phaseDone; null means the phase never reported. */
let phaseStatus = null

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
  phaseStatus = { phase: String(phase), code: Number(code) }
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
      compileAndRun(message).catch((error) => {
        post({ type: 'fatal', text: describe(error) })
      })
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

  // Gated like the download: cheerpjInit came back in 34-93ms on a warm cache,
  // and a bar that appears and vanishes inside 100ms reads as a glitch.
  // (importScripts blocks this thread, so the timer can only fire once the
  // loader is in and we are inside cheerpjInit -- which is where the seconds go
  // on a cold start anyway.)
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
    },
  })
  bootGate.cancel()
  const initMs = performance.now() - started

  const warmStarted = performance.now()
  await compileBootstrap()
  const warmMs = performance.now() - warmStarted

  post({ type: 'ready', initMs, warmMs })
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
 * Compiles the Warsha bootstrap classes (Bridge, Build, Launcher) into
 * /files/warsha/.
 *
 * This doubles as the compiler warm-up. The first ECJ compile of a session
 * costs several seconds because ECJ loads its own classes over the virtual
 * filesystem, and that cost is paid once whatever gets compiled -- so compiling
 * something we actually need beats compiling a throwaway file. It also means
 * there is no prebuilt jar to keep in sync with these sources, and no cached
 * .class files in IndexedDB to version-stamp and invalidate. See INTEGRATION.md.
 *
 * ECJ is driven through its main() here, unlike student compiles: the
 * programmatic entry point lives in Build, which does not exist yet.
 */
async function compileBootstrap() {
  // NOT gated, unlike the download and boot phases. This compile costs seconds
  // on EVERY start, warm cache included, because the bootstrap classes are
  // compiled in the browser rather than shipped prebuilt -- so there is no cache
  // hit to stay quiet about, and staying quiet would mean several seconds of
  // dead air. It is also the one reason a Java warm start is not silent; see the
  // note in INTEGRATION.md.
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
  // r<runId> -- Build's cleanup must never walk into /files/warsha.
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

// --- run -------------------------------------------------------------------

async function compileAndRun({ runId, files, entryPath }) {
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

  // 2. Stage + compile. Build reports its result through Bridge.phaseDone
  //    rather than a process exit code: System.exit would tear down a JVM that
  //    is reused by every later run in this session.
  phaseStatus = null
  const compileStarted = performance.now()
  const compileExit = await cheerpjRunMain(
    'warsha.Build',
    `/files/:${compilerJarPath}`,
    runId,
    entryPath,
  )
  const compileMs = performance.now() - compileStarted

  const compileStatus = phaseStatus && phaseStatus.phase === 'compile' ? phaseStatus.code : compileExit
  if (compileStatus !== 0) {
    post({ type: 'compile-failed', code: compileStatus, compileMs })
    return
  }

  // 3. Run. The output directory is created by Build in step 2, so it exists by
  //    the time this classpath is resolved.
  phaseStatus = null
  const runStarted = performance.now()
  const runExit = await cheerpjRunMain(
    'warsha.Launcher',
    `/files/:/files/warsha-run-${runId}/out/`,
    runId,
  )
  const runMs = performance.now() - runStarted

  // Launcher always reports through phaseDone. If it did not, the student's own
  // code called System.exit() and took the shared JVM down with it -- this
  // worker cannot be trusted for another run, so say so and let the main thread
  // respawn it.
  const reported = phaseStatus && phaseStatus.phase === 'run'
  post({
    type: 'done',
    exit: reported ? phaseStatus.code : runExit,
    compileMs,
    runMs,
    tainted: !reported,
  })
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
