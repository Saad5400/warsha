import { useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { splitPath } from '../fs/project'
import type { SourceFile } from '../runtime/types'
import { FileBadge } from './FileBadge'
import { IconChevronRight } from './ui/Icons'
import { COPY } from '../copy'

/**
 * The sidebar's Search view: one query across every text file, grouped by file,
 * opening a match in the editor. Deliberately not the CodeMirror find panel (still
 * Mod+F for in-file search); regex is deferred since a dead third toggle would be UI clutter.
 * A plain indexOf scan, debounced 150ms and capped at 500 matches, keeps a one-letter
 * query on a big project from freezing the tab.
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

// Explorer's HEADER anatomy reused so the two sidebar views read as one system.
// `panel-label` is the QA hook spacing.mjs measures.
const HEADER = 'flex h-bar-side shrink-0 items-center gap-2 ps-3 pe-2 shadow-[inset_0_-1px_0_0_var(--border-subtle)]'
const PANEL_LABEL = 'panel-label text-[12px] leading-none font-semibold text-text-1'

// Tree-row treatment in utility form (not `.tree-row` itself — this isn't the explorer's tree).
const FILE_ROW =
  'flex w-full min-h-row-tree cursor-pointer select-none items-center gap-2 desk:gap-1.5 ps-2 pe-2 text-start ' +
  'touch-manipulation transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:bg-list-hover active:bg-surface-4 focus-visible:outline-offset-[-1px]'

// Active match keeps VS Code's inactive-selection fill (focus has moved to the editor) plus brighter ink.
const MATCH_ROW =
  'flex w-full min-h-row-tree cursor-pointer select-none items-center pe-2 ps-[calc(var(--sp-2)+24px)] text-start ' +
  'touch-manipulation transition-colors duration-(--dur-fast) ease-standard ' +
  'text-row text-text-2 hover:bg-list-hover active:bg-surface-4 focus-visible:outline-offset-[-1px] ' +
  'data-[state=active]:bg-list-inactive-sel data-[state=active]:text-text-1'

// Aa/ab toggles: pressed is a compound state per SURFACES; sizing is the pane-action compromise (DENSITY.md).
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
        <span className={PANEL_LABEL}>{COPY.a11ySearch}</span>
      </div>

      {/* VS Code's search-box anatomy: input + two filter toggles inside one box, global focus ring kept. */}
      <div className="flex flex-none items-center p-2">
        <div className="flex min-h-touch min-w-0 flex-1 items-center gap-1 rounded-sm border border-(--input-border) bg-input pe-1">
          <input
            ref={inputRef}
            aria-label={COPY.a11ySearch}
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

      <div className="scroller min-h-0 flex-1 pb-2" aria-label={COPY.a11ySearchResults}>
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
                        'grid size-4 flex-none place-items-center text-text-1 rtl:-scale-x-100 transition-transform duration-(--dur-fast) ease-standard desk:transition-none' +
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
                            {/* whitespace-pre preserves code spacing; match highlight reuses QuickInput's blue. */}
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
