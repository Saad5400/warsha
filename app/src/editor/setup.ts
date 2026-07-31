import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, indentUnit, type LanguageSupport } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  acceptCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { langForPath, type LangId } from '../runtime'
import { indentGuides } from './indentGuides'

/**
 * CodeMirror wiring, kept out of the React component so the component stays a
 * ~40-line mount/unmount shell. Editor *chrome* colours come from Design's
 * tokens via .cm-* rules in index.css; oneDark supplies only syntax colours.
 */

const JAVA_WORDS =
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null String System out println print Scanner ArrayList HashMap List Map Integer Double Boolean Object Exception Override toString equals hashCode length size get set add'.split(
    ' ',
  )
const PY_WORDS =
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print input len range str int float bool list dict set tuple enumerate zip sum min max abs round sorted open self __init__ super'.split(
    ' ',
  )

/**
 * Editor chrome in Design's tokens (§2.6). This has to be a CodeMirror theme
 * rather than CSS, and that is not a style preference — it is the only place it
 * works.
 *
 * CodeMirror mounts oneDark as an **unlayered** StyleModule in <head>, and any
 * unlayered rule beats a rule inside `@layer components` no matter how specific
 * that rule is. So the `.cm-*` block in index.css only ever took effect where it
 * said `!important` (the selection), and everything else silently lost: the
 * editor canvas was rendering oneDark's own `#282c34` instead of `--surface-1`
 * `#1A1D23`, which made the code area a visibly different grey from every panel
 * around it. Same story for the gutter, the active line, and a `#528bff` 1px
 * caret where the spec asks for a 2px amber one.
 *
 * A theme extension is unlayered too, but *order* is not a reliable way to beat
 * oneDark: CodeMirror mounts the collected style modules reversed, so an
 * extension listed later ends up earlier in the sheet and loses. Every selector
 * here therefore carries an explicit `&.cm-editor` — the theme class and
 * `.cm-editor` are both on the same element, so this is one class more specific
 * than whatever oneDark writes for the same node, and it wins wherever the
 * extension happens to sit in the array.
 */
const chromeTheme = EditorView.theme(
  {
    '&.cm-editor': { backgroundColor: 'var(--code-bg)', color: 'var(--text-1)' },
    '&.cm-editor .cm-scroller': { fontFamily: 'var(--font-code)' },
    '&.cm-editor .cm-content': {
      // iOS text-selection handles are large; without this the leading handle
      // is clipped against the gutter edge (§3.4). The native caret stays
      // transparent — `drawSelection` renders `.cm-cursor` instead, below.
      paddingLeft: '4px',
    },
    '&.cm-editor .cm-cursor, &.cm-editor .cm-dropCursor': {
      borderLeftColor: 'var(--code-caret)',
      // The 1px default is genuinely hard to find on a 3x phone display.
      borderLeftWidth: '2px',
    },
    '&.cm-editor .cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
    // Flat gutter: same fill as the canvas, no border. A filled gutter costs
    // horizontal pixels of perceived width on a 390px phone.
    '&.cm-editor .cm-gutters': {
      backgroundColor: 'var(--code-gutter-bg)',
      color: 'var(--code-gutter-fg)',
      border: 'none',
    },
    '&.cm-editor .cm-activeLineGutter': {
      backgroundColor: 'var(--code-active-line)',
      color: 'var(--code-gutter-fg-active)',
    },
    // oneDark writes the selection through `.cm-selectionLayer`, so the same
    // path is spelled out here rather than hoping a shorter one is enough.
    '&.cm-editor .cm-selectionBackground': { backgroundColor: 'var(--code-selection)' },
    '&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'var(--code-selection)',
    },
    '&.cm-editor .cm-content ::selection': { backgroundColor: 'var(--code-selection)' },
    '&.cm-editor .cm-matchingBracket, &.cm-editor.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--code-bracket)',
      outline: '1px solid var(--border-control)',
      color: 'inherit',
    },
    '&.cm-editor.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'transparent',
      color: 'var(--danger)',
    },
    '&.cm-editor .cm-searchMatch': { backgroundColor: 'var(--code-search-match)' },
    '&.cm-editor .cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--accent)',
      color: 'var(--accent-ink)',
    },
    '&.cm-editor .cm-selectionMatch': { backgroundColor: 'var(--code-search-match)' },
    '&.cm-editor .cm-tooltip': {
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--r-md)',
      backgroundColor: 'var(--surface-3)',
      boxShadow: 'var(--shadow-raised)',
      overflow: 'hidden',
    },
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-code)',
      maxHeight: '40vh',
    },
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      minHeight: 'var(--touch)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--sp-2)',
      paddingInline: 'var(--sp-3)',
      color: 'var(--text-2)',
    },
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--surface-4)',
      color: 'var(--text-1)',
    },
  },
  { dark: true },
)

const WORD = /[A-Za-z_$][\w$]*/g

function wordCompletions(words: string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/[\w$]+/)
    if (!before || (before.from === before.to && !ctx.explicit)) return null
    const seen = new Set<string>()
    const doc = ctx.state.doc.sliceString(0)
    let m: RegExpExecArray | null
    WORD.lastIndex = 0
    while ((m = WORD.exec(doc))) if (m[0].length > 2) seen.add(m[0])
    for (const w of words) seen.add(w)
    seen.delete(before.text)
    return {
      from: before.from,
      options: [...seen].map((label) => ({ label, type: words.includes(label) ? 'keyword' : 'variable' })),
      validFor: /^[\w$]*$/,
    }
  }
}

const wordsFor = (lang: LangId | null) => (lang === 'java' ? JAVA_WORDS : lang === 'python' ? PY_WORDS : [])

/** Lezer grammars are the bulk of the bundle, so they load on demand. */
const langCache = new Map<LangId, LanguageSupport>()
async function loadLanguage(lang: LangId): Promise<LanguageSupport> {
  const cached = langCache.get(lang)
  if (cached) return cached
  const support =
    lang === 'java' ? (await import('@codemirror/lang-java')).java() : (await import('@codemirror/lang-python')).python()
  langCache.set(lang, support)
  return support
}

export interface EditorController {
  open(path: string, content: string): void
  closeFile(path: string): void
  renamePath(from: string, to: string): void
  setFontSize(px: number): void
  focus(): void
  currentPath(): string | null
  destroy(): void
}

export function createEditor(
  parent: HTMLElement,
  opts: { fontSize: number; onChange(path: string, content: string): void; onSave(): void },
): EditorController {
  const fontTheme = new Compartment()
  const langConf = new Compartment()
  const states = new Map<string, EditorState>()
  let path: string | null = null
  let applying = false
  let fontSize = opts.fontSize

  /**
   * Sizes that depend on the student's font-size preference, so they have to be
   * recomputed rather than living in index.css.
   *
   * Two spec §3.1/§3.3 requirements ride on this: code carries an *explicit* px
   * size on .cm-content (WebKit renders an unqualified `monospace` at ~81.25% of
   * an inherited size, which shows up as "the code is a size too small, but only
   * on iPad"), and the gutter's leading is stated in px rather than inherited —
   * a unitless 1.6 against 13px line numbers is 20.8px against 24px code rows,
   * and the gutter drifts a line by the bottom of a long file.
   */
  const themeFor = (px: number) => {
    const leading = `${Math.round(px * 1.6)}px`
    return EditorView.theme({
      '&': { fontSize: `${px}px`, height: '100%' },
      '.cm-content': {
        fontSize: `${px}px`,
        lineHeight: leading,
        // Room to scroll the last line clear of the console and the keyboard.
        paddingBottom: '40vh',
      },
      '.cm-gutters': { fontSize: '13px', lineHeight: leading },
      '.cm-lineNumbers .cm-gutterElement': { lineHeight: leading },
    })
  }

  const extensions = (lang: LangId | null) => [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    indentUnit.of('    '),
    // Python's control flow *is* its indentation, and line wrapping makes the
    // eye lose the column. One hairline per level puts it back.
    indentGuides(4),
    autocompletion({ override: [wordCompletions(wordsFor(lang))], activateOnTyping: true, maxRenderedOptions: 24 }),
    // Wrap rather than scroll horizontally: a wrapped line is readable on a
    // phone, a horizontally-scrolling one is not.
    EditorView.lineWrapping,
    // Not optional (spec §3.4). Without these, iPadOS actively corrupts student
    // code as it is typed: it capitalises the first word of every line and turns
    // " into a curly quote, which a beginner cannot possibly diagnose. This is
    // the single most likely way the iPad experience silently breaks.
    EditorView.contentAttributes.of({
      autocapitalize: 'none',
      autocorrect: 'off',
      spellcheck: 'false',
      'data-gramm': 'false',
    }),
    keymap.of([
      { key: 'Tab', run: acceptCompletion },
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          opts.onSave()
          return true
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    // oneDark first, for its syntax colours only; chromeTheme then takes the
    // surfaces, gutter, caret and selection back to Design's tokens.
    oneDark,
    chromeTheme,
    fontTheme.of(themeFor(fontSize)),
    langConf.of(lang && langCache.has(lang) ? [langCache.get(lang)!] : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && path && !applying) opts.onChange(path, u.state.doc.toString())
    }),
  ]

  const stateFor = (p: string, content: string) =>
    EditorState.create({ doc: content, extensions: extensions(langForPath(p)) })

  const view = new EditorView({ parent, state: stateFor('', '') })

  const ensureLanguage = (p: string) => {
    const lang = langForPath(p)
    if (!lang || langCache.has(lang)) return
    void loadLanguage(lang).then((support) => {
      if (path === p) view.dispatch({ effects: langConf.reconfigure([support]) })
    })
  }

  return {
    open(p, content) {
      if (path === p) {
        if (view.state.doc.toString() !== content) {
          applying = true
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
          applying = false
        }
        return
      }
      if (path) states.set(path, view.state)
      path = p
      const saved = states.get(p)
      // Reuse the cached state (cursor, scroll, undo history) when the file has
      // not changed underneath us.
      const next = saved && saved.doc.toString() === content ? saved : stateFor(p, content)
      applying = true
      view.setState(next)
      applying = false
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(fontSize)) })
      ensureLanguage(p)
    },
    closeFile(p) {
      states.delete(p)
      if (path === p) {
        path = null
        applying = true
        view.setState(stateFor('', ''))
        applying = false
      }
    },
    renamePath(from, to) {
      const st = states.get(from)
      if (st) {
        states.delete(from)
        states.set(to, st)
      }
      if (path === from) path = to
    },
    setFontSize(px) {
      fontSize = px
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(px)) })
    },
    focus: () => view.focus(),
    currentPath: () => path,
    destroy: () => view.destroy(),
  }
}
