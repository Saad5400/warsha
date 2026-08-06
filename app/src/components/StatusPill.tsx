import type { RunStatus } from '../hooks/useRunner'
import { COPY } from '../copy'

/**
 * Spec §7.3: every state pairs its colour with a glyph and a word — red/green are easy
 * to confuse for a colour-blind student, so colour alone can't carry failed vs finished.
 * "Stopped by you" is neutral, not red, so red stays reserved for genuine failure.
 */
// Both variants share the same seven states/tones; they differ only in fill vs tinted text.
const PILL =
  'inline-flex items-center gap-1 flex-initial min-w-0 h-[24px] px-2 rounded-pill ' +
  'text-micro leading-none font-semibold tracking-[0.02em] whitespace-nowrap ' +
  'data-[state=idle]:bg-surface-4 data-[state=idle]:text-text-2 ' +
  'data-[state=preparing]:bg-success-soft data-[state=preparing]:text-success ' +
  'data-[state=running]:bg-success-soft data-[state=running]:text-success ' +
  'data-[state=ok]:bg-success-soft data-[state=ok]:text-success ' +
  'data-[state=waiting]:bg-info-soft data-[state=waiting]:text-info ' +
  'data-[state=failed]:bg-danger-soft data-[state=failed]:text-danger ' +
  // Neutral, not red — reserved for a student's deliberate stop.
  'data-[state=stopped]:bg-neutral-soft data-[state=stopped]:text-text-2'

// VS Code's remote-indicator block: filled only while a run is live or has genuinely
// failed; quiet (no fill) at rest — colouring up only while something remote is happening.
// White-on-accent/danger are the ratios THEME-V4 §6 clears for this block.
const BAR =
  'status-remote h-full flex items-center gap-1 px-2 flex-none whitespace-nowrap ' +
  'text-statusbar-fg ' +
  'data-[state=preparing]:bg-statusbar-remote data-[state=preparing]:text-white ' +
  'data-[state=running]:bg-statusbar-remote data-[state=running]:text-white ' +
  'data-[state=waiting]:bg-statusbar-remote data-[state=waiting]:text-white ' +
  'data-[state=failed]:bg-danger-fill data-[state=failed]:text-white'

// §3.2's 12px floor applies to the glyph too; the box stays narrow so the pill doesn't grow.
const GLYPH = 'grid place-items-center flex-none w-3 text-micro leading-none'

const GLYPHS: Record<RunStatus, string> = {
  idle: '○',
  preparing: 'dot',
  running: 'dot',
  waiting: '▸',
  ok: '✓',
  failed: '✕',
  stopped: '■',
}

const pillLabel = (status: RunStatus): string =>
  ({
    idle: COPY.pillReady,
    preparing: COPY.pillPreparing,
    running: COPY.pillRunning,
    waiting: COPY.pillWaiting,
    ok: COPY.pillFinished,
    failed: COPY.pillFailed,
    stopped: COPY.pillStopped,
  })[status]

export function StatusPill({
  status,
  exitCode,
  variant = 'pill',
}: {
  status: RunStatus
  exitCode: number | null
  /**
   * `pill`: the console header's filled capsule, shown only while the keyboard hides the
   * status bar. `bar`: the same state/word/glyph as the status bar's remote-indicator block.
   * They must NOT share the `.pill` class — tools/qa reads it unscoped, and a second one
   * on screen makes every selector ambiguous.
   */
  variant?: 'pill' | 'bar'
}) {
  const label = pillLabel(status)
  const glyph = GLYPHS[status]
  const detail = status === 'failed' && exitCode !== null ? ` · exit ${exitCode}` : null
  return (
    // aria-label carries the exit code even when the visual suffix is dropped by a breakpoint.
    // Bare `pill` class carries no styling — it's the unscoped contract selector tools/qa reads.
    <span
      data-state={status}
      className={variant === 'pill' ? 'pill ' + PILL : BAR}
      aria-label={detail ? label + detail : undefined}
    >
      {/* The app's one continuous animation: a 1.4s dot pulse, static under prefers-reduced-motion. */}
      <span aria-hidden="true" className={GLYPH}>
        {glyph === 'dot' ? (
          <span className="size-[6px] rounded-pill bg-current animate-dot-pulse motion-reduce:animate-none" />
        ) : (
          glyph
        )}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {label}
        {/* First thing dropped when the console header runs out of room on a phone — the
            transcript states it in full just below, so nothing is lost. Status bar always shows it. */}
        {detail ? <span className={variant === 'pill' ? 'hidden min-[900px]:inline' : undefined}>{detail}</span> : null}
      </span>
    </span>
  )
}
