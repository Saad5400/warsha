/**
 * The debugger, as the editor shows it — VS Code's glyph margin and friends:
 *   - a breakpoint gutter left of the line numbers: click (or tap a line
 *     number) to toggle a red dot; hover previews a faint one; disabled
 *     breakpoints draw hollow. Dots ride along with edits (lines inserted
 *     above move them) and the moved lines flow back to the debug store.
 *   - the stop: a yellow arrow in that gutter and a highlighted line where
 *     execution is parked; a green band on the line of a selected caller frame.
 *   - inline values: `x = 5` after the lines of the current function that
 *     mention a local, VS Code's "debug.inlineValues".
 *   - hover a variable while paused → its value, expandable.
 *   - on touch the glyph margin is gone (18px a phone can't spare): the line
 *     number itself turns into the dot / the stop tag (`gutterLineClass`).
 *
 * Reads/writes src/debug/store.ts; the store is outside CodeMirror, so a
 * plugin subscribes to it and turns each change into an effect.
 */
import { RangeSet, StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  WidgetType,
  gutter,
  gutterLineClass,
  hoverTooltip,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { canHoldBreakpoints, debugStore, type DebugState } from '../debug/store'
import type { DebugFrame, DebugValue } from '../runtime/debug'

// ---- breakpoints ----

class BreakpointMarker extends GutterMarker {
  constructor(readonly enabled: boolean) {
    super()
  }
  eq(other: BreakpointMarker) {
    return other.enabled === this.enabled
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = this.enabled ? 'cm-bp' : 'cm-bp cm-bp--off'
    return el
  }
}
const BP_ON = new BreakpointMarker(true)
const BP_OFF = new BreakpointMarker(false)

/** VS Code's stack-frame tag; on a line that also has a breakpoint, the dot rides inside it. */
class StopArrowMarker extends GutterMarker {
  constructor(
    readonly top: boolean,
    readonly withBp: boolean,
  ) {
    super()
  }
  eq(o: StopArrowMarker) {
    return o.top === this.top && o.withBp === this.withBp
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = this.top ? 'cm-stop-arrow' : 'cm-stop-arrow cm-stop-arrow--frame'
    el.innerHTML =
      '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 4.25h6.55a1 1 0 0 1 .7.29l3.22 3.08a.53.53 0 0 1 0 .76l-3.22 3.08a1 1 0 0 1-.7.29H3a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1Z" fill="currentColor"/>' +
      (this.withBp ? '<circle cx="6.6" cy="8" r="2" fill="var(--debug-bp)"/>' : '') +
      '</svg>'
    return el
  }
}
const ARROW_TOP = new StopArrowMarker(true, false)
const ARROW_TOP_BP = new StopArrowMarker(true, true)
const ARROW_FRAME = new StopArrowMarker(false, false)
const ARROW_FRAME_BP = new StopArrowMarker(false, true)

/** Touch: the line number wears the state (the margin is hidden there). */
class LineState extends GutterMarker {
  constructor(readonly elementClass: string) {
    super()
  }
  eq(o: LineState) {
    return o.elementClass === this.elementClass
  }
}
const lineStateCache = new Map<string, LineState>()
const lineState = (cls: string) => {
  let m = lineStateCache.get(cls)
  if (!m) lineStateCache.set(cls, (m = new LineState(cls)))
  return m
}

/** Replace the file's breakpoints with the store's (store → editor). */
const setBps = StateEffect.define<{ line: number; enabled: boolean }[]>()

function buildBps(doc: EditorView['state']['doc'], entries: { line: number; enabled: boolean }[]) {
  const ranges: Range<BreakpointMarker>[] = []
  for (const e of entries) {
    if (e.line < 1 || e.line > doc.lines) continue
    ranges.push((e.enabled ? BP_ON : BP_OFF).range(doc.line(e.line).from))
  }
  return RangeSet.of(ranges, true)
}

function readBps(set: RangeSet<BreakpointMarker>, doc: EditorView['state']['doc']) {
  const out: { line: number; enabled: boolean }[] = []
  const seen = new Set<number>()
  set.between(0, doc.length, (from, _to, m) => {
    const line = doc.lineAt(from).number
    if (!seen.has(line)) {
      seen.add(line)
      out.push({ line, enabled: m.enabled })
    }
  })
  return out
}

// ---- the stop / frame look ----

interface DebugLook {
  /** Line where execution is parked, if it is in this file. */
  stopLine: number | null
  /** Line of the selected caller frame (not the top), if in this file. */
  frameLine: number | null
  /** line → "a = 1  b = [1, 2]" */
  inline: Map<number, string>
}
const EMPTY_LOOK: DebugLook = { stopLine: null, frameLine: null, inline: new Map() }
const setLook = StateEffect.define<DebugLook>()

class InlineValueWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(o: InlineValueWidget) {
    return o.text === this.text
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-inline-value'
    el.textContent = this.text
    return el
  }
  ignoreEvent() {
    return true
  }
}

const stopLineDeco = Decoration.line({ class: 'cm-debug-stop-line' })
const frameLineDeco = Decoration.line({ class: 'cm-debug-frame-line' })

function lookDecorations(look: DebugLook, doc: EditorView['state']['doc']): DecorationSet {
  const ranges: Range<Decoration>[] = []
  if (look.stopLine && look.stopLine <= doc.lines) ranges.push(stopLineDeco.range(doc.line(look.stopLine).from))
  if (look.frameLine && look.frameLine <= doc.lines) ranges.push(frameLineDeco.range(doc.line(look.frameLine).from))
  for (const [ln, text] of look.inline) {
    if (ln > doc.lines) continue
    ranges.push(Decoration.widget({ widget: new InlineValueWidget(text), side: 1 }).range(doc.line(ln).to))
  }
  return Decoration.set(ranges, true)
}

const INLINE_WINDOW = 60
const INLINE_MAX = 64

/** VS Code's inline values: each local shown once, on the nearest line at or above the stop that mentions it. */
function inlineValues(frame: DebugFrame, doc: EditorView['state']['doc']): Map<number, string> {
  const out = new Map<number, string[]>()
  const vars: DebugValue[] = []
  for (const s of frame.scopes) if (!s.expensive) for (const v of s.variables) if (/^[A-Za-z_$][\w$]*$/.test(v.name)) vars.push(v)
  if (!vars.length || frame.line > doc.lines) return new Map()
  const first = Math.max(1, frame.line - INLINE_WINDOW)
  for (const v of vars) {
    const re = new RegExp(`(^|[^\\w$])${v.name.replace(/\$/g, '\\$')}(?![\\w$])`)
    for (let ln = frame.line; ln >= first; ln--) {
      const text = doc.line(ln).text
      if (/^\s*(\/\/|#)/.test(text)) continue
      if (re.test(text)) {
        const shown = v.value.length > INLINE_MAX ? v.value.slice(0, INLINE_MAX - 1) + '…' : v.value
        const list = out.get(ln) ?? []
        list.push(`${v.name} = ${shown}`)
        out.set(ln, list)
        break
      }
    }
  }
  return new Map([...out].map(([ln, parts]) => [ln, parts.join('  ')]))
}

function lookFor(path: string, s: DebugState, doc: EditorView['state']['doc']): DebugLook {
  if (s.phase !== 'paused' || !s.stopped) return EMPTY_LOOK
  const frames = s.stopped.frames
  const top = frames[0]
  const sel = frames[s.frameIndex]
  return {
    stopLine: top && top.path === path ? top.line : null,
    frameLine: sel && s.frameIndex > 0 && sel.path === path ? sel.line : null,
    inline: sel && sel.path === path ? inlineValues(sel, doc) : new Map(),
  }
}

function sameLook(a: DebugLook, b: DebugLook) {
  if (a.stopLine !== b.stopLine || a.frameLine !== b.frameLine || a.inline.size !== b.inline.size) return false
  for (const [k, v] of a.inline) if (b.inline.get(k) !== v) return false
  return true
}

// ---- hover ----

export function renderValueTree(v: DebugValue, depth = 0): HTMLElement {
  const row = document.createElement('div')
  row.className = 'cm-debug-hover-row'
  row.style.paddingInlineStart = `${depth * 12}px`
  const expandable = !!(v.ref || v.children?.length)
  const twisty = document.createElement('span')
  twisty.className = 'cm-debug-twisty'
  twisty.textContent = expandable ? '▸' : ''
  const name = document.createElement('span')
  name.className = 'cm-debug-hover-name'
  name.textContent = v.name
  const sep = document.createElement('span')
  sep.textContent = ': '
  sep.className = 'cm-debug-hover-sep'
  const val = document.createElement('span')
  val.className = 'cm-debug-hover-value'
  val.textContent = v.value
  if (v.type) val.title = v.type
  const head = document.createElement('div')
  head.className = 'cm-debug-hover-head'
  head.append(twisty, name, sep, val)
  row.append(head)
  if (expandable) {
    let kids: HTMLElement | null = null
    head.style.cursor = 'pointer'
    head.addEventListener('mousedown', (e) => e.preventDefault())
    head.addEventListener('click', () => {
      if (kids) {
        kids.remove()
        kids = null
        twisty.textContent = '▸'
        return
      }
      twisty.textContent = '▾'
      const box = document.createElement('div')
      kids = box
      row.append(box)
      void debugStore.childrenOf(v).then((children) => {
        if (kids !== box) return
        if (!children.length) {
          const empty = document.createElement('div')
          empty.className = 'cm-debug-hover-empty'
          empty.style.paddingInlineStart = `${(depth + 1) * 12 + 14}px`
          empty.textContent = '(empty)'
          box.append(empty)
        }
        for (const c of children) box.append(renderValueTree(c, depth + 1))
      })
    })
  }
  return row
}

function findVariable(frame: DebugFrame, name: string): DebugValue | undefined {
  for (const s of frame.scopes) {
    const v = s.variables.find((x) => x.name === name)
    if (v) return v
  }
  return undefined
}

const debugHover = (path: string) =>
  hoverTooltip(
    (view, pos) => {
      const s = debugStore.get()
      if (s.phase !== 'paused') return null
      const frame = debugStore.currentFrame()
      if (!frame || frame.path !== path) return null
      const word = view.state.wordAt(pos)
      if (!word) return null
      // Include a `obj.` prefix chain: hovering `y` in `p.y` shows p.y.
      const line = view.state.doc.lineAt(pos)
      let start = word.from
      const before = line.text.slice(0, start - line.from)
      const chain = /((?:[A-Za-z_$][\w$]*\s*(?:\.|->)\s*)+)$/.exec(before)
      if (chain) start -= chain[1].length
      const expr = view.state.sliceDoc(start, word.to).replace(/\s+/g, '')
      const name = view.state.sliceDoc(word.from, word.to)
      if (!/^[A-Za-z_$]/.test(name)) return null
      const direct = expr === name ? findVariable(frame, name) : undefined
      return {
        pos: start,
        end: word.to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'cm-debug-hover'
          if (direct) dom.append(renderValueTree(direct))
          else {
            dom.textContent = '…'
            void debugStore
              .evaluate(expr)
              .then((v) => {
                dom.textContent = ''
                dom.append(renderValueTree(v))
              })
              .catch(() => {
                dom.textContent = ''
                dom.classList.add('cm-debug-hover--none')
              })
          }
          return { dom }
        },
      }
    },
    { hoverTime: 250 },
  )

// ---- the extension ----

/** True when a hover at `pos` will be answered by the debugger (hoverDocs stands down). */
export function debugOwnsHover(): boolean {
  return debugStore.get().phase === 'paused'
}

export function debugExtension(path: string): Extension {
  if (!canHoldBreakpoints(path)) return []

  const bpField = StateField.define<RangeSet<BreakpointMarker>>({
    create: (state) => buildBps(state.doc, debugStore.linesFor(path)),
    update(set, tr) {
      set = set.map(tr.changes)
      for (const e of tr.effects) if (e.is(setBps)) set = buildBps(tr.state.doc, e.value)
      return set
    },
  })

  const lookField = StateField.define<{ look: DebugLook; deco: DecorationSet }>({
    create: (state) => {
      const look = lookFor(path, debugStore.get(), state.doc)
      return { look, deco: lookDecorations(look, state.doc) }
    },
    update(v, tr) {
      for (const e of tr.effects) if (e.is(setLook)) return { look: e.value, deco: lookDecorations(e.value, tr.state.doc) }
      return tr.docChanged ? { look: v.look, deco: v.deco.map(tr.changes) } : v
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })

  const toggleAt = (view: EditorView, pos: number) => {
    const line = view.state.doc.lineAt(pos).number
    debugStore.toggleBreakpoint(path, line)
    return true
  }

  // Store → editor: breakpoints edited elsewhere (Breakpoints view, F9) and the stop.
  const sync = ViewPlugin.fromClass(
    class {
      unsub: () => void
      constructor(readonly view: EditorView) {
        this.unsub = debugStore.subscribe(() => this.pull())
        // A cached state (tab switched back to) may predate the latest stop or breakpoint edits.
        this.pull()
      }
      pull() {
        const view = this.view
        const want = debugStore.linesFor(path).map(({ line, enabled }) => ({ line, enabled }))
        const have = readBps(view.state.field(bpField), view.state.doc)
        const effects: StateEffect<unknown>[] = []
        if (want.length !== have.length || want.some((w, i) => w.line !== have[i].line || w.enabled !== have[i].enabled))
          effects.push(setBps.of(want))
        const look = lookFor(path, debugStore.get(), view.state.doc)
        if (!sameLook(look, view.state.field(lookField).look)) effects.push(setLook.of(look))
        // Dispatching from inside another view update is illegal; defer a tick in that case.
        if (effects.length) queueMicrotask(() => {
          if (view.state.field(bpField, false) !== undefined) view.dispatch({ effects })
        })
      }
      update(u: ViewUpdate) {
        // Editor → store: an edit moved (or merged) this file's dots.
        if (u.docChanged) {
          debugStore.replaceFile(path, readBps(u.state.field(bpField), u.state.doc))
          // Inline values follow the text they annotate.
          const look = lookFor(path, debugStore.get(), u.state.doc)
          if (!sameLook(look, u.state.field(lookField).look)) queueMicrotask(() => this.view.dispatch({ effects: setLook.of(look) }))
        }
      }
      destroy() {
        this.unsub()
      }
    },
  )

  const bpGutter = gutter({
    class: 'cm-debug-gutter',
    markers: (v) => v.state.field(bpField),
    lineMarker(view, line) {
      const { look } = view.state.field(lookField)
      const n = view.state.doc.lineAt(line.from).number
      if (n !== look.stopLine && n !== look.frameLine) return null
      let bp = false
      view.state.field(bpField).between(line.from, line.from, (_f, _t, m) => {
        bp = m.enabled
      })
      if (n === look.stopLine) return bp ? ARROW_TOP_BP : ARROW_TOP
      return bp ? ARROW_FRAME_BP : ARROW_FRAME
    },
    lineMarkerChange: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(setLook))) || u.docChanged,
    initialSpacer: () => BP_ON,
    // An element per line, so the hover preview dot has somewhere to draw.
    renderEmptyElements: true,
    domEventHandlers: {
      mousedown: (view, line, event) => {
        if ((event as MouseEvent).button !== 0) return false
        return toggleAt(view, line.from)
      },
    },
  })

  // Same state, as classes on every gutter's element for that line; only the
  // touch line-number rules below read them.
  const lineClasses = gutterLineClass.compute([bpField, lookField], (state) => {
    const { look } = state.field(lookField)
    const doc = state.doc
    const byLine = new Map<number, string[]>()
    const add = (n: number, c: string) => {
      if (n < 1 || n > doc.lines) return
      const list = byLine.get(n) ?? []
      list.push(c)
      byLine.set(n, list)
    }
    state.field(bpField).between(0, doc.length, (from, _t, m) => add(doc.lineAt(from).number, m.enabled ? 'cm-ln-bp' : 'cm-ln-bp-off'))
    if (look.stopLine) add(look.stopLine, 'cm-ln-stop')
    if (look.frameLine) add(look.frameLine, 'cm-ln-frame')
    const ranges = [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([n, cls]) => lineState(cls.join(' ')).range(doc.line(n).from))
    return RangeSet.of(ranges)
  })

  return [bpField, lookField, sync, bpGutter, lineClasses, debugHover(path)]
}

/** Line-number clicks also toggle (a bigger target, especially on touch). */
export function lineNumberToggle(path: string | null) {
  return {
    mousedown: (view: EditorView, line: { from: number }, event: Event) => {
      if (!path || !canHoldBreakpoints(path) || (event as MouseEvent).button !== 0) return false
      debugStore.toggleBreakpoint(path, view.state.doc.lineAt(line.from).number)
      return true
    },
  }
}

/** F9 — toggle at the caret's line. */
export function toggleBreakpointAtCursor(view: EditorView, path: string | null): boolean {
  if (!path || !canHoldBreakpoints(path)) return false
  debugStore.toggleBreakpoint(path, view.state.doc.lineAt(view.state.selection.main.head).number)
  return true
}

/** Styles live here so the whole feature is one file to read. */
export const debugTheme = EditorView.baseTheme({
  '.cm-debug-gutter': { width: '18px' },
  // Touch: no glyph margin — the number carries the dot/stop instead (below).
  // !important: CodeMirror's own .cm-gutter rule forces display:flex.
  '&:not(.cm-desk) .cm-debug-gutter': { display: 'none !important' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement:is(.cm-ln-bp, .cm-ln-bp-off, .cm-ln-stop, .cm-ln-frame)': {
    position: 'relative',
    zIndex: '0',
    // A badge, so its number sits centred in it rather than flush right.
    textAlign: 'center',
  },
  // A pill behind the number, first visual row only (a wrapped line is taller).
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement:is(.cm-ln-bp, .cm-ln-bp-off, .cm-ln-stop, .cm-ln-frame)::before': {
    content: '""',
    position: 'absolute',
    zIndex: '-1',
    insetInline: '1px 2px',
    top: '3px',
    height: 'calc(1lh - 6px)',
    borderRadius: '999px',
  },
  '&:not(.cm-desk) .cm-lineNumbers .cm-ln-bp': { color: '#fff' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-ln-bp::before': { background: 'var(--debug-bp)' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-ln-bp-off::before': { boxShadow: 'inset 0 0 0 1.5px var(--debug-bp-off)' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement.cm-ln-stop': { color: '#1a1a1a' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement.cm-ln-stop::before': { background: 'var(--debug-stop)' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement.cm-ln-frame:not(.cm-ln-stop)': { color: '#1a1a1a' },
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement.cm-ln-frame:not(.cm-ln-stop)::before': { background: 'var(--debug-frame)' },
  // Stopped on a breakpoint: the stop's fill, ringed in the breakpoint's red.
  '&:not(.cm-desk) .cm-lineNumbers .cm-gutterElement.cm-ln-bp:is(.cm-ln-stop, .cm-ln-frame)::before': {
    boxShadow: 'inset 0 0 0 2px var(--debug-bp)',
  },
  '.cm-debug-gutter .cm-gutterElement': {
    position: 'relative',
    cursor: 'pointer',
    display: 'flex',
    // Top, not centre: a wrapped line (phone, or a long inline value) is several
    // rows tall, and the dot/arrow belong to its FIRST row, as in VS Code.
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  // Hover preview: a faint dot where a click would put one (VS Code's glyph-margin hint).
  '.cm-debug-gutter .cm-gutterElement:not(:has(.cm-bp)):hover::after': {
    content: '""',
    width: '9px',
    height: '9px',
    marginTop: 'calc((1lh - 9px) / 2)',
    borderRadius: '50%',
    background: 'var(--debug-bp)',
    opacity: '0.4',
  },
  '.cm-bp': {
    display: 'block',
    width: '9px',
    height: '9px',
    marginTop: 'calc((1lh - 9px) / 2)',
    borderRadius: '50%',
    background: 'var(--debug-bp)',
  },
  // The arrow replaces the dot on its line (it carries its own, see StopArrowMarker).
  '.cm-gutterElement:has(.cm-stop-arrow) .cm-bp': { visibility: 'hidden' },
  '.cm-bp--off': { background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--debug-bp-off)' },
  '.cm-stop-arrow': {
    position: 'absolute',
    insetInline: '0',
    top: '0',
    height: '1lh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--debug-stop)',
    pointerEvents: 'none',
  },
  '.cm-stop-arrow--frame': { color: 'var(--debug-frame)' },
  '.cm-debug-stop-line': { backgroundColor: 'var(--debug-stop-line) !important' },
  '.cm-debug-frame-line': { backgroundColor: 'var(--debug-frame-line) !important' },
  '.cm-inline-value': {
    marginInlineStart: '2.5em',
    fontStyle: 'italic',
    color: 'var(--debug-inline-fg)',
    whiteSpace: 'pre',
    pointerEvents: 'none',
  },
  '.cm-debug-hover': {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '12px',
    padding: '4px 8px',
    maxWidth: '480px',
    maxHeight: '320px',
    overflow: 'auto',
  },
  '.cm-debug-hover--none': { display: 'none' },
  '.cm-debug-hover-head': { display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap', lineHeight: '20px' },
  '.cm-debug-twisty': { width: '14px', flex: 'none', color: 'var(--text-3)' },
  '.cm-debug-hover-name': { color: 'var(--debug-name)' },
  '.cm-debug-hover-sep': { color: 'var(--text-3)' },
  '.cm-debug-hover-value': { color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-debug-hover-empty': { color: 'var(--text-3)', fontStyle: 'italic', lineHeight: '20px' },
})
