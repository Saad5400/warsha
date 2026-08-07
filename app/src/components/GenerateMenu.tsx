import { useId, useRef, useState } from 'react'
import { COPY } from '../copy'
import {
  eligibleFields,
  generate,
  needsFieldPicker,
  type GenAnalysis,
  type GenerateKind,
  type GenField,
} from '../actions/generate'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'
import { IconCheck } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

/**
 * The "Generate…" surface (Alt+Insert): a JetBrains-style popup of things to
 * generate from the class the cursor sits in, opened at the caret. Picking a
 * generator either produces code straight away, or — when the class has more
 * than one eligible field — raises a checkbox field picker first (the signature
 * interaction; all fields checked by default).
 *
 * All the parsing/generation lives in actions/generate.ts. This component only
 * drives the two UI phases and hands the result back to App via callbacks, so
 * the edit lands as one undo step through the editor controller. It never holds
 * the source itself.
 */
export interface GenerateMenuProps {
  anchor: MenuAnchor
  analysis: GenAnalysis
  /** New whole-file source to apply (one edit). */
  onApply(source: string): void
  /** Everything the chosen generator would write already exists. */
  onExists(): void
  /** Generation threw (a parser/formatter failure, not a user condition). */
  onError(): void
  onClose(): void
}

/** Kind → menu label. A function indexing on call, never a module constant —
 *  every COPY read must happen during render (see copy.ts). */
const kindLabel = (kind: GenerateKind): string =>
  ({
    constructor: COPY.genConstructor,
    getter: COPY.genGetter,
    setter: COPY.genSetter,
    getterSetter: COPY.genGetterSetter,
    toString: COPY.genToString,
    equalsHashCode: COPY.genEqualsHashCode,
    pyRepr: COPY.genPyRepr,
    pyEq: COPY.genPyEq,
    csConstructor: COPY.genCsConstructor,
    csProperties: COPY.genCsProperties,
  })[kind]

export function GenerateMenu({ anchor, analysis, onApply, onExists, onError, onClose }: GenerateMenuProps) {
  // Two phases: the kind menu, then (optionally) the field picker for one kind.
  const [picking, setPicking] = useState<GenerateKind | null>(null)
  // Set the instant a picker-kind is chosen so the menu's own close (which fires
  // right after onSelect) doesn't tear the whole surface down before the Modal shows.
  const toPicker = useRef(false)

  const run = async (kind: GenerateKind, fieldNames: string[]) => {
    try {
      const result = await generate(analysis, kind, fieldNames)
      if (result.status === 'ok') onApply(result.source)
      else onExists()
    } catch {
      onError()
    }
  }

  const pick = (kind: GenerateKind) => {
    if (needsFieldPicker(analysis, kind)) {
      toPicker.current = true
      setPicking(kind)
    } else {
      // No real choice to make — generate over whatever fields apply. The menu
      // closes itself and App unmounts us; the toast fires when `run` resolves.
      void run(
        kind,
        eligibleFields(analysis, kind).map((f) => f.name),
      )
    }
  }

  if (picking) {
    return (
      <FieldPicker
        kind={picking}
        className={analysis.className}
        fields={eligibleFields(analysis, picking)}
        onGenerate={(names) => {
          onClose()
          void run(picking, names)
        }}
        onCancel={onClose}
      />
    )
  }

  const items: MenuItem[] = analysis.options.map((o) => ({
    id: o.kind,
    label: kindLabel(o.kind),
    disabled: !o.available,
    onSelect: () => pick(o.kind),
  }))

  return (
    <Menu
      anchor={anchor}
      items={items}
      label={COPY.genMenuLabel}
      plain
      onClose={() => {
        // Swallow the close that follows selecting a picker-kind — the Modal is
        // taking over; a genuine dismiss (Escape/outside) still closes.
        if (toPicker.current) {
          toPicker.current = false
          return
        }
        onClose()
      }}
    />
  )
}

/* ----------------------------------------------- the checkbox field picker */

function FieldPicker({
  kind,
  className,
  fields,
  onGenerate,
  onCancel,
}: {
  kind: GenerateKind
  className: string
  fields: GenField[]
  onGenerate(fieldNames: string[]): void
  onCancel(): void
}) {
  const titleId = useId()
  const [checked, setChecked] = useState<Set<string>>(() => new Set(fields.map((f) => f.name)))
  const allOn = checked.size === fields.length

  const toggle = (name: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const toggleAll = () => setChecked(allOn ? new Set() : new Set(fields.map((f) => f.name)))

  const canGenerate = checked.size > 0

  return (
    <Modal onCancel={onCancel} dismissible labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canGenerate) onGenerate([...checked])
        }}
      >
        <h2 id={titleId} className="text-dlg-title leading-[1.3] font-semibold text-text-1">
          {COPY.genFieldsTitle}
        </h2>
        <p className="mb-3 text-meta leading-normal text-text-3">
          {kindLabel(kind)} · {COPY.genFieldsIntro(className)}
        </p>

        {/* Select-all, then the fields — one flat list so a thumb runs straight down it. */}
        <div className="flex flex-col">
          <CheckRow label={COPY.genSelectAll} checked={allOn} onToggle={toggleAll} muted />
          <div className="my-1 border-t border-border-subtle" />
          {fields.map((f) => (
            <CheckRow
              key={f.name}
              label={f.name}
              detail={f.type}
              checked={checked.has(f.name)}
              onToggle={() => toggle(f.name)}
            />
          ))}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" large type="button" onClick={onCancel}>
            {COPY.dlgCancel}
          </Button>
          <Button variant="primary" large type="submit" disabled={!canGenerate}>
            {COPY.genGenerate}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * One full-width checkbox row — the row itself is the 44px-effective tap target
 * (min-h-touch on coarse pointers, VS Code-compact on fine). A native checkbox
 * carries the state and focus; the visible box mirrors it. Logical props and
 * `text-start` keep it mirrored for Arabic.
 */
function CheckRow({
  label,
  detail,
  checked,
  onToggle,
  muted,
}: {
  label: string
  detail?: string
  checked: boolean
  onToggle(): void
  muted?: boolean
}) {
  return (
    <label className="group/f flex min-h-touch w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 text-start text-row desk:min-h-[26px] desk:text-[13px] hover:bg-surface-4 has-[:focus-visible]:bg-surface-4">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={onToggle} />
      <span
        aria-hidden="true"
        className="grid size-[18px] flex-none place-items-center rounded-[3px] border border-border-control text-transparent transition-colors duration-(--dur-fast) ease-standard peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:border-accent"
      >
        <IconCheck size={13} />
      </span>
      <span className={'min-w-0 flex-1 truncate font-code ' + (muted ? 'text-text-2' : 'text-text-1')}>{label}</span>
      {detail ? <span className="flex-none font-code text-micro text-text-3">{detail}</span> : null}
    </label>
  )
}
