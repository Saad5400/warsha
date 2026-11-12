import type { LoadProgress } from './types'

/**
 * Notices a language download or boot that has stopped moving. A blackholed
 * connection (packets dropped, not refused) never errors or times out by
 * itself, so the only sign is that progress reports stop arriving.
 *
 * It watches loading and nothing else. Whatever a student's program does
 * (computing in silence, waiting in input(), looping forever) belongs to
 * them, and Stop is the answer to it. Calling this a failed download was the
 * old bug. The runner calls `stop()` once the program's own code is running.
 *
 * The cases, each covered in tests/runner/stallWatchdog.test.ts:
 *   1. No report yet (worker script, first fetch): 45 s, then "could not download".
 *   2. `download` with bytes arriving: every report restarts the 45 s window, so a
 *      slow download that keeps moving never trips it, however long it takes.
 *   3. `download` that stops moving: fires 45 s after the last report.
 *   4. `unpack`/`boot`/`compile`: CPU work that reports once and then goes quiet
 *      (C's ~24 s sysroot warm-up, Java's ~15 s first compile; both are slower on
 *      a phone). Gets 3 min. If it fires, the engine is wedged, not offline.
 *   5. Program started (first output, input(), a debugger stop, or the engine's
 *      onStarted): disarmed for good. Never fires on a running program.
 *   6. Tab hidden (phone locked, app switched): a backgrounded page's timers are
 *      throttled or frozen, then run late in a burst when it comes back, ahead of
 *      the progress messages queued meanwhile. Coming back restarts the window
 *      instead of reporting a stall the student never saw.
 *   7. Machine asleep (a laptop lid closed mid-download): some systems keep
 *      counting timers through sleep, so the window would end the moment it
 *      wakes. A heartbeat that could not run while asleep tells; the window restarts.
 */

/**
 * The two budgets, mutable for tests (as notebook/session.ts's INTERRUPT_LIMITS).
 * downloadMs: generous (Pyodide is ~11 MB on slow wifi), and restarted by every
 *   report, so only a dead connection trips it.
 * busyMs: byteless phases report once and then work; a slow phone takes about twice
 *   as long as a laptop, so this is several times the worst case.
 */
export const STALL_LIMITS = { downloadMs: 45_000, busyMs: 180_000 }

export type StallKind = 'download' | 'busy'

/** What a silence this long means, given the last report (null = none yet). */
export function stallBudget(last: LoadProgress | null): { kind: StallKind; ms: number } {
  if (!last || last.phase === 'download') return { kind: 'download', ms: STALL_LIMITS.downloadMs }
  return { kind: 'busy', ms: STALL_LIMITS.busyMs }
}

export interface StallWatchdog {
  /** Starts or restarts the window for the latest report. Pass null before the first. */
  report(progress: LoadProgress | null): void
  /** Loading is over. Idempotent; a later `report` re-arms it (a run-phase package download). */
  stop(): void
}

/** How often the watchdog checks that the page itself was awake. */
export const HEARTBEAT_MS = 5_000
/** A heartbeat this late means the machine slept or froze the page (case 7). */
export const SLEPT_MS = 15_000

/** The clock and timers the watchdog runs on — the browser's, or a test's. */
export interface StallClock {
  set(fn: () => void, ms: number): number
  clear(id: number): void
  now(): number
}

const browserClock: StallClock = {
  set: (fn, ms) => window.setTimeout(fn, ms),
  clear: (id) => window.clearTimeout(id),
  now: () => Date.now(),
}

export function createStallWatchdog(
  onStall: (kind: StallKind) => void,
  clock: StallClock = browserClock,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null =
    typeof document === 'undefined' ? null : document,
): StallWatchdog {
  let timer = 0
  let beat = 0
  let lastBeat = 0
  let last: LoadProgress | null = null
  let armed = false

  const arm = () => {
    clock.clear(timer)
    const { kind, ms } = stallBudget(last)
    timer = clock.set(() => {
      if (!armed) return
      // Case 6: a timer that survived a hidden spell can still fire late.
      if (doc?.visibilityState === 'hidden') return
      // Case 7: a laptop that slept keeps counting this timer (Windows does), so it
      // fires the moment the lid opens, before the network is even back. The
      // heartbeat could not run while asleep, so a stale one gives it away.
      if (clock.now() - lastBeat > SLEPT_MS) {
        lastBeat = clock.now()
        arm()
        return
      }
      halt()
      onStall(kind)
    }, ms)
  }

  // Whichever of the two overdue timers runs first after a wake notices: this one,
  // or the window's own check above.
  const heartbeat = () => {
    const now = clock.now()
    const slept = lastBeat !== 0 && now - lastBeat > SLEPT_MS
    lastBeat = now
    if (slept && armed) arm()
    beat = clock.set(heartbeat, HEARTBEAT_MS)
  }

  const onVisibility = () => {
    if (armed && doc?.visibilityState === 'visible') arm()
  }

  const halt = () => {
    armed = false
    clock.clear(timer)
    clock.clear(beat)
    doc?.removeEventListener('visibilitychange', onVisibility)
  }

  return {
    report(progress) {
      last = progress
      if (!armed) {
        armed = true
        doc?.addEventListener('visibilitychange', onVisibility)
        clock.clear(beat)
        lastBeat = 0
        heartbeat()
      }
      arm()
    },
    stop() {
      if (armed) halt()
    },
  }
}
