/**
 * Inlined from docs/design/logo.svg so it recolours through --logo-ink and
 * --logo-accent. The amber bar is the brand signature — the same 2px accent rule
 * that sits under the active tab and on the leading edge of a running process.
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
        d="M3.25 4.5 L8.5 15 L12 8.5 L15.5 15 L20.75 4.5"
        stroke="var(--logo-ink, #FFFFFF)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4.75 19.5 H19.25" stroke="var(--logo-accent, #F2A94B)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Welcome-screen lockup. Built in HTML rather than from logo-lockup.svg on
 * purpose (spec §7.7): the Arabic word must be real text so the device's own
 * Arabic font shapes and joins it. An SVG <text> cannot be relied on for that,
 * and tracing it to paths gives worse Arabic typography than the system font.
 */
export function LogoLockup() {
  return (
    // `lockup` and `lockup__word` carry no styling — tools/qa selects them.
    <div className="lockup flex flex-col items-center gap-2">
      <Logo size={40} />
      <div className="lockup__word text-[28px] leading-[1.15] font-semibold tracking-[-0.015em] text-text-1">
        Warsha
      </div>
      <div lang="ar" dir="rtl" className="text-btn leading-[1.6] text-text-3">
        ورشة
      </div>
    </div>
  )
}
