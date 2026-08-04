/* Warsha C# runtime — .NET wasm + Roslyn worker.
 *
 * MUST be started as `new Worker(url, { type: "module" })`: dotnet.js is an ES
 * module. Mirrors runtimes/python/src/worker.js — same shared-memory stdin
 * protocol, same per-write streaming — but hosts the .NET runtime and compiles
 * with Roslyn (see Program.cs `Runner`).
 *
 * Protocol (main -> worker):
 *   { type: "init", sab }
 *   { type: "run", files: { [path]: content }, entry: string }
 * (worker -> main):
 *   { type: "progress", phase, message, loaded?, total? }
 *   { type: "ready", version, bootMs }
 *   { type: "stdout" | "stderr", text }
 *   { type: "stdin-request" }
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
  let getAssemblyExports, getConfig, runMain, setModuleImports
  try {
    ;({ getAssemblyExports, getConfig, runMain, setModuleImports } = await dotnet.create())
  } finally {
    restoreFetch()
  }

  // stdout/stderr stream out per write; stdin blocks on the SAB.
  setModuleImports('runner', {
    warsha: {
      writeOut: (text) => self.postMessage({ type: 'stdout', text }),
      writeErr: (text) => self.postMessage({ type: 'stderr', text }),
      readLine: () => requestStdinLine(),
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

  self.postMessage({
    type: 'ready',
    version: `.NET ${config.productVersion || '9'} · Roslyn`,
    bootMs: Math.round(performance.now() - t0),
    refs: exports.Runner.ReferenceCount(),
  })
}

// --- messages ---------------------------------------------------------------

self.onmessage = (ev) => {
  const msg = ev.data
  if (msg.type === 'init') {
    ctrl = new Int32Array(msg.sab, 0, 2)
    data = new Uint8Array(msg.sab, 8)
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
      const code = exports.Runner.Run(paths, contents, msg.entry)
      self.postMessage({ type: 'done', code: Number(code) | 0, ms: Math.round(performance.now() - t0) })
    } catch (e) {
      self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
    }
    return
  }
}
