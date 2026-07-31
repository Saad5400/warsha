/**
 * The console transcript.
 *
 * Plain TS on purpose — no React in here — because the hard requirements have
 * nothing to do with the view layer (DESIGN-SPEC §4.4/§7.3, plus the behaviour
 * notes in runtimes/python/INTEGRATION.md):
 *
 *  1. Chunks, not lines. A program printing "Your name: " with no newline must
 *     appear immediately, with the input row right after it. So a chunk appends to
 *     the trailing line and only a "\n" closes it.
 *  2. Segments within a line. The answer a student types has to land on the SAME
 *     visual line as the prompt ("Your name: Warsha") while still being styled
 *     differently — so a line is a list of styled spans, not one span with one kind.
 *  3. Batched notification. The engines emit one callback per write (a worker
 *     blocked in runPython cannot flush on a timer), so `while True: print(i)`
 *     would otherwise cause DOM jank.
 *  4. A head-dropping cap, and it says so when it drops.
 */

export type LineKind = 'out' | 'err' | 'echo' | 'meta'

export interface Segment {
  kind: LineKind
  text: string
}

export interface ConsoleLine {
  id: number
  segments: Segment[]
  /** Row-level styling: 'err' if any segment is stderr, else the opening kind. */
  kind: LineKind
  /** false while the program may still append to this line (no newline yet). */
  complete: boolean
}

export interface ConsoleSnapshot {
  lines: ConsoleLine[]
  /** True once the cap dropped anything, so the view can say so. */
  truncated: boolean
}

const MAX_LINES = 5000
const DROP_CHUNK = 500
/** Upper bound on flush latency when requestAnimationFrame is throttled. */
const FALLBACK_FLUSH_MS = 100

export class ConsoleBuffer {
  private lines: ConsoleLine[] = []
  private truncated = false
  private nextId = 1
  private snapshot: ConsoleSnapshot = { lines: [], truncated: false }
  private listeners = new Set<() => void>()
  private frame = 0
  private timer = 0

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Stable snapshot for useSyncExternalStore — identity changes only on flush. */
  getSnapshot = (): ConsoleSnapshot => this.snapshot

  /** True when the trailing line is still open, i.e. a prompt is awaiting input. */
  get hasOpenLine(): boolean {
    const last = this.lines[this.lines.length - 1]
    return !!last && !last.complete
  }

  write(chunk: string, kind: LineKind = 'out') {
    if (!chunk) return
    const parts = chunk.split('\n')
    for (let i = 0; i < parts.length; i++) {
      const text = parts[i]
      const closes = i < parts.length - 1
      const last = this.lines[this.lines.length - 1]
      if (last && !last.complete) {
        // New objects rather than mutation: the view keys off identity to
        // re-render just this row.
        this.lines[this.lines.length - 1] = {
          ...last,
          segments: appendSegment(last.segments, kind, text),
          kind: last.kind === 'err' || kind === 'err' ? 'err' : last.kind,
          complete: closes,
        }
      } else if (text !== '' || closes) {
        this.lines.push({
          id: this.nextId++,
          segments: text === '' ? [] : [{ kind, text }],
          kind,
          complete: closes,
        })
      }
    }
    this.trim()
    this.schedule()
  }

  /** A whole line, newline implied. */
  line(text: string, kind: LineKind = 'out') {
    this.write(text.endsWith('\n') ? text : text + '\n', kind)
  }

  /**
   * Echo a line the program actually received. If a prompt is still open the
   * answer joins it, so the transcript reads `Your name: Warsha` the way a
   * terminal would; otherwise it starts its own line and takes the `› ` marker.
   */
  echo(text: string) {
    this.write(this.hasOpenLine ? `${text}\n` : `› ${text}\n`, 'echo')
  }

  clear() {
    this.lines = []
    this.truncated = false
    this.flush()
  }

  private trim() {
    if (this.lines.length <= MAX_LINES) return
    this.lines.splice(0, DROP_CHUNK)
    this.truncated = true
  }

  private schedule() {
    if (this.frame || this.timer) return
    // A frame coalesces bursts while the tab is visible…
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.flush()
    })
    // …but a backgrounded or occluded tab stops firing rAF entirely, and output
    // that is never flushed reads to a student as "it hung". The timer is the
    // guarantee; whichever fires first wins and cancels the other.
    this.timer = window.setTimeout(() => {
      this.timer = 0
      this.flush()
    }, FALLBACK_FLUSH_MS)
  }

  private flush() {
    if (this.frame) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    }
    this.snapshot = { lines: this.lines.slice(), truncated: this.truncated }
    for (const fn of this.listeners) fn()
  }
}

/** Merges into the trailing segment when the kind matches, else appends one. */
function appendSegment(segments: readonly Segment[], kind: LineKind, text: string): Segment[] {
  if (text === '') return segments.slice()
  const last = segments[segments.length - 1]
  if (last && last.kind === kind) {
    const next = segments.slice(0, -1)
    next.push({ kind, text: last.text + text })
    return next
  }
  return [...segments, { kind, text }]
}
