/**
 * Inlined from docs/design/logo.svg so it recolours through --logo-ink.
 *
 * The mark is a vise: two bracket-shaped jaws holding a workpiece. "Warsha"
 * means workshop, so the brackets read as both the vise that clamps work to a
 * bench and the brackets of code. DESIGN-SPEC §11 has the full rationale.
 *
 * Brand v3: the founder's actual mark is a glitched raster (see
 * docs/design/brand-v3/ and the notes atop docs/design/mark.svg) — real
 * texture, not something worth hand-tracing into paths. This component only
 * ever renders at 40px (LogoLockup below is its one call site), well under
 * the ~180px floor where that texture stays legible, so it renders the clean
 * silhouette tier instead: same two-jaws-and-pill structure, geometry
 * measured off the source PNG. No amber — brand v3 killed the accent
 * workpiece, jaws and pill are both --logo-ink now.
 *
 * This is one of three hand-maintained copies of the geometry (the others
 * are docs/design/logo.svg and the boot splash inlined in app/index.html).
 * Nothing keeps them in sync automatically — change one, change all three.
 */
export function Logo({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="Warsha"
      className={className}
      style={{ '--logo-ink': 'var(--text-1)' } as React.CSSProperties}
    >
      <path
        d="M6.75 4.275 3.15 4.275 3.15 19.725 6.75 19.725"
        stroke="var(--logo-ink, #FAFAFA)"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.25 4.275 20.85 4.275 20.85 19.725 17.25 19.725"
        stroke="var(--logo-ink, #FAFAFA)"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="9.6" y="7.65" width="4.8" height="8.7" rx="2.4" fill="var(--logo-ink, #FAFAFA)" />
    </svg>
  )
}

/**
 * Welcome-screen lockup: the mark above the Latin wordmark.
 *
 * Built in HTML rather than from logo-lockup.svg (spec §7.7) so the wordmark
 * stays real text and therefore crisp at any size, rather than a traced path.
 */
export function LogoLockup() {
  return (
    // `lockup` and `lockup__word` carry no styling — tools/qa selects them.
    <div className="lockup flex flex-col items-center gap-2">
      <Logo size={40} />
      <div className="lockup__word text-[28px] leading-[1.15] font-semibold tracking-[-0.015em] text-text-1">
        Warsha
      </div>
    </div>
  )
}
