import type { RunStatus } from '../hooks/useRunner'
import { langForPath } from '../runtime'
import { extOf } from './FileBadge'
import { StatusPill } from './StatusPill'
import { IconError, IconTextBigger, IconTextSmaller, IconWarning } from './ui/Icons'
import { COPY } from '../copy'

export interface StatusBarProps {
  status: RunStatus
  exitCode: number | null
  /** The file being edited — it names the language. */
  activePath: string | null
  /** The file Run starts — not necessarily the one being edited. */
  entryPath: string | null
  cursor: { line: number; col: number } | null
  /** The linter's tally, or null when no file is open. The item hides at zero. */
  problems?: { errors: number; warnings: number } | null
  /** Opens the problems panel — the touch/pointer route to every red line and its fix. */
  onProblems?(): void
  fontSize: number
  onFontSize(next: number): void
  /** Moves the caret via go-to-line. Optional: until the controller grows `gotoLine()`,
   *  the Ln/Col item renders as plain text rather than a dead button. */
  onGotoLine?(): void
}

/** "Java 17" / "Python 3.14" for the two real engines, honest for everything else. */
function languageLabel(path: string | null): string {
  if (!path) return COPY.langNone
  const lang = langForPath(path)
  if (lang === 'java') return COPY.langJava
  if (lang === 'python') return COPY.langPython
  const ext = extOf(path)
  return ext ? ext.toUpperCase() : COPY.langPlain
}

// VS Code's statusbar chrome: no horizontal padding on the footer itself (the leading block
// sits flush like VS Code's), each item brings its own padding instead. No separators or
// monospace — rhythm comes from padding alone. The env() term extends the bar under a
// phone's home indicator while keeping the content row at --bar-status height.
const BAR =
  'status-bar flex items-center flex-none min-w-0 bg-statusbar ' +
  'h-[calc(var(--bar-status)+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] ' +
  'pl-[env(safe-area-inset-left,0px)] ' +
  'col-start-1 row-start-3 col-span-2 shadow-[inset_0_1px_0_0_var(--statusbar-border)] ' +
  'font-ui text-micro leading-none text-statusbar-fg select-none'

/* Full height so every item inside can paint VSCode's full-height hover fill. */
const GROUP = 'status-bar__group flex h-full items-center min-w-0'
// Overflow priority: run state, Ln/Col and language always stay; the entry NAME gives way
// first (leading flex-1 cell absorbs lost pixels). "Spaces: 4" and the font stepper hide
// below 480px — both have other homes.
const GROUP_LEAD = ' flex-1'
const GROUP_END = 'status-bar__group--end ms-auto flex-none overflow-hidden pr-[env(safe-area-inset-right)]'

/* One VSCode status item: full bar height, 4px a side, centred content. */
const ITEM = 'status-bar__item flex h-full items-center gap-1 px-1 min-w-0 whitespace-nowrap'
// Bar-height targets, not 44px, are OK here only because every item is a convenience
// duplicate — the same actions keep ≥44px homes elsewhere (Go to Line in quick input,
// text size in the View menu).
const STATUS_ITEM =
  ITEM +
  ' flex-none cursor-pointer transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:bg-statusbar-item-hover hover:text-white active:bg-statusbar-item-active ' +
  'focus-visible:outline-offset-[-1px]'

// Hidden below 480px like "Spaces: 4" — text size keeps its ≥44px home in the View menu.
const STEPPER = 'status-stepper flex h-full items-center flex-none max-[479px]:hidden'

// Same fill affordance as STATUS_ITEM; disabled at the font range's edges is real state, hence the not-disabled guards.
const STEP_BTN =
  'h-full w-6 grid place-items-center flex-none cursor-pointer ' +
  'transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:not-disabled:bg-statusbar-item-hover hover:not-disabled:text-white ' +
  'active:not-disabled:bg-statusbar-item-active ' +
  'disabled:text-text-disabled disabled:cursor-default focus-visible:outline-offset-[-1px]'

/**
 * Bottom bar (LAYOUT-VSCODE §3); App hides it while the keyboard is up, since the
 * console's kb-open pill (RunBar.tsx) carries the run state for that window instead.
 * Left is the same `StatusPill` as the console header, so the two can never disagree.
 * VS Code's problems counter now sits beside it, fed by the editor's linter and
 * opening the problems panel on tap — but only while a file with problems is open
 * (it hides at zero). The notification bell stays absent: no notification centre
 * exists behind it, and a dead control is worse than none.
 */
export function StatusBar({
  status,
  exitCode,
  activePath,
  entryPath,
  cursor,
  problems,
  onProblems,
  fontSize,
  onFontSize,
  onGotoLine,
}: StatusBarProps) {
  const problemCount = problems ? problems.errors + problems.warnings : 0
  return (
    <footer className={BAR} aria-label={COPY.a11yStatusBar}>
      <div className={GROUP + GROUP_LEAD}>
        <StatusPill status={status} exitCode={exitCode} variant="bar" />
        {/* VS Code's problems counter: far left, colour-coded, tap to open the
            panel. Inline colours beat STATUS_ITEM's hover:text-white so the
            severity hues survive a hover, as they do in VS Code. */}
        {problems && problemCount > 0 ? (
          <button
            type="button"
            className={STATUS_ITEM}
            aria-label={COPY.a11yProblems}
            title={COPY.statusBarProblems(problems.errors, problems.warnings)}
            onClick={() => onProblems?.()}
          >
            {problems.errors > 0 ? (
              <span className="flex items-center gap-0.5" style={{ color: 'var(--danger)' }}>
                <IconError size={13} />
                <span className="tabular-nums">{problems.errors}</span>
              </span>
            ) : null}
            {problems.warnings > 0 ? (
              <span className="flex items-center gap-0.5" style={{ color: 'var(--warn)' }}>
                <IconWarning size={13} />
                <span className="tabular-nums">{problems.warnings}</span>
              </span>
            ) : null}
          </button>
        ) : null}
        <span className={ITEM} title={entryPath ? COPY.statusBarRunStarts(entryPath) : COPY.noEntry}>
          {/* max-w caps a marathon path; min-w-0 lets it ellipsis before anything to the right loses a pixel. */}
          <span className="min-w-0 max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap">
            {entryPath ?? COPY.statusBarNoEntry}
          </span>
        </span>
      </div>

      <div className={GROUP + ' ' + GROUP_END}>
        {/* Absent (not "Ln 1, Col 1") when no file is open — a caret position for nothing on screen is a small lie. */}
        {cursor ? (
          onGotoLine ? (
            <button
              type="button"
              className={STATUS_ITEM + ' tabular-nums'}
              title={COPY.a11yGoToLine}
              onClick={() => onGotoLine?.()}
            >
              {COPY.cursorAt(cursor.line, cursor.col)}
            </button>
          ) : (
            <span className={ITEM + ' tabular-nums'}>{COPY.cursorAt(cursor.line, cursor.col)}</span>
          )
        ) : null}
        {/* Plain text, not a button: indentation is a single global constant (setup.ts), not
            configurable yet. Hidden below 480px as the lowest-priority item. */}
        {activePath ? <span className={ITEM + ' flex-none max-[479px]:hidden'}>{COPY.statusBarIndent}</span> : null}
        <span className={ITEM + ' flex-none'}>{languageLabel(activePath)}</span>
        <span className={STEPPER}>
          <button
            type="button"
            className={STEP_BTN}
            aria-label={COPY.a11ySmallerText}
            title={COPY.a11ySmallerText}
            disabled={fontSize <= 11}
            onClick={() => onFontSize(Math.max(11, fontSize - 1))}
          >
            <IconTextSmaller size={14} />
          </button>
          <span className={ITEM + ' tabular-nums'} aria-live="off">
            {fontSize}
          </span>
          <button
            type="button"
            className={STEP_BTN}
            aria-label={COPY.a11yBiggerText}
            title={COPY.a11yBiggerText}
            disabled={fontSize >= 26}
            onClick={() => onFontSize(Math.min(26, fontSize + 1))}
          >
            <IconTextBigger size={14} />
          </button>
        </span>
      </div>
    </footer>
  )
}
