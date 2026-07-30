import type { RunIO, RunSession, Runtime, SourceFile } from './types'

/** Bytes reserved in the shared buffer for one stdin line (matches the worker). */
const STDIN_CAPACITY = 64 * 1024
/** ctrl[0] = state, ctrl[1] = pending byte length. */
const HEADER_BYTES = 8

const STATE_EMPTY = 0
const STATE_LINE = 1
const STATE_EOF = 2

type FromWorker =
  | { type: 'progress'; text: string }
  | { type: 'ready'; version: string; bootMs: number }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'stdin-request' }
  | { type: 'done'; code: number; ms: number }
  | { type: 'fatal'; text: string; duringBoot?: boolean }

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

  /** In-flight or settled boot of the current worker. null = no worker yet. */
  private booting: Promise<void> | null = null
  private bootSettle: { resolve: () => void; reject: (e: Error) => void } | null = null
  private readonly progressListeners = new Set<(msg: string) => void>()
  private lastProgress: string | null = null

  private active: Active | null = null

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
  async load(onProgress: (msg: string) => void): Promise<void> {
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

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
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

    const active: Active = { io, ended: false, awaitingStdin: false }
    this.active = active

    // A line submitted after a previous kill may still be sitting in the buffer.
    Atomics.store(ctrl, 0, STATE_EMPTY)

    worker.postMessage({ type: 'run', files: payload, entry })

    const session: PythonRunSession = {
      kill: () => this.killSession(active),
      writeStdin: (line: string) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active),
    }
    return session
  }

  /** Terminate the worker without any run in flight (e.g. leaving the page). */
  dispose(): void {
    if (this.active && !this.active.ended) this.killSession(this.active)
    else this.teardown()
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
    worker.postMessage({ type: 'init', sab: this.sab, indexURL: this.indexURL, isatty: this.isatty })
    return promise
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'progress':
        this.lastProgress = msg.text
        for (const listener of this.progressListeners) listener(msg.text)
        return

      case 'ready':
        this.version = msg.version
        this.lastProgress = null
        this.bootSettle?.resolve()
        this.bootSettle = null
        return

      case 'stdout':
        this.active?.io.onStdout(msg.text)
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
  }

  /** End the current session exactly once. `code` null means killed. */
  private finish(code: number | null, stderrNote?: string): void {
    const active = this.active
    if (!active || active.ended) return
    active.ended = true
    active.awaitingStdin = false
    this.active = null
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
    // Respawn immediately so the next run() only waits for whatever is left of
    // the ~1.5 s Pyodide boot. Failures here are surfaced on the next
    // load()/run(); spawn() resets `booting` so a retry is possible.
    this.booting = this.spawn()
    this.booting.catch(() => {})
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
