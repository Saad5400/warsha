export interface SourceFile { path: string; content: string }        // path like "app/Main.java" or "main.py"

/**
 * Engine bootstrap progress (DESIGN-SPEC §7.6).
 *
 * The first Java download is tens of MB and the spec's contract is that
 * something numeric changes on screen at least every 2 seconds. A bare string
 * cannot drive a determinate bar or a byte counter without the UI parsing prose,
 * so `load` reports a structured object.
 *
 * `message` alone is always enough. An engine written against the original
 * `(msg: string)` signature can still call `onProgress('Unpacking…')`; the shell
 * normalises it (see `normalizeProgress`) and the UI degrades to an
 * indeterminate sweep with whatever counter it has.
 */
export type LoadPhase = 'download' | 'unpack' | 'boot' | 'compile'

export interface LoadProgress {
  phase: LoadPhase
  message: string          // human-readable fallback
  loaded?: number          // bytes so far
  total?: number           // bytes expected, when Content-Length is known
}

/**
 * Both forms are accepted, on purpose:
 *   • `LoadProgress` — the current form. Report this; it is what drives the
 *     determinate bar, the byte counter and the phase name.
 *   • `string` — LEGACY, still supported. Engines written against the original
 *     `load(onProgress: (msg: string) => void)` signature keep compiling and
 *     running; `normalizeProgress` wraps them and the UI degrades to an
 *     indeterminate sweep. DO NOT "clean up" this union — removing the string arm
 *     is a breaking change for any engine that has not migrated yet.
 */
export type ProgressReport = LoadProgress | string

export interface RunIO {
  onStdout(text: string): void
  onStderr(text: string): void
  onStdinRequest(): void          // console should focus its input line
  onExit(code: number | null): void
  /**
   * OPTIONAL, and only ever called by a `kind: 'preview'` runtime. Hand the
   * shell a complete HTML document to load into the preview iframe it owns; the
   * runtime rebuilds and re-emits it on every run. A console runtime never calls
   * this, and the shell leaves it undefined for one — so an engine that ignores
   * it (Java, Python) is unaffected. The preview's `console.log` and errors still
   * flow back through `onStdout`/`onStderr`, so the Console stays useful.
   */
  onRender?(srcdoc: string): void
}
export interface RunSession { kill(): void; writeStdin(line: string): void }

/**
 * Which output surface a runtime drives. This is the seam that lets Warsha grow
 * past a console: `'console'` engines (Java, Python) stream stdout/stdin, and a
 * `'preview'` engine renders a live document into an iframe. Future surfaces —
 * a full-stack sandbox, a database view — become new members here, and the
 * shell branches on this one field rather than on a language id.
 *
 * Optional and defaulting to `'console'`, so every engine written before this
 * union existed keeps its old meaning without a change.
 */
export type RuntimeKind = 'console' | 'preview'

export interface Runtime {
  readonly id: string
  /**
   * The output surface this engine drives. Absent means `'console'` — the
   * original contract, and what Java and Python are.
   */
  readonly kind?: RuntimeKind
  /**
   * Heavy engine bootstrap, idempotent. `ctx` describes the run this load is
   * for (see `RunContext`); it is optional and every current engine but
   * JavaScript ignores it, so an engine written as `load(onProgress)` still
   * satisfies this type.
   */
  load(onProgress: (p: ProgressReport) => void, ctx?: RunContext): Promise<void>
  run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession>
  /**
   * OPTIONAL. Throw the engine away: report any live session as killed,
   * terminate the worker and start nothing in its place. A later load()/run()
   * boots from scratch.
   *
   * The shell calls this when it has lost faith in the engine — a Stop that
   * produced no onExit, or the page going away — because there is no platform
   * event for "your worker died", and a worker the shell cannot prove is alive
   * must not be the reason Run stays disabled. An engine that does not
   * implement it simply keeps the worker it has; both runtimes do implement it.
   */
  dispose?(): void
  /**
   * OPTIONAL. Reformat one file's source engine-side. Only `PythonRuntime`
   * implements this (via black, lazily micropip-installed into the
   * already-booted interpreter) — Java formatting runs entirely off the main
   * thread through prettier and never touches CheerpJ, so `JavaRuntime` has no
   * need for it. Callers must check `isReady()` first: calling `format()`
   * before the engine has booted would silently pay the full engine download
   * just to format a file.
   */
  format?(code: string): Promise<string>
  /**
   * OPTIONAL. True once the engine's heavy bootstrap has already completed, so
   * a caller can offer an engine-side capability (see `format`) without
   * triggering that bootstrap as a side effect. Undefined for an engine, like
   * Java's, that no caller needs to ask.
   */
  isReady?(): boolean
}

/**
 * What a run is about to do, handed to `load()` so an engine can prepare for
 * *this* run rather than in the abstract.
 *
 * Java, Python and C# ignore it — their bootstrap is the same whatever the files
 * are. The JavaScript engine needs it: a plain one-file script runs with nothing
 * to download, but the moment the entry is TypeScript or reaches for another
 * module it needs the esbuild bundler (~12 MB, once). Only `load()` can show that
 * download's progress bar, and only with the files in hand can it tell the two
 * cases apart — so the shell passes them here.
 */
export interface RunContext {
  files: SourceFile[]
  entry: string
}

/** Accepts either shape, so an engine may report a plain string. */
export function normalizeProgress(p: ProgressReport): LoadProgress {
  return typeof p === 'string' ? { phase: 'boot', message: p } : p
}
