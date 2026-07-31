import { useState } from 'react'
import type { CapabilityReport } from '../capabilities'
import { stillWorks } from '../capabilities'
import { Button } from './ui/Button'
import { LogoLockup } from './Logo'

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

        <h1 className="text-dlg-title font-semibold text-text-1">Warsha cannot run in this browser</h1>

        <div className="border-l-[3px] border-danger bg-danger-soft p-3">
          <ul className="flex flex-col gap-2">
            {report.fatal.map((c) => (
              <li key={c.id} className="text-meta leading-normal text-danger">
                {c.message}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-btn font-semibold text-text-1">What you can still do here</p>
          <ul className="mt-1 flex flex-col gap-1">
            {stillWorks.map((s) => (
              <li key={s} className="text-meta text-text-2">
                • {s}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-btn font-semibold text-text-1">What to try</p>
          <p className="mt-1 text-meta leading-normal text-text-2">
            Open Warsha in Chrome on an Android phone or tablet, or in Chrome, Edge or Safari on a computer. Those can
            run Java and Python.
          </p>
        </div>

        <Button variant="ghost" large onClick={() => window.location.reload()}>
          Reload and check again
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
      className="flex shrink-0 items-start gap-2 border-b border-border-subtle border-l-[3px] border-l-warn bg-surface-2 px-panel py-2"
    >
      <div className="min-w-0 flex-1">
        {report.warnings.map((c) => (
          <p key={c.id} className="text-meta leading-normal text-text-2">
            {c.message}
          </p>
        ))}
      </div>
      <Button variant="quiet" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ✕
      </Button>
    </div>
  )
}
