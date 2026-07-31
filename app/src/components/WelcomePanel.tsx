import type { ReactNode } from 'react'
import { COPY } from '../copy'
import { templates, type Template } from '../templates'
import { LangBadge } from './FileBadge'
import { LogoLockup } from './Logo'
import { Button } from './ui/Button'
import { IconArrowRight, IconPlus } from './ui/Icons'

export interface WelcomePanelProps {
  onNewFile(): void
  onPickTemplate(t: Template): void
  onImportZip(): void
}

/**
 * The empty project's editor area — and therefore Warsha's whole first-run
 * experience.
 *
 * There is deliberately no welcome page and no language gate. The app opens
 * straight into the IDE with an empty project, and this panel occupies the
 * editor canvas until a file exists, at which point it is gone for good. The
 * explorer, tabs, console and Run control are all present and real behind it,
 * so the student never crosses a threshold to "get into" the editor.
 *
 * The starters are therefore *actions*, not identities: picking one populates
 * the project you are already in. Warsha never asks which language you want —
 * a file extension answers that (see runtime/index.ts).
 */
export function WelcomePanel({ onNewFile, onPickTemplate, onImportZip }: WelcomePanelProps) {
  return (
    <div className="editor-pane">
      {/* `.welcome` is in-flow now (eng-design removed its absolute/z-30, which
          used to paint this panel over the explorer drawer and its scrim). */}
      <div className="welcome scroller" role="region" aria-label="Start a project">
        {/* Tighter than the old full-page welcome: this column shares the height
            with the console, so the rhythm drops from 24px to 16px. */}
        <div className="welcome__col max-w-[30rem] gap-4 py-5 min-[1024px]:max-w-[46rem]">
          <div className="flex flex-col items-center gap-4">
            <LogoLockup />
            <p className="welcome__purpose">{COPY.welcomePurpose}</p>
          </div>

          {/* Three cards, stacked on a phone and in one row on a laptop. Same
              anatomy for all three, because "an empty file" and "a starter" are
              the same kind of choice here — a way to begin, not a mode. */}
          <div className="grid gap-3 min-[1024px]:grid-cols-3">
            <StartCard
              autoFocus
              badge={
                <span aria-hidden="true" className="badge badge--md badge--plain">
                  <IconPlus size={14} />
                </span>
              }
              title={COPY.welcomeNewFile}
              blurb={COPY.welcomeNewFileBlurb}
              manifest={COPY.welcomeNewFileManifest}
              onPick={onNewFile}
            />
            {templates.map((t) => (
              <StartCard
                key={t.id}
                badge={<LangBadge lang={t.lang} />}
                title={t.name}
                blurb={t.blurb}
                manifest={`${t.snapshot.files.length} files · ${t.entry}`}
                onPick={() => onPickTemplate(t)}
              />
            ))}
          </div>

          <div className="flex flex-col gap-4">
            <Button variant="ghost" onClick={onImportZip} className="justify-center">
              {COPY.welcomeImport}
            </Button>

            {/* Said before the wait, not during it: an expected 38 MB download is
                a completely different experience from an unexplained hang. */}
            <div className="note note--warn">
              <p className="note__text">{COPY.welcomeFirstRunNote}</p>
            </div>
          </div>

          <p className="welcome__footer">{COPY.storageLocal}</p>
        </div>
      </div>
    </div>
  )
}

/**
 * The whole card is one 88px+ target — no nested buttons. Its 1px
 * --border-control edge does the work of separating it from the canvas, since
 * surface-3 on surface-1 is only ~1.1:1 and invisible on a phone.
 */
function StartCard({
  badge,
  title,
  blurb,
  manifest,
  autoFocus,
  onPick,
}: {
  badge: ReactNode
  title: string
  blurb: string
  manifest: string
  autoFocus?: boolean
  onPick(): void
}) {
  return (
    <button type="button" autoFocus={autoFocus} onClick={onPick} className="template-card">
      <span className="template-card__head">
        {badge}
        <span className="template-card__title">{title}</span>
        <IconArrowRight className="template-card__go" size={18} />
      </span>
      <span className="template-card__blurb">{blurb}</span>
      <span className="template-card__manifest">{manifest}</span>
    </button>
  )
}
