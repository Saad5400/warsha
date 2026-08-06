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
  /**
   * Moves the caret via the editor's go-to-line affordance. Optional because
   * the controller may not grow `gotoLine()` until a later package lands;
   * while it is absent the Ln/Col item renders as plain text, never as a
   * button that does nothing.
   */
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

/* The bottom bar, on VSCode's statusbar chrome (--statusbar-* tokens for fill,
 * text and the hairline — the divider stays an inset shadow, as every
 * fixed-height bar's is). The footer itself carries no horizontal padding:
 * the leading remote block sits flush against the screen edge exactly as
 * VSCode's does (a left safe-area inset pads it only where a notch actually
 * claims pixels), every other item brings its own 4px padding instead, and
 * the right-hand safe-area inset rides on the trailing group. No separators
 * and no monospace anywhere — VSCode's status bar is plain UI text, and the
 * item rhythm comes from the paddings.
 *
 * Now the bottommost chrome at EVERY width, so it also owns the bottom
 * safe-area: the env() term grows the box below the content row (padding
 * inside a calc'd height), keeping the fills at --bar-status while the bar's
 * own fill runs under a phone's home indicator. */
const BAR =
  'status-bar flex items-center flex-none min-w-0 bg-statusbar ' +
  'h-[calc(var(--bar-status)+env(safe-area-inset-bottom,0px))] pb-[env(safe-area-inset-bottom,0px)] ' +
  'pl-[env(safe-area-inset-left,0px)] ' +
  'col-start-1 row-start-3 col-span-2 shadow-[inset_0_1px_0_0_var(--statusbar-border)] ' +
  'font-ui text-micro leading-none text-statusbar-fg select-none'

/* Full height so every item inside can paint VSCode's full-height hover fill. */
const GROUP = 'status-bar__group flex h-full items-center min-w-0'
/* Priority when width runs out (VSCode hides lower-priority items; founder
 * overflow pass 2026-08-05): run state, Ln/Col and the language always stay;
 * the entry NAME is what gives way — the leading group is the flex-1 cell, so
 * its truncating span absorbs every lost pixel while the reference group keeps
 * its natural size. "Spaces: 4" and the font stepper hide below 480px instead
 * (see their max-[479px]:hidden) — both are conveniences with other homes. */
const GROUP_LEAD = ' flex-1'
const GROUP_END = 'status-bar__group--end ms-auto flex-none overflow-hidden pr-[env(safe-area-inset-right)]'

/* One VSCode status item: full bar height, 4px a side, centred content. */
const ITEM = 'status-bar__item flex h-full items-center gap-1 px-1 min-w-0 whitespace-nowrap'
/* The interactive ones add the white-alpha fills (--statusbar-item-hover /
 * -active) behind text that steps up to white — VSCode's own affordance.
 * These targets are bar-height rather than 44px; see --bar-status for why
 * that is acceptable here and nowhere else: the bar rides the token (30px on
 * touch, VSCode's 22px under DENSITY — height adjustments only, never a
 * different bar), every item here is a convenience duplicate, and the same
 * actions keep ≥44px homes elsewhere (Go to Line in the quick input, text
 * size in the View menu). */
const STATUS_ITEM =
  ITEM +
  ' flex-none cursor-pointer transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:bg-statusbar-item-hover hover:text-white active:bg-statusbar-item-active ' +
  'focus-visible:outline-offset-[-1px]'

/* Hidden below 480px with "Spaces: 4" (priority classes above): text size
 * keeps its ≥44px home in the View menu, so nothing is lost — only duplicated
 * convenience gives way. */
const STEPPER = 'status-stepper flex h-full items-center flex-none max-[479px]:hidden'

/* The stepper's two ends: the same full-height fill affordance as STATUS_ITEM,
 * but a fixed 24px square around a centred glyph, and disabled at the font
 * range's edges — real state, so the not-disabled guards matter here. */
const STEP_BTN =
  'h-full w-6 grid place-items-center flex-none cursor-pointer ' +
  'transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:not-disabled:bg-statusbar-item-hover hover:not-disabled:text-white ' +
  'active:not-disabled:bg-statusbar-item-active ' +
  'disabled:text-text-disabled disabled:cursor-default focus-visible:outline-offset-[-1px]'

/**
 * The bottom bar (LAYOUT-VSCODE §3), at EVERY width — one shell (founder
 * ruling); touch gets a taller bar via --bar-status and nothing structural.
 * The one absence: App withholds it while a software keyboard is up, because
 * §4.3 rule 4's console floor gets those pixels first — the panel header's
 * kb-open pill (RunBar.tsx) carries the run state for exactly that window.
 *
 * Left is the remote-indicator block — the SAME `StatusPill` the console
 * header shows at keyboard time, driven by the same `runner` fields, so the
 * two can never disagree — followed by the file Run would start. Right is the
 * reference row in VSCode's own order: the caret first, then the language,
 * then the text-size stepper (Warsha's one addition, at the far edge).
 * VSCode's problems counter and notification bell are deliberately absent:
 * there is no diagnostics feed and no notification centre behind them, and a
 * dead control is worse than none.
 */
export function StatusBar({
  status,
  exitCode,
  activePath,
  entryPath,
  cursor,
  fontSize,
  onFontSize,
  onGotoLine,
}: StatusBarProps) {
  return (
    <footer className={BAR} aria-label={COPY.a11yStatusBar}>
      <div className={GROUP + GROUP_LEAD}>
        <StatusPill status={status} exitCode={exitCode} variant="bar" />
        <span className={ITEM} title={entryPath ? COPY.statusBarRunStarts(entryPath) : COPY.noEntry}>
          {/* max-w caps a marathon path on wide screens; min-w-0 lets the
              narrow ones squeeze it to an ellipsis before anything on the
              right loses a pixel. */}
          <span className="min-w-0 max-w-[40ch] overflow-hidden text-ellipsis whitespace-nowrap">
            {entryPath ?? COPY.statusBarNoEntry}
          </span>
        </span>
      </div>

      <div className={GROUP + ' ' + GROUP_END}>
        {/* Absent rather than "Ln 1, Col 1" when no file is open: a caret
            position for a document that is not on screen is a small lie. A
            button only once go-to-line exists to be clicked. */}
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
        {/* The editor indents with four spaces everywhere (setup.ts sets a
            single global indentUnit, never per-language), so this reads as a
            constant. It becomes a button the day indentation is configurable. */}
        {/* Hidden below 480px: a constant nobody edits is the first passenger
            off a narrow bar (VSCode hides low-priority items the same way). */}
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
