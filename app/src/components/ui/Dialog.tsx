import * as RDialog from '@radix-ui/react-dialog'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button'
import { COPY } from '../../copy'

/**
 * Radix Dialog underneath, a real `<dialog>` element on top.
 *
 * Radix owns what the platform used to: the focus trap, Escape, the portal and
 * the outside-press decision. What it does NOT own is the element — `asChild`
 * renders the card as a `<dialog open>` rather than Radix's div, because two QA
 * suites select `dialog input`. It is a non-modal `<dialog>` now, so the
 * browser's top layer and `::backdrop` are gone: the overlay below draws the
 * same `--scrim`, and `--z-dialog` (index.css STACKING) puts the pair where the
 * top layer had them.
 *
 * Note `bg-(--scrim)` and not the bracket form. Tailwind v4 dropped that
 * shorthand; it compiles to an invalid declaration that is silently discarded,
 * and a transparent scrim over a live-looking IDE is exactly how this went
 * wrong before (index.css §"READ THIS FIRST").
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
  open = true,
  wide = false,
}: {
  children: ReactNode
  onCancel: () => void
  dismissible?: boolean
  labelledBy?: string
  /** Enter pressed with nothing focusable focused — used to bind Enter to the
   *  safe answer in a destructive dialog, which has no submitting form. */
  onEnterOutsideButton?: () => void
  /** A gallery-width card (the template picker) instead of the prompt's column.
   *  Still caps at the viewport, so a phone gets the same full-bleed dialog. */
  wide?: boolean
  /** Drive the exit animation. A caller that unmounts the Modal outright (the
   *  default, and what ImportZipDialog does) simply gets no exit — the element
   *  is gone before it could play. DialogHost holds the request one beat longer
   *  and flips this instead. */
  open?: boolean
}) {
  const cardRef = useRef<HTMLDialogElement>(null)
  // Whatever had focus before the dialog opened. Radix aims its own restore at
  // a trigger, and these dialogs have none — they are opened from a menu item
  // that is gone by the time the dialog closes.
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
          // Radix only sets aria-labelledby when a Dialog.Title is present, and
          // these dialogs bring their own <h2 id>. Nothing to undo.
          aria-labelledby={labelledBy}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // Children mount before this fires, so a dialog that placed its own
            // focus (the prompt's field, the confirm's safe button) has already
            // done it — leave that alone. One that did not gets Radix's
            // first-tabbable, which is what showModal used to give it.
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
          {/* `open` is what makes a <dialog> render at all; it is deliberately
              NOT showModal(), so Radix stays in charge of modality. The card
              centres itself the way the UA centres a modal one — pinned to all
              four edges with `m-auto` against a height that is not `auto` — and
              it must stay a DIRECT child of the portal: Radix wraps each portal
              child in its own Presence, so a wrapper of ours carrying no
              animation would be dropped the instant the dialog closes, taking
              the exit with it. */}
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

/* The card's own type and layout, as utilities.
 *
 * `.dlg-title`, `.dlg-msg`, `.dlg-input` and `.dlg-actions` still exist in
 * index.css, but only because ImportZipDialog, CapabilityScreens, CrashScreen
 * and Explorer's inline rename still write them by hand — call sites outside
 * this directory, which this refactor may not touch. These constants are the
 * same declarations as utilities. They are named and kept together so that when
 * those four call sites convert, deleting the recipe classes is one search, and
 * so a change to one side is visibly a change to only one side. */
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
  danger?: boolean
  resolve: (value: boolean) => void
}

/** A statement, not a question: one OK, no Cancel. A confirm pressed into this
 *  role grows a Cancel button that means nothing — the exact dead control the
 *  About dialog used to ship. Message is a node so a caller can lay out more
 *  than one line (About's name + version). */
export interface AlertRequest {
  kind: 'alert'
  title: string
  message?: ReactNode
  okLabel?: string
  resolve: () => void
}

export type DialogRequest = PromptRequest | ConfirmRequest | AlertRequest

/** Long enough for the 90ms exit plus a frame; short enough that a student
 *  pressing Create twice cannot get between the two. */
const EXIT_MS = 130

export function DialogHost({ request }: { request: DialogRequest | null }) {
  // The request is gone the instant it resolves, and an unmounted dialog cannot
  // animate out. So the last one is held here, closed, for the length of its
  // exit — Radix keeps the card mounted while `data-state="closed"` plays.
  const [shown, setShown] = useState<DialogRequest | null>(request)
  const exit = useRef(0)

  // Adjusted during render, not in an effect: an effect would first commit one
  // frame with nothing on screen, which unmounts the card and loses the very
  // animation this exists for.
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
    <Modal open={open} onCancel={() => request.resolve(null)} dismissible labelledBy={titleId}>
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
        <h2 id={titleId} className={TITLE}>
          {request.title}
        </h2>
        {request.label ? <p className="mb-2 text-meta leading-normal text-text-3">{request.label}</p> : null}
        <input
          ref={inputRef}
          // Spelled out even though it is the default: `.dlg-input` used to be
          // how tooling found this field, and `input[type="text"]` is what it
          // reaches for now that the styling is utilities.
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

  // A destructive action is never what a stray Enter or a reflex tap lands on:
  // Cancel takes the focus, so Enter cancels. Anything harmless focuses its own
  // confirm button, so Enter confirms.
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
          {COPY.dlgCancel}
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

function AlertDialog({ request, open }: { request: AlertRequest; open: boolean }) {
  const okRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // OK takes focus, so Enter and Escape both close — the only two things an
  // alert can do are the same thing.
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
