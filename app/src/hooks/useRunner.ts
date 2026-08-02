import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { entryCandidates, runtimeFor } from '../runtime'
import { normalizeProgress, type LoadProgress, type RunSession, type Runtime } from '../runtime/types'
import type { ConsoleBuffer } from '../console/buffer'
import { afterViewportSettles } from '../ui/viewport'
import { COPY } from '../copy'

/**
 * Run status. Drives the single Run/Stop control and the status pill, and is
 * published as data-state so styling never has to infer it.
 *   idle → preparing → running ⇄ waiting → ok | failed | stopped
 */
export type RunStatus = 'idle' | 'preparing' | 'running' | 'waiting' | 'ok' | 'failed' | 'stopped'

/**
 * A failure the student can act on, rendered as a block in the console with its
 * own button. Distinct from the transcript: a red line scrolls away, and the one
 * thing a student needs after "the engine would not download" is a way to try
 * again that is not "find the Run button again".
 */
export interface RunFailure {
  /** Student-facing, already plain English. */
  message: string
  /** Secondary line: what to check. Omitted when there is nothing useful to add. */
  hint?: string
  /** The raw engine text, for a bug report. Never the headline. */
  detail?: string
  kind: 'offline' | 'isolation' | 'storage' | 'engine'
}

export interface RunnerState {
  status: RunStatus
  exitCode: number | null
  /** Engine bootstrap progress; null once running or on a cache hit. */
  progress: LoadProgress | null
  busy: boolean
  /** Set when the last run could not start. Cleared by the next Run. */
  failure: RunFailure | null
}

/** Ignore taps for a moment after the control swaps role (spec §5.3). */
const SWAP_GUARD_MS = 250

/**
 * How long Stop waits for the engine's `onExit(null)` before ending the session
 * on its own.
 *
 * Both engines answer a kill in under a millisecond, so this never fires in
 * normal use. It fires when the worker is already dead — killed by the browser
 * for memory on an iPad, or terminated by anything outside the engine's own kill
 * path — in which case no onExit is ever coming, and without this the run stays
 * `busy` forever and Run is disabled until the student reloads the page. There
 * is no platform event for "your worker died"; this is the backstop instead.
 */
const FORCE_STOP_MS = 2000

/**
 * How long the engine may go without a single new progress report before we
 * call the download dead.
 *
 * Deliberately generous, because the failure it must not produce is a false
 * one: Pyodide is ~11.6 MB and school wifi is slow. But bytes arriving means
 * progress reports arriving, so the timer resets on every one — 45 s of total
 * silence is a blackholed connection (a firewall that drops rather than
 * refuses), not a slow one.
 */
const LOAD_STALL_MS = 45_000

/**
 * Turn whatever the engine threw into something a fourteen-year-old can act on.
 *
 * The engines report faithfully and technically — a `TypeError: Failed to fetch`
 * or a stack from inside the CheerpJ loader — and that string used to be pasted
 * straight into the console behind "Warsha could not start the language engine".
 */
export function classifyRunFailure(error: unknown, lang: string): RunFailure {
  const detail = String((error as { message?: string } | null)?.message ?? error ?? '')

  if (/cross-origin isolation|SharedArrayBuffer/i.test(detail)) {
    return { kind: 'isolation', message: COPY.engineIsolation, hint: COPY.engineIsolationHint, detail }
  }
  if (
    /failed to fetch|networkerror|load failed|err_|net::|importScripts|Failed to load|ERR_INTERNET/i.test(detail) ||
    /timed out/i.test(detail)
  ) {
    return { kind: 'offline', message: COPY.engineOffline(lang), hint: COPY.engineOfflineHint, detail }
  }
  return { kind: 'engine', message: COPY.engineBroken(lang), hint: COPY.engineBrokenHint, detail }
}

export function useRunner(project: Project, buffer: ConsoleBuffer, entryPath: string | null) {
  const [state, setState] = useState<RunnerState>({
    status: 'idle',
    exitCode: null,
    progress: null,
    busy: false,
    failure: null,
  })

  const session = useRef<RunSession | null>(null)
  const token = useRef(0)
  const awaiting = useRef(false)
  const typedAhead = useRef<string[]>([])
  const pendingWrites = useRef<string[]>([])
  const swapAt = useRef(0)
  const timers = useRef<number[]>([])
  const focusStdin = useRef<(() => void) | null>(null)
  /** The engine of the run in flight, so a forced recovery can dispose it. */
  const activeRuntime = useRef<Runtime | null>(null)
  const forceStopTimer = useRef(0)

  /** The Console registers how to focus its input row. */
  const bindStdinFocus = useCallback((fn: (() => void) | null) => {
    focusStdin.current = fn
  }, [])

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    if (forceStopTimer.current) {
      clearTimeout(forceStopTimer.current)
      forceStopTimer.current = 0
    }
  }

  useEffect(() => clearTimers, [])

  /**
   * End the run from the shell's side, whatever the engine is doing.
   *
   * Every path out of `busy` that does not come from the engine's own
   * `onExit` goes through here, so there is exactly one place that has to get
   * "Run works again" right. The token bump makes any late `onExit` a no-op, and
   * `dispose()` throws away an engine we can no longer vouch for so the next run
   * builds a fresh worker instead of talking to a corpse.
   */
  const abandonRun = useCallback(
    (failure: RunFailure | null, note: string, status: RunStatus) => {
      clearTimers()
      token.current++
      awaiting.current = false
      typedAhead.current = []
      pendingWrites.current = []
      session.current = null
      swapAt.current = Date.now()
      try {
        activeRuntime.current?.dispose?.()
      } catch {
        /* the engine is already the thing we do not trust */
      }
      activeRuntime.current = null
      if (note) buffer.line(note, failure ? 'err' : 'meta')
      setState({ status, exitCode: null, progress: null, busy: false, failure })
    },
    [buffer],
  )

  const writeToSession = (line: string) => {
    if (session.current) session.current.writeStdin(line)
    else pendingWrites.current.push(line)
  }

  const deliverStdin = useCallback(
    (line: string) => {
      awaiting.current = false
      // The buffer decides whether this joins an open prompt ("Your name: Saad")
      // or starts its own `› ` line.
      buffer.echo(line)
      writeToSession(line)
      setState((s) => (s.status === 'waiting' ? { ...s, status: 'running' } : s))
    },
    [buffer],
  )

  /** Called by the console's stdin row on Enter. */
  const submitStdin = useCallback(
    (line: string): 'sent' | 'queued' | 'ignored' => {
      if (!state.busy) return 'ignored'
      if (awaiting.current) {
        deliverStdin(line)
        return 'sent'
      }
      typedAhead.current.push(line)
      return 'queued'
    },
    [state.busy, deliverStdin],
  )

  const stop = useCallback(() => {
    if (!state.busy) return
    if (Date.now() - swapAt.current < SWAP_GUARD_MS) return
    clearTimers()
    awaiting.current = false
    typedAhead.current = []
    if (session.current) {
      const mine = token.current
      session.current.kill()
      // A live engine answers with onExit(null) in under a millisecond, which
      // bumps nothing and leaves this timer to be cleared. A dead one answers
      // never — so Stop, not a page reload, is what gets the student running
      // again.
      forceStopTimer.current = window.setTimeout(() => {
        forceStopTimer.current = 0
        if (token.current !== mine) return
        abandonRun(
          { kind: 'engine', message: COPY.engineLost, hint: COPY.engineLostHint },
          COPY.engineLost,
          'failed',
        )
      }, FORCE_STOP_MS)
      return
    }
    // Killed during engine load: invalidate so nothing lands later.
    abandonRun(null, COPY.runStopped, 'stopped')
  }, [state.busy, abandonRun])

  const run = useCallback(async () => {
    if (state.busy) return
    if (Date.now() - swapAt.current < SWAP_GUARD_MS) return

    // Saving is part of Run, and it can fail — a full disk, or an OPFS that has
    // gone away under us. It used to sit outside the try below, so a rejection
    // here was an unhandled one: Run did nothing at all, silently, and the
    // student pressed it again. Now the run continues on what is in memory (the
    // engine is handed `sourceFiles()`, not the store) and says so.
    let savedCleanly = true
    try {
      savedCleanly = await project.saveAll()
    } catch {
      savedCleanly = false
    }

    const files = project.sourceFiles()
    const candidates = entryCandidates(files)
    const entry = entryPath && candidates.includes(entryPath) ? entryPath : candidates[0]
    if (!entry) {
      buffer.line(COPY.noEntry, 'err')
      setState({ status: 'failed', exitCode: null, progress: null, busy: false, failure: null })
      return
    }
    const runtime = runtimeFor(entry)
    if (!runtime) {
      buffer.line(COPY.cannotRun(entry), 'err')
      setState({ status: 'failed', exitCode: null, progress: null, busy: false, failure: null })
      return
    }

    // A previous run that never reported an exit leaves the engine holding a
    // session it thinks is live, and its next run() would be refused with
    // "already running". Throw that engine away rather than inherit its state.
    if (session.current) {
      try {
        activeRuntime.current?.dispose?.()
      } catch {
        /* already unreliable */
      }
      session.current = null
    }

    const mine = ++token.current
    awaiting.current = false
    typedAhead.current = []
    pendingWrites.current = []
    swapAt.current = Date.now()
    activeRuntime.current = runtime
    buffer.clear()
    if (!savedCleanly) buffer.line(COPY.runUnsaved, 'err')
    setState({ status: 'preparing', exitCode: null, progress: null, busy: true, failure: null })

    // Escalation: dead air is what makes a student conclude the app is broken.
    clearTimers()
    timers.current.push(
      window.setTimeout(() => {
        if (token.current === mine) buffer.line(COPY.runtimeSlow, 'meta')
      }, 8000),
      window.setTimeout(() => {
        if (token.current === mine) buffer.line(COPY.runtimeKeepEditing, 'meta')
      }, 25000),
      window.setTimeout(() => {
        if (token.current === mine) buffer.line(COPY.runtimeVerySlow, 'meta')
      }, 60000),
    )

    try {
      // A blackholed connection — a school firewall that drops packets instead
      // of refusing them — produces no error and no bytes, just a fetch that
      // never settles. The engines cannot time that out for us (they are
      // waiting on the same fetch), so the shell watches for the *absence* of
      // progress and gives up on the student's behalf. Reset on every report,
      // so a genuinely slow download is never cut off.
      let stall = 0
      const armStall = () => {
        clearTimeout(stall)
        stall = window.setTimeout(() => {
          if (token.current !== mine) return
          const failure = classifyRunFailure(new Error('timed out'), langName(entry))
          abandonRun(failure, failure.message, 'failed')
        }, LOAD_STALL_MS)
        timers.current.push(stall)
      }
      armStall()

      await runtime.load((report) => {
        if (token.current !== mine) return
        armStall()
        const p = normalizeProgress(report)
        setState((s) => ({ ...s, progress: p }))
      })
      if (token.current !== mine) return
      clearTimers()

      buffer.line(COPY.running(entry), 'meta')
      setState((s) => ({ ...s, status: 'running', progress: null }))

      const s = await runtime.run(files, entry, {
        onStdout: (t) => {
          if (token.current === mine) buffer.write(t, 'out')
        },
        onStderr: (t) => {
          if (token.current === mine) buffer.write(t, 'err')
        },
        onStdinRequest: () => {
          if (token.current !== mine) return
          const queued = typedAhead.current.shift()
          if (queued !== undefined) {
            // Hand it over only after the engine returns from onStdinRequest();
            // some are not ready to accept a line before then.
            setTimeout(() => {
              if (token.current === mine) deliverStdin(queued)
            }, 0)
            return
          }
          awaiting.current = true
          setState((cur) => ({ ...cur, status: 'waiting' }))
          // Focus first (the keyboard opens), then scroll once the resize
          // settles — scrolling before it leaves the prompt behind the keyboard.
          focusStdin.current?.()
          void afterViewportSettles()
        },
        onExit: (code) => {
          if (token.current !== mine) return
          clearTimers()
          awaiting.current = false
          typedAhead.current = []
          session.current = null
          activeRuntime.current = null
          swapAt.current = Date.now()
          if (code === null) buffer.line(COPY.runStopped, 'meta')
          else if (code === 0) buffer.line(COPY.runOk, 'meta')
          else buffer.line(COPY.runFailed(code), 'meta')
          setState({
            status: code === null ? 'stopped' : code === 0 ? 'ok' : 'failed',
            exitCode: code,
            progress: null,
            busy: false,
            failure: null,
          })
        },
      })

      if (token.current !== mine) {
        s.kill()
        return
      }
      session.current = s
      for (const line of pendingWrites.current) s.writeStdin(line)
      pendingWrites.current = []
    } catch (e) {
      if (token.current !== mine) return
      // Anything that stopped the run from starting: the CDN unreachable, the
      // page not cross-origin isolated, the worker refusing to boot. The
      // engine is thrown away so the next Run builds a clean one, and the
      // student gets a headline they can act on plus a button that acts on it.
      const failure = classifyRunFailure(e, langName(entry))
      abandonRun(failure, failure.message, 'failed')
    }
  }, [state.busy, project, entryPath, buffer, deliverStdin, abandonRun])

  /** Dismiss the failure block without starting a run. */
  const clearFailure = useCallback(() => setState((s) => (s.failure ? { ...s, failure: null } : s)), [])

  return { ...state, run, stop, submitStdin, bindStdinFocus, clearFailure }
}

/** "Java" / "Python", for a sentence a student reads. */
function langName(entryPath: string): string {
  return entryPath.endsWith('.java') ? 'Java' : 'Python'
}
