import type { ProgressReport, RunIO, RunSession, Runtime, SourceFile } from './types'

type FromWorker =
  | { type: 'progress'; phase: 'download' | 'unpack' | 'boot' | 'compile'; message: string; loaded?: number; total?: number }
  | { type: 'ready'; initMs: number; warmMs: number }
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'diag'; text: string }
  | { type: 'stdin-request' }
  | { type: 'compile-failed'; code: number; compileMs: number }
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

  /** In-flight or settled boot of the current worker. null = no worker yet. */
  private booting: Promise<void> | null = null
  private bootSettle: { resolve: () => void; reject: (error: Error) => void } | null = null
  private readonly progressListeners = new Set<(p: ProgressReport) => void>()
  private lastProgress: ProgressReport | null = null

  private active: Active | null = null
  private runCounter = 0

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
  }

  /**
   * Start the JVM and warm the compiler. Idempotent: concurrent and repeated
   * calls share one boot, and calling it when already warm resolves
   * immediately. Every caller gets the progress of whichever boot is in flight,
   * including the silent respawn started by `kill()`.
   */
  async load(onProgress: (p: ProgressReport) => void): Promise<void> {
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

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
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
      return await this.startRun(files, entryPath, io)
    } finally {
      this.starting = false
    }
  }

  private async startRun(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
    const entry = normalizePath(entryPath)
    const payload = files.map((file) => ({ path: normalizePath(file.path), content: file.content }))
    if (!payload.some((file) => file.path === entry)) {
      throw new Error(`Entry file ${entryPath} is not in the file set.`)
    }
    if (!entry.endsWith('.java')) {
      throw new Error(`Entry file ${entryPath} is not a .java file.`)
    }
    const sources = payload.filter((file) => file.path.endsWith('.java'))

    // A JVM that a previous program exited cannot run anything else.
    if (this.tainted) this.replaceWorker()

    await this.load(() => {})
    const worker = this.worker
    if (!worker) throw new Error('Java runtime is not ready.')

    const runId = `${Date.now().toString(36)}${(this.runCounter++).toString(36)}`
    const active: Active = { io, runId, ended: false, awaitingStdin: false }
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

    worker.postMessage({ type: 'run', runId, files: sources, entryPath: entry })

    const session: JavaRunSession = {
      kill: () => this.killSession(active),
      writeStdin: (line: string) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active),
    }
    return session
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
        // are rewritten to the student's own file names first.
        this.active?.io.onStderr(studentPaths(message.text, this.active.runId))
        return

      case 'stdin-request':
        if (this.active && !this.active.ended) {
          this.active.awaitingStdin = true
          this.active.io.onStdinRequest()
        }
        return

      case 'compile-failed':
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

/** "./a/B.java", "/a/B.java" and "a//B.java" all become "a/B.java"; ".." is rejected. */
function normalizePath(path: string): string {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.some((part) => part === '..')) throw new Error(`Unsupported file path: ${path}`)
  return parts.join('/')
}
