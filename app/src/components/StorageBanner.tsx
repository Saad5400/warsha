import { useState } from 'react'
import { COPY } from '../copy'
import type { StorageProblem } from '../fs/health'
import type { MigrationOutcome } from '../fs/projects'

export interface StorageBannerProps {
  /** Set while writes are failing. */
  problem: StorageProblem | null
  /** True when the origin is close to its quota. */
  quotaTight: boolean
  /** False while another tab holds the primary lock. Advisory only. */
  isPrimaryTab: boolean
  /** Used for the two one-off storage outcomes: memory-only, and eviction. */
  migration: MigrationOutcome | null
  onExportZip(): void
}

/* Same anatomy as `.note` — a 3px leading rule — because it is the same kind of
 * statement, but a full-width strip rather than an inset card: it must survive
 * being ignored, and an inset card above the tab strip reads as decoration. */
/* `storage-banner` carries no styling — tools/qa reads it with [data-notice]. */
const BANNER =
  'storage-banner flex shrink-0 items-start gap-2 px-panel py-2 border-b border-b-border-subtle ' +
  'border-l-[3px] border-l-warn bg-surface-2 ' +
  'data-[tone=danger]:border-l-danger data-[tone=danger]:bg-danger-soft'

const BANNER_BTN =
  'inline-flex shrink-0 items-center justify-center min-h-touch rounded-sm font-ui text-meta text-text-2 ' +
  'cursor-pointer touch-manipulation hover:bg-surface-4 hover:text-text-1'

type Tone = 'danger' | 'warn'
interface Notice {
  id: string
  tone: Tone
  title: string
  hint: string
  /** Whether the export shortcut belongs on this notice. */
  offerExport: boolean
  /** Advisories can be dismissed; "your work is not being saved" cannot. */
  dismissible: boolean
}

/**
 * The persistent storage warning strip.
 *
 * Everything here is a **standing condition**, which is exactly why none of it
 * is a toast. A student whose writes are failing needs the message to still be
 * on screen in ten minutes, when they decide to close the tab — a toast that
 * appeared once, while they were reading their code, is the same as no warning
 * at all, and the work is gone.
 *
 * Priority is by cost of ignoring it: writes failing right now, then a browser
 * that cannot save at all, then a quota about to be hit, then the two advisories
 * (a project that vanished, another tab). Only the worst one is shown — stacking
 * four strips above the editor on a 390px phone costs more than it explains.
 */
export function StorageBanner({
  problem,
  quotaTight,
  isPrimaryTab,
  migration,
  onExportZip,
}: StorageBannerProps) {
  const [dismissed, setDismissed] = useState<string[]>([])

  const notices: Notice[] = []

  if (problem) {
    notices.push({
      id: 'write-failed',
      tone: 'danger',
      title: problem.fault === 'quota' ? COPY.storageQuotaTitle : COPY.storageFailedTitle,
      hint: problem.fault === 'quota' ? COPY.storageQuotaHint : COPY.storageFailedHint,
      offerExport: true,
      // Not dismissible on purpose. It clears itself the moment a write
      // succeeds, and until then it is the only thing standing between a
      // student and losing an afternoon.
      dismissible: false,
    })
  }
  if (quotaTight && !problem) {
    notices.push({
      id: 'quota-tight',
      tone: 'warn',
      title: COPY.storageQuotaTitle,
      hint: COPY.storageQuotaHint,
      offerExport: true,
      dismissible: true,
    })
  }
  if (migration?.kind === 'reopened-elsewhere') {
    notices.push({
      id: 'evicted',
      tone: 'warn',
      title: COPY.storageEvictedTitle,
      hint: COPY.storageEvictedHint,
      offerExport: true,
      dismissible: true,
    })
  }
  if (!isPrimaryTab) {
    notices.push({
      id: 'multi-tab',
      tone: 'warn',
      title: COPY.multiTabTitle,
      hint: COPY.multiTabHint,
      offerExport: false,
      dismissible: true,
    })
  }

  const notice = notices.find((n) => !dismissed.includes(n.id))
  if (!notice) return null

  return (
    <div role="status" data-tone={notice.tone} data-notice={notice.id} className={BANNER}>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-ui text-meta leading-normal font-semibold text-text-1">{notice.title}</p>
        <p className="m-0 font-ui text-meta leading-normal text-text-2">{notice.hint}</p>
      </div>
      {notice.offerExport ? (
        <button
          type="button"
          onClick={onExportZip}
          className={BANNER_BTN + ' min-w-touch px-3 border border-border-control bg-surface-3'}
        >
          {COPY.storageExportNow}
        </button>
      ) : null}
      {notice.dismissible ? (
        <button
          type="button"
          onClick={() => setDismissed((cur) => [...cur, notice.id])}
          aria-label="Dismiss"
          className={BANNER_BTN + ' w-touch'}
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}
