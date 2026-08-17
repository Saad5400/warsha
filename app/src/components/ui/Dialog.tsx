import * as RDialog from '@radix-ui/react-dialog'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { COPY } from '../../copy'

/**
 * Radix owns focus trap, Escape, portal and outside-press; `asChild` renders the
 * card as a real `<dialog open>` (not Radix's div) since QA selects `dialog input`.
 * Non-modal, so the native top layer/`::backdrop` are gone — the overlay below
 * draws `--scrim` manually. Use `bg-(--scrim)`, not the bracket form: Tailwind v4
 * silently drops that shorthand (index.css "READ THIS FIRST").
 * `dismissible` gates backdrop-tap-to-close: on for prompts/pickers, off for
 * anything destructive.
 */
export function Modal({
  children,
  onCancel,
  dismissible = false,
  labelledBy,
  onEnterOutsideButton,
  open = true,
  wide = false,
}: {
  children: ReactNode
  onCancel: () => void
  dismissible?: boolean
  labelledBy?: string
  /** Enter with nothing focused: binds Enter to the safe answer (destructive dialogs have no form to submit). */
  onEnterOutsideButton?: () => void
  /** Gallery-width (template picker) instead of the prompt's column; still caps at the viewport on phone. */
  wide?: boolean
  /** Drives the exit animation. A caller that just unmounts (ImportDialog) skips it entirely — DialogHost flips this instead of unmounting. */
  open?: boolean
}) {
  const cardRef = useRef<HTMLDialogElement>(null)
  // Focus before opening. Radix restores to a trigger, but these dialogs have none — opened from a menu item that's gone by close.
  const returnTo = useRef<Element | null>(null)
  useEffect(() => {
    returnTo.current = document.activeElement
    return () => {
      const el = returnTo.current
      if (el instanceof HTMLElement && el.isConnected) el.focus()
    }
  }, [])

  return (
    <RDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-(--z-dialog) bg-(--scrim) data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <RDialog.Content
          asChild
          // Radix only sets this when a Dialog.Title is present; these dialogs bring their own <h2 id>.
          aria-labelledby={labelledBy}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Children mount first, so a dialog that already focused itself (prompt field, confirm button) is left alone; otherwise Radix's first-tabbable wins, matching old showModal.
            const card = cardRef.current
            const active = document.activeElement
            if (card && active !== card && active instanceof HTMLElement && card.contains(active)) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (!dismissible) e.preventDefault()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnterOutsideButton && (e.target as HTMLElement).tagName !== 'BUTTON') {
              e.preventDefault()
              onEnterOutsideButton()
            }
          }}
        >
          {/* Deliberately `open`, not showModal() — keeps Radix in charge of modality; centered via
              m-auto against a non-auto height. Must stay a DIRECT child of the portal: Radix's
              per-child Presence means a wrapper here would drop before the exit animation plays. */}
          <dialog
            ref={cardRef}
            open
            className={
              'fixed inset-0 z-(--z-dialog) m-auto h-fit max-h-[calc(var(--app-h,100dvh)-var(--sp-6))] border-none bg-transparent p-0 data-[state=closed]:animate-dialog-out data-[state=open]:animate-dialog-in ' +
              (wide
                ? 'w-[min(44rem,calc(100vw-var(--sp-6)))]'
                : 'w-[min(26rem,calc(100vw-var(--sp-6)))]')
            }
          >
            <div className="scroller max-h-[calc(var(--app-h,100dvh)-var(--sp-6))] rounded-lg border border-border-subtle bg-surface-3 p-4 shadow-raised">
              {children}
            </div>
          </dialog>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

/* `.dlg-title` etc. still exist in index.css only for 4 call sites outside this
 * refactor's scope (ImportDialog, CapabilityScreens, CrashScreen, Explorer's
 * rename); these consts mirror them as utilities so those sites can convert later
 * with one search-and-delete. */
const TITLE = 'mb-2 text-dlg-title leading-[1.3] font-semibold text-text-1'
const MESSAGE = 'text-btn leading-normal text-text-2'
const ACTIONS = 'mt-4 flex justify-end gap-2'

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
  /** Overrides the default "Cancel" — for a non-destructive optional prompt where
   *  declining reads better as e.g. "Not now" than "Cancel". */
  cancelLabel?: string
  danger?: boolean
  resolve: (value: boolean) => void
}

/** A statement, not a question: one OK, no Cancel — a Confirm here grew a dead
 *  Cancel button (About's old bug). Message is a node so callers can lay out
 *  multiple lines (About's name + version). */
export interface AlertRequest {
  kind: 'alert'
  title: string
  message?: ReactNode
  okLabel?: string
  resolve: () => void
}

export type DialogRequest = PromptRequest | ConfirmRequest | AlertRequest

/** Long enough for the 90ms exit plus a frame; short enough a double-press of Create can't land between them. */
const EXIT_MS = 130

export function DialogHost({ request }: { request: DialogRequest | null }) {
  // Request is gone the instant it resolves, but an unmounted dialog can't animate out — so the last one is held here, closed, through its exit.
  const [shown, setShown] = useState<DialogRequest | null>(request)
  const exit = useRef(0)

  // Set during render, not an effect — an effect would commit one blank frame first, unmounting the card before it can animate.
  if (request && request !== shown) setShown(request)

  useEffect(() => {
    clearTimeout(exit.current)
    if (request || !shown) return
    exit.current = window.setTimeout(() => setShown(null), EXIT_MS)
    return () => clearTimeout(exit.current)
  }, [request, shown])

  if (!shown) return null
  const open = request !== null

  return shown.kind === 'prompt' ? (
    <PromptDialog key="prompt" request={shown} open={open} />
  ) : shown.kind === 'alert' ? (
    <AlertDialog key="alert" request={shown} open={open} />
  ) : (
    <ConfirmDialog key="confirm" request={shown} open={open} />
  )
}

function PromptDialog({ request, open }: { request: PromptRequest; open: boolean }) {
  const [value, setValue] = useState(request.value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const problemId = useId()

  const [attempted, setAttempted] = useState(false)

  const trimmed = value.trim()
  // Validated here, not after close: retyping a name from memory because a toast rejected it is worse than inline red text.
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
    <Modal open={open} onCancel={() => request.resolve(null)} dismissible labelledBy={titleId}>
      <form
        // Create stays enabled always: a disabled primary also blocks Enter (HTML skips implicit
        // submission), which used to make an empty field feel dead. Now submit just reports what's missing.
        onSubmit={(e) => {
          e.preventDefault()
          setAttempted(true)
          if (canSubmit) request.resolve(trimmed)
        }}
      >
        <h2 id={titleId} className={TITLE}>
          {request.title}
        </h2>
        {request.label ? <p className="mb-2 text-meta leading-normal text-text-3">{request.label}</p> : null}
        <input
          ref={inputRef}
          // Spelled out though it's the default — tooling used to find this via `.dlg-input`; now it selects `input[type="text"]`.
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={request.placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? problemId : undefined}
          className="min-h-touch w-full rounded-sm border border-border-control bg-surface-4 px-3 font-code text-input text-text-1 aria-[invalid=true]:border-danger"
        />
        {problem ? (
          <p id={problemId} className="mt-2 flex items-start gap-2 text-meta leading-normal text-danger">
            <span aria-hidden="true" className="flex-none leading-normal">
              ✕
            </span>
            {problem}
          </p>
        ) : null}
        <div className={ACTIONS}>
          <Button variant="ghost" large onClick={() => request.resolve(null)}>
            {COPY.dlgCancel}
          </Button>
          <Button variant="primary" large type="submit">
            {request.okLabel ?? COPY.dlgOk}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function ConfirmDialog({ request, open }: { request: ConfirmRequest; open: boolean }) {
  const okRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const danger = !!request.danger

  // Destructive: Cancel takes focus so a stray Enter cancels, not confirms. Harmless: the confirm button takes focus instead.
  useEffect(() => {
    ;(danger ? cancelRef : okRef).current?.focus()
  }, [danger])

  const body = (
    <>
      <h2 id={titleId} className={TITLE}>
        {request.title}
      </h2>
      {request.message ? <p className={MESSAGE}>{request.message}</p> : null}
      <div className={ACTIONS}>
        <Button ref={cancelRef} variant="ghost" large onClick={() => request.resolve(false)}>
          {request.cancelLabel ?? COPY.dlgCancel}
        </Button>
        <Button
          ref={okRef}
          variant={danger ? 'danger' : 'primary'}
          large
          type={danger ? 'button' : 'submit'}
          onClick={() => request.resolve(true)}
        >
          {request.okLabel ?? COPY.dlgOk}
        </Button>
      </div>
    </>
  )

  return (
    <Modal
      open={open}
      onCancel={() => request.resolve(false)}
      dismissible={!danger}
      labelledBy={titleId}
      // Enter binds to the safe answer, never the destructive one — same rule as a macOS alert.
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

function AlertDialog({ request, open }: { request: AlertRequest; open: boolean }) {
  const okRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // OK takes focus, so Enter and Escape both close — an alert only does one thing anyway.
  useEffect(() => {
    okRef.current?.focus()
  }, [])

  return (
    <Modal open={open} onCancel={request.resolve} dismissible labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          request.resolve()
        }}
      >
        <h2 id={titleId} className={TITLE}>
          {request.title}
        </h2>
        {request.message ? <div className={MESSAGE}>{request.message}</div> : null}
        <div className={ACTIONS}>
          <Button ref={okRef} variant="primary" large type="submit">
            {request.okLabel ?? COPY.dlgOk}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
