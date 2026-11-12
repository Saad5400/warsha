/* Warsha C# runtime — .NET wasm + Roslyn worker.
 *
 * MUST be started as `new Worker(url, { type: "module" })`: dotnet.js is an ES
 * module. Mirrors runtimes/python/src/worker.js — same shared-memory stdin
 * protocol, same per-write streaming — but hosts the .NET runtime and compiles
 * with Roslyn (see Program.cs `Runner`).
 *
 * Protocol (main -> worker):
 *   { type: "init", sab, dsab }
 *   { type: "run", files: { [path]: content }, entry: string, debug: 0 | 1 | 2 }
 *     debug: 0 plain run, 1 under the debugger, 2 debugger + stop on entry
 * (worker -> main):
 *   { type: "progress", phase, message, loaded?, total? }
 *   { type: "ready", version, bootMs }
 *   { type: "stdout" | "stderr", text }
 *   { type: "stdin-request" }
 *   { type: "files", written, deleted, skipped }   sent before "done" (Runner.Changes)
 *   { type: "debug-stop", json }    the program is parked (DebugStopped as JSON)
 *   { type: "debug-vars", json }    {"id", "vars" | "error"} answering a "v" command
 *   { type: "done", code, ms }
 *   { type: "fatal", text, duringBoot? }
 */
import { dotnet } from './_framework/dotnet.js'

// --- stdin shared-memory protocol (identical layout to the Python worker) -----
// ctrl[0]: 0 = no data (worker parks), 1 = line ready, 2 = EOF
// ctrl[1]: byte length of the line in `data`
let ctrl = null
let data = null
const decoder = new TextDecoder()

let exports = null

// --- debugger shared-memory protocol (dsab) ---------------------------------
// While the program runs, this worker's event loop is blocked inside .NET, so
// everything the main thread says to a running/parked program goes through
// shared memory, never postMessage:
//   dctrl[0] pause flag (main sets 1; Dbg.Poll exchanges it back to 0)
//   dctrl[1] breakpoint generation (main bumps it after rewriting the set)
//   dctrl[2] byte length of the breakpoint text ("path\tline" lines) at D_BP
//   dctrl[3] command state: 0 none, 1 a command is waiting at D_CMD
//   dctrl[4] byte length of the command
// Commands: "c" continue, "o" step over, "i" step into, "u" step out,
// "v <id> <ref>" children of a value (answered with debug-vars, stays parked).
const D_BP = 64
const D_BP_CAP = 256 * 1024
const D_CMD = D_BP + D_BP_CAP
let dctrl = null
let dbytes = null
let lastBpGen = -1

function debugPoll() {
  let r = 0
  if (Atomics.exchange(dctrl, 0, 0) !== 0) r |= 1
  if (Atomics.load(dctrl, 1) !== lastBpGen) r |= 2
  return r
}

function debugBreakpoints() {
  lastBpGen = Atomics.load(dctrl, 1)
  const len = Atomics.load(dctrl, 2)
  return decoder.decode(dbytes.slice(D_BP, D_BP + len))
}

/** Park the thread until the main thread writes a command; returns it. */
function debugWait() {
  while (Atomics.load(dctrl, 3) === 0) {
    Atomics.wait(dctrl, 3, 0, 250)
  }
  const len = Atomics.load(dctrl, 4)
  const cmd = decoder.decode(dbytes.slice(D_CMD, D_CMD + len))
  Atomics.store(dctrl, 3, 0)
  return cmd
}

/** The curated reference set for typical student console code. Roslyn only binds
 *  what a program uses; netstandard + System.Runtime + CoreLib forward most
 *  types, the rest cover the common namespaces. Fetched from _framework (real PE
 *  .dll — WasmEnableWebcil=false). A later pass can derive this from getConfig(). */
const REF_DLLS = [
  'System.Private.CoreLib.dll',
  'System.Runtime.dll',
  'netstandard.dll',
  'mscorlib.dll',
  'System.Console.dll',
  'System.Linq.dll',
  'System.Linq.Expressions.dll',
  'System.Collections.dll',
  'System.Collections.Concurrent.dll',
  'System.ObjectModel.dll',
  'System.Text.RegularExpressions.dll',
  'System.Text.Encoding.Extensions.dll',
  'System.Runtime.Extensions.dll',
  'System.Runtime.Numerics.dll',
  'System.Threading.dll',
  'System.Threading.Tasks.dll',
  'System.Memory.dll',
  'System.Globalization.dll',
]

/** Block the worker thread until the main thread hands over a line (or EOF).
 *  Called synchronously from .NET's `warsha.readLine` JSImport, so the parking
 *  is what makes Console.ReadLine() block. Returns the line WITHOUT a trailing
 *  newline (C#'s ReadLine strips it) or null on EOF. */
function requestStdinLine() {
  Atomics.store(ctrl, 0, 0)
  self.postMessage({ type: 'stdin-request' })
  while (Atomics.load(ctrl, 0) === 0) {
    Atomics.wait(ctrl, 0, 0, 250)
  }
  const state = Atomics.load(ctrl, 0)
  Atomics.store(ctrl, 0, 0)
  if (state === 2) return null // EOF
  const len = Atomics.load(ctrl, 1)
  return decoder.decode(data.slice(0, len))
}

// --- boot -------------------------------------------------------------------

// Measured floor for the byte counter (M0: ~37 MB uncompressed loaded). Refined
// with a real total once the boot manifest is summed.
const EXPECTED_TOTAL_BYTES = 37_000_000
const DOWNLOAD_MESSAGE = 'Downloading C# engine (.NET, one-time)…'

let bytesLoaded = 0
let lastProgressAt = 0

function installFetchProgress() {
  const original = self.fetch.bind(self)
  self.fetch = async (input, init) => {
    const response = await original(input, init)
    try {
      const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input)
      if (!url.includes('/_framework/') || !response.ok || !response.body) return response
      const reader = response.body.getReader()
      const counted = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) { controller.close(); return }
          bytesLoaded += value.byteLength
          const now = performance.now()
          if (now - lastProgressAt > 100) {
            lastProgressAt = now
            self.postMessage({
              type: 'progress', phase: 'download', message: DOWNLOAD_MESSAGE,
              loaded: bytesLoaded, total: Math.max(EXPECTED_TOTAL_BYTES, bytesLoaded),
            })
          }
          controller.enqueue(value)
        },
        cancel: (reason) => reader.cancel(reason),
      })
      return new Response(counted, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      })
    } catch {
      return response
    }
  }
  return () => { self.fetch = original }
}

async function boot() {
  const t0 = performance.now()
  self.postMessage({ type: 'progress', phase: 'download', message: DOWNLOAD_MESSAGE })

  const restoreFetch = installFetchProgress()
  // dotnet.create() fetches its assets in parallel. When the network goes (offline,
  // a dropped link), the first failure rejects create() and reaches the student as
  // the failure card via 'fatal'; every other in-flight asset then rejects with no
  // one listening, and those surfaced as uncaught "Failed to fetch" errors that say
  // nothing the card does not. Only network rejections, and only while loading.
  const quietNetworkRejections = (e) => {
    if (/failed to fetch|networkerror|load failed/i.test(String((e.reason && e.reason.message) || e.reason))) e.preventDefault()
  }
  self.addEventListener('unhandledrejection', quietNetworkRejections)
  let getAssemblyExports, getConfig, runMain, setModuleImports
  try {
    ;({ getAssemblyExports, getConfig, runMain, setModuleImports } = await dotnet.create())
  } finally {
    restoreFetch()
    // Late stragglers still reject after create() settles: give them a moment.
    setTimeout(() => self.removeEventListener('unhandledrejection', quietNetworkRejections), 5000)
  }

  // stdout/stderr stream out per write; stdin blocks on the SAB.
  setModuleImports('runner', {
    warsha: {
      writeOut: (text) => self.postMessage({ type: 'stdout', text }),
      writeErr: (text) => self.postMessage({ type: 'stderr', text }),
      readLine: () => requestStdinLine(),
      dbgPoll: () => debugPoll(),
      dbgBreakpoints: () => debugBreakpoints(),
      dbgStop: (json) => {
        self.postMessage({ type: 'debug-stop', json })
        return debugWait()
      },
      dbgWait: () => debugWait(),
      dbgReply: (json) => self.postMessage({ type: 'debug-vars', json }),
    },
  })

  self.postMessage({ type: 'progress', phase: 'boot', message: 'Starting the C# engine…' })
  await runMain()
  const config = getConfig()
  exports = await getAssemblyExports(config.mainAssemblyName)

  // Hand Roslyn its reference assemblies (already in the browser cache from boot).
  self.postMessage({ type: 'progress', phase: 'compile', message: 'Preparing the C# compiler…' })
  for (const dll of REF_DLLS) {
    try {
      const r = await fetch(`./_framework/${dll}`)
      if (r.ok) exports.Runner.AddReference(new Uint8Array(await r.arrayBuffer()))
      else self.postMessage({ type: 'stderr', text: `[warsha] missing reference ${dll} (${r.status})\n` })
    } catch (e) {
      self.postMessage({ type: 'stderr', text: `[warsha] failed reference ${dll}: ${e}\n` })
    }
  }

  // The harness assembly itself, referenced only by debug compilations (the
  // probes call __Warsha.Dbg in it). Missing → debug runs degrade to plain runs.
  try {
    const r = await fetch('./_framework/Warsha.CSharp.dll')
    if (r.ok) exports.Runner.SetDebugReference(new Uint8Array(await r.arrayBuffer()))
  } catch {
    /* debugging unavailable; plain runs unaffected */
  }

  self.postMessage({
    type: 'ready',
    version: `.NET ${config.productVersion || '9'} · Roslyn`,
    bootMs: Math.round(performance.now() - t0),
    refs: exports.Runner.ReferenceCount(),
  })
}

// --- file write-back ----------------------------------------------------------
// Runner.Run makes the project its working directory (an in-memory folder), so a
// student's File.WriteAllText("out.txt", …) lands there. Runner.Changes() is the
// diff against what went in, flattened for interop: groups of three strings
// [kind, path, content] where kind is "w" (written), "d" (deleted) or "s"
// (skipped: binary or too large; content empty).
function postFileChanges() {
  try {
    const flat = exports.Runner.Changes() || []
    const written = []
    const deleted = []
    const skipped = []
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const [kind, path, content] = [flat[i], flat[i + 1], flat[i + 2]]
      if (kind === 'w') written.push({ path, content })
      else if (kind === 'd') deleted.push(path)
      else skipped.push(path)
    }
    if (written.length || deleted.length || skipped.length) {
      self.postMessage({ type: 'files', written, deleted, skipped })
    }
  } catch (e) {
    self.postMessage({ type: 'stderr', text: `[Warsha: could not save files your program wrote: ${e}]\n` })
  }
}

// --- messages ---------------------------------------------------------------

self.onmessage = (ev) => {
  const msg = ev.data
  if (msg.type === 'init') {
    ctrl = new Int32Array(msg.sab, 0, 2)
    data = new Uint8Array(msg.sab, 8)
    if (msg.dsab) {
      dctrl = new Int32Array(msg.dsab, 0, 8)
      dbytes = new Uint8Array(msg.dsab)
    }
    boot().catch((e) =>
      self.postMessage({ type: 'fatal', text: String((e && e.stack) || e), duringBoot: true }),
    )
    return
  }
  if (msg.type === 'run') {
    try {
      const paths = Object.keys(msg.files)
      const contents = paths.map((p) => msg.files[p])
      const t0 = performance.now()
      lastBpGen = -1
      let code
      let exited = false
      try {
        code = exports.Runner.Run(paths, contents, msg.entry, dctrl ? msg.debug | 0 : 0)
      } catch (e) {
        // Environment.Exit(n) does not return: the runtime unwinds out of Run
        // with emscripten's ExitStatus. It is the program's own exit code, not
        // an engine failure -- reporting it as one printed
        // "[csharp runtime error] [object Object]" and exit code 1.
        if (!(e && e.name === 'ExitStatus' && typeof e.status === 'number')) throw e
        code = e.status
        exited = true
      }
      postFileChanges()
      self.postMessage({ type: 'done', code: Number(code) | 0, ms: Math.round(performance.now() - t0), exited })
    } catch (e) {
      self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
    }
    return
  }
}
