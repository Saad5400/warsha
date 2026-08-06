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
 *  5. A paced reveal. A fast program prints its whole life in two milliseconds,
 *     which lands as one flush and *looks* like nothing ran. The buffer holds
 *     lines back and reveals them at terminal-scroll speed instead — see
 *     REVEAL_PER_FLUSH — while `toText()` and the caps keep working on the real
 *     transcript, so Copy is never a lie and memory is never the show's hostage.
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
 * A cap on the transcript in characters, not just lines.
 *
 * Java has no output cap at all (its INTEGRATION.md says so) — `while (true)
 * System.out.print("x");` is 5,000 lines of nothing plus one line that grows
 * until the tab dies. Lines bound the reconciliation cost; characters bound the heap.
 */
const MAX_CHARS = 4 * 1024 * 1024

/**
 * How long one line may get before it is closed against its will.
 *
 * Printing without newlines reallocates one string forever — a rendering and
 * GC cost long before it's a memory cost. Wrapping is cosmetically wrong for a
 * terminal and correct for everything else here.
 */
const MAX_LINE_CHARS = 16 * 1024
/** Upper bound on flush latency when requestAnimationFrame is throttled. */
const FALLBACK_FLUSH_MS = 100

/**
 * How many lines one flush may reveal (founder ruling 2026-08-05: bursts
 * should *scroll*, not appear).
 *
 * 4/frame at 60fps reads as a fast terminal, visibly scrolling but not
 * throttled-feeling. Kept ≤ the Console's FRESH_MAX_BATCH (8) so every batch
 * still gets the existing fade-in, with no new animation path for §9 to worry about.
 */
const REVEAL_PER_FLUSH = 4

/**
 * The backlog beyond which pacing gives up and snaps to caught-up.
 *
 * The reveal must never owe more than a few seconds of playback: 1200 lines
 * at REVEAL_PER_FLUSH·60fps is a 5-second worst case. A 100k-line dump or a
 * hot `while (true) print` blows through this in one frame and shows
 * everything at once — past FRESH_MAX_BATCH, so nothing animates (§9's burst
 * protection, untouched). A 1000-line homework loop stays under it and scrolls.
 */
const MAX_REVEAL_BACKLOG = 1200

/**
 * The paced reveal IS motion — a scripted scroll up to 5s — so
 * `prefers-reduced-motion` turns it off entirely (§10), not just the per-line
 * fade. Grabbed once; `.matches` reads live each flush, so a mid-session OS
 * flip takes effect next frame with no listener needed.
 */
const reducedMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

/**
 * The buffer the console header's "Copy output" reads.
 *
 * App.tsx holds the one transcript in a ref; the header is a sibling that
 * needs the same text without threading the buffer through the layout.
 * Newest instance wins — there's only ever one anyway.
 */
let active: ConsoleBuffer | null = null
export const activeBuffer = (): ConsoleBuffer | null => active

export class ConsoleBuffer {
  private lines: ConsoleLine[] = []
  private truncated = false
  private nextId = 1
  /** Running total of characters held, so `trim()` costs O(1) per write. */
  private chars = 0
  /**
   * How many of `lines` the snapshot may show — the rest is backlog being
   * paced out. Only the *view* lags; writes, caps, `toText()` and
   * `hasOpenLine` all use the full transcript.
   */
  private revealed = 0
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
      // Closed here once it's long enough to be a problem, so the next chunk
      // starts fresh — a wrap beats a multi-megabyte text node.
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
   * Echoes a line the program received. Joins an open prompt so it reads
   * `Your name: Warsha` like a real terminal; otherwise starts its own line
   * with the `› ` marker.
   */
  echo(text: string) {
    this.write(this.hasOpenLine ? `${text}\n` : `› ${text}\n`, 'echo')
  }

  clear() {
    this.lines = []
    this.truncated = false
    this.chars = 0
    this.revealed = 0
    this.flush()
  }

  /**
   * Abandons the paced reveal and shows everything now — for moments the show
   * must not delay the truth: Stop (must be honest immediately), a stdin
   * request (the prompt it joins must already be visible), or an abandoned
   * run. The runner calls this; the buffer can't know these moments itself.
   */
  catchUp() {
    if (this.revealed >= this.lines.length) return
    this.revealed = this.lines.length
    this.flush()
  }

  /**
   * The whole transcript as plain text — what "Copy output" puts on the
   * clipboard (ACCEPTANCE §10.10). Reads live lines, not the flushed
   * snapshot, so a copy is never a frame stale or short by whatever the
   * reveal hasn't caught up to.
   */
  toText(): string {
    const body = this.lines.map((l) => l.segments.map((s) => s.text).join('')).join('\n')
    return this.truncated ? `[earlier output hidden — ${MAX_LINES}-line limit]\n${body}` : body
  }

  private trim() {
    if (this.lines.length > MAX_LINES) {
      for (const dropped of this.lines.splice(0, DROP_CHUNK)) this.chars -= lineLength(dropped) + 1
      this.revealed = Math.max(0, this.revealed - DROP_CHUNK)
      this.truncated = true
    }
    // Character budget, dropped in chunks for the same reason as lines — a
    // one-at-a-time shift on every write would itself be the jank batching exists to avoid.
    while (this.chars > MAX_CHARS && this.lines.length > DROP_CHUNK) {
      for (const dropped of this.lines.splice(0, DROP_CHUNK)) this.chars -= lineLength(dropped) + 1
      this.revealed = Math.max(0, this.revealed - DROP_CHUNK)
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
    // …but a backgrounded tab stops firing rAF, and unflushed output reads as
    // "it hung". The timer guarantees a flush; whichever fires first wins and cancels the other.
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
    const total = this.lines.length
    if (this.revealed < total) {
      // A hidden tab shows the show to nobody and its rAF is suspended anyway,
      // so pacing there would replay minutes of backlog on return — snap instead.
      const snap =
        this.revealed + MAX_REVEAL_BACKLOG < total ||
        document.visibilityState === 'hidden' ||
        reducedMotion?.matches === true
      this.revealed = snap ? total : Math.min(total, this.revealed + REVEAL_PER_FLUSH)
    }
    this.snapshot = { lines: this.lines.slice(0, this.revealed), truncated: this.truncated }
    for (const fn of this.listeners) fn()
    // Still owing lines: keep the frame chain alive until the view has caught
    // up. Writes only schedule on arrival, so the reveal must drive itself.
    if (this.revealed < this.lines.length) this.schedule()
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
