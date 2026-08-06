/**
 * The breadcrumbs row: VS Code's path trail, mounted between the tab
 * strip and the editor. It sits on the editor-canvas surface — the active
 * tab's fill runs through this row and into the code below, which is what
 * makes the three read as one column.
 *
 * Static v1: the segments are not pickers yet, so they render as plain spans,
 * not buttons — a segment that opened nothing would be dead UI. When the
 * sibling-picker dropdowns arrive, the spans become triggers.
 *
 * One shell (founder ruling): the row renders at every size and pointer.
 * Height rides --bar-crumbs — 28px on touch (plain spans, no tap targets yet;
 * the token's comment says what happens when that changes), VS Code's 22px
 * under the DENSITY block.
 *
 * `breadcrumbs` / aria-label={COPY.a11yBreadcrumbs} are QA contract handles.
 */
import { Fragment } from 'react'
import { FileBadge } from './FileBadge'
import { IconChevronRight } from './ui/Icons'
import { COPY } from '../copy'

export function Breadcrumbs({ path }: { path: string | null }) {
  if (path === null) return null

  const segments = path.split('/')
  const file = segments[segments.length - 1]
  const folders = segments.slice(0, -1)

  return (
    <nav
      aria-label={COPY.a11yBreadcrumbs}
      className={
        'breadcrumbs flex items-center h-bar-crumbs flex-none overflow-hidden ' +
        'px-2 gap-0.5 select-none bg-surface-1 text-[13px] text-text-2'
      }
    >
      {/* Long paths shrink in the middle: folders collapse first (shrink-[3] vs
          the file span's default 1), the file name stays whole. */}
      {folders.map((seg, i) => (
        <Fragment key={i}>
          <span className="min-w-[2ch] shrink-[3] overflow-hidden text-ellipsis whitespace-nowrap transition-colors duration-(--dur-fast) ease-standard hover:text-text-1">
            {seg}
          </span>
          <IconChevronRight size={16} className="flex-none rtl:-scale-x-100" aria-hidden="true" />
        </Fragment>
      ))}
      <span className="flex min-w-0 items-center gap-1 whitespace-nowrap transition-colors duration-(--dur-fast) ease-standard hover:text-text-1">
        {/* bare: a badge chip inside a path row would read as a second label. */}
        <FileBadge name={file} bare />
        <span className="overflow-hidden text-ellipsis">{file}</span>
      </span>
    </nav>
  )
}
