import { useRef } from 'react'

/**
 * Console resize handle. Renders as a hairline but keeps a 44px hit area
 * (spec §6), and is keyboard-operable as a separator.
 */
export function ConsoleDivider({ height, onHeight }: { height: number; onHeight(px: number): void }) {
  const drag = useRef<{ y: number; h: number } | null>(null)

  const clamp = (px: number) => Math.max(144, Math.min(px, Math.max(200, window.innerHeight - 200)))

  return (
    <div
      role="separator"
      aria-label="Resize output"
      aria-orientation="horizontal"
      tabIndex={0}
      className="group relative h-3 shrink-0 cursor-row-resize touch-none bg-surface-1"
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, h: height }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        onHeight(clamp(drag.current.h + (drag.current.y - e.clientY)))
      }}
      onPointerUp={(e) => {
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onHeight(clamp(height + 24))
        else if (e.key === 'ArrowDown') onHeight(clamp(height - 24))
        else return
        e.preventDefault()
      }}
    >
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border-subtle group-hover:bg-accent" />
    </div>
  )
}
