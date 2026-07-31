import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconClose } from './Icons'

export type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

/** An error is worth more reading time than a confirmation. */
const LIFETIME: Record<ToastKind, number> = { info: 3200, success: 3200, error: 5600 }
/** Past three, a stack stops being a message and becomes a wall. */
const MAX_VISIBLE = 3
/** Travel, in px, past which a swipe counts as a dismissal. */
const SWIPE_OUT = 56

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export const useToast = () => useContext(ToastContext)

/**
 * Toasts live at the TOP of the screen, under the top bar — never at the bottom.
 * The bottom belongs to the console transcript, the sticky stdin row and the
 * software keyboard (spec §4.3 rule 1), and a toast that covers the question a
 * program just asked is worse than no toast at all.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), [])

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((cur) => [...cur, { id, message, kind }].slice(-MAX_VISIBLE))
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ top: 'calc(var(--bar-top) + var(--sp-2))' }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <Toast key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/** Never colour alone: every kind carries a glyph as well (spec §10). */
const GLYPH: Record<ToastKind, string> = { info: 'i', success: '✓', error: '✕' }
const INK: Record<ToastKind, string> = { info: 'text-info', success: 'text-success', error: 'text-danger' }
/** error already has its border and fill in index.css (.toast[data-kind]). */
const EDGE: Record<ToastKind, string> = { info: '', success: 'border-success', error: '' }

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [dx, setDx] = useState(0)
  const [gone, setGone] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const close = () => onDismiss(item.id)

  // Keyed on the item, so a later toast arriving cannot restart this one's clock.
  useEffect(() => {
    const t = window.setTimeout(() => onDismiss(item.id), LIFETIME[item.kind])
    return () => clearTimeout(t)
  }, [item.id, item.kind, onDismiss])

  const end = () => {
    if (!drag.current) return
    drag.current = null
    if (Math.abs(dx) > SWIPE_OUT) {
      setGone(true)
      close()
    } else setDx(0)
  }

  return (
    <div
      data-kind={item.kind}
      className={`toast pointer-events-auto flex min-h-touch w-full items-center gap-2 pr-1 ${EDGE[item.kind]}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, opacity: gone ? 0 : 1, touchAction: 'pan-y' }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        const moved = e.clientX - d.x
        if (Math.abs(moved) > Math.abs(e.clientY - d.y)) setDx(moved)
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span aria-hidden="true" className={`shrink-0 text-[13px] font-bold ${INK[item.kind]}`}>
        {GLYPH[item.kind]}
      </span>
      <p className="flex-1">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={close}
        className="icon-btn size-touch cursor-pointer text-current"
      >
        <IconClose size={16} />
      </button>
    </div>
  )
}
