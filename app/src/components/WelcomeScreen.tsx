import { templates, type Template } from '../templates'
import { COPY } from '../copy'
import { Button, IconButton } from './ui/Button'
import { IconArrowRight, IconClose } from './ui/Icons'
import { LangBadge } from './FileBadge'
import { LogoLockup } from './Logo'

export interface WelcomeScreenProps {
  onPickTemplate(t: Template): void
  onEmptyFolder(): void
  onImportZip(): void
  onDismiss?: () => void
}

/**
 * Shown when no project exists (spec §7.7). A single 480px column: lockup, one
 * line of purpose, the two template cards from templates.ts, the escape hatch,
 * then the first-run download warning — said *before* the wait, because an
 * expected 38 MB download is a completely different experience from an
 * unexplained hang.
 */
export function WelcomeScreen({ onPickTemplate, onEmptyFolder, onImportZip, onDismiss }: WelcomeScreenProps) {
  return (
    <div className="welcome scroller">
      {onDismiss ? (
        <div className="absolute right-2 top-2 z-10">
          <IconButton label="Close" onClick={onDismiss}>
            <IconClose />
          </IconButton>
        </div>
      ) : null}

      <div className="welcome__col">
        <div className="flex flex-col items-center gap-4">
          <LogoLockup />
          <p className="welcome__purpose">{COPY.welcomePurpose}</p>
        </div>

        <div className="welcome__cards">
          {templates.map((t, i) => (
            <TemplateCard key={t.id} template={t} autoFocus={i === 0} onPick={() => onPickTemplate(t)} />
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <Button variant="ghost" onClick={onEmptyFolder}>
            {COPY.welcomeEmptyFolder}
          </Button>

          <div className="note note--warn">
            <p className="note__text">{COPY.welcomeFirstRunNote}</p>
          </div>
        </div>

        <p className="welcome__footer">
          {COPY.storageLocal}{' '}
          <button type="button" onClick={onImportZip} className="link">
            {COPY.welcomeImport}
          </button>
        </p>
      </div>
    </div>
  )
}

/**
 * The whole card is one 88px+ target — no nested buttons. Its 1px
 * --border-control edge does the work of separating it from the page, since
 * surface-3 on surface-0 is only ~1.1:1 and invisible on a phone.
 */
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
    <button type="button" autoFocus={autoFocus} onClick={onPick} className="template-card">
      <span className="template-card__head">
        <LangBadge lang={template.lang} />
        <span className="template-card__title">{template.name}</span>
        <IconArrowRight className="template-card__go" size={18} />
      </span>
      <span className="template-card__blurb">{template.blurb}</span>
      <span className="template-card__manifest">
        {count} files · {template.entry}
      </span>
    </button>
  )
}
