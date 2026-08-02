import { useRef, useState } from 'react'

/** Matches the console's own floor (spec §4.3 rule 4) and leaves the editor its 96px. */
const MIN_H = 144
const DEFAULT_H = 240

/**
 * The console resize handle — a ≥900px affordance, so a pointer, not a thumb
 * (spec §6: dragging a divider with a thumb on a 390px screen is not worth
 * building, and phones toggle the console instead).
 *
 * It renders as a hairline with a visible grabber, and its hit area is **24px**,
 * not the 44px the spec asks of touch targets. That is deliberate: the 12px it
 * occupies sits between a full-height editor and a 44px console header whose Run
 * button starts at its very top edge, so a 44px band would have to swallow either
 * the last line of code or the top half of Run. It grows upward only, into the
 * editor's bottom padding, and stops dead at the header — clearing WCAG 2.2 AA
 * (24px) without ever eating a tap meant for a button.
 */
export function ConsoleDivider({ height, onHeight }: { height: number; onHeight(px: number): void }) {
  const drag = useRef<{ y: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const clamp = (px: number) => Math.max(MIN_H, Math.min(px, Math.max(MIN_H + 56, window.innerHeight - 200)))

  return (
    <div
      role="separator"
      aria-label="Resize output"
      aria-orientation="horizontal"
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      data-dragging={dragging ? 'true' : 'false'}
      className="group relative h-3 shrink-0 cursor-row-resize touch-none bg-surface-1"
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, h: height }
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        onHeight(clamp(drag.current.h + (drag.current.y - e.clientY)))
      }}
      onPointerUp={(e) => {
        drag.current = null
        setDragging(false)
        e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={() => onHeight(DEFAULT_H)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onHeight(clamp(height + 24))
        else if (e.key === 'ArrowDown') onHeight(clamp(height - 24))
        else if (e.key === 'Home') onHeight(DEFAULT_H)
        else return
        e.preventDefault()
      }}
    >
      {/* The 24px grab band, upward into the editor: never over the header. */}
      <span aria-hidden="true" className="absolute inset-x-0 -top-3 h-6 cursor-row-resize" />
      {/* PIXEL-FINDINGS F-09: `top-1/2` + `-translate-y-1/2` in a 12px (`h-3`) box
          put the 1px line at css 5.5..6.5 — straddling a device-pixel boundary,
          so at 2x/3x it rendered as ~1.33px of soft grey instead of a crisp
          rule. A literal `top-[6px]` with no translate lands exactly on 6.0..7.0. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[6px] h-px bg-border-subtle"
      />
      {/* A grabber you can see: a hairline alone is invisible until you find it
          with the cursor, which is how a resizable panel reads as fixed. */}
      <span
        aria-hidden="true"
        className={
          'pointer-events-none absolute left-1/2 top-1/2 h-[3px] w-9 -translate-x-1/2 -translate-y-1/2 ' +
          // Parens, not brackets: Tailwind v4 reads the bracket form as an
          // arbitrary value and emits an invalid declaration the browser drops.
          'rounded-pill transition-colors duration-(--dur-fast) ' +
          'group-hover:bg-accent group-focus-visible:bg-accent group-data-[dragging=true]:bg-accent ' +
          'bg-border-control'
        }
      />
    </div>
  )
}
