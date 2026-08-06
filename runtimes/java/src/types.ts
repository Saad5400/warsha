/* The IDE's Runtime contract.
 *
 * MIRROR of app/src/runtime/types.ts -- kept here so this module has no
 * dependency on the app source tree. The shapes are structurally identical, so
 * `JavaRuntime` satisfies the app's `Runtime` type without a cast; if the app
 * changes the contract, change this file to match.
 */

export interface SourceFile {
  /** Relative path inside the project, e.g. "app/Main.java" or "models/Person.java". */
  path: string
  content: string
}

/**
 * Engine bootstrap progress.
 *
 * `message` alone is always enough; the shell normalises a bare string. This
 * runtime emits the richer object wherever it has real numbers to report -- the
 * engine download is measured in bytes, the compiler warm-up is not.
 */
export type LoadPhase = 'download' | 'unpack' | 'boot' | 'compile'

export interface LoadProgress {
  phase: LoadPhase
  message: string
  /** Bytes so far, when the phase is a measurable download. */
  loaded?: number
  /** Bytes expected, when Content-Length is known. */
  total?: number
}

export type ProgressReport = LoadProgress | string

export interface RunIO {
  /** One call per Java-level write. Partial lines arrive as partial chunks. */
  onStdout(text: string): void
  onStderr(text: string): void
  /** The program is blocked on a read; the console should focus its input line. */
  onStdinRequest(): void
  /** 0 = clean exit, non-zero = program or compile error, null = killed. Fires exactly once. */
  onExit(code: number | null): void
  /** Progress from inside the run — the compile. See the shell's RunIO. */
  onProgress?(report: ProgressReport): void
}

export interface RunSession {
  kill(): void
  writeStdin(line: string): void
}

export interface Runtime {
  readonly id: 'java' | 'python'
  /** Heavy engine bootstrap. Idempotent; safe to call concurrently. */
  load(onProgress: (p: ProgressReport) => void): Promise<void>
  run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession>
}
