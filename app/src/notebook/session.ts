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
import type { FilesChange, LoadProgress, NotebookKernel, RunSession, SourceFile } from '../runtime/types'
import { normalizeProgress } from '../runtime/types'
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
}

export interface SessionHost {
  /** The project's files, as a run sees them (the cwd of every cell). */
  files(): SourceFile[]
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
}

/** Interrupt that has not landed after this long (stuck in C code, a download) restarts the kernel. */
const INTERRUPT_ESCALATE_MS = 4000

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

export class NotebookSession {
  private state: SessionState = { kernel: 'off', cells: {}, running: null, waiting: null, progress: null, notice: null, debugging: false }
  private listeners = new Set<() => void>()
  private queue: { id: string; debug: boolean }[] = []
  private session: RunSession | null = null
  private epoch = -1
  private escalate = 0
  private clearPending = false
  private pumping = false

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
    for (const id of ids) {
      if (this.queue.some((q) => q.id === id) || this.state.running === id) continue
      const cell = this.host.cell(id)
      if (!cell || cell.type !== 'code') continue
      this.queue.push({ id, debug: !!opts.debug })
      this.setCell(id, { state: 'queued' })
    }
    void this.pump()
  }

  /** Drop everything queued (Jupyter does this when a cell fails, and on Interrupt). */
  private dropQueue() {
    const cells = { ...this.state.cells }
    for (const q of this.queue) delete cells[q.id]
    this.queue = []
    this.set({ cells })
  }

  get busy(): boolean {
    return this.state.running !== null || this.queue.length > 0
  }

  interrupt() {
    this.dropQueue()
    if (!this.state.running) return
    this.set({ kernel: 'interrupting' })
    this.kernel.interrupt()
    clearTimeout(this.escalate)
    const running = this.state.running
    this.escalate = window.setTimeout(() => {
      // Still the same cell: it is not listening (native code, a download). End it the hard way.
      if (this.state.running === running && this.session) {
        this.set({ notice: this.messages().forcedRestart })
        this.session.kill()
      }
    }, INTERRUPT_ESCALATE_MS)
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
      })
    }
    await exclusive(() => this.kernel.restart(this.path))
    this.set({ cells: {}, notice: this.messages().restarted, kernel: this.state.kernel === 'off' ? 'off' : 'idle' })
  }

  writeStdin(line: string) {
    const id = this.state.waiting
    if (!id || !this.session) return
    this.host.update(id, (c) => ({ ...c, outputs: echoInput(c.outputs, line) }))
    this.set({ waiting: null })
    this.session.writeStdin(line)
  }

  /** The notebook was renamed: its namespace keeps its old key until restart. */
  rename(path: string) {
    this.path = path
  }

  /** The notebook was closed: stop what it runs and free its namespace (Jupyter shuts its kernel down). */
  dispose() {
    this.dropQueue()
    if (this.state.running) this.interrupt()
    this.listeners.clear()
    void exclusive(() => this.kernel.restart(this.path)).catch(() => {})
  }

  private async pump() {
    if (this.pumping) return
    this.pumping = true
    try {
      while (this.queue.length) {
        const next = this.queue.shift()!
        await exclusive(() => this.execute(next.id, next.debug))
      }
    } finally {
      this.pumping = false
    }
  }

  private async execute(id: string, debug: boolean): Promise<void> {
    const cell = this.host.cell(id)
    if (!cell) {
      this.setCell(id, null)
      return
    }
    const t0 = performance.now()
    this.set({ running: id, kernel: this.state.kernel === 'off' ? 'starting' : this.state.kernel, notice: null })
    this.setCell(id, { state: 'running', startedAt: Date.now() })
    // Jupyter clears a cell's outputs when it starts, not when it ends.
    this.host.update(id, (c) => ({ ...c, outputs: [], executionCount: null }))
    this.clearPending = false

    try {
      await this.kernel.load((p) => this.set({ progress: normalizeProgress(p), kernel: 'starting' }))
    } catch (e) {
      this.set({ running: null, kernel: 'off', progress: null })
      this.setCell(id, { state: 'error' })
      this.dropQueue()
      this.host.onFailure(String((e as Error)?.message ?? e), String(e))
      return
    }
    // A new interpreter (first boot, or after a forced stop) holds none of this notebook's variables.
    if (this.epoch !== -1 && this.epoch !== this.kernel.epoch) this.set({ notice: this.messages().lost })
    this.epoch = this.kernel.epoch
    this.set({ kernel: 'busy', progress: null })

    const t = transformCell(cell.source)
    const path = cellPath(this.path, id)
    const write = (fn: (outputs: NbOutput[]) => NbOutput[]) =>
      this.host.update(id, (c) => {
        const base = this.clearPending ? [] : c.outputs
        this.clearPending = false
        return { ...c, outputs: fn(base) }
      })

    const code = await new Promise<number | null>((resolve) => {
      void this.kernel
        .execute(
          this.host.files(),
          { notebook: this.path, cellPath: path, source: cell.source, code: t.code, cellMagic: t.cellMagic, pip: t.pip },
          {
            onStdout: (text) => write((o) => appendStream(o, 'stdout', text)),
            onStderr: (text) => write((o) => appendStream(o, 'stderr', text)),
            onProgress: (p) => this.set({ progress: normalizeProgress(p) }),
            onExecuteInput: (n) => {
              this.set({ progress: null })
              this.host.update(id, (c) => ({ ...c, executionCount: n }))
            },
            onOutput: (kind, output) => {
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
            },
            onClearOutput: (wait) => {
              if (wait) this.clearPending = true
              else this.host.update(id, (c) => ({ ...c, outputs: [] }))
            },
            onStdinRequest: () => this.set({ waiting: id }),
            onFilesChanged: (change) => this.host.onFilesChanged(change),
            onDebugStop: (stopped) => debugStore.onStop(stopped),
            onDebugResume: () => debugStore.onResume(),
            onExit: (c) => resolve(c),
          },
          debug ? { debug: { breakpoints: debugStore.enabledBreakpoints() } } : undefined,
        )
        .then((s) => {
          this.session = s
          if (debug && s.debug) {
            debugOwner = this
            this.set({ debugging: true })
            debugStore.attach(s.debug)
          }
        })
        .catch((e) => {
          this.host.onFailure(String((e as Error)?.message ?? e), String(e))
          resolve(1)
        })
      if (debug) debugStore.begin(true)
    })

    clearTimeout(this.escalate)
    if (debug) {
      debugStore.end()
      if (debugOwner === this) debugOwner = null
    }
    this.session = null
    const ms = Math.round(performance.now() - t0)
    const last = this.host.cell(id)?.outputs.at(-1)
    const interrupted = code === null || (last?.output_type === 'error' && last.ename === 'KeyboardInterrupt')
    const state: CellRunState = code === 0 ? 'ok' : interrupted ? 'interrupted' : 'error'
    this.setCell(id, { state, ms })
    // Jupyter stops a Run all at the first failure; the cells after it would only fail too.
    if (state !== 'ok') this.dropQueue()
    if (code === null) this.epoch = -2 // the worker was replaced: report it on the next run
    this.set({ running: null, waiting: null, progress: null, debugging: false, kernel: 'idle' })
  }
}

export function useSession(session: NotebookSession): SessionState {
  return useSyncExternalStore(session.subscribe, session.get)
}
