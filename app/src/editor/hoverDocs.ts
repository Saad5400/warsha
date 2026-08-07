import { Facet, Prec, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  closeHoverTooltips,
  EditorView,
  hasHoverTooltips,
  hoverTooltip,
  keymap,
  showPanel,
  showTooltip,
  ViewPlugin,
  type PanelConstructor,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { builtinDoc, renderDocCard, type BuiltinDoc, type CompletionLang } from './completions'

/**
 * Docs on hover — the "what does this do?" layer (VS Code's hover widget).
 *
 * Two vocabularies feed one card:
 *
 *   1. **Built-ins** — the same beginner API dictionary completions.ts carries
 *      (`builtinDoc`), so hover, autocomplete and the completion info panel
 *      can never disagree about what `println` does.
 *   2. **The student's own doc comments** — a Javadoc block above a Java
 *      method/class, a docstring (or preceding `#` block) under a Python
 *      def/class, found by scanning every project file (regex heuristics, no
 *      parser — a beginner course's code is regular enough). User docs win
 *      over built-ins: if you wrote a method called `print`, your words beat
 *      ours.
 *
 * Three ways in, one card:
 *   - mouse hover (`hoverTooltip`) — desktop;
 *   - long-press on a word — touch, where hover does not exist. A pointerdown
 *     timer (500ms, cancelled by movement) that never preventDefaults, so the
 *     platform's own long-press word-selection and scrolling are untouched —
 *     the card simply appears above the word the OS is selecting;
 *   - Ctrl/Cmd+K Ctrl/Cmd+I at the cursor (VS Code's "Show Hover"). NOT a
 *     CodeMirror multi-stroke binding: CM preventDefaults a chord prefix, and
 *     App.tsx's window keydown ignores defaultPrevented events, which would
 *     kill Ctrl+K Ctrl+O (Open Recent) whenever the editor had focus. Instead
 *     a plain keydown observer watches the sequence and never preventDefaults
 *     — the shell's own chord machinery still swallows the second stroke, as
 *     it does for any unbound Ctrl+K sequence.
 */

/* -------------------------------------------------- project doc comments */

export interface ProjectFileText {
  path: string
  content: string
}

interface UserDoc {
  signature: string
  doc: string
}

let fileSource: (() => readonly ProjectFileText[]) | null = null
let sourceRevision = -1

/**
 * App.tsx registers the project-files accessor here — a module-level seam
 * beats threading a prop through the editor's singleton mount. `revision` is
 * the project's change counter, so the cached scan below re-runs at most once
 * per edit burst.
 */
export function setProjectDocsSource(get: () => readonly ProjectFileText[], revision: number): void {
  fileSource = get
  sourceRevision = revision
}

let cachedRevision = -2
let cachedDocs: Map<string, UserDoc> = new Map()

function projectDocs(): Map<string, UserDoc> {
  if (!fileSource) return cachedDocs
  if (cachedRevision === sourceRevision) return cachedDocs
  const map = new Map<string, UserDoc>()
  for (const file of fileSource()) {
    if (file.path.endsWith('.java')) scanJava(file.content, map)
    else if (file.path.endsWith('.py')) scanPython(file.content, map)
  }
  cachedDocs = map
  cachedRevision = sourceRevision
  return map
}

/** Javadoc block text → plain lines: comment stars off, blank runs collapsed. */
function cleanJavadoc(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.replace(/^\s*\*+ ?/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One line of header, whitespace collapsed; an unclosed `(` marked honestly. */
function cleanSignature(header: string): string {
  let sig = header.replace(/\s+/g, ' ').trim()
  if (sig.includes('(') && !sig.includes(')')) sig += ' …)'
  return sig
}

/** The name a Java declaration header declares: class-likes, then `name(`, then a field's last word. */
function javaHeaderName(header: string): string | null {
  const cls = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/.exec(header)
  if (cls) return cls[1]
  const method = /([A-Za-z_$][\w$]*)\s*\(/.exec(header)
  if (method) return method[1]
  const words = header.trim().split(/\s+/)
  const last = words[words.length - 1]
  return words.length >= 2 && /^[A-Za-z_$][\w$]*$/.test(last) ? last : null
}

/** Per match: the Javadoc body, any annotations, then the header up to a brace, semicolon or equals. */
const JAVADOC = /\/\*\*([\s\S]*?)\*\/\s*((?:@[\w.]+(?:\([^)]*\))?\s*)*)([^\n{;=]*)/g

function scanJava(src: string, out: Map<string, UserDoc>): void {
  JAVADOC.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = JAVADOC.exec(src))) {
    const doc = cleanJavadoc(m[1])
    const name = javaHeaderName(m[3])
    if (doc && name) out.set(name, { signature: cleanSignature(m[3]), doc })
  }
}

const PY_DEF = /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/

function scanPython(src: string, out: Map<string, UserDoc>): void {
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = PY_DEF.exec(lines[i])
    if (!m) continue
    const name = m[1]
    const signature = cleanSignature(lines[i].replace(/:\s*$/, ''))
    // A docstring on the first non-blank line inside the body…
    let doc = ''
    let j = i + 1
    while (j < lines.length && lines[j].trim() === '') j++
    const open = /^\s*[rbuRBU]{0,2}("""|''')/.exec(lines[j] ?? '')
    if (open) {
      const q = open[1]
      const first = lines[j].slice(lines[j].indexOf(q) + 3)
      const inline = first.indexOf(q)
      if (inline !== -1) {
        doc = first.slice(0, inline).trim()
      } else {
        const buf = [first]
        for (let k = j + 1; k < lines.length; k++) {
          const close = lines[k].indexOf(q)
          if (close !== -1) {
            buf.push(lines[k].slice(0, close))
            break
          }
          buf.push(lines[k])
        }
        doc = buf.map((l) => l.trim()).join('\n').trim()
      }
    } else {
      // …or a contiguous `#` block directly above the def.
      const buf: string[] = []
      for (let k = i - 1; k >= 0; k--) {
        const c = /^\s*#\s?(.*)$/.exec(lines[k])
        if (!c) break
        buf.unshift(c[1].trimEnd())
      }
      doc = buf.join('\n').trim()
    }
    if (doc) out.set(name, { signature, doc })
  }
}

/* ------------------------------------------------------------ the lookup */

const IDENT = /^[A-Za-z_$][\w$]*$/

interface DocsHit {
  from: number
  to: number
  entry: BuiltinDoc
  /** User doc comments get their first sentence bolded; built-ins do not. */
  user: boolean
}

function docsAt(view: EditorView, pos: number, lang: CompletionLang | null): DocsHit | null {
  const { state } = view
  const word = state.wordAt(pos)
  if (!word) return null
  const name = state.sliceDoc(word.from, word.to)
  if (!IDENT.test(name)) return null
  // No cards inside strings or comments — hovering the word print in
  // println("print something") must not explain the API.
  const node = syntaxTree(state).resolveInner(pos, 0)
  if (/String|Comment|comment/.test(node.name)) return null
  const user = projectDocs().get(name)
  if (user) return { from: word.from, to: word.to, entry: user, user: true }
  if (!lang) return null
  // `Math.abs` beats `abs`: read the qualifying receiver just before the word.
  const lineStart = state.doc.lineAt(word.from).from
  const before = state.sliceDoc(Math.max(lineStart, word.from - 60), word.from)
  const receiver = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(before)?.[1]
  const entry = builtinDoc(lang, name, receiver)
  return entry ? { from: word.from, to: word.to, entry, user: false } : null
}

function cardView(hit: DocsHit): TooltipView {
  const dom = document.createElement('div')
  dom.className = 'cm-tooltip-docs'
  dom.appendChild(renderDocCard(hit.entry, { boldLead: hit.user }))
  return { dom }
}

/**
 * The completion language in force. Set by `hoverDocs(lang)` and reconfigured
 * per file with it, so the context-menu / touch-actions layer (App.tsx) can
 * resolve "is the caret on a documented identifier?" and trigger the same card
 * from a view alone — see `documentedWordAt` / `explainAt` below. Absent (→
 * null) for files without a built-in dictionary.
 */
const docsLang = Facet.define<CompletionLang | null, CompletionLang | null>({
  combine: (values) => (values.length ? values[values.length - 1] : null),
})

/* --------------------------------- manual card (keyboard + long-press) */

/**
 * One card, two presentations. The desktop chord and mouse hover show it as a
 * tooltip pinned ABOVE the word (VS Code's hover widget). A touch long-press
 * would land it in the same place the OS selection bar sits — right above the
 * word — so on touch the SAME content docks as a bottom strip instead, clear of
 * that bar's path. `docked` picks which; both are driven off this one field, so
 * dismissal (typing, caret leaving the word, tap/scroll/Escape) is shared.
 */
interface ManualDocs {
  pos: number
  end: number
  tooltip: Tooltip
  panel: PanelConstructor
  docked: boolean
}

const setDocsCard = StateEffect.define<ManualDocs | null>()

const manualDocsField = StateField.define<ManualDocs | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setDocsCard)) value = e.value
    if (!value) return null
    // Typing replaces the word; the card about the old word goes with it.
    if (tr.docChanged) return null
    // The caret walking out of the word is VS Code's dismiss too. The
    // long-press's own word-selection lands ON the word, so it survives.
    if (tr.selection) {
      const head = tr.state.selection.main.head
      if (head < value.pos || head > value.end) return null
    }
    return value
  },
  // Stable tooltip/panel refs live in the field so neither is rebuilt on every
  // unrelated update — the getter just selects one by `docked`.
  provide: (f) => [
    showTooltip.from(f, (v) => (v && !v.docked ? v.tooltip : null)),
    showPanel.from(f, (v) => (v && v.docked ? v.panel : null)),
  ],
})

function showDocsAt(view: EditorView, pos: number, lang: CompletionLang | null, docked: boolean): boolean {
  const hit = docsAt(view, pos, lang)
  if (!hit) return false
  const tooltip: Tooltip = { pos: hit.from, end: hit.to, above: true, create: () => cardView(hit) }
  const panel: PanelConstructor = () => {
    // Same card DOM as the tooltip, in a docked wrapper the chromeTheme styles
    // as a bottom strip (editor/setup.ts); CM adds the `.cm-panel` class.
    const dom = document.createElement('div')
    dom.className = 'cm-docs-dock'
    dom.appendChild(renderDocCard(hit.entry, { boldLead: hit.user }))
    return { dom, top: false }
  }
  view.dispatch({
    effects: [
      setDocsCard.of({ pos: hit.from, end: hit.to, tooltip, panel, docked }),
      // Never two cards: the manual one replaces any mouse-hover card.
      closeHoverTooltips,
    ],
  })
  return true
}

/** Dismiss BOTH faces of the card — the manual one and the mouse-hover one. */
function hideDocs(view: EditorView): boolean {
  const manual = view.state.field(manualDocsField, false)
  if (!manual && !hasHoverTooltips(view.state)) return false
  view.dispatch({ effects: [setDocsCard.of(null), closeHoverTooltips] })
  return true
}

/* ------------------------------------------------------------- touch path */

/** Movement past this many px is a scroll or a drag, not a press. */
const PRESS_SLOP = 8
const PRESS_MS = 500

/**
 * Touch synthesizes compat mouse events, enough to make `hoverTooltip`
 * "hover" on a plain tap. Touch stamps `lastTouchAt`; the hover source stays
 * quiet while it's fresh, so on a phone the card only comes from long-press.
 */
let lastTouchAt = 0
const TOUCH_QUIET_MS = 1500

/**
 * Long-press → the card, without stealing the gesture: nothing here ever
 * preventDefaults, so the platform still gets its word-selection and its
 * scrolling; the timer simply cancels itself the moment the finger travels.
 */
function touchDocs(lang: CompletionLang | null): Extension {
  return ViewPlugin.define((view) => {
    let timer = -1
    let startX = 0
    let startY = 0
    const cancel = () => {
      if (timer >= 0) {
        clearTimeout(timer)
        timer = -1
      }
    }
    const down = (e: PointerEvent) => {
      // A tap anywhere in the code dismisses a standing card (taps on the
      // card itself land outside contentDOM and never reach this handler).
      if (view.state.field(manualDocsField, false)) hideDocs(view)
      if (e.pointerType !== 'touch') return
      lastTouchAt = Date.now()
      startX = e.clientX
      startY = e.clientY
      cancel()
      timer = window.setTimeout(() => {
        timer = -1
        const pos = view.posAtCoords({ x: startX, y: startY })
        // Docked: a bottom strip, out of the OS selection bar's path (which sits
        // above the word the long-press is selecting).
        if (pos != null) showDocsAt(view, pos, lang, true)
      }, PRESS_MS)
    }
    const move = (e: PointerEvent) => {
      if (timer >= 0 && Math.hypot(e.clientX - startX, e.clientY - startY) > PRESS_SLOP) cancel()
    }
    const scroll = () => cancel()
    // Taps that never enter the editor (tab strip, console) must dismiss too.
    const downAnywhere = (e: PointerEvent) => {
      if (!view.state.field(manualDocsField, false)) return
      const t = e.target
      if (t instanceof Node && (view.dom.contains(t) || (t instanceof Element && t.closest('.cm-tooltip')))) return
      hideDocs(view)
    }
    const content = view.contentDOM
    content.addEventListener('pointerdown', down)
    content.addEventListener('pointermove', move)
    content.addEventListener('pointerup', cancel)
    content.addEventListener('pointercancel', cancel)
    view.scrollDOM.addEventListener('scroll', scroll)
    document.addEventListener('pointerdown', downAnywhere)
    return {
      destroy() {
        cancel()
        content.removeEventListener('pointerdown', down)
        content.removeEventListener('pointermove', move)
        content.removeEventListener('pointerup', cancel)
        content.removeEventListener('pointercancel', cancel)
        view.scrollDOM.removeEventListener('scroll', scroll)
        document.removeEventListener('pointerdown', downAnywhere)
      },
    }
  })
}

/* --------------------------------------------- Ctrl/Cmd+K Ctrl/Cmd+I chord */

const CHORD_MS = 3000

/**
 * A two-key watcher, not a CM multi-stroke binding (whose prefix handling
 * would break the shell's own Ctrl+K chords). `Prec.highest` because the
 * completing Ctrl/Cmd+I must beat defaultKeymap's own Mod-i. The arming
 * Ctrl/Cmd+K is never claimed, so Ctrl+K Ctrl+O still reaches the shell.
 */
function showHoverChord(lang: CompletionLang | null): Extension {
  let armedAt = 0
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(e, view) {
        if (e.key === 'Control' || e.key === 'Meta' || e.key === 'Shift' || e.key === 'Alt') return false
        const mod = e.metaKey || e.ctrlKey
        const key = e.key.toLowerCase()
        if (armedAt && Date.now() - armedAt < CHORD_MS && mod && key === 'i') {
          armedAt = 0
          // Keyboard chord is a desktop gesture — the tooltip above the word.
          return showDocsAt(view, view.state.selection.main.head, lang, false)
        }
        armedAt = mod && !e.altKey && !e.shiftKey && key === 'k' ? Date.now() : 0
        return false
      },
    }),
  )
}

/* ---------------------------------------------------------------- exports */

/**
 * The whole feature as one extension. `lang` gates the built-in dictionary
 * (Java/Python only, same as completions); user doc comments apply regardless
 * of file.
 */
export function hoverDocs(lang: CompletionLang | null): Extension {
  if (!lang) return []
  return [
    docsLang.of(lang),
    manualDocsField,
    hoverTooltip(
      (view, pos) => {
        // Not while a touch is fresh (synthesized mouse events — see
        // lastTouchAt) and not on top of a manual card already showing.
        if (Date.now() - lastTouchAt < TOUCH_QUIET_MS) return null
        if (view.state.field(manualDocsField, false)) return null
        const hit = docsAt(view, pos, lang)
        if (!hit) return null
        return { pos: hit.from, end: hit.to, above: true, create: () => cardView(hit) }
      },
      { hoverTime: 300 },
    ),
    touchDocs(lang),
    showHoverChord(lang),
    keymap.of([{ key: 'Escape', run: hideDocs }]),
  ]
}

/* -------------------------------------------- resolution for the action menus */

/**
 * The documented identifier under `pos`, or null — the same resolution the
 * hover card uses, exposed so the editor's action menus (the right-click menu
 * and the touch actions button in App.tsx) can offer "Explain '<word>'" only
 * when there is something to explain. Language comes from the `docsLang` facet,
 * so callers need nothing but a view and a position.
 */
export function documentedWordAt(view: EditorView, pos: number): string | null {
  const lang = view.state.facet(docsLang)
  // No dictionary → no docs feature on this file → no "Explain" row to offer.
  if (!lang) return null
  const hit = docsAt(view, pos, lang)
  return hit ? view.state.sliceDoc(hit.from, hit.to) : null
}

/**
 * Show the docs card for the word at `pos` — the "Explain" action behind those
 * same menus. `docked` picks the presentation: the tooltip above the word
 * (right-click / desktop) or the bottom strip (the touch button).
 */
export function explainAt(view: EditorView, pos: number, docked: boolean): boolean {
  return showDocsAt(view, pos, view.state.facet(docsLang), docked)
}
