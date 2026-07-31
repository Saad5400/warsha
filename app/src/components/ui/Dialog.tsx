import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'

/**
 * Native <dialog> so focus trapping, Escape and the backdrop come from the
 * platform rather than from us. Centred, raised, and never wider than a 390px
 * phone minus its gutters.
 *
 * `dismissible` decides whether a tap on the backdrop closes it: true for a
 * prompt or a picker, false for anything destructive, where a stray tap outside
 * must not mean the same thing as "no".
 */
export function Modal({
  children,
  onCancel,
  dismissible = false,
  labelledBy,
  onEnterOutsideButton,
}: {
  children: ReactNode
  onCancel: () => void
  dismissible?: boolean
  labelledBy?: string
  /** Enter pressed with nothing focusable focused — used to bind Enter to the
   *  safe answer in a destructive dialog, which has no submitting form. */
  onEnterOutsideButton?: () => void
}) {
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
      aria-labelledby={labelledBy}
      // The card fills the element, so a hit on the <dialog> itself can only be
      // a hit on the backdrop. When the dialog is not dismissible, swallow the
      // press: otherwise it moves focus off the buttons onto the dialog and the
      // student is left with a keyboard that does nothing.
      onPointerDown={(e) => {
        if (e.target !== ref.current) return
        if (dismissible) onCancel()
        else e.preventDefault()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnterOutsideButton && (e.target as HTMLElement).tagName !== 'BUTTON') {
          e.preventDefault()
          onEnterOutsideButton()
        }
      }}
      // `.dlg-host` (index.css) is the positioner — centring, the 26rem/100vw-32
      // width, the height cap — and `dialog::backdrop` there owns the scrim. It
      // replaces a `backdrop:bg-[ --scrim ]` utility (brackets spaced on purpose:
      // written tight, Tailwind scans this comment and emits the dead class
      // again), which v4 compiles to an invalid declaration and drops, leaving a
      // modal with nothing dimming the IDE behind it.
      className="dlg-host"
    >
      <div className="dlg scroller max-h-[calc(var(--app-h,100dvh)-var(--sp-6))]">{children}</div>
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
  /** Returns a student-facing problem, or null when the value is usable. */
  validate?: (value: string) => string | null
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
  const titleId = useId()
  const problemId = useId()

  const [attempted, setAttempted] = useState(false)

  const trimmed = value.trim()
  // Checked here rather than after the dialog closes: a name the student has to
  // retype from memory because a toast rejected it is a worse experience than a
  // line of red under the field they are already looking at.
  const problem =
    (trimmed ? (request.validate?.(trimmed) ?? null) : null) ??
    (attempted && !trimmed ? 'Give it a name first — Main.java and main.py both work.' : null)
  const canSubmit = trimmed.length > 0 && !problem

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const dot = el.value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
  }, [])

  return (
    <Modal onCancel={() => request.resolve(null)} dismissible labelledBy={titleId}>
      <form
        // Create stays ENABLED at all times and answers every press. A disabled
        // primary swallows both the click and the Enter key (HTML skips implicit
        // submission when the default button is disabled), so an empty field used
        // to make the dialog feel dead — press Enter, nothing happens, no reason
        // given. Now an empty submit says what is missing instead.
        onSubmit={(e) => {
          e.preventDefault()
          setAttempted(true)
          if (canSubmit) request.resolve(trimmed)
        }}
      >
        <h2 id={titleId} className="dlg-title">
          {request.title}
        </h2>
        {request.label ? <p className="dlg-label">{request.label}</p> : null}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={request.placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          className="dlg-input"
        />
        {problem ? (
          <p id={problemId} className="dlg-error">
            <span aria-hidden="true" className="dlg-error__glyph">
              ✕
            </span>
            {problem}
          </p>
        ) : null}
        <div className="dlg-actions">
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
  const okRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const danger = !!request.danger

  // A destructive action is never what a stray Enter or a reflex tap lands on:
  // Cancel takes the focus, so Enter cancels. Anything harmless focuses its own
  // confirm button, so Enter confirms.
  useEffect(() => {
    ;(danger ? cancelRef : okRef).current?.focus()
  }, [danger])

  const body = (
    <>
      <h2 id={titleId} className="dlg-title">
        {request.title}
      </h2>
      {request.message ? <p className="dlg-msg">{request.message}</p> : null}
      <div className="dlg-actions">
        <Button ref={cancelRef} variant="ghost" large onClick={() => request.resolve(false)}>
          Cancel
        </Button>
        <Button
          ref={okRef}
          variant={danger ? 'danger' : 'primary'}
          large
          type={danger ? 'button' : 'submit'}
          onClick={() => request.resolve(true)}
        >
          {request.okLabel ?? 'OK'}
        </Button>
      </div>
    </>
  )

  return (
    <Modal
      onCancel={() => request.resolve(false)}
      dismissible={!danger}
      labelledBy={titleId}
      // Enter is bound to the safe answer in a destructive dialog, never to the
      // destructive one — the same rule as a macOS alert.
      onEnterOutsideButton={danger ? () => request.resolve(false) : undefined}
    >
      {danger ? (
        body
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            request.resolve(true)
          }}
        >
          {body}
        </form>
      )}
    </Modal>
  )
}
