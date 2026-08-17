import type { ReactNode } from 'react'
import { COPY } from '../copy'
import { useInstallState } from '../hooks/useInstall'
import { readyLanguages } from '../languages'
import { badgeClass } from './FileBadge'
import { LogoLockup } from './Logo'
import { Button } from './ui/Button'
import { IconArrowRight, IconFolderPlus } from './ui/Icons'

// Same pane geometry as Editor's. `editor-pane` carries no styling — tools/qa's contract selector.
const EDITOR_PANE = 'editor-pane relative flex-1 min-w-0 min-h-editor-min overflow-hidden bg-surface-1'

// One 88px+ target, no nested buttons. The 1px border does the work — surface-3 on surface-1
// is only ~1.1:1 contrast, invisible on a phone otherwise. `start-card` is a QA contract
// selector distinct from the picker's `.template-card`.
const CARD =
  'start-card group grid grid-rows-[auto_1fr_auto] gap-2 min-h-[88px] p-4 text-start border border-border-control ' +
  'rounded-lg bg-surface-3 cursor-pointer touch-manipulation ' +
  'transition-[background-color,border-color,transform] duration-(--dur-fast) ease-standard ' +
  'hover:bg-surface-4 hover:border-text-3 active:bg-surface-4 active:scale-99'

export interface WelcomePanelProps {
  onNewFile(): void
  onNewProject(): void
  onImportZip(): void
  /** Other projects, most recently opened first (same order as File > Open Recent). The
   *  open project is excluded — a link back to where you already are is a dead link. */
  recent: { id: string; name: string }[]
  onOpenProject(id: string): void
}

/**
 * The empty project's editor area — Warsha's whole first-run experience. No welcome page,
 * no language gate: the IDE (explorer, tabs, console, Run) is fully real behind this panel,
 * which just occupies the canvas until a file exists, then is gone for good. "New from a
 * starter" is the one card-shaped choice and primary way in (opens TemplatePicker); "New
 * file" and "Import" (files, a folder, or a .zip) are quiet secondary actions below it.
 */
export function WelcomePanel({ onNewFile, onNewProject, onImportZip, recent, onOpenProject }: WelcomePanelProps) {
  // Read here rather than threaded down from App: this is a fact about the
  // device, not about the project, and every other prop on this panel is an
  // action the workspace owns.
  const install = useInstallState()

  return (
    <div className={EDITOR_PANE}>
      {/* In-flow, never absolute: an earlier z-30 version painted over the explorer drawer's scrim on a phone. */}
      <div className="scroller relative z-0 h-full bg-surface-1" role="region" aria-label={COPY.welcomeStartProject}>
        {/* Vertically centred (not top-anchored under the tab strip). min-h-full is border-box,
            so padding stays inside and nothing scrolls until the pane is genuinely too short. */}
        <div className="flex min-h-full w-full max-w-[30rem] flex-col items-stretch justify-center gap-4 mx-auto px-5 py-5 min-[1024px]:max-w-[40rem]">
          <div className="flex flex-col items-center gap-4">
            <span className="inline-flex">
              <LogoLockup />
            </span>
          </div>

          {/* The one card-shaped choice on the panel; takes first focus. */}
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

          {/* Link-styled rows (`.link` recipe): these GO somewhere, unlike the card-shaped choice above. */}
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

          {/* iOS/iPadOS only: WebKit can't offer an install control, so this text is the
              affordance instead. Gone once Warsha runs from the home screen. */}
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
        {/* Quiet arrow signals "go into"; the card's only decoration, accented on hover. */}
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
