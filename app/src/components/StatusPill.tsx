import type { RunStatus } from '../hooks/useRunner'

/**
 * Spec §7.3. Red and green are the two colours a colour-blind student is most
 * likely to confuse, and they carry our two most important messages (failed vs
 * finished) — so every state pairs its colour with a glyph *and* a word, and the
 * five states stay distinguishable in a greyscale screenshot.
 *
 * "Stopped by you" is deliberately neutral, not red: the student did that on
 * purpose, and reserving red for genuine failure is what makes red mean something.
 */
/* Both variants say the same seven things in the same seven tones; they differ
 * only in whether the tone is a fill or plain tinted text. Colour is never the
 * only signal in either — the glyph and the word travel with it (spec §7.3). */
const PILL =
  'inline-flex items-center gap-1 flex-initial min-w-0 h-[24px] px-2 rounded-pill ' +
  'text-micro leading-none font-semibold tracking-[0.02em] whitespace-nowrap ' +
  'data-[state=idle]:bg-surface-4 data-[state=idle]:text-text-2 ' +
  'data-[state=preparing]:bg-success-soft data-[state=preparing]:text-success ' +
  'data-[state=running]:bg-success-soft data-[state=running]:text-success ' +
  'data-[state=ok]:bg-success-soft data-[state=ok]:text-success ' +
  'data-[state=waiting]:bg-info-soft data-[state=waiting]:text-info ' +
  'data-[state=failed]:bg-danger-soft data-[state=failed]:text-danger ' +
  // Neutral, not red: the student stopped it on purpose, and reserving red for
  // genuine failure is what makes red mean something.
  'data-[state=stopped]:bg-neutral-soft data-[state=stopped]:text-text-2'

/* A filled capsule in a 26px status bar reads as a button, and VSCode's status
 * bar is text — so the same state renders as plain tinted text there. */
const BAR =
  'inline-flex items-center gap-1 min-w-0 font-semibold tracking-[0.02em] whitespace-nowrap text-text-2 ' +
  'data-[state=preparing]:text-success data-[state=running]:text-success data-[state=ok]:text-success ' +
  'data-[state=waiting]:text-info data-[state=failed]:text-danger'

/* 12px: §3.2's floor applies to the glyph too. The box stays narrow so the
 * pill does not grow. */
const GLYPH = 'grid place-items-center flex-none w-3 text-micro leading-none'

const pills: Record<RunStatus, { label: string; glyph: string }> = {
  idle: { label: 'Ready', glyph: '○' },
  preparing: { label: 'Preparing', glyph: 'dot' },
  running: { label: 'Running', glyph: 'dot' },
  waiting: { label: 'Waiting for you', glyph: '▸' },
  ok: { label: 'Finished', glyph: '✓' },
  failed: { label: 'Stopped early', glyph: '✕' },
  stopped: { label: 'Stopped by you', glyph: '■' },
}

export function StatusPill({
  status,
  exitCode,
  variant = 'pill',
}: {
  status: RunStatus
  exitCode: number | null
  /**
   * `pill` is the filled capsule in the console header. `bar` is the same state,
   * the same word and the same glyph rendered as plain tinted text for the
   * status bar, which is 26px tall and where VSCode uses text rather than a
   * chip.
   *
   * The variants share this component so the seven states can only ever be
   * worded once — but they must NOT share the `.pill` class: tools/qa reads
   * `document.querySelector('.pill')` unscoped, and a second one on screen makes
   * every one of those selectors ambiguous.
   */
  variant?: 'pill' | 'bar'
}) {
  const pill = pills[status]
  const detail = status === 'failed' && exitCode !== null ? ` · exit ${exitCode}` : null
  return (
    // aria-label carries the exit code even when the visual suffix is dropped, so
    // a screen reader never loses it to a breakpoint.
    // The bare `pill` class carries no styling — it is the contract selector
    // tools/qa reads unscoped, which is why only this variant may wear it.
    <span
      data-state={status}
      className={variant === 'pill' ? 'pill ' + PILL : BAR}
      aria-label={detail ? pill.label + detail : undefined}
    >
      {/* The one continuous animation in the app: a 1.4s pulse on a 6px dot,
          static under prefers-reduced-motion, where the word carries it. */}
      <span aria-hidden="true" className={GLYPH}>
        {pill.glyph === 'dot' ? (
          <span className="size-[6px] rounded-pill bg-current animate-dot-pulse motion-reduce:animate-none" />
        ) : (
          pill.glyph
        )}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap">
        {pill.label}
        {/* The exit code is the first thing that goes when the console header
            runs out of room on a phone — the transcript states it in full a few
            pixels below, so nothing is actually lost. The status bar never gets
            that narrow, so it always shows it. */}
        {detail ? <span className={variant === 'pill' ? 'hidden min-[900px]:inline' : undefined}>{detail}</span> : null}
      </span>
    </span>
  )
}
