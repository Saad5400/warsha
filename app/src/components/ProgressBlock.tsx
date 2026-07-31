import { useEffect, useRef, useState } from 'react'
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
 * modal, so the student can keep reading their code while it happens.
 *
 * The contract is that something numeric changes on screen at least every two
 * seconds, from the first tap to the first line of output — because this is the
 * moment a student decides the site is broken and closes the tab. So an
 * indeterminate bar never ships alone: when the total is unknown we still show a
 * live byte counter, and a phase with no bytes at all shows elapsed seconds.
 */
export function ProgressBlock({ progress }: { progress: LoadProgress }) {
  const { loaded, total, phase, message } = progress
  const determinate = typeof loaded === 'number' && typeof total === 'number' && total > 0
  const pct = determinate ? Math.min(100, Math.round((loaded! / total!) * 100)) : null
  const elapsed = useElapsedSeconds(phase, !determinate)
  const eta = useEta(phase, determinate ? loaded! : null, determinate ? total! : null)

  const detail = [
    typeof loaded === 'number'
      ? determinate
        ? `${mb(loaded)} of ${mb(total!)}`
        : mb(loaded)
      : null,
    phaseLabel[phase],
    eta,
    elapsed !== null ? `${elapsed}s` : null,
  ].filter(Boolean)

  return (
    <div data-phase={phase} className="progress-block">
      <p className="progress-block__title">{message}</p>

      <div className="mt-2 flex items-center gap-2">
        <div className="progress-track">
          {determinate ? (
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          ) : (
            // A 30%-wide sweep, and the counter below carries the real
            // information: an indeterminate bar alone is indistinguishable
            // from a hang.
            <div className="progress-fill progress-fill--sweep" />
          )}
        </div>
        {pct !== null ? <span className="progress-pct">{pct}%</span> : null}
      </div>

      <p className="progress-block__meta mt-2">{detail.join(' · ')}</p>
      <p className="progress-block__meta">{COPY.runtimeNextInstant}</p>
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
 * string under a looping CSS sweep reads as a hang, so count the seconds.
 * Suppressed while a determinate bar is doing that job.
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

/**
 * "about 40 seconds left", from the observed transfer rate (spec §7.6 anatomy).
 *
 * Measured against the first sample of this phase rather than instantaneously,
 * which is what keeps the estimate from swinging wildly on school Wi-Fi, and it
 * is deliberately vague — a precise-looking ETA that is wrong reads worse than
 * an approximate one that is roughly right.
 */
function useEta(phase: LoadProgress['phase'], loaded: number | null, total: number | null): string | null {
  const start = useRef<{ t: number; loaded: number; phase: string } | null>(null)
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    if (loaded === null || total === null) {
      start.current = null
      setText(null)
      return
    }
    const now = Date.now()
    if (!start.current || start.current.phase !== phase || loaded < start.current.loaded) {
      start.current = { t: now, loaded, phase }
      setText(null)
      return
    }
    const dt = (now - start.current.t) / 1000
    const bytes = loaded - start.current.loaded
    // Not enough evidence yet: no number beats a wrong one.
    if (dt < 1.5 || bytes <= 0) return
    const remaining = Math.max(0, total - loaded) / (bytes / dt)
    setText(humanEta(remaining))
  }, [phase, loaded, total])

  return text
}

function humanEta(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return null
  if (seconds < 10) return 'a few seconds left'
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5} seconds left`
  if (seconds < 150) return 'about a minute left'
  return `about ${Math.round(seconds / 60)} minutes left`
}
