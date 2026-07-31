/* The IDE's Runtime contract.
 *
 * MIRROR of app/src/runtime/types.ts -- kept here so this module has no
 * dependency on the app source tree. The shapes are structurally identical, so
 * `PythonRuntime` satisfies the app's `Runtime` type without a cast; if the app
 * changes the contract, change this file to match.
 */

export interface SourceFile {
  /** Relative path inside the project, e.g. "main.py" or "helpers/shapes.py". */
  path: string
  content: string
}

/**
 * Engine bootstrap progress. `message` alone is always enough; `loaded`/`total`
 * drive a determinate bar, which is what 11.6 MiB of Pyodide on school wifi
 * needs. The `string` arm is legacy and stays: some engines still report prose.
 */
export type LoadPhase = 'download' | 'unpack' | 'boot' | 'compile'

export interface LoadProgress {
  phase: LoadPhase
  message: string
  loaded?: number
  total?: number
}

export type ProgressReport = LoadProgress | string

export interface RunIO {
  /** One call per Python-level write. Partial lines arrive as partial chunks. */
  onStdout(text: string): void
  onStderr(text: string): void
  /** The program is blocked in input(); the console should focus its input line. */
  onStdinRequest(): void
  /** 0 = clean exit, non-zero = program error, null = killed. Fires exactly once. */
  onExit(code: number | null): void
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
