import { useEffect, useRef, useState } from 'react'
import { progressPercent, type LoadProgress } from '../runtime/types'
import { COPY } from '../copy'
import { useAfter } from '../ui/useAfter'

// The engine's own `message` is deliberately never rendered — showing it alongside
// this phase label would read as two competing progress reports. `inRun` is what
// tells the same phase apart: a download inside a run is Python's packages (the
// language is already here), and a compile during boot is C/C#'s compiler warm-up,
// not the student's code.
const phaseLabel = (phase: LoadProgress['phase'], inRun: boolean, language: string | null): string =>
  ({
    download: inRun ? COPY.phasePackages : language ? COPY.phaseDownloadingLang(language) : COPY.phaseDownloading,
    unpack: COPY.phaseUnpacking,
    boot: language ? COPY.phaseStartingLang(language) : COPY.phaseStarting,
    compile: inRun ? COPY.phaseCompiling : COPY.phasePreparingCompiler,
  })[phase]

/** The sentence that says a long phase is expected, and how soon it may show. Unpack is too short to need one. */
const phaseNote = (phase: LoadProgress['phase'], inRun: boolean): { text: string; afterMs: number } | null =>
  ({
    // Soon, not instantly: a cached engine's download is over before this would show.
    download: { text: inRun ? COPY.phasePackagesNote : COPY.runtimeFirstRunNote, afterMs: 2000 },
    unpack: null,
    boot: { text: COPY.phaseBootNote, afterMs: 5000 },
    compile: { text: inRun ? COPY.phaseCompileNote : COPY.phaseCompilerNote, afterMs: 5000 },
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
/** The indeterminate sweep, shared with the console header's activity line (RunBar). */
export const SWEEP =
  'w-[30%] animate-sweep rtl:animate-sweep-rtl motion-reduce:animate-none motion-reduce:w-full motion-reduce:opacity-50'

/**
 * First-run engine download (spec §7.6), rendered in the console rather than a modal.
 * Contract: something numeric must change on screen at least every 2 seconds, or a
 * student assumes the site is broken and closes the tab — so an indeterminate bar
 * always pairs with a live byte counter, or elapsed seconds when there are no bytes at all.
 */
export function ProgressBlock({
  progress,
  inRun = false,
  language = null,
}: {
  progress: LoadProgress
  /** Reported from inside run() (Java's compile, Python's packages) rather than the language's own boot. */
  inRun?: boolean
  /** "Python", "Java" — null where there is no language name to give. */
  language?: string | null
}) {
  const { loaded, total, phase } = progress
  const pct = progressPercent(progress)
  const determinate = pct !== null
  // A determinate bar is its own clock — until the bytes stop moving for a moment (a
  // slow file's headers, a congested link). Then the seconds show, so the line never sits still.
  const bytesIdle = useAfter(determinate, 2000, loaded)
  const elapsed = useElapsedSeconds(phase, !determinate || bytesIdle)
  const eta = useEta(phase, determinate ? loaded! : null, determinate ? total! : null)
  const note = phaseNote(phase, inRun)
  const showNote = useAfter(note !== null, note?.afterMs ?? 0, phase)

  // One line of numbers only — the headline above already names the phase.
  const detail = [
    typeof loaded === 'number'
      ? determinate
        ? COPY.progressOf(mb(loaded), mb(total!))
        : mb(loaded)
      : null,
    pct !== null ? `${pct}%` : null,
    eta,
    elapsed !== null ? COPY.elapsedSeconds(elapsed) : null,
  ].filter(Boolean)

  return (
    <div data-phase={phase} className={BLOCK}>
      <p className="font-ui text-btn leading-[1.35] font-semibold text-text-1">{phaseLabel(phase, inRun, language)}</p>

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
      {note && showNote ? <p className="m-0 font-ui text-meta leading-normal text-text-3">{note.text}</p> : null}
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
  // Counted from the phase's start, not from when the counter appears: a counter that
  // shows up at "0s" twenty seconds into a download would undersell the wait.
  const [started, setStarted] = useState(() => Date.now())

  useEffect(() => {
    setStarted(Date.now())
    setElapsed(0)
  }, [phase])

  useEffect(() => {
    if (!active) return
    const tick = () => setElapsed(Math.round((Date.now() - started) / 1000))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [started, active])

  // From zero, not one: the line under the bar must never be empty (§7.6).
  return active ? elapsed : null
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
  if (seconds < 10) return COPY.etaFewSeconds
  if (seconds < 90) return COPY.etaSeconds(Math.round(seconds / 5) * 5)
  if (seconds < 150) return COPY.etaMinute
  return COPY.etaMinutes(Math.round(seconds / 60))
}
