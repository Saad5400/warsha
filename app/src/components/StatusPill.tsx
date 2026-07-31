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
const pills: Record<RunStatus, { label: string; glyph: string }> = {
  idle: { label: 'Ready', glyph: '○' },
  preparing: { label: 'Preparing', glyph: 'dot' },
  running: { label: 'Running', glyph: 'dot' },
  waiting: { label: 'Waiting for you', glyph: '▸' },
  ok: { label: 'Finished', glyph: '✓' },
  failed: { label: 'Stopped early', glyph: '✕' },
  stopped: { label: 'Stopped by you', glyph: '■' },
}

export function StatusPill({ status, exitCode }: { status: RunStatus; exitCode: number | null }) {
  const pill = pills[status]
  const detail = status === 'failed' && exitCode !== null ? ` · exit ${exitCode}` : null
  return (
    // aria-label carries the exit code even when the visual suffix is dropped, so
    // a screen reader never loses it to a breakpoint.
    <span data-state={status} className="pill" aria-label={detail ? pill.label + detail : undefined}>
      {/* The one continuous animation in the app: a 1.4s pulse on a 6px dot,
          static under prefers-reduced-motion, where the word carries it. */}
      <span aria-hidden="true" className="pill__glyph">
        {pill.glyph === 'dot' ? <span className="dot" /> : pill.glyph}
      </span>
      <span className="pill__label">
        {pill.label}
        {/* The exit code is the first thing that goes when the console header
            runs out of room on a phone — the transcript states it in full a few
            pixels below, so nothing is actually lost. */}
        {detail ? <span className="hidden min-[900px]:inline">{detail}</span> : null}
      </span>
    </span>
  )
}
