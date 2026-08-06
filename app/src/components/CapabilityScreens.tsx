import { useState } from 'react'
import type { CapabilityReport } from '../capabilities'
import { Button } from './ui/Button'
import { LogoLockup } from './Logo'
import { COPY } from '../copy'

/**
 * The sentence for a failed check, by id.
 *
 * The check in capabilities.ts answers a boolean and carries no prose, so the
 * report can be built at boot — before a locale is even resolved — and still
 * read in whichever language is active when it is finally rendered. Adding a
 * check means adding a case; the fallthrough is silent on purpose, because a
 * blank line is better than an English one on an Arabic screen.
 */
function capabilityMessage(id: string): string {
  switch (id) {
    case 'wasm':
      return COPY.capWasm
    case 'workers':
      return COPY.capWorkers
    case 'opfs':
      return COPY.capOpfs
    case 'isolation':
      return COPY.capIsolation
    default:
      return ''
  }
}

/**
 * Shown instead of the IDE when a hard requirement is missing, so a student
 * never sits in front of a spinner that will never finish. Plain English, what
 * still works, and a concrete suggestion.
 */
export function CapabilityFatalScreen({ report }: { report: CapabilityReport }) {
  return (
    <div className="scroller fixed inset-0 bg-surface-0">
      <div className="mx-auto flex w-full max-w-[30rem] flex-col gap-4 p-5">
        <LogoLockup />

        <h1 className="text-dlg-title font-semibold text-text-1">{COPY.capabilityTitle}</h1>

        <div className="border-s-[3px] border-danger bg-danger-soft p-3">
          <ul className="flex flex-col gap-2">
            {report.fatal.map((c) => (
              <li key={c.id} className="text-meta leading-normal text-danger">
                {capabilityMessage(c.id)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-btn font-semibold text-text-1">{COPY.capabilityStillDo}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {COPY.capStillWorks.map((s) => (
              <li key={s} className="text-meta text-text-2">
                • {s}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-btn font-semibold text-text-1">{COPY.capabilityWhatToTry}</p>
          <p className="mt-1 text-meta leading-normal text-text-2">
            {COPY.capabilityTryBody}
          </p>
        </div>

        <Button variant="ghost" large onClick={() => window.location.reload()}>
          {COPY.capabilityReload}
        </Button>
      </div>
    </div>
  )
}

/** Non-blocking: the IDE works, one part of it might not. */
export function CapabilityBanner({ report }: { report: CapabilityReport }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || report.warnings.length === 0) return null

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-border-subtle border-s-[3px] border-s-warn bg-surface-2 px-panel py-2"
    >
      <div className="min-w-0 flex-1">
        {report.warnings.map((c) => (
          <p key={c.id} className="text-meta leading-normal text-text-2">
            {capabilityMessage(c.id)}
          </p>
        ))}
      </div>
      <Button variant="quiet" onClick={() => setDismissed(true)} aria-label={COPY.a11yDismiss}>
        ✕
      </Button>
    </div>
  )
}
