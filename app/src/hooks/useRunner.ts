import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { entryCandidates, runtimeFor } from '../runtime'
import { normalizeProgress, type LoadProgress, type RunSession } from '../runtime/types'
import type { ConsoleBuffer } from '../console/buffer'
import { afterViewportSettles } from '../ui/viewport'
import { COPY } from '../copy'

/**
 * Run status. Drives the single Run/Stop control and the status pill, and is
 * published as data-state so styling never has to infer it.
 *   idle → preparing → running ⇄ waiting → ok | failed | stopped
 */
export type RunStatus = 'idle' | 'preparing' | 'running' | 'waiting' | 'ok' | 'failed' | 'stopped'

export interface RunnerState {
  status: RunStatus
  exitCode: number | null
  /** Engine bootstrap progress; null once running or on a cache hit. */
  progress: LoadProgress | null
  busy: boolean
}

/** Ignore taps for a moment after the control swaps role (spec §5.3). */
const SWAP_GUARD_MS = 250

export function useRunner(project: Project, buffer: ConsoleBuffer, entryPath: string | null) {
  const [state, setState] = useState<RunnerState>({
    status: 'idle',
    exitCode: null,
    progress: null,
    busy: false,
  })

  const session = useRef<RunSession | null>(null)
  const token = useRef(0)
  const awaiting = useRef(false)
  const typedAhead = useRef<string[]>([])
  const pendingWrites = useRef<string[]>([])
  const swapAt = useRef(0)
  const timers = useRef<number[]>([])
  const focusStdin = useRef<(() => void) | null>(null)

  /** The Console registers how to focus its input row. */
  const bindStdinFocus = useCallback((fn: (() => void) | null) => {
    focusStdin.current = fn
  }, [])

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
  }

  useEffect(() => clearTimers, [])

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
      session.current.kill()
      return
    }
    // Killed during engine load: invalidate so nothing lands later.
    token.current++
    swapAt.current = Date.now()
    buffer.line(COPY.runStopped, 'meta')
    setState({ status: 'stopped', exitCode: null, progress: null, busy: false })
  }, [state.busy, buffer])

  const run = useCallback(async () => {
    if (state.busy) return
    if (Date.now() - swapAt.current < SWAP_GUARD_MS) return

    await project.saveAll()
    const files = project.sourceFiles()
    const candidates = entryCandidates(files)
    const entry = entryPath && candidates.includes(entryPath) ? entryPath : candidates[0]
    if (!entry) {
      buffer.line(COPY.noEntry, 'err')
      setState({ status: 'failed', exitCode: null, progress: null, busy: false })
      return
    }
    const runtime = runtimeFor(entry)
    if (!runtime) {
      buffer.line(COPY.cannotRun(entry), 'err')
      setState({ status: 'failed', exitCode: null, progress: null, busy: false })
      return
    }

    const mine = ++token.current
    awaiting.current = false
    typedAhead.current = []
    pendingWrites.current = []
    swapAt.current = Date.now()
    buffer.clear()
    setState({ status: 'preparing', exitCode: null, progress: null, busy: true })

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
      await runtime.load((report) => {
        if (token.current !== mine) return
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
          swapAt.current = Date.now()
          if (code === null) buffer.line(COPY.runStopped, 'meta')
          else if (code === 0) buffer.line(COPY.runOk, 'meta')
          else buffer.line(COPY.runFailed(code), 'meta')
          setState({
            status: code === null ? 'stopped' : code === 0 ? 'ok' : 'failed',
            exitCode: code,
            progress: null,
            busy: false,
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
      clearTimers()
      buffer.line(COPY.runtimeBroken((e as Error).message), 'err')
      session.current = null
      setState({ status: 'failed', exitCode: null, progress: null, busy: false })
    }
  }, [state.busy, project, entryPath, buffer, deliverStdin])

  return { ...state, run, stop, submitStdin, bindStdinFocus }
}
