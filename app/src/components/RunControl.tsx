import type { RunStatus } from '../hooks/useRunner'
import { runShortcutLabel } from '../ui/shortcut'
import { Button } from './ui/Button'
import { IconPlay, IconStop } from './ui/Icons'
import { COPY } from '../copy'

/** Everything the Run/Stop control needs, so both placements read one state. */
export interface RunControlState {
  status: RunStatus
  busy: boolean
  canRun: boolean
  /** The file Run will start — already resolved by `resolveEntry`. */
  entry: string | null
  onRun(): void
  onStop(): void
}

/**
 * Which file Run starts: the chosen entry if still a candidate, else the best one.
 * Exported so the console picker and tab-strip Run never disagree.
 */
export function resolveEntry(entryPath: string | null, candidates: string[]): string | null {
  return entryPath && candidates.includes(entryPath) ? entryPath : (candidates[0] ?? null)
}

/**
 * Run/Stop's one home is the tab strip's trailing group; `console` placement only
 * survives while RunBar still mounts it. Both share `RunControlState` so "busy" never
 * drifts between copies. The console name stays the frozen "Run"/"Stop" contract
 * (ARCHITECTURE §4); tabs names the file instead, so two buttons never share one exact
 * accessible name in tools/qa.
 */
export function RunControl({
  run,
  placement,
  iconOnly = false,
  className = '',
}: {
  run: RunControlState
  /** `tabs`: the tab strip's trailing group, always icon-only, and names the file (not "Run"/"Stop"). */
  placement: 'console' | 'tabs'
  /** Console renders Run as a quiet toolbar glyph, not a filled button — two stacked
   *  primaries above/below would read as a mistake. Same state and aria-label either way. */
  iconOnly?: boolean
  className?: string
}) {
  if (placement === 'tabs') iconOnly = true
  const { status, busy, canRun, entry } = run
  const preparing = status === 'preparing'
  const shortcut = runShortcutLabel()
  const what = entry ?? 'your code'

  return (
    <Button
      variant={iconOnly ? 'quiet' : busy ? 'stop' : 'primary'}
      data-state={status}
      disabled={!busy && !canRun}
      aria-pressed={busy}
      // Console's aria-label is exactly "Run"/"Stop" (ARCHITECTURE §4 contract) even while
      // `preparing` shows "Preparing…" visibly — the nuance lives only in the tooltip.
      aria-label={
        placement === 'console'
          ? busy
            ? COPY.stopAction
            : COPY.runAction
          : busy
            ? COPY.stopWhat(what)
            : COPY.runWhat(what)
      }
      title={
        preparing
          ? COPY.runTipStopPreparing(shortcut)
          : busy
            ? COPY.runTipStop(shortcut)
            : canRun
              ? COPY.runTipRun(what, shortcut)
              : COPY.noEntry
      }
      // `!` needed: Button's base min-h-touch always wins a plain utility regardless of class order.
      // `relative` + `after:` restores a ≥44px hit area (like IconButton) since Run/Stop is the
      // single most-tapped control in the app — the last place to give up touch room.
      className={
        (iconOnly
          ? 'min-w-icon-btn w-icon-btn px-0! ' +
            (busy ? 'text-danger ' : canRun ? 'text-success ' : '')
          : 'min-w-run-minw ') +
        'min-h-run-h! relative after:absolute after:-inset-1 after:content-[""]' +
        (className ? ' ' + className : '')
      }
      onClick={busy ? run.onStop : run.onRun}
    >
      {/* Stays a Stop control (never disabled) while preparing: it's the only way to abort
          a 40MB download, and COPY.runtimeVerySlow tells students to use it. */}
      {preparing ? (
        <span className="size-4 flex-none rounded-pill border-2 border-[color-mix(in_srgb,currentColor_30%,transparent)] border-t-current animate-spinner motion-reduce:animate-none" />
      ) : busy ? (
        <IconStop />
      ) : (
        <IconPlay />
      )}
      {iconOnly ? null : preparing ? COPY.runPreparing : busy ? COPY.stopAction : COPY.runAction}
    </Button>
  )
}
