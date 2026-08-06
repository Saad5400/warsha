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

// Same anatomy as `.note`, but a full-width strip, not an inset card: it must survive being
// ignored, and a card above the tab strip reads as decoration. `storage-banner` carries no
// styling — tools/qa reads it with [data-notice].
const BANNER =
  'storage-banner flex shrink-0 items-start gap-2 px-panel py-2 border-b border-b-border-subtle ' +
  'border-s-[3px] border-s-warn bg-surface-2 ' +
  'data-[tone=danger]:border-s-danger data-[tone=danger]:bg-danger-soft'

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
 * Persistent storage warning strip. Never a toast — a standing condition (failing writes)
 * needs to still be on screen when the student decides to close the tab ten minutes later.
 * Priority is by cost of ignoring it (failing writes > can't save at all > quota > advisories);
 * only the worst shows, since stacking four strips on a phone costs more than it explains.
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
      // Not dismissible: clears itself on the next successful write.
      dismissible: false,
    })
  }
  if (migration?.kind === 'storage-unavailable') {
    notices.push({
      id: 'memory-only',
      tone: 'danger',
      title: COPY.storageMemoryTitle,
      hint: COPY.storageMemoryHint,
      offerExport: true,
      // Not dismissible: the condition stands for the whole session.
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
          aria-label={COPY.a11yDismiss}
          className={BANNER_BTN + ' w-touch'}
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}
