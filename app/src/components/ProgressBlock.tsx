import { useEffect, useState } from 'react'
import type { LoadProgress } from '../runtime/types'
import { COPY } from '../copy'

const phaseLabel: Record<LoadProgress['phase'], string> = {
  download: 'Downloading',
  unpack: 'Unpacking',
  boot: 'Starting up',
  compile: 'Compiling your code',
}

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * The first-run engine download (spec §7.6). Renders in the console, never in a
 * modal, so the student can keep reading their code. An indeterminate bar with
 * no numbers is indistinguishable from a hang, so when total is unknown we still
 * show a live byte counter.
 */
export function ProgressBlock({ progress }: { progress: LoadProgress }) {
  const { loaded, total, phase, message } = progress
  const determinate = typeof loaded === 'number' && typeof total === 'number' && total > 0
  const pct = determinate ? Math.min(100, Math.round((loaded! / total!) * 100)) : null
  const elapsed = useElapsedSeconds(phase, !determinate)

  return (
    <div data-phase={phase} className="mb-2 rounded-md border border-border-subtle bg-surface-3 p-3">
      <p className="text-btn font-semibold text-text-1">{message}</p>

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-pill bg-surface-4">
          <div
            className="h-full rounded-pill bg-accent transition-[width] duration-200 ease-linear"
            style={
              determinate
                ? { width: `${pct}%` }
                : // Indeterminate sweep: 30% wide, and the counter below carries
                  // the real information.
                  { width: '30%', animation: 'warsha-sweep 1.4s var(--ease) infinite' }
            }
          />
        </div>
        {pct !== null ? <span className="text-meta tabular-nums text-text-2">{pct}%</span> : null}
      </div>

      <p className="mt-1 text-meta text-text-3">
        {typeof loaded === 'number'
          ? determinate
            ? `${mb(loaded)} of ${mb(total!)} · ${phaseLabel[phase]}`
            : `${mb(loaded)} · ${phaseLabel[phase]}`
          : phaseLabel[phase]}
        {elapsed !== null ? <span className="tabular-nums"> · {elapsed}s</span> : null}
      </p>
      <p className="text-meta text-text-3">{COPY.runtimeNextInstant}</p>
    </div>
  )
}

/**
 * Seconds since the current phase began, or null when there is nothing worth
 * counting.
 *
 * A phase with no byte counts can last a long time with nothing to report:
 * Java's in-browser bootstrap compile measured 7 s warm and up to 20 s cold
 * (runtimes/java/INTEGRATION.md), during which `message` never changes. A frozen
 * string under a looping CSS sweep reads as a hang, and §7.6 asks for something
 * numeric to change at least every two seconds — so count the seconds. Suppressed
 * while a determinate bar is doing that job.
 */
function useElapsedSeconds(phase: LoadProgress['phase'], active: boolean): number | null {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setElapsed(0)
    if (!active) return
    const started = Date.now()
    const id = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [phase, active])

  return active && elapsed > 0 ? elapsed : null
}
