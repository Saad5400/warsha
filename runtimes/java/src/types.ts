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

// --- the debug protocol: MIRROR of app/src/runtime/debug.ts -------------------

export interface DebugBreakpoint {
  path: string
  line: number
}

export interface DebugOptions {
  breakpoints: DebugBreakpoint[]
  /** Stop on the first user line, as if a breakpoint were there. */
  stopOnEntry?: boolean
}

export type DebugStopReason = 'entry' | 'breakpoint' | 'step' | 'pause' | 'exception'

export interface DebugValue {
  name: string
  value: string
  type?: string
  /** Non-zero → expandable through `DebugSession.variables(ref)`, valid until resume. */
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
  /** Innermost first. */
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
  /** Present → run under the debugger. Absent → a plain run, no instrumentation. */
  debug?: DebugOptions
}

export interface RunIO extends DebugIO {
  /** One call per Java-level write. Partial lines arrive as partial chunks. */
  onStdout(text: string): void
  onStderr(text: string): void
  /** The program is blocked on a read; the console should focus its input line. */
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
  /** 0 = clean exit, non-zero = program or compile error, null = killed. Fires exactly once. */
  onExit(code: number | null): void
  /** Progress from inside the run — the compile. See the shell's RunIO. */
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
  canDebug?(entryPath: string): boolean
}

/** Files a run created, modified or removed — see `RunIO.onFilesChanged`. */
export interface FilesChange {
  written: SourceFile[]
  deleted: string[]
  skipped: string[]
}
