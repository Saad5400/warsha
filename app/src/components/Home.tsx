import { useEffect, useState } from 'react'
import { COPY } from '../copy'
import type { Locale } from '../i18n/locale'
import type { ProjectMeta } from '../fs/projects'
import { languageById, readyLanguages } from '../languages'
import { fuzzyMatch } from '../ui/fuzzy'
import { Button, IconButton } from './ui/Button'
import {
  IconArrowRight,
  IconChevronDown,
  IconCopy,
  IconExport,
  IconFolderOpen,
  IconGlobe,
  IconMore,
  IconPencil,
  IconPlus,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
} from './ui/Icons'
import { LangIcon, type IconLang } from './ui/LangIcons'
import { Logo, LogoLockup } from './Logo'
import { TriggerMenu, useDrillIn, type MenuItem } from './ui/Menu'

/** Per-project facts the cards show, resolved lazily (a snapshot read each). */
type ProjectFacts = { lang: IconLang | null; files: number }

type SortMode = 'recent' | 'name' | 'created'

export interface HomeProps {
  /** Every project, most recently opened first. */
  projects: ProjectMeta[]
  /** The one the editor holds — the "Continue" target. */
  currentId: string | null
  /** Ids pinned to the top, newest-pinned last. */
  pinnedIds: string[]
  /** Reads a project's language + file count for its card. */
  metaOf(id: string): Promise<ProjectFacts>
  /** Passed so a language switch re-renders the dates and copy. */
  locale: Locale
  onOpen(id: string): void
  onNewProject(): void
  onToggleLocale(): void
  onTogglePin(id: string): void
  onRename(id: string): void
  onDuplicate(id: string): void
  onDelete(id: string): void
  onExport(id: string): void
}

// Full-viewport surface, scrolls on its own. Height + /ui-scale mirror the shell
// (SHELL in App), so whole-UI zoom still works when Home replaces it.
const PAGE =
  'home-view fixed inset-0 h-[calc(var(--app-h,100dvh)/var(--ui-scale,1))] overflow-y-auto scroller bg-surface-1 ' +
  'pb-[env(safe-area-inset-bottom)] ps-[max(0px,env(safe-area-inset-left))] pe-[max(0px,env(safe-area-inset-right))]'

// surface-3 on surface-1 is ~1.1:1 — the border does the separating (same reasoning as WelcomePanel).
const CARD =
  'group relative flex min-h-[104px] flex-col rounded-lg border border-border-control bg-surface-3 ' +
  'transition-[background-color,border-color] duration-(--dur-fast) ease-standard ' +
  'hover:bg-surface-4 hover:border-text-3 focus-within:border-text-3'

const GLYPH =
  'grid size-11 flex-none place-items-center rounded-lg border border-border-subtle bg-surface-4 text-text-1'

const FIELD =
  'h-9 rounded-md border border-border-control bg-surface-2 text-[length:var(--fs-input)] text-text-1 ' +
  'focus:outline-2 focus:outline-offset-[-1px] focus:outline-(--focus-ring)'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "now" / "12 minutes ago" / "yesterday" / a short date — localized, Western digits (Arabic i18n rule). */
function relativeTime(ts: number, loc: Locale): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  // `numberingSystem` keeps digits Western (Arabic i18n rule); cast — older TS libs omit it from the option type.
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto', numberingSystem: 'latn' } as Intl.RelativeTimeFormatOptions)
  if (diff < MIN) return rtf.format(0, 'second')
  if (diff < HOUR) return rtf.format(-Math.floor(diff / MIN), 'minute')
  if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour')
  if (diff < 30 * DAY) return rtf.format(-Math.floor(diff / DAY), 'day')
  return new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', numberingSystem: 'latn' }).format(ts)
}

/** Language name (kept LTR/Latin) · relative time — the line under a project's name. */
function metaLine(facts: ProjectFacts | undefined, ts: number, loc: Locale): string {
  const label = facts?.lang ? languageById(facts.lang)?.label : undefined
  return [label, relativeTime(ts, loc)].filter(Boolean).join(' · ')
}

function sortModeLabel(mode: SortMode): string {
  if (mode === 'name') return COPY.homeSortName
  if (mode === 'created') return COPY.homeSortCreated
  return COPY.homeSortRecent
}

/** `recent` keeps the store's MRU order; the others sort a copy. */
function sortProjects(list: ProjectMeta[], mode: SortMode): ProjectMeta[] {
  if (mode === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name))
  if (mode === 'created') return [...list].sort((a, b) => b.createdAt - a.createdAt)
  return list
}

/**
 * The projects Home — Warsha's landing surface. A grid of every project the
 * student owns (name, language mark, when it was last touched), with "Continue"
 * on top, search / sort / pin as the list grows, and per-card manage actions.
 * Replaces the shell entirely while shown; entering or creating a project hands
 * back to the editor.
 */
export function Home({
  projects,
  currentId,
  pinnedIds,
  metaOf,
  locale,
  onOpen,
  onNewProject,
  onToggleLocale,
  onTogglePin,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
}: HomeProps) {
  const [facts, setFacts] = useState<Record<string, ProjectFacts>>({})
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('recent')

  // Resolve each card's language + file count. Re-runs when the set of projects
  // changes; a handful of tiny student projects makes the N reads cheap.
  const ids = projects.map((p) => p.id).join(',')
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const pairs = await Promise.all(projects.map(async (p) => [p.id, await metaOf(p.id)] as const))
      if (!cancelled) setFacts(Object.fromEntries(pairs))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, metaOf])

  const q = query.trim()
  const searching = q.length > 0
  const pinned = new Set(pinnedIds)

  // Searching ranks by fuzzy score and ignores sort/pins; otherwise sort, then float pinned to the top.
  const ordered = searching
    ? projects
        .map((p) => ({ p, s: fuzzyMatch(q, p.name)?.score ?? null }))
        .filter((x): x is { p: ProjectMeta; s: number } => x.s !== null)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p)
    : (() => {
        const s = sortProjects(projects, sort)
        return [...s.filter((p) => pinned.has(p.id)), ...s.filter((p) => !pinned.has(p.id))]
      })()

  const continueProject = projects[0] ?? null

  return (
    <div className={PAGE} role="region" aria-label={COPY.homeTitle}>
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-6 px-5 py-6">
        <header className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2">
            <Logo size={26} />
            <span className="text-[17px] leading-none font-semibold tracking-[-0.01em] text-text-1">Warsha</span>
          </span>
          <span className="ms-3 hidden text-meta text-text-3 min-[560px]:inline">{COPY.homeTitle}</span>
          <span className="ms-auto flex items-center gap-2">
            <IconButton label={COPY.menuLanguage} onClick={onToggleLocale}>
              <IconGlobe />
            </IconButton>
            <Button variant="primary" onClick={onNewProject}>
              <IconPlus size={16} />
              {COPY.dlgNewProjectTitle}
            </Button>
          </span>
        </header>

        {projects.length === 0 ? (
          <EmptyState onNewProject={onNewProject} />
        ) : (
          <>
            {!searching && continueProject ? (
              <ContinueCard project={continueProject} facts={facts[continueProject.id]} locale={locale} onOpen={onOpen} />
            ) : null}

            <section aria-label={COPY.homeAll} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-baseline gap-2">
                  <h2 className="m-0 text-btn leading-[1.3] font-semibold text-text-2">{COPY.homeAll}</h2>
                  <span className="text-meta tabular-nums text-text-3">{projects.length}</span>
                </div>
                <div className="ms-auto flex items-center gap-2">
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 start-2 grid place-items-center text-text-3">
                      <IconSearch size={16} />
                    </span>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={COPY.homeSearchPlaceholder}
                      aria-label={COPY.homeSearchPlaceholder}
                      className={FIELD + ' w-[12rem] max-w-[52vw] ps-8 pe-2 placeholder:text-text-3'}
                    />
                  </div>
                  <SortMenu mode={sort} onMode={setSort} />
                </div>
              </div>

              {searching && ordered.length === 0 ? (
                <p className="m-0 py-6 text-center text-meta text-text-3">{COPY.homeNoMatches(q)}</p>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                  {!searching ? <NewProjectCard onNewProject={onNewProject} /> : null}
                  {ordered.map((p) => (
                    <ProjectCard
                      key={p.id}
                      project={p}
                      facts={facts[p.id]}
                      locale={locale}
                      isOpen={p.id === currentId}
                      pinned={pinned.has(p.id)}
                      onOpen={onOpen}
                      onTogglePin={onTogglePin}
                      onRename={onRename}
                      onDuplicate={onDuplicate}
                      onDelete={onDelete}
                      onExport={onExport}
                    />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function ContinueCard({
  project,
  facts,
  locale,
  onOpen,
}: {
  project: ProjectMeta
  facts: ProjectFacts | undefined
  locale: Locale
  onOpen(id: string): void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(project.id)}
      className={
        'group flex items-center gap-4 rounded-lg border border-border-control bg-surface-2 p-4 text-start ' +
        'transition-[background-color,border-color] duration-(--dur-fast) ease-standard ' +
        'hover:bg-surface-3 hover:border-text-3 active:scale-99'
      }
    >
      <span className={GLYPH + ' size-12'}>
        {facts?.lang ? <LangIcon lang={facts.lang} size={24} /> : <IconFolderOpen size={22} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-micro leading-[1.4] text-text-3">{COPY.homeContinue}</span>
        <span className="truncate text-[15px] leading-[1.3] font-semibold text-text-1">{project.name}</span>
        <span className="truncate text-meta leading-normal text-text-3">{metaLine(facts, project.lastOpenedAt, locale)}</span>
      </span>
      <span
        aria-hidden="true"
        className="inline-flex flex-none items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-btn font-semibold text-accent-ink"
      >
        {COPY.homeOpen}
        <IconArrowRight size={16} className="rtl:-scale-x-100" />
      </span>
    </button>
  )
}

function ProjectCard({
  project,
  facts,
  locale,
  isOpen,
  pinned,
  onOpen,
  onTogglePin,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
}: {
  project: ProjectMeta
  facts: ProjectFacts | undefined
  locale: Locale
  isOpen: boolean
  pinned: boolean
  onOpen(id: string): void
  onTogglePin(id: string): void
  onRename(id: string): void
  onDuplicate(id: string): void
  onDelete(id: string): void
  onExport(id: string): void
}) {
  const items: MenuItem[] = [
    {
      label: pinned ? COPY.homeUnpin : COPY.homePin,
      icon: pinned ? <IconStarFilled size={18} /> : <IconStar size={18} />,
      onSelect: () => onTogglePin(project.id),
    },
    { label: COPY.homeOpen, icon: <IconFolderOpen size={18} />, onSelect: () => onOpen(project.id) },
    { label: COPY.dlgRename, icon: <IconPencil size={18} />, onSelect: () => onRename(project.id) },
    { label: COPY.homeDuplicate, icon: <IconCopy size={18} />, onSelect: () => onDuplicate(project.id) },
    { label: COPY.menuExportZip, icon: <IconExport size={18} />, onSelect: () => onExport(project.id) },
    { label: COPY.dlgDelete, icon: <IconTrash size={18} />, danger: true, onSelect: () => onDelete(project.id) },
  ]

  return (
    <div className={CARD}>
      {/* Full-bleed open target under the content; the ⋯ re-enables pointer events above it. */}
      <button
        type="button"
        aria-label={`${COPY.homeOpen} — ${project.name}`}
        onClick={() => onOpen(project.id)}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--focus-ring)"
      />
      <div className="pointer-events-none relative z-10 flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className={GLYPH}>
            {facts?.lang ? <LangIcon lang={facts.lang} size={22} /> : <IconFolderOpen size={20} />}
          </span>
          <span className="mt-0.5 flex min-w-0 flex-1 items-center gap-1.5">
            {pinned ? (
              <IconStarFilled size={13} className="flex-none text-text-2" aria-label={COPY.a11yPinned} />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-btn leading-[1.3] font-semibold text-text-1">{project.name}</span>
          </span>
          <span className="pointer-events-auto -me-1 -mt-1 flex-none">
            <CardMenu items={items} />
          </span>
        </div>
        <span className="mt-auto truncate text-meta leading-normal text-text-3">
          {isOpen ? COPY.menuProjectOpenHint : metaLine(facts, project.lastOpenedAt, locale)}
        </span>
      </div>
    </div>
  )
}

/** The per-card "⋯" — its own open state so several cards' menus don't share one. */
function CardMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const drillIn = useDrillIn()
  return (
    <TriggerMenu
      open={open}
      onOpenChange={setOpen}
      items={items}
      label={COPY.a11yMoreActions}
      drillIn={drillIn}
      trigger={
        <IconButton label={COPY.a11yMoreActions} className="after:content-none">
          <IconMore />
        </IconButton>
      }
    />
  )
}

/** Recent / Name / Created — a drop menu whose trigger shows the current choice. */
function SortMenu({ mode, onMode }: { mode: SortMode; onMode(m: SortMode): void }) {
  const [open, setOpen] = useState(false)
  const drillIn = useDrillIn()
  const items: MenuItem[] = (['recent', 'name', 'created'] as SortMode[]).map((m) => ({
    id: `sort:${m}`,
    label: sortModeLabel(m),
    hint: m === mode ? '✓' : undefined,
    onSelect: () => onMode(m),
  }))
  return (
    <TriggerMenu
      open={open}
      onOpenChange={setOpen}
      items={items}
      label={COPY.homeSortBy}
      drillIn={drillIn}
      trigger={
        <button
          type="button"
          className={
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-border-control bg-surface-2 px-2.5 ' +
            'text-meta text-text-2 transition-colors duration-(--dur-fast) ease-standard ' +
            'hover:bg-surface-3 hover:text-text-1 aria-expanded:bg-surface-3'
          }
        >
          <span className="text-text-3">{COPY.homeSortBy}:</span>
          {sortModeLabel(mode)}
          <IconChevronDown size={14} className="text-text-3" />
        </button>
      }
    />
  )
}

function NewProjectCard({ onNewProject }: { onNewProject(): void }) {
  return (
    <button
      type="button"
      onClick={onNewProject}
      className={
        'group flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-control ' +
        'bg-surface-2 p-4 text-center transition-[background-color,border-color] duration-(--dur-fast) ease-standard ' +
        'hover:bg-surface-3 hover:border-text-3 active:scale-99'
      }
    >
      <span className={GLYPH}>
        <IconPlus size={22} />
      </span>
      <span className="text-btn leading-[1.3] font-semibold text-text-1">{COPY.dlgNewProjectTitle}</span>
      <span className="text-micro leading-[1.4] tabular-nums text-text-3">{COPY.welcomeLanguagesReady(readyLanguages.length)}</span>
    </button>
  )
}

function EmptyState({ onNewProject }: { onNewProject(): void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 text-center">
      <LogoLockup />
      <div className="flex max-w-[24rem] flex-col gap-1">
        <h2 className="m-0 text-[17px] leading-[1.3] font-semibold text-text-1">{COPY.welcomeStartProject}</h2>
        <p className="m-0 text-meta leading-normal text-text-3">{COPY.welcomeRecentEmpty}</p>
      </div>
      <Button variant="primary" onClick={onNewProject}>
        <IconPlus size={16} />
        {COPY.dlgNewProjectTitle}
      </Button>
    </div>
  )
}
