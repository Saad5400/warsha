/* Warsha Python runtime -- Pyodide worker.
 *
 * MUST be started as `new Worker(url, { type: "module" })`. A classic worker
 * with importScripts() does NOT work: importScripts fetches no-cors, and
 * coi-serviceworker passes opaque responses through untouched, so under
 * COEP:require-corp the browser never sees jsDelivr's CORP header and blocks
 * the script. Module script fetches are always CORS-mode, so the shim can
 * rewrite the headers and the load succeeds. See spikes/python/SPIKE.md.
 *
 * Protocol (main thread -> worker):
 *   { type: "init", sab, indexURL?, isatty? }
 *   { type: "run", files: { [path]: content }, entry: string }
 * (worker -> main thread):
 *   { type: "progress", text }              boot progress, human-readable
 *   { type: "ready", version, bootMs }      init finished, run is accepted now
 *   { type: "stdout" | "stderr", text }     one message per Python write
 *   { type: "stdin-request" }               parked in input()
 *   { type: "done", code, ms }              run finished; code 0 = clean
 *   { type: "fatal", text }                 runtime-level failure
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

// --- boot -------------------------------------------------------------------

async function boot() {
  const t0 = performance.now()

  self.postMessage({ type: 'progress', text: 'Downloading Python (11 MB, one-time)...' })
  const { loadPyodide } = await import(indexURL + 'pyodide.mjs')
  pyodide = await loadPyodide({ indexURL })

  self.postMessage({ type: 'progress', text: 'Starting Python...' })

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
import os, shutil, sys, traceback

_WARSHA_PROJ = ${JSON.stringify(PROJECT_DIR)}


def _warsha_reset_fs():
    os.chdir("/")
    shutil.rmtree(_WARSHA_PROJ, ignore_errors=True)
    os.makedirs(_WARSHA_PROJ, exist_ok=True)


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
            text = "".join(traceback.format_exception(type(e), e, tb or e.__traceback__))
            sys.stderr.write(text.replace(proj + "/", ""))
            status = 1

    sys.stdout.flush()
    sys.stderr.flush()
    return status
`

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
  }
}
