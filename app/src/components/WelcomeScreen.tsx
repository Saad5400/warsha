import { templates, type Template } from '../templates'
import { COPY } from '../copy'
import { Button } from './ui/Button'
import { LogoLockup } from './Logo'

export interface WelcomeScreenProps {
  onPickTemplate(t: Template): void
  onEmptyFolder(): void
  onImportZip(): void
  onDismiss?: () => void
}

export function WelcomeScreen({ onPickTemplate, onEmptyFolder, onImportZip, onDismiss }: WelcomeScreenProps) {
  return (
    <div className="scroller absolute inset-0 z-30 bg-surface-0">
      <div className="mx-auto flex w-full max-w-[30rem] flex-col items-center gap-4 p-5">
        {onDismiss ? (
          <div className="flex w-full justify-end">
            <Button variant="quiet" onClick={onDismiss} aria-label="Close">
              ✕
            </Button>
          </div>
        ) : null}

        <LogoLockup />

        <p className="text-center text-btn text-text-2">{COPY.welcomePurpose}</p>

        <div className="flex w-full flex-col gap-3 min-[720px]:flex-row">
          {templates.map((t, i) => (
            <TemplateCard key={t.id} template={t} autoFocus={i === 0} onPick={() => onPickTemplate(t)} />
          ))}
        </div>

        <Button variant="ghost" large className="w-full" onClick={onEmptyFolder}>
          {COPY.welcomeEmptyFolder}
        </Button>

        {/* Said before the wait, not during it: an expected 38 MB download is a
            very different experience from an unexplained hang. */}
        <div className="w-full border-l-[3px] border-warn bg-surface-2 p-3">
          <p className="text-meta leading-normal text-text-2">{COPY.welcomeFirstRunNote}</p>
        </div>

        <p className="text-center text-micro text-text-3">
          {COPY.storageLocal}{' '}
          <button type="button" onClick={onImportZip} className="tap text-accent underline">
            {COPY.welcomeImport}
          </button>
        </p>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  autoFocus,
  onPick,
}: {
  template: Template
  autoFocus: boolean
  onPick(): void
}) {
  const count = template.snapshot.files.length
  return (
    <button
      type="button"
      autoFocus={autoFocus}
      onClick={onPick}
      // The whole card is one 88px+ target: no nested buttons. The 1px border
      // does the work, since surface-3 on surface-0 is only ~1.1:1.
      className="tap flex min-h-[5.5rem] w-full flex-col gap-2 rounded-lg border border-border-control bg-surface-3 p-4 text-left active:bg-surface-4"
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={
            'grid size-6 shrink-0 place-items-center rounded-sm font-code text-[11px] font-bold ' +
            (template.lang === 'java' ? 'bg-warn-soft text-warn' : 'bg-info-soft text-info')
          }
        >
          {template.lang === 'java' ? 'J' : 'Py'}
        </span>
        <span className="text-btn font-semibold text-text-1">{template.name}</span>
      </span>
      <span className="text-meta leading-normal text-text-2">{template.blurb}</span>
      <span className="text-micro text-text-3">
        {count} files · {template.entry}
      </span>
    </button>
  )
}
