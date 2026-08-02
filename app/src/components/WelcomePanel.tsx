import type { ReactNode } from 'react'
import { COPY } from '../copy'
import { templates, type Template } from '../templates'
import { badgeClass, LangBadge } from './FileBadge'
import { LogoLockup } from './Logo'
import { Button } from './ui/Button'
import { IconArrowRight, IconPlus } from './ui/Icons'

/* Same pane geometry as Editor's — this panel occupies the editor canvas.
 * `editor-pane` and `template-card` below carry no styling; they are contract
 * selectors tools/qa reads. */
const EDITOR_PANE = 'editor-pane relative flex-1 min-w-0 min-h-editor-min overflow-hidden bg-surface-1'

/* The whole card is one 88px+ target — no nested buttons. The 1px
 * --border-control edge does the work, since surface-3 on surface-1 is only
 * ~1.1:1 and invisible on a phone. The rows are head / blurb / manifest with
 * the blurb taking the slack, so the manifest lines up along the bottom of all
 * three cards even when one title wraps. */
const CARD =
  'template-card group grid grid-rows-[auto_1fr_auto] gap-2 min-h-[88px] p-4 text-left border border-border-control ' +
  'rounded-lg bg-surface-3 cursor-pointer touch-manipulation ' +
  'transition-[background-color,border-color,transform] duration-(--dur-fast) ease-standard ' +
  'hover:bg-surface-4 hover:border-text-3 active:bg-surface-4 active:scale-99'

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
    <div className={EDITOR_PANE}>
      {/* In-flow, never a full-page gate: as an absolute z-30 layer this panel
          painted OVER the explorer drawer (z-20) and its scrim on a phone. */}
      <div className="scroller relative z-0 h-full bg-surface-1" role="region" aria-label="Start a project">
        {/* Weighted above centre — the lockup lands in the upper third, where
            the eye starts, and nothing important sits where a keyboard would.
            Tighter than the old full-page welcome: this column shares the
            height with the console, so the rhythm drops from 24px to 16px. */}
        <div className="flex w-full max-w-[30rem] flex-col items-stretch gap-4 mx-auto px-5 py-5 min-[1024px]:max-w-[46rem]">
          <div className="flex flex-col items-center gap-4">
            {/* The one glitch moment on this screen (THEME-V3.md — "glitch is a
                brand accent, used sparingly"): a rare ~250ms stutter every 7s,
                never a continuous loop, and it never touches a reading surface
                because it lives only on the mark, not on the copy beside it. */}
            <span className="inline-flex animate-glitch-mark motion-reduce:animate-none">
              <LogoLockup />
            </span>
            <p className="m-0 text-center text-btn leading-normal text-text-2">{COPY.welcomePurpose}</p>
          </div>

          {/* Three cards, stacked on a phone and in one row on a laptop. Same
              anatomy for all three, because "an empty file" and "a starter" are
              the same kind of choice here — a way to begin, not a mode. */}
          <div className="grid gap-3 min-[1024px]:grid-cols-3">
            <StartCard
              autoFocus
              badge={
                <span aria-hidden="true" className={badgeClass('md', 'plain')}>
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
            <div className="note border-l-warn">
              <p className="note__text">{COPY.welcomeFirstRunNote}</p>
            </div>
          </div>

          <p className="m-0 text-center text-micro leading-[1.6] text-text-3">{COPY.storageLocal}</p>
        </div>
      </div>
    </div>
  )
}

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
    <button type="button" autoFocus={autoFocus} onClick={onPick} className={CARD}>
      <span className="flex items-center gap-2">
        {badge}
        <span className="min-w-0 flex-1 text-btn leading-[1.3] font-semibold text-text-1">{title}</span>
        {/* A quiet arrow, so the card reads as something you go into. It is the
            only decoration on the card and it takes the accent on hover. */}
        <IconArrowRight
          size={18}
          className="flex-none text-text-3 transition-[color] duration-(--dur-fast) ease-standard group-hover:text-accent"
        />
      </span>
      <span className="text-meta leading-normal text-text-2">{blurb}</span>
      {/* Tabular figures so three cards' counts line up down the column. */}
      <span className="text-micro leading-[1.4] tabular-nums text-text-3">{manifest}</span>
    </button>
  )
}
