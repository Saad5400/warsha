import type {
  DebugBreakpoint,
  DebugSession,
  DebugStepCommand,
  DebugStopped,
  DebugValue,
  LoadPhase,
  ProgressReport,
  RunIO,
  RunOptions,
  RunSession,
  Runtime,
  SourceFile,
} from './types'

/** Bytes reserved in the shared buffer for one stdin line (matches the worker). */
const STDIN_CAPACITY = 64 * 1024
/** ctrl[0] = state, ctrl[1] = pending byte length. */
const HEADER_BYTES = 8

const STATE_EMPTY = 0
const STATE_LINE = 1
const STATE_EOF = 2

/*
 * Debugger shared memory -- a second SharedArrayBuffer, so the stdin protocol
 * above is untouched. Layout (Int32 words, then two byte regions):
 *   [0] REQ    0 = slot empty, 1 = a request is waiting for the parked worker
 *   [1] REQLEN byte length of the request JSON
 *   [2] PAUSE  1 = main asked a running program to stop at its next line
 *   [3] BPGEN  breakpoint seqlock: odd while main is writing, bumped per set
 *   [4] BPLEN  byte length of the breakpoint JSON
 * The worker's JS event loop is blocked for the whole run, so postMessage can
 * never reach it mid-program; everything main -> worker during a debug run
 * goes through here. Worker -> main still uses postMessage (main never blocks).
 * MUST match the constants in worker.js.
 */
const DBG_HEADER_BYTES = 64
const DBG_REGION_BYTES = 64 * 1024
const DBG_REQ = 0
const DBG_REQLEN = 1
const DBG_PAUSE = 2
const DBG_BPGEN = 3
const DBG_BPLEN = 4

type FromWorker =
  | { type: 'progress'; phase: LoadPhase; message: string; loaded?: number; total?: number }
  | { type: 'ready'; version: string; bootMs: number }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'stdin-request' }
  | { type: 'files'; written: SourceFile[]; deleted: string[]; skipped: string[] }
  | { type: 'done'; code: number; ms: number }
  | { type: 'fatal'; text: string; duringBoot?: boolean }
  | { type: 'formatted'; id: number; code: string }
  | { type: 'format-error'; id: number; message: string }
  | { type: 'debug-stop'; stopped: DebugStopped }
  | { type: 'debug-resume' }
  | { type: 'debug-reply'; id: number; ok: boolean; result?: unknown; error?: string }

export interface PythonRuntimeOptions {
  /**
   * Directory holding pyodide.mjs + the wasm/stdlib assets. Defaults to the
   * pinned jsDelivr build (314.0.3, Python 3.14). Point this at a same-origin
   * copy to self-host; any other origin must send CORP + CORS headers or it
   * will be blocked under COEP.
   */
  indexURL?: string
  /**
   * Route input() prompts through CPython's readline path (prompts then go to
   * *stderr*). Off by default and there is no good reason to turn it on.
   */
  isatty?: boolean
}

/** A `Python is running` session. Extends the contract with writeEof(). */
export interface PythonRunSession extends RunSession {
  /** Signal end-of-input; the pending input() raises EOFError. Optional extra. */
  writeEof(): void
}

interface Active {
  io: RunIO
  ended: boolean
  awaitingStdin: boolean
  debug: DebugState | null
}

type DebugRequest =
  | { kind: 'variables'; ref: number }
  | { kind: 'evaluate'; expr: string; frame: number }
  | { kind: 'resume'; cmd: DebugStepCommand }

interface DebugState {
  /** True between a 'debug-stop' and the resume that releases it. */
  parked: boolean
  /** Requests not yet handed to the worker (the shared slot holds one at a time). */
  queue: { id: number; req: DebugRequest; resolve: (v: unknown) => void; reject: (e: Error) => void }[]
  /** The request the worker is currently answering. */
  inflight: { id: number; resolve: (v: unknown) => void; reject: (e: Error) => void } | null
}

const NOT_ISOLATED =
  'Python needs cross-origin isolation (SharedArrayBuffer) to make input() block. ' +
  'Load coi-serviceworker.js as a plain <script> in <head> and serve the page over HTTPS or localhost, then reload.'

/**
 * Pyodide-backed implementation of the IDE's `Runtime` contract.
 *
 * One instance owns one worker. The worker boots Pyodide once and is reused
 * across runs; `kill()` terminates it and transparently respawns a replacement,
 * so a subsequent `run()` works (paying ~1.5-2 s of re-warm, see INTEGRATION.md).
 */
export class PythonRuntime implements Runtime {
  readonly id = 'python' as const

  private readonly indexURL?: string
  private readonly isatty: boolean

  private worker: Worker | null = null
  private sab: SharedArrayBuffer | null = null
  private ctrl: Int32Array | null = null
  private data: Uint8Array | null = null
  private dbgSab: SharedArrayBuffer | null = null
  private dbgCtrl: Int32Array | null = null
  private dbgBytes: Uint8Array | null = null
  private nextDebugId = 1

  /** In-flight or settled boot of the current worker. null = no worker yet. */
  private booting: Promise<void> | null = null
  private bootSettle: { resolve: () => void; reject: (e: Error) => void } | null = null
  private readonly progressListeners = new Set<(p: ProgressReport) => void>()
  private lastProgress: ProgressReport | null = null

  private active: Active | null = null

  /** In-flight `format` requests, keyed by the id `format()` handed the worker. */
  private readonly formatRequests = new Map<number, { resolve: (code: string) => void; reject: (e: Error) => void }>()
  private nextFormatId = 1

  private readonly encoder = new TextEncoder()
  /** Non-shared staging buffer: TextEncoder refuses to write into a shared view. */
  private readonly scratch = new Uint8Array(STDIN_CAPACITY)

  constructor(options: PythonRuntimeOptions = {}) {
    this.indexURL = options.indexURL
    this.isatty = options.isatty === true
  }

  /** Version of Python that will be used, once loaded. */
  version: string | null = null

  /**
   * Boot the interpreter. Idempotent: concurrent and repeated calls share one
   * boot, and calling it when already warm resolves immediately. Every caller
   * gets the progress messages of whichever boot is in flight, including the
   * silent respawn started by `kill()`.
   */
  async load(onProgress: (p: ProgressReport) => void): Promise<void> {
    this.progressListeners.add(onProgress)
    if (this.booting && this.lastProgress) onProgress(this.lastProgress)
    const boot = this.booting ?? (this.booting = this.spawn())
    try {
      await boot
    } catch (error) {
      // Don't cache a failed boot: the next load()/run() should retry.
      if (this.booting === boot) this.booting = null
      throw error
    } finally {
      this.progressListeners.delete(onProgress)
    }
  }

  /** Any `.py` entry can run under the debugger. */
  canDebug(entryPath: string): boolean {
    return /\.py$/i.test(entryPath)
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession> {
    if (this.active && !this.active.ended) {
      throw new Error('A Python program is already running; kill() it before running another.')
    }

    const entry = normalizePath(entryPath)
    const payload: Record<string, string> = {}
    for (const file of files) payload[normalizePath(file.path)] = file.content
    if (!(entry in payload)) {
      throw new Error(`Entry file ${entryPath} is not in the file set.`)
    }

    await this.load(() => {})
    const worker = this.worker
    const ctrl = this.ctrl
    if (!worker || !ctrl) throw new Error('Python runtime is not ready.')

    const debugOpts = opts?.debug
    const active: Active = {
      io,
      ended: false,
      awaitingStdin: false,
      debug: debugOpts ? { parked: false, queue: [], inflight: null } : null,
    }
    this.active = active

    // A line submitted after a previous kill may still be sitting in the buffer.
    Atomics.store(ctrl, 0, STATE_EMPTY)

    let debug: { stopOnEntry: boolean } | null = null
    if (debugOpts) {
      const dctl = this.dbgCtrl
      if (!dctl) throw new Error('Python runtime is not ready.')
      Atomics.store(dctl, DBG_REQ, 0)
      Atomics.store(dctl, DBG_PAUSE, 0)
      this.writeBreakpoints(debugOpts.breakpoints)
      debug = { stopOnEntry: debugOpts.stopOnEntry === true }
    }

    worker.postMessage({ type: 'run', files: payload, entry, debug })

    const session: PythonRunSession = {
      kill: () => this.killSession(active),
      writeStdin: (line: string) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active),
    }
    if (active.debug) session.debug = this.debugSession(active, active.debug)
    return session
  }

  /**
   * True once this runtime's worker has finished booting Pyodide. Callers use
   * this to decide whether `format()` is safe to call without silently paying
   * the ~11 MB Pyodide download as a side effect of a "Format file" click.
   */
  isReady(): boolean {
    return this.worker !== null && this.version !== null
  }

  /**
   * Reformat one file's source with black, run inside this runtime's own
   * worker so the interpreter is not booted twice. The first call per page
   * load pays for `micropip.install("black")` (~500 KB of pure-Python wheels,
   * cached by the browser thereafter); every call after that is just
   * `black.format_str()` on an already-imported module.
   *
   * Rejects rather than hangs when a program is currently running: the worker
   * has exactly one thread, `run()` occupies it synchronously end to end, and
   * a `format` message sent during that window would only sit in the queue
   * until the program exits or is killed — which reads to a student as "the
   * Format button did nothing".
   */
  async format(code: string): Promise<string> {
    if (this.active && !this.active.ended) {
      throw new Error('A Python program is running; stop it before formatting.')
    }
    if (!this.isReady()) {
      throw new Error('Python runtime is not ready.')
    }
    const worker = this.worker
    if (!worker) throw new Error('Python runtime is not ready.')

    const id = this.nextFormatId++
    const result = new Promise<string>((resolve, reject) => this.formatRequests.set(id, { resolve, reject }))
    worker.postMessage({ type: 'format', id, code })
    return result
  }

  /**
   * Give up this runtime's worker for good: the page is closing, or the shell
   * has decided the engine can no longer be trusted.
   *
   * A live session is reported as killed first, then the worker is terminated
   * WITHOUT a replacement. It used to route through `killSession`, which
   * respawns because the student is expected to press Run again — so disposing
   * during a run left a fresh Pyodide booting behind a page that was being
   * unloaded, on exactly the memory-starved iPad the dispose was for.
   */
  dispose(): void {
    this.finish(null)
    this.teardown()
  }

  // --- worker lifecycle -----------------------------------------------------

  private spawn(): Promise<void> {
    if (typeof SharedArrayBuffer !== 'function' || self.crossOriginIsolated !== true) {
      this.booting = null
      return Promise.reject(new Error(NOT_ISOLATED))
    }

    if (!this.sab) {
      this.sab = new SharedArrayBuffer(HEADER_BYTES + STDIN_CAPACITY)
      this.ctrl = new Int32Array(this.sab, 0, 2)
      this.data = new Uint8Array(this.sab, HEADER_BYTES)
    }
    // A FRESH debugger buffer per worker, unlike stdin's: terminate() on a
    // worker parked in the debugger's Atomics.wait loop does not take effect
    // at once, and a dying worker still polling a shared request slot would
    // swallow the next session's requests (measured: kill while parked, then
    // the next debug run's evaluate/resume never answered).
    this.dbgSab = new SharedArrayBuffer(DBG_HEADER_BYTES + 2 * DBG_REGION_BYTES)
    this.dbgCtrl = new Int32Array(this.dbgSab, 0, DBG_HEADER_BYTES >> 2)
    this.dbgBytes = new Uint8Array(this.dbgSab, DBG_HEADER_BYTES)

    this.lastProgress = null

    // `new URL(...)` + { type: 'module' } is what lets Vite/Rollup discover,
    // bundle and hash the worker. A module worker is mandatory, not a
    // preference -- see the header comment in worker.js.
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })
    this.worker = worker

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (this.worker === worker) this.onMessage(ev.data)
    }
    worker.onerror = (ev: ErrorEvent) => {
      if (this.worker !== worker) return
      // A module worker that fails to parse fires an ErrorEvent with no message.
      const text = ev.message || 'worker failed to start (no message; check the console)'
      this.failBoot(new Error(text))
      this.finish(1, text)
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.bootSettle = { resolve, reject }
    })
    worker.postMessage({
      type: 'init',
      sab: this.sab,
      dbgSab: this.dbgSab,
      indexURL: this.indexURL,
      isatty: this.isatty,
    })
    return promise
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'progress': {
        // The worker reports the structured shape (phase + optional byte counts);
        // forward it as-is so the shell can draw a determinate bar. Rebuilt rather
        // than passed through so no worker-internal field leaks into the contract.
        const report: ProgressReport = {
          phase: msg.phase,
          message: msg.message,
          ...(typeof msg.loaded === 'number' ? { loaded: msg.loaded } : {}),
          ...(typeof msg.total === 'number' ? { total: msg.total } : {}),
        }
        // Once this worker is ready, progress can only come from inside a run:
        // the packages a program imports downloading before it starts
        // (worker.js, loadImportedPackages). That belongs to the run, not to a
        // boot, so it must not become lastProgress -- load() would replay it on
        // every later run. (Not `version`: that survives a kill() respawn.)
        if (!this.bootSettle) {
          if (this.active && !this.active.ended) this.active.io.onProgress?.(report)
          return
        }
        this.lastProgress = report
        for (const listener of this.progressListeners) listener(report)
        return
      }

      case 'ready':
        this.version = msg.version
        this.lastProgress = null
        this.bootSettle?.resolve()
        this.bootSettle = null
        return

      case 'stdout':
        this.active?.io.onStdout(msg.text)
        return

      case 'files':
        // Always strictly before 'done' (the worker posts them in that order).
        this.active?.io.onFilesChanged?.({ written: msg.written, deleted: msg.deleted, skipped: msg.skipped })
        return

      case 'stderr':
        this.active?.io.onStderr(msg.text)
        return

      case 'stdin-request':
        if (this.active && !this.active.ended) {
          this.active.awaitingStdin = true
          this.active.io.onStdinRequest()
        }
        return

      case 'done':
        this.finish(msg.code)
        return

      case 'fatal':
        if (msg.duringBoot) {
          this.failBoot(new Error(msg.text))
          this.finish(1, msg.text)
          return
        }
        this.finish(1, `\n[python runtime error] ${msg.text}\n`)
        return

      case 'formatted':
        this.formatRequests.get(msg.id)?.resolve(msg.code)
        this.formatRequests.delete(msg.id)
        return

      case 'format-error':
        this.formatRequests.get(msg.id)?.reject(new Error(msg.message))
        this.formatRequests.delete(msg.id)
        return

      case 'debug-stop': {
        const active = this.active
        if (!active || active.ended || !active.debug) return
        active.debug.parked = true
        active.io.onDebugStop?.(msg.stopped)
        return
      }

      case 'debug-resume': {
        const active = this.active
        if (!active || active.ended || !active.debug) return
        active.io.onDebugResume?.()
        return
      }

      case 'debug-reply': {
        const dbg = this.active?.debug
        const inflight = dbg?.inflight
        if (!dbg || !inflight || inflight.id !== msg.id) return
        dbg.inflight = null
        if (msg.ok) inflight.resolve(msg.result)
        else inflight.reject(new Error(msg.error ?? 'Evaluation failed'))
        this.pumpDebug(dbg)
        return
      }
    }
  }

  private failBoot(error: Error): void {
    const settle = this.bootSettle
    this.bootSettle = null
    // Let the next load()/run() try again from scratch.
    this.booting = null
    this.worker?.terminate()
    this.worker = null
    settle?.reject(error)
  }

  private teardown(): void {
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.bootSettle = null
    this.active = null
    for (const req of this.formatRequests.values()) req.reject(new Error('Python runtime was torn down.'))
    this.formatRequests.clear()
  }

  /** End the current session exactly once. `code` null means killed. */
  private finish(code: number | null, stderrNote?: string): void {
    const active = this.active
    if (!active || active.ended) return
    active.ended = true
    active.awaitingStdin = false
    this.active = null
    if (active.debug) this.failDebugRequests(active.debug, 'The program has ended.')
    if (stderrNote) active.io.onStderr(stderrNote)
    active.io.onExit(code)
  }

  // --- session operations ---------------------------------------------------

  private killSession(active: Active): void {
    if (active.ended) return
    // terminate() kills the thread even mid-Atomics.wait and mid-CPU-loop.
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.bootSettle = null
    this.finish(null)
    // A killed worker cannot answer any format() still waiting on it (format()
    // itself refuses to start one while a run is active, but a request from
    // just before Run was pressed could still be in flight).
    for (const req of this.formatRequests.values()) req.reject(new Error('Python runtime was killed.'))
    this.formatRequests.clear()
    // Respawn immediately so the next run() only waits for whatever is left of
    // the ~1.5 s Pyodide boot. Failures here are surfaced on the next
    // load()/run(); spawn() resets `booting` so a retry is possible.
    this.booting = this.spawn()
    this.booting.catch(() => {})
  }

  // --- debugger -------------------------------------------------------------

  private debugSession(active: Active, dbg: DebugState): DebugSession {
    const request = <T>(req: DebugRequest): Promise<T> => {
      if (active.ended) return Promise.reject(new Error('The program has ended.'))
      if (!dbg.parked) return Promise.reject(new Error('The program is running; pause it first.'))
      return new Promise<T>((resolve, reject) => {
        dbg.queue.push({ id: this.nextDebugId++, req, resolve: resolve as (v: unknown) => void, reject })
        this.pumpDebug(dbg)
      })
    }
    return {
      resume: (cmd: DebugStepCommand) => {
        if (active.ended || !dbg.parked) return
        dbg.parked = false
        // Queued after any in-flight inspection; nothing queued behind it can
        // be answered any more, since the program will no longer be parked.
        const stale = dbg.queue.splice(0)
        for (const q of stale) q.reject(new Error('The program resumed.'))
        dbg.queue.push({ id: this.nextDebugId++, req: { kind: 'resume', cmd }, resolve: () => {}, reject: () => {} })
        this.pumpDebug(dbg)
      },
      pause: () => {
        if (active.ended || dbg.parked || !this.dbgCtrl) return
        Atomics.store(this.dbgCtrl, DBG_PAUSE, 1)
      },
      setBreakpoints: (bps: DebugBreakpoint[]) => {
        if (active.ended) return
        this.writeBreakpoints(bps)
      },
      variables: (ref: number) => request<DebugValue[]>({ kind: 'variables', ref }),
      evaluate: (expr: string, frameIndex: number) => request<DebugValue>({ kind: 'evaluate', expr, frame: frameIndex }),
    }
  }

  /** Hand the next queued request to the parked worker, if the slot is free. */
  private pumpDebug(dbg: DebugState): void {
    const dctl = this.dbgCtrl
    const bytes = this.dbgBytes
    if (!dctl || !bytes || dbg.inflight) return
    const next = dbg.queue.shift()
    if (!next) return
    const json = JSON.stringify({ id: next.id, ...next.req })
    const { written } = this.encoder.encodeInto(json, this.scratch)
    bytes.set(this.scratch.subarray(0, written ?? 0), DBG_REGION_BYTES)
    if (next.req.kind !== 'resume') dbg.inflight = { id: next.id, resolve: next.resolve, reject: next.reject }
    Atomics.store(dctl, DBG_REQLEN, written ?? 0)
    Atomics.store(dctl, DBG_REQ, 1)
    Atomics.notify(dctl, DBG_REQ)
  }

  private failDebugRequests(dbg: DebugState, message: string): void {
    dbg.parked = false
    const pending: { reject: (e: Error) => void }[] = dbg.queue.splice(0)
    if (dbg.inflight) pending.push(dbg.inflight)
    dbg.inflight = null
    for (const p of pending) p.reject(new Error(message))
  }

  /**
   * Publish the breakpoint set through a seqlock: BPGEN is odd while the bytes
   * are being written, so the worker (a real parallel thread) can retry a torn
   * read instead of parsing half a JSON document.
   */
  private writeBreakpoints(bps: DebugBreakpoint[]): void {
    const dctl = this.dbgCtrl
    const bytes = this.dbgBytes
    if (!dctl || !bytes) return
    const list: [string, number][] = []
    for (const bp of bps) {
      try {
        list.push([normalizePath(bp.path), bp.line | 0])
      } catch {
        // A path the worker could never match is simply not a breakpoint.
      }
    }
    const { written } = this.encoder.encodeInto(JSON.stringify(list), this.scratch)
    if ((Atomics.load(dctl, DBG_BPGEN) & 1) === 0) Atomics.add(dctl, DBG_BPGEN, 1)
    bytes.set(this.scratch.subarray(0, written ?? 0), 0)
    Atomics.store(dctl, DBG_BPLEN, written ?? 0)
    Atomics.add(dctl, DBG_BPGEN, 1)
  }

  private writeStdin(active: Active, line: string): void {
    if (active.ended || !active.awaitingStdin) return
    const ctrl = this.ctrl
    const data = this.data
    if (!ctrl || !data) return

    // One line, no trailing newline: the worker appends it.
    const text = line.replace(/\r?\n$/, '')
    // Encode into the private buffer first (TextEncoder rejects shared views),
    // and via encodeInto so an over-long line is truncated on a code-point
    // boundary instead of producing invalid UTF-8.
    const { read, written } = this.encoder.encodeInto(text, this.scratch)
    const length = written ?? 0
    if (read < text.length) {
      active.io.onStderr(`\n[Warsha: input truncated to ${STDIN_CAPACITY >> 10} KiB]\n`)
    }
    data.set(this.scratch.subarray(0, length), 0)

    active.awaitingStdin = false
    Atomics.store(ctrl, 1, length)
    Atomics.store(ctrl, 0, STATE_LINE)
    Atomics.notify(ctrl, 0)
  }

  private writeEof(active: Active): void {
    if (active.ended || !active.awaitingStdin) return
    const ctrl = this.ctrl
    if (!ctrl) return
    active.awaitingStdin = false
    Atomics.store(ctrl, 1, 0)
    Atomics.store(ctrl, 0, STATE_EOF)
    Atomics.notify(ctrl, 0)
  }
}

/** "./a/b.py", "/a/b.py" and "a//b.py" all become "a/b.py"; ".." is rejected. */
function normalizePath(path: string): string {
  const parts = path.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) throw new Error(`Unsupported file path: ${path}`)
  return parts.join('/')
}
