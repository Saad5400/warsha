import type { ProgressReport, RunContext, RunIO, RunSession, Runtime, SourceFile } from './types'
import { bundleProject, ensureBundler, needsBundle } from './bundle'

/**
 * The standalone JavaScript / TypeScript runtime — a `kind: 'console'` engine,
 * the same family as Java and Python, NOT the preview.
 *
 * A `.js`/`.ts` run on its own is a *program*, closer to Node than to a web page:
 * no document, no window, just code that computes and prints. So it runs in a Web
 * Worker — which has exactly those semantics (a global scope, `console`, timers,
 * `fetch`, but no DOM) — and its `console.log`/errors stream to the Console as
 * stdout/stderr, like any other engine here. JavaScript *inside* an HTML page is
 * a different thing and belongs to the preview runtime (web.ts), which inlines it
 * into the document; this engine is only ever chosen when a script is the entry.
 *
 * Two run shapes, so the common case stays instant:
 *
 *  - **Plain single-file `.js`/`.mjs`** — nothing to download. The source runs as
 *    written, in an async wrapper so top-level `await` works and its top-level
 *    names stay non-strict script scope, exactly as a beginner expects. This is
 *    the fast path a first "console.log" takes; `load()` is a no-op.
 *
 *  - **TypeScript, or any script that `import`s another project file** — needs the
 *    esbuild bundler (bundle.ts). `load()` downloads it once (~12 MB, cached and
 *    offline thereafter, so its progress shows on the bar like Pyodide's), and
 *    `run()` bundles the project to one ESM chunk that the worker imports as a
 *    module (top-level `await` and real module scope preserved). A type error or
 *    a bad import comes back as build errors printed to the Console.
 *
 * KNOWN LIMIT: there is no stdin yet (most first scripts only print).
 * `setInterval` keeps the program alive until Stop, exactly as it would Node.
 */

/**
 * Worker source (blob-URL MODULE worker, sidesteps Vite's worker.format).
 * Overrides `console`, tracks timers to report real completion, and runs code
 * as raw source in an async wrapper (`script` mode) or a pre-bundled ESM blob
 * import (`module` mode).
 */
const WORKER_SOURCE = `
const post = (type, text, code) => postMessage({ type, text, code })
const fmt = (a) => {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || a.message || String(a)
  if (typeof a === 'undefined') return 'undefined'
  try { return JSON.stringify(a) } catch (e) { return String(a) }
}
const line = (args) => Array.prototype.map.call(args, fmt).join(' ') + '\\n'
console.log = (...a) => post('stdout', line(a))
console.info = (...a) => post('stdout', line(a))
console.debug = (...a) => post('stdout', line(a))
console.warn = (...a) => post('stderr', line(a))
console.error = (...a) => post('stderr', line(a))

let topDone = false
let exited = false
let finalCode = 0
const timeouts = new Set()
let intervals = 0
const _st = self.setTimeout.bind(self)
const _ct = self.clearTimeout.bind(self)
const _si = self.setInterval.bind(self)
const _ci = self.clearInterval.bind(self)

function onErr(e) { post('stderr', fmt(e) + '\\n') }

function maybeExit() {
  if (topDone && !exited && timeouts.size === 0 && intervals === 0) {
    exited = true
    post('exit', '', finalCode)
  }
}

self.setTimeout = (fn, ms, ...rest) => {
  let id
  id = _st(() => {
    timeouts.delete(id)
    try { if (typeof fn === 'function') fn(...rest) } catch (e) { onErr(e) }
    maybeExit()
  }, ms)
  timeouts.add(id)
  return id
}
self.clearTimeout = (id) => { timeouts.delete(id); _ct(id) }
self.setInterval = (fn, ms, ...rest) => {
  intervals++
  return _si(() => { try { if (typeof fn === 'function') fn(...rest) } catch (e) { onErr(e) } }, ms)
}
self.clearInterval = (id) => { if (intervals > 0) intervals--; _ci(id) }

self.addEventListener('unhandledrejection', (e) => { onErr(e && e.reason); if (e && e.preventDefault) e.preventDefault() })
self.addEventListener('error', (e) => { onErr((e && (e.error || e.message)) || 'Script error') })

onmessage = async (ev) => {
  if (!ev.data || ev.data.type !== 'run') return
  try {
    if (ev.data.mode === 'module') {
      // Pre-bundled ESM: import it as a blob module so top-level await and the
      // (already inlined) imports resolve.
      const url = URL.createObjectURL(new Blob([ev.data.code], { type: 'text/javascript' }))
      try { await import(url) } finally { URL.revokeObjectURL(url) }
    } else {
      // Raw source: async wrapper for top-level await, non-strict script scope.
      const runner = new Function('return (async () => {\\n' + ev.data.code + '\\n})()')
      await runner()
    }
  } catch (e) {
    onErr(e)
    finalCode = 1
  }
  topDone = true
  maybeExit()
}
`

export class JsRuntime implements Runtime {
  readonly id = 'js'
  readonly kind = 'console' as const

  private blobUrl: string | null = null

  private workerUrl(): string {
    if (!this.blobUrl) {
      this.blobUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }))
    }
    return this.blobUrl
  }

  /** Downloads the bundler only when needed (TypeScript, or cross-file imports) — a plain script stays instant. Reports through `onProgress` like an engine boot. */
  async load(onProgress: (p: ProgressReport) => void, ctx?: RunContext): Promise<void> {
    if (!ctx) return
    const entryContent = ctx.files.find((f) => f.path === ctx.entry)?.content ?? ''
    if (needsBundle(ctx.entry, entryContent)) await ensureBundler(onProgress)
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
    const source = files.find((f) => f.path === entryPath)?.content ?? ''

    // A bundle failure (type error, bad import) is a program error — print it
    // and end cleanly, not as an engine-broken card.
    let mode: 'script' | 'module' = 'script'
    let code = source
    if (needsBundle(entryPath, source)) {
      try {
        code = await bundleProject(files, entryPath, { format: 'esm' })
        mode = 'module'
      } catch (e) {
        io.onStderr((e instanceof Error ? e.message : String(e)) + '\n')
        io.onExit(1)
        return { kill() {}, writeStdin() {} }
      }
    }

    const worker = new Worker(this.workerUrl(), { type: 'module' })

    let done = false
    const finish = (exitCode: number | null) => {
      if (done) return
      done = true
      worker.terminate()
      io.onExit(exitCode)
    }

    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (!d) return
      if (d.type === 'stdout') io.onStdout(String(d.text))
      else if (d.type === 'stderr') io.onStderr(String(d.text))
      else if (d.type === 'exit') finish(typeof d.code === 'number' ? d.code : 0)
    }
    worker.onerror = (e) => {
      // A failure to even start the worker (rare) — report it and end the run.
      io.onStderr(String(e.message || 'Could not start JavaScript') + '\n')
      finish(1)
    }

    worker.postMessage({ type: 'run', mode, code })

    return {
      // Stop: kill the worker mid-run and report the neutral "stopped".
      kill() {
        if (done) return
        done = true
        worker.terminate()
        io.onExit(null)
      },
      // No stdin yet (see the header note).
      writeStdin() {},
    }
  }

  dispose(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl)
      this.blobUrl = null
    }
  }
}
