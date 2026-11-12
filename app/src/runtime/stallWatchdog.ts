import type { LoadProgress } from '../runtime/types'

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
 */

/** Generous: Pyodide is ~11 MB on slow wifi. The window restarts on every report, so only a dead connection trips it. */
export const DOWNLOAD_STALL_MS = 45_000

/** Byteless phases report once and then work. A slow phone takes about twice as long as a laptop, so this is several times the worst case. */
export const BUSY_STALL_MS = 180_000

export type StallKind = 'download' | 'busy'

/** What a silence this long means, given the last report (null = none yet). */
export function stallBudget(last: LoadProgress | null): { kind: StallKind; ms: number } {
  if (!last || last.phase === 'download') return { kind: 'download', ms: DOWNLOAD_STALL_MS }
  return { kind: 'busy', ms: BUSY_STALL_MS }
}

export interface StallWatchdog {
  /** Starts or restarts the window for the latest report. Pass null before the first. */
  report(progress: LoadProgress | null): void
  /** Loading is over. Idempotent; a later `report` re-arms it (a run-phase package download). */
  stop(): void
}

export function createStallWatchdog(
  onStall: (kind: StallKind) => void,
  timers: { set: (fn: () => void, ms: number) => number; clear: (id: number) => void } = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: (id) => window.clearTimeout(id),
  },
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null =
    typeof document === 'undefined' ? null : document,
): StallWatchdog {
  let timer = 0
  let last: LoadProgress | null = null
  let armed = false

  const arm = () => {
    timers.clear(timer)
    const { kind, ms } = stallBudget(last)
    timer = timers.set(() => {
      if (!armed) return
      // Case 6: a timer that survived a hidden spell can still fire late.
      if (doc?.visibilityState === 'hidden') return
      armed = false
      detach()
      onStall(kind)
    }, ms)
  }

  const onVisibility = () => {
    if (armed && doc?.visibilityState === 'visible') arm()
  }
  const detach = () => doc?.removeEventListener('visibilitychange', onVisibility)

  return {
    report(progress) {
      last = progress
      if (!armed) {
        armed = true
        doc?.addEventListener('visibilitychange', onVisibility)
      }
      arm()
    },
    stop() {
      if (!armed) return
      armed = false
      timers.clear(timer)
      detach()
    },
  }
}
