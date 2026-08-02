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
 * candidate, otherwise the best candidate. Exported because the console header
 * and the title bar must not answer this question differently.
 */
export function resolveEntry(entryPath: string | null, candidates: string[]): string | null {
  return entryPath && candidates.includes(entryPath) ? entryPath : (candidates[0] ?? null)
}

/**
 * Run/Stop — ONE control, rendered in two places (LAYOUT-VSCODE §4).
 *
 * `console` is the original home from DESIGN-SPEC §5.3: bottom third, thumb
 * territory, riding up with the keyboard. `title` is VSCode's play-button corner,
 * added at ≥900px where reach is not the constraint. Both take the same
 * `RunControlState`, so there is no second copy of "is it busy" to drift.
 *
 * The two differ in exactly one respect, and it is deliberate: the console
 * control's accessible name is the frozen contract string ("Run" / "Stop",
 * ARCHITECTURE §4), so the title-bar twin names the file instead
 * ("Run main.py"). Two buttons answering to the same exact name would make every
 * `getByRole('button', { name: 'Run', exact: true })` in tools/qa ambiguous, and
 * naming the file is the better label for a screen reader anyway.
 */
export function RunControl({
  run,
  placement,
  className = '',
}: {
  run: RunControlState
  placement: 'console' | 'title'
  className?: string
}) {
  const { status, busy, canRun, entry } = run
  const preparing = status === 'preparing'
  const shortcut = runShortcutLabel()
  const what = entry ?? 'your code'

  return (
    <Button
      variant={busy ? 'stop' : 'primary'}
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
      className={'min-w-[104px]' + (className ? ' ' + className : '')}
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
      {preparing ? 'Preparing…' : busy ? 'Stop' : 'Run'}
    </Button>
  )
}
