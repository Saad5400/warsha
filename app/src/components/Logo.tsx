/**
 * Inlined from docs/design/logo.svg so it recolours through --logo-ink and
 * --logo-accent.
 *
 * The mark is a vise: two bracket-shaped jaws holding a workpiece. "Warsha"
 * means workshop, so the brackets read as both the vise that clamps work to a
 * bench and the brackets of code, and the workpiece carries the accent — the
 * colour the interface already uses to mean "this one is live". DESIGN-SPEC §11
 * has the full rationale and the candidates it beat.
 *
 * This is one of three hand-maintained copies of the geometry (the others are
 * docs/design/logo.svg and the boot splash inlined in app/index.html). Nothing
 * keeps them in sync automatically — change one, change all three.
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
      style={{ '--logo-ink': 'var(--text-1)', '--logo-accent': 'var(--accent)' } as React.CSSProperties}
    >
      <path
        d="M8.8 5.6h-3a1.15 1.15 0 0 0-1.15 1.15v10.5a1.15 1.15 0 0 0 1.15 1.15h3"
        stroke="var(--logo-ink, #E8EBF0)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.2 5.6h3a1.15 1.15 0 0 1 1.15 1.15v10.5a1.15 1.15 0 0 1-1.15 1.15h-3"
        stroke="var(--logo-ink, #E8EBF0)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="9.4" y="8.6" width="5.25" height="6.75" rx="1.5" fill="var(--logo-accent, #F2A94B)" />
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
