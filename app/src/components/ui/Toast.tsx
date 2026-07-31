import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastKind = 'info' | 'error'
interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((cur) => [...cur, { id, message, kind }])
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3200)
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
        style={{ paddingBottom: 'calc(var(--kb-inset, 0px) + var(--sp-5))' }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            data-kind={t.kind}
            className={
              'max-w-[min(32rem,90vw)] rounded-md border px-4 py-2 text-meta shadow-raised ' +
              (t.kind === 'error'
                ? 'border-danger bg-danger-soft text-danger'
                : 'border-border-subtle bg-surface-3 text-text-1')
            }
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
