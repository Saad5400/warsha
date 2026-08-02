import { useState, type ReactNode } from 'react'
import { Logo } from './Logo'
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
 * Leading padding is --sp-3, matching the sidebar header's, so the logo mark and
 * the EXPLORER label below it start on the same vertical grid line. It was
 * --sp-1 (from the old `safe-x`), which left them 8px out of step. */
const BAR =
  'top-bar flex items-center gap-2 h-full min-w-0 bg-surface-0 col-start-2 row-start-1 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] ' +
  'pl-[max(var(--sp-3),env(safe-area-inset-left))] pr-[max(var(--sp-2),env(safe-area-inset-right))]'

/* The identity run: logo, wordmark, project, file. It gets the slack, and the
 * file title is what gives way first — the project you are in matters more than
 * which file is open, so the project name truncates last. */
const IDENTITY = 'top-bar__identity flex items-center gap-2 min-w-0 flex-1'

/* The brand zone, sized so the divider after it lands exactly on the
 * sidebar/editor boundary at ≥900px. The arithmetic, written once so nobody has
 * to re-derive it: this bar starts at the activity rail's right edge, so
 * --sp-3 (its padding) + this width + --sp-2 (the identity gap) = --explorer-w
 * puts the 1px divider on the same x as the sidebar's right edge and the tab
 * strip's left edge. Below 900px the sidebar is a drawer, there is no boundary
 * to meet, and the zone just shrink-wraps. */
const BRAND_ZONE =
  'flex items-center gap-2 min-w-0 min-[900px]:w-[calc(var(--explorer-w)-var(--sp-3)-var(--sp-2))]'

/* Spec §11: the wordmark is only ever the UI font at 600. */
const WORDMARK = 'top-bar__wordmark text-btn font-semibold leading-[1.2] tracking-[-0.01em] text-text-1'

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
   * The current project's name, as a control. Rendered between the wordmark and
   * the file title — pass the button, keep the menu and its state in your own
   * component.
   */
  projectSlot?: ReactNode
  /**
   * Run/Stop in VSCode's play-button corner (LAYOUT-VSCODE §4), ≥900px only. The
   * console keeps its own copy of the control regardless — reach, not
   * redundancy, is why that one exists (spec §5.3).
   */
  runSlot?: ReactNode
}

/**
 * The title bar: logo, project, file — and, on a desktop-width layout, Run.
 *
 * Chrome that is tapped rarely may live at the top (principle 4). Run is the one
 * exception, and only where reach is not the constraint: below 900px this bar
 * carries no Run at all and the console header is the only place it lives.
 */
export function TopBar({ onToggleExplorer, menuItems, title, projectSlot, runSlot }: TopBarProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

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
        <span className={BRAND_ZONE}>
          <Logo size={22} />
          <span className={WORDMARK + ' kb-hide'}>Warsha</span>
        </span>
        {projectSlot ? (
          <>
            <span aria-hidden="true" className={SEP} />
            {projectSlot}
          </>
        ) : null}
        {title ? (
          <>
            <span aria-hidden="true" className={SEP + ' kb-hide'} />
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
