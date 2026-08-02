import type { SVGProps } from 'react'
import { IconFiles } from './ui/Icons'

/* The rail itself. Same fill as the title bar it sits under, so the two read as
 * one piece of frame around the work area, and the same inset-shadow divider
 * every other bar in the app uses (a real border would come out of its 48px).
 *
 * NO top padding, deliberately. It used to have 4px, which started the first
 * button at y=4 and left its 2px accent rule floating with bare surface above
 * it at x=0 — the founder read that, correctly, as a stray amber sliver on the
 * app's edge. VSCode's rail starts its first item flush with the top. */
const RAIL =
  'flex flex-col items-center flex-none w-activity bg-surface-0 ' +
  'shadow-[inset_-1px_0_0_0_var(--border-subtle)] pl-[env(safe-area-inset-left)] ' +
  'col-start-1 row-start-1 row-span-2'

/* 48px square — the column's own width, comfortably past the 44px floor.
 *
 * ONE treatment for "this section is showing": a 2px accent rule on the leading
 * edge plus brighter ink. No fill. The fill used to be surface-2, which painted
 * a rectangle behind the active icon and only the active icon — so the three
 * slots looked like different components rather than one rail (founder,
 * 2026-08-02). Rule + ink is still two signals, so principle 2 holds without it.
 *
 * The leading edge reserves its 2px at all times so the glyph does not shift
 * when a section becomes active — the same trick `tree-row` uses. */
const SLOT =
  'grid place-items-center flex-none size-activity text-text-3 cursor-pointer touch-manipulation ' +
  // `length:` is load-bearing, and this is the third way this one rule has
  // silently compiled to nothing (ARCHITECTURE §4.1). `border-l-rail` resolves
  // against the COLOUR namespace, because v4 has no border-width theme
  // namespace — and so does a bare `border-l-[var(--rail)]`, since an arbitrary
  // value of unknown type on `border-l-` is read as a colour. Both emit
  // `border-left-color` and leave the width at 0, which measures as
  // `border: 0px solid rgb(242,169,75)`: the active section's accent rule is
  // there in the cascade and 0px wide on screen. The type hint is the only form
  // that survives. Everywhere else in the app the rule is a literal
  // (`border-l-[3px]`), which is unambiguous and needs no hint.
  'border-l-[length:var(--rail)] border-l-transparent transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:not-disabled:text-text-1 hover:not-disabled:bg-surface-2 active:not-disabled:bg-surface-3 ' +
  'data-[state=active]:border-l-accent data-[state=active]:text-text-1 ' +
  // Disabled is a colour change, never opacity — opacity destroys measured
  // contrast, and these two slots are on screen permanently.
  'disabled:text-text-disabled disabled:cursor-default ' +
  // The ring goes inside the box: the column is exactly as wide as the button,
  // so any outset ring would be clipped by the rail's own edge. -1px matches
  // the app-wide 1px ring width (founder ruling 2026-08-02: 1px/0 default,
  // was 2px/2px) so it sits flush against the inside with zero overflow.
  'focus-visible:outline-offset-[-1px]'

export interface ActivityBarProps {
  explorerOpen: boolean
  onToggleExplorer(): void
}

/**
 * VSCode's far-left icon column (LAYOUT-VSCODE §1), ≥900px only — below that the
 * drawer pattern already covers it and 48px of permanent chrome is a fifth of a
 * 390px screen.
 *
 * Only the Explorer toggle does anything today. Search and Settings are drawn as
 * disabled slots rather than left out, because the point of this bar is
 * familiarity: a student who has watched a tutorial expects the column to be
 * there and expects it to have more than one thing in it. A slot that says "not
 * built yet" is honest; an empty rail is just odd.
 *
 * The column is 48px per the plan, and every hit area is the full 48×48 — past
 * the 44px floor rather than under it (spec §5.2).
 */
export function ActivityBar({ explorerOpen, onToggleExplorer }: ActivityBarProps) {
  return (
    <nav className={RAIL} aria-label="Activity bar">
      <button
        type="button"
        className={SLOT}
        aria-label="Explorer"
        title="Explorer"
        aria-pressed={explorerOpen}
        data-state={explorerOpen ? 'active' : 'inactive'}
        onClick={onToggleExplorer}
      >
        <IconFiles size={22} />
      </button>

      {/* Disabled, not hidden. `title` still reads on a disabled button in every
          browser we target, and the label says when it will be true. */}
      <button
        type="button"
        className={SLOT}
        aria-label="Search"
        title="Search — not built yet"
        disabled
        data-state="inactive"
      >
        <IconSearch size={22} />
      </button>
      <button
        type="button"
        className={SLOT}
        aria-label="Settings"
        title="Settings — not built yet"
        disabled
        data-state="inactive"
      >
        <IconGear size={22} />
      </button>
    </nav>
  )
}

/* Same 20px grid and 1.6px stroke as ui/Icons.tsx; they belong there and will
   move the moment that file gains a magnifier and a gear. (RunBar.tsx keeps its
   clipboard and check locally for the same reason.) */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

const IconSearch = ({ size = 20, ...p }: IconProps) => (
  <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
    <circle cx="8.75" cy="8.75" r="5" />
    <path d="M12.5 12.5 17 17" />
  </svg>
)

/* A rim, a hub, and eight teeth that CROSS the rim.
   The rim is the whole trick: eight strokes radiating from a bare circle read as
   a sun at 22px no matter how short they are (two drafts of this proved it).
   Teeth that start inside the rim and stick out past it read as a gear. */
const IconGear = ({ size = 20, ...p }: IconProps) => (
  <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...p}>
    <circle cx="10" cy="10" r="6.2" />
    <circle cx="10" cy="10" r="2.4" />
    <path d="M10 4.6V2.4M10 15.4v2.2M15.4 10h2.2M4.6 10H2.4M13.82 6.18l1.55-1.55M6.18 13.82l-1.55 1.55M13.82 13.82l1.55 1.55M6.18 6.18 4.63 4.63" />
  </svg>
)
