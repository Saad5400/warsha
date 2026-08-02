import { useState, type ReactNode } from 'react'
import { IconButton } from './ui/Button'
import { IconMenu, IconMore } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

/* The title bar. `top-bar` carries no styling — tools/qa reads it unscoped.
 *
 * Its divider is an inset shadow, never a border: with border-box a 1px border
 * comes out of the bar's own height, so a 44px control inside it overflows by a
 * pixel (that is how tabs once measured 43px).
 *
 * Height is --bar-title: 44px on a phone, 52px at ≥900px. The extra 8px is not
 * decoration. This is the only bar that holds a FILLED control, and at 44px the
 * 44px Run button was flush top AND bottom — measured 0px clearance — so its
 * 10px radius ran into the divider and read as spilling out of its own bar.
 *
 * Leading padding is --sp-1 at ≥900px, and that 4px is not arbitrary: the first
 * thing in the bar is now the project button, which carries 8px of its own
 * padding, so 4+8 puts its LABEL on x=60 — the same grid line as the EXPLORER
 * label (pl-3) and the tree rows (12px) in the column directly below. The button
 * box then starts at 52, 4px clear of the rail, which is the inset VSCode gives
 * a sidebar hover fill. Below 900px the leading control is the hamburger, which
 * has no padding of its own and sits against a screen edge rather than a rail,
 * so it keeps --sp-3. */
const BAR =
  'top-bar flex items-center gap-2 h-full min-w-0 bg-surface-0 col-start-2 row-start-1 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] ' +
  'pl-[max(var(--sp-3),env(safe-area-inset-left))] ' +
  'min-[900px]:pl-[max(var(--sp-1),env(safe-area-inset-left))] ' +
  'pr-[max(var(--sp-2),env(safe-area-inset-right))]'

/* The identity run: project, file. It gets the slack, and the file title is what
 * gives way first — the project you are in matters more than which file is open,
 * so the project name truncates last.
 *
 * There is no logo and no "Warsha" wordmark here, by founder ruling
 * (LAYOUT-VSCODE §1b, 2026-08-02): VSCode puts no wordmark above the explorer,
 * so neither do we. The brand lives on the welcome panel, the favicon and the OG
 * image. */
const IDENTITY = 'top-bar__identity flex items-center gap-2 min-w-0 flex-1'

/* The bar's leading segment: as wide as the docked sidebar, and EMPTY. §1b took
 * the mark and the wordmark out of it, and the project name does not move in —
 * the sidebar's own project row is two rows below at the same x, and the same
 * name twice, 50px apart, reads as a bug rather than as two controls.
 *
 * It is not dead space. It is the sidebar's column, continued upward: the
 * divider after it lands exactly on the sidebar/editor boundary, so the file
 * title starts where the editor starts rather than floating over the file tree.
 * The arithmetic, written once so nobody has to re-derive it: this bar begins at
 * the activity rail's right edge, so --sp-1 (its padding) + this width + --sp-2
 * (the identity gap) = --explorer-w puts the 1px divider on the same x as the
 * sidebar's right edge and the tab strip's left edge.
 *
 * Rendered only while the explorer is actually docked. Collapse it and the
 * column goes too, because a divider marking a boundary that is no longer there
 * is worse than no divider — and the project switcher takes the space instead,
 * since with no sidebar the title bar is the only place left for it. */
const SIDEBAR_COLUMN =
  'flex-none min-[900px]:w-[calc(var(--explorer-w)-var(--sp-1)-var(--sp-2))]'

/* Spec §3.2 "top-bar title": the quiet line that says which file you are in. */
const TITLE =
  'top-bar__title min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ' +
  'text-tab font-medium leading-[1.2] tracking-[0.01em] text-text-3'

const SEP = 'top-bar__sep w-px h-4 flex-none bg-border-subtle'

export interface TopBarProps {
  /**
   * Opens the explorer drawer. Passed only below 900px — at ≥900px the activity
   * bar's Explorer icon is the toggle (VSCode has no hamburger), and rendering a
   * hidden one would leave a dead control in the DOM for anything counting
   * buttons.
   */
  onToggleExplorer?(): void
  menuItems: MenuItem[]
  /** The file being edited. Rendered as the quiet top-bar title (spec §3.2). */
  title?: string | null
  /**
   * The current project's name, as a control — pass the button, keep the menu
   * and its state in your own component.
   *
   * Pass it only when the sidebar is NOT on screen to carry it. Docked, the
   * sidebar's project row is the home of project actions (LAYOUT-VSCODE §2) and
   * a second copy of the same name in the bar directly above it is noise.
   */
  projectSlot?: ReactNode
  /**
   * The explorer is docked (≥900px, not collapsed). Reserves the bar's leading
   * segment at the sidebar's width — see SIDEBAR_COLUMN.
   */
  sidebarColumn?: boolean
  /**
   * Run/Stop in VSCode's play-button corner (LAYOUT-VSCODE §4), ≥900px only. The
   * console keeps its own copy of the control regardless — reach, not
   * redundancy, is why that one exists (spec §5.3).
   */
  runSlot?: ReactNode
}

/**
 * The title bar: project, file — and, on a desktop-width layout, Run.
 *
 * Chrome that is tapped rarely may live at the top (principle 4). Run is the one
 * exception, and only where reach is not the constraint: below 900px this bar
 * carries no Run at all and the console header is the only place it lives.
 */
export function TopBar({
  onToggleExplorer,
  menuItems,
  title,
  projectSlot,
  sidebarColumn,
  runSlot,
}: TopBarProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  /* Whatever occupies the bar's leading segment: the sidebar's empty column, or
   * the project switcher standing in for a sidebar that is not there. Either way
   * it is what the divider divides the file title FROM. */
  const lead = sidebarColumn || projectSlot

  return (
    <header className={BAR}>
      {/* Below 900px the bar and the controls in it compact together, or a 44px
          control lands on the tab strip. See --touch-kb for why that trade is
          acceptable for the two rarest taps in the app and nothing else. At
          ≥900px the bar does not compact, so neither do they. */}
      {onToggleExplorer ? (
        <IconButton label="Files" className="max-[899px]:kb-open:size-touch-kb" onClick={onToggleExplorer}>
          <IconMenu />
        </IconButton>
      ) : null}

      <span className={IDENTITY}>
        {sidebarColumn ? <span aria-hidden="true" className={SIDEBAR_COLUMN} /> : null}
        {projectSlot}
        {title ? (
          <>
            {/* The separator only ever sits BETWEEN two things. With the brand
                block gone there is nothing before the title below 900px, and an
                unconditional one left a hairline hanging off the hamburger. */}
            {lead ? <span aria-hidden="true" className={SEP + ' kb-hide'} /> : null}
            <span className={TITLE + ' kb-hide'}>{title}</span>
          </>
        ) : null}
      </span>

      <div className="ml-auto flex items-center gap-2 pl-2">
        {runSlot}
        <IconButton
          label="More"
          className="max-[899px]:kb-open:size-touch-kb"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setAnchor({ x: r.right, y: r.bottom + 4, fromRight: true })
          }}
        >
          <IconMore />
        </IconButton>
      </div>

      {anchor ? (
        <Menu anchor={anchor} items={menuItems} label="More actions" onClose={() => setAnchor(null)} />
      ) : null}
    </header>
  )
}
