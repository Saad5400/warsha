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

export interface RunIO {
  onStdout(text: string): void
  onStderr(text: string): void
  onStdinRequest(): void          // console should focus its input line
  onExit(code: number | null): void
  /** OPTIONAL — only `kind: 'preview'` runtimes call this, handing the shell a full HTML document for the iframe, rebuilt every run. Console runtimes (Java, Python) ignore it; the preview's console output still flows through `onStdout`/`onStderr`. */
  onRender?(srcdoc: string): void
  /** OPTIONAL — progress from inside a run, not the boot before it. Java needs this: its compiler takes ~12s before any output, and without it the console sits on the empty-state placeholder the whole time. */
  onProgress?(report: ProgressReport): void
}
export interface RunSession { kill(): void; writeStdin(line: string): void }

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
  run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession>
  /** OPTIONAL — discards the engine (kills any session, terminates the worker); the next load()/run() boots fresh. Called when the shell has lost faith (Stop with no onExit, or unload) since there's no 'worker died' event. */
  dispose?(): void
  /** OPTIONAL — engine-side reformat. Only `PythonRuntime` implements it (via lazily-installed black); Java formats through prettier off-thread instead. Callers must check `isReady()` first, or a format call would silently trigger the full engine download. */
  format?(code: string): Promise<string>
  /** OPTIONAL — true once bootstrap has finished, so a caller can offer `format` without triggering it as a side effect. Undefined where no caller needs to ask (Java). */
  isReady?(): boolean
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
