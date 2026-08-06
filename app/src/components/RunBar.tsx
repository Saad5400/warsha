import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '../hooks/useRunner'
import { activeBuffer } from '../console/buffer'
import { Button, IconButton } from './ui/Button'
import { IconChevronDown, IconChevronUp, IconClear } from './ui/Icons'
import { resolveEntry } from './RunControl'
import { StatusPill } from './StatusPill'
import { COPY } from '../copy'

// One composition at every size; touch only adjusts metrics (--bar-console: 44px vs VS Code's 35px).
// `run-mirrored` flips the row for a left-hander's thumb (spec §5.3); ≤460px tightens gaps to keep
// the collapse control on screen at 360px. `console-header` itself carries no styling — tools/qa reads it.
const HEADER =
  'console-header flex items-center gap-2 max-[460px]:gap-1 flex-none h-bar-console bg-surface-2 ' +
  'run-mirrored:flex-row-reverse ' +
  'pl-[max(var(--sp-2),env(safe-area-inset-left))] pr-[max(var(--sp-2),env(safe-area-inset-right))]'

// --toolbar-hover-bg is shared with MenuBar's title hover (global dedupe). Trailing `!` needed:
// Button's own quiet hover is an equal-specificity utility, and Tailwind picks the layer order.
const TOOLBAR_HOVER = 'desk:hover:not-disabled:bg-toolbar-hover!'

// Active tab's underline is an inset box-shadow, not a border (a border would eat into the header's height).
// min-w-10 + shrink (not flex-none): under pressure the caps truncate via the inner label span's ellipsis
// rather than shoving other controls off a 320px screen.
const CAPS_TAB =
  'relative flex h-full min-w-10 shrink cursor-pointer touch-manipulation items-center px-2 max-[460px]:px-1 font-ui text-[11px] leading-none font-normal uppercase tracking-normal '

// Prevents tap-focus on caps tabs: some engines draw the focus ring on tap, which compounds with
// the active underline into a double line. preventDefault on pointerdown blocks only the focus grab —
// click still fires, and keyboard Tab focus still shows the ring.
const noTapFocus = (e: { preventDefault(): void }) => e.preventDefault()
/* The elidable caps label inside a CAPS_TAB. */
const CAPS_TAB_LABEL = 'min-w-0 truncate'
const CAPS_TAB_ACTIVE = 'text-text-2 shadow-[inset_0_-1px_0_0_var(--panel-tab-active)]'
const CAPS_TAB_IDLE = 'text-text-3 hover:text-text-2'

// Icon-only toolbar button. min-h-run-h needs `!`: Button's base min-h-touch always wins a plain
// utility regardless of class order. Copy/Clear hide below 360px only while the keyboard is open
// (html[data-kb='open']) — the run-state pill joining the row then pushes the collapse chevron off-screen.
const TOOLBAR_BTN =
  "min-w-touch shrink-0 min-h-run-h! relative after:absolute after:-inset-1 after:content-[''] " +
  'max-[359px]:kb-open:hidden ' +
  TOOLBAR_HOVER

export interface RunBarProps {
  /** Drives the keyboard-time status pill; Run itself lives in the tab strip's trailing group (see Tabs.tsx). */
  status: RunStatus
  exitCode: number | null
  /** Entry-point candidates; the picker only appears when there are 2+. */
  candidates: string[]
  entryPath: string | null
  consoleOpen: boolean
  /** A web project has a preview surface; the pane then offers Preview | Console. */
  previewActive?: boolean
  /** Which face the output pane is showing. Only meaningful when previewActive. */
  view?: OutputView
  onView?(view: OutputView): void
  onEntryChange(path: string): void
  onClear(): void
  onToggleConsole(): void
  /** VS Code's Maximize Panel Size chevron. Optional so it never renders as a dead control without a handler. */
  maximized?: boolean
  onToggleMaximize?(): void
}

export type OutputView = 'preview' | 'console'

/**
 * VS Code's panel header: PREVIEW/CONSOLE tabs leading, toolbar trailing. Run/Stop is
 * NOT here — its one home is the tab strip's trailing group. Touch differs by metrics
 * only (44px bar vs 35px), and the run-state pill steps in here while the keyboard
 * hides the status bar.
 */
export function RunBar(props: RunBarProps) {
  const { status, exitCode, candidates, entryPath, consoleOpen, previewActive, view } = props
  const entry = resolveEntry(entryPath, candidates)
  // Copy/Clear belong to the Console face only — a web Preview has no transcript on screen.
  const showTranscriptActions = consoleOpen && (!previewActive || view === 'console')

  // A single candidate renders as a label, not a picker — a select with one option is a lie.
  // min-w-[3.5rem] floor: without it the fixed-width icon buttons squeezed the label down to "m…".
  const entryPicker =
    candidates.length > 1 ? (
      <div className="relative flex min-w-[3.5rem] shrink items-center">
        <select
          value={entry ?? ''}
          onChange={(e) => props.onEntryChange(e.target.value)}
          aria-label={COPY.a11yFileToRun}
          title={COPY.a11yFileToRunHint}
          className="field min-w-0 appearance-none truncate pe-7 ps-2 bg-transparent border-transparent font-ui text-[13px] text-text-2"
        >
          {candidates.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <IconChevronDown
          size={16}
          className="pointer-events-none absolute end-2 text-text-3"
        />
      </div>
    ) : entry ? (
      <span
        title={`Run starts ${entry}`}
        className="min-w-[3.5rem] max-w-[26ch] truncate font-ui text-[13px] text-text-2"
      >
        {entry}
      </span>
    ) : null

  return (
    <div className={HEADER}>
      {/* Script project: a lone always-selected CONSOLE tab. Clicking it while collapsed opens the
          console (VS Code's panel-title behavior); clicking it while already shown is a no-op. */}
      {previewActive ? (
        consoleOpen && view ? <ViewToggle view={view} onView={props.onView} /> : null
      ) : (
        <div role="tablist" aria-label={COPY.a11yOutputView} className="flex min-w-0 shrink items-stretch self-stretch">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            onClick={consoleOpen ? undefined : props.onToggleConsole}
            onPointerDown={noTapFocus}
            className={CAPS_TAB + CAPS_TAB_ACTIVE}
          >
            <span className={CAPS_TAB_LABEL}>{COPY.viewConsole}</span>
          </button>
        </div>
      )}

      {/* Keyboard-time only: the status bar (which shows the same status elsewhere) stands down
          while the keyboard is up, so this pill takes over via CSS visibility (html[data-kb]). */}
      <span className="hidden kb-open:flex min-w-0 items-center">
        <StatusPill status={status} exitCode={exitCode} />
      </span>

      <div className="ms-auto flex min-w-0 items-center gap-2 max-[460px]:gap-1">
        {/* The entry picker — VS Code's panel controls corner. */}
        {entryPicker}
        {/* Transcript actions only while there is a transcript on screen. */}
        {showTranscriptActions ? (
          <>
            <CopyOutputButton />
            <Button
              variant="quiet"
              onClick={props.onClear}
              aria-label={COPY.clearOutput}
              title={COPY.clearOutput}
              className={TOOLBAR_BTN}
            >
              <IconClear />
            </Button>
          </>
        ) : null}

        {/* Maximize/Restore chevron, hidden below 380px — the row overflows there, and divider-drag
            plus collapse still cover its job. QA note: absent under 380px. */}
        {consoleOpen && props.onToggleMaximize ? (
          <IconButton
            // Labels are an ARCHITECTURE §4 contract — must stay "Maximize/Restore output", distinct
            // from the collapse control's own "Hide/Show output" pair.
            label={props.maximized ? COPY.outputRestore : COPY.outputMaximize}
            onClick={props.onToggleMaximize}
            className={TOOLBAR_HOVER + ' max-[379px]:hidden'}
          >
            {props.maximized ? <IconChevronDown /> : <IconChevronUp />}
          </IconButton>
        ) : null}

        <IconButton
          label={consoleOpen ? COPY.outputHide : COPY.outputShow}
          aria-expanded={consoleOpen}
          onClick={props.onToggleConsole}
          className={TOOLBAR_HOVER}
        >
          {consoleOpen ? <IconChevronDown /> : <IconChevronUp />}
        </IconButton>
      </div>
    </div>
  )
}

/**
 * Preview/Console switch, VS Code's panel-title tabs. Uppercasing is CSS-only, so
 * accessible names stay "Preview"/"Console" and the role=tablist contract never changes.
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
        onPointerDown={noTapFocus}
        className={CAPS_TAB + (selected ? CAPS_TAB_ACTIVE : CAPS_TAB_IDLE)}
      >
        <span className={CAPS_TAB_LABEL}>{label}</span>
      </button>
    )
  }
  return (
    <div role="tablist" aria-label={COPY.a11yOutputView} className="flex min-w-0 shrink items-stretch self-stretch gap-1">
      {segment('preview', COPY.viewPreview)}
      {segment('console', COPY.viewConsole)}
    </div>
  )
}

/**
 * "Copy output" (ACCEPTANCE §10.10). Confirms on the button itself, not a toast —
 * a toast would cover the console it just copied.
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
      // Clipboard permission can be denied, and the API is absent on insecure origins.
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
      // Visible in the glyph itself, not just the tooltip — a silent copy failure is worse than no button.
      className={
        TOOLBAR_BTN +
        ' ' +
        (state === 'done' ? 'text-success' : state === 'failed' ? 'text-danger' : '')
      }
    >
      {state === 'done' ? <IconCheck /> : <IconCopy />}
    </Button>
  )
}

// Same 20px/1.6px-stroke grid as ui/Icons.tsx; will move there once it has a clipboard and check glyph.
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
