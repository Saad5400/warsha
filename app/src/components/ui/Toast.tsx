import { cva, cx } from 'class-variance-authority'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useKeyboardOpen } from '../../hooks/useMedia'
import { IconClose } from './Icons'

export type ToastKind = 'info' | 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  /** Dismissed, still on screen, playing its 90ms exit. */
  leaving?: boolean
}

/** An error is worth more reading time than a confirmation. */
const LIFETIME: Record<ToastKind, number> = { info: 3200, success: 3200, error: 5600 }
/** Past three, a stack stops being a message and becomes a wall. */
const MAX_VISIBLE = 3
/** Travel, in px, past which a swipe counts as a dismissal. */
const SWIPE_OUT = 56
/** The 90ms exit, plus a frame. */
const EXIT_MS = 110

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export const useToast = () => useContext(ToastContext)

/**
 * Toasts live at the TOP of the screen, under the top bar — never at the bottom.
 * The bottom belongs to the console transcript, the sticky stdin row and the
 * software keyboard (spec §4.3 rule 1), and a toast that covers the question a
 * program just asked is worse than no toast at all.
 *
 * A sonner-style stack: each toast slides in from the edge it is pinned to and
 * slides back out when it goes. The whole stack pauses its clocks while a
 * pointer is over it or a key has focused something inside it, so nothing
 * expires while it is being read or while the dismiss button is being aimed at.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [paused, setPaused] = useState(false)
  // The top bar compacts to --bar-top-kb with the keyboard up (spec §4.3 rule 3);
  // the stack rides down with it rather than leaving a 4px gap.
  const keyboardOpen = useKeyboardOpen()

  // Two steps: mark it leaving so the exit can play, then drop it. Anything
  // already leaving is left alone, so a second dismiss cannot restart the clock.
  const dismiss = useCallback((id: number) => {
    setItems((cur) => {
      const t = cur.find((i) => i.id === id)
      if (!t || t.leaving) return cur
      return cur.map((i) => (i.id === id ? { ...i, leaving: true } : i))
    })
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), EXIT_MS)
  }, [])

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((cur) => {
      const next = [...cur, { id, message, kind }]
      // Count only what is still alive: a toast on its way out must not push a
      // live one off the end of the stack.
      const live = next.filter((t) => !t.leaving)
      if (live.length <= MAX_VISIBLE) return next
      const drop = new Set(live.slice(0, live.length - MAX_VISIBLE).map((t) => t.id))
      return next.filter((t) => !drop.has(t.id))
    })
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // One corner, always: the trailing end of the top bar. Centred, a toast
        // covers the active tab — the one thing that says which file you are in.
        className="pointer-events-none fixed inset-x-0 z-(--z-toast) flex flex-col items-end gap-2 px-4"
        // The one computed value here, and the exception ARCHITECTURE §4.2
        // already names: the offset tracks the top bar, which compacts to
        // --bar-top-kb when the software keyboard is up.
        // --bar-title, not --bar-top: the title bar is 52px at ≥900px so its
        // filled Run control clears the divider, and a toast pinned to 44 there
        // would sit ON the bar instead of 8px under it.
        style={{ top: `calc(var(${keyboardOpen ? '--bar-top-kb' : '--bar-title'}) + var(--sp-2))` }}
        role="status"
        aria-live="polite"
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {items.map((t) => (
          <Toast key={t.id} item={t} paused={paused} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Never colour alone: every kind carries a glyph as well (spec §10), so the
 * three stay distinguishable in greyscale. `data-kind` stays on the element —
 * ARCHITECTURE §4 publishes it as the way a stylesheet reads this state.
 */
const GLYPH: Record<ToastKind, string> = { info: 'i', success: '✓', error: '✕' }

const toast = cva(
  cx(
    // `toast` carries NO styles any more — the rule it used to name is gone from
    // index.css. It stays on the element purely as a selector hook, because
    // `.toast` is how screenshots and ad-hoc QA have always found these. The
    // published state contract is still `role="status"` on the stack and
    // `data-kind` on the row (ARCHITECTURE §4).
    'toast',
    'pointer-events-auto flex min-h-touch w-full max-w-[min(32rem,90vw)] items-center gap-2',
    'rounded-md border py-2 pr-1 pl-4 text-meta leading-normal shadow-raised',
    'animate-toast-in data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-toast-out',
    // A toast under a finger follows it with nothing in the way — in particular
    // without the enter animation still overriding its inline transform.
    'data-[dragging=true]:animate-none',
  ),
  {
    variants: {
      kind: {
        info: 'border-border-subtle bg-surface-3 text-text-1',
        success: 'border-success bg-surface-3 text-text-1',
        error: 'border-danger bg-danger-soft text-danger',
      },
    },
    defaultVariants: { kind: 'info' },
  },
)

const glyph = cva('grid w-[16px] flex-none place-items-center text-meta leading-none font-bold', {
  variants: {
    kind: { info: 'text-info', success: 'text-success', error: 'text-current' },
  },
  defaultVariants: { kind: 'info' },
})

function Toast({
  item,
  paused,
  onDismiss,
}: {
  item: ToastItem
  paused: boolean
  onDismiss: (id: number) => void
}) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const close = () => onDismiss(item.id)

  // Keyed on the item, so a later toast arriving cannot restart this one's clock.
  // Held while the stack is paused or this one is being dragged, and abandoned
  // once it is on its way out.
  const remaining = useRef(LIFETIME[item.kind])
  const startedAt = useRef(0)
  const held = paused || dragging || !!item.leaving
  useEffect(() => {
    if (held) return
    startedAt.current = Date.now()
    const t = window.setTimeout(() => onDismiss(item.id), remaining.current)
    return () => {
      clearTimeout(t)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
    }
  }, [held, item.id, onDismiss])

  const end = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    // Dismissed by swipe: dx is deliberately left where the finger let go, so
    // the exit animation carries on from there instead of snapping back first.
    if (Math.abs(dx) > SWIPE_OUT) close()
    else setDx(0)
  }

  return (
    <div
      data-kind={item.kind}
      data-leaving={item.leaving ? 'true' : undefined}
      data-dragging={dragging ? 'true' : undefined}
      className={toast({ kind: item.kind })}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        const moved = e.clientX - d.x
        if (Math.abs(moved) > Math.abs(e.clientY - d.y)) {
          setDragging(true)
          setDx(moved)
        }
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <span aria-hidden="true" className={glyph({ kind: item.kind })}>
        {GLYPH[item.kind]}
      </span>
      <p className="min-w-0 flex-1">{item.message}</p>
      <button type="button" aria-label="Dismiss" title="Dismiss" onClick={close} className="icon-btn text-current">
        <IconClose size={16} />
      </button>
    </div>
  )
}
