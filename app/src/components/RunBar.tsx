import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '../hooks/useRunner'
import { useMedia } from '../hooks/useMedia'
import { activeBuffer } from '../console/buffer'
import { Button, IconButton } from './ui/Button'
import { IconChevronDown, IconChevronUp, IconClear } from './ui/Icons'
import { RunControl, resolveEntry, type RunControlState } from './RunControl'
import { StatusPill } from './StatusPill'
import { COPY } from '../copy'

/* The console header. Its divider is an inset shadow, not a border: a 1px
 * border comes out of the bar's own height, and a flush control inside it
 * then overflows by a pixel — which once pushed Run under the keyboard line.
 * `hand-left` mirrors the row so left-handed students get Run/Stop on the
 * leading edge (spec §5.3). At ≤460px only decoration goes: the inter-control
 * gap tightens and the group divider hides, which is what keeps the collapse
 * control on screen on a 360px phone.
 *
 * `h-bar-console` is 44px below 900px and 52px at and above it (index.css) —
 * PIXEL-FINDINGS F-12: this header held the SAME 0px-clearance defect the
 * title bar was fixed for (a 44px Run flush in a 44px bar, its 10px radius
 * running into the divider). Scoped to ≥900px, unlike the title bar's fix,
 * because this Run is on screen at every width and a phone console has no
 * vertical budget to spare for it (§4.3 rule 4's floor is "the single most
 * important number" in that section). Founder ruling since shrank Run itself
 * to 40px throughout (RunControl.tsx) — the bar did not follow it down; a 40px
 * control in a 52px bar is 6px of clearance a side rather than 4, which reads
 * fine (crops in the PR), and the phone-width 44px bar now holds a 40px
 * control with 2px a side instead of 0. */
/* `console-header` carries no styling — tools/qa reads it. */
const HEADER =
  'console-header flex items-center gap-2 max-[460px]:gap-1 flex-none h-bar-console bg-surface-2 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] hand-left:flex-row-reverse ' +
  'pl-[max(var(--sp-2),env(safe-area-inset-left))] pr-[max(var(--sp-2),env(safe-area-inset-right))]'

export interface RunBarProps {
  status: RunStatus
  exitCode: number | null
  busy: boolean
  /** Entry-point candidates; the picker only appears when there are 2+. */
  candidates: string[]
  entryPath: string | null
  consoleOpen: boolean
  canRun: boolean
  /** A web project has a preview surface; the pane then offers Preview | Console. */
  previewActive?: boolean
  /** Which face the output pane is showing. Only meaningful when previewActive. */
  view?: OutputView
  onView?(view: OutputView): void
  onEntryChange(path: string): void
  onRun(): void
  onStop(): void
  onClear(): void
  onToggleConsole(): void
}

export type OutputView = 'preview' | 'console'

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
  const { status, exitCode, busy, candidates, entryPath, consoleOpen, canRun, previewActive, view } = props
  const narrow = useMedia('(max-width: 899px)')
  const entry = resolveEntry(entryPath, candidates)
  const run: RunControlState = { status, busy, canRun, entry, onRun: props.onRun, onStop: props.onStop }
  // Copy/Clear act on the transcript, so they belong to the Console face only.
  // For a web project showing the Preview, there is no transcript on screen.
  const showTranscriptActions = consoleOpen && (!previewActive || view === 'console')

  return (
    <div className={HEADER}>
      {/* Run/Stop — first in DOM order so it is the first tab stop and so
          data-hand="left" (row-reverse) puts it on the leading edge. 40px
          (founder ruling) at every width, never the spec's 48px: a 48px button
          would overflow the 44px phone-width bar, and 40px stays consistent
          with the title bar's copy of the same control above 900px rather than
          being a second size to keep in sync (see F-12 above for why the
          header itself grows to 52px there instead).
          The title bar renders the same control at ≥900px; see RunControl. */}
      <RunControl run={run} placement="console" />

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

      {/* A web project shows a live page and a log; this switches the pane
          between them. Only appears when there is a preview to show — a
          Java/Python run has no second face and never renders it. */}
      {previewActive && consoleOpen && view ? (
        <ViewToggle view={view} onView={props.onView} />
      ) : null}

      {/* Five controls do not fit 390px, and squeezing them is how buttons end up
          under 44px and labels end up clipped. On a phone with the console open,
          the status *line* above the input row carries the same glyph and word in
          the same tone, one line further down — so the pill stands down there and
          comes back the moment the console is collapsed and the line is gone.
          Preview showing: no status line under it, so keep the pill. */}
      {!narrow || !consoleOpen || (previewActive && view === 'preview') ? (
        <StatusPill status={status} exitCode={exitCode} />
      ) : null}

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {/* Transcript actions only while there is a transcript on screen. */}
        {showTranscriptActions ? (
          <>
            {/* A hairline before the trailing controls, so a wide header reads
                as a deliberate toolbar with two groups rather than two things
                and a void. */}
            <span aria-hidden="true" className="kb-hide w-px h-[24px] flex-none mx-1 bg-border-subtle max-[460px]:hidden" />
            <CopyOutputButton />
            {/* Keyboard open: the label goes, the icon and the box stay
                (spec §4.3 rule 3 — collapse decoration, never function). */}
            <Button
              variant="quiet"
              onClick={props.onClear}
              aria-label={COPY.clearOutput}
              title={COPY.clearOutput}
              // The ≤460px rule tightens .console-header .btn padding to 8px,
              // which takes an icon-only button down to 38px wide. Height was
              // never the problem; the box is the target, so floor the width.
              // min-h-10!: founder ruling, same override RunControl needs and
              // for the same reason — `min-h-touch` in Button's base always
              // wins a plain `min-h-10` regardless of class order. The after:
              // pseudo restores the ≥44px hit area into this row's gap-2.
              className="min-w-touch shrink-0 min-h-10! relative after:absolute after:-inset-1 after:content-['']"
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
 * The Preview / Console switch for a web project. A two-segment control, sized
 * so its buttons keep a 40px hit area (the after: pseudo restores it into the
 * row's gap) while the visible chrome stays compact enough for a 390px header.
 * The selected segment carries a fill *and* an accent underline — never colour
 * alone, per Design's rule that adjacent surfaces are invisible on a phone.
 */
function ViewToggle({ view, onView }: { view: OutputView; onView?: (v: OutputView) => void }) {
  const segment = (v: OutputView, label: string) => {
    const selected = view === v
    return (
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        onClick={() => onView?.(v)}
        className={
          "relative flex-none min-h-8 px-2.5 font-ui text-micro font-semibold touch-manipulation " +
          "after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] " +
          (selected
            ? 'bg-surface-4 text-text-1 shadow-[inset_0_-2px_0_0_var(--accent)]'
            : 'text-text-3 hover:text-text-2')
        }
      >
        {label}
      </button>
    )
  }
  return (
    <div
      role="tablist"
      aria-label="Output view"
      className="flex flex-none items-center overflow-hidden rounded-md border border-border-control bg-surface-2"
    >
      {segment('preview', COPY.viewPreview)}
      {segment('console', COPY.viewConsole)}
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
      // silently failed is worse than no button. min-h-10!/after: — see Clear,
      // above: same founder-ruling override, same reason.
      className={
        "min-w-touch shrink-0 min-h-10! relative after:absolute after:-inset-1 after:content-[''] " +
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
