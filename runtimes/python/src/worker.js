/* Warsha Python runtime -- Pyodide worker.
 *
 * MUST be started as `new Worker(url, { type: "module" })`. A classic worker
 * with importScripts() does NOT work: importScripts fetches no-cors, and
 * coi-serviceworker passes opaque responses through untouched, so under
 * COEP:require-corp the browser never sees jsDelivr's CORP header and blocks
 * the script. Module script fetches are always CORS-mode, so the shim can
 * rewrite the headers and the load succeeds. See
 * docs/engineering/python-runtime-spike.md.
 *
 * Protocol (main thread -> worker):
 *   { type: "init", sab, indexURL?, isatty? }
 *   { type: "run", files: { [path]: content }, entry: string }
 *   { type: "format", id, code }            reformat one file's source with black
 * (worker -> main thread):
 *   { type: "progress", phase, message, loaded?, total? }   boot progress
 *   { type: "ready", version, bootMs }      init finished, run is accepted now
 *   { type: "stdout" | "stderr", text }     one message per Python write
 *   { type: "stdin-request" }               parked in input()
 *   { type: "done", code, ms }              run finished; code 0 = clean
 *   { type: "fatal", text }                 runtime-level failure
 *   { type: "formatted", id, code }         format succeeded
 *   { type: "format-error", id, message }   format failed (e.g. a syntax error)
 *
 * `format` is independent of the run protocol above: it does not touch
 * `_WARSHA_PROJ`, the stdin ring buffer or `resetFs`/`runEntry`, so it is safe
 * to send between runs. It is NOT safe to send while a run is in flight —
 * `runEntry()` blocks this worker's only thread, so the message would simply
 * queue behind it — callers must gate on the run state themselves.
 */

const PYODIDE_VERSION = '314.0.3'
const DEFAULT_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

const PROJECT_DIR = '/home/pyodide/project'

/** Bytes of program output forwarded per run before we stop forwarding. Keeps
 *  `while True: print(x)` from flooding the main thread until Stop is pressed. */
const OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024

let pyodide = null
let runEntry = null // PyProxy of _warsha_run
let resetFs = null // PyProxy of _warsha_reset_fs
let isatty = false
let indexURL = DEFAULT_INDEX_URL

// --- stdin shared-memory protocol -------------------------------------------
// ctrl[0]: 0 = no data (worker parks here), 1 = line ready, 2 = EOF
// ctrl[1]: byte length of the line sitting in `data`
let ctrl = null
let data = null

const stdinDecoder = new TextDecoder()
// One streaming decoder per stream so a multi-byte character split across two
// Python writes is not mangled into replacement characters.
const outDecoder = new TextDecoder()
const errDecoder = new TextDecoder()

function requestStdinLine() {
  Atomics.store(ctrl, 0, 0)
  self.postMessage({ type: 'stdin-request' })

  // Park the worker thread until the main thread hands us a line. The timeout
  // makes this a loop rather than an indefinite park, which keeps the thread
  // observable and leaves a hook for pyodide.checkInterrupt() later.
  while (Atomics.load(ctrl, 0) === 0) {
    Atomics.wait(ctrl, 0, 0, 250)
  }

  const state = Atomics.load(ctrl, 0)
  Atomics.store(ctrl, 0, 0)
  if (state === 2) return undefined // EOF -> Python raises EOFError

  const len = Atomics.load(ctrl, 1)
  // Copy out of the SharedArrayBuffer before decoding.
  const text = stdinDecoder.decode(data.slice(0, len))
  // Pyodide appends a newline to strings that lack one, but being explicit
  // keeps an empty line from looking like EOF.
  return text + '\n'
}

// --- output -----------------------------------------------------------------

let sentBytes = 0
let capped = false

/* One postMessage per Python write, deliberately. Coalescing on a timer is not
 * possible here: runPython blocks the worker thread, so no timer callback can
 * fire while a program is running, and buffered output would be stranded until
 * the next write. Batch on the main thread instead (see INTEGRATION.md). */
function emit(type, decoder, buf) {
  if (capped) return buf.length
  sentBytes += buf.length
  if (sentBytes > OUTPUT_LIMIT_BYTES) {
    capped = true
    self.postMessage({
      type: 'stderr',
      text: `\n[Warsha: output limit of ${OUTPUT_LIMIT_BYTES >> 20} MiB reached; further output is discarded. Press Stop.]\n`,
    })
    return buf.length
  }
  self.postMessage({ type, text: decoder.decode(buf, { stream: true }) })
  return buf.length
}

// --- download progress ------------------------------------------------------

/* Pyodide's loader has no progress hook, so the only way to give a student a
 * real percentage for the ~11.6 MiB payload is to count the bytes as they
 * arrive. Wrapping fetch does that without downloading anything twice (a
 * prefetch-then-let-Pyodide-refetch scheme depends on the HTTP cache and doubles
 * the transfer whenever that misses). Any failure inside the wrapper falls back
 * to the untouched response: instrumentation must never break the boot. */

/** Measured payload floor: pyodide.asm.wasm 9.15 MiB + python_stdlib.zip 2.43 MiB. */
const EXPECTED_TOTAL_BYTES = 12_150_000
const PROGRESS_INTERVAL_MS = 100

const DOWNLOAD_MESSAGE = 'Downloading Python (11 MB, one-time)...'

let bytesLoaded = 0
let bytesAnnounced = 0
let lastProgressAt = 0

function postDownloadProgress(force) {
  const now = performance.now()
  if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
  lastProgressAt = now
  self.postMessage({
    type: 'progress',
    phase: 'download',
    message: DOWNLOAD_MESSAGE,
    loaded: bytesLoaded,
    // bytesAnnounced only grows as each Content-Length is seen, so clamp with
    // the measured floor to keep the bar from jumping backwards.
    total: Math.max(EXPECTED_TOTAL_BYTES, bytesAnnounced, bytesLoaded),
  })
}

function installFetchProgress() {
  const original = self.fetch.bind(self)

  self.fetch = async (input, init) => {
    const response = await original(input, init)
    try {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
      if (!url.startsWith(indexURL) || !response.ok || !response.body) return response

      const declared = Number(response.headers.get('content-length') || 0)
      if (declared > 0) bytesAnnounced += declared

      const reader = response.body.getReader()
      const counted = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) {
            postDownloadProgress(true)
            controller.close()
            return
          }
          bytesLoaded += value.byteLength
          postDownloadProgress(false)
          controller.enqueue(value)
        },
        cancel: (reason) => reader.cancel(reason),
      })

      // Headers are carried over so Content-Type stays application/wasm and
      // WebAssembly.instantiateStreaming still accepts the response.
      return new Response(counted, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } catch {
      return response
    }
  }

  return () => {
    self.fetch = original
  }
}

// --- boot -------------------------------------------------------------------

async function boot() {
  const t0 = performance.now()

  self.postMessage({ type: 'progress', phase: 'download', message: DOWNLOAD_MESSAGE })
  const restoreFetch = installFetchProgress()
  try {
    const { loadPyodide } = await import(indexURL + 'pyodide.mjs')
    pyodide = await loadPyodide({ indexURL })
  } finally {
    // Student code should see a plain fetch.
    restoreFetch()
  }

  self.postMessage({ type: 'progress', phase: 'boot', message: 'Starting Python...' })

  // isatty:false on purpose. With isatty:true CPython takes its readline path
  // and writes input() prompts to *stderr*, which paints every student prompt
  // red in a console that colours stderr. Output streams progressively in both
  // modes, so false is a free win.
  pyodide.setStdout({
    isatty,
    write: (buf) => emit('stdout', outDecoder, buf),
  })
  pyodide.setStderr({
    isatty,
    write: (buf) => emit('stderr', errDecoder, buf),
  })
  pyodide.setStdin({ isatty, stdin: requestStdinLine })

  pyodide.FS.mkdirTree(PROJECT_DIR)

  // Define the runner once and pay the import cost of traceback/shutil now, so
  // the first Run is not noticeably slower than the second.
  pyodide.runPython(RUNNER)
  runEntry = pyodide.globals.get('_warsha_run')
  resetFs = pyodide.globals.get('_warsha_reset_fs')

  self.postMessage({
    type: 'ready',
    version: pyodide.version,
    bootMs: Math.round(performance.now() - t0),
  })
}

/* Runner. Defines two functions in the Pyodide globals:
 *   _warsha_reset_fs()   wipe + recreate the project dir (drops deleted files
 *                        and stale __pycache__ between runs)
 *   _warsha_run(entry)   execute `entry` as __main__, return an exit status
 *
 * Careful: this is a String.raw template, so a single backtick anywhere below
 * -- even inside a Python comment -- silently ends the template and breaks the
 * whole worker, with the unhelpful symptom of a module worker that fails to
 * parse (an ErrorEvent with no message). `node --check src/worker.js` catches
 * it instantly; `npm run check` in this package does exactly that.
 */
const RUNNER = String.raw`
import linecache, os, shutil, sys, traceback

_WARSHA_PROJ = ${JSON.stringify(PROJECT_DIR)}


def _warsha_reset_fs():
    os.chdir("/")
    shutil.rmtree(_WARSHA_PROJ, ignore_errors=True)
    os.makedirs(_WARSHA_PROJ, exist_ok=True)


def _warsha_internal_frame(frame):
    """True for a frame belonging to Pyodide's own machinery, or to ours.

    CPython has no counterpart to pyodide/webloop.py and friends -- the browser
    emulation layer -- so leaving them in a traceback is the Python equivalent
    of showing a student our launcher. Anything under the project dir is
    theirs and is never hidden, even if they name a file pyodide.py.

    The name check is for functions defined in *this* string (this one,
    _warsha_run, the asyncio guard below, ...): they all share one compiled
    filename, so a name a student never wrote is the only way to tell them
    apart from a real frame. _warsha_run's own outer exec() frame is dropped
    separately (see its caller) before this ever runs, but a deeper shim --
    e.g. the asyncio guard raising from inside a student's own call -- is not,
    and needs this to stay invisible.
    """
    filename = frame.filename
    if not filename or filename.startswith(_WARSHA_PROJ):
        return False
    if "/pyodide/" in filename or "/_pyodide/" in filename:
        return True
    return frame.name.startswith("_warsha_")


def _warsha_format(exc, tb):
    """format_exception, minus Pyodide's frames, across the whole cause chain.

    TracebackException rather than a hand-rolled walk because it is the same
    machinery format_exception itself uses -- so the output is unchanged for
    the overwhelmingly common case where there is nothing to filter.
    """
    top = traceback.TracebackException(type(exc), exc, tb)
    seen = set()
    pending = [top]
    while pending:
        node = pending.pop()
        if id(node) in seen:
            continue
        seen.add(id(node))
        node.stack[:] = [f for f in node.stack if not _warsha_internal_frame(f)]
        for nxt in (node.__cause__, node.__context__):
            if nxt is not None:
                pending.append(nxt)
    return "".join(top.format())


# asyncio.run() cannot work here: this runner calls into Python synchronously
# (Atomics.wait is what makes input() block, and that only works from a
# synchronous call), so Pyodide's WebLoop can never actually stack-switch to
# drive a coroutine to completion. Left alone, asyncio.run(main()) raises
# "Cannot stack switch ..." -- confusing on its own -- but the real failure is
# that asyncio.run() and loop.run_until_complete() both call loop.create_task()
# *before* that check, which schedules main() onto the browser's event loop via
# a plain callback that is not part of this call stack at all. That callback
# still fires later -- after this run has already finished and posted "done",
# sys.stdout/stderr are still wired to whichever run is *then* active, so the
# coroutine's real exception (or asyncio's own "Task exception was never
# retrieved") lands in a run the student never asked it to (measured; see
# INTEGRATION.md). Replacing run()/run_until_complete()/run_forever() outright
# -- rather than catching the RuntimeError after the fact -- means no task is
# ever created, so there is nothing left to fire late. call_exception_handler
# is silenced too, as a second line of defence: if some path we did not
# anticipate ever reaches it, staying silent is strictly safer than a mystery
# error surfacing in someone else's run.
_WARSHA_ASYNCIO_MSG = "asyncio is not supported in Warsha yet — use ordinary (synchronous) code"


def _warsha_close_quietly(x):
    close = getattr(x, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def _warsha_asyncio_run(main, *, debug=None):
    _warsha_close_quietly(main)
    raise RuntimeError(_WARSHA_ASYNCIO_MSG)


def _warsha_run_until_complete(self, future):
    _warsha_close_quietly(future)
    raise RuntimeError(_WARSHA_ASYNCIO_MSG)


def _warsha_run_forever(self):
    raise RuntimeError(_WARSHA_ASYNCIO_MSG)


def _warsha_swallow_exception_handler(self, context):
    pass


def _warsha_install_asyncio_guard():
    import asyncio
    from pyodide.webloop import WebLoop

    asyncio.run = _warsha_asyncio_run
    WebLoop.run_until_complete = _warsha_run_until_complete
    WebLoop.run_forever = _warsha_run_forever
    WebLoop.call_exception_handler = _warsha_swallow_exception_handler


_warsha_install_asyncio_guard()


def _warsha_run(entry):
    proj = _WARSHA_PROJ
    if proj not in sys.path:
        sys.path.insert(0, proj)
    os.chdir(proj)

    # Drop user modules imported by an earlier run, so editing a helper file
    # takes effect instead of resolving to the cached module.
    for name in [
        n for n, m in list(sys.modules.items())
        if getattr(m, "__file__", None) and str(m.__file__).startswith(proj)
    ]:
        del sys.modules[name]

    # Every source line a student sees -- in a traceback, and in a warning --
    # is fetched from linecache, which is keyed by file name and lives as long
    # as the interpreter. One interpreter serves every run here, unlike
    # "python main.py", so without this a second run's main.py is rendered with
    # the FIRST run's source. traceback happens to survive because it calls
    # linecache.checkcache() itself; warnings does not, and was printing a line
    # out of the previously-run program.
    linecache.clearcache()

    with open(os.path.join(proj, entry)) as f:
        src = f.read()

    # Relative filename so tracebacks read "helpers/shapes.py", and __main__
    # semantics so "if __name__ == '__main__'" fires.
    g = {"__name__": "__main__", "__file__": entry, "__builtins__": __builtins__}

    status = 0
    code = None
    try:
        # Compiled outside the exec try-block: a SyntaxError here is raised in
        # *this* frame and has no useful traceback, so it needs the
        # exception-only rendering, which is also what plain "python main.py"
        # prints for a file that fails to parse.
        code = compile(src, entry, "exec")
    except SyntaxError as e:
        sys.stderr.write("".join(traceback.format_exception_only(type(e), e)))
        status = 1

    if code is not None:
        try:
            exec(code, g)
        except SystemExit as e:
            c = e.code
            if c is None:
                status = 0
            elif isinstance(c, int):
                status = c
            else:
                sys.stderr.write(str(c) + "\n")
                status = 1
        except BaseException as e:
            # Drop this runner's own exec() frame so the student sees only their
            # own files, and strip the FS prefix so helper frames read
            # "helpers/shapes.py" not "/home/pyodide/project/helpers/shapes.py".
            tb = e.__traceback__.tb_next if e.__traceback__ else None
            text = _warsha_format(e, tb or e.__traceback__)
            sys.stderr.write(text.replace(proj + "/", ""))
            status = 1

    sys.stdout.flush()
    sys.stderr.flush()
    return status
`

// --- formatting (black) ------------------------------------------------------

/* Lazily installs black and its pure-Python dependency chain via micropip, the
 * first time a student formats a Python file — never during boot, so Run never
 * pays for it. Memoized on a single in-flight/settled promise: a second format
 * request while the first install is still downloading joins it rather than
 * installing twice. Not reset on kill()/respawn deliberately: black has no
 * per-run state, so a fresh worker still has the package cached by the
 * browser's HTTP cache, and re-installing costs a round trip to confirm that. */
let blackReady = null

async function ensureBlack() {
  if (!blackReady) {
    blackReady = (async () => {
      await pyodide.loadPackage('micropip')
      const micropip = pyodide.pyimport('micropip')
      await micropip.install('black')
      pyodide.runPython(FORMAT_RUNNER)
    })().catch((e) => {
      // A failed install must not be cached -- the next attempt (maybe on a
      // better connection) should retry from scratch.
      blackReady = null
      throw e
    })
  }
  return blackReady
}

/* One function, defined once black is importable. Deliberately narrow: a
 * syntax error in the student's own file must surface as a normal "could not
 * format" failure, not a worker-level fatal.
 *
 * Named _warsha_black_format, not _warsha_format: this runs in the SAME
 * pyodide.globals namespace as RUNNER above, which already defines
 * _warsha_format(exc, tb) -- the traceback renderer every uncaught exception
 * goes through. Sharing the name meant the first Format click silently
 * replaced that function with this one; the next uncaught exception in the
 * same worker then called it with the wrong arguments and crashed with
 * "_warsha_format() takes 1 positional argument but 2 were given" instead of
 * showing the student a traceback. Caught by hand while touching this file
 * for task #21 -- not a regression from that task, pre-existing here. */
const FORMAT_RUNNER = String.raw`
import black as _warsha_black


def _warsha_black_format(src):
    return _warsha_black.format_str(src, mode=_warsha_black.Mode())
`

async function formatPython(id, code) {
  try {
    await ensureBlack()
    const fn = pyodide.globals.get('_warsha_black_format')
    try {
      const formatted = fn(code)
      self.postMessage({ type: 'formatted', id, code: formatted })
    } finally {
      fn.destroy()
    }
  } catch (e) {
    self.postMessage({ type: 'format-error', id, message: String((e && e.message) || e) })
  }
}

// --- messages ---------------------------------------------------------------

function writeProjectFiles(files) {
  for (const [path, content] of Object.entries(files)) {
    const full = `${PROJECT_DIR}/${path}`
    const dir = full.slice(0, full.lastIndexOf('/'))
    pyodide.FS.mkdirTree(dir)
    pyodide.FS.writeFile(full, content, { encoding: 'utf8' })
  }
}

self.onmessage = (ev) => {
  const msg = ev.data

  if (msg.type === 'init') {
    ctrl = new Int32Array(msg.sab, 0, 2)
    data = new Uint8Array(msg.sab, 8)
    if (msg.isatty === true) isatty = true
    if (typeof msg.indexURL === 'string' && msg.indexURL) indexURL = msg.indexURL
    boot().catch((e) =>
      self.postMessage({ type: 'fatal', text: String((e && e.stack) || e), duringBoot: true }),
    )
    return
  }

  if (msg.type === 'run') {
    sentBytes = 0
    capped = false
    try {
      resetFs()
      writeProjectFiles(msg.files)
      const t0 = performance.now()
      const status = runEntry(msg.entry)
      self.postMessage({
        type: 'done',
        code: Number(status) | 0,
        ms: Math.round(performance.now() - t0),
      })
    } catch (e) {
      self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
    }
    return
  }

  if (msg.type === 'format') {
    void formatPython(msg.id, msg.code)
  }
}
