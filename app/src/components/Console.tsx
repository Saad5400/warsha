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
import type { RunStatus } from '../hooks/useRunner'
import { useMedia } from '../hooks/useMedia'
import { afterViewportSettles } from '../ui/viewport'
import { runShortcutLabel } from '../ui/shortcut'
import { ProgressBlock } from './ProgressBlock'
import { IconArrowRight, IconChevronDown, IconTerminal } from './ui/Icons'
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
 * The console is a transcript, not a log viewer (spec §7.3). Row treatment —
 * a 3px leading rule and a row tint, never colour alone — lives in
 * `.console-row[data-kind]`; per-segment colour lives in `[data-seg]`, which is
 * what lets `Your name: Saad` be one visual line in two colours.
 */
export function Console({
  buffer,
  status,
  exitCode = null,
  progress,
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
  const narrow = useMedia('(max-width: 899px)')
  const waiting = status === 'waiting'
  const busy = status === 'preparing' || status === 'running' || status === 'waiting'
  const cleared = useJustCleared(snapshot.lines.length)

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
  }, [snapshot, progress, showAll, scrollToBottom])

  // A new run (or Clear) empties the transcript: follow it again, and fold the
  // render window back down.
  useEffect(() => {
    if (snapshot.lines.length > 0) return
    stick.current = true
    setPausedAt(null)
    setShowAll(false)
  }, [snapshot])

  useEffect(() => {
    bindStdinFocus(() => inputRef.current?.focus())
    return () => bindStdinFocus(null)
  }, [bindStdinFocus])

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
    if (result === 'queued') onNotify(COPY.stdinQueued)
    else if (result === 'ignored') onNotify(COPY.stdinIdle, 'error')
  }

  const lines = snapshot.lines
  const hidden = showAll ? 0 : Math.max(0, lines.length - RENDER_WINDOW)
  const visible = hidden > 0 ? lines.slice(hidden) : lines
  const unseen = pausedAt === null ? 0 : countAfter(lines, pausedAt)
  const empty = lines.length === 0 && !progress

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-state={status}>
      {/* Anchor for the resume pill, which has to float over the transcript
          rather than scroll away inside it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollerRef}
          onScroll={onScroll}
          className="scroller console-transcript"
          role="log"
          aria-live="polite"
          aria-atomic="false"
          aria-label="Program output"
        >
          {progress ? <ProgressBlock progress={progress} /> : null}

          {snapshot.truncated ? (
            <Row line={{ id: -1, kind: 'meta', complete: true, segments: [{ kind: 'meta', text: COPY.truncated }] }} />
          ) : null}

          {hidden > 0 ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="tap mb-1 inline-flex min-h-touch items-center rounded-md border border-border-control bg-surface-3 px-3 font-ui text-meta text-text-2 hover:bg-surface-4 hover:text-text-1 active:scale-[.97]"
            >
              {COPY.showEarlier(hidden)}
            </button>
          ) : null}

          {empty ? (
            <div className="empty empty--console">
              <IconTerminal size={32} className="empty__glyph" />
              <p className="empty__body">{cleared ? COPY.consoleCleared : COPY.consoleEmpty}</p>
            </div>
          ) : (
            visible.map((line) => <Row key={line.id} line={line} />)
          )}
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
            className={
              'tap absolute bottom-3 right-3 z-10 inline-flex min-h-touch items-center gap-2 rounded-pill ' +
              'border px-4 font-ui text-micro font-semibold shadow-raised active:scale-[.97] ' +
              (unseen > 0
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border-control bg-surface-3 text-text-2 hover:text-text-1')
            }
          >
            <IconChevronDown size={16} />
            {unseen > 0 ? COPY.newLines(unseen) : COPY.jumpToLatest}
          </button>
        ) : null}
      </div>

      {/* Sticky so the keyboard can never cover it (spec §4.3 rule 1). */}
      <div
        className={'stdin-row ' + (waiting ? 'border-t-2 border-t-info' : '')}
        data-waiting={waiting ? 'true' : 'false'}
      >
        <StatusLine status={status} exitCode={exitCode} narrow={narrow} />

        <form
          className="stdin-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <span aria-hidden="true" className="stdin-caret">
            ›
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // Nothing is running: the row says so in place rather than taking a
            // line the program will never read (§7.4 — disabled is a colour
            // change, never a fade).
            disabled={!busy}
            placeholder={
              waiting
                ? COPY.stdinWaitingPlaceholder
                : busy
                  ? COPY.stdinAheadPlaceholder
                  : COPY.stdinIdlePlaceholder
            }
            aria-label="Program input"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            className="stdin-input disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-2 disabled:text-text-disabled disabled:placeholder:text-text-disabled"
          />
          {/* Enter submits; a 44px button is the discoverable half of that on a
              touch screen, where "press Enter" means finding it on a keyboard
              that has relabelled the key. */}
          <button
            type="submit"
            disabled={!busy}
            aria-label={COPY.sendToProgram}
            title={COPY.sendToProgram}
            className={
              'tap inline-grid size-touch shrink-0 place-items-center rounded-md border ' +
              'disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface-2 disabled:text-text-disabled ' +
              (waiting
                ? 'border-info bg-info-soft text-info'
                : 'border-border-control bg-surface-4 text-text-2 hover:text-text-1')
            }
          >
            <IconArrowRight />
          </button>
        </form>
      </div>
    </div>
  )
}

/** Per-state tone for the status line. Every state has a glyph and a word. */
const statusTone: Record<RunStatus, { glyph: string; className: string; live: boolean }> = {
  idle: { glyph: '○', className: 'text-text-3', live: false },
  preparing: { glyph: '●', className: 'text-warn', live: true },
  running: { glyph: '●', className: 'text-success', live: true },
  waiting: { glyph: '▸', className: 'text-info font-semibold', live: true },
  ok: { glyph: '✓', className: 'text-success', live: false },
  failed: { glyph: '✕', className: 'text-danger', live: false },
  stopped: { glyph: '■', className: 'text-text-2', live: false },
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
 * The line between the transcript and the input row: what the program is doing
 * *now*, in a sentence, in the state's own tone.
 *
 * The header pill is a badge — a glyph and a word, readable when the console is
 * collapsed. This is the sentence that tells a beginner what to do about it, and
 * it sits directly above the input row because "waiting for your answer" is the
 * one state where the next action is *here*. §10.5 of ACCEPTANCE is exactly this
 * confusion: waiting-for-input must never read as loading.
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
    <p
      role="status"
      aria-live="polite"
      data-state={status}
      title={text}
      className={'flex items-center gap-2 px-panel pt-1 font-ui text-micro leading-snug ' + tone.className}
    >
      <span
        aria-hidden="true"
        // text-micro (12px), not 10px: §3.2 makes 12px the floor for everything
        // in the app, and the review checklist measures it.
        className={'shrink-0 text-micro leading-none ' + (tone.live ? 'animate-pulse motion-reduce:animate-none' : '')}
      >
        {tone.glyph}
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
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
          : line.segments.map((seg, i) => (
              // An echoed answer that joined an open prompt ("Your name: Saad")
              // shares its row with stdout, so the row's leading rule cannot
              // separate them: italic is what keeps the student's own typing
              // distinguishable there with no colour vision at all.
              <span key={i} data-seg={seg.kind} className={seg.kind === 'echo' ? 'italic' : undefined}>
                {seg.text}
              </span>
            ))}
      </span>
    </div>
  )
})
