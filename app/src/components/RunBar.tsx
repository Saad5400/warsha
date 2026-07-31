import type { RunStatus } from '../hooks/useRunner'
import { Button, IconButton } from './ui/Button'
import { IconChevronDown, IconChevronUp, IconClear, IconPlay, IconStop } from './ui/Icons'
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
  const preparing = status === 'preparing'

  return (
    <div className="console-header">
      {/* Run/Stop — first in DOM order so it is the first tab stop and so
          data-hand="left" (row-reverse) puts it on the leading edge. */}
      <Button
        variant={busy ? 'stop' : 'primary'}
        large
        data-state={status}
        disabled={!busy && !canRun}
        aria-pressed={busy}
        aria-label={preparing ? 'Stop preparing' : busy ? 'Stop' : 'Run'}
        onClick={busy ? props.onStop : props.onRun}
      >
        {/* Spec §7.4 asks for a 16px spinner in the glyph slot while the engine
            loads. The label reports the phase; the control keeps its Stop role
            rather than going disabled, because it is the only way to abort a
            40 MB download and COPY.runtimeVerySlow tells students to use it. */}
        {preparing ? <span className="spinner" /> : busy ? <IconStop /> : <IconPlay />}
        {preparing ? 'Preparing…' : busy ? 'Stop' : 'Run'}
      </Button>

      <StatusPill status={status} exitCode={exitCode} />

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {candidates.length > 1 ? (
          <label className="flex min-w-0 items-center gap-2">
            <span className="panel-label kb-hide shrink-0">Start</span>
            <select
              value={entryPath ?? candidates[0]}
              onChange={(e) => props.onEntryChange(e.target.value)}
              aria-label="File to run"
              className="field truncate"
            >
              {candidates.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <span aria-hidden="true" className="console-header__rule kb-hide" />

        {/* Keyboard open: the label goes, the icon and the 44px box stay
            (spec §4.3 rule 3 — collapse decoration, never function). */}
        <Button variant="quiet" onClick={props.onClear} aria-label="Clear output">
          <IconClear />
          <span className="kb-hide">Clear</span>
        </Button>

        <IconButton
          label={consoleOpen ? 'Hide output' : 'Show output'}
          aria-expanded={consoleOpen}
          onClick={props.onToggleConsole}
        >
          {consoleOpen ? <IconChevronDown /> : <IconChevronUp />}
        </IconButton>
      </div>
    </div>
  )
}
