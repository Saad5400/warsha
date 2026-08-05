import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { fuzzyMatch, toRanges } from '../ui/fuzzy'

/**
 * The quick input (VS Code's Ctrl+P family): one floating widget, four jobs,
 * routed live by the first character of what the student types —
 *
 *   files      no prefix   fuzzy file open (Ctrl+P)
 *   commands   `>`         the command palette (Ctrl+Shift+P)
 *   goto       `:`         go to line[, column] (Ctrl+G)
 *   recent     —           recent projects (Ctrl+R); fixed, no prefix routing
 *
 * `mode` only decides what the widget OPENS as — it seeds the prefix, and from
 * there the prefix in the text is the truth, exactly as in VS Code: open the
 * palette, delete the `>`, and you are in the file picker. `recent` is the one
 * fixed mode, because VS Code's recent picker filters plain text too.
 *
 * Chrome is the Wave-3 token block in tokens.css (--qi-*, --list-*, --kbd-*,
 * --picker-*) — the VS Code quick-input widget verbatim: a 600px panel hung
 * 6px under the window top, a 25px --qi-input-bg field, 22px rows with the
 * selection on --list-active-sel-bg, matched characters in --list-highlight
 * and group labels in --picker-group-fg over a --picker-group-border rule.
 * The metrics are fixed px on purpose and NOT density-forked: the widget only
 * ever opens from a keyboard chord, so a hardware keyboard is a precondition
 * of seeing it at all.
 *
 * QA handles: section[aria-label="Quick open"], the input by
 * aria-label="Search files by name". The input is a combobox over a listbox,
 * with aria-activedescendant carrying the roving selection so focus never
 * leaves the field — which is also why any press inside the panel that is not
 * on the input itself is pointerdown-prevented rather than allowed to blur it
 * (blur outside the panel is a dismissal, same as Escape).
 */

export type QuickInputMode = 'files' | 'commands' | 'goto' | 'recent'

export interface QuickCommand {
  /** Reconciliation key; labels can collide once categories repeat. */
  id: string
  /** VS Code-style "Category: Title" ("Run: Stop", "View: Toggle Console"). */
  label: string
  /** Keybinding, shown as keycap chips. Both hint dialects render: "Shift+Alt+F"
   *  splits on + (the + kept as a separator between caps), a Mac glyph run like
   *  "⇧⌘Z" splits per glyph with no separator; a chord sequence ("Ctrl+K
   *  Ctrl+O") renders as two chip groups. */
  hint?: string
  /** A command that cannot run right now is not LISTED at all — a palette row
   *  that does nothing is dead UI, and VS Code's palette hides rather than
   *  greys. Pass true when the backing state says so (Stop while idle). */
  disabled?: boolean
  run(): void
}

export interface QuickProject {
  id: string
  name: string
  /** The open project. It stays in the list, marked and inert — VS Code's
   *  recent picker shows where you are rather than pretending you are nowhere
   *  — and Enter on it merely dismisses (disabled mirroring real state). */
  current?: boolean
}

export interface QuickInputProps {
  mode: QuickInputMode
  /** Project-relative paths, the explorer's own ordering. */
  files: string[]
  /** Open-tab paths, most recently used first — the 'recently opened' group
   *  that outranks plain file results, VS Code's Ctrl+P ordering. */
  openTabs?: string[]
  commands: QuickCommand[]
  /** Most recently opened first. */
  recent: QuickProject[]
  /** For goto's hint line; null/undefined when no file is open. */
  currentLine?: number | null
  lineCount?: number | null
  onOpenFile(path: string): void
  onGotoLine(line: number, column?: number): void
  onOpenProject(id: string): void
  onClose(): void
}

/** Rows beyond this cannot be reached without narrowing the query anyway, and
 *  capping keeps a 500-file project's every-keystroke re-render flat. */
const MAX_ROWS = 128

/* The panel: --qi-bg with a --qi-border hairline, hung centred 6px under the
 * window top exactly where VS Code hangs it. Width is VS Code's 600px, giving
 * way to the viewport on a narrow window; 6px inner padding, 8px radius, and
 * the wide soft shadow are VS Code's quick-input chrome verbatim. */
const PANEL =
  'fixed left-1/2 top-[6px] z-(--z-menu) -translate-x-1/2 ' +
  'w-[600px] max-w-[calc(100vw-24px)] ' +
  'rounded-[8px] border border-(--qi-border) bg-(--qi-bg) p-[6px] ' +
  'shadow-[0_0_20px_rgba(0,0,0,0.15)]'

const INPUT =
  'h-[25px] w-full rounded-sm border border-(--qi-input-border) bg-(--qi-input-bg) px-2 ' +
  'text-[13px] text-text-1 placeholder:text-(--input-placeholder)'

/* A row. Selection is VS Code's focused-list treatment (--list-active-sel-*),
 * driven by aria-selected so the stylesheet and the screen reader read the
 * same bit; hover is the quiet --list-hover-bg and only on unselected rows so
 * the two fills never fight. */
const ROW =
  'group flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left ' +
  'min-h-[22px] text-[13px] ' +
  'aria-selected:bg-(--list-active-sel-bg) aria-selected:text-(--list-active-sel-fg) ' +
  'aria-[selected=false]:hover:bg-(--list-hover-bg)'

/* A group label ('recently opened', 'file results'): --picker-group-fg over
 * the row inset, with a --picker-group-border rule above every group but the
 * first. role=presentation keeps it out of the option count, so the
 * aria-activedescendant indices stay dense over real rows. */
const GROUP = 'flex items-center px-2 pb-0.5 pt-1 text-[11px] leading-4 text-(--picker-group-fg)'
const GROUP_RULE = ' mt-1 border-t border-(--picker-group-border)'

/* A keycap chip: --kbd-bg/fg inside a --kbd-border hairline, with the heavier
 * --kbd-border-b bottom edge drawn as an inset shadow (the same reason bars
 * do — a border would change the chip's height between chips). */
const KBD =
  'rounded-[3px] border border-(--kbd-border) bg-(--kbd-bg) px-1 text-[11px] text-(--kbd-fg) ' +
  'shadow-[inset_0_-1px_0_0_var(--kbd-border-b)]'

/** One chord → its keycaps plus the dialect: "Shift+Alt+F" → [Shift, Alt, F]
 *  with `plus` (render + separators between caps), "⌘F5" → [⌘, F5] without. */
function chordChips(chord: string): { caps: string[]; plus: boolean } {
  if (chord.includes('+')) return { caps: chord.split('+').filter(Boolean), plus: true }
  const m = /^([⌃⌥⇧⌘]*)(.*)$/u.exec(chord)
  const caps = m ? [...m[1], ...(m[2] ? [m[2]] : [])] : [chord]
  return { caps, plus: false }
}

/** The chip run for a whole hint — chord groups separated by a wider gap. */
function KeyHint({ hint }: { hint: string }) {
  return (
    <span aria-hidden="true" className="ml-auto flex flex-none items-center gap-1.5">
      {hint
        .split(' ')
        .filter(Boolean)
        .map((chord, g) => {
          const { caps, plus } = chordChips(chord)
          return (
            <span key={g} className="flex items-center gap-px">
              {caps.map((cap, k) => (
                <span key={k} className="flex items-center gap-px">
                  {plus && k > 0 ? <span className="text-text-3">+</span> : null}
                  <kbd className={KBD}>{cap}</kbd>
                </span>
              ))}
            </span>
          )
        })}
    </span>
  )
}

type Range = [number, number]

type Row = {
  /** Set on a group's first row; the renderer draws the label above it. */
  group?: string
} & (
  | { kind: 'file'; path: string; name: string; dir: string; nameRanges: Range[]; dirRanges: Range[] }
  | { kind: 'command'; command: QuickCommand; ranges: Range[] }
  | { kind: 'project'; project: QuickProject; ranges: Range[] }
  | { kind: 'goto'; line: number; column?: number }
)

/** The matched characters in --list-highlight, VS Code's filtered-list blue.
 *  It stays that blue on the selection fill too (12:1 against --list-active-
 *  sel-bg), which is also what VS Code does. */
function Highlighted({ text, ranges }: { text: string; ranges: Range[] }) {
  if (ranges.length === 0) return <>{text}</>
  const out: ReactNode[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start > last) out.push(text.slice(last, start))
    out.push(
      <span key={start} className="text-(--list-highlight)">
        {text.slice(start, end)}
      </span>,
    )
    last = end
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

function fileRow(path: string, query: string): (Row & { kind: 'file'; score: number }) | null {
  const cut = path.lastIndexOf('/')
  const name = path.slice(cut + 1)
  const dir = cut === -1 ? '' : path.slice(0, cut)
  if (query === '') return { kind: 'file', path, name, dir, nameRanges: [], dirRanges: [], score: 0 }

  // The file NAME is what a student types for, so a name match outranks any
  // path match of equal quality — VS Code's label-over-description bias.
  const onName = fuzzyMatch(query, name)
  if (onName) {
    return { kind: 'file', path, name, dir, nameRanges: toRanges(onName.positions), dirRanges: [], score: onName.score + 16 }
  }
  const onPath = fuzzyMatch(query, path)
  if (!onPath) return null
  // One match over the whole path, split back into the two rendered segments.
  const nameStart = cut + 1
  const namePositions = onPath.positions.filter((p) => p >= nameStart).map((p) => p - nameStart)
  const dirPositions = onPath.positions.filter((p) => p < cut)
  return {
    kind: 'file',
    path,
    name,
    dir,
    nameRanges: toRanges(namePositions),
    dirRanges: toRanges(dirPositions),
    score: onPath.score,
  }
}

/** Score a file group, best first; ties keep the caller's order (MRU for open
 *  tabs, the explorer's for the rest) via the index tiebreak — Array.sort is
 *  stable, but saying so in the comparator survives a refactor. */
function fileGroup(paths: string[], query: string): Array<Row & { kind: 'file'; score: number }> {
  const rows = paths.flatMap((path) => {
    const row = fileRow(path, query)
    return row ? [row] : []
  })
  if (query !== '') rows.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return rows
}

export function QuickInput({
  mode,
  files,
  openTabs = [],
  commands,
  recent,
  currentLine,
  lineCount,
  onOpenFile,
  onGotoLine,
  onOpenProject,
  onClose,
}: QuickInputProps) {
  const [text, setText] = useState(mode === 'commands' ? '>' : mode === 'goto' ? ':' : '')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const routed: QuickInputMode =
    mode === 'recent' ? 'recent' : text.startsWith('>') ? 'commands' : text.startsWith(':') ? 'goto' : 'files'
  const query = (routed === 'commands' || routed === 'goto' ? text.slice(1) : text).trim()

  // Files mode understands a trailing `:<line>[:<column>]` — "main.py:12"
  // filters on the path part and jumps after opening, VS Code's combined form.
  const fileGoto = routed === 'files' ? /^(.*?):(\d+)(?:[:,](\d+))?$/.exec(query) : null
  const fileQuery = fileGoto ? fileGoto[1] : query

  const rows = useMemo<Row[]>(() => {
    if (routed === 'goto') {
      const m = /^(\d+)(?:[:,]\s*(\d+))?$/.exec(query)
      if (!m || lineCount == null) return []
      const line = Math.min(Math.max(1, Number(m[1])), lineCount)
      return [{ kind: 'goto', line, column: m[2] ? Math.max(1, Number(m[2])) : undefined }]
    }
    if (routed === 'commands') {
      const listed = commands.filter((c) => !c.disabled)
      if (query === '') return listed.slice(0, MAX_ROWS).map((command) => ({ kind: 'command' as const, command, ranges: [] }))
      return listed
        .flatMap((command) => {
          const match = fuzzyMatch(query, command.label)
          return match ? [{ kind: 'command' as const, command, ranges: toRanges(match.positions), score: match.score }] : []
        })
        .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
        .slice(0, MAX_ROWS)
    }
    if (routed === 'recent') {
      if (query === '') return recent.slice(0, MAX_ROWS).map((project) => ({ kind: 'project' as const, project, ranges: [] }))
      return recent
        .flatMap((project) => {
          const match = fuzzyMatch(query, project.name)
          return match ? [{ kind: 'project' as const, project, ranges: toRanges(match.positions), score: match.score }] : []
        })
        .sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name))
        .slice(0, MAX_ROWS)
    }
    // Files: open tabs (MRU) as 'recently opened', then everything else as
    // 'file results' — two groups scored apart so a weak match in an open tab
    // still sits above a strong one further away, exactly Ctrl+P's bias.
    const tabSet = new Set(openTabs)
    const tabRows: Row[] = fileGroup(openTabs, fileQuery)
    const restRows: Row[] = fileGroup(
      files.filter((p) => !tabSet.has(p)),
      fileQuery,
    )
    if (tabRows[0]) tabRows[0] = { ...tabRows[0], group: 'recently opened' }
    if (restRows[0]) restRows[0] = { ...restRows[0], group: tabRows.length > 0 ? 'file results' : undefined }
    return [...tabRows, ...restRows].slice(0, MAX_ROWS)
  }, [routed, query, fileQuery, files, openTabs, commands, recent, lineCount])

  // A new query means a new list; the selection restarts at the best row.
  useEffect(() => setSel(0), [text, routed])
  const selected = Math.min(sel, Math.max(0, rows.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, rows])

  const accept = (row: Row) => {
    // Close first: a command may open a dialog or move focus, and the widget
    // must not be underneath whatever it summons.
    onClose()
    if (row.kind === 'file') {
      onOpenFile(row.path)
      if (fileGoto) onGotoLine(Math.max(1, Number(fileGoto[2])), fileGoto[3] ? Math.max(1, Number(fileGoto[3])) : undefined)
    } else if (row.kind === 'command') row.command.run()
    else if (row.kind === 'project') {
      // The current project's row is marked inert — Enter on where you
      // already are just dismisses.
      if (!row.project.current) onOpenProject(row.project.id)
    } else onGotoLine(row.line, row.column)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setSel((selected + step + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[selected]
      if (row) accept(row)
    } else if (e.key === 'Escape') {
      // Escape closes THIS widget only — the shell's own Escape handler would
      // also close the drawer underneath it (same guard as Menu's).
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  const placeholder =
    routed === 'files'
      ? 'Search files by name (append : to go to a line, > to run a command)'
      : routed === 'commands'
        ? 'Type the name of a command to run'
        : routed === 'goto'
          ? 'Type a line number to go to'
          : 'Search recent projects by name'

  // What the empty list says. Goto is a prompt rather than a failure — VS
  // Code's "Type a line number between 1 and N" — and knows about the caret
  // when there is one.
  const emptyText =
    routed === 'goto'
      ? lineCount == null
        ? 'Open a file first, then type a line number.'
        : `Type a line number between 1 and ${lineCount} to go to${currentLine != null ? ` (now at line ${currentLine})` : ''}.`
      : 'No matching results'

  const rowId = (i: number) => `${listId}-row-${i}`

  return (
    <section
      aria-label="Quick open"
      className={PANEL}
      // Any press inside the panel that is not on the input itself would blur
      // the field and dismiss the widget under the student's finger; keeping
      // the focus is what lets aria-activedescendant stay the selection and
      // lets the row's click land.
      onPointerDown={(e) => {
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault()
      }}
    >
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the widget IS the
        // focus request: it opens from a keystroke and types immediately.
        autoFocus
        type="text"
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls={listId}
        aria-activedescendant={rows.length > 0 ? rowId(selected) : undefined}
        aria-autocomplete="list"
        aria-label="Search files by name"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={INPUT}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        // Focus leaving the panel is a dismissal — the pointerdown guard above
        // means this only fires for genuinely outside interactions (a click
        // elsewhere, Tab away), never for presses on the widget's own rows.
        onBlur={onClose}
      />

      {rows.length === 0 ? (
        <p role="status" className="px-2 py-3 text-[13px] text-text-3">
          {emptyText}
        </p>
      ) : (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Quick open results"
          className="scroller mt-1 max-h-[338px] overflow-y-auto"
        >
          {rows.map((row, i) => (
            // A fragment keyed per row so the optional group label travels
            // with the row it introduces.
            <FragmentRow key={rowKey(row)} label={row.group} first={i === 0}>
              <li
                id={rowId(i)}
                role="option"
                aria-selected={i === selected}
                aria-disabled={row.kind === 'project' && row.project.current ? true : undefined}
                className={ROW}
                onClick={() => accept(row)}
              >
                {row.kind === 'file' ? (
                  <>
                    <span className="truncate">
                      <Highlighted text={row.name} ranges={row.nameRanges} />
                    </span>
                    {row.dir ? (
                      <span className="min-w-0 flex-1 truncate text-text-3 group-aria-selected:text-(--list-active-sel-fg)">
                        <Highlighted text={row.dir} ranges={row.dirRanges} />
                      </span>
                    ) : null}
                  </>
                ) : row.kind === 'command' ? (
                  <>
                    <span className="min-w-0 flex-1 truncate">
                      <Highlighted text={row.command.label} ranges={row.ranges} />
                    </span>
                    {row.command.hint ? <KeyHint hint={row.command.hint} /> : null}
                  </>
                ) : row.kind === 'project' ? (
                  <>
                    <span className="truncate">
                      <Highlighted text={row.project.name} ranges={row.ranges} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-text-3 group-aria-selected:text-(--list-active-sel-fg)">
                      {row.project.current ? 'current project' : 'project'}
                    </span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate">
                    Go to line {row.line}
                    {row.column != null ? `, column ${row.column}` : ''}
                  </span>
                )}
              </li>
            </FragmentRow>
          ))}
        </ul>
      )}
    </section>
  )
}

function rowKey(row: Row): string {
  return row.kind === 'file'
    ? row.path
    : row.kind === 'command'
      ? row.command.id
      : row.kind === 'project'
        ? row.project.id
        : 'goto'
}

/** A row plus its optional group label above it. The label is presentational
 *  (the groups are visual structure, the options are the semantics) and only
 *  the second and later groups carry the --picker-group-border rule. */
function FragmentRow({ label, first, children }: { label?: string; first: boolean; children: ReactNode }) {
  return (
    <>
      {label ? (
        <li role="presentation" className={GROUP + (first ? '' : GROUP_RULE)}>
          {label}
        </li>
      ) : null}
      {children}
    </>
  )
}
