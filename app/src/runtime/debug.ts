/**
 * THE DEBUG PROTOCOL — the contract between the shell's debugger UI and every
 * engine that can step through a program (Python, Java, C#, C, JavaScript/TS).
 *
 * Shape follows the Debug Adapter Protocol's ideas (stopped event, frames,
 * scopes, lazily-expanded variables), trimmed to what an in-browser engine can
 * honestly deliver. Engines MIRROR these types in their own `types.ts` (they
 * never import from app/), exactly as they do for the Runtime contract.
 *
 * Lifecycle
 *   shell: runtime.run(files, entry, io, { debug: { breakpoints, stopOnEntry } })
 *   engine runs the program; when it reaches a breakpoint / finishes a step /
 *   honours a pause, it PARKS THE PROGRAM (Atomics.wait or an awaited native —
 *   the same mechanism stdin uses) and calls io.onDebugStop(stopped).
 *   While parked, the shell may call session.debug.variables(ref) and
 *   session.debug.evaluate(expr, frame) any number of times; each resolves from
 *   the parked program's live state. Then exactly one of
 *   continue / stepOver / stepInto / stepOut releases it (engine then calls
 *   io.onDebugResume()). `pause` is sent while RUNNING and makes the program
 *   stop at its next instrumented line with reason 'pause'.
 *   setBreakpoints may arrive at any time (running or parked) and replaces the
 *   whole set.
 *
 * Lines are 1-based. Paths are project-relative, exactly as in SourceFile.
 * Only a stop in a USER file is ever reported — stepping into library code is
 * stepping over it.
 */

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

/**
 * One row in VARIABLES/WATCH. `value` is the one-line display string, VS Code
 * style per language: `42`, `3.5`, `true`/`True`, `'hi'` (Python) / `"hi"`,
 * `null`/`None`, `int[3]`, `[1, 2, 3]`, `Point {x: 1, y: 2}`, `0x1f3a (int*)`.
 */
export interface DebugValue {
  name: string
  value: string
  /** Static/runtime type name for the hover/tooltip: `int`, `list`, `Point`, `char*`. */
  type?: string
  /**
   * Non-zero → the value is expandable; call `session.debug.variables(ref)` to
   * get its children. Valid only until the program resumes. 0/undefined → leaf.
   */
  ref?: number
  /** Optional eager children (engine may pre-fill shallow levels); if present the shell does not call variables(ref). */
  children?: DebugValue[]
}

export interface DebugScope {
  /** 'Locals' | 'Globals' | 'this' | 'Statics' | 'Registers'… — shown as a group heading. */
  name: string
  variables: DebugValue[]
  /** Collapsed by default in the UI (VS Code collapses Globals). */
  expensive?: boolean
}

export interface DebugFrame {
  /** Function/method name as the language spells it: `main`, `Main.fib`, `<module>`, `Program.Main`. */
  name: string
  path: string
  line: number
  /** 1-based column if known (draws the inline stop marker); optional. */
  column?: number
  scopes: DebugScope[]
}

export interface DebugStopped {
  reason: DebugStopReason
  /** For 'exception': the one-line message, e.g. `ZeroDivisionError: division by zero`. */
  description?: string
  /** Innermost first. frames[0] is where execution is parked. */
  frames: DebugFrame[]
}

export type DebugStepCommand = 'continue' | 'stepOver' | 'stepInto' | 'stepOut'

/** The extra surface a debuggable RunSession exposes. */
export interface DebugSession {
  /** Release a parked program. Ignored if not parked. */
  resume(cmd: DebugStepCommand): void
  /** Ask a running program to stop at its next line. Ignored if parked. */
  pause(): void
  /** Replace the full breakpoint set. Allowed running or parked. */
  setBreakpoints(bps: DebugBreakpoint[]): void
  /** Children of an expandable value. Only while parked; rejects otherwise. */
  variables(ref: number): Promise<DebugValue[]>
  /**
   * OPTIONAL — evaluate an expression in frame `frameIndex` (0 = innermost)
   * while parked. Engines with a live interpreter (Python, JS) implement it;
   * compiled engines may omit it and the shell falls back to resolving
   * `a.b[2]`-style paths against the frame's variables.
   * Rejects with an Error whose message is the student-facing failure text.
   */
  evaluate?(expr: string, frameIndex: number): Promise<DebugValue>
}

export interface DebugIO {
  onDebugStop?(stopped: DebugStopped): void
  onDebugResume?(): void
}

export interface RunOptions {
  /** Present → run under the debugger. Absent → a plain run, zero instrumentation overhead. */
  debug?: DebugOptions
}
