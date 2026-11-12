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

export interface RunIO extends DebugIO {
  /** One call per Python-level write. Partial lines arrive as partial chunks. */
  onStdout(text: string): void
  onStderr(text: string): void
  /** The program is blocked in input(); the console should focus its input line. */
  onStdinRequest(): void
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
  /** 0 = clean exit, non-zero = program error, null = killed. Fires exactly once. */
  onExit(code: number | null): void
  /** OPTIONAL — progress from inside a run, not the boot before it: Python reports the packages a program imports (numpy, pandas) downloading before it starts. */
  onProgress?(report: ProgressReport): void
}

export interface RunSession {
  kill(): void
  writeStdin(line: string): void
  /** Present when the run was started with `opts.debug`. */
  debug?: DebugSession
}

export interface Runtime {
  readonly id: 'java' | 'python'
  /** Heavy engine bootstrap. Idempotent; safe to call concurrently. */
  load(onProgress: (p: ProgressReport) => void): Promise<void>
  run(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession>
  /** True when `entryPath` can run under the debugger. */
  canDebug?(entryPath: string): boolean
}

/** Files a run created, modified or removed — see `RunIO.onFilesChanged`. */
export interface FilesChange {
  written: SourceFile[]
  deleted: string[]
  skipped: string[]
}

/* --- Debug protocol ---------------------------------------------------------
 *
 * MIRROR of app/src/runtime/debug.ts (read its header for the lifecycle). Kept
 * structurally identical so PythonRuntime satisfies the app's Runtime type.
 */

export interface DebugBreakpoint {
  path: string
  line: number
}

export interface DebugOptions {
  breakpoints: DebugBreakpoint[]
  stopOnEntry?: boolean
}

export type DebugStopReason = 'entry' | 'breakpoint' | 'step' | 'pause' | 'exception'

export interface DebugValue {
  name: string
  value: string
  type?: string
  ref?: number
  children?: DebugValue[]
}

export interface DebugScope {
  name: string
  variables: DebugValue[]
  expensive?: boolean
}

export interface DebugFrame {
  name: string
  path: string
  line: number
  column?: number
  scopes: DebugScope[]
}

export interface DebugStopped {
  reason: DebugStopReason
  description?: string
  frames: DebugFrame[]
}

export type DebugStepCommand = 'continue' | 'stepOver' | 'stepInto' | 'stepOut'

export interface DebugSession {
  resume(cmd: DebugStepCommand): void
  pause(): void
  setBreakpoints(bps: DebugBreakpoint[]): void
  variables(ref: number): Promise<DebugValue[]>
  evaluate?(expr: string, frameIndex: number): Promise<DebugValue>
}

export interface DebugIO {
  onDebugStop?(stopped: DebugStopped): void
  onDebugResume?(): void
}

export interface RunOptions {
  debug?: DebugOptions
}
