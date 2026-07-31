import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
}

export interface MenuAnchor {
  x: number
  y: number
  /** Right-align to x (used when opening from a trailing-edge button). */
  fromRight?: boolean
}

/**
 * Long-press / overflow menu. Destructive items are separated by a divider and
 * an 8px gap and always come last (spec §5.2) — Delete must never sit flush
 * against something frequent like Rename.
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
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.fromRight ? anchor.x - r.width : anchor.x, window.innerWidth - r.width - 8))
    const top = Math.max(8, Math.min(anchor.y, window.innerHeight - r.height - 8))
    setPos({ left, top })
  }, [anchor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const safe = items.filter((i) => !i.danger)
  const dangerous = items.filter((i) => i.danger)

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0" onPointerDown={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className="absolute min-w-[13rem] rounded-md border border-border-subtle bg-surface-3 p-1 shadow-raised"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
      >
        {safe.map((item) => (
          <MenuButton key={item.label} item={item} onClose={onClose} />
        ))}
        {dangerous.length > 0 && safe.length > 0 ? (
          <div className="my-2 border-t border-border-subtle" role="separator" />
        ) : null}
        {dangerous.map((item) => (
          <MenuButton key={item.label} item={item} onClose={onClose} />
        ))}
      </div>
    </div>
  )
}

function MenuButton({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose()
        item.onSelect()
      }}
      className={
        'tap flex min-h-touch w-full items-center rounded-sm px-3 text-left text-row ' +
        (item.danger ? 'text-danger hover:bg-danger-soft' : 'text-text-1 hover:bg-surface-4')
      }
    >
      {item.label}
    </button>
  )
}
