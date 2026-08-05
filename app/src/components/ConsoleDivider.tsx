import { useRef, useState } from 'react'

/** Matches the console's own floor (spec §4.3 rule 4) and leaves the editor its 96px. */
const MIN_H = 144
const DEFAULT_H = 240

/**
 * The console resize handle — at EVERY width and pointer, now that the panel's
 * height is the same persisted pixel value everywhere (one shell, founder
 * ruling; the old fixed-40% phone console was a second layout).
 *
 * On a coarse pointer it renders as a hairline with a visible grabber — the
 * touch adjustment: no hover means an invisible sash reads as a fixed panel —
 * and its grab band is **24px**, not the 44px the spec asks of touch targets.
 * That is deliberate: the 12px it occupies sits between a full-height editor
 * and a 44px console header whose toolbar buttons start at its very top edge,
 * so a 44px band would have to swallow either the last line of code or the
 * top half of a button. It grows upward only, into the editor's bottom
 * padding, and stops dead at the header — clearing WCAG 2.2 AA (24px) without
 * ever eating a tap meant for a button.
 *
 * At desk it dresses down to VS Code's sash: a 0-height root that owns NO
 * layout pixels at all — no hairline, no grabber; the panel's own 1px top seam
 * is the visible boundary. Its hit area is an absolute ±4px overlay straddling
 * that seam, and a 4px bar (also absolute, centred on the seam) floods
 * --sash-hover edge to edge on hover (after VS Code's ~300ms linger, so a
 * cursor passing through never flashes it), on keyboard focus, and for the
 * whole drag. ±4px, not the touch band's 24px, for the same
 * stop-at-the-header reason as above.
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
      className={
        // The desk sash collapses the root to 0 height — the editor/panel
        // boundary is the panel's own border, and everything visible or
        // clickable about the sash lives in the absolute spans below.
        // bg-transparent, not a fill: a 0px box paints nothing anyway, and
        // transparent stays honest if that ever changes.
        'group relative h-3 shrink-0 cursor-row-resize touch-none bg-surface-1 desk:h-0 desk:bg-transparent'
      }
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
      {/* The 24px grab band, upward into the editor: never over the header.
          Desk: ±4px around the 0-height boundary (VS Code's sash hit band) —
          any deeper and it would run into the header and steal clicks meant
          for the toolbar. */}
      <span aria-hidden="true" className="absolute inset-x-0 -top-3 h-6 desk:-top-1 desk:h-2 cursor-row-resize" />
      {/* The sash's visible face, desk only: a 4px bar centred on the panel's
          top seam, transparent at rest. delay-300 rides the group-hover
          variant only, so the flood-in lingers and the flood-out is immediate;
          dragging fills with no linger at all. Keyboard focus fills too — the
          0-height root has nothing for the base-layer focus ring to draw on,
          so this IS the focus indicator. */}
      <span
        aria-hidden="true"
        className={
          'pointer-events-none absolute inset-x-0 -top-0.5 h-1 hidden desk:block ' +
          'transition-colors duration-(--dur-fast) ease-standard ' +
          'group-hover:delay-300 group-hover:bg-sash-hover group-focus-visible:bg-sash-hover ' +
          'group-data-[dragging=true]:delay-0 group-data-[dragging=true]:bg-sash-hover'
        }
      />
      {/* PIXEL-FINDINGS F-09: `top-1/2` + `-translate-y-1/2` in a 12px (`h-3`) box
          put the 1px line at css 5.5..6.5 — straddling a device-pixel boundary,
          so at 2x/3x it rendered as ~1.33px of soft grey instead of a crisp
          rule. A literal `top-[6px]` with no translate lands exactly on 6.0..7.0.
          Desk hides it: the console-panel's own top seam is the boundary there,
          and a second rule 6px above it read as a doubled border. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[6px] h-px bg-border-subtle desk:hidden"
      />
      {/* A grabber you can see: a hairline alone is invisible until you find it
          with the cursor, which is how a resizable panel reads as fixed. That
          argument is a coarse-pointer one — at desk VS Code's sash is invisible
          until hovered and every desktop user already knows it, so the grabber
          stands down (desk:hidden) and the hover flood on the root carries the
          affordance instead. */}
      <span
        aria-hidden="true"
        className={
          'pointer-events-none absolute left-1/2 top-1/2 h-[3px] w-9 -translate-x-1/2 -translate-y-1/2 ' +
          // Parens, not brackets: Tailwind v4 reads the bracket form as an
          // arbitrary value and emits an invalid declaration the browser drops.
          'rounded-pill transition-colors duration-(--dur-fast) ' +
          'group-hover:bg-accent group-focus-visible:bg-accent group-data-[dragging=true]:bg-accent ' +
          'bg-border-control desk:hidden'
        }
      />
    </div>
  )
}
