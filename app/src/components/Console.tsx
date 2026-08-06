import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ConsoleBuffer, ConsoleLine, ConsoleSnapshot } from '../console/buffer'
import type { LoadProgress } from '../runtime/types'
import type { RunFailure, RunStatus } from '../hooks/useRunner'
import { afterViewportSettles } from '../ui/viewport'
import { ProgressBlock } from './ProgressBlock'
import { IconChevronDown } from './ui/Icons'
import { COPY } from '../copy'

export interface ConsoleProps {
  buffer: ConsoleBuffer
  status: RunStatus
  progress: LoadProgress | null
  /** A run that could not start (blocked download, missing isolation, dead worker) —
   *  rendered as a block with its own button, not a red line a scrolling transcript would bury. */
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
 * Trailing lines kept in the DOM. The buffer caps at 5,000, but reconciling that many
 * every frame during a tight print loop is what makes Stop feel dead (spec §7.3) —
 * older lines are memoised out of the tree, one click away via "show earlier".
 */
const RENDER_WINDOW = 1200

/**
 * How long the live input survives an Enter. Back-to-back `input()` calls leave a gap
 * where unmounting would blur the input and flash the software keyboard closed/open.
 * Keeping the same element mounted through the gap avoids that; it stays a bare focus
 * holder (no placeholder/styling) until the next read, and anything typed goes through
 * the runner's type-ahead queue.
 */
const LIVE_GRACE_MS = 900

/**
 * Largest batch of new lines that still fades in. A runaway print loop can flush
 * hundreds of lines at once, and fading 1,200 rows together is the jank that makes
 * Stop feel dead (§7.3) — DESIGN-SPEC §9's "never animate console content" is softened
 * only for small, human-paced batches; a burst animates nothing. Works with the
 * buffer's paced reveal (REVEAL_PER_FLUSH), which keeps bursts under this size.
 */
const FRESH_MAX_BATCH = 8

/**
 * A transcript, not a log viewer (spec §7.3): output and input share one stream, like
 * a terminal. No standing input bar — an input only exists in the DOM while the program
 * blocks on a read, joining a partial-line prompt so "Your name: " and the answer are
 * one visual line (row tint in `.console-row[data-kind]`, per-segment colour in `[data-seg]`).
 */
export function Console({
  buffer,
  status,
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
  // Which trailing rows just arrived, so only they fade in. Recomputed once per snapshot
  // (identity-guarded, so StrictMode/extra renders cost nothing); marks nothing fresh during a burst.
  const freshRef = useRef<{ snap: ConsoleSnapshot | null; prevMax: number; freshFrom: number }>({
    snap: null,
    prevMax: 0,
    freshFrom: 0,
  })
  /** Id of the last line the reader had seen when they scrolled up; null = stuck to the bottom. */
  const [pausedAt, setPausedAt] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  /** True for LIVE_GRACE_MS after Enter — see the constant. */
  const [grace, setGrace] = useState(false)
  const waiting = status === 'waiting'
  const busy = status === 'preparing' || status === 'running' || status === 'waiting'
  const cleared = useJustCleared(snapshot.lines.length)
  /** Is there a cursor on the transcript's last line at all? */
  const live = waiting || (grace && busy)

  // Always instant: a smooth scroll during a print burst lags a frame and reads as stutter,
  // and the resume pill's jump can span thousands of pixels — "now", not a slow glide.
  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // Auto-scroll only while already at the bottom; scrolling up pauses it and raises the resume pill.
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
    // While booting, the progress block IS the content — pin to the top so its heading and
    // bar (taller than a 220px console's transcript half) aren't cut off by bottom-pinning.
    if (progress) {
      el.scrollTop = 0
      return
    }
    if (stick.current) scrollToBottom()
  }, [snapshot, progress, showAll, live, scrollToBottom])

  // A resize (keyboard opening, divider drag, panel resize) moves the bottom just like new
  // output does — without this the cursor a student is typing at slides out of view (§4.3 rule 1).
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

  // Runner may ask for focus before React commits the `waiting` state change, when the
  // input doesn't exist yet; this covers the case where it already does (grace window).
  useEffect(() => {
    bindStdinFocus(() => inputRef.current?.focus())
    return () => bindStdinFocus(null)
  }, [bindStdinFocus])

  useLayoutEffect(() => {
    if (waiting) inputRef.current?.focus()
  }, [waiting])

  // Enter pressed: hold the line for a potential second read; a new `waiting` read cancels the grace immediately.
  useEffect(() => {
    if (waiting) setGrace(false)
  }, [waiting])

  useEffect(() => {
    if (!grace) return
    const id = window.setTimeout(() => setGrace(false), LIVE_GRACE_MS)
    return () => window.clearTimeout(id)
  }, [grace])

  // §4.4: scroll must come after the keyboard resize settles, or the question ends up
  // behind the keyboard. A pending prompt always wins, so re-follow the bottom.
  useEffect(() => {
    if (!waiting) return
    stick.current = true
    setPausedAt(null)
    let cancelled = false
    void afterViewportSettles().then(() => {
      // Only if they haven't since scrolled away — a late-settling viewport shouldn't yank a reader back down.
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

  // Ctrl+L clears (like a shell), scoped to the panel so the browser's own Ctrl+L elsewhere is untouched.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (e.key !== 'l' && e.key !== 'L') return
    e.preventDefault()
    buffer.clear()
  }

  // Right-click copies the selection outright (like a terminal); with nothing selected the
  // native menu opens as usual. Touch long-press selection is the platform's own, untouched.
  const onContextMenu = (e: React.MouseEvent) => {
    const text = window.getSelection()?.toString() ?? ''
    if (!text) return
    e.preventDefault()
    void navigator.clipboard.writeText(text).then(
      () => onNotify(COPY.copyOutputDone),
      () => onNotify(COPY.copyOutputFailed, 'error'),
    )
  }

  // Touch: tapping the console means "type here", unless selecting text or tapping a control.
  // Uses `click`, not `pointerup`: the focusable transcript (needed for Ctrl+L) steals focus
  // on the mousedown between them, undoing an earlier focus attempt.
  const onClick = (e: React.MouseEvent) => {
    if (!live) return
    const target = e.target as HTMLElement | null
    if (target?.closest('button, input, select, a')) return
    if (window.getSelection()?.isCollapsed === false) return
    inputRef.current?.focus()
  }

  const lines = snapshot.lines

  // Ids only ascend, so a rising max is "what's new": a small batch fades, a large one is a burst.
  // prevMax is left alone on an empty snapshot (Clear/new run) so the next run's first line still fades.
  const fr = freshRef.current
  if (fr.snap !== snapshot) {
    const maxId = lines.length ? lines[lines.length - 1].id : fr.prevMax
    const appended = maxId - fr.prevMax
    const canAnim = !progress && lines.length > 0 && appended > 0 && appended <= FRESH_MAX_BATCH
    fr.freshFrom = canAnim ? fr.prevMax : maxId
    if (lines.length) fr.prevMax = maxId
    fr.snap = snapshot
  }
  const freshFrom = fr.freshFrom

  const hidden = showAll ? 0 : Math.max(0, lines.length - RENDER_WINDOW)
  const visible = hidden > 0 ? lines.slice(hidden) : lines
  const unseen = pausedAt === null ? 0 : countAfter(lines, pausedAt)
  const empty = lines.length === 0 && !progress && !live

  // The input joins the last line if it's still open (an unterminated print/input prompt);
  // otherwise it starts a fresh `› ` line, matching what `buffer.echo()` will do next.
  // Gated on `waiting`, not `live`: during the post-Enter grace this must stay a completed row,
  // or a phantom "›" prompt hangs under every answer for ~900ms.
  const tail = visible.length > 0 ? visible[visible.length - 1] : null
  const joinTail = waiting && !!tail && !tail.complete
  const rows = joinTail ? visible.slice(0, -1) : visible

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-state={status}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {/* Anchor for the resume pill, which floats over the transcript instead of scrolling with it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          onContextMenu={onContextMenu}
          className="scroller console-transcript"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label={COPY.a11yProgramOutput}
          // Focusable so it's keyboard-reachable and so Ctrl+L has somewhere to land —
          // a non-focusable div would leave focus on <body>, past the panel's keydown handler.
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
            rows.map((line) => <Row key={line.id} line={line} fresh={line.id > freshFrom} />)
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
    </div>
  )
}

/**
 * The terminal cursor, rendered. `line` is the still-open row the input joins
 * ("Your name: " + the answer), or null when it starts a fresh `› ` line; it reuses
 * `.console-row` so the input sits on the transcript's own grid. `.stdin-row`/`.stdin-input`
 * keep their old names since design audits measure by class name.
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
        ) : waiting ? (
          // Matches the marker buffer.echo() writes, so the row looks the same before/after Enter.
          // Only while actually reading — in the grace window this is just an invisible focus-holder.
          <span aria-hidden="true" className="stdin-marker">
            ›{' '}
          </span>
        ) : null}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            onSubmit()
          }}
          // Only while actually reading — in the grace window it just holds focus, not inviting input.
          placeholder={waiting ? COPY.stdinWaitingPlaceholder : ''}
          aria-label={COPY.a11yProgramInput}
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

/** Lines appended after `id`. Ids only ever ascend, so walk back from the tail. */
function countAfter(lines: readonly ConsoleLine[], id: number): number {
  let n = 0
  for (let i = lines.length - 1; i >= 0 && lines[i].id > id; i--) n++
  return n
}

/**
 * True for 3s after the transcript empties, so it says "Cleared." before falling back
 * to the standing explanation (spec §7.5). View-level only.
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
 * One row, memoised on line identity: the buffer replaces only the touched object, so a
 * 5,000-line burst re-renders one row, not five thousand. Not an optimisation — drop this
 * and Stop stops responding (spec §7.3).
 */
const Row = memo(function Row({ line, fresh }: { line: ConsoleLine; fresh?: boolean }) {
  return (
    // `data-fresh` is a one-shot fade, flipped off next snapshot; memo means a burst
    // (where nothing is ever marked fresh) re-renders nothing extra.
    <div data-kind={line.kind} data-fresh={fresh ? 'true' : undefined} className="console-row">
      <span className="console-row__text">
        {line.segments.length === 0
          ? ' '
          : // [data-seg] carries hue (and italic for an echoed answer) since a joined
            // prompt+answer row can't be split by the row's own leading rule.
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
 * A run that couldn't start, as an actionable block — not a transcript row. A red line
 * fits "your program crashed"; this is "Warsha couldn't download Java", not the
 * student's fault, so it gets a heading, a hint, and a retry button, with the engine's
 * raw error folded behind Details (`TypeError: Failed to fetch` reads as an accusation).
 * Reuses `.console-earlier` styling rather than `ui/Button` to avoid a dependency
 * on primitives still being reworked.
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
          <button type="button" onClick={onDismiss} aria-label={COPY.a11yDismiss} className="console-earlier">
            ✕
          </button>
        ) : null}
      </div>
      {showDetail && failure.detail ? <pre className="console-failure__detail">{failure.detail}</pre> : null}
    </div>
  )
}
