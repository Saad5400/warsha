import type { DebugIO, DebugSession, RunOptions } from './debug'
export type * from './debug'

export interface SourceFile { path: string; content: string }        // path like "app/Main.java" or "main.py"

/**
 * Engine bootstrap progress (DESIGN-SPEC §7.6). A bare string can't drive a
 * determinate bar without UI parsing prose, so `load` reports a structured
 * object; a legacy `(msg: string)` engine still works via `normalizeProgress`,
 * degrading to an indeterminate sweep.
 */
export type LoadPhase = 'download' | 'unpack' | 'boot' | 'compile'

export interface LoadProgress {
  phase: LoadPhase
  message: string          // human-readable fallback
  loaded?: number          // bytes so far
  total?: number           // bytes expected, when Content-Length is known
}

/**
 * Both forms accepted on purpose: `LoadProgress` drives the bar/counter;
 * `string` is LEGACY for engines on the old signature (`normalizeProgress`
 * wraps it). DO NOT remove the string arm — breaking change for unmigrated
 * engines.
 */
export type ProgressReport = LoadProgress | string

export interface RunIO extends DebugIO {
  onStdout(text: string): void
  onStderr(text: string): void
  onStdinRequest(): void          // console should focus its input line
  /**
   * OPTIONAL — what the program did to the project's files, reported once,
   * strictly BEFORE onExit. The program's working directory is the project
   * root, so `open("out.txt", "w")` / `new FileWriter("out.txt")` /
   * `File.WriteAllText("out.txt", …)` / `fopen("out.txt", "w")` land here and
   * the shell writes them back into the project. `written` holds new and
   * modified text files; `deleted` holds project paths the program removed.
   * `skipped` names files that could not come back (binary, or too large).
   */
  onFilesChanged?(change: FilesChange): void
  onExit(code: number | null): void
  /** OPTIONAL — only `kind: 'preview'` runtimes call this, handing the shell a full HTML document for the iframe, rebuilt every run. Console runtimes (Java, Python) ignore it; the preview's console output still flows through `onStdout`/`onStderr`. */
  onRender?(srcdoc: string): void
  /** OPTIONAL — progress from inside a run, not the boot before it. Java needs this: its compiler takes ~12s before any output, and without it the console sits on the empty-state placeholder the whole time. */
  onProgress?(report: ProgressReport): void
  /**
   * OPTIONAL — the program's own code has begun, so whatever `onProgress`
   * reported (Java's compile, Python's package download) is over. Without it
   * the shell can only learn that from the first output, and a program that
   * computes in silence went on showing "Compiling your code" with its
   * counter climbing — and, 45 s in, was reported as a failed download.
   * Engines that report no run-phase progress need not call it.
   */
  onStarted?(): void
}
export interface RunSession {
  kill(): void
  writeStdin(line: string): void
  /** Present when the run was started with `opts.debug` on an engine that supports it. */
  debug?: DebugSession
}

/**
 * The output surface a runtime drives — 'console' streams stdout/stdin,
 * 'preview' renders into an iframe. The seam for future surfaces; the shell
 * branches on this, not on language id. Defaults to 'console' for pre-existing
 * engines.
 */
export type RuntimeKind = 'console' | 'preview'

export interface Runtime {
  readonly id: string
  /** Output surface this engine drives; absent means 'console' — the original contract (Java, Python). */
  readonly kind?: RuntimeKind
  /** Heavy, idempotent bootstrap. `ctx` (see `RunContext`) is optional and ignored by every engine but JavaScript, so `load(onProgress)` alone still satisfies this type. */
  load(onProgress: (p: ProgressReport) => void, ctx?: RunContext): Promise<void>
  run(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession>
  /** OPTIONAL — true when this engine can run `entryPath` under the debugger (see ./debug.ts). Absent → not debuggable. */
  canDebug?(entryPath: string): boolean
  /** OPTIONAL — discards the engine (kills any session, terminates the worker); the next load()/run() boots fresh. Called when the shell has lost faith (Stop with no onExit, or unload) since there's no 'worker died' event. */
  dispose?(): void
  /** OPTIONAL — engine-side reformat. Only `PythonRuntime` implements it (via lazily-installed black); Java formats through prettier off-thread instead. Callers must check `isReady()` first, or a format call would silently trigger the full engine download. */
  format?(code: string): Promise<string>
  /** OPTIONAL — true once bootstrap has finished, so a caller can offer `format` without triggering it as a side effect. Undefined where no caller needs to ask (Java). */
  isReady?(): boolean
  /** OPTIONAL — true while a run (or cell) occupies the engine; `format` would refuse then. */
  isBusy?(): boolean
}

/**
 * What a run is about to do, handed to `load()` so an engine can prepare for
 * this run specifically. Java/Python/C# ignore it; JavaScript needs it to tell
 * a free plain script from one needing the esbuild bundler (~12MB), so its own
 * progress bar can show.
 */
export interface RunContext {
  files: SourceFile[]
  entry: string
}

/** Accepts either shape, so an engine may report a plain string. */
export function normalizeProgress(p: ProgressReport): LoadProgress {
  return typeof p === 'string' ? { phase: 'boot', message: p } : p
}

/** Percent done, when the report carries both byte counts; null for an indeterminate phase. */
export function progressPercent(p: LoadProgress): number | null {
  if (typeof p.loaded !== 'number' || typeof p.total !== 'number' || p.total <= 0) return null
  return Math.min(100, Math.round((p.loaded / p.total) * 100))
}

/** Files a run created, modified or removed — see `RunIO.onFilesChanged`. */
export interface FilesChange {
  written: SourceFile[]
  deleted: string[]
  skipped: string[]
}

/**
 * THE NOTEBOOK KERNEL CONTRACT — a persistent interpreter for .ipynb notebooks.
 *
 * Unlike `run()`, which starts every program from nothing, a kernel keeps one
 * namespace per notebook (keyed by the notebook's path) alive across cells
 * until `restart(notebook)`. One cell runs at a time; everything else about a
 * cell's execution is a run's: stdin, the debugger, files written back, and
 * the session's `kill()`. A cell's rich outputs arrive as nbformat output
 * objects (`display_data`, `execute_result`, `error`) through `onOutput`, so
 * the shell stores exactly what lands in the .ipynb.
 */
export interface NotebookKernel {
  /** Bumps whenever the interpreter itself was replaced (a forced stop, a crash):
   *  every notebook's namespace is gone, and their execution counts with it. */
  readonly epoch: number
  load(onProgress: (p: ProgressReport) => void): Promise<void>
  /** Run one cell. `files` is the whole project, as for `run()`; it is the cell's working directory. */
  execute(files: SourceFile[], cell: CellRequest, io: CellIO, opts?: RunOptions): Promise<RunSession>
  /** Raise KeyboardInterrupt in the running cell; the namespace survives. */
  interrupt(): void
  /** Forget one notebook's namespace. Resolves once the kernel has done it. */
  restart(notebook: string): Promise<void>
  /** Reformat one cell's source (same engine as `Runtime.format`). */
  format?(code: string): Promise<string>
  isReady?(): boolean
  /** OPTIONAL — true while a run (or cell) occupies the engine; `format` would refuse then. */
  isBusy?(): boolean
  /** OPTIONAL — throw the engine away (a boot that stalled will never settle); the next load() starts fresh. */
  dispose?(): void
}

export interface CellRequest {
  /** The notebook's namespace key: stable for one open notebook (across renames), never reused. */
  notebook: string
  /** Which project the files belong to. A different one than the last cell's starts the kernel's
   *  working directory empty, so one project's files never show up in another's cells. */
  workspace?: string
  /** The cell's synthetic path (`nb.ipynb#cell=<id>`): its compile filename, breakpoint path and frame path. */
  cellPath: string
  /** What the student wrote (tracebacks quote it). */
  source: string
  /** `source` with IPython syntax rewritten to Python, line for line. */
  code: string
  cellMagic?: { name: string; args: string; body: string; python: boolean } | null
  /** Arguments of the cell's pip lines, installed before it runs. */
  pip?: string[]
}

export type CellOutputKind = 'display' | 'update' | 'result' | 'error'

export interface CellIO extends RunIO {
  /** The cell has started, as In[count]. */
  onExecuteInput?(count: number): void
  /** One nbformat output object. 'update' replaces the earlier output with the same `transient.display_id`. */
  onOutput?(kind: CellOutputKind, output: Record<string, unknown>): void
  /** IPython's clear_output(); `wait` means clear when the next output arrives. */
  onClearOutput?(wait: boolean): void
}
