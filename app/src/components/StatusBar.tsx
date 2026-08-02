import type { RunStatus } from '../hooks/useRunner'
import { langForPath } from '../runtime'
import { extOf } from './FileBadge'
import { StatusPill } from './StatusPill'
import { IconTextBigger, IconTextSmaller } from './ui/Icons'
import { COPY } from '../copy'

export interface StatusBarProps {
  status: RunStatus
  exitCode: number | null
  /** The file being edited — it names the language. */
  activePath: string | null
  /** The file Run starts — not necessarily the one being edited. */
  entryPath: string | null
  cursor: { line: number; col: number } | null
  fontSize: number
  onFontSize(next: number): void
}

/** "Java 8" / "Python 3.14" for the two real engines, honest for everything else. */
function languageLabel(path: string | null): string {
  if (!path) return COPY.langNone
  const lang = langForPath(path)
  if (lang === 'java') return COPY.langJava
  if (lang === 'python') return COPY.langPython
  const ext = extOf(path)
  return ext ? ext.toUpperCase() : COPY.langPlain
}

/* The bottom bar. Surface-0, like the title bar and the activity rail, so the
 * app frame closes on all four sides in one colour. Deliberately NOT VSCode's
 * blue — amber is the only signature colour this app has, and a blue band would
 * be the loudest thing on screen. Divider is an inset shadow, as every
 * fixed-height bar's is. Padding is --sp-2, the same as the console header's, so
 * the two bars bracketing the work area indent by the same amount. */
const BAR =
  'status-bar flex items-center gap-2 flex-none h-bar-status min-w-0 bg-surface-0 ' +
  'col-start-1 row-start-3 col-span-2 shadow-[inset_0_1px_0_0_var(--border-subtle)] ' +
  'pl-[max(var(--sp-2),env(safe-area-inset-left))] pr-[max(var(--sp-2),env(safe-area-inset-right))] ' +
  'font-ui text-micro leading-none text-text-3 select-none'

const GROUP = 'status-bar__group flex items-center gap-2 min-w-0'
/* The reference group gives way first: the run state on the left is the one
 * thing here a student is ever looking for in a hurry. */
const GROUP_END = 'status-bar__group--end ml-auto overflow-hidden'

const ITEM = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
const ITEM_CODE = ITEM + ' font-code'
const SEP = 'status-sep w-px h-3 flex-none bg-border-subtle'

const STEPPER = 'status-stepper flex items-center gap-1 flex-none'
/* The stepper is the one interactive thing in this bar, and the one place the
 * app ships a target under 44px. See --bar-status for why that is acceptable
 * here and nowhere else. */
const STEP_BTN =
  'grid place-items-center flex-none w-6 h-[22px] rounded-sm text-text-3 cursor-pointer touch-manipulation ' +
  'transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:not-disabled:bg-surface-3 hover:not-disabled:text-text-1 active:not-disabled:bg-surface-4 ' +
  'disabled:text-text-disabled disabled:cursor-default focus-visible:outline-offset-[-1px]'


/**
 * The bottom bar (LAYOUT-VSCODE §3). ≥900px only: on a phone the console's own
 * status line already carries the run state one row above the input, and a
 * second copy of it would cost the transcript four output lines it cannot spare.
 * It also hides itself under `html[data-kb="open"]` for the same reason.
 *
 * Left is the run state and, on a failure, the exit code — the SAME `StatusPill`
 * the console header renders, driven by the same `runner` fields, so the two can
 * never disagree. Right is the reference row: language of the file you are
 * looking at, the file Run would start, the caret, and the text-size stepper.
 *
 * Only the stepper is interactive, and it is 26px rather than 44px. That is the
 * one place this bar departs from §5.2, and it is safe because the same two
 * actions keep their 44px rows in the overflow menu — no function lives only
 * inside a small target, and this surface never renders on a touch layout.
 */
export function StatusBar({
  status,
  exitCode,
  activePath,
  entryPath,
  cursor,
  fontSize,
  onFontSize,
}: StatusBarProps) {
  return (
    <footer className={BAR} aria-label="Status bar">
      <div className={GROUP}>
        <StatusPill status={status} exitCode={exitCode} variant="bar" />
      </div>

      <div className={GROUP + ' ' + GROUP_END}>
        <span className={ITEM}>{languageLabel(activePath)}</span>
        <span aria-hidden="true" className={SEP} />
        <span className={ITEM_CODE} title={entryPath ? `Run starts ${entryPath}` : COPY.noEntry}>
          {entryPath ?? COPY.statusBarNoEntry}
        </span>
        <span aria-hidden="true" className={SEP} />
        {/* Blank rather than "Ln 1, Col 1" when no file is open: a caret position
            for a document that is not on screen is a small lie. */}
        <span className={ITEM_CODE + ' min-w-[9ch]'}>
          {cursor ? COPY.cursorAt(cursor.line, cursor.col) : ''}
        </span>
        <span aria-hidden="true" className={SEP} />
        <span className={STEPPER}>
          <button
            type="button"
            className={STEP_BTN}
            aria-label="Smaller text"
            title="Smaller text"
            disabled={fontSize <= 11}
            onClick={() => onFontSize(Math.max(11, fontSize - 1))}
          >
            <IconTextSmaller size={16} />
          </button>
          <span className={ITEM_CODE + ' tabular-nums'} aria-live="off">
            {fontSize}
          </span>
          <button
            type="button"
            className={STEP_BTN}
            aria-label="Bigger text"
            title="Bigger text"
            disabled={fontSize >= 26}
            onClick={() => onFontSize(Math.min(26, fontSize + 1))}
          >
            <IconTextBigger size={16} />
          </button>
        </span>
      </div>
    </footer>
  )
}
