import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '../hooks/useRunner'
import { activeBuffer } from '../console/buffer'
import { Button, IconButton } from './ui/Button'
import { IconChevronDown, IconChevronUp, IconClear } from './ui/Icons'
import { resolveEntry } from './RunControl'
import { StatusPill } from './StatusPill'
import { COPY } from '../copy'

/* The panel header — ONE composition at every size and pointer (founder ruling:
 * the VS Code desktop shell everywhere, touch gets metric adjustments only).
 * Height rides --bar-console: 44px on touch, VS Code's 35px under DENSITY.
 * No bottom hairline at any density: VS Code draws no rule under a panel
 * title — the panel's own 1px top seam is its one boundary.
 * `hand-left` mirrors the row so the toolbar lands on a left-hander's thumb
 * side (spec §5.3). At ≤460px only decoration goes: the inter-control gap
 * tightens, which is what keeps the collapse control on screen at 360px. */
/* `console-header` carries no styling — tools/qa reads it. */
const HEADER =
  'console-header flex items-center gap-2 max-[460px]:gap-1 flex-none h-bar-console bg-surface-2 ' +
  'hand-left:flex-row-reverse ' +
  'pl-[max(var(--sp-2),env(safe-area-inset-left))] pr-[max(var(--sp-2),env(safe-area-inset-right))]'

/* VS Code's toolbar-icon hover — --toolbar-hover-bg, the ONE token shared with
 * the menu bar's title selection (global dedupe; see MenuBar.tsx). Trailing `!`
 * because Button's own quiet hover (surface-3) is an equal-specificity utility
 * and layer order between the two is Tailwind's to pick, not ours. Hover is
 * desk-scoped; a coarse pointer has no hover to dress. */
const TOOLBAR_HOVER = 'desk:hover:not-disabled:bg-toolbar-hover!'

/* VS Code's panel-title tab voice — 11px caps, no box, normal weight and
 * tracking (the uppercasing alone does the work). The active tab carries a 1px
 * --panel-tab-active bottom rule as an inset shadow (BARS recipe: a border
 * would come out of the header's height). Shared by the web pair below and the
 * lone CONSOLE tab, so both read as one system. The tabs stretch the full bar
 * height, so on touch they are 44px targets with no extra dress.
 * Overflow (founder pass 2026-08-05): min-w-10 floor + shrink instead of
 * flex-none — when the trailing toolbar needs the room the caps truncate
 * (the label span inside carries the ellipsis; a flex button clips its own
 * anonymous text box instead of eliding it) rather than shoving controls off
 * the 320px edge. px tightens with the header's ≤460px step. */
const CAPS_TAB =
  'relative flex h-full min-w-10 shrink cursor-pointer touch-manipulation items-center px-2 max-[460px]:px-1 font-ui text-[11px] leading-none font-normal uppercase tracking-normal '

/* A tap must not leave focus parked on a caps tab. Engines that treat a
 * tap-focused control as :focus-visible draw the global 1px --focus-ring box
 * around it, and on the active tab that ring compounds with the blue
 * --panel-tab-active underline into a "blue line under AND beside the label"
 * (founder phone screenshot, 2026-08-05). Cancelling pointerdown's default
 * prevents only the focus grab — click still fires per the Pointer Events
 * spec, and keyboard focus (Tab) still lands and shows the ring. VS Code's
 * own panel-title tabs behave the same way: click acts, focus stays put. */
const noTapFocus = (e: { preventDefault(): void }) => e.preventDefault()
/* The elidable caps label inside a CAPS_TAB. */
const CAPS_TAB_LABEL = 'min-w-0 truncate'
const CAPS_TAB_ACTIVE = 'text-text-2 shadow-[inset_0_-1px_0_0_var(--panel-tab-active)]'
const CAPS_TAB_IDLE = 'text-text-3 hover:text-text-2'

/* The toolbar-button recipe: icon-only, VS Code's quiet glyph. The visual box
 * is min-w-touch × min-h-run-h (44×40 touch, 28×28 desk); the after: pseudo
 * restores a ≥44px hit area into the row's gap on touch. min-h-run-h!: founder
 * ruling — `min-h-touch` in Button's base always wins a plain min-h utility
 * regardless of class order, so the override has to be important.
 * max-[359px]:kb-open:hidden — the row sums under 320px at rest, but while the
 * software keyboard is up the run-state pill joins it and the rigid cluster
 * pushed the collapse chevron 9px off a 320px screen (probe 2026-08-05).
 * Copy/Clear are the pair whose job least survives that moment — they act on a
 * transcript the keyboard is covering — so they step out below 360px until the
 * keyboard closes. QA note: Copy/Clear are absent under 360px ONLY while
 * html[data-kb='open']. */
const TOOLBAR_BTN =
  "min-w-touch shrink-0 min-h-run-h! relative after:absolute after:-inset-1 after:content-[''] " +
  'max-[359px]:kb-open:hidden ' +
  TOOLBAR_HOVER

export interface RunBarProps {
  /** Drives the header's keyboard-time status pill; Run itself lives in the
   *  tab strip's trailing group (its ONE home — see Tabs.tsx). */
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
  /** VS Code's "Maximize Panel Size" chevron. Optional so the button never
   *  renders when App withholds the handler — never a dead control. */
  maximized?: boolean
  onToggleMaximize?(): void
}

export type OutputView = 'preview' | 'console'

/**
 * The panel header (VS Code's, at every size): caps PREVIEW/CONSOLE tabs on
 * the leading edge, then the toolbar — entry picker, Copy, Clear,
 * Maximize/Restore, collapse — trailing, exactly where VS Code puts a panel's
 * controls. Run/Stop is NOT here: its one home is the tab strip's trailing
 * group (founder ruling — one layout, one Run).
 *
 * Touch differs by metrics only: the bar is 44px instead of 35px
 * (--bar-console), the toolbar buttons keep ≥44px hit areas via the after:
 * pseudo recipe, and while the software keyboard hides the status bar the
 * run-state pill steps back in here so "waiting for you" is never off screen.
 *
 * Language is per file, never per page: Run always starts the project's entry
 * point, and the picker in the toolbar says which file that is. There is no
 * "Python mode" to be in.
 */
export function RunBar(props: RunBarProps) {
  const { status, exitCode, candidates, entryPath, consoleOpen, previewActive, view } = props
  const entry = resolveEntry(entryPath, candidates)
  // Copy/Clear act on the transcript, so they belong to the Console face only.
  // For a web project showing the Preview, there is no transcript on screen.
  const showTranscriptActions = consoleOpen && (!previewActive || view === 'console')

  /* What Run will start. Two candidates or more and it is a picker; one and it
   * is a label, because a select with a single option is a lie. It sits in the
   * trailing toolbar group (VS Code puts a panel's controls on the right — see
   * the OUTPUT channel picker) in the OUTPUT-channel-picker dress: no box of
   * its own (the utilities out-layer `.field`'s @layer components recipe), UI
   * face at 13px in the toolbar's quiet grey. `.field`'s min-height is --touch,
   * so the select keeps its 44px target on touch with no extra dress. */
  /* min-w-[3.5rem]: the picker shrinks with the row but keeps a floor — before
   * this it had bare min-w-0 and the fixed-width icon buttons squeezed the
   * label to "m…" while keeping their own full boxes (founder pass 2026-08-05).
   * Icon-only controls stay fixed; the label gives way only down to the floor,
   * and every fixed neighbour has its own hide/tighten step, so the row still
   * sums under 320px (see the ≤460/≤360 steps in this header). */
  const entryPicker =
    candidates.length > 1 ? (
      <div className="relative flex min-w-[3.5rem] shrink items-center">
        <select
          value={entry ?? ''}
          onChange={(e) => props.onEntryChange(e.target.value)}
          aria-label="File to run"
          title="Choose which file Run starts"
          className="field min-w-0 appearance-none truncate pr-7 pl-2 bg-transparent border-transparent font-ui text-[13px] text-text-2"
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
        className="min-w-[3.5rem] max-w-[26ch] truncate font-ui text-[13px] text-text-2"
      >
        {entry}
      </span>
    ) : null

  return (
    <div className={HEADER}>
      {/* The pane's name as VS Code's panel-title caps. A script project has
          one face, so its tablist holds a lone, always-selected CONSOLE tab
          (same role=tablist "Output view" contract as the web pair — the two
          never render together). Clicking it while the panel is collapsed
          shows the console, which is exactly what clicking a panel title does
          in VS Code; clicking the already-shown face is VS Code's no-op. */}
      {previewActive ? (
        consoleOpen && view ? <ViewToggle view={view} onView={props.onView} /> : null
      ) : (
        <div role="tablist" aria-label="Output view" className="flex min-w-0 shrink items-stretch self-stretch">
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

      {/* The run-state pill, keyboard-time only. Everywhere else the status
          bar's remote block says the same word at the same moment — but the
          status bar stands down while a software keyboard is up (§4.3 rule 4's
          floor gets its pixels before decoration), and "waiting for you" must
          never be off screen while the student could be typing an answer.
          CSS-owned visibility (html[data-kb]), the same mechanism as kb-hide. */}
      <span className="hidden kb-open:flex min-w-0 items-center">
        <StatusPill status={status} exitCode={exitCode} />
      </span>

      <div className="ml-auto flex min-w-0 items-center gap-2 max-[460px]:gap-1">
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

        {/* VS Code's Maximize Panel Size / Restore Panel Size chevron — at
            every size, like the rest of the header. The one keyboard-time
            caveat: while the OSK owns the panel's height the toggle only
            takes effect once the keyboard closes.
            max-[379px]:hidden (founder overflow pass): below 380px the row
            cannot seat every control (a full toolbar measured 7px over at
            360) and this is the one whose job survives it — the divider drag
            still resizes the panel and collapse stays.
            QA note: the "Maximize output" control is absent under 380px. */}
        {consoleOpen && props.onToggleMaximize ? (
          <IconButton
            // "Maximize output"/"Restore output" verbatim — the ARCHITECTURE §4
            // contract names both, and the collapse control below owns the
            // frozen "Hide output"/"Show output" pair; this button must never
            // answer to either of those.
            label={props.maximized ? 'Restore output' : 'Maximize output'}
            onClick={props.onToggleMaximize}
            className={TOOLBAR_HOVER + ' max-[379px]:hidden'}
          >
            {props.maximized ? <IconChevronDown /> : <IconChevronUp />}
          </IconButton>
        ) : null}

        <IconButton
          label={consoleOpen ? 'Hide output' : 'Show output'}
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
 * The Preview / Console switch for a web project: VS Code's panel-title tabs —
 * PREVIEW CONSOLE in 11px caps, no box, the active one bright with a 1px
 * --panel-tab-active bottom rule (crop-panel.png). One dress at every size;
 * on touch the tabs stretch the 44px bar, so the target height comes free.
 * The uppercasing is CSS, so the accessible names stay "Preview" / "Console"
 * and the role=tablist contract (aria-label "Output view") never changes.
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
    <div role="tablist" aria-label="Output view" className="flex min-w-0 shrink items-stretch self-stretch gap-1">
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
      // silently failed is worse than no button — so the glyph itself swaps
      // and takes the state's colour.
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
