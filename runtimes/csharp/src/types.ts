/**
 * Mirror of app/src/runtime/types.ts, kept here so this package never imports
 * from app/. If the app contract changes, change both files AND the FromWorker
 * union in csharpRuntime.ts (the one place the worker protocol meets the
 * contract — the same seam where the Python runtime once lost every progress
 * report to a silently renamed field).
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

export interface RunIO {
  onStdout(text: string): void
  onStderr(text: string): void
  onStdinRequest(): void
  onExit(code: number | null): void
  onRender?(srcdoc: string): void
}

export interface RunSession {
  kill(): void
  writeStdin(line: string): void
}

export type RuntimeKind = 'console' | 'preview'

export interface Runtime {
  readonly id: string
  readonly kind?: RuntimeKind
  load(onProgress: (p: ProgressReport) => void): Promise<void>
  run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession>
  dispose?(): void
  format?(code: string): Promise<string>
  isReady?(): boolean
}
