import type { ReactNode } from 'react'
import { COPY } from '../copy'
import { useInstallState } from '../hooks/useInstall'
import { readyLanguages } from '../languages'
import { badgeClass } from './FileBadge'
import { LogoLockup } from './Logo'
import { Button } from './ui/Button'
import { IconArrowRight, IconFolderPlus } from './ui/Icons'

/* Same pane geometry as Editor's — this panel occupies the editor canvas.
 * `editor-pane` below carries no styling; it is a contract selector tools/qa
 * reads. */
const EDITOR_PANE = 'editor-pane relative flex-1 min-w-0 min-h-editor-min overflow-hidden bg-surface-1'

/* The whole card is one 88px+ target — no nested buttons. The 1px
 * --border-control edge does the work, since surface-3 on surface-1 is only
 * ~1.1:1 and invisible on a phone. The rows are head / blurb / manifest with
 * the blurb taking the slack. `start-card` carries no styling — it is a
 * contract selector tools/qa reads (the picker's cards are `.template-card`;
 * this first-run start card is distinct). */
const CARD =
  'start-card group grid grid-rows-[auto_1fr_auto] gap-2 min-h-[88px] p-4 text-start border border-border-control ' +
  'rounded-lg bg-surface-3 cursor-pointer touch-manipulation ' +
  'transition-[background-color,border-color,transform] duration-(--dur-fast) ease-standard ' +
  'hover:bg-surface-4 hover:border-text-3 active:bg-surface-4 active:scale-99'

export interface WelcomePanelProps {
  onNewFile(): void
  onNewProject(): void
  onImportZip(): void
  /**
   * The student's OTHER projects, most recently opened first — the same
   * ordering as File > Open Recent (App's projectRows). The open project is
   * excluded: this panel only shows on an empty project, and a link back to
   * where you already are is a dead link.
   */
  recent: { id: string; name: string }[]
  onOpenProject(id: string): void
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
 * The starter leads (founder ruling 2026-08-05): "New from a starter" is the
 * one card-shaped choice and the primary way in — it opens the language picker
 * (TemplatePicker), the one place that scales as Warsha grows past Java and
 * Python. "New file" and "Import a .zip" survive as quiet secondary actions
 * below it, for the student who already knows exactly what they want.
 */
export function WelcomePanel({ onNewFile, onNewProject, onImportZip, recent, onOpenProject }: WelcomePanelProps) {
  // Read here rather than threaded down from App: this is a fact about the
  // device, not about the project, and every other prop on this panel is an
  // action the workspace owns.
  const install = useInstallState()

  return (
    <div className={EDITOR_PANE}>
      {/* In-flow, never a full-page gate: as an absolute z-30 layer this panel
          painted OVER the explorer drawer (z-20) and its scrim on a phone. */}
      <div className="scroller relative z-0 h-full bg-surface-1" role="region" aria-label={COPY.welcomeStartProject}>
        {/* Vertically centred in the pane (founder ruling 2026-08-05): the
            column takes the pane's full height and centres, so an empty project
            greets the student mid-canvas instead of top-anchored under the tab
            strip. min-h-full is border-box, so the padding stays inside it and
            nothing scrolls until the pane is genuinely shorter than the
            content. Tighter than the old full-page welcome: this column shares
            the height with the console, so the rhythm is 16px, not 24px. */}
        <div className="flex min-h-full w-full max-w-[30rem] flex-col items-stretch justify-center gap-4 mx-auto px-5 py-5 min-[1024px]:max-w-[40rem]">
          <div className="flex flex-col items-center gap-4">
            <span className="inline-flex">
              <LogoLockup />
            </span>
          </div>

          {/* One card, one lead (founder ruling 2026-08-05): the starter is
              THE way to begin, so it is the only card-shaped choice on the
              panel and takes first focus. "New file" and "Import a .zip" are
              the same tier of quiet action below — there for the student who
              already knows exactly what they want. */}
          <StartCard
            autoFocus
            badge={
              <span aria-hidden="true" className={badgeClass('md', 'plain')}>
                <IconFolderPlus size={14} />
              </span>
            }
            title={COPY.welcomeNewProject}
            blurb={COPY.welcomeNewProjectBlurb}
            manifest={COPY.welcomeLanguagesReady(readyLanguages.length)}
            onPick={onNewProject}
          />

          <div className="flex items-stretch gap-2">
            <Button variant="ghost" onClick={onNewFile} className="flex-1 justify-center">
              {COPY.welcomeNewFile}
            </Button>
            <Button variant="ghost" onClick={onImportZip} className="flex-1 justify-center">
              {COPY.welcomeImport}
            </Button>
          </div>

          {/* VS Code's welcome "Recent" list. Link-styled rows (the `.link`
              recipe), because these GO somewhere rather than make something —
              the two cards above stay the only card-shaped choices. */}
          <section aria-label={COPY.welcomeRecent} className="flex flex-col items-start gap-1">
            <h2 className="m-0 text-btn leading-[1.3] font-semibold text-text-1">{COPY.welcomeRecent}</h2>
            {recent.length === 0 ? (
              <p className="m-0 text-meta leading-normal text-text-3">{COPY.welcomeRecentEmpty}</p>
            ) : (
              recent.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onOpenProject(p.id)}
                  className="link border-0 bg-transparent p-0 text-start text-meta leading-[1.8]"
                >
                  {p.name}
                </button>
              ))
            )}
          </section>

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
