import { type ReactNode } from 'react'
import { splitPath } from '../fs/project'
import { IconButton } from './ui/Button'
import { MenuBar, type MenuBarMenu } from './MenuBar'
import { COPY } from '../copy'

// `top-bar` carries no styling — tools/qa reads it unscoped. One composition at every
// width: menu bar leading, centred window title, toggles trailing; only --bar-title's
// height changes (44px touch, VS Code's 35px desk). Divider is an inset shadow, never a
// border (a border ate a pixel off the bar, which is how tabs once measured 43px). Spans
// both grid columns since VS Code's title bar runs over the activity rail (ActivityBar
// pairs this with row-start-2).
const BAR =
  'top-bar relative flex items-center gap-2 h-full min-w-0 bg-titlebar col-span-2 col-start-1 row-start-1 ' +
  'shadow-[inset_0_-1px_0_0_var(--titlebar-border)] ' +
  'pl-[max(var(--sp-1),env(safe-area-inset-left))] ' +
  'pr-[max(var(--sp-2),env(safe-area-inset-right))]'

// Window title lives inside this flex cell (not an absolute overlay anymore) so flexbox
// itself clamps it to the free space between clusters — it truncates instead of running
// under the toggles on a phone. Cost: it centres on the leftover space, not the window.
// Named `top-bar__identity` because spacing.mjs reads it.
const IDENTITY = 'top-bar__identity flex items-center justify-center gap-2 min-w-0 flex-1'

// `● file — project — Warsha`, truncating via the flex cell (overlap.mjs). kb-hide: the
// software keyboard's compacted 40px bar can spare this label first. leading-normal, never
// leading-none: a tight line box clips descenders too, slicing p/j tails off "My project".
const WINDOW_TITLE =
  'top-bar__title kb-hide min-w-0 overflow-hidden text-ellipsis ' +
  'whitespace-nowrap text-[13px] leading-normal text-(--titlebar-fg) pointer-events-none select-none'

// `!` needed: IconButton's base sets text-text-2 and utility class order isn't guaranteed.
// kb class compacts these with the 40px keyboard-open bar — acceptable since they're rarely tapped.
const TOGGLE = 'text-titlebar-fg! max-[899px]:kb-open:size-touch-kb'

// Traced from VS Code's layout icons. Inline rather than ui/Icons.tsx, which another package owns this wave.
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
  /** "Install Warsha" slot, not a boolean, so this bar never has to know InstallControl's
   *  own render-itself-away rule. Sits outside the fixed trailing cluster on purpose. */
  installSlot?: ReactNode
}

/**
 * The title bar — VS Code's, at every size: menu bar leading, centred
 * `● file — project — Warsha` window title, and the view toggles trailing.
 */
export function TopBar({ menus, title, projectName, dirty, onToggleSidebar, onTogglePanel, installSlot }: TopBarProps) {
  // Drops missing parts: empty project reads `My project — Warsha`, fresh install just `Warsha`.
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
              {/* First drop is the app suffix, not the file name — on a narrow phone the
                  student's file matters more than the brand. */}
              <span className="max-[479px]:hidden">{' — Warsha'}</span>
            </>
          ) : (
            'Warsha'
          )}
        </span>
      </span>

      <div className="ms-auto flex items-center gap-2 ps-2">
        {installSlot}
        <IconButton label={COPY.a11yToggleSidebar} className={TOGGLE} onClick={onToggleSidebar}>
          {IconLayoutSidebar}
        </IconButton>
        <IconButton label={COPY.a11yTogglePanel} className={TOGGLE} onClick={onTogglePanel}>
          {IconLayoutPanel}
        </IconButton>
      </div>
    </header>
  )
}
