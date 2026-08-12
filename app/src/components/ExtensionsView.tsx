import { useState } from 'react'
import { EXTENSIONS, isExtEnabled, type ExtCategory, type ExtId } from '../extensions/registry'
import { COPY } from '../copy'

/**
 * The sidebar's Extensions view — VS Code's extensions pane, pared to what
 * Warsha ships: a grouped list of built-in editor features a student turns on
 * or off. Each row is one big switch (a 44px target on touch), its state a
 * per-device preference (extensions/registry.ts). Toggling an `editor`-kind
 * extension reconfigures the live editor via `onToggle`; the copy is read from
 * COPY by id so this file stays presentation-only.
 */

const HEADER = 'flex h-bar-side shrink-0 items-center gap-2 ps-3 pe-2 shadow-[inset_0_-1px_0_0_var(--border-subtle)]'
const PANEL_LABEL = 'panel-label text-[12px] leading-none font-semibold text-text-1'
const GROUP_LABEL = 'px-3 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-text-3'

// Full-width row that is itself the switch: big touch target, whole thing taps.
const ROW =
  'flex w-full items-start gap-3 px-3 py-2 text-start ' +
  'hover:bg-(--list-hover-bg) focus-visible:outline-offset-[-1px] cursor-pointer'

// The track+thumb. Accent fill when on, a neutral outlined pill when off.
const TRACK =
  'relative mt-0.5 h-[20px] w-[34px] flex-none rounded-full transition-colors duration-(--dur-fast) ' +
  'border border-(--border-subtle) bg-(--surface-4) ' +
  'group-aria-checked:border-(--accent) group-aria-checked:bg-(--accent)'
// The thumb FLIPS colour with state, not just position: --accent equals --text-1
// in this theme (both near-white), so a white thumb would vanish on the white
// "on" track — it goes dark (--surface-1) when on, light when off.
const THUMB =
  'absolute top-[3px] start-[3px] size-[14px] rounded-full bg-(--text-1) transition duration-(--dur-fast) ' +
  'group-aria-checked:translate-x-[14px] rtl:group-aria-checked:-translate-x-[14px] ' +
  'group-aria-checked:bg-(--surface-1)'

const CATEGORY_LABEL = (c: ExtCategory): string =>
  c === 'diagnostics'
    ? COPY.extCategoryLearning
    : c === 'appearance'
      ? COPY.extCategoryAppearance
      : COPY.extCategoryFormatting

/** name + description for an extension id — read from COPY during render so a
 *  language switch flows through (copy.ts's one rule). */
function meta(id: ExtId): { name: string; desc: string } {
  switch (id) {
    case 'beginner-helper':
      return { name: COPY.extBeginnerHelperName, desc: COPY.extBeginnerHelperDesc }
    case 'rainbow-brackets':
      return { name: COPY.extRainbowBracketsName, desc: COPY.extRainbowBracketsDesc }
    case 'indent-guides':
      return { name: COPY.extIndentGuidesName, desc: COPY.extIndentGuidesDesc }
    case 'indent-rainbow':
      return { name: COPY.extIndentRainbowName, desc: COPY.extIndentRainbowDesc }
    case 'format-on-save':
      return { name: COPY.extFormatOnSaveName, desc: COPY.extFormatOnSaveDesc }
  }
}

export interface ExtensionsViewProps {
  /** Persist the flip and apply it (App reconfigures the editor for `editor`-kind). */
  onToggle(id: ExtId, on: boolean): void
}

export function ExtensionsView({ onToggle }: ExtensionsViewProps) {
  // Seed from the store; keep a local mirror so the switch reacts instantly.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXTENSIONS.map((e) => [e.id, isExtEnabled(e.id)])),
  )

  const toggle = (id: ExtId) => {
    const on = !enabled[id]
    setEnabled((cur) => ({ ...cur, [id]: on }))
    onToggle(id, on)
  }

  // Preserve registration order within each category.
  const categories = EXTENSIONS.reduce<ExtCategory[]>((acc, e) => {
    if (!acc.includes(e.category)) acc.push(e.category)
    return acc
  }, [])

  return (
    <div className="flex h-full min-h-0 select-none flex-col bg-surface-2">
      <div className={HEADER}>
        <span className={PANEL_LABEL}>{COPY.extensionsTitle}</span>
      </div>

      <div className="scroller min-h-0 flex-1 pb-2">
        {categories.map((cat) => (
          <div key={cat}>
            <div className={GROUP_LABEL}>{CATEGORY_LABEL(cat)}</div>
            {EXTENSIONS.filter((e) => e.category === cat).map((e) => {
              const { name, desc } = meta(e.id)
              const on = enabled[e.id]
              return (
                <button
                  key={e.id}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={COPY.extEnableLabel(name)}
                  className={`group ${ROW}`}
                  onClick={() => toggle(e.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-row leading-tight font-medium text-text-1">{name}</span>
                    <span className="mt-0.5 block text-micro leading-snug text-text-3">{desc}</span>
                  </span>
                  <span className={TRACK} aria-hidden="true">
                    <span className={THUMB} />
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
