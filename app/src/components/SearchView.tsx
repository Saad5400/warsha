import { useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { splitPath } from '../fs/project'
import type { SourceFile } from '../runtime/types'
import { FileBadge } from './FileBadge'
import { IconChevronRight } from './ui/Icons'
import { COPY } from '../copy'

/**
 * The sidebar's Search view (VS Code's search sidebar): one query across every
 * text file in the project, results grouped by file, a tap opens the match in
 * the editor selected. The activity bar's Search item switches the sidebar to
 * this view exactly as it switches VS Code's; the shell owns which view is up
 * (App.tsx `sideView`) and hands this component the file store and one
 * callback.
 *
 * Deliberately NOT a CodeMirror find panel: that is the in-file Mod+F, which
 * stays where it was (Edit > Find). Regex search is DEFERRED — the toggles
 * shipped are match-case and whole-word, both real; a third toggle that
 * silently did nothing would be dead UI.
 *
 * The search itself is a plain indexOf scan per file, debounced 150 ms and
 * capped at 500 matches: on a student-sized project (tens of files) it is
 * instant, and the cap is what keeps a one-letter query on a big import from
 * freezing the tab. It re-runs on `revision`, so results follow edits.
 */

/** Stop here, and say so — a one-letter query matches almost everything. */
const MAX_MATCHES = 500
const DEBOUNCE_MS = 150
/** Preview text kept around a match; a code line can be pathologically long. */
const PRE_KEEP = 24
const PRE_MAX = 32
const POST_MAX = 200

interface Match {
  from: number
  to: number
  /** The match's own line, split for rendering: before / matched / after. */
  pre: string
  mid: string
  post: string
  /** True when `pre` was cut from the left (render a leading ellipsis). */
  cut: boolean
}

interface FileHit {
  path: string
  matches: Match[]
}

interface SearchResult {
  hits: FileHit[]
  total: number
  capped: boolean
}

const isWordChar = (ch: string | undefined) => ch !== undefined && /[A-Za-z0-9_]/.test(ch)

/** The line around [from, to), trimmed for a one-line row: leading whitespace
 *  dropped, a long prefix cut to its last PRE_KEEP chars (VS Code's own move),
 *  the tail capped so a minified line cannot put 10 000 chars in the DOM. */
function sliceLine(content: string, from: number, to: number): Omit<Match, 'from' | 'to'> {
  const lineStart = content.lastIndexOf('\n', from - 1) + 1
  let lineEnd = content.indexOf('\n', to)
  if (lineEnd === -1) lineEnd = content.length
  let s = lineStart
  while (s < from && (content[s] === ' ' || content[s] === '\t')) s++
  let pre = content.slice(s, from)
  let cut = false
  if (pre.length > PRE_MAX) {
    pre = pre.slice(pre.length - PRE_KEEP)
    cut = true
  }
  return {
    pre,
    mid: content.slice(from, to),
    post: content.slice(to, Math.min(lineEnd, to + POST_MAX)),
    cut,
  }
}

function runSearch(files: SourceFile[], query: string, matchCase: boolean, wholeWord: boolean): SearchResult {
  const needle = matchCase ? query : query.toLowerCase()
  const hits: FileHit[] = []
  let total = 0
  let capped = false
  for (const file of files) {
    const hay = matchCase ? file.content : file.content.toLowerCase()
    const matches: Match[] = []
    let idx = hay.indexOf(needle)
    while (idx !== -1) {
      const end = idx + needle.length
      if (!wholeWord || (!isWordChar(file.content[idx - 1]) && !isWordChar(file.content[end]))) {
        matches.push({ from: idx, to: end, ...sliceLine(file.content, idx, end) })
        total++
        if (total >= MAX_MATCHES) {
          capped = true
          break
        }
      }
      idx = hay.indexOf(needle, end)
    }
    if (matches.length) hits.push({ path: file.path, matches })
    if (capped) break
  }
  return { hits, total, capped }
}

/* The view header — the Explorer's HEADER anatomy (same divider-as-shadow, same
 * pl-3 grid line), so the two views read as faces of one sidebar. `panel-label`
 * is the QA hook spacing.mjs measures on whichever view is up. */
const HEADER = 'flex h-bar-side shrink-0 items-center gap-2 pl-3 pr-2 shadow-[inset_0_-1px_0_0_var(--border-subtle)]'
const PANEL_LABEL = 'panel-label text-[12px] leading-none font-semibold text-text-1'

/* A file group row — the tree-row treatment in utility form (this is not the
 * explorer's tree, so it does not borrow `.tree-row` and its reserved accent
 * border). Full-width, --row-tree tall (36px touch / 22px desk — the tree's own
 * documented target compromise), list-hover fill. */
const FILE_ROW =
  'flex w-full min-h-row-tree cursor-pointer select-none items-center gap-2 desk:gap-1.5 pl-2 pr-2 text-left ' +
  'touch-manipulation transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:bg-list-hover active:bg-surface-4 focus-visible:outline-offset-[-1px]'

/* A match row. Indented under the file name; the active one keeps VS Code's
 * inactive-selection fill (focus is in the editor by then) plus brighter ink —
 * compound, never fill alone. */
const MATCH_ROW =
  'flex w-full min-h-row-tree cursor-pointer select-none items-center pr-2 pl-[calc(var(--sp-2)+24px)] text-left ' +
  'touch-manipulation transition-colors duration-(--dur-fast) ease-standard ' +
  'text-row text-text-2 hover:bg-list-hover active:bg-surface-4 focus-visible:outline-offset-[-1px] ' +
  'data-[state=active]:bg-list-inactive-sel data-[state=active]:text-text-1'

/* The Aa / ab toggles. Pressed is a compound state (accent-soft fill + accent
 * ink + 1px inset ring), per SURFACES. 36px boxes on touch inside the 44px
 * field row (the pane-action compromise, recorded in DENSITY.md); 20px at desk. */
const TOGGLE =
  'grid size-icon-btn desk:size-5 flex-none cursor-pointer place-items-center rounded-sm ' +
  'text-[12px] desk:text-[11px] font-semibold leading-none text-text-2 touch-manipulation ' +
  'transition-[background-color,color] duration-(--dur-fast) ease-standard ' +
  'hover:bg-(--toolbar-hover-bg) hover:text-text-1 focus-visible:outline-offset-[-1px] ' +
  'aria-pressed:bg-accent-soft aria-pressed:text-accent aria-pressed:shadow-[inset_0_0_0_1px_var(--accent)]'

export interface SearchViewProps {
  project: Project
  /** Bumped on structure and content changes — a new value re-runs the query. */
  revision: number
  /** Open `path` and select [from, to) in the editor (App's openAt). */
  onOpenMatch(path: string, from: number, to: number): void
}

export function SearchView({ project, revision, onOpenMatch }: SearchViewProps) {
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [collapsedFiles, setCollapsedFiles] = useState<ReadonlySet<string>>(new Set())
  /** `${path}:${from}` of the last-opened match, for the selection fill. */
  const [activeMatch, setActiveMatch] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Switching to the Search view is a statement of intent to type.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!query) {
      setResult(null)
      return
    }
    const timer = window.setTimeout(() => {
      setResult(runSearch(project.sourceFiles(), query, matchCase, wholeWord))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, matchCase, wholeWord, project, revision])

  const toggleFile = (path: string) =>
    setCollapsedFiles((cur) => {
      const next = new Set(cur)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  return (
    <div className="flex h-full min-h-0 select-none flex-col bg-surface-2">
      <div className={HEADER}>
        <span className={PANEL_LABEL}>Search</span>
      </div>

      {/* The query field: a --input-bg box carrying the input and the two
          filter toggles, VS Code's search-box anatomy. The input keeps the
          global focus ring (never outline-none), pulled inside its own box. */}
      <div className="flex flex-none items-center p-2">
        <div className="flex min-h-touch min-w-0 flex-1 items-center gap-1 rounded-sm border border-(--input-border) bg-input pr-1">
          <input
            ref={inputRef}
            aria-label="Search"
            placeholder={COPY.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 self-stretch bg-transparent px-2 text-input text-text-1 placeholder:text-(--input-placeholder) focus-visible:outline-offset-[-1px]"
          />
          <button
            type="button"
            aria-label={COPY.searchMatchCase}
            title={COPY.searchMatchCase}
            aria-pressed={matchCase}
            className={TOGGLE}
            onClick={() => setMatchCase((v) => !v)}
          >
            Aa
          </button>
          <button
            type="button"
            aria-label={COPY.searchWholeWord}
            title={COPY.searchWholeWord}
            aria-pressed={wholeWord}
            className={TOGGLE}
            onClick={() => setWholeWord((v) => !v)}
          >
            <span className="underline underline-offset-2">ab</span>
          </button>
        </div>
      </div>

      <div className="scroller min-h-0 flex-1 pb-2" aria-label="Search results">
        {!query || !result ? (
          <p className="px-3 py-1 text-row leading-normal text-text-3">{COPY.searchHint}</p>
        ) : result.total === 0 ? (
          <div className="empty">
            <p className="empty__title">{COPY.searchNoResults}</p>
            <p className="empty__body">{COPY.searchNoResultsHint}</p>
          </div>
        ) : (
          <>
            <p className="px-3 py-1 text-micro text-text-3">
              {COPY.searchSummary(result.total, result.hits.length)}
            </p>
            {result.capped ? (
              <p className="px-3 pb-1 text-micro text-text-3">{COPY.searchCapped(MAX_MATCHES)}</p>
            ) : null}
            {result.hits.map((hit) => {
              const open = !collapsedFiles.has(hit.path)
              const { dir, name } = splitPath(hit.path)
              return (
                <div key={hit.path}>
                  <button
                    type="button"
                    className={FILE_ROW}
                    aria-expanded={open}
                    title={hit.path}
                    data-path={hit.path}
                    onClick={() => toggleFile(hit.path)}
                  >
                    {/* The twistie reuses the explorer's rotate treatment (and
                        its snap-at-desk rule). */}
                    <span
                      aria-hidden="true"
                      className={
                        'grid size-4 flex-none place-items-center text-text-1 transition-transform duration-(--dur-fast) ease-standard desk:transition-none' +
                        (open ? ' rotate-90' : '')
                      }
                    >
                      <IconChevronRight size={16} />
                    </span>
                    <span aria-hidden="true" className="grid size-5 desk:size-4 flex-none place-items-center text-text-3">
                      <FileBadge name={name} />
                    </span>
                    <span className="min-w-0 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap text-row text-text-1">
                      {name}
                    </span>
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-micro text-text-3">
                      {dir}
                    </span>
                    {/* VS Code's per-file badge count. */}
                    <span className="flex-none rounded-pill bg-badge px-1.5 py-0.5 text-micro leading-none text-badge-fg">
                      {hit.matches.length}
                    </span>
                  </button>
                  {open
                    ? hit.matches.map((m) => {
                        const key = `${hit.path}:${m.from}`
                        return (
                          <button
                            key={m.from}
                            type="button"
                            className={MATCH_ROW}
                            data-state={activeMatch === key ? 'active' : undefined}
                            onClick={() => {
                              setActiveMatch(key)
                              onOpenMatch(hit.path, m.from, m.to)
                            }}
                          >
                            {/* whitespace-pre keeps code spacing honest; the
                                matched range is --list-highlight, the same blue
                                QuickInput's filtered rows use. */}
                            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre">
                              {m.cut ? <span className="text-text-3">…</span> : null}
                              {m.pre}
                              <span className="text-(--list-highlight)">{m.mid}</span>
                              {m.post}
                            </span>
                          </button>
                        )
                      })
                    : null}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
