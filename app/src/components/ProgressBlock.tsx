import { useEffect, useRef, useState } from 'react'
import type { LoadProgress } from '../runtime/types'
import { COPY } from '../copy'

// The engine's own `message` is deliberately never rendered — showing it alongside
// this phase label would read as two competing progress reports.
const phaseLabel = (phase: LoadProgress['phase']): string =>
  ({
    download: COPY.phaseDownloading,
    unpack: COPY.phaseUnpacking,
    boot: COPY.phaseStarting,
    compile: COPY.phaseCompiling,
  })[phase]

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

// Flush with the console rows (not a rounded card, which read as a stray dialog) so boot
// progress looks like program output; the accent rule keeps it visibly Warsha's, not the program's.
const BLOCK =
  'progress-block mb-2 px-3 pt-1 pb-2 border-s-[3px] border-s-accent ' +
  'bg-[color-mix(in_srgb,var(--accent-soft)_45%,transparent)]'

// tabular-nums: without it the line twitches sideways every tick.
const META = 'font-code text-meta leading-normal tabular-nums text-text-3'

/* `progress-block` and `progress-track` carry no styling — tools/qa reads them. */
const TRACK = 'progress-track relative flex-1 h-1 overflow-hidden rounded-pill bg-surface-4'
const FILL = 'h-full rounded-pill bg-accent transition-[width] duration-200 ease-linear'
const SWEEP = 'w-[30%] animate-sweep motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-50'

/**
 * First-run engine download (spec §7.6), rendered in the console rather than a modal.
 * Contract: something numeric must change on screen at least every 2 seconds, or a
 * student assumes the site is broken and closes the tab — so an indeterminate bar
 * always pairs with a live byte counter, or elapsed seconds when there are no bytes at all.
 */
export function ProgressBlock({ progress }: { progress: LoadProgress }) {
  const { loaded, total, phase } = progress
  const determinate = typeof loaded === 'number' && typeof total === 'number' && total > 0
  const pct = determinate ? Math.min(100, Math.round((loaded! / total!) * 100)) : null
  const elapsed = useElapsedSeconds(phase, !determinate)
  const eta = useEta(phase, determinate ? loaded! : null, determinate ? total! : null)
  const slowFirstRun = useSlowFirstDownload(phase)

  // One line of numbers only — the headline above already names the phase.
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
            // The counter below carries the real info — an indeterminate bar alone reads as a hang.
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
 * Seconds since the phase began, or null when nothing's worth counting (a determinate
 * bar is already doing that job). Needed because a byteless phase can run long with
 * nothing to report — Java's cold bootstrap compile takes up to 20s — and a frozen
 * block under a looping sweep reads as a hang.
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

  // From zero, not one: the line under the bar must never be empty (§7.6).
  return active ? elapsed : null
}

/**
 * True once `download` has run 8s without finishing — a cached engine clears it well
 * under that, so this only fires on a genuine slow first run.
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
 * "about 40s left", from the observed rate — measured against the phase's first sample
 * (not instantaneously) so it doesn't swing wildly on school Wi-Fi. Deliberately vague:
 * a precise-looking wrong ETA reads worse than an approximate right one.
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
