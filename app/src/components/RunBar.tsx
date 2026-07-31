import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '../hooks/useRunner'
import { useMedia } from '../hooks/useMedia'
import { activeBuffer } from '../console/buffer'
import { runShortcutLabel } from '../ui/shortcut'
import { Button, IconButton } from './ui/Button'
import { IconChevronDown, IconChevronUp, IconClear, IconPlay, IconStop } from './ui/Icons'
import { StatusPill } from './StatusPill'
import { COPY } from '../copy'

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
 *
 * Language is per file, never per page: Run always starts the project's entry
 * point, and the picker beside it says which file that is. There is no "Python
 * mode" to be in.
 */
export function RunBar(props: RunBarProps) {
  const { status, exitCode, busy, candidates, entryPath, consoleOpen, canRun } = props
  const preparing = status === 'preparing'
  const narrow = useMedia('(max-width: 899px)')
  const shortcut = runShortcutLabel()
  const entry = entryPath && candidates.includes(entryPath) ? entryPath : (candidates[0] ?? null)

  return (
    <div className="console-header">
      {/* Run/Stop — first in DOM order so it is the first tab stop and so
          data-hand="left" (row-reverse) puts it on the leading edge. 44px, not
          the spec's 48px: the header itself is --bar-console (44px), and a 48px
          button inside it overflows its own bar top and bottom. */}
      <Button
        variant={busy ? 'stop' : 'primary'}
        data-state={status}
        disabled={!busy && !canRun}
        aria-pressed={busy}
        aria-label={preparing ? 'Stop preparing' : busy ? 'Stop' : 'Run'}
        title={
          busy
            ? `Stop the program (${shortcut})`
            : canRun
              ? `Run ${entry ?? 'your code'} (${shortcut})`
              : COPY.noEntry
        }
        className="min-w-[104px]"
        onClick={busy ? props.onStop : props.onRun}
      >
        {/* Spec §7.4 asks for a 16px spinner in the glyph slot while the engine
            loads. The label reports the phase; the control keeps its Stop role
            rather than going disabled, because it is the only way to abort a
            40 MB download and COPY.runtimeVerySlow tells students to use it. */}
        {preparing ? <span className="spinner" /> : busy ? <IconStop /> : <IconPlay />}
        {preparing ? 'Preparing…' : busy ? 'Stop' : 'Run'}
      </Button>

      {/* What Run will start. Two candidates or more and it is a picker; one and
          it is a label, because a select with a single option is a lie. Either
          way it carries the amber leading rule, which is what ties it to the
          amber Run button beside it instead of looking bolted on. */}
      {candidates.length > 1 ? (
        <div className="relative flex min-w-0 items-center">
          <select
            value={entry ?? ''}
            onChange={(e) => props.onEntryChange(e.target.value)}
            aria-label="File to run"
            title="Choose which file Run starts"
            className="field min-w-0 appearance-none truncate border-l-2 border-l-accent pr-7 pl-2"
          >
            {candidates.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <IconChevronDown
            size={16}
            className="pointer-events-none absolute right-2 text-text-3"
          />
        </div>
      ) : entry ? (
        <span
          title={`Run starts ${entry}`}
          className="hidden min-w-0 max-w-[26ch] truncate border-l-2 border-l-accent pl-2 font-code text-meta text-text-2 min-[900px]:block"
        >
          {entry}
        </span>
      ) : null}

      {/* Five controls do not fit 390px, and squeezing them is how buttons end up
          under 44px and labels end up clipped. On a phone with the console open,
          the status *line* above the input row carries the same glyph and word in
          the same tone, one line further down — so the pill stands down there and
          comes back the moment the console is collapsed and the line is gone. */}
      {!narrow || !consoleOpen ? <StatusPill status={status} exitCode={exitCode} /> : null}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* Transcript actions only while there is a transcript on screen. */}
        {consoleOpen ? (
          <>
            <span aria-hidden="true" className="console-header__rule kb-hide" />
            <CopyOutputButton />
            {/* Keyboard open: the label goes, the icon and the 44px box stay
                (spec §4.3 rule 3 — collapse decoration, never function). */}
            <Button
              variant="quiet"
              onClick={props.onClear}
              aria-label={COPY.clearOutput}
              title={COPY.clearOutput}
              // The ≤460px rule tightens .console-header .btn padding to 8px,
              // which takes an icon-only button down to 38px wide. Height was
              // never the problem; the box is the target, so floor the width.
              className="min-w-touch shrink-0"
            >
              <IconClear />
              <span className="kb-hide hidden min-[900px]:inline">Clear</span>
            </Button>
          </>
        ) : null}

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

/**
 * "Copy output" (ACCEPTANCE §10.10 — *"I want to send my error to my friend"*).
 *
 * Confirms on the button itself rather than through a toast: the toast would
 * cover the console it just copied, and a control that reports its own result is
 * one less thing to look for.
 */
function CopyOutputButton() {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    const text = activeBuffer()?.toText() ?? ''
    window.clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(text)
      setState('done')
    } catch {
      // Clipboard permission is deniable and the API is absent on insecure
      // origins; say so rather than pretending it worked.
      setState('failed')
    }
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }

  const label = state === 'done' ? COPY.copyOutputDone : state === 'failed' ? COPY.copyOutputFailed : COPY.copyOutput
  return (
    <Button
      variant="quiet"
      onClick={() => void copy()}
      aria-label={label}
      title={label}
      data-state={state}
      // The result has to be visible, not only in the tooltip: a copy that
      // silently failed is worse than no button.
      className={
        'min-w-touch shrink-0 ' +
        (state === 'done' ? 'text-success' : state === 'failed' ? 'text-danger' : '')
      }
    >
      {state === 'done' ? <IconCheck /> : <IconCopy />}
      <span className="kb-hide hidden min-[1100px]:inline">{state === 'done' ? COPY.copyOutputDone : 'Copy'}</span>
    </Button>
  )
}

/* Same 20px grid and 1.6px stroke as ui/Icons.tsx; they belong there, and will
   move the moment that file gains a clipboard and a check. */
const IconCopy = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <rect x="7.25" y="7.25" width="9" height="9" rx="1.5" />
    <path d="M12.75 4.75a1.5 1.5 0 0 0-1.5-1.5h-6.5a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 1.5 1.5" />
  </svg>
)

const IconCheck = () => (
  <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </svg>
)
