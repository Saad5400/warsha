import { type ReactNode } from 'react'
import { splitPath } from '../fs/project'
import { IconButton } from './ui/Button'
import { MenuBar, type MenuBarMenu } from './MenuBar'

/* The title bar. `top-bar` carries no styling — tools/qa reads it unscoped.
 *
 * ONE composition at every width and pointer (founder ruling): menu bar
 * leading (MenuBar collapses itself to the ☰ "Application Menu" below 1050px —
 * VS Code's own behaviour, which is also what covers phones), the centred
 * window title, and the view toggles trailing. Size is the only thing that
 * moves: --bar-title is 44px on any coarse-pointer layout and VS Code's 35px
 * on a fine-pointer desktop (DENSITY, index.css).
 *
 * Its divider is an inset shadow, never a border: with border-box a 1px border
 * comes out of the bar's own height, so a full-height control inside it
 * overflows by a pixel (that is how tabs once measured 43px).
 *
 * Spans BOTH grid columns at every width: VS Code's title bar runs over the
 * activity rail, which starts underneath it (ActivityBar pairs this with
 * row-start-2).
 *
 * The window title is no longer an absolute overlay — it truncates inside the
 * flex cell between the clusters (see IDENTITY / WINDOW_TITLE); `relative`
 * stays for anything that anchors against the bar. */
const BAR =
  'top-bar relative flex items-center gap-2 h-full min-w-0 bg-titlebar col-span-2 col-start-1 row-start-1 ' +
  'shadow-[inset_0_-1px_0_0_var(--titlebar-border)] ' +
  'pl-[max(var(--sp-1),env(safe-area-inset-left))] ' +
  'pr-[max(var(--sp-2),env(safe-area-inset-right))]'

/* The middle cell between the menu bar and the trailing cluster. The window
 * title lives INSIDE it now (founder overflow pass, 2026-08-05): the old
 * absolute overlay centred on the window but had no idea where the clusters
 * were, so on phones the title ran under the toggle cluster ("main.py —
 * Python basi[icon]"). As a min-w-0 flex-1 cell the title can only ever
 * occupy the real free space between the clusters — flexbox itself is the
 * clamp, and it truncates instead of clipping under anything. The cost is
 * honest and small: the title centres on the leftover space, not the window,
 * drifting a few px right of true centre beside the full menu bar. Kept as a
 * named span (`top-bar__identity`) because spacing.mjs reads it. */
const IDENTITY = 'top-bar__identity flex items-center justify-center gap-2 min-w-0 flex-1'

/* VS Code's window title: `● file — project — Warsha`, truncating with an
 * ellipsis when the cell runs out (overlap.mjs: always inside .top-bar bounds
 * beside both clusters — guaranteed by the flex cell, no measurement).
 * pointer-events-none because it is a label, not a control. kb-hide: while
 * the software keyboard compacts the bar (phones), the label is the one
 * passenger the 40px bar can spare. */
const WINDOW_TITLE =
  'top-bar__title kb-hide min-w-0 overflow-hidden text-ellipsis ' +
  'whitespace-nowrap text-[13px] leading-none text-(--titlebar-fg) pointer-events-none select-none'

/* The trailing toggles: icon-btn squares with 16px glyphs in the title bar's
 * own foreground. The bang: IconButton's base sets text-text-2 and utility
 * order between two colour classes is not guaranteed. (#CCCCCC == --text-1, so
 * the hover recolour is a no-op.) The kb class: below 900px the bar compacts
 * to 40px while the keyboard is up, and the buttons compact with it — see
 * --touch-kb for why that trade is acceptable for rarely-tapped chrome. */
const TOGGLE = 'text-titlebar-fg! max-[899px]:kb-open:size-touch-kb'

/* Glyphs for the two toggles, traced from VS Code's layout icons (a frame with
 * the sidebar / panel region marked off). Inline rather than in ui/Icons.tsx,
 * which another package owns this wave; stroke inherits currentColor. */
const IconLayoutSidebar = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" />
    <path d="M6 2.5v11" stroke="currentColor" />
  </svg>
)
const IconLayoutPanel = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" />
    <path d="M1.5 9.5h13" stroke="currentColor" />
  </svg>
)

export interface TopBarProps {
  /** The menu bar model (File/Edit/View/Run/Help). Built by App, which owns
   *  every action the rows call. */
  menus: MenuBarMenu[]
  /** The file being edited (full path); its basename leads the window title. */
  title?: string | null
  /** The open project's name — the window title's middle term. */
  projectName?: string
  /** The active file has unsaved changes — the ● prefix on the window title. */
  dirty?: boolean
  /** Trailing cluster: Toggle Primary Side Bar / Toggle Panel. Below 900px the
   *  sidebar toggle opens the overlay drawer — same control, same place. */
  onToggleSidebar?(): void
  onTogglePanel?(): void
  /**
   * "Install Warsha", when the browser has offered. A slot rather than a
   * boolean because the control renders itself away in most sessions (see
   * InstallControl) and this bar should not have to know the rule.
   *
   * It sits OUTSIDE the trailing cluster's fixed controls: the one control
   * that comes and goes is furthest from the ones that never move.
   */
  installSlot?: ReactNode
}

/**
 * The title bar — VS Code's, at every size: menu bar leading, centred
 * `● file — project — Warsha` window title, and the view toggles trailing.
 */
export function TopBar({ menus, title, projectName, dirty, onToggleSidebar, onTogglePanel, installSlot }: TopBarProps) {
  // `● file — project — Warsha`, dropping the parts that do not exist yet: an
  // empty project reads `My project — Warsha`, a fresh install just `Warsha`.
  const parts = [
    ...(title ? [`${dirty ? '● ' : ''}${splitPath(title).name}`] : []),
    ...(projectName ? [projectName] : []),
  ]

  return (
    <header className={BAR}>
      <MenuBar menus={menus} />

      <span className={IDENTITY}>
        <span className={WINDOW_TITLE}>
          {parts.length ? (
            <>
              {parts.join(' — ')}
              {/* VS Code drops whole segments before squeezing the file name;
                  our first drop is the app suffix — on narrow phones the
                  student's file matters, the brand does not. The one exception:
                  with nothing open the title IS `Warsha`, handled above. */}
              <span className="max-[479px]:hidden">{' — Warsha'}</span>
            </>
          ) : (
            'Warsha'
          )}
        </span>
      </span>

      <div className="ml-auto flex items-center gap-2 pl-2">
        {installSlot}
        <IconButton label="Toggle Primary Side Bar" className={TOGGLE} onClick={onToggleSidebar}>
          {IconLayoutSidebar}
        </IconButton>
        <IconButton label="Toggle Panel" className={TOGGLE} onClick={onTogglePanel}>
          {IconLayoutPanel}
        </IconButton>
      </div>
    </header>
  )
}
