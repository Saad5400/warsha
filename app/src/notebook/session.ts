/**
 * One open notebook's link to the kernel: the run queue, each cell's run
 * state, the kernel's status, a pending input(), and the debugger hookup.
 * Plain TS with subscribe()/get() (read from React via useSyncExternalStore),
 * the same shape as debug/store.ts — outside React because a run outlives the
 * renders it causes.
 *
 * The session never owns the notebook's content. Outputs, execution counts and
 * cleared cells go through the host's `update`, which is the view's model —
 * so there is one copy of a cell, and saving it is the view's business.
 *
 * Cells of every open notebook share one kernel worker (one Pyodide heap, the
 * expensive thing on a phone); `exclusive()` serialises them, so a cell of
 * notebook B queued behind a long cell of notebook A just waits its turn.
 */
import { useSyncExternalStore } from 'react'
import type { CellOutputKind, DebugStopped, FilesChange, LoadProgress, NotebookKernel, RunSession, SourceFile } from '../runtime/types'
import { COPY } from '../copy'
import { normalizeProgress, type ProgressReport } from '../runtime/types'
import { createStallWatchdog, type StallKind } from '../runtime/stallWatchdog'
import { debugStore } from '../debug/store'
import { transformCell } from './magics'
import { addOutput, appendStream, echoInput, hasDisplayId } from './outputs'
import { cellPath, type NbCell, type NbOutput } from './nbformat'

export type CellRunState = 'queued' | 'running' | 'ok' | 'error' | 'interrupted'
/** off: never started this page · starting: booting Python · idle · busy · interrupting */
export type KernelStatus = 'off' | 'starting' | 'idle' | 'busy' | 'interrupting'

export interface CellStatus {
  state: CellRunState
  /** Wall time of the last finished run, ms. */
  ms?: number
  startedAt?: number
}

export interface SessionState {
  kernel: KernelStatus
  cells: Readonly<Record<string, CellStatus>>
  running: string | null
  /** The cell parked in input(), if any. */
  waiting: string | null
  progress: LoadProgress | null
  /** A one-line notice for the toolbar ("Python restarted…"); cleared by the next run. */
  notice: string | null
  /** A debug run is in flight. */
  debugging: boolean
  /** A run of several cells stopped at this failing cell; `skipped` did not run (their
   *  outputs are from an earlier run). Cleared by the next run. */
  stoppedAt?: string | null
  skipped?: readonly string[]
}

export interface SessionHost {
  /** The project's files, as a run sees them (the cwd of every cell). */
  files(): SourceFile[]
  /** Which project those files belong to: the kernel keeps one project's files at a time. */
  workspace(): string
  cell(id: string): NbCell | undefined
  /** Replace one cell in the model. */
  update(id: string, fn: (cell: NbCell) => NbCell): void
  /** Every cell id, in order (for display-id updates that reach earlier cells). */
  cellIds(): string[]
  onFilesChanged(change: FilesChange): void
  /** Student-facing message when the kernel cannot start. */
  onFailure(message: string, detail: string): void
}

export interface SessionMessages {
  restarted: string
  forcedRestart: string
  lost: string
  /** Another debug session (the program's, or another notebook's) is live. */
  debugBusy: string
  /** A Run all (or Run below) stopped at a failing cell; n cells after it did not run. */
  stoppedAtError(n: number): string
}

/** How long an Interrupt may take. `escalateMs`: a cell whose code is RUNNING and has not
 *  stopped by then is not listening (native code), so the kernel is restarted. A cell still
 *  downloading its packages is given until `ceilingMs` — the worker honours the interrupt the
 *  moment the download ends — but a download that never ends is ended there the hard way.
 *  Mutable for tests. */
export const INTERRUPT_LIMITS = { escalateMs: 4000, ceilingMs: 30000 }
/** Stream chunks are applied to the model at most once a frame, or after this when frames stall (a background tab). */
const STREAM_FLUSH_MS = 100

let chain: Promise<unknown> = Promise.resolve()
/** One cell at a time across every notebook — they share the kernel's single thread. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

/** The notebook session currently running under the debugger — the debug toolbar's Stop interrupts it. */
let debugOwner: NotebookSession | null = null
export const notebookDebugOwner = (): NotebookSession | null => debugOwner

/** A namespace key for one open notebook: stable across renames, never reused by a later notebook of the same name. */
const newNamespaceKey = () => `nb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export class NotebookSession {
  private state: SessionState = { kernel: 'off', cells: {}, running: null, waiting: null, progress: null, notice: null, debugging: false }
  private listeners = new Set<() => void>()
  private queue: { id: string; debug: boolean }[] = []
  /** Bumped by every dropQueue: a cell already taken off the queue but still waiting for the
   *  kernel (behind another notebook's cell) checks it before it starts, and stands down. */
  private generation = 0
  /** The cell between the queue and the kernel: shifted, waiting its turn in `exclusive`. */
  private waitingTurn: string | null = null
  private session: RunSession | null = null
  private epoch = -1
  private escalate = 0
  private clearPending = false
  private pumping = false
  private debugCell: string | null = null
  private disposed = false
  /** The kernel namespace this notebook runs in. Not its path: a rename keeps the variables,
   *  and a new notebook reusing an old name starts clean. */
  readonly key = newNamespaceKey()

  constructor(
    public path: string,
    private readonly kernel: NotebookKernel,
    private readonly host: SessionHost,
    private readonly messages: () => SessionMessages,
  ) {}

  get = () => this.state
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private set(patch: Partial<SessionState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const fn of [...this.listeners]) fn()
  }
  private setCell(id: string, status: CellStatus | null) {
    const cells = { ...this.state.cells }
    if (status) cells[id] = status
    else delete cells[id]
    this.set({ cells })
  }

  /** Queue cells to run, in order. `debug` runs each under the debugger (breakpoints, stepping). */
  run(ids: string[], opts: { debug?: boolean } = {}) {
    if (this.disposed) return
    if (opts.debug && debugStore.busyFor(this)) {
      this.set({ notice: this.messages().debugBusy })
      return
    }
    for (const id of ids) {
      if (this.queue.some((q) => q.id === id) || this.state.running === id || this.waitingTurn === id) continue
      const cell = this.host.cell(id)
      if (!cell || cell.type !== 'code') continue
      this.queue.push({ id, debug: !!opts.debug })
      this.setCell(id, { state: 'queued' })
    }
    void this.pump()
  }

  /** Drop everything queued (Jupyter does this when a cell fails, and on Interrupt) — including a
   *  cell that already left the queue and is waiting for the kernel behind another notebook. */
  private dropQueue() {
    this.generation++
    const cells = { ...this.state.cells }
    for (const q of this.queue) delete cells[q.id]
    if (this.waitingTurn) delete cells[this.waitingTurn]
    this.waitingTurn = null
    this.queue = []
    this.set({ cells })
  }

  get busy(): boolean {
    return this.state.running !== null || this.queue.length > 0 || this.waitingTurn !== null
  }

  /** Set once the running cell's code has started (it has its In[n]): before that it is still
   *  downloading packages, which an interrupt waits out instead of killing the kernel. */
  private started = false

  interrupt() {
    this.dropQueue()
    if (!this.state.running) return
    this.set({ kernel: 'interrupting' })
    this.kernel.interrupt()
    clearTimeout(this.escalate)
    const running = this.state.running
    const asked = Date.now()
    const arm = () => {
      this.escalate = window.setTimeout(() => {
        if (this.state.running !== running || !this.session) return
        // Still downloading: wait for the download to end, up to the ceiling.
        if (!this.started && Date.now() - asked < INTERRUPT_LIMITS.ceilingMs) return arm()
        // Running and not listening (native code), or a download that never ends.
        this.set({ notice: this.messages().forcedRestart })
        this.session.kill()
      }, INTERRUPT_LIMITS.escalateMs)
    }
    arm()
  }

  /** The debug toolbar's Restart: stop the cell being debugged and debug it again from the top. */
  restartDebugging() {
    const id = this.debugCell
    if (!id) return
    const again = () => this.run([id], { debug: true })
    if (!this.state.running) return again()
    const off = this.subscribe(() => {
      if (!this.state.running) {
        off()
        again()
      }
    })
    this.interrupt()
  }

  /** Fresh namespace for this notebook. Interrupts first; outputs stay (as in Jupyter). */
  async restart() {
    if (this.busy) {
      this.interrupt()
      await new Promise<void>((resolve) => {
        const off = this.subscribe(() => {
          if (!this.state.running) {
            off()
            resolve()
          }
        })
        if (!this.state.running) {
          off()
          resolve()
        }
      })
    }
    await exclusive(() => this.kernel.restart(this.key))
    this.set({ cells: {}, notice: this.messages().restarted, kernel: this.state.kernel === 'off' ? 'off' : 'idle' })
  }

  writeStdin(line: string) {
    const id = this.state.waiting
    if (!id || !this.session) return
    this.flushStreams?.()
    this.host.update(id, (c) => ({ ...c, outputs: echoInput(c.outputs, line) }))
    this.set({ waiting: null })
    this.session.writeStdin(line)
  }

  /** The notebook was renamed. Its namespace is keyed by `key`, so its variables come along. */
  rename(path: string) {
    this.path = path
  }

  /** The notebook was closed: stop what it runs, free its namespace (Jupyter shuts its kernel
   *  down), and ignore anything the kernel still reports for it. */
  dispose() {
    if (this.disposed) return
    this.dropQueue()
    if (this.state.running) this.interrupt()
    this.disposed = true
    this.listeners.clear()
    if (debugOwner === this) debugOwner = null
    void exclusive(() => this.kernel.restart(this.key)).catch(() => {})
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length && !this.disposed) {
        const next = this.queue.shift()!
        const gen = this.generation
        this.waitingTurn = next.id
        await exclusive(async () => {
          this.waitingTurn = null
          // Interrupted, restarted or closed while waiting for another notebook's cell.
          if (gen !== this.generation || this.disposed) return
          await this.execute(next.id, next.debug)
        })
      }
    } finally {
      this.waitingTurn = null
      this.pumping = false
    }
  }

  private flushStreams: (() => void) | null = null
  /** Rejects the kernel boot this session is waiting on — the boot itself never settles once stalled. */
  private bootStalled: ((e: Error) => void) | null = null

  /**
   * Loading went quiet past the watchdog's budget. A stuck boot: the engine is
   * discarded and the boot's wait rejected, which fails the cell like any boot
   * failure (run it again to retry). A stuck package download inside a cell: the
   * cell is killed, as a forced stop would. 'timed out' / 'stalled' are what the
   * shell's failure classifier reads (offline / engine).
   */
  private stalled(kind: StallKind, booting: boolean) {
    const message = kind === 'download' ? 'timed out' : 'stalled'
    if (booting) {
      this.kernel.dispose?.()
      this.bootStalled?.(new Error(message))
      this.bootStalled = null
      return
    }
    if (!this.disposed) this.host.onFailure(message, message)
    if (this.session) this.session.kill()
    else this.kernel.dispose?.()
  }

  private async execute(id: string, debug: boolean): Promise<void> {
    const cell = this.host.cell(id)
    if (!cell) {
      this.setCell(id, null)
      return
    }
    const t0 = performance.now()
    this.started = false
    this.set({ running: id, kernel: this.state.kernel === 'off' ? 'starting' : this.state.kernel, notice: null, stoppedAt: null, skipped: (this.state.skipped ?? []).filter((s) => s !== id) })
    this.setCell(id, { state: 'running', startedAt: Date.now() })
    // Jupyter clears a cell's outputs when it starts, not when it ends.
    this.host.update(id, (c) => ({ ...c, outputs: [], executionCount: null }))
    this.clearPending = false

    // The program runner's stall watchdog, on the kernel's loading: its boot, then any
    // packages or pip installs the cell downloads before its code starts. A black-holed
    // network otherwise left the notebook on "Starting" for good. It never watches the
    // cell's own code (stopped at In[n], output, input() or exit).
    let booting = true
    const dog = createStallWatchdog((kind) => this.stalled(kind, booting))
    const watch = (p: ProgressReport) => {
      const n = normalizeProgress(p)
      dog.report(n)
      return n
    }
    try {
      dog.report(null)
      await new Promise<void>((resolve, reject) => {
        this.bootStalled = reject
        this.kernel.load((p) => this.set({ progress: watch(p), kernel: 'starting' })).then(resolve, reject)
      })
    } catch (e) {
      dog.stop()
      this.bootStalled = null
      this.set({ running: null, kernel: 'off', progress: null })
      this.setCell(id, { state: 'error' })
      this.dropQueue()
      if (!this.disposed) this.host.onFailure(String((e as Error)?.message ?? e), String(e))
      return
    }
    // A new interpreter (first boot, or after a forced stop) holds none of this notebook's variables.
    if (this.epoch !== -1 && this.epoch !== this.kernel.epoch) this.set({ notice: this.messages().lost })
    this.epoch = this.kernel.epoch
    dog.stop()
    booting = false
    this.bootStalled = null
    this.set({ kernel: 'busy', progress: null })

    const t = transformCell(cell.source)
    const path = cellPath(this.path, id)
    // Everything the kernel reports for a closed notebook is dropped.
    const live = () => !this.disposed
    const write = (fn: (outputs: NbOutput[]) => NbOutput[]) =>
      live() &&
      this.host.update(id, (c) => {
        const base = this.clearPending ? [] : c.outputs
        this.clearPending = false
        return { ...c, outputs: fn(base) }
      })

    // Streams are coalesced: a print loop sends thousands of chunks, and applying each
    // one to the model re-renders the cell. Chunks wait for the next frame (or 100 ms
    // if frames stall) and land as one update; any other event flushes them first, so
    // the order of what the cell printed and displayed is kept.
    let pending: { name: 'stdout' | 'stderr'; text: string }[] = []
    let frame = 0
    let timer = 0
    const flush = () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      frame = timer = 0
      if (!pending.length) return
      const chunks = pending
      pending = []
      write((o) => chunks.reduce((acc, c) => appendStream(acc, c.name, c.text), o))
    }
    this.flushStreams = flush
    const stream = (name: 'stdout' | 'stderr', text: string) => {
      const last = pending[pending.length - 1]
      if (last && last.name === name) last.text += text
      else pending.push({ name, text })
      if (!frame) frame = requestAnimationFrame(flush)
      if (!timer) timer = window.setTimeout(flush, STREAM_FLUSH_MS)
    }
    const before = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
      if (!live()) return
      flush()
      fn(...a)
    }

    const code = await new Promise<number | null>((resolve) => {
      if (debug) debugStore.begin(true, this)
      void this.kernel
        .execute(
          this.host.files(),
          { notebook: this.key, workspace: this.host.workspace(), cellPath: path, source: cell.source, code: t.code, cellMagic: t.cellMagic, pip: t.pip },
          {
            onStdout: (text) => {
              dog.stop()
              if (live()) stream('stdout', text)
            },
            onStderr: (text) => {
              dog.stop()
              if (live()) stream('stderr', text)
            },
            onProgress: (p) => this.set({ progress: watch(p) }),
            onStarted: () => dog.stop(),
            onExecuteInput: before((n: number) => {
              dog.stop()
              this.started = true
              this.set({ progress: null })
              this.host.update(id, (c) => ({ ...c, executionCount: n }))
            }),
            onOutput: before((kind: CellOutputKind, output: Record<string, unknown>) => {
              dog.stop()
              this.set({ progress: null })
              const out = output as NbOutput
              if (kind === 'update') {
                // update_display may target an output of any earlier cell.
                for (const other of this.host.cellIds()) {
                  const c = this.host.cell(other)
                  if (c && hasDisplayId(c.outputs, out)) this.host.update(other, (x) => ({ ...x, outputs: addOutput(x.outputs, 'update', out) }))
                }
                return
              }
              write((o) => addOutput(o, kind, out))
            }),
            onClearOutput: before((wait: boolean) => {
              if (wait) this.clearPending = true
              else this.host.update(id, (c) => ({ ...c, outputs: [] }))
            }),
            onStdinRequest: before(() => {
              dog.stop()
              this.set({ waiting: id })
            }),
            onFilesChanged: before((change: FilesChange) => this.host.onFilesChanged(change)),
            onDebugStop: before((stopped: DebugStopped) => debugStore.onStop(stopped, this)),
            onDebugResume: () => live() && debugStore.onResume(this),
            onExit: (c) => {
              dog.stop()
              flush()
              resolve(c)
            },
          },
          debug ? { debug: { breakpoints: debugStore.enabledBreakpoints() } } : undefined,
        )
        .then((s) => {
          this.session = s
          if (debug && s.debug) {
            debugOwner = this
            this.debugCell = id
            this.set({ debugging: true })
            debugStore.attach(s.debug, this)
          }
        })
        .catch((e) => {
          if (live()) this.host.onFailure(String((e as Error)?.message ?? e), String(e))
          resolve(1)
        })
    })

    flush()
    this.flushStreams = null
    clearTimeout(this.escalate)
    if (debug) {
      debugStore.end(this)
      if (debugOwner === this) debugOwner = null
    }
    this.session = null
    const ms = Math.round(performance.now() - t0)
    const last = this.host.cell(id)?.outputs.at(-1)
    const interrupted = code === null || (last?.output_type === 'error' && last.ename === 'KeyboardInterrupt')
    const state: CellRunState = code === 0 ? 'ok' : interrupted ? 'interrupted' : 'error'
    this.setCell(id, { state, ms })
    // Jupyter stops a Run all at the first failure; the cells after it would only fail too.
    // Say so, and which cells kept outputs from an earlier run (QA: Run all stopped silently).
    if (state !== 'ok') {
      const skipped = this.queue.map((q) => q.id).concat(this.waitingTurn ? [this.waitingTurn] : [])
      this.dropQueue()
      if (state === 'error' && skipped.length) this.set({ stoppedAt: id, skipped, notice: this.messages().stoppedAtError(skipped.length) })
    }
    if (code === null) this.epoch = -2 // the worker was replaced: report it on the next run
    this.set({ running: null, waiting: null, progress: null, debugging: false, kernel: 'idle' })
  }
}

export function useSession(session: NotebookSession): SessionState {
  return useSyncExternalStore(session.subscribe, session.get)
}

const noSession = () => () => {}
/** `useSession` for a session that may not exist (no notebook open): null then. */
export function useOptionalSession(session: NotebookSession | null): SessionState | null {
  return useSyncExternalStore(session ? session.subscribe : noSession, () => (session ? session.get() : null))
}

/** Anything running or waiting to: the one test the toolbar, the status bar and Run/Stop share. */
export const sessionBusy = (s: SessionState): boolean =>
  s.running !== null || Object.values(s.cells).some((c) => c.state === 'queued' || c.state === 'running')

/** A session's state in the shell's run vocabulary (status bar, Run/Stop control). */
export function runStatusOf(s: SessionState): 'idle' | 'preparing' | 'running' | 'waiting' {
  if (s.kernel === 'starting') return 'preparing'
  if (s.waiting) return 'waiting'
  return sessionBusy(s) ? 'running' : 'idle'
}

/** The kernel's state in words — the notebook toolbar's pill and the status bar read this one function. */
export function kernelLabel(s: SessionState): string {
  if (s.kernel === 'starting') return COPY.nbKernelStarting
  if (s.kernel === 'interrupting') return COPY.nbKernelInterrupting
  if (sessionBusy(s)) return COPY.nbKernelBusy
  return s.kernel === 'off' ? COPY.nbKernelOff : COPY.nbKernelIdle
}
