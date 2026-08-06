import { useId, useState } from 'react'
import { COPY } from '../copy'
import {
  languageById,
  readyLanguages,
  soonLanguages,
  type Language,
} from '../languages'
import { templates, type Template, type TemplateLevel } from '../templates'
import { badgeClass } from './FileBadge'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'
import { IconArrowRight, IconChevronRight } from './ui/Icons'
import { LangIcon, type IconLang } from './ui/LangIcons'

/**
 * The single entry point for starting a project: a language grid, then that language's
 * starters grouped beginner → advanced. Exists because one menu row per template doesn't
 * survive twenty languages — everything here projects `languages`/`templates`, so it grows
 * by editing those, not this file. Never creates anything itself: resolves to `onPick` or
 * `onBlank` and lets App decide what that means for the current project.
 */
export interface TemplatePickerProps {
  onPick(t: Template): void
  onBlank(): void
  onCancel(): void
}

const LEVEL_ORDER: TemplateLevel[] = ['beginner', 'intermediate', 'advanced']
/**
 * A function, not a constant — a module-scope object would read `COPY` at import time,
 * before main.tsx's `initLocale()` runs, freezing these labels in English on every load
 * (a bug we shipped). Every `COPY` read must happen during render; see copy.ts.
 */
const levelLabel = (level: TemplateLevel): string =>
  ({
    beginner: COPY.levelBeginner,
    intermediate: COPY.levelIntermediate,
    advanced: COPY.levelAdvanced,
  })[level]

export function TemplatePicker({ onPick, onBlank, onCancel }: TemplatePickerProps) {
  const [langId, setLangId] = useState<string | null>(null)
  const titleId = useId()
  const language = langId ? languageById(langId) : null

  return (
    <Modal onCancel={onCancel} dismissible wide labelledBy={titleId}>
      {language ? (
        <TemplateStep
          language={language}
          titleId={titleId}
          onBack={() => setLangId(null)}
          onPick={onPick}
        />
      ) : (
        <LanguageStep titleId={titleId} onChoose={setLangId} />
      )}

      <div className="mt-4 flex items-center justify-between gap-2">
        {/* Blank only offered on step one — inside a language, "no thanks" means Back, not blank. */}
        {language ? (
          <span />
        ) : (
          <Button variant="ghost" onClick={onBlank}>
            {COPY.pickerBlank}
          </Button>
        )}
        <Button variant="ghost" large onClick={onCancel}>
          {COPY.dlgCancel}
        </Button>
      </div>
    </Modal>
  )
}

/* ---- step one: the language grid ---------------------------------------- */

function LanguageStep({ titleId, onChoose }: { titleId: string; onChoose(id: string): void }) {
  return (
    <div>
      <h2 id={titleId} className="mb-1 text-dlg-title leading-[1.3] font-semibold text-text-1">
        {COPY.pickerTitle}
      </h2>
      <p className="mb-4 text-meta leading-normal text-text-3">{COPY.pickerLangIntro}</p>

      <Section heading={COPY.pickerReadyHeading}>
        {/* Full-width on a phone so the two runnable languages read as the headline with room for a version label. */}
        <div className="grid grid-cols-1 gap-2 min-[560px]:grid-cols-3">
          {readyLanguages.map((l) => (
            <ReadyTile key={l.id} language={l} onChoose={() => onChoose(l.id)} />
          ))}
        </div>
      </Section>

      <Section heading={COPY.pickerSoonHeading} note={COPY.pickerSoonNote}>
        <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3">
          {soonLanguages.map((l) => (
            <SoonTile key={l.id} language={l} />
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({
  heading,
  note,
  children,
}: {
  heading: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-1 text-micro font-semibold uppercase tracking-[0.06em] text-text-3">{heading}</h3>
      {note ? <p className="mb-2 text-micro leading-[1.5] text-text-3">{note}</p> : null}
      {children}
    </section>
  )
}

/** The 36px language mark — the real glyph for a ready language, its monogram
 *  for one still on the way. */
function LangMark({ language, dimmed }: { language: Language; dimmed?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        'grid place-items-center flex-none size-9 rounded-md ' +
        (dimmed ? 'bg-surface-3 text-text-3' : 'bg-surface-4 text-text-1')
      }
    >
      {language.status === 'ready' ? (
        <LangIcon lang={language.id as IconLang} size={22} />
      ) : (
        <span className="font-code text-meta font-bold leading-none tracking-[-0.03em]">{language.mark}</span>
      )}
    </span>
  )
}

const READY_TILE =
  'group flex items-center gap-2.5 min-h-touch p-2.5 text-start border border-border-control rounded-lg ' +
  'bg-surface-3 cursor-pointer touch-manipulation transition-[background-color,border-color,transform] ' +
  'duration-(--dur-fast) ease-standard hover:bg-surface-4 hover:border-text-3 active:bg-surface-4 active:scale-99'

function ReadyTile({ language, onChoose }: { language: Language; onChoose(): void }) {
  return (
    <button type="button" onClick={onChoose} className={READY_TILE}>
      <LangMark language={language} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-btn leading-[1.2] font-semibold text-text-1">{language.label}</span>
        {language.version ? (
          <span className="block truncate text-micro leading-[1.3] text-text-3">{language.version}</span>
        ) : null}
      </span>
      <IconChevronRight
        size={16}
        className="flex-none text-text-3 rtl:-scale-x-100 transition-[color] duration-(--dur-fast) ease-standard group-hover:text-accent"
      />
    </button>
  )
}

const SOON_TILE =
  'flex items-center gap-2.5 min-h-touch p-2.5 text-start border border-border-subtle rounded-lg ' +
  'bg-surface-2 opacity-60 cursor-not-allowed select-none'

function SoonTile({ language }: { language: Language }) {
  return (
    <div className={SOON_TILE} aria-disabled="true" aria-label={COPY.pickerSoonLabel(language.label)}>
      <LangMark language={language} dimmed />
      <span className="min-w-0 flex-1 truncate text-btn leading-[1.2] font-semibold text-text-2">{language.label}</span>
      {/* Section header + dimming already say "unbuilt"; the pill is a wider-screen nicety, hidden on a two-up phone grid. */}
      <span
        aria-hidden="true"
        className="hidden min-[560px]:block flex-none rounded-sm bg-surface-4 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-[0.04em] text-text-3"
      >
        {COPY.pickerSoonBadge}
      </span>
    </div>
  )
}

/* ---- step two: a language's starters, by level -------------------------- */

function TemplateStep({
  language,
  titleId,
  onBack,
  onPick,
}: {
  language: Language
  titleId: string
  onBack(): void
  onPick(t: Template): void
}) {
  const forLang = templates.filter((t) => t.lang === language.id)
  const byLevel = LEVEL_ORDER.map((level) => ({
    level,
    items: forLang.filter((t) => t.level === level),
  })).filter((g) => g.items.length > 0)

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        <Button variant="ghost" onClick={onBack} className="gap-1 -ms-1">
          <IconChevronRight size={16} className="rotate-180 rtl:-scale-x-100" />
          {COPY.pickerBack}
        </Button>
      </div>
      <h2 id={titleId} className="mb-3 text-dlg-title leading-[1.3] font-semibold text-text-1">
        {COPY.pickerChooseTemplate(language.label)}
      </h2>

      <div className="flex flex-col gap-4">
        {byLevel.map((group) => (
          <section key={group.level}>
            <h3 className="mb-1.5 text-micro font-semibold uppercase tracking-[0.06em] text-text-3">
              {levelLabel(group.level)}
            </h3>
            <div className="grid gap-2 min-[560px]:grid-cols-2">
              {group.items.map((t) => (
                <TemplateCard key={t.id} template={t} onPick={() => onPick(t)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

const TEMPLATE_CARD =
  'template-card group grid grid-rows-[auto_1fr_auto] gap-1.5 min-h-[84px] p-3 text-start border border-border-control ' +
  'rounded-lg bg-surface-3 cursor-pointer touch-manipulation transition-[background-color,border-color,transform] ' +
  'duration-(--dur-fast) ease-standard hover:bg-surface-4 hover:border-text-3 active:bg-surface-4 active:scale-99'

function TemplateCard({ template, onPick }: { template: Template; onPick(): void }) {
  return (
    <button type="button" onClick={onPick} className={TEMPLATE_CARD}>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={badgeClass('sm', template.lang === 'java' ? 'java' : 'py')}>
          <LangIcon lang={template.lang} size={18} />
        </span>
        <span className="min-w-0 flex-1 text-btn leading-[1.25] font-semibold text-text-1">{COPY.templates[template.id]?.name ?? template.name}</span>
        <IconArrowRight
          size={16}
          className="flex-none text-text-3 rtl:-scale-x-100 transition-[color] duration-(--dur-fast) ease-standard group-hover:text-accent"
        />
      </span>
      <span className="text-meta leading-normal text-text-2">{COPY.templates[template.id]?.blurb ?? template.blurb}</span>
      <span className="text-micro leading-[1.4] tabular-nums text-text-3">
        {COPY.templateManifest(template.snapshot.files.length, template.entry)}
      </span>
    </button>
  )
}
