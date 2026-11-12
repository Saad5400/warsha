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
 *   { type: "init", sab, dbgSab, indexURL?, isatty? }
 *   { type: "run", files: { [path]: content }, entry: string, debug?: { stopOnEntry } | null }
 *   { type: "format", id, code }            reformat one file's source with black
 *   { type: "cell", files, notebook, cellPath, code, source, magic?, pip?, debug? }
 *                                           run one notebook cell in that notebook's
 *                                           persistent namespace (kernel workers only)
 *   { type: "kernel-restart", id, notebook } drop one notebook's namespace
 * (worker -> main thread):
 *   { type: "progress", phase, message, loaded?, total? }   boot progress, and
 *                                           after "ready" the download of the
 *                                           packages a run imports (before it starts)
 *   { type: "ready", version, bootMs }      init finished, run is accepted now
 *   { type: "stdout" | "stderr", text }     one message per Python write
 *   { type: "stdin-request" }               parked in input()
 *   { type: "files", written, deleted, skipped }  what the program did to the
 *                                           project's files; sent before "done"
 *   { type: "done", code, ms }              run finished; code 0 = clean
 *   { type: "fatal", text }                 runtime-level failure
 *   { type: "formatted", id, code }         format succeeded
 *   { type: "format-error", id, message }   format failed (e.g. a syntax error)
 *   { type: "debug-stop", stopped }         parked under the debugger (DebugStopped)
 *   { type: "debug-resume" }                released from a debug stop
 *   { type: "debug-reply", id, ok, result?, error? }  answer to variables/evaluate
 *   { type: "execute-input", count }        a cell started; its In[count]
 *   { type: "output", kind, output }        a cell's display/result/error output (nbformat JSON)
 *   { type: "clear-output", wait }          IPython's clear_output()
 *   { type: "kernel-restarted", id }        answer to kernel-restart
 *
 * A KERNEL worker (init `kernel: true`, PythonRuntime's notebook instance)
 * also defines the cell runner from kernel.js and gets an interrupt buffer
 * (`intSab`): Interrupt raises KeyboardInterrupt in the running cell instead
 * of terminating the worker, so the notebook's variables survive it.
 *
 * While a debug run is in flight every main -> worker debugger message (resume,
 * pause, breakpoints, variables/evaluate requests) goes through the second
 * SharedArrayBuffer (`dbgSab`), because this thread's event loop is blocked for
 * the whole run. Layout is documented in pythonRuntime.ts (DBG_*).
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
let kernelMode = false
let runCellFn = null // PyProxy of _warsha_run_cell (kernel workers)
let indexURL = DEFAULT_INDEX_URL

// --- stdin shared-memory protocol -------------------------------------------
// ctrl[0]: 0 = no data (worker parks here), 1 = line ready, 2 = EOF
// ctrl[1]: byte length of the line sitting in `data`
let ctrl = null
let data = null
// Kernel workers only: Pyodide's interrupt buffer (2 = SIGINT requested).
let intBuf = null
// Kernel workers only: 1 = Interrupt was asked for during this cell (sticky; see pythonRuntime.ts).
let intAsked = null
// Set when a read was cut short by Interrupt; the kernel's input() turns the
// resulting EOF into KeyboardInterrupt (kernel.js, _warsha_input).
let stdinInterrupted = false

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
    // Interrupt while parked here: Python is not executing bytecode, so the
    // interrupt buffer would never be seen. Answer EOF and say why.
    // The buffer is left SET: whatever read this (input(), sys.stdin.readline(), a library)
    // gets EOF and then the KeyboardInterrupt itself at Python's next check. The kernel's
    // input() claims it sooner, cleanly (stdinInterrupted below clears it).
    if (intBuf && Atomics.load(intBuf, 0) === 2) {
      stdinInterrupted = true
      return undefined
    }
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

// --- debugger shared-memory bridge -------------------------------------------
// Exposed to Python as the module _warsha_dbg; the Python half (DEBUGGER below)
// owns every decision, this half only moves bytes. Constants MUST match
// pythonRuntime.ts.
const DBG_HEADER_BYTES = 64
const DBG_REGION_BYTES = 64 * 1024
const DBG_REQ = 0
const DBG_REQLEN = 1
const DBG_PAUSE = 2
const DBG_BPGEN = 3
const DBG_BPLEN = 4

let dctl = null
let dbytes = null
const dbgDecoder = new TextDecoder()

const debugBridge = {
  /** bit 0: pause requested (consumed); bits 1+: breakpoint generation. */
  poll() {
    const pause = Atomics.exchange(dctl, DBG_PAUSE, 0) ? 1 : 0
    return pause | ((Atomics.load(dctl, DBG_BPGEN) & 0x3fffffff) << 1)
  },
  clearPause() {
    Atomics.store(dctl, DBG_PAUSE, 0)
  },
  /** Seqlocked read of the breakpoint JSON: '[["main.py", 3], ...]'. */
  breakpoints() {
    for (;;) {
      const g1 = Atomics.load(dctl, DBG_BPGEN)
      if (g1 & 1) continue
      const len = Atomics.load(dctl, DBG_BPLEN)
      const text = dbgDecoder.decode(dbytes.slice(0, len))
      if (Atomics.load(dctl, DBG_BPGEN) === g1) return text || '[]'
    }
  },
  stopped(json) {
    self.postMessage({ type: 'debug-stop', stopped: JSON.parse(json) })
  },
  resumed() {
    self.postMessage({ type: 'debug-resume' })
  },
  reply(json) {
    self.postMessage({ type: 'debug-reply', ...JSON.parse(json) })
  },
  /** Park until main hands over a request (variables / evaluate / resume). */
  wait() {
    while (Atomics.load(dctl, DBG_REQ) === 0) {
      Atomics.wait(dctl, DBG_REQ, 0, 250)
    }
    const len = Atomics.load(dctl, DBG_REQLEN)
    const text = dbgDecoder.decode(dbytes.slice(DBG_REGION_BYTES, DBG_REGION_BYTES + len))
    Atomics.store(dctl, DBG_REQ, 0)
    return text
  },
}

// --- notebook kernel bridge ---------------------------------------------------
// Exposed to Python as _warsha_kernel_js in kernel workers. Like the debugger's
// bridge it only moves bytes; kernel.js decides everything.
const kernelBridge = {
  /** kind: 'display' | 'update' | 'result' | 'error'; `json` is one nbformat output. */
  publish(kind, json) {
    self.postMessage({ type: 'output', kind, output: JSON.parse(json) })
  },
  clearOutput(wait) {
    self.postMessage({ type: 'clear-output', wait: !!wait })
  },
  executeInput(count) {
    self.postMessage({ type: 'execute-input', count })
  },
  /** Did Interrupt end the last read? Claims the interrupt (the caller raises it itself). */
  stdinInterrupted() {
    const was = stdinInterrupted
    stdinInterrupted = false
    if (was && intBuf) Atomics.store(intBuf, 0, 0)
    return was
  },
  /** A pip install is starting a download: say what, and count every byte from now. */
  progress(message) {
    bytesLoaded = 0
    bytesAnnounced = 0
    downloadMessage = message
    downloadFloor = 0
    postDownloadProgress(true)
  },
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
// What the current download is: the interpreter at boot, or the packages a
// program imports (see loadImportedPackages). Packages have no known floor.
let downloadMessage = DOWNLOAD_MESSAGE
let downloadFloor = EXPECTED_TOTAL_BYTES

function postDownloadProgress(force) {
  const now = performance.now()
  if (!force && now - lastProgressAt < PROGRESS_INTERVAL_MS) return
  lastProgressAt = now
  // bytesAnnounced only grows as each Content-Length is seen, so clamp with
  // the floor to keep the bar from jumping backwards.
  const expected = Math.max(downloadFloor, bytesAnnounced)
  self.postMessage({
    type: 'progress',
    phase: 'download',
    message: downloadMessage,
    loaded: bytesLoaded,
    ...(expected > 0 ? { total: Math.max(expected, bytesLoaded) } : {}),
  })
}

/** `counts(url)` picks which responses feed the bar: the interpreter's own files by default,
 *  every download while pip is installing (wheels come from PyPI too). */
function installFetchProgress(counts = (url) => url.startsWith(indexURL)) {
  const original = self.fetch.bind(self)

  self.fetch = async (input, init) => {
    const response = await original(input, init)
    try {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
      if (!counts(url) || !response.ok || !response.body) return response

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
  pyodide.registerJsModule('_warsha_dbg', debugBridge)
  if (kernelMode) {
    pyodide.registerJsModule('_warsha_kernel_js', kernelBridge)
    if (intBuf) pyodide.setInterruptBuffer(intBuf)
  }

  // Define the runner once and pay the import cost of traceback/shutil now, so
  // the first Run is not noticeably slower than the second.
  pyodide.runPython(RUNNER)
  pyodide.runPython(DEBUGGER)
  runEntry = pyodide.globals.get('_warsha_run')
  resetFs = pyodide.globals.get('_warsha_reset_fs')
  if (kernelMode) {
    // Only a notebook's worker pays for the kernel's source (~60 KB): the program
    // runner's worker never loads it.
    const { KERNEL } = await import('./kernel.js')
    pyodide.runPython(KERNEL)
    runCellFn = pyodide.globals.get('_warsha_run_cell')
  }

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
import json, linecache, os, shutil, sys, traceback

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
    # Everything defined through pyodide.runPython (this runner, the debugger,
    # the notebook kernel) compiles as "<exec>"; a student's own exec() is
    # "<string>", so this never hides their code.
    if filename == "<exec>":
        return True
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


def _warsha_run(entry, debug=None):
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

    dbg = None
    if code is not None and debug is not None:
        dbg = _WarshaDebugger(proj, bool(json.loads(debug).get("stopOnEntry")))

    if code is not None:
        try:
            if dbg is not None:
                sys.settrace(dbg.trace_call)
            try:
                exec(code, g)
            finally:
                if dbg is not None:
                    sys.settrace(None)
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
            if dbg is not None:
                # Post-mortem stop at the raising user frame: the traceback
                # keeps every frame (and its locals) alive while parked.
                try:
                    dbg.stop_exception(e)
                except Exception:
                    pass
                dbg = None
            # Drop this runner's own exec() frame so the student sees only their
            # own files, and strip the FS prefix so helper frames read
            # "helpers/shapes.py" not "/home/pyodide/project/helpers/shapes.py".
            tb = e.__traceback__.tb_next if e.__traceback__ else None
            text = _warsha_format(e, tb or e.__traceback__)
            sys.stderr.write(text.replace(proj + "/", ""))
            status = 1

    sys.stdout.flush()
    sys.stderr.flush()
    _warsha_close_open_files(proj)
    return status


def _warsha_close_open_files(proj, close=True):
    """Flush and close every file the program left open in the project dir.

    close=False only flushes: a notebook kernel keeps running between cells,
    and a file a student opened in one cell may be written in the next -- but
    what it holds so far must reach the disk before the files are diffed.

    Real Python does this at interpreter exit, so f = open("out.txt", "w");
    f.write(...) with no close() still produces out.txt. This interpreter never
    exits, and a crash keeps the file object alive through the traceback, so
    without this the file came back EMPTY (its buffer never reached the FS).
    """
    import gc, io
    # Never the console streams: their "names" (<stdout>...) are not paths, and
    # closing one breaks every later run in this interpreter.
    std = {id(s) for s in (sys.stdin, sys.stdout, sys.stderr, sys.__stdin__, sys.__stdout__, sys.__stderr__)}
    found = []
    for obj in gc.get_objects():
        try:
            if not isinstance(obj, io.IOBase) or id(obj) in std or obj.closed:
                continue
            name = getattr(obj, "name", None)
            if not isinstance(name, str):
                continue
            full = os.path.normpath(name if os.path.isabs(name) else os.path.join(proj, name))
            if full.startswith(proj + "/") and os.path.isfile(full):
                found.append(obj)
        except Exception:
            pass
    # Outermost layer first: a text wrapper flushes into its buffer, the buffer
    # into the raw file. Closing the buffer first would drop the text still
    # waiting in the wrapper.
    def layer(obj):
        if isinstance(obj, io.TextIOBase):
            return 0
        if isinstance(obj, io.BufferedIOBase):
            return 1
        return 2
    for obj in sorted(found, key=layer):
        try:
            obj.close() if close else obj.flush()
        except Exception:
            pass
`

/* Debugger. Defines _WarshaDebugger in the Pyodide globals; _warsha_run builds
 * one per debug run and installs its trace_call with sys.settrace (never for a
 * plain run, so those pay nothing). The protocol is in app/src/runtime/debug.ts.
 *
 *  - Only frames whose code lives in a project file get a line tracer; library
 *    and stdlib frames return None from the call event, so stepping into them
 *    is stepping over them.
 *  - "depth" counts USER frames on the stack, computed once per call event.
 *    stepOver stops at depth <= start, stepOut at depth < start, stepInto at
 *    any user line. Leaving a frame during a step stops in the caller at the
 *    call line (the return event), as VS Code does with debugpy.
 *  - Shared memory (pause flag, breakpoint generation) is polled through the
 *    _warsha_dbg JS bridge every POLL_EVERY user lines and after every resume.
 *  - While parked, the trace function is still on the stack, so CPython keeps
 *    tracing disabled: evaluate() can call student functions without hitting
 *    their breakpoints.
 *
 * Same String.raw caveat as RUNNER: no backticks anywhere below.
 */
const DEBUGGER = String.raw`
import json as _wjson
import reprlib as _wreprlib
import types as _wtypes
import collections as _wcollections
import _warsha_dbg

_WARSHA_MAX_CHILDREN = 200
_WARSHA_MAX_FRAMES = 200
_WARSHA_POLL_EVERY = 32
_WARSHA_NOISE = (_wtypes.ModuleType, _wtypes.FunctionType, _wtypes.BuiltinFunctionType,
                 _wtypes.MethodType, _wtypes.BuiltinMethodType, type)
_WARSHA_LEAF = (str, bytes, bytearray, int, float, complex, bool, type(None), range) + _WARSHA_NOISE


class _WarshaRepr(_wreprlib.Repr):
    """VS Code-style one-line values: reprlib limits, insertion-ordered dicts,
    and Point(x=1, y=2) for objects that never defined __repr__."""

    def __init__(self):
        super().__init__()
        self.maxlevel = 3
        self.maxlist = self.maxtuple = self.maxset = self.maxfrozenset = self.maxdeque = 30
        self.maxdict = 30
        self.maxstring = 300
        self.maxlong = 100
        self.maxother = 300

    def repr_dict(self, x, level):
        if not x:
            return "{}"
        if level <= 0:
            return "{...}"
        pieces = []
        for i, (k, v) in enumerate(x.items()):
            if i >= self.maxdict:
                pieces.append("...")
                break
            pieces.append(self.repr1(k, level - 1) + ": " + self.repr1(v, level - 1))
        return "{" + ", ".join(pieces) + "}"

    def repr_instance(self, x, level):
        t = type(x)
        if isinstance(x, _wtypes.ModuleType):
            return "<module '" + x.__name__ + "'>"
        if isinstance(x, (_wtypes.FunctionType, _wtypes.BuiltinFunctionType)):
            return "<function " + getattr(x, "__qualname__", x.__name__) + ">"
        if isinstance(x, type):
            return "<class '" + x.__qualname__ + "'>"
        if t.__repr__ is object.__repr__:
            d = getattr(x, "__dict__", None)
            if isinstance(d, dict):
                if level <= 0:
                    return t.__name__ + "(...)"
                pieces = []
                for k, v in d.items():
                    if k.startswith("__"):
                        continue
                    if len(pieces) >= self.maxdict:
                        pieces.append("...")
                        break
                    pieces.append(str(k) + "=" + self.repr1(v, level - 1))
                return t.__name__ + "(" + ", ".join(pieces) + ")"
            return "<" + t.__name__ + " object>"
        try:
            s = repr(x)
        except Exception as e:
            return "<" + t.__name__ + " object (repr failed: " + type(e).__name__ + ")>"
        if len(s) > self.maxother:
            s = s[: self.maxother - 3] + "..."
        return s


_warsha_repr = _WarshaRepr()


def _warsha_safe_repr(v):
    try:
        return _warsha_repr.repr(v)
    except Exception as e:
        return "<" + type(v).__name__ + " object (repr failed: " + type(e).__name__ + ")>"


# Names a notebook kernel puts in every namespace (In, Out, get_ipython...) and
# IPython's numbered history (_3, _i3): machinery, not the student's variables.
_warsha_hidden_names = set()
_WARSHA_HISTORY_NAME = __import__("re").compile(r"^_i{0,3}\d*$")


def _warsha_visible_global(name, v):
    if name.startswith("__") and name.endswith("__"):
        return False
    if name.startswith("_warsha") or name.startswith("_WARSHA"):
        return False
    if name in _warsha_hidden_names or _WARSHA_HISTORY_NAME.match(name):
        return False
    return not isinstance(v, _WARSHA_NOISE)


class _WarshaDebugger:
    def __init__(self, proj, stop_on_entry):
        self.proj = proj
        self.prefix = proj + "/"
        self.paths = {}
        self.mode = "entry" if stop_on_entry else None
        self.step_depth = 0
        self.tick = 0
        self.bp_gen = -1
        self.bps = {}
        self.refs = []
        self.frames = []
        self.poll(True)

    # --- shared memory -------------------------------------------------------

    def poll(self, ignore_pause=False):
        word = _warsha_dbg.poll()
        if (word & 1) and not ignore_pause:
            self.mode = "pause"
        gen = word >> 1
        if gen != self.bp_gen:
            self.bp_gen = gen
            bps = {}
            try:
                for path, line in _wjson.loads(_warsha_dbg.breakpoints()):
                    bps.setdefault(path, set()).add(int(line))
            except Exception:
                pass
            self.bps = bps

    # --- tracing -------------------------------------------------------------

    def user_path(self, code):
        try:
            return self.paths[code]
        except KeyError:
            pass
        fn = code.co_filename
        p = None
        if fn.startswith(self.prefix):
            p = fn[len(self.prefix):]
        elif fn and not fn.startswith("<") and not os.path.isabs(fn) and os.path.isfile(os.path.join(self.proj, fn)):
            p = fn
        elif fn and "#cell=" in fn and not fn.startswith("<") and not os.path.isabs(fn):
            # A notebook cell ("nb.ipynb#cell=<id>@<run>"): no file on disk, but the
            # student's code all the same; its lines are cell-local. The "@<run>" that
            # keeps each run's source apart in linecache is not part of its path.
            p = fn.rsplit("@", 1)[0] if "@" in fn.rsplit("#cell=", 1)[-1] else fn
        self.paths[code] = p
        return p

    def trace_call(self, frame, event, arg):
        path = self.user_path(frame.f_code)
        if path is None:
            return None
        depth = 1
        f = frame.f_back
        while f is not None:
            if self.user_path(f.f_code) is not None:
                depth += 1
            f = f.f_back
        dbg = self

        def trace_local(frame, event, arg):
            if event == "line":
                dbg.tick += 1
                if dbg.tick >= _WARSHA_POLL_EVERY:
                    dbg.tick = 0
                    dbg.poll()
                mode = dbg.mode
                if mode is not None:
                    if mode == "over":
                        hit = depth <= dbg.step_depth
                    elif mode == "out":
                        hit = depth < dbg.step_depth
                    else:
                        hit = True
                    if hit:
                        reason = "step" if mode in ("over", "out", "into") else mode
                        dbg.stop(dbg.collect(frame), reason, depth)
                        return trace_local
                lines = dbg.bps.get(path)
                if lines and frame.f_lineno in lines:
                    dbg.stop(dbg.collect(frame), "breakpoint", depth)
            elif event == "return":
                mode = dbg.mode
                if mode is not None and mode in ("over", "out", "into") and depth <= dbg.step_depth:
                    caller = frame.f_back
                    if caller is not None and dbg.user_path(caller.f_code) is not None:
                        dbg.stop(dbg.collect(caller), "step", depth - 1)
            return trace_local

        return trace_local

    # --- stopping ------------------------------------------------------------

    def collect(self, frame):
        out = []
        f = frame
        while f is not None and len(out) < _WARSHA_MAX_FRAMES:
            p = self.user_path(f.f_code)
            if p is not None:
                out.append((f, p, f.f_lineno))
            f = f.f_back
        return out

    def stop_exception(self, exc):
        frames = []
        tb = exc.__traceback__
        while tb is not None:
            p = self.user_path(tb.tb_frame.f_code)
            if p is not None:
                frames.append((tb.tb_frame, p, tb.tb_lineno))
            tb = tb.tb_next
        if not frames:
            return
        frames.reverse()
        msg = str(exc)
        desc = type(exc).__name__ + (": " + msg if msg else "")
        self.stop(frames[:_WARSHA_MAX_FRAMES], "exception", 0, desc)

    def stop(self, frames, reason, depth, description=None):
        self.mode = None
        self.refs = []
        self.frames = frames
        payload = {"reason": reason, "frames": [self.frame_json(f, p, line) for f, p, line in frames]}
        if description is not None:
            payload["description"] = description
        _warsha_dbg.stopped(_wjson.dumps(payload))
        while True:
            req = _wjson.loads(_warsha_dbg.wait())
            kind = req.get("kind")
            if kind == "resume":
                cmd = req.get("cmd")
                self.refs = []
                self.frames = []
                self.mode = {"stepOver": "over", "stepInto": "into", "stepOut": "out"}.get(cmd)
                self.step_depth = depth
                self.tick = 0
                _warsha_dbg.clearPause()
                self.poll(True)
                _warsha_dbg.resumed()
                return
            reply = {"id": req.get("id")}
            try:
                if kind == "variables":
                    reply["result"] = self.children(int(req["ref"]))
                elif kind == "evaluate":
                    reply["result"] = self.evaluate(str(req["expr"]), int(req.get("frame") or 0))
                else:
                    raise ValueError("unknown request " + repr(kind))
                reply["ok"] = True
            except BaseException as e:
                reply["ok"] = False
                reply["error"] = _warsha_error_text(e)
            try:
                text = _wjson.dumps(reply)
            except Exception as e:
                text = _wjson.dumps({"id": req.get("id"), "ok": False, "error": _warsha_error_text(e)})
            _warsha_dbg.reply(text)

    # --- values --------------------------------------------------------------

    def frame_json(self, f, path, line):
        code = f.f_code
        name = getattr(code, "co_qualname", code.co_name)
        g = f.f_globals
        module_level = code.co_name == "<module>"
        if module_level:
            local_items = [(k, v) for k, v in list(g.items()) if _warsha_visible_global(k, v)]
        else:
            local_items = [(k, v) for k, v in list(f.f_locals.items())
                           if not (k.startswith("__") and k.endswith("__"))]
        global_items = [(k, v) for k, v in list(g.items()) if _warsha_visible_global(k, v)]
        return {
            "name": name,
            "path": path,
            "line": line,
            "scopes": [
                {"name": "Locals", "variables": [self.value(k, v) for k, v in local_items]},
                {"name": "Globals", "variables": [self.value(k, v) for k, v in global_items], "expensive": True},
            ],
        }

    def value(self, name, v):
        out = {"name": str(name), "value": _warsha_safe_repr(v), "type": type(v).__name__}
        if self.expandable(v):
            self.refs.append(v)
            out["ref"] = len(self.refs)
        return out

    def expandable(self, v):
        if isinstance(v, _WARSHA_LEAF):
            return False
        if isinstance(v, (list, tuple, dict, set, frozenset, _wcollections.deque)):
            return len(v) > 0
        d = getattr(v, "__dict__", None)
        if isinstance(d, dict) and any(not str(k).startswith("__") for k in d):
            return True
        return bool(self.slot_names(v))

    def slot_names(self, v):
        names = []
        for cls in type(v).__mro__:
            slots = cls.__dict__.get("__slots__", ())
            if isinstance(slots, str):
                slots = (slots,)
            for s in slots:
                if s not in ("__dict__", "__weakref__") and hasattr(v, s):
                    names.append(s)
        return names

    def children(self, ref):
        if ref < 1 or ref > len(self.refs):
            raise ValueError("That value is no longer available.")
        v = self.refs[ref - 1]
        items = []
        total = 0
        if isinstance(v, dict):
            total = len(v)
            for i, (k, x) in enumerate(v.items()):
                if i >= _WARSHA_MAX_CHILDREN:
                    break
                items.append((_warsha_safe_repr(k), x))
        elif isinstance(v, tuple) and hasattr(type(v), "_fields"):
            total = len(v)
            items = list(zip(type(v)._fields, v))[:_WARSHA_MAX_CHILDREN]
        elif isinstance(v, (list, tuple, set, frozenset, _wcollections.deque)):
            total = len(v)
            for i, x in enumerate(v):
                if i >= _WARSHA_MAX_CHILDREN:
                    break
                items.append((str(i), x))
        else:
            d = getattr(v, "__dict__", None)
            if isinstance(d, dict):
                items = [(str(k), x) for k, x in list(d.items()) if not str(k).startswith("__")]
            for s in self.slot_names(v):
                items.append((s, getattr(v, s)))
            total = len(items)
            items = items[:_WARSHA_MAX_CHILDREN]
        out = [self.value(k, x) for k, x in items]
        if total > len(items):
            out.append({"name": "...", "value": str(total - len(items)) + " more"})
        return out

    def evaluate(self, expr, index):
        if index < 0 or index >= len(self.frames):
            raise ValueError("No such frame.")
        f = self.frames[index][0]
        g = f.f_globals
        l = g if f.f_code.co_name == "<module>" else f.f_locals
        try:
            code = compile(expr, "<watch>", "eval")
        except SyntaxError:
            # A statement (x = 5) runs for its effect, like the debug console.
            exec(compile(expr, "<watch>", "exec"), g, l)
            return {"name": expr, "value": ""}
        return self.value(expr, eval(code, g, l))


def _warsha_error_text(e):
    if isinstance(e, SyntaxError):
        return "SyntaxError: " + str(e.msg)
    msg = str(e)
    return type(e).__name__ + (": " + msg if msg else "")
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

// --- packages a program imports ---------------------------------------------

/* `import numpy` / `import pandas` need their wheels from the Pyodide
 * distribution, which nothing loads by default. Every .py file in the project is
 * scanned (a helper module may be the one importing numpy), and only names that
 * map to a distribution package trigger a fetch -- `import math` never does, so a
 * program that imports nothing extra pays one AST walk per file. Must finish
 * before runEntry(): loading is async, and the run itself blocks this thread.
 *
 * Pyodide's loadPackage never rejects on a failed download: it reports through
 * the callbacks and resolves, and the program would then die on a bare
 * ModuleNotFoundError. So the failure is collected here and reported instead.
 * Returns null on success, or the student-facing error text. */
async function loadImportedPackages(files) {
  const failed = []
  const options = {
    messageCallback: (msg) => {
      // "Loading numpy, pandas" is logged once, before any byte is fetched.
      if (!String(msg).startsWith('Loading ')) return
      bytesLoaded = 0
      bytesAnnounced = 0
      downloadMessage = `${msg} (one-time)...`
      downloadFloor = 0
      postDownloadProgress(true)
    },
    errorCallback: (msg) => failed.push(String(msg)),
  }
  const restoreFetch = installFetchProgress()
  try {
    for (const [path, src] of Object.entries(files)) {
      if (path.endsWith('.py')) await pyodide.loadPackagesFromImports(src, options)
    }
  } catch (e) {
    failed.push(String((e && e.message) || e))
  } finally {
    restoreFetch()
  }
  if (!failed.length) return null
  return (
    `[Warsha: could not download a package this program imports -- check your internet connection, then press Run again]\n` +
    failed.map((line) => `  ${line}\n`).join('')
  )
}

// --- messages ---------------------------------------------------------------

/* --- file write-back ---------------------------------------------------------
 *
 * The program runs with the project dir as its working directory, so a student's
 * open("scores.txt", "w") lands in PROJECT_DIR. Without this the file existed
 * only for the life of the run: resetFs() wiped it before the next one, and it
 * never reached the explorer. After every run the dir is diffed against what was
 * sent in and the difference goes back to the shell, which writes it into the
 * project -- the same thing a desktop IDE shows when a program writes a file.
 *
 * The project is text-only, so a file that is not valid UTF-8 (or is huge) is
 * reported as skipped rather than mangled into the editor. __pycache__ is the
 * interpreter's own litter, never the student's.
 */
const WRITE_BACK_LIMIT_BYTES = 1024 * 1024
const IGNORED_DIRS = new Set(['__pycache__'])
const strictDecoder = new TextDecoder('utf-8', { fatal: true })

function decodeText(bytes) {
  if (bytes.byteLength > WRITE_BACK_LIMIT_BYTES) return null
  try {
    const text = strictDecoder.decode(bytes)
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

function listProjectFiles(dir, prefix, out) {
  const FS = pyodide.FS
  let names
  try {
    names = FS.readdir(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === '.' || name === '..') continue
    const full = `${dir}/${name}`
    const rel = prefix ? `${prefix}/${name}` : name
    let stat
    try {
      stat = FS.stat(full)
    } catch {
      continue
    }
    if (FS.isDir(stat.mode)) {
      if (!IGNORED_DIRS.has(name)) listProjectFiles(full, rel, out)
    } else if (FS.isFile(stat.mode)) {
      out.push(rel)
    }
  }
  return out
}

function collectFileChanges(sent) {
  const written = []
  const skipped = []
  const seen = new Set()
  for (const rel of listProjectFiles(PROJECT_DIR, '', [])) {
    seen.add(rel)
    let bytes
    try {
      bytes = pyodide.FS.readFile(`${PROJECT_DIR}/${rel}`)
    } catch {
      continue
    }
    const text = decodeText(bytes)
    if (text === null) {
      skipped.push(rel)
      continue
    }
    if (sent[rel] !== text) written.push({ path: rel, content: text })
  }
  const deleted = Object.keys(sent).filter((p) => !seen.has(p))
  return { written, deleted, skipped }
}

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
    dctl = new Int32Array(msg.dbgSab, 0, DBG_HEADER_BYTES >> 2)
    dbytes = new Uint8Array(msg.dbgSab, DBG_HEADER_BYTES)
    if (msg.isatty === true) isatty = true
    if (msg.kernel === true) {
      kernelMode = true
      if (msg.intSab) {
        intBuf = new Int32Array(msg.intSab, 0, 1)
        intAsked = new Int32Array(msg.intSab, 4, 1)
      }
    }
    if (typeof msg.indexURL === 'string' && msg.indexURL) indexURL = msg.indexURL
    boot().catch((e) =>
      self.postMessage({ type: 'fatal', text: String((e && e.stack) || e), duringBoot: true }),
    )
    return
  }

  if (msg.type === 'run') {
    void runProgram(msg)
    return
  }

  if (msg.type === 'format') {
    void formatPython(msg.id, msg.code)
    return
  }

  if (msg.type === 'cell') {
    void runCell(msg)
    return
  }

  if (msg.type === 'kernel-restart') {
    try {
      pyodide.globals.get('_warsha_kernel_restart')(msg.notebook)
    } catch {
      /* a namespace that cannot be dropped is gone with the worker anyway */
    }
    self.postMessage({ type: 'kernel-restarted', id: msg.id })
  }
}

/* --- notebook cells ------------------------------------------------------------
 *
 * A kernel keeps its files between cells, unlike a Run (which wipes the
 * project dir first): a cell that wrote plot.png or opened a file must find
 * it in the next cell. So the project is SYNCED in, not reset: files the
 * shell's copy changed are rewritten, files the shell deleted are removed, and
 * anything else on disk (a binary the program wrote, which cannot come back
 * into a text-only project) stays where the kernel left it.
 */
let kernelFiles = {} // path -> content, as the shell last gave it (or took it back)
const reportedSkipped = new Set()
let kernelWorkspace = null // the project those files belong to

function syncKernelFiles(files, workspace) {
  // Another project: its files, and nothing a cell of the last project left behind.
  if (workspace !== kernelWorkspace) {
    kernelWorkspace = workspace
    resetFs()
    kernelFiles = {}
    reportedSkipped.clear()
  }
  const FS = pyodide.FS
  for (const path of Object.keys(kernelFiles)) {
    if (!(path in files)) {
      try {
        FS.unlink(`${PROJECT_DIR}/${path}`)
      } catch {
        /* the program already removed it */
      }
    }
  }
  const changed = {}
  for (const [path, content] of Object.entries(files)) {
    if (kernelFiles[path] !== content) changed[path] = content
  }
  writeProjectFiles(changed)
  kernelFiles = { ...files }
}

async function preparePip(pip) {
  if (!pip || !pip.length) return
  const restoreFetch = installFetchProgress(() => true)
  try {
    // Quietly: its "Loading micropip" lines would otherwise land in the cell's output.
    await pyodide.loadPackage('micropip', { messageCallback: () => {} })
    await pyodide.globals.get('_warsha_pip_prepare')(JSON.stringify(pip))
  } finally {
    restoreFetch()
  }
}

const SHIMMED_IMPORTS = /^[ \t]*(?:from[ \t]+IPython\b|import[ \t]+IPython\b).*$/gm

function interruptedBeforeStart() {
  if (!intAsked || Atomics.load(intAsked, 0) !== 1) return false
  Atomics.store(intAsked, 0, 0)
  if (intBuf) Atomics.store(intBuf, 0, 0)
  self.postMessage({ type: 'output', kind: 'error', output: { output_type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: ['KeyboardInterrupt'] } })
  self.postMessage({ type: 'done', code: 1, ms: 0 })
  return true
}

async function runCell(msg) {
  sentBytes = 0
  capped = false
  stdinInterrupted = false
  try {
    // pip first: a package it installs may be what the cell imports next.
    await preparePip(msg.pip)
    // The kernel's own IPython shim answers `from IPython.display import …`;
    // left in, the scan would download the real IPython (~15 packages) for it.
    const sources = { ...msg.files, [`${msg.cellPath}.py`]: msg.code.replace(SHIMMED_IMPORTS, '') }
    const loadError = await loadImportedPackages(sources)
    // Interrupted while packages were downloading: the cell does not start at all — and a
    // download the interrupt cut short is the interrupt, not a network failure.
    if (interruptedBeforeStart()) return
    if (loadError) {
      self.postMessage({ type: 'stderr', text: loadError })
      self.postMessage({ type: 'done', code: 1, ms: 0 })
      return
    }
    syncKernelFiles(msg.files, msg.workspace ?? '')
    if (interruptedBeforeStart()) return
    const t0 = performance.now()
    const status = runCellFn(
      msg.notebook,
      msg.cellPath,
      msg.code,
      msg.source,
      msg.magic ? JSON.stringify(msg.magic) : undefined,
      msg.debug ? JSON.stringify(msg.debug) : undefined,
    )
    try {
      const change = collectFileChanges(kernelFiles)
      for (const f of change.written) kernelFiles[f.path] = f.content
      for (const p of change.deleted) delete kernelFiles[p]
      change.skipped = change.skipped.filter((p) => !reportedSkipped.has(p))
      for (const p of change.skipped) reportedSkipped.add(p)
      if (change.written.length || change.deleted.length || change.skipped.length) {
        self.postMessage({ type: 'files', ...change })
      }
    } catch (e) {
      self.postMessage({ type: 'stderr', text: `[Warsha: could not save files your notebook wrote: ${e}]\n` })
    }
    self.postMessage({ type: 'done', code: String(status) === 'ok' ? 0 : 1, ms: Math.round(performance.now() - t0) })
  } catch (e) {
    self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
  }
}

/* Async only for the package download in front of the run; from runEntry() on
 * the thread blocks exactly as before (stdin parks in Atomics.wait, Stop is
 * worker.terminate(), which also cuts a download short). */
async function runProgram(msg) {
  sentBytes = 0
  capped = false
  try {
    const loadError = await loadImportedPackages(msg.files)
    if (loadError) {
      self.postMessage({ type: 'stderr', text: loadError })
      self.postMessage({ type: 'done', code: 1, ms: 0 })
      return
    }
    resetFs()
    writeProjectFiles(msg.files)
    const t0 = performance.now()
    // JSON, not an object: a JsProxy has no .get(), and undefined -> None.
    const status = runEntry(msg.entry, msg.debug ? JSON.stringify(msg.debug) : undefined)
    // Even a crashed program keeps whatever it wrote before the crash, exactly
    // like a real disk. Best effort: a failure here must not eat the exit code.
    try {
      const change = collectFileChanges(msg.files)
      if (change.written.length || change.deleted.length || change.skipped.length) {
        self.postMessage({ type: 'files', ...change })
      }
    } catch (e) {
      self.postMessage({ type: 'stderr', text: `[Warsha: could not save files your program wrote: ${e}]\n` })
    }
    self.postMessage({
      type: 'done',
      code: Number(status) | 0,
      ms: Math.round(performance.now() - t0),
    })
  } catch (e) {
    self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
  }
}
