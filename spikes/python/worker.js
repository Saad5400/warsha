/* Warsha Python spike -- Pyodide worker. Must be started as {type:"module"}.
 *
 * Module worker, not a classic importScripts worker. Under coi-serviceworker the
 * page ends up with COEP:require-corp, and the shim's service worker passes
 * cross-origin no-cors responses through opaquely, so the browser never sees
 * jsDelivr's CORP header and blocks importScripts. Module script fetches are
 * always CORS-mode, so the shim can rewrite the headers and the load succeeds.
 */

const PYODIDE_VERSION = "314.0.3";
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const PROJECT_DIR = "/home/pyodide/project";

let pyodide = null;

// --- stdin shared-memory protocol -------------------------------------------
// ctrl[0]: 0 = no data (worker parks here), 1 = line ready, 2 = EOF
// ctrl[1]: byte length of the line sitting in `data`
let ctrl = null;
let data = null;

const decoder = new TextDecoder();

function requestStdinLine() {
  // Deliberately does NOT clear the slot first. A student can hit Enter before
  // the program reaches input(), so a line may already be sitting here; zeroing
  // the state would discard it and then park forever on input we were handed.
  // The reader is "armed" simply by the slot being readable at all times, so
  // announcing the request after this point is safe.
  self.postMessage({ type: "stdin-request" });

  // Park the worker thread until a line is available. The timeout makes this a
  // loop rather than an indefinite park, which keeps the thread observable and
  // leaves a hook for pyodide.checkInterrupt() later.
  while (Atomics.load(ctrl, 0) === 0) {
    Atomics.wait(ctrl, 0, 0, 250);
  }

  const state = Atomics.load(ctrl, 0);
  const len = Atomics.load(ctrl, 1);
  // Copy out of the SharedArrayBuffer before releasing the slot.
  const text = state === 2 ? undefined : decoder.decode(data.slice(0, len));

  // Release only now that the bytes are safely copied, and tell the page so it
  // can hand over the next queued line.
  Atomics.store(ctrl, 0, 0);
  Atomics.notify(ctrl, 0);
  self.postMessage({ type: "stdin-consumed", text: text ?? null });

  if (text === undefined) return undefined; // EOF -> Python raises EOFError
  // Pyodide appends a newline to strings that lack one, but being explicit
  // keeps empty lines from looking like EOF.
  return text + "\n";
}

// --- boot -------------------------------------------------------------------

// Default false, flip with ?isatty=1. With isatty:true, CPython takes its
// readline path and writes input() prompts to *stderr*, which paints every
// prompt red in a console that colours stderr. Output streams progressively in
// both modes (verified), so false is the better default.
let ISATTY = false;

async function boot() {
  const t0 = performance.now();
  // Dynamic import (rather than a static top-level one) so the loader download
  // can be timed separately from the wasm/stdlib download.
  const { loadPyodide } = await import(INDEX_URL + "pyodide.mjs");
  const tScript = performance.now();

  pyodide = await loadPyodide({ indexURL: INDEX_URL });

  // A write handler (rather than `batched`) gives us the exact bytes Python
  // emitted, so `print(..., end="")` and input() prompts stay on their line.
  // `batched` cannot distinguish a finished line from a flushed partial one.
  pyodide.setStdout({
    isatty: ISATTY,
    write(buf) {
      self.postMessage({ type: "stdout", text: decoder.decode(buf) });
      return buf.length;
    },
  });
  pyodide.setStderr({
    isatty: ISATTY,
    write(buf) {
      self.postMessage({ type: "stderr", text: decoder.decode(buf) });
      return buf.length;
    },
  });
  pyodide.setStdin({ isatty: ISATTY, stdin: requestStdinLine });

  pyodide.FS.mkdirTree(PROJECT_DIR);

  // jsDelivr sends `timing-allow-origin: *`, so transferSize is real here:
  // 0 means the asset came from the HTTP cache rather than the network.
  const assets = performance
    .getEntriesByType("resource")
    .filter((r) => /pyodide\.asm\.wasm|python_stdlib\.zip/.test(r.name))
    .map((r) => ({
      name: r.name.split("/full/")[1],
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
      ms: Math.round(r.duration),
    }));

  self.postMessage({
    type: "ready",
    version: pyodide.version,
    scriptMs: Math.round(tScript - t0),
    totalMs: Math.round(performance.now() - t0),
    assets,
  });
}

// Runner: execute main.py as __main__, and drop previously imported user
// modules first so edits to helper files take effect on re-run.
const RUNNER = String.raw`
import os, sys, traceback

PROJ = ${JSON.stringify(PROJECT_DIR)}

if PROJ not in sys.path:
    sys.path.insert(0, PROJ)
os.chdir(PROJ)

for name in [
    n for n, m in list(sys.modules.items())
    if getattr(m, "__file__", None) and str(m.__file__).startswith(PROJ)
]:
    del sys.modules[name]

_entry = os.path.join(PROJ, "main.py")
with open(_entry) as f:
    _src = f.read()

_g = {"__name__": "__main__", "__file__": _entry, "__builtins__": __builtins__}

# Compile outside the exec try-block: a SyntaxError here is raised in *this*
# frame, so it has no useful traceback. Printing exception-only matches what
# plain "python main.py" shows for a file that fails to parse.
# (Careful: this string is a String.raw template -- no backticks allowed.)
_code = None
try:
    _code = compile(_src, "main.py", "exec")
except SyntaxError as _e:
    sys.stderr.write("".join(traceback.format_exception_only(type(_e), _e)))

if _code is not None:
    try:
        exec(_code, _g)
    except SystemExit:
        pass
    except BaseException as _e:
        # Drop this runner's own exec() frame so the student sees only their
        # files, and strip the FS prefix so helper frames read
        # "helpers/shapes.py" not "/home/pyodide/project/helpers/shapes.py".
        _tb = _e.__traceback__.tb_next if _e.__traceback__ else None
        _text = "".join(traceback.format_exception(type(_e), _e, _tb or _e.__traceback__))
        sys.stderr.write(_text.replace(PROJ + "/", ""))

sys.stdout.flush()
sys.stderr.flush()
`;

self.onmessage = (ev) => {
  const msg = ev.data;

  if (msg.type === "init") {
    ctrl = new Int32Array(msg.sab, 0, 2);
    data = new Uint8Array(msg.sab, 8);
    if (msg.isatty === true) ISATTY = true;
    boot().catch((e) =>
      self.postMessage({ type: "fatal", text: String(e && e.stack || e) }),
    );
    return;
  }

  if (msg.type === "run") {
    try {
      for (const [path, contents] of Object.entries(msg.files)) {
        const full = `${PROJECT_DIR}/${path}`;
        const dir = full.slice(0, full.lastIndexOf("/"));
        pyodide.FS.mkdirTree(dir);
        pyodide.FS.writeFile(full, contents, { encoding: "utf8" });
      }
      const t0 = performance.now();
      pyodide.runPython(RUNNER);
      self.postMessage({ type: "done", ms: Math.round(performance.now() - t0) });
    } catch (e) {
      self.postMessage({ type: "fatal", text: String(e && e.stack || e) });
    }
  }
};
