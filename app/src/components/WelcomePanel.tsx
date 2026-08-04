import type { ReactNode } from 'react'
import { COPY } from '../copy'
import { useInstallState } from '../hooks/useInstall'
import { readyLanguages } from '../languages'
import { badgeClass } from './FileBadge'
import { LogoLockup } from './Logo'
import { Button } from './ui/Button'
import { IconArrowRight, IconFolderPlus, IconPlus } from './ui/Icons'

/* Same pane geometry as Editor's — this panel occupies the editor canvas.
 * `editor-pane` below carries no styling; it is a contract selector tools/qa
 * reads. */
const EDITOR_PANE = 'editor-pane relative flex-1 min-w-0 min-h-editor-min overflow-hidden bg-surface-1'

/* The whole card is one 88px+ target — no nested buttons. The 1px
 * --border-control edge does the work, since surface-3 on surface-1 is only
 * ~1.1:1 and invisible on a phone. The rows are head / blurb / manifest with
 * the blurb taking the slack, so the manifest lines up along the bottom of both
 * cards even when one title wraps. `start-card` carries no styling — it is a
 * contract selector tools/qa reads (the picker's cards are `.template-card`;
 * these first-run start cards are distinct). */
const CARD =
  'start-card group grid grid-rows-[auto_1fr_auto] gap-2 min-h-[88px] p-4 text-left border border-border-control ' +
  'rounded-lg bg-surface-3 cursor-pointer touch-manipulation ' +
  'transition-[background-color,border-color,transform] duration-(--dur-fast) ease-standard ' +
  'hover:bg-surface-4 hover:border-text-3 active:bg-surface-4 active:scale-99'

export interface WelcomePanelProps {
  onNewFile(): void
  onNewProject(): void
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
 * Two ways to begin: an empty file, or a starter. "New file" opens straight
 * into typing; "New from a starter" opens the language picker (TemplatePicker),
 * which is the one place that scales as Warsha grows past Java and Python — the
 * cards here never multiply with the language list.
 */
export function WelcomePanel({ onNewFile, onNewProject, onImportZip }: WelcomePanelProps) {
  // Read here rather than threaded down from App: this is a fact about the
  // device, not about the project, and every other prop on this panel is an
  // action the workspace owns.
  const install = useInstallState()

  return (
    <div className={EDITOR_PANE}>
      {/* In-flow, never a full-page gate: as an absolute z-30 layer this panel
          painted OVER the explorer drawer (z-20) and its scrim on a phone. */}
      <div className="scroller relative z-0 h-full bg-surface-1" role="region" aria-label="Start a project">
        {/* Weighted above centre — the lockup lands in the upper third, where
            the eye starts, and nothing important sits where a keyboard would.
            Tighter than the old full-page welcome: this column shares the
            height with the console, so the rhythm drops from 24px to 16px. */}
        <div className="flex w-full max-w-[30rem] flex-col items-stretch gap-4 mx-auto px-5 py-5 min-[1024px]:max-w-[40rem]">
          <div className="flex flex-col items-center gap-4">
            <span className="inline-flex">
              <LogoLockup />
            </span>
          </div>

          {/* Two cards, stacked on a phone and side by side on a laptop. Same
              anatomy for both, because "an empty file" and "a starter" are the
              same kind of choice here — a way to begin, not a mode. */}
          <div className="grid gap-3 min-[1024px]:grid-cols-2">
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
            <StartCard
              badge={
                <span aria-hidden="true" className={badgeClass('md', 'plain')}>
                  <IconFolderPlus size={14} />
                </span>
              }
              title={COPY.welcomeNewProject}
              blurb={COPY.welcomeNewProjectBlurb}
              manifest={`${readyLanguages.length} languages ready · more soon`}
              onPick={onNewProject}
            />
          </div>

          <Button variant="ghost" onClick={onImportZip} className="justify-center">
            {COPY.welcomeImport}
          </Button>

          {/* iOS and iPadOS only. Everywhere else the title bar's install
              control does this job with one tap; on WebKit no control can
              exist, so the instruction is the affordance. It is quiet type at
              the foot of the panel because it is worth reading once and never
              again — and it is gone once Warsha is running from the home
              screen. */}
          {install === 'manual' ? (
            <p className="m-0 text-center text-micro leading-[1.6] text-text-3">{COPY.installIos}</p>
          ) : null}
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
      {/* Tabular figures so both cards' counts line up down the column. */}
      <span className="text-micro leading-[1.4] tabular-nums text-text-3">{manifest}</span>
    </button>
  )
}
