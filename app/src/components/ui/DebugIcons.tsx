/**
 * Debug glyphs, drawn on a 16px grid to read as VS Code's debug codicons
 * (continue, pause, step over/into/out, restart, stop, breakpoint) without
 * copying them. Same contract as ui/Icons.tsx: aria-hidden, currentColor.
 */
import type { SVGProps } from 'react'

type P = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

function G({ size = 16, children, ...rest }: P & { children?: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconDebugContinue = (p: P) => (
  <G {...p}>
    <path d="M3.5 3v10" />
    <path d="M6.5 3.2v9.6a.4.4 0 0 0 .62.33l6.9-4.8a.4.4 0 0 0 0-.66l-6.9-4.8a.4.4 0 0 0-.62.33Z" fill="currentColor" stroke="none" />
  </G>
)

export const IconDebugPause = (p: P) => (
  <G {...p}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth="1.8" />
  </G>
)

export const IconDebugStepOver = (p: P) => (
  <G {...p}>
    <path d="M2.8 8.2a5.2 5.2 0 0 1 10.1-1.7" />
    <path d="M13.4 3.4v3.4H10" />
    <circle cx="8" cy="12.5" r="1.6" fill="currentColor" stroke="none" />
  </G>
)

export const IconDebugStepInto = (p: P) => (
  <G {...p}>
    <path d="M8 1.8v7" />
    <path d="M5 6l3 3 3-3" />
    <circle cx="8" cy="12.8" r="1.6" fill="currentColor" stroke="none" />
  </G>
)

export const IconDebugStepOut = (p: P) => (
  <G {...p}>
    <path d="M8 9.2v-7" />
    <path d="M5 5l3-3 3 3" />
    <circle cx="8" cy="12.8" r="1.6" fill="currentColor" stroke="none" />
  </G>
)

export const IconDebugRestart = (p: P) => (
  <G {...p}>
    <path d="M12.9 9.2A5 5 0 1 1 11.6 4.4" />
    <path d="M12.4 1.9v3.2H9.2" />
  </G>
)

export const IconDebugStop = (p: P) => (
  <G {...p}>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="currentColor" stroke="none" />
  </G>
)

/** Run-with-a-bug: the Run and Debug activity glyph and the editor-title Debug button. */
export const IconDebugAlt = (p: P) => (
  <G {...p}>
    <path d="M3 2.6v8.8a.4.4 0 0 0 .6.34L8 9" />
    <path d="M3.6 2.25 10.4 6.3" />
    <ellipse cx="11.6" cy="11.4" rx="2" ry="2.5" />
    <path d="M9.6 10.6H8.4M14.8 10.6h-1.2M9.6 12.6H8.6M14.6 12.6h-1M10.6 8.6l-.7-.8M12.6 8.6l.7-.8" />
  </G>
)

export const IconBreakpoint = (p: P) => (
  <G {...p}>
    <circle cx="8" cy="8" r="4.2" fill="var(--debug-bp)" stroke="none" />
  </G>
)

export const IconBreakpointsToggle = (p: P) => (
  <G {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M4.8 11.2 11.2 4.8" />
  </G>
)

export const IconCloseAll = (p: P) => (
  <G {...p}>
    <path d="M3 5h7.5v7.5H3z" />
    <path d="M5.5 2.5H13V10" />
    <path d="M5 7l3.5 3.5M8.5 7 5 10.5" />
  </G>
)
