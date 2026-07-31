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
}
export interface RunSession { kill(): void; writeStdin(line: string): void }
export interface Runtime {
  readonly id: 'java' | 'python'
  load(onProgress: (p: ProgressReport) => void): Promise<void>   // heavy engine bootstrap, idempotent
  run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession>
}

/** Accepts either shape, so an engine may report a plain string. */
export function normalizeProgress(p: ProgressReport): LoadProgress {
  return typeof p === 'string' ? { phase: 'boot', message: p } : p
}
