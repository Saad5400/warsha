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

/** A failure the student can act on — its own console block with a retry button, unlike a transcript line that just scrolls away. */
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
  /** The `kind: 'preview'` run's document, for the shell's iframe; null for console runs and between runs. `console.log` still goes through stdout, unaffected. */
  previewDoc: string | null
}

/** Ignore taps for a moment after the control swaps role (spec §5.3). */
const SWAP_GUARD_MS = 250

/** Backstop for Stop when `onExit` never comes — e.g. the worker was already killed (iPad memory pressure). Without it, `busy` stays true forever with no way to recover but reloading. */
const FORCE_STOP_MS = 2000

/** Deliberately generous (Pyodide is ~11.6MB on slow wifi) — resets on every report, so only a truly dead (blackholed) connection trips it. */
const LOAD_STALL_MS = 45_000

/** Turns a raw engine error (e.g. `TypeError: Failed to fetch`, a CheerpJ stack trace) into something a student can act on. */
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
    previewDoc: null,
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

  /** Ends a run from the shell's side — the one place `busy` gets cleared outside `onExit`. Token bump voids late `onExit`s; `dispose()` discards an untrusted engine. */
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
      // Must read true immediately — no paced reveal owing lines under an error already on screen.
      buffer.catchUp()
      setState({ status, exitCode: null, progress: null, busy: false, failure, previewDoc: null })
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
      // Buffer decides whether this joins an open prompt or starts its own `› ` line.
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
    // Reveal everything printed before the kill immediately — output still
    // "arriving" after Stop reads as Stop not working (§7.3).
    buffer.catchUp()
    if (session.current) {
      const mine = token.current
      session.current.kill()
      // A live engine clears this timer via onExit fast; a dead one never answers,
      // so this is what makes Stop actually recover.
      forceStopTimer.current = window.setTimeout(() => {
        forceStopTimer.current = 0
        if (token.current !== mine) return
        // Not the student's fault, and the fix is obvious (press Run) — one red line, no failure card.
        buffer.line(COPY.engineLost, 'err')
        abandonRun(null, '', 'failed')
      }, FORCE_STOP_MS)
      return
    }
    // Killed during engine load: invalidate so nothing lands later.
    abandonRun(null, COPY.runStopped, 'stopped')
  }, [state.busy, abandonRun, buffer])

  const run = useCallback(async () => {
    if (state.busy) return
    if (Date.now() - swapAt.current < SWAP_GUARD_MS) return

    // Saving can fail (full disk, OPFS gone) — used to be an unhandled rejection
    // that silently did nothing. Now the run continues on in-memory `sourceFiles()`
    // and says so.
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
      setState({ status: 'failed', exitCode: null, progress: null, busy: false, failure: null, previewDoc: null })
      return
    }
    const runtime = runtimeFor(entry)
    if (!runtime) {
      buffer.line(COPY.cannotRun(entry), 'err')
      setState({ status: 'failed', exitCode: null, progress: null, busy: false, failure: null, previewDoc: null })
      return
    }

    // A previous run with no reported exit leaves the engine thinking it's still
    // live and would refuse the next run() — discard it instead.
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
    setState({ status: 'preparing', exitCode: null, progress: null, busy: true, failure: null, previewDoc: null })

    // Loading speaks only through ProgressBlock (single progress voice) — nothing
    // else lands in the transcript while booting; the stall watchdog is the only
    // timer armed.
    clearTimers()

    try {
      // A blackholed connection (dropped, not refused, packets) never errors or
      // times out on its own — we watch for the *absence* of progress instead,
      // resetting on every report.
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

      await runtime.load(
        (report) => {
          if (token.current !== mine) return
          armStall()
          const p = normalizeProgress(report)
          setState((s) => ({ ...s, progress: p }))
        },
        { files, entry },
      )
      if (token.current !== mine) return
      clearTimers()

      // No "Running…" row (read as program output). Status flips immediately so
      // Stop always works; `progress` isn't cleared yet — Java compiles inside
      // run(), so clearing early blanked the console for ~20s.
      setState((s) => ({ ...s, status: 'running' }))

      const clearProgress = () => {
        if (token.current === mine) setState((s) => (s.progress ? { ...s, progress: null } : s))
      }

      const s = await runtime.run(files, entry, {
        onProgress: (report) => {
          if (token.current !== mine) return
          armStall()
          setState((s) => ({ ...s, progress: normalizeProgress(report) }))
        },
        onStdout: (t) => {
          if (token.current !== mine) return
          clearProgress()
          buffer.write(t, 'out')
        },
        onStderr: (t) => {
          if (token.current !== mine) return
          clearProgress()
          buffer.write(t, 'err')
        },
        // Only preview runtimes call this; shell loads it into the iframe, empty string blanks it (stopped page).
        onRender: (srcdoc) => {
          if (token.current === mine) setState((s) => ({ ...s, previewDoc: srcdoc === '' ? null : srcdoc }))
        },
        onStdinRequest: () => {
          if (token.current !== mine) return
          clearProgress()
          // The input row joins the prompt line, so the prompt (and everything
          // before it) must already be on screen, not queued.
          buffer.catchUp()
          const queued = typedAhead.current.shift()
          if (queued !== undefined) {
            // Deliver only after onStdinRequest() returns — some engines aren't ready to accept a line before then.
            setTimeout(() => {
              if (token.current === mine) deliverStdin(queued)
            }, 0)
            return
          }
          awaiting.current = true
          setState((cur) => ({ ...cur, status: 'waiting' }))
          // Focus first, then scroll after resize settles — scrolling first would hide the prompt behind the keyboard.
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
            previewDoc: null,
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
      // Covers anything that blocked startup (CDN down, not isolated, worker won't
      // boot) — discard the engine and surface an actionable message.
      const failure = classifyRunFailure(e, langName(entry))
      abandonRun(failure, failure.message, 'failed')
    }
  }, [state.busy, project, entryPath, buffer, deliverStdin, abandonRun])

  /** Dismiss the failure block without starting a run. */
  const clearFailure = useCallback(() => setState((s) => (s.failure ? { ...s, failure: null } : s)), [])

  return { ...state, run, stop, submitStdin, bindStdinFocus, clearFailure }
}

/** The language name, for a sentence a student reads in a failure message. */
function langName(entryPath: string): string {
  if (entryPath.endsWith('.java')) return 'Java'
  if (entryPath.endsWith('.py')) return 'Python'
  if (entryPath.endsWith('.cs')) return 'C#'
  if (/\.(tsx?|mts|cts)$/i.test(entryPath)) return 'TypeScript'
  if (/\.(m?js|cjs|jsx)$/i.test(entryPath)) return 'JavaScript'
  if (/\.html?$/i.test(entryPath)) return 'the web preview'
  if (/\.css$/i.test(entryPath)) return 'the web preview'
  return 'the language'
}
