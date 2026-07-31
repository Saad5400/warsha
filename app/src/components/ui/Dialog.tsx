import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'

/**
 * Native <dialog> so focus trapping, Escape and the backdrop come from the
 * platform rather than from us.
 */
function Modal({ children, onCancel }: { children: ReactNode; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) dlg.showModal()
    const onNativeCancel = (e: Event) => {
      e.preventDefault()
      onCancel()
    }
    dlg.addEventListener('cancel', onNativeCancel)
    return () => dlg.removeEventListener('cancel', onNativeCancel)
  }, [onCancel])

  return (
    <dialog
      ref={ref}
      className="m-auto w-[min(26rem,calc(100vw-var(--sp-6)))] bg-transparent p-0 backdrop:bg-[--scrim]"
    >
      <div className="rounded-lg border border-border-subtle bg-surface-3 p-4 shadow-raised">{children}</div>
    </dialog>
  )
}

export interface PromptRequest {
  kind: 'prompt'
  title: string
  label?: string
  value?: string
  placeholder?: string
  okLabel?: string
  resolve: (value: string | null) => void
}

export interface ConfirmRequest {
  kind: 'confirm'
  title: string
  message?: string
  okLabel?: string
  danger?: boolean
  resolve: (value: boolean) => void
}

export type DialogRequest = PromptRequest | ConfirmRequest

export function DialogHost({ request }: { request: DialogRequest | null }) {
  if (!request) return null
  return request.kind === 'prompt' ? (
    <PromptDialog key="prompt" request={request} />
  ) : (
    <ConfirmDialog key="confirm" request={request} />
  )
}

function PromptDialog({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const dot = el.value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
  }, [])

  return (
    <Modal onCancel={() => request.resolve(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          request.resolve(trimmed ? trimmed : null)
        }}
      >
        <h2 className="mb-2 text-dlg-title font-semibold text-text-1">{request.title}</h2>
        {request.label ? <p className="mb-2 text-meta text-text-3">{request.label}</p> : null}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={request.placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-touch w-full rounded-sm border border-border-control bg-surface-4 px-3 font-code text-input text-text-1 focus:border-accent focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" large onClick={() => request.resolve(null)}>
            Cancel
          </Button>
          <Button variant="primary" large type="submit">
            {request.okLabel ?? 'OK'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  return (
    <Modal onCancel={() => request.resolve(false)}>
      <h2 className="mb-2 text-dlg-title font-semibold text-text-1">{request.title}</h2>
      {request.message ? <p className="text-meta leading-normal text-text-2">{request.message}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" large onClick={() => request.resolve(false)}>
          Cancel
        </Button>
        <Button variant={request.danger ? 'danger' : 'primary'} large onClick={() => request.resolve(true)}>
          {request.okLabel ?? 'OK'}
        </Button>
      </div>
    </Modal>
  )
}
