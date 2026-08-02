import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ConsoleBuffer, ConsoleLine } from '../console/buffer'
import type { LoadProgress } from '../runtime/types'
import type { RunFailure, RunStatus } from '../hooks/useRunner'
import { useMedia } from '../hooks/useMedia'
import { afterViewportSettles } from '../ui/viewport'
import { runShortcutLabel } from '../ui/shortcut'
import { ProgressBlock } from './ProgressBlock'
import { IconChevronDown } from './ui/Icons'
import { COPY } from '../copy'

export interface ConsoleProps {
  buffer: ConsoleBuffer
  status: RunStatus
  /**
   * Optional: the status line names the exit code when it has one. The runner
   * owns it and App passes it to the header pill; until it is passed here too the
   * line reads "Stopped early — the red lines say why", which is still complete.
   */
  exitCode?: number | null
  progress: LoadProgress | null
  /**
   * A run that could not start — the engine download blocked, the browser
   * missing isolation, a worker that stopped answering. Rendered as a block with
   * its own button rather than a red line, because the transcript scrolls and
   * "press Run again" is not obvious to a student looking at an error.
   */
  failure?: RunFailure | null
  onRetry?(): void
  onDismissFailure?(): void
  /** Registers a focus callback so the runner can focus the input on demand. */
  bindStdinFocus(fn: (() => void) | null): void
  onSubmitStdin(line: string): 'sent' | 'queued' | 'ignored'
  onNotify(message: string, kind?: 'info' | 'error'): void
}

/** Sticking to the bottom stops this far from it, so late output cannot yank a reader away. */
const STICK_SLACK_PX = 40

/**
 * How many trailing lines are actually in the DOM.
 *
 * The buffer caps at 5,000, but a tight `while True: print(i)` re-renders the
 * list on every frame, and 5,000 rows of reconciliation per frame is what turns
 * "my loop is printing" into "the Stop button doesn't work" (spec §7.3). Rows are
 * memoised so an unchanged row costs one identity check, and everything older
 * than this window is one click away rather than in the tree.
 */
const RENDER_WINDOW = 1200

/**
 * How long the live line survives an Enter.
 *
 * A program that asks two questions in a row (`input(); input()`) leaves stdin
 * for a few milliseconds between them. Unmounting the input in that gap blurs it,
 * and a blur on a phone shuts the software keyboard — so the student watches it
 * slam closed and reopen between question one and question two, and the viewport
 * resizes twice for nothing. Keeping the *same element* mounted briefly means the
 * second read reuses a still-focused input and nothing moves. It is not an input
 * bar in disguise: it carries no placeholder and no waiting styling while the
 * program is not reading, and anything typed into it goes through the runner's
 * type-ahead queue, which is exactly where a line typed between two reads belongs.
 */
const LIVE_GRACE_MS = 900

/**
 * The console is a transcript, not a log viewer (spec §7.3), and it has ONE
 * surface: output and input share the stream the way they do in a terminal.
 *
 * There is no standing input bar. While the program is not reading stdin there is
 * no input in the DOM at all; when it blocks on a read, an input appears *in the
 * transcript* at the point the cursor would be — joining a partial-line prompt so
 * `Your name: ` and what the student types are one visual line. Row treatment —
 * a 3px leading rule and a row tint, never colour alone — lives in
 * `.console-row[data-kind]`; per-segment colour lives in `[data-seg]`, which is
 * what lets `Your name: Saad` be one visual line in two colours.
 */
export function Console({
  buffer,
  status,
  exitCode = null,
  progress,
  failure = null,
  onRetry,
  onDismissFailure,
  bindStdinFocus,
  onSubmitStdin,
  onNotify,
}: ConsoleProps) {
  const snapshot = useSyncExternalStore(buffer.subscribe, buffer.getSnapshot)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const stick = useRef(true)
  /** Id of the last line the reader had seen when they scrolled up; null = stuck to the bottom. */
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  /** True for LIVE_GRACE_MS after Enter — see the constant. */
  const [grace, setGrace] = useState(false)
  const narrow = useMedia('(max-width: 899px)')
  const waiting = status === 'waiting'
  const busy = status === 'preparing' || status === 'running' || status === 'waiting'
  const cleared = useJustCleared(snapshot.lines.length)
  /** Is there a cursor on the transcript's last line at all? */
  const live = waiting || (grace && busy)

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Auto-scroll only while the reader is already at the bottom. Scrolling up
  // pauses it and raises the resume pill — being yanked out of a stack trace by
  // late output is the single most-missed console basic.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_SLACK_PX
    stick.current = atBottom
    setPausedAt((cur) => {
      if (atBottom) return null
      if (cur !== null) return cur
      const lines = buffer.getSnapshot().lines
      return lines.length ? lines[lines.length - 1].id : 0
    })
  }, [buffer])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    // While the engine boots, the progress block IS the content: its heading
    // carries the "this happens once" promise and the bar carries the numbers,
    // and both are taller than the transcript half of a 220px console — so
    // pinning the bottom would show a student the reassurance line and cut off
    // the thing that proves the app is not frozen. Top, until output arrives.
    if (progress) {
      el.scrollTop = 0
      return
    }
    if (stick.current) scrollToBottom()
  }, [snapshot, progress, showAll, live, scrollToBottom])

  // The transcript changing SIZE moves the bottom of the stream just as surely as
  // new output does — a software keyboard opening, the divider being dragged, the
  // panel yielding space to the editor. Without this the cursor a student is
  // typing at slides out of the scroll window the moment the keyboard appears,
  // which is the exact failure §4.3 rule 1 exists to prevent, now that the input
  // is in the stream rather than pinned under it.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stick.current) scrollToBottom()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollToBottom])

  // A new run (or Clear) empties the transcript: follow it again, and fold the
  // render window back down.
  useEffect(() => {
    if (snapshot.lines.length > 0) return
    stick.current = true
    setPausedAt(null)
    setShowAll(false)
  }, [snapshot])

  // The runner asks for focus from inside an engine callback, where React has
  // batched the `waiting` state change and not yet committed it — so at that
  // moment the input does not exist. Focusing on commit is the reliable half;
  // the registered callback is what re-focuses when the input is already there
  // (a second read inside the grace window).
  useEffect(() => {
    bindStdinFocus(() => inputRef.current?.focus())
    return () => bindStdinFocus(null)
  }, [bindStdinFocus])

  useLayoutEffect(() => {
    if (waiting) inputRef.current?.focus()
  }, [waiting])

  // Enter has been pressed: hold the cursor on the line long enough for a second
  // read to reuse it. A new read (`waiting`) supersedes the grace immediately.
  useEffect(() => {
    if (waiting) setGrace(false)
  }, [waiting])

  useEffect(() => {
    if (!grace) return
    const id = window.setTimeout(() => setGrace(false), LIVE_GRACE_MS)
    return () => window.clearTimeout(id)
  }, [grace])

  // Spec §4.4: the prompt is flushed and the input focused by the runner; the
  // scroll has to come *after* the keyboard resize settles, or the question the
  // student is answering ends up behind the keyboard. Whatever they were reading,
  // a pending prompt wins — so follow the bottom again.
  useEffect(() => {
    if (!waiting) return
    stick.current = true
    setPausedAt(null)
    let cancelled = false
    void afterViewportSettles().then(() => {
      // Still only if they have not scrolled away in the meantime: the viewport
      // can settle a keyboard-animation later, and a scroll that lands then would
      // yank a reader who went back up to re-read the question.
      if (!cancelled && stick.current) scrollToBottom()
    })
    return () => {
      cancelled = true
    }
  }, [waiting, scrollToBottom])

  const submit = () => {
    const line = value
    setValue('')
    const result = onSubmitStdin(line)
    if (result === 'ignored') {
      onNotify(COPY.stdinIdle, 'error')
      return
    }
    setGrace(true)
    if (result === 'queued') onNotify(COPY.stdinQueued)
  }

  // Ctrl+L clears, the way it does in a shell. Scoped to the console: the handler
  // sits on the panel, so it only fires while focus is inside it and the browser's
  // own Ctrl+L (focus the address bar) is untouched everywhere else.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (e.key !== 'l' && e.key !== 'L') return
    e.preventDefault()
    buffer.clear()
  }

  // Right-click (and a trackpad two-finger click) copies the selection outright,
  // the way a terminal emulator does. With nothing selected the native menu opens
  // as usual — and on touch, long-press selection is the platform's own and is
  // deliberately not intercepted.
  const onContextMenu = (e: React.MouseEvent) => {
    const text = window.getSelection()?.toString() ?? ''
    if (!text) return
    e.preventDefault()
    void navigator.clipboard.writeText(text).then(
      () => onNotify(COPY.copyOutputDone),
      () => onNotify(COPY.copyOutputFailed, 'error'),
    )
  }

  // Touch: the cursor is somewhere in a scrolling transcript, so "tap the console"
  // has to mean "type here". Never while a selection is being made, and never over
  // a control that has its own job.
  //
  // On `click`, not `pointerup`: the transcript is focusable (it has to be, for
  // Ctrl+L), and the browser moves focus to it on the mousedown that follows a
  // tap's pointerup — so focusing the input any earlier is immediately undone.
  const onClick = (e: React.MouseEvent) => {
    if (!live) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button, input, select, a')) return
    if (window.getSelection()?.isCollapsed === false) return
    inputRef.current?.focus()
  }

  const lines = snapshot.lines
  const hidden = showAll ? 0 : Math.max(0, lines.length - RENDER_WINDOW)
  const visible = hidden > 0 ? lines.slice(hidden) : lines
  const unseen = pausedAt === null ? 0 : countAfter(lines, pausedAt)
  const empty = lines.length === 0 && !progress && !live

  // The cursor sits after the last thing printed. If the program left that line
  // open (`print("Your name: ", end="")`, or `input("Your name: ")`), the input
  // belongs ON it; otherwise it starts a fresh line and takes the `› ` marker —
  // which is exactly the choice `buffer.echo()` will make a moment later, so the
  // line does not reflow when the answer lands.
  const tail = visible.length > 0 ? visible[visible.length - 1] : null
  const joinTail = live && !!tail && !tail.complete
  const rows = joinTail ? visible.slice(0, -1) : visible

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-state={status}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {/* Anchor for the resume pill, which has to float over the transcript
          rather than scroll away inside it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onContextMenu={onContextMenu}
          className="scroller console-transcript"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label="Program output"
          // A scrollable region has to be reachable without a mouse — and it is
          // also what gives Ctrl+L somewhere to be pressed: a click on a
          // non-focusable div leaves focus on <body>, where the panel's keydown
          // handler never sees it.
          tabIndex={0}
        >
          {progress ? <ProgressBlock progress={progress} /> : null}

          {snapshot.truncated ? (
            <Row line={{ id: -1, kind: 'meta', complete: true, segments: [{ kind: 'meta', text: COPY.truncated }] }} />
          ) : null}

          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="console-earlier"
            >
              {COPY.showEarlier(hidden)}
            </button>
          ) : null}

          {empty ? (
            <p className="console-empty">{cleared ? COPY.consoleCleared : COPY.consoleEmpty}</p>
          ) : (
            rows.map((line) => <Row key={line.id} line={line} />)
          )}

          {live ? (
            <LiveLine
              line={joinTail ? tail : null}
              waiting={waiting}
              inputRef={inputRef}
              value={value}
              onValue={setValue}
              onSubmit={submit}
            />
          ) : null}

          {failure ? <FailureBlock failure={failure} onRetry={onRetry} onDismiss={onDismissFailure} /> : null}
        </div>

        {pausedAt !== null && !empty ? (
          <button
            type="button"
            onClick={() => {
              stick.current = true
              setPausedAt(null)
              scrollToBottom()
            }}
            title={COPY.jumpToLatest}
            className="scroll-pill"
            data-unseen={unseen > 0 ? 'true' : 'false'}
          >
            <IconChevronDown size={16} />
            {unseen > 0 ? COPY.newLines(unseen) : COPY.jumpToLatest}
          </button>
        ) : null}
      </div>

      {/* The one fixed row the console keeps: what the program is doing now.
          Sticky, so a software keyboard can never cover it (spec §4.3 rule 1). */}
      <div className="console-foot">
        <StatusLine status={status} exitCode={exitCode} narrow={narrow} />
      </div>
    </div>
  )
}

/**
 * The live line: the terminal cursor, rendered.
 *
 * `line` is the still-open transcript line the input has to share ("Your name: "
 * and the answer on one row), or null when the cursor is on a fresh line and
 * takes the `› ` marker instead. It reuses `.console-row`, so the input sits on
 * the transcript's own grid rather than in a bar with its own geometry.
 *
 * `.stdin-row` / `.stdin-input` keep their names from the old input bar: the
 * class names are what the design audits measure, and the *thing* is the same
 * thing — the place a student types — even though it has moved into the stream.
 */
function LiveLine({
  line,
  waiting,
  inputRef,
  value,
  onValue,
  onSubmit,
}: {
  line: ConsoleLine | null
  waiting: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  value: string
  onValue(v: string): void
  onSubmit(): void
}) {
  return (
    <div
      className="console-row stdin-row"
      data-kind={line?.kind ?? 'out'}
      data-waiting={waiting ? 'true' : 'false'}
    >
      <span className="console-row__text console-row__text--live">
        {line ? (
          line.segments.map((seg, i) => (
            <span key={i} data-seg={seg.kind}>
              {seg.text}
            </span>
          ))
        ) : (
          // The same marker `buffer.echo()` writes when an answer starts its own
          // line, so the row reads identically before and after Enter.
          <span aria-hidden="true" className="stdin-marker">
            ›{' '}
          </span>
        )}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            onSubmit()
          }}
          // Only while the program is actually reading. In the grace window after
          // Enter the element is still here to hold focus, but it must not invite
          // a line nobody asked for.
          placeholder={waiting ? COPY.stdinWaitingPlaceholder : ''}
          aria-label="Program input"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          className="stdin-input"
        />
      </span>
    </div>
  )
}

/**
 * Per-state glyph, and whether the state is a live one.
 *
 * No colours here: `.console-status[data-state]` owns the tone, so the palette
 * stays in one file and the line can never drift from the pill beside it.
 */
const statusTone: Record<RunStatus, { glyph: string; live: boolean }> = {
  idle: { glyph: '○', live: false },
  preparing: { glyph: '●', live: true },
  running: { glyph: '●', live: true },
  waiting: { glyph: '▸', live: true },
  ok: { glyph: '✓', live: false },
  failed: { glyph: '✕', live: false },
  stopped: { glyph: '■', live: false },
}

function statusText(status: RunStatus, exitCode: number | null, narrow: boolean): string {
  switch (status) {
    case 'idle':
      // The shortcut is worth teaching where there is a keyboard to press it on,
      // and is noise on a phone.
      return narrow ? COPY.statusIdle : COPY.statusIdleShortcut(runShortcutLabel())
    case 'preparing':
      return narrow ? COPY.statusPreparingShort : COPY.statusPreparing
    case 'running':
      return COPY.statusRunning
    case 'waiting':
      return narrow ? COPY.stdinHintShort : COPY.stdinHint
    case 'ok':
      return COPY.statusOk
    case 'failed':
      return exitCode === null
        ? COPY.statusFailedNoCode
        : narrow
          ? COPY.statusFailedShort(exitCode)
          : COPY.statusFailed(exitCode)
    case 'stopped':
      return COPY.statusStopped
  }
}

/**
 * The line under the transcript: what the program is doing *now*, in a sentence,
 * in the state's own tone.
 *
 * The header pill is a badge — a glyph and a word, readable when the console is
 * collapsed. This is the sentence that tells a beginner what to do about it, and
 * it is the only permanent chrome the console has: with the input gone from the
 * bottom of the panel, this row is what makes "waiting for your answer" a state
 * you cannot miss even if the cursor has scrolled out of view. §10.5 of ACCEPTANCE
 * is exactly this confusion: waiting-for-input must never read as loading.
 */
function StatusLine({
  status,
  exitCode,
  narrow,
}: {
  status: RunStatus
  exitCode: number | null
  narrow: boolean
}) {
  const tone = statusTone[status]
  const text = statusText(status, exitCode, narrow)
  return (
    <p role="status" aria-live="polite" data-state={status} title={text} className="console-status">
      <span
        aria-hidden="true"
        className={'console-status__glyph' + (tone.live ? ' animate-pulse motion-reduce:animate-none' : '')}
      >
        {tone.glyph}
      </span>
      <span className="console-status__text">{text}</span>
    </p>
  )
}

/** Lines appended after `id`. Ids only ever ascend, so walk back from the tail. */
function countAfter(lines: readonly ConsoleLine[], id: number): number {
  let n = 0
  for (let i = lines.length - 1; i >= 0 && lines[i].id > id; i--) n++
  return n
}

/**
 * True for 3 seconds after the transcript goes from having lines to having none,
 * so a cleared console says "Cleared." before falling back to the standing
 * explanation (spec §7.5). View-level only — the buffer knows nothing about it.
 */
function useJustCleared(lineCount: number): boolean {
  const [cleared, setCleared] = useState(false)
  const previous = useRef(lineCount)

  useEffect(() => {
    const had = previous.current
    previous.current = lineCount
    if (lineCount !== 0 || had === 0) return
    setCleared(true)
    const id = window.setTimeout(() => setCleared(false), 3000)
    return () => window.clearTimeout(id)
  }, [lineCount])

  return cleared && lineCount === 0
}

/**
 * One row, memoised on the line's identity.
 *
 * The buffer replaces the object for the row it touches and keeps every other
 * object identical, so a 5,000-line burst re-renders one row per frame instead of
 * five thousand. This is a *design* requirement, not an optimisation: the visible
 * symptom of dropping it is that Stop stops responding (spec §7.3).
 */
const Row = memo(function Row({ line }: { line: ConsoleLine }) {
  return (
    <div data-kind={line.kind} className="console-row">
      <span className="console-row__text">
        {line.segments.length === 0
          ? ' '
          : // `[data-seg]` carries hue and, for an echoed answer, italic too — an
            // answer that joined an open prompt ("Your name: Saad") shares its row
            // with stdout, so the row's leading rule cannot separate the two.
            line.segments.map((seg, i) => (
              <span key={i} data-seg={seg.kind}>
                {seg.text}
              </span>
            ))}
      </span>
    </div>
  )
})

/**
 * A run that could not start, as a block the student can act on.
 *
 * Deliberately not a transcript row. A red line is the right shape for "your
 * program crashed" and the wrong shape for "Warsha could not download Java":
 * the second is not the student's fault, is not about their code, and has
 * exactly one useful next action. So it gets a heading, one hint, a button that
 * performs the action, and the engine's own words folded away behind Details —
 * which is where `TypeError: Failed to fetch` belongs, since it reads to a
 * beginner as an accusation.
 *
 * The button styling reuses `.console-earlier` rather than `ui/Button` so the
 * console has no dependency on the primitives while they are being reworked.
 */
function FailureBlock({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: RunFailure
  onRetry?(): void
  onDismiss?(): void
}) {
  const [showDetail, setShowDetail] = useState(false)
  return (
    <div role="alert" data-failure={failure.kind} className="note note--danger console-failure">
      <p className="console-failure__title">{failure.message}</p>
      {failure.hint ? <p className="note__text">{failure.hint}</p> : null}
      <div className="console-failure__actions">
        {onRetry ? (
          <button type="button" onClick={onRetry} className="console-earlier">
            {COPY.engineRetry}
          </button>
        ) : null}
        {failure.detail ? (
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            aria-expanded={showDetail}
            className="console-earlier"
          >
            {COPY.engineDetails}
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="console-earlier">
            ✕
          </button>
        ) : null}
      </div>
      {showDetail && failure.detail ? <pre className="console-failure__detail">{failure.detail}</pre> : null}
    </div>
  )
}
