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
 * Which file Run actually starts: the chosen entry while it is still a
 * candidate, otherwise the best candidate. Exported because the console
 * header's entry picker and the tab-strip Run must not answer this question
 * differently.
 */
export function resolveEntry(entryPath: string | null, candidates: string[]): string | null {
  return entryPath && candidates.includes(entryPath) ? entryPath : (candidates[0] ?? null)
}

/**
 * Run/Stop — ONE control with ONE home: the tab strip's trailing group,
 * VS Code's editor-actions corner, at every size and pointer (one shell,
 * founder ruling). The old title-bar placement is deleted with the layout
 * fork that needed it; `console` survives only while RunBar still mounts it
 * and goes when that mount does. Every placement takes the same
 * `RunControlState`, so there is no second copy of "is it busy" to drift.
 *
 * The placements differ in exactly one respect, and it is deliberate: the
 * console control's accessible name is the frozen contract string ("Run" /
 * "Stop", ARCHITECTURE §4), so the tab-strip control names the file instead
 * ("Run main.py"). Two buttons answering to the same exact name would make
 * every `getByRole('button', { name: 'Run', exact: true })` in tools/qa
 * ambiguous, and naming the file is the better label for a screen reader
 * anyway.
 */
export function RunControl({
  run,
  placement,
  iconOnly = false,
  className = '',
}: {
  run: RunControlState
  /**
   * `tabs` is VS Code's editor-actions corner — the tab strip's trailing
   * group, Run's one home — always compact icon-only, and it names the file
   * (never the bare contract strings "Run"/"Stop", which belong to the
   * console copy).
   */
  placement: 'console' | 'tabs'
  /**
   * The fine-pointer console header renders Run as a VSCode-style toolbar
   * glyph — a quiet button, play in --success / stop in --danger — because
   * the tab strip already carries Run one bar above and two filled primaries
   * stacked in one corner read as a mistake. Same state, same contract
   * aria-label; only the clothes change.
   */
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
      // Exactly "Run" or "Stop" in the console, never a variation: this is a
      // contract-level test selector (ARCHITECTURE §4), and during `preparing`
      // the visible label reads "Preparing…" while the control's action is still
      // Stop — so the nuance goes in the tooltip, where nothing depends on it.
      aria-label={placement === 'console' ? (busy ? 'Stop' : 'Run') : busy ? `Stop ${what}` : `Run ${what}`}
      title={
        preparing
          ? `Stop getting the language ready (${shortcut})`
          : busy
            ? `Stop the program (${shortcut})`
            : canRun
              ? `Run ${what} (${shortcut})`
              : COPY.noEntry
      }
      // Founder ruling (P1): Run/Stop's height drops from h-11 (44px) to h-10
      // (40px) — carried by --run-h now, so the DENSITY pass compacts it to
      // 28px on a fine pointer. `!` (a trailing-bang important) because
      // `Button`'s own base sets `min-h-touch` and `min-height` always wins
      // its own conflict regardless of which utility comes later in the class
      // list, so a plain `min-h-run-h` here would be silently overridden.
      // `relative` + the `after:` pseudo restore a ≥44px effective hit area
      // the same way `IconButton` does — Run/Stop is the single most-tapped
      // control in the app (spec principle 4), so it is the last place to give
      // up touch room even though its box shrank.
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
      {/* Spec §7.4 asks for a 16px spinner in the glyph slot while the engine
          loads. The label reports the phase; the control keeps its Stop role
          rather than going disabled, because it is the only way to abort a
          40 MB download and COPY.runtimeVerySlow tells students to use it. */}
      {preparing ? (
        <span className="size-4 flex-none rounded-pill border-2 border-[color-mix(in_srgb,currentColor_30%,transparent)] border-t-current animate-spinner motion-reduce:animate-none" />
      ) : busy ? (
        <IconStop />
      ) : (
        <IconPlay />
      )}
      {iconOnly ? null : preparing ? 'Preparing…' : busy ? 'Stop' : 'Run'}
    </Button>
  )
}
