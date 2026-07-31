import type { RunStatus } from '../hooks/useRunner'
import { Button, IconButton } from './ui/Button'
import { StatusPill } from './StatusPill'

export interface RunBarProps {
  status: RunStatus
  exitCode: number | null
  busy: boolean
  /** Entry-point candidates; the picker only appears when there are 2+. */
  candidates: string[]
  entryPath: string | null
  consoleOpen: boolean
  canRun: boolean
  onEntryChange(path: string): void
  onRun(): void
  onStop(): void
  onClear(): void
  onToggleConsole(): void
}

/**
 * The console header — and the home of Run/Stop (spec §5.3).
 *
 * Not the top-right: on a tablet held in two hands that is the least reachable
 * corner. Here the control sits in the bottom third (thumb territory), is part
 * of the layout so it can never overlap code, and rides up with --kb-inset when
 * the keyboard opens. It is ONE button that swaps role rather than a Run beside
 * a disabled Stop. `html[data-hand="left"]` mirrors the row for left-handers.
 */
export function RunBar(props: RunBarProps) {
  const { status, exitCode, busy, candidates, entryPath, consoleOpen, canRun } = props

  return (
    <div className="console-header flex h-bar shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-2 px-2">
      {/* Run/Stop — first in DOM order so it is the first tab stop and so
          data-hand="left" (row-reverse) puts it on the leading edge. */}
      <Button
        variant={busy ? 'stop' : 'primary'}
        large
        data-state={status}
        disabled={!busy && !canRun}
        onClick={busy ? props.onStop : props.onRun}
      >
        <span aria-hidden="true" className="text-[12px]">
          {busy ? '■' : '▶'}
        </span>
        {busy ? 'Stop' : 'Run'}
      </Button>

      <StatusPill status={status} exitCode={exitCode} />

      <div className="ml-auto flex min-w-0 items-center gap-1">
        {candidates.length > 1 ? (
          <label className="flex min-w-0 items-center gap-1">
            <span className="kb-hide shrink-0 text-micro uppercase tracking-wider text-text-3">Start</span>
            <select
              value={entryPath ?? candidates[0]}
              onChange={(e) => props.onEntryChange(e.target.value)}
              aria-label="File to run"
              className="tap min-h-touch min-w-0 max-w-[40vw] truncate rounded-sm border border-border-control bg-surface-4 px-2 font-code text-meta text-text-1"
            >
              {candidates.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <Button variant="ghost" onClick={props.onClear} className="kb-hide">
          Clear
        </Button>

        <IconButton
          label={consoleOpen ? 'Hide output' : 'Show output'}
          aria-expanded={consoleOpen}
          onClick={props.onToggleConsole}
        >
          {consoleOpen ? '⌄' : '⌃'}
        </IconButton>
      </div>
    </div>
  )
}
