import type { DebugBreakpoint, DebugOptions, DebugSession, DebugStepCommand, DebugValue, ProgressReport, RunContext, RunIO, RunOptions, RunSession, Runtime, SourceFile } from './types'
import { bundleProject, ensureBundler, needsBundle } from './bundle'
import { CONSOLE_FORMAT_SOURCE } from './consoleFormat'

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
 * Debugging (`run(…, { debug })`, see ./debug.ts and ./jsInstrument.ts): the same
 * two shapes, but every student file is first rewritten with line hooks, and the
 * worker gets a SharedArrayBuffer to park on (Atomics.wait) at a stop while the
 * shell reads variables / evaluates through it. A plain run never loads any of it.
 *
 * KNOWN LIMIT: there is no stdin yet (most first scripts only print).
 * `setInterval` keeps the program alive until Stop, exactly as it would Node.
 */

/**
 * Worker source (blob-URL MODULE worker, sidesteps Vite's worker.format).
 * Overrides `console` (formatting shared with the page preview, consoleFormat.ts),
 * tracks timers and in-flight fetches to report real completion, and runs code
 * as raw source in an async wrapper (`script` mode) or a pre-bundled ESM blob
 * import (`module` mode).
 */
const WORKER_SOURCE = `
${CONSOLE_FORMAT_SOURCE}
const post = (type, text, code) => postMessage({ type, text, code })
const out = (text) => post('stdout', text)
const err = (text) => post('stderr', text)
console.log = console.info = console.debug = (...a) => out(__wline(a))
console.warn = console.error = console.trace = (...a) => err(__wline(a))
console.dir = (v) => out(__wfmt(v) + '\\n')
console.table = (data, cols) => out(__wtable(data, cols))
console.assert = (ok, ...a) => { if (!ok) err(__wline(['Assertion failed' + (a.length ? ':' : ''), ...a])) }

let topDone = false
let exited = false
const timeouts = new Set()
const liveIntervals = new Set()
// In-flight fetch() calls and body reads keep the program alive, as pending I/O
// keeps Node alive: without this, fetch(url).then(r => r.json()).then(console.log)
// ended the run (and terminated the worker) before the response arrived,
// printing nothing at all.
let pendingIo = 0
const _st = self.setTimeout.bind(self)
const _ct = self.clearTimeout.bind(self)
const _si = self.setInterval.bind(self)
const _ci = self.clearInterval.bind(self)

let entryName = 'main.js'
let entryLines = Infinity
// The source line a raw script's code starts on inside new Function(): the
// "function anonymous(" and ") {" header lines, then the async wrapper's line.
const SCRIPT_LINE_OFFSET = 3

/**
 * A stack a student can read: frames in their script name their file and their
 * line ("at main.js:2:6"), where V8 reported "eval at onmessage (blob:…),
 * <anonymous>:5:6" — three lines off, plus Warsha's own worker frames.
 */
function studentStack(stack) {
  return stack
    .replace(/\\(?eval at [^\\n]*?, <anonymous>:(\\d+):(\\d+)\\)?/g, (m, l, c) => {
      const line = l - SCRIPT_LINE_OFFSET
      // Past the student's last line is the wrapper's own call: Warsha's frame, not theirs.
      return line < 1 || line > entryLines ? '(blob:)' : '(' + entryName + ':' + line + ':' + c + ')'
    })
    .split('\\n')
    .filter((frame) => !/^\\s+at .*blob:/.test(frame))
    .join('\\n')
}

function onErr(e) { err((e instanceof Error ? studentStack(e.stack || String(e)) : 'Uncaught ' + __wfmt.nested(e)) + '\\n') }

function exit(code) {
  if (exited) return
  exited = true
  post('exit', '', code)
}

/** An uncaught error ends the program with exit code 1 — wherever it was thrown (top level, a timer, a rejected promise), the way Node does. */
function crash(e) {
  onErr(e)
  exit(1)
}

/**
 * Ends the run once nothing can print any more. Checked on a fresh task, never
 * inline: the code after an \`await\` on a timer or a fetch runs as a microtask
 * AFTER the callback that settled it, so an inline check ended
 * \`await sleep(300); console.log("b")\` before "b" printed.
 */
function maybeExit() {
  _st(() => {
    if (topDone && timeouts.size === 0 && liveIntervals.size === 0 && pendingIo === 0) exit(0)
  }, 0)
}

function trackIo(promise) {
  pendingIo++
  const settled = () => { pendingIo--; maybeExit() }
  promise.then(settled, settled)
  return promise
}

self.setTimeout = (fn, ms, ...rest) => {
  let id
  id = _st(() => {
    timeouts.delete(id)
    try { if (typeof fn === 'function') fn(...rest) } catch (e) { crash(e) }
    maybeExit()
  }, ms)
  timeouts.add(id)
  return id
}
self.clearTimeout = (id) => { timeouts.delete(id); _ct(id); maybeExit() }
self.setInterval = (fn, ms, ...rest) => {
  const id = _si(() => { try { if (typeof fn === 'function') fn(...rest) } catch (e) { crash(e) } }, ms)
  liveIntervals.add(id)
  return id
}
// A set, not a counter: clearing one id twice used to drop the tally and end a
// program whose other interval was still running.
self.clearInterval = (id) => { liveIntervals.delete(id); _ci(id); maybeExit() }
if (self.fetch) {
  const _fetch = self.fetch.bind(self)
  self.fetch = (...args) => trackIo(_fetch(...args))
  for (const m of ['json', 'text', 'arrayBuffer', 'blob', 'formData']) {
    const read = Response.prototype[m]
    if (read) Response.prototype[m] = function () { return trackIo(read.call(this)) }
  }
}

self.addEventListener('unhandledrejection', (e) => { if (e && e.preventDefault) e.preventDefault(); crash(e && e.reason) })
self.addEventListener('error', (e) => { if (e && e.preventDefault) e.preventDefault(); crash((e && (e.error || e.message)) || 'Script error') })

onmessage = async (ev) => {
  if (!ev.data || ev.data.type !== 'run') return
  if (ev.data.entry) entryName = ev.data.entry
  try {
    if (ev.data.mode === 'module') {
      // Pre-bundled ESM: import it as a blob module so top-level await and the
      // (already inlined) imports resolve.
      const url = URL.createObjectURL(new Blob([ev.data.code], { type: 'text/javascript' }))
      try { await import(url) } finally { URL.revokeObjectURL(url) }
    } else {
      // Raw source: async wrapper for top-level await, non-strict script scope.
      entryLines = ev.data.code.split('\\n').length
      const runner = new Function('return (async () => {\\n' + ev.data.code + '\\n})()')
      await runner()
    }
  } catch (e) {
    crash(e)
  }
  topDone = true
  maybeExit()
}
`

export class JsRuntime implements Runtime {
  readonly id = 'js'
  readonly kind = 'console' as const

  private blobUrl: string | null = null
  private debugBlobUrl: string | null = null

  /** Headless scripts only — a web page's scripts belong to web.ts. */
  canDebug(entryPath: string): boolean {
    return /\.(m?js|cjs|tsx?|jsx|mts|cts)$/i.test(entryPath)
  }

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

  async run(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession> {
    if (opts?.debug) return this.runDebug(files, entryPath, io, opts.debug)
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

    worker.postMessage({ type: 'run', mode, code, entry: entryPath })

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
    if (this.debugBlobUrl) {
      URL.revokeObjectURL(this.debugBlobUrl)
      this.debugBlobUrl = null
    }
  }

  /**
   * A debug run: instrument every student file (jsInstrument.ts), run it in a
   * worker whose source is the plain one plus the debugger runtime, and expose a
   * DebugSession that talks to the parked worker through shared memory.
   */
  private async runDebug(files: SourceFile[], entryPath: string, io: RunIO, dbg: DebugOptions): Promise<RunSession> {
    const ins = await import('./jsInstrument')
    const source = files.find((f) => f.path === entryPath)?.content ?? ''

    const paths: string[] = []
    const hookLines = new Map<string, number[]>()
    const fidOf = (path: string) => {
      let i = paths.indexOf(path)
      if (i < 0) i = paths.push(path) - 1
      return i
    }

    let mode: 'script' | 'module' = 'script'
    let code = source
    if (needsBundle(entryPath, source)) {
      try {
        code = await bundleProject(files, entryPath, {
          format: 'esm',
          transform: async (path, contents, loader) => {
            const fid = fidOf(path)
            try {
              let js = contents
              let map: string | undefined
              if (loader !== 'js') {
                const esbuild = await ensureBundler()
                const out = await esbuild.transform(contents, { loader, sourcemap: 'external', sourcefile: path, format: 'esm', target: 'es2022', jsx: 'automatic' })
                js = out.code
                map = out.map
              }
              const r = ins.instrument(js, { fid, sourceType: 'module', map })
              hookLines.set(path, r.lines)
              return { contents: r.code, loader: 'js' }
            } catch {
              // Unparseable here → bundle the original so esbuild reports the real error.
              return null
            }
          },
        })
        mode = 'module'
      } catch (e) {
        io.onStderr((e instanceof Error ? e.message : String(e)) + '\n')
        io.onExit(1)
        return { kill() {}, writeStdin() {} }
      }
    } else {
      try {
        const r = ins.instrument(source, { fid: fidOf(entryPath), sourceType: 'script' })
        code = r.code
        hookLines.set(entryPath, r.lines)
      } catch {
        // A syntax error: run the original so the worker reports it exactly as a plain run would.
      }
    }

    const sab = new SharedArrayBuffer(ins.SAB_BYTES)
    const i32 = new Int32Array(sab, 0, 16)
    const u8 = new Uint8Array(sab)
    const enc = new TextEncoder()
    const CMD = 0, PAUSE = 1, GEN = 2, CMDLEN = 3, BPLEN = 4

    /** Breakpoints bind to the first instrumented line at or after the requested one (a blank line, a `}` or a TS-only line moves down, as VS Code does). */
    const writeBreakpoints = (bps: DebugBreakpoint[]) => {
      const byFid: Record<number, number[]> = {}
      for (const bp of bps) {
        const lines = hookLines.get(bp.path)
        if (!lines) continue
        const at = lines.find((l) => l >= bp.line)
        if (at === undefined) continue
        ;(byFid[paths.indexOf(bp.path)] ??= []).push(at)
      }
      let bytes = enc.encode(JSON.stringify(byFid))
      if (bytes.length > ins.BP_MAX) bytes = enc.encode('{}')
      Atomics.add(i32, GEN, 1) // odd: writing
      u8.set(bytes, ins.BP_OFF)
      Atomics.store(i32, BPLEN, bytes.length)
      Atomics.add(i32, GEN, 1) // even: published
    }
    writeBreakpoints(dbg.breakpoints)

    if (!this.debugBlobUrl) {
      this.debugBlobUrl = URL.createObjectURL(new Blob([ins.DEBUG_RUNTIME + WORKER_SOURCE], { type: 'text/javascript' }))
    }
    const worker = new Worker(this.debugBlobUrl, { type: 'module' })

    let done = false
    let parked = false
    let nextId = 0
    let queue: Promise<unknown> = Promise.resolve()
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    let onResumed: (() => void) | null = null

    const send = (cmd: object) => {
      const bytes = enc.encode(JSON.stringify(cmd))
      if (bytes.length > ins.CMD_MAX) throw new Error('Expression too long')
      u8.set(bytes, ins.CMD_OFF)
      Atomics.store(i32, CMDLEN, bytes.length)
      Atomics.add(i32, CMD, 1)
      Atomics.notify(i32, CMD)
    }
    const settleAll = () => {
      for (const p of pending.values()) p.reject(new Error('The program is no longer running'))
      pending.clear()
      onResumed?.()
      onResumed = null
    }
    const finish = (exitCode: number | null) => {
      if (done) return
      done = true
      parked = false
      worker.terminate()
      settleAll()
      io.onExit(exitCode)
    }
    /** One command in flight at a time: the shared command slot holds one. */
    const request = <T,>(cmd: Record<string, unknown>): Promise<T> => {
      if (!parked || done) return Promise.reject(new Error('The program is running'))
      const p = queue.then(
        () =>
          new Promise<T>((resolve, reject) => {
            if (done) return reject(new Error('The program is no longer running'))
            const id = ++nextId
            pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
            try {
              send({ ...cmd, id })
            } catch (e) {
              pending.delete(id)
              reject(e as Error)
            }
          }),
      )
      queue = p.catch(() => {})
      return p
    }

    worker.onmessage = (e: MessageEvent) => {
      const d = e.data
      if (!d) return
      if (d.type === 'stdout') io.onStdout(String(d.text))
      else if (d.type === 'stderr') io.onStderr(String(d.text))
      else if (d.type === 'exit') finish(typeof d.code === 'number' ? d.code : 0)
      else if (d.type === 'dbg-stop') {
        parked = true
        io.onDebugStop?.(d.stopped)
      } else if (d.type === 'dbg-reply') {
        const p = pending.get(d.id)
        if (!p) return
        pending.delete(d.id)
        if (d.ok) p.resolve(d.result)
        else p.reject(new Error(String(d.error)))
      } else if (d.type === 'dbg-resumed') {
        onResumed?.()
        onResumed = null
        io.onDebugResume?.()
      }
    }
    worker.onerror = (e) => {
      io.onStderr(String(e.message || 'Could not start JavaScript') + '\n')
      finish(1)
    }

    worker.postMessage({ type: 'run', mode, code, entry: entryPath, debug: { sab, files: paths, stopOnEntry: !!dbg.stopOnEntry } })

    const debug: DebugSession = {
      resume(cmd: DebugStepCommand) {
        if (!parked || done) return
        parked = false
        queue = queue.then(
          () =>
            new Promise<void>((resolve) => {
              if (done) return resolve()
              onResumed = resolve
              send({ op: 'resume', cmd })
            }),
        )
      },
      pause() {
        if (parked || done) return
        Atomics.store(i32, PAUSE, 1)
      },
      setBreakpoints(bps: DebugBreakpoint[]) {
        if (!done) writeBreakpoints(bps)
      },
      variables(ref: number) {
        return request<DebugValue[]>({ op: 'vars', ref })
      },
      evaluate(expr: string, frameIndex: number) {
        return request<DebugValue>({ op: 'eval', expr, frame: frameIndex })
      },
    }

    return {
      kill() {
        if (done) return
        done = true
        parked = false
        worker.terminate()
        settleAll()
        io.onExit(null)
      },
      writeStdin() {},
      debug,
    }
  }
}
