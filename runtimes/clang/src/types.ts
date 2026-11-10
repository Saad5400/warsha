/**
 * Mirror of app/src/runtime/types.ts, kept here so this package never imports
 * from app/. If the app contract changes, change both files AND the FromWorker
 * union in clangRuntime.ts (the one place the worker protocol meets the contract).
 */

export interface SourceFile {
  path: string
  content: string
}

export type LoadPhase = 'download' | 'unpack' | 'boot' | 'compile'

export interface LoadProgress {
  phase: LoadPhase
  message: string
  loaded?: number
  total?: number
}

export type ProgressReport = LoadProgress | string

export interface RunIO extends DebugIO {
  onStdout(text: string): void
  onStderr(text: string): void
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
  onExit(code: number | null): void
  onRender?(srcdoc: string): void
}

export interface RunSession {
  kill(): void
  writeStdin(line: string): void
  debug?: DebugSession
}

export type RuntimeKind = 'console' | 'preview'

export interface Runtime {
  readonly id: string
  readonly kind?: RuntimeKind
  load(onProgress: (p: ProgressReport) => void): Promise<void>
  run(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession>
  canDebug?(entryPath: string): boolean
  dispose?(): void
  format?(code: string): Promise<string>
  isReady?(): boolean
}

/** Files a run created, modified or removed — see `RunIO.onFilesChanged`. */
export interface FilesChange {
  written: SourceFile[]
  deleted: string[]
  skipped: string[]
}

// --- debug protocol (mirror of app/src/runtime/debug.ts) ----------------------

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
