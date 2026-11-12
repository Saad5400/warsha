import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { entryCandidates, langForPath, languageName, runtimeFor } from '../runtime'
import { normalizeProgress, type LoadProgress, type RunSession, type Runtime } from '../runtime/types'
import type { ConsoleBuffer } from '../console/buffer'
import { afterViewportSettles } from '../ui/viewport'
import { reloadIfStale } from '../ui/staleBuild'
import { COPY } from '../copy'
import { langOfEntry, track } from '../analytics'
import { debugStore } from '../debug/store'
import { createStallWatchdog, type StallWatchdog } from '../runtime/stallWatchdog'

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
  /** How long the last program ran, from its start (after loading) to its exit; null while running or if it never started. */
  durationMs: number | null
  /** The file the current (or last) run started — not the picker's selection, which can change mid-run. */
  entry: string | null
  /** The `kind: 'preview'` run's document, for the shell's iframe; null for console runs and between runs. `console.log` still goes through stdout, unaffected. */
  previewDoc: string | null
}

/** Ignore taps for a moment after the control swaps role (spec §5.3). */
const SWAP_GUARD_MS = 250

/** Backstop for Stop when `onExit` never comes — e.g. the worker was already killed (iPad memory pressure). Without it, `busy` stays true forever with no way to recover but reloading. */
const FORCE_STOP_MS = 2000

/** Turns a raw engine error (e.g. `TypeError: Failed to fetch`, a CheerpJ stack trace) into something a student can act on. */
export function classifyRunFailure(error: unknown, lang: string): RunFailure {
  const detail = String((error as { message?: string } | null)?.message ?? error ?? '')

  if (/cross-origin isolation|SharedArrayBuffer/i.test(detail)) {
    return { kind: 'isolation', message: COPY.engineIsolation, hint: COPY.engineIsolationHint, detail }
  }
  // The browser knowing it is offline outranks any error text: an offline first run
  // can fail before a single fetch, e.g. the engine's worker script not loading,
  // which says only "worker failed to start" and would read as a broken engine.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { kind: 'offline', message: COPY.engineOffline(lang), hint: COPY.engineOfflineHint, detail }
  }
  // An engine file answered with a web PAGE (a host's index.html fallback for a
  // file it does not have: a stale page after a deploy, a misconfigured server).
  // The engine reports it as e.g. `Failed to load config file … Unexpected token
  // '<', "<!doctype"…`, which the offline test below would claim — telling a
  // student who is online to check their Wi-Fi. The network delivered fine; the
  // file is wrong, and a reload is the fix (useRunner has already tried the
  // automatic one by the time this runs — ui/staleBuild.ts). Checked before the
  // error-text offline test.
  if (/Unexpected token '<'|<!doctype|<html|MIME type .*text\/html/i.test(detail)) {
    return { kind: 'engine', message: COPY.engineBroken(lang), hint: COPY.engineBrokenHint, detail }
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
    durationMs: null,
    entry: null,
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
  /** Watches the run's loading for a stall (see stallWatchdog.ts); stopped with the other timers. */
  const watchdog = useRef<StallWatchdog | null>(null)
  /** When the program's own code began (after any download or compile), for `durationMs`. */
  const programStart = useRef(0)

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
    watchdog.current?.stop()
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
      debugStore.end()
      if (note) buffer.line(note, failure ? 'err' : 'meta')
      // Must read true immediately — no paced reveal owing lines under an error already on screen.
      buffer.catchUp()
      setState((s) => ({ status, exitCode: null, progress: null, busy: false, failure, durationMs: null, entry: s.entry, previewDoc: null }))
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

  /** `force` skips the swap guard, which is for a thumb's double tap on the control that
   *  just turned into Stop — never for the app's own stops (a project switch right after
   *  Run used to leave the old project's program running). */
  const halt = useCallback((force: boolean) => {
    if (!state.busy) return
    if (!force && Date.now() - swapAt.current < SWAP_GUARD_MS) return
    clearTimers()
    awaiting.current = false
    typedAhead.current = []
    // Reveal everything printed before the kill immediately — output still
    // "arriving" after Stop reads as Stop not working (§7.3).
    buffer.catchUp()
    if (session.current) {
      const mine = token.current
      session.current.kill()
      // Python's kill() reports onExit synchronously, before this line, and onExit
      // has already cleared the timers and the session. Arming the backstop now
      // would fire 2 s later on a run that ended cleanly: "stopped responding",
      // and Stopped by you turned into Stopped early.
      if (!session.current) return
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
  /** The Stop control (tap-guarded). */
  const stop = useCallback(() => halt(false), [halt])
  /** The app's own stop: a project switch, a shared link landing, a debug restart. */
  const forceStop = useCallback(() => halt(true), [halt])

  /** `debug: true` runs under the debugger when the entry's engine supports it (else a plain run). */
  const run = useCallback(async (opts?: { debug?: boolean }) => {
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
      setState((s) => ({ status: 'failed', exitCode: null, progress: null, busy: false, failure: null, durationMs: null, entry: s.entry, previewDoc: null }))
      return
    }
    const runtime = runtimeFor(entry)
    if (!runtime) {
      buffer.line(COPY.cannotRun(entry), 'err')
      setState((s) => ({ status: 'failed', exitCode: null, progress: null, busy: false, failure: null, durationMs: null, entry: s.entry, previewDoc: null }))
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

    // Counted here rather than on the button: this is the first point where a
    // tap is definitely a run of something runnable, so `run_started` minus
    // `run_finished` is exactly the "engine never came back" rate.
    const lang = langOfEntry(entry)
    track('run_started', { lang })

    // One debug session at a time: while a notebook cell holds the debugger, a program runs plain.
    const debugging = !!opts?.debug && !!runtime.canDebug?.(entry) && !debugStore.busyFor('program')

    const mine = ++token.current
    awaiting.current = false
    typedAhead.current = []
    pendingWrites.current = []
    swapAt.current = Date.now()
    activeRuntime.current = runtime
    buffer.clear()
    debugStore.begin(debugging)
    if (!savedCleanly) buffer.line(COPY.runUnsaved, 'err')
    setState({ status: 'preparing', exitCode: null, progress: null, busy: true, failure: null, durationMs: null, entry, previewDoc: null })

    // Loading speaks only through ProgressBlock (single progress voice) — nothing
    // else lands in the transcript while booting; the stall watchdog is the only
    // timer armed.
    clearTimers()

    try {
      // Loading only — see stallWatchdog.ts for every case it does and does not
      // fire on. `loaded` tells a stuck package download (inside run()) apart
      // from a stuck language download, so the message names the right thing.
      let loaded = false
      const dog = createStallWatchdog((kind) => {
        if (token.current !== mine) return
        const failure: RunFailure =
          kind === 'busy'
            ? { kind: 'engine', message: COPY.engineBroken(langName(entry)), hint: COPY.engineStuckHint }
            : loaded
              ? { kind: 'offline', message: COPY.packagesOffline, hint: COPY.engineOfflineHint }
              : classifyRunFailure(new Error('timed out'), langName(entry))
        track('run_failed', { lang, kind: failure.kind })
        abandonRun(failure, failure.message, 'failed')
      })
      watchdog.current = dog
      dog.report(null)

      await runtime.load(
        (report) => {
          if (token.current !== mine) return
          const p = normalizeProgress(report)
          dog.report(p)
          setState((s) => ({ ...s, progress: p }))
        },
        { files, entry },
      )
      if (token.current !== mine) return
      clearTimers()
      loaded = true
      programStart.current = Date.now()

      // No "Running…" row (read as program output). Status flips immediately so
      // Stop always works. The boot's last report goes with it: left up, C#'s
      // "Getting the compiler ready" sat over a running program, counter climbing,
      // until its first output. (Java's compile, which runs inside run(), now
      // reports through onProgress within 250 ms, so the console no longer blanks.)
      setState((s) => ({ ...s, status: 'running', progress: null }))

      // The program has started (or spoken), so whatever onProgress reported is
      // over: drop the block and the stall watchdog with it. A run-phase report
      // (Java's compile, Python's numpy download) re-arms the watchdog, and left
      // armed it abandoned a program parked in input(), or computing in silence,
      // 45 s later as "could not download".
      let loadingInRun = false
      const clearProgress = () => {
        dog.stop()
        if (token.current !== mine) return
        // The clock restarts at the end of an in-run compile or package
        // download, so "Finished · 2s" times the program and not the wait.
        if (loadingInRun) {
          loadingInRun = false
          programStart.current = Date.now()
        }
        setState((s) => (s.progress ? { ...s, progress: null } : s))
      }

      const s = await runtime.run(files, entry, {
        onProgress: (report) => {
          if (token.current !== mine) return
          loadingInRun = true
          const p = normalizeProgress(report)
          dog.report(p)
          setState((s) => ({ ...s, progress: p }))
        },
        onStarted: () => {
          if (token.current === mine) clearProgress()
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
        // The program's working directory is the project root, so files it wrote
        // (or deleted) come back here, just before onExit. Applied even if the
        // student pressed Run again meanwhile: the files were really written, and
        // dropping them would lose a program's output silently.
        onFilesChanged: (change) => {
          const current = token.current === mine
          if (current) {
            buffer.catchUp()
            if (change.written.length) buffer.line(COPY.runFilesWritten(change.written.map((f) => f.path)), 'meta')
            if (change.deleted.length) buffer.line(COPY.runFilesDeleted(change.deleted), 'meta')
            if (change.skipped.length) buffer.line(COPY.runFilesSkipped(change.skipped), 'meta')
          }
          void project.applyProgramChanges(change).catch(() => {
            /* storage trouble surfaces through Project's own storage-problem banner */
          })
        },
        onDebugStop: (stopped) => {
          if (token.current !== mine) return
          clearProgress()
          // Everything printed up to the stop belongs on screen while parked.
          buffer.catchUp()
          debugStore.onStop(stopped)
        },
        onDebugResume: () => {
          if (token.current === mine) debugStore.onResume()
        },
        onExit: (code) => {
          if (token.current !== mine) return
          debugStore.end()
          clearTimers()
          awaiting.current = false
          typedAhead.current = []
          session.current = null
          activeRuntime.current = null
          swapAt.current = Date.now()
          if (code === null) buffer.line(COPY.runStopped, 'meta')
          else if (code === 0) buffer.line(COPY.runOk, 'meta')
          else buffer.line(COPY.runFailed(code), 'meta')
          // The exit code itself is not sent — a non-zero code is a student's
          // own bug, and how it failed is their business. Only that it did.
          track('run_finished', { lang, result: code === null ? 'stopped' : code === 0 ? 'ok' : 'error' })
          setState((s) => ({
            entry: s.entry,
            status: code === null ? 'stopped' : code === 0 ? 'ok' : 'failed',
            exitCode: code,
            progress: null,
            busy: false,
            failure: null,
            durationMs: Date.now() - programStart.current,
            previewDoc: null,
          }))
        },
      }, debugging ? { debug: { breakpoints: debugStore.enabledBreakpoints() } } : undefined)

      if (token.current !== mine) {
        s.kill()
        return
      }
      session.current = s
      if (debugging && s.debug) debugStore.attach(s.debug)
      for (const line of pendingWrites.current) s.writeStdin(line)
      pendingWrites.current = []
    } catch (e) {
      if (token.current !== mine) return
      // A page older than the deploy fails exactly here (its worker or chunk is
      // gone or no longer matches) and only a reload fixes it — so if the server
      // serves a newer build, reload onto it instead of reporting an engine
      // failure the student cannot act on. See ui/staleBuild.ts.
      if (await reloadIfStale()) return
      if (token.current !== mine) return
      // Covers anything that blocked startup (CDN down, not isolated, worker won't
      // boot) — discard the engine and surface an actionable message.
      const failure = classifyRunFailure(e, langName(entry))
      track('run_failed', { lang, kind: failure.kind })
      abandonRun(failure, failure.message, 'failed')
    }
  }, [state.busy, project, entryPath, buffer, deliverStdin, abandonRun])

  /** Dismiss the failure block without starting a run. */
  const clearFailure = useCallback(() => setState((s) => (s.failure ? { ...s, failure: null } : s)), [])

  return { ...state, run, stop, forceStop, submitStdin, bindStdinFocus, clearFailure }
}

/** The language name, for a sentence a student reads in a failure message. */
function langName(entryPath: string): string {
  if (langForPath(entryPath) === 'web') return 'the web preview'
  return languageName(entryPath) ?? 'the language'
}
