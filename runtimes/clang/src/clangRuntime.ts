import type { LoadPhase, ProgressReport, RunIO, RunSession, Runtime, SourceFile } from './types'

/** Bytes reserved in the shared buffer for one stdin line (matches the worker). */
const STDIN_CAPACITY = 64 * 1024
/** ctrl[0] = state, ctrl[1] = pending byte length. */
const HEADER_BYTES = 8

const STATE_EMPTY = 0
const STATE_LINE = 1
const STATE_EOF = 2

type FromWorker =
  | { type: 'progress'; phase: LoadPhase; message: string; loaded?: number; total?: number }
  | { type: 'ready'; version: string; bootMs: number }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'stdin-request' }
  | { type: 'done'; code: number; ms: number }
  | { type: 'fatal'; text: string; duringBoot?: boolean }

export interface ClangRuntimeOptions {
  /**
   * URL of the module worker (`clang.worker.js`). Defaults to
   * `warsha-clang.worker.js` at the app base, where the build's asset step copies
   * it (peer of `warsha-jvm.worker.js`). The worker imports @wasmer/sdk and the
   * WASI shim from a CDN for now; self-hosting them same-origin is the M3 item.
   */
  workerUrl?: string
}

/** A C run session; adds writeEof() so a reader loop can be ended (EOF button). */
export interface ClangRunSession extends RunSession {
  writeEof(): void
}

interface Active {
  io: RunIO
  ended: boolean
  awaitingStdin: boolean
}

const NOT_ISOLATED =
  'C needs cross-origin isolation (SharedArrayBuffer) to make scanf()/getchar() block. ' +
  'Load coi-serviceworker.js as a plain <script> in <head> and serve over HTTPS or localhost, then reload.'

/**
 * clang-wasm implementation of the app's `Runtime` contract.
 *
 * One instance owns one module worker; the worker downloads the clang toolchain
 * once, warms the WASI sysroot, and is reused across runs. Each run compiles the
 * student's .c files to a WASIX `.wasm` (clang diagnostics -> stderr, a compile
 * failure -> exit 1) and then executes it under a WASI shim ON the worker thread,
 * so stdin can block on the shared buffer (interactive scanf). `kill()` terminates
 * the worker and transparently respawns a replacement — the same shape as
 * CSharpRuntime, differing only in the engine it hosts and its byte-stream stdin.
 */
export class ClangRuntime implements Runtime {
  readonly id = 'c' as const

  private readonly workerUrl: string

  private worker: Worker | null = null
  private sab: SharedArrayBuffer | null = null
  private ctrl: Int32Array | null = null
  private data: Uint8Array | null = null

  private booting: Promise<void> | null = null
  private bootSettle: { resolve: () => void; reject: (e: Error) => void } | null = null
  private readonly progressListeners = new Set<(p: ProgressReport) => void>()
  private lastProgress: ProgressReport | null = null

  private active: Active | null = null

  private readonly encoder = new TextEncoder()
  /** Non-shared staging buffer: TextEncoder refuses to write into a shared view. */
  private readonly scratch = new Uint8Array(STDIN_CAPACITY)

  version: string | null = null

  constructor(options: ClangRuntimeOptions = {}) {
    this.workerUrl =
      options.workerUrl ?? new URL('warsha-clang.worker.js', document.baseURI).href
  }

  /**
   * Boot the engine. Idempotent: concurrent and repeated calls share one boot,
   * and calling it warm resolves immediately. Every caller gets the progress of
   * whichever boot is in flight, including the silent respawn started by kill().
   */
  async load(onProgress: (p: ProgressReport) => void): Promise<void> {
    this.progressListeners.add(onProgress)
    if (this.booting && this.lastProgress) onProgress(this.lastProgress)
    const boot = this.booting ?? (this.booting = this.spawn())
    try {
      await boot
    } catch (error) {
      if (this.booting === boot) this.booting = null
      throw error
    } finally {
      this.progressListeners.delete(onProgress)
    }
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
    if (this.active && !this.active.ended) {
      throw new Error('A C program is already running; kill() it before running another.')
    }

    const entry = normalizePath(entryPath)
    const payload: Record<string, string> = {}
    for (const file of files) {
      if (/\.(c|h)$/.test(file.path)) payload[normalizePath(file.path)] = file.content
    }
    if (!(entry in payload)) {
      throw new Error(`Entry file ${entryPath} is not a .c/.h file in the set.`)
    }

    await this.load(() => {})
    const worker = this.worker
    const ctrl = this.ctrl
    if (!worker || !ctrl) throw new Error('C runtime is not ready.')

    const active: Active = { io, ended: false, awaitingStdin: false }
    this.active = active

    // A line submitted after a previous kill may still be sitting in the buffer.
    Atomics.store(ctrl, 0, STATE_EMPTY)

    worker.postMessage({ type: 'run', files: payload, entry })

    const session: ClangRunSession = {
      kill: () => this.killSession(active),
      writeStdin: (line: string) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active),
    }
    return session
  }

  isReady(): boolean {
    return this.worker !== null && this.version !== null
  }

  /**
   * Give up this runtime's worker for good (page closing, or the shell switched
   * away). A live session is reported as killed, then the worker is terminated
   * WITHOUT a replacement — unlike kill(), which respawns.
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

    this.lastProgress = null

    const worker = new Worker(this.workerUrl, { type: 'module' })
    this.worker = worker

    worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      if (this.worker === worker) this.onMessage(ev.data)
    }
    worker.onerror = (ev: ErrorEvent) => {
      if (this.worker !== worker) return
      const text = ev.message || 'worker failed to start (no message; check the console)'
      this.failBoot(new Error(text))
      this.finish(1, text)
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.bootSettle = { resolve, reject }
    })
    worker.postMessage({ type: 'init', sab: this.sab })
    return promise
  }

  private onMessage(msg: FromWorker): void {
    switch (msg.type) {
      case 'progress': {
        const report: ProgressReport = {
          phase: msg.phase,
          message: msg.message,
          ...(typeof msg.loaded === 'number' ? { loaded: msg.loaded } : {}),
          ...(typeof msg.total === 'number' ? { total: msg.total } : {}),
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
        this.finish(1, `\n[c runtime error] ${msg.text}\n`)
        return
    }
  }

  private failBoot(error: Error): void {
    const settle = this.bootSettle
    this.bootSettle = null
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
    // terminate() kills the thread even mid-Atomics.wait and mid-CPU-loop — an
    // infinite loop in student code runs on the worker thread, so this is what
    // stops it.
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.bootSettle = null
    this.finish(null)
    // Respawn immediately so the next run() only waits for whatever is left of the
    // re-warm. Failures surface on the next load()/run().
    this.booting = this.spawn()
    this.booting.catch(() => {})
  }

  private writeStdin(active: Active, line: string): void {
    if (active.ended || !active.awaitingStdin) return
    const ctrl = this.ctrl
    const data = this.data
    if (!ctrl || !data) return

    // C reads a byte stream: scanf/fgets expect the '\n' the student pressed, so —
    // unlike C#'s ReadLine, which strips it — deliver exactly one trailing newline.
    const text = line.replace(/\r?\n$/, '') + '\n'
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

/** "./a/b.c", "/a/b.c" and "a//b.c" all become "a/b.c"; ".." is rejected. */
function normalizePath(path: string): string {
  const parts = path.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.some((p) => p === '..')) throw new Error(`Unsupported file path: ${path}`)
  return parts.join('/')
}
