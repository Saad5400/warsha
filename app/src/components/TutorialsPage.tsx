import { useEffect, useRef, useState, type ReactNode } from 'react'
import { COPY } from '../copy'
import type { Locale } from '../i18n/locale'
import { fuzzyMatch, toRanges } from '../ui/fuzzy'
import { CATEGORIES, TUTORIALS } from '../tutorials'
import { say, searchText, type Tutorial } from '../tutorials/types'
import { Button, IconButton } from './ui/Button'
import { IconArrowRight, IconGlobe, IconSearch } from './ui/Icons'
import { Logo } from './Logo'

/**
 * The Tutorials page — a full-screen, bilingual, fuzzy-searchable library of
 * illustrated walkthroughs. Every screenshot is a real capture of the app for
 * the active locale (public/tutorials/<shot>.<locale>.png, produced by
 * tools/tutorials-shots.mjs), so the Arabic reader sees the real RTL interface.
 *
 * Replaces the shell while shown (like Home); the brand mark and "All tutorials"
 * lead back. Search reuses the app's own fuzzy matcher (ui/fuzzy.ts) and lights
 * the matched characters, exactly as the quick-open palette does.
 */

const PAGE =
  'tutorials-view fixed inset-0 h-[calc(var(--app-h,100dvh)/var(--ui-scale,1))] overflow-y-auto scroller bg-surface-1 ' +
  'pb-[env(safe-area-inset-bottom)] ps-[max(0px,env(safe-area-inset-left))] pe-[max(0px,env(safe-area-inset-right))]'

const FIELD =
  'h-9 rounded-md border border-border-control bg-surface-2 text-[length:var(--fs-input)] text-text-1 ' +
  'focus:outline-2 focus:outline-offset-[-1px] focus:outline-(--focus-ring)'

/** The path to a captured screenshot for the active locale. */
const shotUrl = (shot: string, locale: Locale) => `${import.meta.env.BASE_URL}tutorials/${shot}.${locale}.png`

type Range = [number, number]

/** Matched characters lit in the palette blue — the quick-open treatment. */
function Highlighted({ text, ranges }: { text: string; ranges: Range[] }) {
  if (ranges.length === 0) return <>{text}</>
  const out: ReactNode[] = []
  let last = 0
  for (const [start, end] of ranges) {
    if (start > last) out.push(text.slice(last, start))
    out.push(
      <span key={start} className="text-accent">
        {text.slice(start, end)}
      </span>,
    )
    last = end
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}

export interface TutorialsPageProps {
  locale: Locale
  onHome(): void
  onToggleLocale(): void
}

export function TutorialsPage({ locale, onHome, onToggleLocale }: TutorialsPageProps) {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const open = openId ? TUTORIALS.find((t) => t.id === openId) ?? null : null

  // Leaving a lesson clears the query context is fine; opening one from search keeps it.
  if (open) {
    return <Lesson tutorial={open} locale={locale} onBack={() => setOpenId(null)} />
  }

  const q = query.trim()
  const searching = q.length > 0

  // Rank by fuzzy score over the whole searchable text (both languages), but
  // light the match on the visible TITLE so the highlight lines up with the eye.
  const ranked = searching
    ? TUTORIALS.map((t) => ({ t, m: fuzzyMatch(q, searchText(t.title, t.summary, t.keywords, ...t.steps.flatMap((s) => [s.title, s.keywords]))) }))
        .filter((x): x is { t: Tutorial; m: NonNullable<ReturnType<typeof fuzzyMatch>> } => x.m !== null)
        .sort((a, b) => b.m.score - a.m.score)
        .map((x) => x.t)
    : TUTORIALS

  const titleRanges = (t: Tutorial): Range[] => {
    if (!searching) return []
    const m = fuzzyMatch(q, say(t.title, locale))
    return m ? toRanges(m.positions) : []
  }

  return (
    <div className={PAGE} role="region" aria-label={COPY.tutorialsTitle}>
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-6 px-5 py-6">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onHome}
            className="inline-flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
            aria-label={COPY.a11yHome}
          >
            <Logo size={26} />
            <span className="text-[17px] leading-none font-semibold tracking-[-0.01em] text-text-1">Warsha</span>
          </button>
          <span className="ms-3 hidden text-meta text-text-3 min-[560px]:inline">{COPY.tutorialsTitle}</span>
          <span className="ms-auto flex items-center gap-2">
            <IconButton label={COPY.menuLanguage} onClick={onToggleLocale}>
              <IconGlobe />
            </IconButton>
          </span>
        </header>

        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-[22px] leading-tight font-semibold text-text-1">{COPY.tutorialsTitle}</h1>
          <p className="m-0 max-w-[42rem] text-meta leading-normal text-text-3">{COPY.tutorialsSubtitle}</p>
        </div>

        <div className="relative max-w-[22rem]">
          <span className="pointer-events-none absolute inset-y-0 start-2 grid place-items-center text-text-3">
            <IconSearch size={16} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={COPY.tutorialsSearchPlaceholder}
            aria-label={COPY.tutorialsSearchPlaceholder}
            className={FIELD + ' w-full ps-8 pe-2 placeholder:text-text-3'}
          />
        </div>

        {searching ? (
          ranked.length === 0 ? (
            <p className="m-0 py-6 text-center text-meta text-text-3">{COPY.tutorialsNoMatches(q)}</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
              {ranked.map((t) => (
                <Card key={t.id} tutorial={t} locale={locale} titleRanges={titleRanges(t)} onOpen={() => setOpenId(t.id)} />
              ))}
            </div>
          )
        ) : (
          CATEGORIES.map((cat) => {
            const items = TUTORIALS.filter((t) => t.category === cat.id)
            if (items.length === 0) return null
            return (
              <section key={cat.id} aria-label={say(cat.label, locale)} className="flex flex-col gap-3">
                <h2 className="m-0 text-btn leading-[1.3] font-semibold text-text-2">{say(cat.label, locale)}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
                  {items.map((t) => (
                    <Card key={t.id} tutorial={t} locale={locale} titleRanges={[]} onOpen={() => setOpenId(t.id)} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}

function Card({
  tutorial,
  locale,
  titleRanges,
  onOpen,
}: {
  tutorial: Tutorial
  locale: Locale
  titleRanges: Range[]
  onOpen(): void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={
        'group flex min-h-[128px] flex-col gap-3 rounded-lg border border-border-control bg-surface-3 p-4 text-start ' +
        'transition-[background-color,border-color] duration-(--dur-fast) ease-standard ' +
        'hover:bg-surface-4 hover:border-text-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-(--focus-ring)'
      }
    >
      <span className="flex items-center gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-lg border border-border-subtle bg-surface-4 text-text-1">
          {tutorial.icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-btn leading-[1.3] font-semibold text-text-1">
          <Highlighted text={say(tutorial.title, locale)} ranges={titleRanges} />
        </span>
        <IconArrowRight size={16} className="flex-none text-text-3 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100" />
      </span>
      <span className="line-clamp-3 text-meta leading-normal text-text-3">{say(tutorial.summary, locale)}</span>
      <span className="mt-auto text-micro tabular-nums text-text-3">{COPY.tutorialsSteps(tutorial.steps.length)}</span>
    </button>
  )
}

function Lesson({ tutorial, locale, onBack }: { tutorial: Tutorial; locale: Locale; onBack(): void }) {
  const [i, setI] = useState(0)
  const total = tutorial.steps.length
  const step = tutorial.steps[Math.min(i, total - 1)]
  const scrollRef = useRef<HTMLDivElement>(null)

  const go = (next: number) => setI(Math.min(Math.max(0, next), total - 1))

  // New step → scroll the reading area back to the top.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [i])

  // Arrow-key navigation, mirrored for RTL so "forward" always points onward.
  useEffect(() => {
    const rtl = document.documentElement.dir === 'rtl'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(rtl ? i - 1 : i + 1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(rtl ? i + 1 : i - 1) }
      else if (e.key === 'Escape') { e.preventDefault(); onBack() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [i, total]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={scrollRef} className={PAGE} role="region" aria-label={say(tutorial.title, locale)}>
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-5 px-5 py-6">
        <header className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className={
              'inline-flex items-center gap-1.5 rounded-md border border-border-control bg-surface-2 px-2.5 py-1.5 ' +
              'text-meta text-text-2 transition-colors duration-(--dur-fast) ease-standard hover:bg-surface-3 hover:text-text-1 ' +
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-ring)'
            }
          >
            <IconArrowRight size={15} className="-scale-x-100 rtl:scale-x-100" />
            {COPY.tutorialsBackToAll}
          </button>
          <span className="ms-1 flex min-w-0 items-center gap-2">
            <span className="grid size-7 flex-none place-items-center rounded-md border border-border-subtle bg-surface-3 text-text-1">
              {tutorial.icon}
            </span>
            <h1 className="m-0 truncate text-[17px] leading-tight font-semibold text-text-1">{say(tutorial.title, locale)}</h1>
          </span>
          <span className="ms-auto flex-none text-meta tabular-nums text-text-3">{COPY.tutorialsStepOf(i + 1, total)}</span>
        </header>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5" role="tablist" aria-label={COPY.tutorialsTitle}>
          {tutorial.steps.map((s, n) => (
            <button
              key={n}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={say(s.title, locale)}
              onClick={() => go(n)}
              className={
                'h-1.5 flex-1 rounded-full transition-colors duration-(--dur-fast) ' +
                (n === i ? 'bg-accent' : n < i ? 'bg-text-3' : 'bg-surface-4 hover:bg-text-3')
              }
            />
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
          {/* The screenshot — the real captured surface for this locale. */}
          <figure className="m-0 overflow-hidden rounded-xl border border-border-control bg-surface-0 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.5)]">
            <img
              key={step.shot}
              src={shotUrl(step.shot, locale)}
              alt={say(step.alt, locale)}
              width={1280}
              height={800}
              className="block h-auto w-full"
              loading="eager"
              dir="ltr"
            />
          </figure>

          {/* Step text + nav */}
          <div className="flex flex-col gap-4 lg:pt-1">
            <div className="flex flex-col gap-2">
              <span className="text-micro font-semibold tracking-wide text-accent uppercase tabular-nums">
                {COPY.tutorialsStepOf(i + 1, total)}
              </span>
              <h2 className="m-0 text-[19px] leading-snug font-semibold text-text-1">{say(step.title, locale)}</h2>
              <p className="m-0 text-row leading-relaxed text-text-2">{say(step.body, locale)}</p>
            </div>

            <div className="mt-auto flex items-center gap-2 pt-2">
              <Button variant="ghost" onClick={() => go(i - 1)} disabled={i === 0}>
                {COPY.tutorialsPrev}
              </Button>
              {i < total - 1 ? (
                <Button variant="primary" onClick={() => go(i + 1)}>
                  {COPY.tutorialsNext}
                  <IconArrowRight size={16} className="rtl:-scale-x-100" />
                </Button>
              ) : (
                <Button variant="primary" onClick={onBack}>
                  {COPY.tutorialsFinish}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
