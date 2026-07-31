import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ConsoleBuffer, ConsoleLine, LineKind } from '../console/buffer'
import type { LoadProgress } from '../runtime/types'
import type { RunStatus } from '../hooks/useRunner'
import { ProgressBlock } from './ProgressBlock'
import { IconTerminal } from './ui/Icons'
import { COPY } from '../copy'

export interface ConsoleProps {
  buffer: ConsoleBuffer
  status: RunStatus
  progress: LoadProgress | null
  /** Registers a focus callback so the runner can focus the input on demand. */
  bindStdinFocus(fn: (() => void) | null): void
  onSubmitStdin(line: string): 'sent' | 'queued' | 'ignored'
  onNotify(message: string, kind?: 'info' | 'error'): void
}

/**
 * The console is a transcript, not a log viewer (spec §7.3). Row treatment —
 * a 3px leading rule and a row tint, never colour alone — lives in
 * `.console-row[data-kind]`; per-segment colour lives in `[data-seg]`, which is
 * what lets `Your name: Saad` be one visual line in two colours.
 */
export function Console({
  buffer,
  status,
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
  const waiting = status === 'waiting'
  const cleared = useJustCleared(snapshot.lines.length)

  // Auto-scroll only when already near the bottom: a student reading a stack
  // trace mid-scroll must not be yanked away by late output.
  const onScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }, [])

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [snapshot, progress])

  useEffect(() => {
    bindStdinFocus(() => inputRef.current?.focus())
    return () => bindStdinFocus(null)
  }, [bindStdinFocus])

  const submit = () => {
    const line = value
    setValue('')
    const result = onSubmitStdin(line)
    if (result === 'queued') onNotify(COPY.stdinQueued)
    else if (result === 'ignored') onNotify(COPY.stdinIdle, 'error')
  }

  const empty = snapshot.lines.length === 0 && !progress

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-state={status}>
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
          <Row kind="meta" segments={[{ kind: 'meta', text: COPY.truncated }]} />
        ) : null}

        {empty ? (
          <div className="empty empty--console">
            <IconTerminal size={32} className="empty__glyph" />
            <p className="empty__body">{cleared ? 'Cleared.' : COPY.consoleEmpty}</p>
          </div>
        ) : (
          snapshot.lines.map((line) => <Row key={line.id} kind={line.kind} segments={line.segments} />)
        )}
      </div>

      {/* Sticky so the keyboard can never cover it (spec §4.3 rule 1). */}
      <div className="stdin-row" data-waiting={waiting ? 'true' : 'false'}>
        {waiting ? (
          <p className="stdin-hint" role="status">
            {COPY.stdinHint}
          </p>
        ) : null}
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
            placeholder={waiting ? 'Type your answer, then press Enter' : 'Program input'}
            aria-label="Program input"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            className="stdin-input"
          />
        </form>
      </div>
    </div>
  )
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

function Row({ kind, segments }: { kind: LineKind; segments: ConsoleLine['segments'] }) {
  return (
    <div data-kind={kind} className="console-row">
      <span className="console-row__text">
        {segments.length === 0
          ? ' '
          : segments.map((seg, i) => (
              <span key={i} data-seg={seg.kind}>
                {seg.text}
              </span>
            ))}
      </span>
    </div>
  )
}
