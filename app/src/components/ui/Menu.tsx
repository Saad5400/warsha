import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** Destructive: red ink, sorted last, behind a divider (spec §5.2). */
  danger?: boolean
  /** 20px leading glyph. Decorative — the label always carries the meaning. */
  icon?: ReactNode
  /** Trailing hint: a keyboard shortcut, or a count. */
  hint?: string
  /** Draws a divider above this item, so related actions read as one group. */
  startsGroup?: boolean
  disabled?: boolean
}

export interface MenuAnchor {
  x: number
  y: number
  /** Right-align to x (used when opening from a trailing-edge button). */
  fromRight?: boolean
}

/** Clear space kept between the menu and every viewport edge. */
const MARGIN = 8

/**
 * Long-press / overflow menu. Destructive items are separated by a divider and
 * always come last (spec §5.2) — Delete must never sit flush against something
 * frequent like Rename. The panel flips above its anchor rather than being
 * clipped, and arrow keys walk the items for hardware-keyboard users.
 */
export function Menu({
  anchor,
  items,
  onClose,
  label,
}: {
  anchor: MenuAnchor
  items: MenuItem[]
  onClose: () => void
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  const ordered = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)]
  const firstDanger = ordered.findIndex((i) => i.danger)

  // Measure, then place: never clipped, and flipped above the anchor when there
  // is no room below it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(MARGIN, Math.min(anchor.fromRight ? anchor.x - r.width : anchor.x, vw - r.width - MARGIN))
    const top =
      anchor.y + r.height <= vh - MARGIN
        ? anchor.y
        : anchor.y - r.height >= MARGIN
          ? anchor.y - r.height
          : Math.max(MARGIN, vh - r.height - MARGIN)
    setPos({ left, top })
  }, [anchor])

  // Focus the first item, so the menu is operable from a keyboard the moment it
  // opens. A pointer user sees no ring: :focus-visible does not fire for this.
  useEffect(() => {
    buttons.current.find((b) => b && !b.disabled)?.focus()
  }, [])

  // Capture, so Escape closes the menu without also reaching the shell's own
  // Escape handler and closing the drawer underneath it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const step = (from: number, dir: 1 | -1) => {
    const n = ordered.length
    if (n === 0) return
    for (let i = 1; i <= n; i++) {
      const next = buttons.current[(from + dir * i + n * n) % n]
      if (next && !next.disabled) return next.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0" onPointerDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        className="menu scroller absolute max-h-[calc(var(--app-h,100dvh)-var(--sp-4))] max-w-[min(20rem,calc(100vw-var(--sp-4)))]"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        onKeyDown={(e) => {
          const i = buttons.current.indexOf(e.target as HTMLButtonElement)
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            step(i < 0 ? -1 : i, 1)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            step(i < 0 ? 0 : i, -1)
          } else if (e.key === 'Home') {
            e.preventDefault()
            step(-1, 1)
          } else if (e.key === 'End') {
            e.preventDefault()
            step(0, -1)
          }
        }}
      >
        {ordered.map((item, i) => (
          <div key={item.label}>
            {i > 0 && (item.startsGroup || i === firstDanger) ? <div className="menu-sep" role="separator" /> : null}
            <MenuButton
              item={item}
              onClose={onClose}
              ref={(el) => {
                buttons.current[i] = el
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function MenuButton({
  item,
  onClose,
  ref,
}: {
  item: MenuItem
  onClose: () => void
  ref: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        onClose()
        item.onSelect()
      }}
      className={
        'menu-item cursor-pointer gap-3 disabled:cursor-not-allowed disabled:text-text-disabled' +
        (item.danger ? ' menu-item--danger' : '')
      }
    >
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-text-3">
        {item.icon}
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.hint ? <span className="shrink-0 text-micro text-text-3">{item.hint}</span> : null}
    </button>
  )
}
