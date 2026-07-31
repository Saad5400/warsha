import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ConsoleBuffer, ConsoleLine, LineKind } from '../console/buffer'
import type { LoadProgress } from '../runtime/types'
import type { RunStatus } from '../hooks/useRunner'
import { ProgressBlock } from './ProgressBlock'
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

/** Row treatment: a leading rule and tint, not just a colour — survives greyscale (§7.3). */
const rowClass: Record<LineKind, string> = {
  out: 'border-transparent',
  err: 'border-danger bg-danger-soft/55',
  echo: 'border-info',
  meta: 'border-transparent',
}

/** Per-segment text treatment, so an answer can differ from its prompt inline. */
const segmentClass: Record<LineKind, string> = {
  out: 'text-text-1',
  err: 'text-danger',
  echo: 'text-info',
  meta: 'text-text-3 italic',
}

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

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-state={status}>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="scroller flex-1 px-panel py-2 font-code text-console"
        role="log"
        aria-live="polite"
        aria-label="Program output"
      >
        {progress ? <ProgressBlock progress={progress} /> : null}

        {snapshot.truncated ? (
          <Row kind="meta" segments={[{ kind: 'meta', text: COPY.truncated }]} />
        ) : null}

        {snapshot.lines.length === 0 && !progress ? (
          <p className="text-console text-text-3">{COPY.consoleEmpty}</p>
        ) : (
          snapshot.lines.map((line) => <Row key={line.id} kind={line.kind} segments={line.segments} />)
        )}
      </div>

      {/* Sticky so the keyboard can never cover it (spec §4.3 rule 1). */}
      <div className="sticky bottom-0 shrink-0 border-t border-border-subtle bg-surface-2">
        {waiting ? (
          <p className="px-panel pt-1 text-micro text-info" role="status">
            {COPY.stdinHint}
          </p>
        ) : null}
        <form
          className="flex items-center gap-2 px-panel py-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <span aria-hidden="true" className={'font-code text-console ' + (waiting ? 'text-info' : 'text-text-3')}>
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
            // Waiting is signalled by an accent border plus the hint above, not
            // by a fill change alone.
            className={
              'min-h-touch min-w-0 flex-1 rounded-sm border bg-surface-4 px-3 font-code text-input text-text-1 ' +
              'placeholder:text-text-3 focus:outline-none ' +
              (waiting ? 'border-info' : 'border-border-control')
            }
          />
        </form>
      </div>
    </div>
  )
}

function Row({ kind, segments }: { kind: LineKind; segments: ConsoleLine['segments'] }) {
  return (
    <div data-kind={kind} className={`flex border-l-[3px] pl-2 ${rowClass[kind]}`}>
      {/* Wrapped continuations indent 12px so a wrap reads differently from a
          genuine new line; never horizontal-scroll the console. */}
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pl-3 -indent-3 [tab-size:4]">
        {segments.length === 0
          ? ' '
          : segments.map((seg, i) => (
              <span key={i} data-seg={seg.kind} className={segmentClass[seg.kind]}>
                {seg.text}
              </span>
            ))}
      </span>
    </div>
  )
}
