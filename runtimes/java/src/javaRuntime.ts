import type {
  DebugBreakpoint,
  DebugFrame,
  DebugSession,
  DebugStepCommand,
  DebugStopReason,
  DebugValue,
  ProgressReport,
  RunIO,
  RunOptions,
  RunSession,
  Runtime,
  SourceFile,
} from './types'
import { instrumentJava, type JavaParserLike } from './instrument'

type FromWorker =
  | { type: 'progress'; phase: 'download' | 'unpack' | 'boot' | 'compile'; message: string; loaded?: number; total?: number }
  | { type: 'ready'; initMs: number; warmMs: number }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'diag'; text: string }
  | { type: 'stdin-request' }
  | { type: 'compile-failed'; code: number; compileMs: number }
  | { type: 'compiled' }
  | { type: 'debug-stop'; json: string }
  | { type: 'debug-vars'; json: string }
  | { type: 'files'; written: SourceFile[]; deleted: string[]; skipped: string[] }
  | { type: 'done'; exit: number; compileMs: number; runMs: number; tainted: boolean }
  | { type: 'fatal'; text: string; duringBoot?: boolean }
  | { type: 'internal'; level: string; text: string; noise: boolean }

export interface JavaRuntimeOptions {
  /**
   * URL of jvm.worker.js. It is started as a CLASSIC worker, which is a hard
   * requirement of CheerpJ's loader -- see the header of jvm.worker.js.
   *
   * The default resolves the file next to this module, which works when the
   * bundler emits it as a plain asset. Under Vite, pass an explicit URL to a
   * copy in `public/` instead; INTEGRATION.md explains why.
   */
  workerUrl?: string | URL
  /**
   * Where CheerpJ can read ecj.jar, in ITS filesystem. `/app/` maps to the web
   * server root, so the default assumes the jar is deployed at the site root.
   * A site served from a sub-path needs that prefix included here.
   */
  compilerJarPath?: string
  /**
   * Where CheerpJ can read warsha-boot.jar (the prebuilt Warsha bootstrap), in
   * ITS filesystem. Same rules as `compilerJarPath`: `/app/` is the web server
   * root. Built by runtimes/java/build-bootstrap.sh.
   */
  bootJarPath?: string
  /** CheerpJ loader directory. Pinned to 4.3; overriding it is untested. */
  cdnBase?: string
  /**
   * Loads a web-tree-sitter Parser with the Java grammar set. Needed only for a
   * debug run (the sources are instrumented before compiling, see
   * instrument.ts); called lazily, at most once per successful load. Without
   * it a debug run degrades to a plain run with a note on stderr.
   */
  loadJavaParser?: () => Promise<JavaParserLike>
  /** Receives CheerpJ's console chatter (incl. its JIT-failure noise) for debugging. */
  onInternalLog?(entry: { level: string; text: string; noise: boolean }): void
}

/** A running Java program. Extends the contract with writeEof(). */
export interface JavaRunSession extends RunSession {
  /** Signal end-of-input, so a program reading to EOF can finish. Optional extra. */
  writeEof(): void
}

interface Active {
  io: RunIO
  runId: string
  ended: boolean
  awaitingStdin: boolean
  progressListener?: (report: ProgressReport) => void
  debug?: DebugState
}

/** Per-run debugger state, main-thread side. */
interface DebugState {
  /** Project path -> file id the instrumented code reports frames under. */
  fileIds: Map<string, number>
  paths: string[]
  parked: boolean
  /** FIFO: the JVM answers variables requests strictly in order. */
  varWaiters: { resolve: (v: DebugValue[]) => void; reject: (e: Error) => void }[]
  /** The uninstrumented sources, for the compile-error fallback. */
  original: SourceFile[]
  entry: string
  /** Compiler output of the instrumented sources: held back, see onMessage 'compile-failed'. */
  diags: string[]
  /** True once this run gave up on debugging and is running the original sources. */
  fallback: boolean
}

interface RawFrame {
  name: string
  file: number
  line: number
  locals: DebugValue[]
  this?: DebugValue[]
}

/**
 * CheerpJ-backed implementation of the IDE's `Runtime` contract.
 *
 * One instance owns one classic Web Worker holding one JVM. The worker is
 * reused across runs; `kill()` terminates it and transparently respawns a
 * replacement, so a subsequent `run()` works (paying the engine re-warm, see
 * INTEGRATION.md).
 *
 * Java 17: `var`, records, sealed types, pattern matching, switch expressions
 * and text blocks all work. Getting a compiler to see the platform classes on
 * a modular runtime takes real work under CheerpJ -- see bootstrap/Platform.java.
 */
export class JavaRuntime implements Runtime {
  readonly id = 'java' as const

  /** Language level students get. Fixed by CheerpJ's Java 17 runtime. */
  readonly javaVersion = '17'

  private readonly workerUrl: string
  private readonly compilerJarPath: string
  private readonly bootJarPath: string
  private readonly cdnBase: string | undefined
  private readonly onInternalLog: JavaRuntimeOptions['onInternalLog']

  private worker: Worker | null = null
  private readonly loadJavaParser: JavaRuntimeOptions['loadJavaParser']
  private parser: Promise<JavaParserLike> | null = null

  /** In-flight or settled boot of the current worker. null = no worker yet. */
  private booting: Promise<void> | null = null
  private bootSettle: { resolve: () => void; reject: (error: Error) => void } | null = null
  private readonly progressListeners = new Set<(p: ProgressReport) => void>()
  private lastProgress: ProgressReport | null = null

  private active: Active | null = null
  private runCounter = 0
  /** This tab's share of /files/ (see tabScope); resolved by the first run. */
  private scope: string | null = null

  /** A run() that has been accepted but has not reached the worker yet. */
  private starting = false

  /**
   * True when the JVM in this worker can no longer be trusted -- the student's
   * own code called System.exit(), which takes the shared JVM down with it. The
   * next run() replaces the worker first.
   */
  private tainted = false

  /** Timings of the most recent run, for diagnostics and the harness. */
  lastRun: { compileMs: number; runMs: number } | null = null
  /** Timings of the most recent engine boot. */
  lastBoot: { initMs: number; warmMs: number } | null = null

  constructor(options: JavaRuntimeOptions = {}) {
    this.workerUrl = String(options.workerUrl ?? DEFAULT_WORKER_URL)
    this.compilerJarPath = options.compilerJarPath ?? '/app/ecj.jar'
    this.bootJarPath = options.bootJarPath ?? '/app/warsha-boot.jar'
    this.cdnBase = options.cdnBase
    this.onInternalLog = options.onInternalLog
    this.loadJavaParser = options.loadJavaParser
  }

  /** Every .java entry can run under the debugger (see instrument.ts). */
  canDebug(entryPath: string): boolean {
    return entryPath.endsWith('.java')
  }

  /**
   * Start the JVM and warm the compiler. Idempotent: concurrent and repeated
   * calls share one boot, and calling it when already warm resolves
   * immediately. Every caller gets the progress of whichever boot is in flight,
   * including the silent respawn started by `kill()`.
   */
  async load(onProgress: (p: ProgressReport) => void): Promise<void> {
    // A JVM that a previous program exited (System.exit, or a fatal error) cannot
    // run anything else. Replacing it HERE, not in run(), makes the reboot a load
    // the shell can see: its progress reaches the caller's listener and the
    // shell's stall watchdog. Done inside run() it was ~26 s of a silent "Running".
    if (this.tainted && !(this.active && !this.active.ended)) this.replaceWorker()
    this.progressListeners.add(onProgress)
    if (this.booting && this.lastProgress) onProgress(this.lastProgress)
    const boot = this.booting ?? (this.booting = this.spawn())
    try {
      await boot
    } catch (error) {
      // Don't cache a failed boot: the next load()/run() should retry.
      if (this.booting === boot) this.booting = null
      throw error
    } finally {
      this.progressListeners.delete(onProgress)
    }
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession> {
    // `starting` closes a window that `active` alone cannot: this method awaits
    // load(), and on a cold start that await lasts ~20 seconds during which
    // `active` is still null. Two run() calls in that window would both get past
    // the guard and both post a 'run' to the worker, which compiles them
    // concurrently against one shared phase-status slot -- the first session then
    // never receives onExit and its console stays disabled forever.
    if (this.starting || (this.active && !this.active.ended)) {
      throw new Error('A Java program is already running; kill() it before running another.')
    }
    this.starting = true
    try {
      return await this.startRun(files, entryPath, io, opts)
    } finally {
      this.starting = false
    }
  }

  private async startRun(files: SourceFile[], entryPath: string, io: RunIO, opts?: RunOptions): Promise<RunSession> {
    const entry = normalizePath(entryPath)
    const payload = files.map((file) => ({ path: normalizePath(file.path), content: file.content }))
    if (!payload.some((file) => file.path === entry)) {
      throw new Error(`Entry file ${entryPath} is not in the file set.`)
    }
    if (!entry.endsWith('.java')) {
      throw new Error(`Entry file ${entryPath} is not a .java file.`)
    }

    // Normally already done by the caller's load(); kept for a caller that runs without one.
    if (this.tainted) this.replaceWorker()
    this.scope ??= await tabScope()

    // Debug run: rewrite the sources (same lines, extra calls) before they go
    // to the worker. The parser loads alongside the engine.
    let debug: DebugState | undefined
    let sent = payload
    let debugNote: string | null = null
    if (opts?.debug) {
      const prepared = await Promise.all([this.load(() => {}), this.instrument(payload, entry)])
      const result = prepared[1]
      if (typeof result === 'string') debugNote = result
      else ({ debug, sent } = result)
    }

    await this.load(() => {})
    const worker = this.worker
    if (!worker) throw new Error('Java runtime is not ready.')

    const runId = this.nextRunId()
    const active: Active = { io, runId, ended: false, awaitingStdin: false, debug }
    this.active = active
    this.lastRun = null

    // The compile happens INSIDE the run, and on a JVM that has not compiled
    // yet it is the longest phase there is (~12s of ECJ class loading; see
    // INTEGRATION.md). Keep reporting through it, or the console falls back to
    // its empty-state placeholder for the whole wait. Registered per run and
    // dropped in finish(), so a report can never outlive the run it describes.
    if (io.onProgress) {
      const forward = (report: ProgressReport) => {
        if (!active.ended) io.onProgress?.(report)
      }
      active.progressListener = forward
      this.progressListeners.add(forward)
    }

    // Every project file: the .java ones are compiled, the rest are mirrored into
    // the program's working directory (bootstrap/Workspace.java), so
    // new Scanner(new File("data.txt")) finds the file beside Main.java.
    if (debugNote) io.onStderr(debugNote)
    worker.postMessage({
      type: 'run',
      runId,
      files: sent,
      entryPath: entry,
      debug: debug ? { bps: breakpointSpec(debug, opts?.debug?.breakpoints ?? []), entry: !!opts?.debug?.stopOnEntry } : undefined,
    })

    const session: JavaRunSession = {
      kill: () => this.killSession(active),
      writeStdin: (line: string) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active),
    }
    if (debug) session.debug = this.debugSession(active, debug)
    return session
  }

  // --- debugger ---------------------------------------------------------------

  /** Instrumented payload, or a student-facing note explaining why this run cannot be debugged. */
  private async instrument(
    payload: SourceFile[],
    entry: string,
  ): Promise<{ debug: DebugState; sent: SourceFile[] } | string> {
    const unavailable = '[debugger] Breakpoints are unavailable for this run; it runs normally.\n'
    if (!this.loadJavaParser) return unavailable
    let parser: JavaParserLike
    try {
      if (!this.parser) this.parser = this.loadJavaParser()
      parser = await this.parser
    } catch (error) {
      this.parser = null
      this.onInternalLog?.({ level: 'error', text: `java debugger: parser failed to load: ${String(error)}`, noise: false })
      return unavailable
    }
    const debug: DebugState = {
      fileIds: new Map(),
      paths: [],
      parked: false,
      varWaiters: [],
      original: payload,
      entry,
      diags: [],
      fallback: false,
    }
    try {
      const sent = payload.map((file) => {
        if (!file.path.endsWith('.java')) return file
        const id = debug.paths.length
        debug.paths.push(file.path)
        debug.fileIds.set(file.path, id)
        return { path: file.path, content: instrumentJava(parser, file.content, id) }
      })
      return { debug, sent }
    } catch (error) {
      this.onInternalLog?.({ level: 'error', text: `java debugger: instrumentation failed: ${String(error)}`, noise: false })
      return unavailable
    }
  }

  private debugSession(active: Active, debug: DebugState): DebugSession {
    const post = (message: unknown) => {
      if (!active.ended && this.active === active) this.worker?.postMessage(message)
    }
    return {
      resume: (cmd: DebugStepCommand) => {
        if (active.ended || !debug.parked) return
        debug.parked = false
        // Anything still waiting on this stop's values will never be answered.
        for (const waiter of debug.varWaiters.splice(0)) waiter.reject(new Error('The program is running.'))
        post({ type: 'debug-cmd', cmd })
        active.io.onDebugResume?.()
      },
      pause: () => {
        if (active.ended || debug.parked || debug.fallback) return
        post({ type: 'debug-pause' })
      },
      setBreakpoints: (bps: DebugBreakpoint[]) => {
        if (active.ended) return
        post({ type: 'debug-bps', bps: breakpointSpec(debug, bps) })
      },
      variables: (ref: number) => {
        if (active.ended || !debug.parked) return Promise.reject(new Error('The program is not paused.'))
        return new Promise<DebugValue[]>((resolve, reject) => {
          debug.varWaiters.push({ resolve, reject })
          post({ type: 'debug-cmd', cmd: `variables:${Math.floor(ref)}` })
        })
      },
    }
  }

  private onDebugStop(json: string): void {
    const active = this.active
    const debug = active?.debug
    if (!active || !debug || active.ended) return
    let raw: { reason: DebugStopReason; description?: string; frames: RawFrame[] }
    try {
      raw = JSON.parse(json)
    } catch {
      // Never strand a parked program over a malformed stop.
      this.worker?.postMessage({ type: 'debug-cmd', cmd: 'continue' })
      return
    }
    const frames: DebugFrame[] = raw.frames.map((frame) => ({
      name: frame.name,
      path: debug.paths[frame.file] ?? debug.entry,
      line: frame.line,
      scopes: [
        { name: 'Locals', variables: frame.locals },
        ...(frame.this ? [{ name: 'this', variables: frame.this }] : []),
      ],
    }))
    debug.parked = true
    active.io.onDebugStop?.({
      reason: raw.reason,
      ...(raw.description ? { description: raw.description } : {}),
      frames,
    })
  }

  /**
   * `<scope>_<time><n>`: the scope keeps this tab's run directories and
   * workspace apart from another tab's (Build.gcOldRuns, Workspace.rootFor),
   * the time keeps ids unique across reloads of the same tab.
   */
  private nextRunId(): string {
    return `${this.scope ?? 'legacy'}_${Date.now().toString(36)}${(this.runCounter++).toString(36)}`
  }

  /**
   * The instrumented sources did not compile. Usually the student's own error;
   * either way the diagnostics must quote THEIR code, not ours. So compile the
   * original sources instead, as a plain run: a genuine error is reported
   * exactly as a normal Run would, and if the originals do compile (an
   * instrumentation bug) the program still runs, just without breakpoints.
   */
  private debugFallback(active: Active, debug: DebugState): void {
    debug.fallback = true
    this.onInternalLog?.({
      level: 'warn',
      text: `java debugger: instrumented compile failed:\n${debug.diags.join('')}`,
      noise: false,
    })
    const runId = this.nextRunId()
    active.runId = runId
    this.worker?.postMessage({ type: 'run', runId, files: debug.original, entryPath: debug.entry })
  }

  /**
   * Give up this runtime's JVM for good: the page is closing, or the shell is
   * switching to another language.
   *
   * A live session is reported as killed first, then the worker is terminated
   * WITHOUT a replacement -- unlike kill(), which respawns because the student is
   * expected to press Run again. Respawning here would leave a fresh JVM booting
   * behind a runtime nobody is using. A later load() or run() spawns one again.
   */
  dispose(): void {
    this.finish(null)
    this.teardown()
  }

  // --- worker lifecycle -----------------------------------------------------

  private spawn(): Promise<void> {
    this.lastProgress = null
    this.tainted = false

    // CLASSIC worker: no { type: 'module' }. CheerpJ's loader.js only exposes
    // cheerpjInit under sloppy-mode classic-script hoisting; as a module worker
    // it silently defines nothing. The URL is held in a variable so a bundler
    // cannot rewrite this into its own module-worker pipeline.
    const worker = new Worker(this.workerUrl)
    this.worker = worker

    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (this.worker === worker) this.onMessage(event.data)
    }
    worker.onerror = (event: ErrorEvent) => {
      if (this.worker !== worker) return
      const text =
        event.message ||
        `worker failed to start from ${this.workerUrl} (no message; check the console). ` +
          'It must be reachable and served as JavaScript.'
      this.failBoot(new Error(text))
      this.finish(1, text)
    }

    const promise = new Promise<void>((resolve, reject) => {
      this.bootSettle = { resolve, reject }
    })
    worker.postMessage({
      type: 'init',
      compilerJarPath: this.compilerJarPath,
      bootJarPath: this.bootJarPath,
      cdnBase: this.cdnBase,
    })
    return promise
  }

  private onMessage(message: FromWorker): void {
    switch (message.type) {
      case 'progress': {
        const report: ProgressReport = {
          phase: message.phase,
          message: message.message,
          loaded: message.loaded,
          total: message.total,
        }
        this.lastProgress = report
        for (const listener of this.progressListeners) listener(report)
        return
      }

      case 'ready':
        this.lastBoot = { initMs: message.initMs, warmMs: message.warmMs }
        this.lastProgress = null
        this.bootSettle?.resolve()
        this.bootSettle = null
        return

      case 'stdout':
        this.active?.io.onStdout(message.text)
        return

      case 'stderr':
        this.active?.io.onStderr(message.text)
        return

      case 'diag':
        // Compiler diagnostics, on stderr like a real javac invocation. Paths
        // are rewritten to the student's own file names first. A debug run's
        // are held back: they quote the instrumented source (see debugFallback).
        if (this.active?.debug && !this.active.debug.fallback) {
          this.active.debug.diags.push(message.text)
          return
        }
        this.active?.io.onStderr(studentPaths(message.text, this.active.runId))
        return

      case 'compiled':
        if (this.active?.debug?.fallback) {
          this.active.io.onStderr('[debugger] Warsha could not prepare this program for debugging, so it runs without breakpoints.\n')
        }
        // The compile progress is over and main() is starting: a program that
        // then runs in silence must read as running, not as a compile that hangs.
        if (this.active && !this.active.ended) this.active.io.onStarted?.()
        return

      case 'debug-stop':
        this.onDebugStop(message.json)
        return

      case 'debug-vars': {
        const waiter = this.active?.debug?.varWaiters.shift()
        if (!waiter) return
        try {
          waiter.resolve(JSON.parse(message.json) as DebugValue[])
        } catch {
          waiter.resolve([])
        }
        return
      }

      case 'files':
        // Always strictly before 'done' (the worker posts them in that order).
        this.active?.io.onFilesChanged?.({ written: message.written, deleted: message.deleted, skipped: message.skipped })
        return

      case 'stdin-request':
        if (this.active && !this.active.ended) {
          this.active.awaitingStdin = true
          this.active.io.onStdinRequest()
        }
        return

      case 'compile-failed':
        if (this.active?.debug && !this.active.debug.fallback && !this.active.ended) {
          this.debugFallback(this.active, this.active.debug)
          return
        }
        this.lastRun = { compileMs: message.compileMs, runMs: 0 }
        this.finish(message.code === 0 ? 1 : message.code)
        return

      case 'done':
        this.lastRun = { compileMs: message.compileMs, runMs: message.runMs }
        if (message.tainted) this.tainted = true
        this.finish(message.exit)
        return

      case 'fatal':
        if (message.duringBoot) {
          this.failBoot(new Error(message.text))
          this.finish(1, message.text)
          return
        }
        this.tainted = true
        this.finish(1, `\n[java runtime error] ${message.text}\n`)
        return

      case 'internal':
        this.onInternalLog?.({ level: message.level, text: message.text, noise: message.noise })
        return
    }
  }

  private failBoot(error: Error): void {
    const settle = this.bootSettle
    this.bootSettle = null
    // Let the next load()/run() try again from scratch.
    this.booting = null
    this.worker?.terminate()
    this.worker = null
    settle?.reject(error)
  }

  private teardown(): void {
    this.worker?.terminate()
    this.worker = null
    this.booting = null
    this.bootSettle = null
    this.active = null
  }

  /** Throw away the current JVM and start a fresh one booting immediately. */
  private replaceWorker(): void {
    this.worker?.terminate()
    this.worker = null
    this.bootSettle = null
    this.booting = this.spawn()
    this.booting.catch(() => {})
  }

  /** End the current session exactly once. `code` null means killed. */
  private finish(code: number | null, stderrNote?: string): void {
    const active = this.active
    if (!active || active.ended) return
    active.ended = true
    active.awaitingStdin = false
    if (active.debug) {
      active.debug.parked = false
      for (const waiter of active.debug.varWaiters.splice(0)) waiter.reject(new Error('The program has ended.'))
    }
    if (active.progressListener) this.progressListeners.delete(active.progressListener)
    this.active = null
    if (stderrNote) active.io.onStderr(stderrNote)
    active.io.onExit(code)
  }

  // --- session operations ---------------------------------------------------

  private killSession(active: Active): void {
    if (active.ended) return
    // terminate() is the only kill CheerpJ has: there is no interrupt, and a
    // Java loop that performs no I/O never yields. It stops a spinning JVM in
    // well under a millisecond and cannot be refused.
    this.finish(null)
    this.replaceWorker()
  }

  private writeStdin(active: Active, line: string): void {
    if (active.ended || !active.awaitingStdin) return
    active.awaitingStdin = false
    // One line, no trailing newline: the Java side appends it.
    this.worker?.postMessage({ type: 'stdin', line: line.replace(/\r?\n$/, '') })
  }

  private writeEof(active: Active): void {
    if (active.ended || !active.awaitingStdin) return
    active.awaitingStdin = false
    this.worker?.postMessage({ type: 'stdin', line: null })
  }
}

/**
 * This tab's name for its directories under CheerpJ's /files/ -- its run
 * directories and the program's working directory.
 *
 * /files/ is one IndexedDB shared by every tab of the origin, and the JVM in
 * each tab used to treat it as its own: a second tab's build deleted the first
 * tab's run directory mid-run (NoClassDefFoundError for a class not yet loaded),
 * and both staged their data files into the same /files/warsha-work, so the
 * first tab's program read the second project's data.txt and then reported it
 * back as a file it had written -- overwriting its own project's copy.
 *
 * Stable across reloads (sessionStorage), so a refreshed tab keeps its
 * workspace and its compile cache; unique among live tabs (a Web Lock held for
 * the page's lifetime), because "Duplicate tab" copies sessionStorage. Starts
 * with the minting time in base 36, eight digits, which is how Build ages out
 * the directories of tabs that have since closed.
 */
let scopePromise: Promise<string> | null = null
function tabScope(): Promise<string> {
  return (scopePromise ??= (async () => {
    const KEY = 'warsha-java-scope'
    const mint = () => Date.now().toString(36).padStart(8, '0') + Math.random().toString(36).slice(2, 6).padEnd(4, '0')
    let scope: string | null = null
    try {
      scope = sessionStorage.getItem(KEY)
    } catch {
      /* storage blocked: a fresh scope per page load is still correct, just colder */
    }
    if (!scope || !/^[0-9a-z]{12}$/.test(scope)) scope = mint()
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (locks) {
      const claim = (name: string) =>
        new Promise<boolean>((resolve) => {
          void locks.request(`warsha-java-scope:${name}`, { ifAvailable: true }, (lock) => {
            resolve(lock !== null)
            // Held until the page goes away.
            return lock ? new Promise<void>(() => {}) : undefined
          })
        })
      if (!(await claim(scope))) {
        scope = mint()
        await claim(scope)
      }
    }
    try {
      sessionStorage.setItem(KEY, scope)
    } catch {
      /* see above */
    }
    return scope
  })())
}

/**
 * Resolved outside any `new Worker(...)` call on purpose. A bundler treats this
 * as a plain asset reference and emits the file, while the worker itself is
 * constructed from a variable so the bundler's module-worker transform never
 * fires -- which matters because this worker must stay classic.
 */
const DEFAULT_WORKER_URL = /* @__PURE__ */ new URL('./jvm.worker.js', import.meta.url).href

/**
 * Rewrites compiler paths to the student's own file names.
 *
 * ECJ reports the paths it was given, which are the staged copies under
 * /files/warsha-run-<runId>/src/. The tree there mirrors the project exactly, so removing
 * the prefix yields "models/Person.java" -- the name in the student's editor.
 * Line numbers and carets are untouched.
 */
function studentPaths(text: string, runId: string): string {
  return text
    .split(`/files/warsha-run-${runId}/src/`)
    .join('')
    // Defensive: any run directory, and the flat /str/ staging mount.
    .replace(/\/files\/warsha-run-[A-Za-z0-9]+\/src\//g, '')
    .replace(/\/str\//g, '')
}

/** "fileId:line,fileId:line" for Dbg; breakpoints in files that were not instrumented are dropped. */
function breakpointSpec(debug: DebugState, bps: DebugBreakpoint[]): string {
  const out: string[] = []
  for (const bp of bps) {
    let path: string
    try {
      path = normalizePath(bp.path)
    } catch {
      continue
    }
    const id = debug.fileIds.get(path)
    if (id !== undefined && Number.isFinite(bp.line)) out.push(`${id}:${Math.floor(bp.line)}`)
  }
  return out.join(',')
}

/** "./a/B.java", "/a/B.java" and "a//B.java" all become "a/B.java"; ".." is rejected. */
function normalizePath(path: string): string {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) throw new Error(`Unsupported file path: ${path}`)
  return parts.join('/')
}
