import { useState } from 'react'
import { IconChevronDown, IconFolderOpen } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

/* VSCode's folder row under the EXPLORER label. It is the home of every
 * project action, so it reads as a control: full width, 44px, its own hover
 * and press. */
const SIDEBAR =
  'flex items-center gap-2 w-full min-w-0 min-h-touch px-2 rounded-sm bg-transparent font-ui text-row ' +
  'font-semibold leading-[1.2] text-text-1 cursor-pointer touch-manipulation transition-[background-color] ' +
  'duration-(--dur-fast) ease-standard hover:bg-surface-3 active:bg-surface-4 aria-expanded:bg-surface-4'

/* The title-bar twin — the only project affordance on a phone with the drawer
 * shut. It shrinks to a 4ch floor so it survives while the file title
 * ellipsises away beside it, and it compacts with the bar when the keyboard is
 * up (a 44px control in a 40px bar spills onto the tab strip; see --touch-kb). */
const TITLE =
  'inline-flex items-center gap-1 flex-initial min-w-[4ch] max-w-[40vw] min-h-touch px-2 rounded-sm ' +
  'bg-transparent font-ui text-tab font-semibold leading-[1.2] tracking-[0.01em] text-text-2 ' +
  'cursor-pointer touch-manipulation transition-[background-color,color] duration-(--dur-fast) ease-standard ' +
  'hover:bg-surface-3 hover:text-text-1 active:bg-surface-4 active:text-text-1 ' +
  'aria-expanded:bg-surface-4 aria-expanded:text-text-1 kb-open:min-h-touch-kb'

export interface ProjectSwitcherProps {
  /** The open project's name. Falsy only before the first load resolves. */
  name: string
  /** Switch rows first, then the project actions. Built once by App. */
  items: MenuItem[]
  /**
   * `sidebar` is VSCode's folder row under the EXPLORER label and is the home of
   * project actions (LAYOUT-VSCODE §2). `title` is the smaller twin in the title
   * bar, which is the only project affordance on a phone with the drawer shut.
   */
  variant: 'sidebar' | 'title'
}

/**
 * The project row: current project name + chevron, opening the project menu
 * (switch / new / new-from-template / rename / export / empty / delete).
 *
 * It owns its own anchor state so both placements can exist at once without App
 * tracking which one is open — they are the same menu either way, and the one
 * you did not tap is behind a full-screen dismiss layer while it is up.
 */
export function ProjectSwitcher({ name, items, variant }: ProjectSwitcherProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const label = name || 'Project'

  return (
    <>
      <button
        type="button"
        className={variant === 'sidebar' ? SIDEBAR : TITLE}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        // Named rather than left to its text content: two of these are on screen
        // at ≥900px, and "Project: Homework" says which control this is where the
        // bare name does not.
        aria-label={`Project: ${label}`}
        title={`${label} — switch or manage projects`}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          // Aligned to the leading edge of the control in both placements, so the
          // menu reads as belonging to the row it dropped out of.
          setAnchor({ x: r.left, y: r.bottom + 4 })
        }}
      >
        {variant === 'sidebar' ? (
          <span aria-hidden="true" className="grid place-items-center flex-none w-[18px] text-accent">
            <IconFolderOpen size={18} />
          </span>
        ) : null}
        {/* The name takes the slack and the chevron never moves: a chevron that
            walks left as the name grows does not read as one control. */}
        <span
          className={
            'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap' +
            (variant === 'sidebar' ? ' flex-1 text-left' : '')
          }
        >
          {label}
        </span>
        <IconChevronDown size={16} className="shrink-0 opacity-80" />
      </button>

      {anchor ? (
        <Menu anchor={anchor} items={items} label="Project menu" onClose={() => setAnchor(null)} />
      ) : null}
    </>
  )
}
