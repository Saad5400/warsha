/**
 * Inlined from docs/design/logo.svg so it recolours through --logo-ink and
 * --logo-accent. The amber bar is the brand signature — the same 2px accent rule
 * that sits under the active tab.
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
 * Arabic font shapes and joins it.
 */
export function LogoLockup() {
  return (
    <div className="flex flex-col items-center gap-1">
      <Logo size={40} />
      <div className="text-[28px] font-semibold leading-tight text-text-1">Warsha</div>
      <div lang="ar" dir="rtl" className="text-[15px] text-text-3">
        ورشة
      </div>
    </div>
  )
}
