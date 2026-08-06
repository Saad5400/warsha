import { cva, cx } from 'class-variance-authority'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useKeyboardOpen, useMedia } from '../../hooks/useMedia'
import { IconButton } from './Button'
import { COPY } from '../../copy'
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
 * Stack position (toasts must never cover chrome):
 *   - ≥900px: top-trailing, under the title bar — clear of everything but editor margin.
 *   - <900px: bottom-centre, above the status bar — pinned to the top it sat on the
 *     44px tab strip and read as collapsed.
 *   - keyboard up: back to the top — the bottom belongs to the console transcript,
 *     stdin row and keyboard (spec §4.3 rule 1).
 *
 * Sonner-style: each toast slides in/out from its pinned edge. The stack pauses
 * its clocks on hover/focus so nothing expires mid-read or mid-dismiss.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const [paused, setPaused] = useState(false)
  // Top bar compacts to --bar-top-kb with keyboard up (spec §4.3 rule 3); the stack rides down with it, not leaving a gap.
  const keyboardOpen = useKeyboardOpen()
  // Same 900px line as the overlay-sidebar breakpoint — below it the tab strip sits flush under the title bar, where a top-pinned toast would land.
  const wide = useMedia('(min-width: 900px)')

  // Marks it leaving (so the exit plays), then drops it. Already-leaving items are left alone so a second dismiss can't restart the clock.
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
      // Count only what's still alive — a toast on its way out shouldn't push a live one off the stack.
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
        // Top-trailing at ≥900px; bottom-centre above the status bar below that
        // (see provider comment for why). Keyboard up trumps width either way.
        className={
          'pointer-events-none fixed inset-x-0 z-(--z-toast) flex flex-col gap-2 px-4 ' +
          (keyboardOpen || wide ? 'items-end' : 'items-center')
        }
        // The offset tracks a bar (ARCHITECTURE §4.2's exception): top mode tracks
        // --bar-title (not --bar-top) so a toast sits 8px under it, not on it, and
        // switches to --bar-top-kb with the keyboard up. Bottom mode tracks the
        // status bar plus the home-indicator safe area.
        style={
          keyboardOpen
            ? { top: 'calc(var(--bar-top-kb) + var(--sp-2))' }
            : wide
              ? { top: 'calc(var(--bar-title) + var(--sp-2))' }
              : { bottom: 'calc(var(--bar-status) + var(--sp-2) + env(safe-area-inset-bottom, 0px))' }
        }
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
 * Never colour alone — every kind carries a glyph too (spec §10), so they stay
 * distinguishable in greyscale. `data-kind` is the published state contract
 * (ARCHITECTURE §4) a stylesheet reads.
 */
const GLYPH: Record<ToastKind, string> = { info: 'i', success: '✓', error: '✕' }

const toast = cva(
  cx(
    // `toast` is a dead style hook now, kept only because screenshots/QA select `.toast`.
    // Real state contract: `role="status"` on the stack, `data-kind` on the row (ARCHITECTURE §4).
    'toast',
    'pointer-events-auto flex min-h-touch w-full max-w-[min(32rem,90vw)] items-center gap-2',
    'rounded-md border py-2 pe-1 ps-4 text-meta leading-normal shadow-raised',
    'animate-toast-in data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-toast-out',
    // A toast under a finger follows it with nothing in the way — no enter animation still fighting the inline transform.
    'data-[dragging=true]:animate-none',
  ),
  {
    variants: {
      kind: {
        info: 'border-border-subtle bg-surface-3 text-text-1',
        // Glyph carries the tone — a green frame over the tab strip was the loudest thing on
        // screen for "everything worked" (founder, 2026-08-05). Errors keep their frame; worth interrupting for.
        success: 'border-border-subtle bg-surface-3 text-text-1',
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

  // Keyed on the item, so a later toast can't restart this one's clock. Held while paused/dragged, abandoned once leaving.
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
    // dx is left where the finger let go, so the exit animation continues from there instead of snapping back first.
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
      <IconButton label={COPY.a11yDismiss} onClick={close} className="text-current">
        <IconClose size={16} />
      </IconButton>
    </div>
  )
}
