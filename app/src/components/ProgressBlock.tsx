import { useEffect, useRef, useState } from 'react'
import type { LoadProgress } from '../runtime/types'
import { COPY } from '../copy'

/* The one voice for system loading (founder ruling 2026-08-05): the phase name
 * is the headline, and the engine's own `message` is deliberately never
 * rendered — engines narrate in their own words ("Preparing the Java
 * compiler…"), and two differently-worded texts about the same moment is
 * exactly what read as three competing progress reports. The `phase` field is
 * the engine's message, distilled; these four labels are the entire loading
 * vocabulary. */
const phaseLabel = (phase: LoadProgress['phase']): string =>
  ({
    download: COPY.phaseDownloading,
    unpack: COPY.phaseUnpacking,
    boot: COPY.phaseStarting,
    compile: COPY.phaseCompiling,
  })[phase]

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/* A transcript block, not a card. It used to be a rounded --surface-3 panel,
 * which read as a dialog that had wandered into the output; flush with the rows
 * on the same left grid, with the same 3px leading rule `.console-row` uses,
 * boot progress looks like the first thing the program printed — while the
 * accent rule and tinted fill keep it unmistakably Warsha's, never the
 * program's. */
const BLOCK =
  'progress-block mb-2 px-3 pt-1 pb-2 border-s-[3px] border-s-accent ' +
  'bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]'

/* The numbers change every tick; without tabular figures the whole line
 * twitches sideways each second, which is the opposite of reassuring. */
const META = 'font-code text-meta leading-normal tabular-nums text-text-3'

/* `progress-block` and `progress-track` carry no styling — tools/qa reads them. */
const TRACK = 'progress-track relative flex-1 h-1 overflow-hidden rounded-pill bg-surface-4'
const FILL = 'h-full rounded-pill bg-accent transition-[width] duration-200 ease-linear'
const SWEEP = 'w-[30%] animate-sweep motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-50'

/**
 * The first-run engine download (spec §7.6). Renders in the console, never in a
 * modal, so the student can keep reading their code while it happens.
 *
 * Anatomy is fixed, whatever the phase: one short headline (the phase name),
 * the bar, one line of numbers. Nothing else — the old always-on reassurance
 * sentences and the timed "still going" transcript rows collapsed into the
 * single first-run note below (founder ruling 2026-08-05).
 *
 * The contract is that something numeric changes on screen at least every two
 * seconds, from the first tap to the first line of output — because this is the
 * moment a student decides the site is broken and closes the tab. So an
 * indeterminate bar never ships alone: when the total is unknown we still show a
 * live byte counter, and a phase with no bytes at all shows elapsed seconds.
 */
export function ProgressBlock({ progress }: { progress: LoadProgress }) {
  const { loaded, total, phase } = progress
  const determinate = typeof loaded === 'number' && typeof total === 'number' && total > 0
  const pct = determinate ? Math.min(100, Math.round((loaded! / total!) * 100)) : null
  const elapsed = useElapsedSeconds(phase, !determinate)
  const eta = useEta(phase, determinate ? loaded! : null, determinate ? total! : null)
  const slowFirstRun = useSlowFirstDownload(phase)

  // Numbers only, in one line: bytes, percent, estimate, elapsed. The headline
  // above already named the phase; this line only ever qualifies it.
  const detail = [
    typeof loaded === 'number'
      ? determinate
        ? `${mb(loaded)} of ${mb(total!)}`
        : mb(loaded)
      : null,
    pct !== null ? `${pct}%` : null,
    eta,
    elapsed !== null ? `${elapsed}s` : null,
  ].filter(Boolean)

  return (
    <div data-phase={phase} className={BLOCK}>
      <p className="font-ui text-btn leading-[1.35] font-semibold text-text-1">{phaseLabel(phase)}</p>

      <div className="mt-2 flex items-center gap-2">
        <div className={TRACK}>
          {determinate ? (
            <div className={FILL} style={{ width: `${pct}%` }} />
          ) : (
            // A 30%-wide sweep, and the counter below carries the real
            // information: an indeterminate bar alone is indistinguishable
            // from a hang.
            <div className={FILL + ' ' + SWEEP} />
          )}
        </div>
      </div>

      <p className={META + ' mt-2'}>{detail.join(' · ')}</p>
      {slowFirstRun ? (
        <p className="m-0 font-ui text-meta leading-normal text-text-3">{COPY.runtimeFirstRunNote}</p>
      ) : null}
    </div>
  )
}

/**
 * Seconds since the current phase began, or null when there is nothing worth
 * counting.
 *
 * A phase with no byte counts can last a long time with nothing to report:
 * Java's in-browser bootstrap compile measured 7 s warm and up to 20 s cold
 * (runtimes/java/INTEGRATION.md), during which nothing else changes. A frozen
 * block under a looping CSS sweep reads as a hang, so count the seconds.
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

  // From zero, not from one: the line under the bar must never be empty, or an
  // engine that reports no bytes leaves an indeterminate bar with no numbers at
  // all — which §7.6 forbids precisely because it is indistinguishable from a hang.
  return active ? elapsed : null
}

/**
 * True once the download phase has run 8 s without finishing — the one moment
 * reassurance earns its line. A cached engine clears `download` in well under
 * that, so the note only ever appears on a genuine first run over a slow
 * connection, and it appears inside the block, never as a transcript row.
 */
function useSlowFirstDownload(phase: LoadProgress['phase']): boolean {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (phase !== 'download') {
      setSlow(false)
      return
    }
    const id = window.setTimeout(() => setSlow(true), 8000)
    return () => window.clearTimeout(id)
  }, [phase])

  return slow
}

/**
 * "about 40s left", from the observed transfer rate (spec §7.6 anatomy).
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
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5}s left`
  if (seconds < 150) return 'about a minute left'
  return `about ${Math.round(seconds / 60)} min left`
}
