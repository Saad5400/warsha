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

/**
 * A cap on the transcript in characters, not just in lines.
 *
 * 5,000 lines is not a bound on memory. The Python worker stops forwarding at
 * 2 MiB per run, but **the Java runtime has no output cap at all** (its
 * INTEGRATION.md says so), so `while (true) System.out.print("x");` is 5,000
 * lines' worth of nothing and one line that grows until the tab dies. Both caps
 * are needed: lines bound the reconciliation cost, characters bound the heap.
 */
const MAX_CHARS = 4 * 1024 * 1024

/**
 * How long one line may get before it is closed against its will.
 *
 * A program printing without newlines appends to a single string forever, and
 * every append reallocates it — so this is a rendering cost (one DOM text node
 * of megabytes) and a GC cost long before it is a memory cost. Wrapping is
 * cosmetically wrong for a terminal and correct for everything else here.
 */
const MAX_LINE_CHARS = 16 * 1024
/** Upper bound on flush latency when requestAnimationFrame is throttled. */
const FALLBACK_FLUSH_MS = 100

/**
 * The buffer the console header's "Copy output" reads.
 *
 * The app builds exactly one transcript (App.tsx holds it in a ref) and hands it
 * to the Console; the header — a sibling component — needs the same text without
 * the buffer being threaded through the layout that renders both. The newest
 * instance wins, which is the only sensible answer when there is only ever one.
 */
let active: ConsoleBuffer | null = null
export const activeBuffer = (): ConsoleBuffer | null => active

export class ConsoleBuffer {
  private lines: ConsoleLine[] = []
  private truncated = false
  private nextId = 1
  /** Running total of characters held, so `trim()` costs O(1) per write. */
  private chars = 0
  private snapshot: ConsoleSnapshot = { lines: [], truncated: false }
  private listeners = new Set<() => void>()
  private frame = 0
  private timer = 0

  constructor() {
    active = this
  }

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
      // An open line long enough to be a problem is closed here, so the chunk
      // below starts a fresh one. The student sees a wrap; the alternative is a
      // single multi-megabyte text node.
      const openAndFull = last && !last.complete && lineLength(last) + text.length > MAX_LINE_CHARS
      if (openAndFull) last.complete = true

      this.chars += text.length + (closes ? 1 : 0)

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
    this.chars = 0
    this.flush()
  }

  /**
   * The whole transcript as plain text, newlines preserved — what "Copy output"
   * puts on the clipboard so a student can paste an error to a friend
   * (ACCEPTANCE §10.10). Reads the live lines, not the flushed snapshot, so a
   * copy during a burst is not one frame stale.
   */
  toText(): string {
    const body = this.lines.map((l) => l.segments.map((s) => s.text).join('')).join('\n')
    return this.truncated ? `[earlier output hidden — ${MAX_LINES}-line limit]\n${body}` : body
  }

  private trim() {
    if (this.lines.length > MAX_LINES) {
      for (const dropped of this.lines.splice(0, DROP_CHUNK)) this.chars -= lineLength(dropped) + 1
      this.truncated = true
    }
    // Character budget. Dropped in chunks for the same reason as lines: a
    // one-at-a-time shift on every write of a tight print loop is itself the
    // jank the batching exists to avoid.
    while (this.chars > MAX_CHARS && this.lines.length > DROP_CHUNK) {
      for (const dropped of this.lines.splice(0, DROP_CHUNK)) this.chars -= lineLength(dropped) + 1
      this.truncated = true
    }
    if (this.chars < 0) this.chars = 0
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

function lineLength(line: ConsoleLine): number {
  let n = 0
  for (const s of line.segments) n += s.text.length
  return n
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
