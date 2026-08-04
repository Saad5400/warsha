import { EditorState, Compartment, Text } from '@codemirror/state'
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
import { indentOnInput, bracketMatching, indentUnit, language, LanguageSupport, StreamLanguage } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  acceptCompletion,
} from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { indentGuides } from './indentGuides'
import { completionSources, type CompletionLang } from './completions'

/**
 * The language the *editor* colours a file in — one per file, and finer-grained
 * than the runtime's `LangId`: a web project is one runtime (`web`) but its files
 * are html, css and javascript individually, each with its own grammar. Kept
 * here rather than in runtime/index.ts because it is an editor concern (which
 * Lezer grammar to parse with), not a "which engine runs this" one.
 */
export type EditorLang = 'java' | 'python' | 'csharp' | 'html' | 'css' | 'javascript'

export function editorLangForPath(path: string): EditorLang | null {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.cs')) return 'csharp'
  if (/\.html?$/i.test(path)) return 'html'
  if (/\.css$/i.test(path)) return 'css'
  if (/\.(m?js|jsx|ts|tsx)$/i.test(path)) return 'javascript'
  return null
}

/** Only Java and Python carry curated snippets/dictionaries; the rest get
 *  grammar highlighting and identifier completion (see completions.ts). */
function completionLang(lang: EditorLang | null): CompletionLang | null {
  return lang === 'java' || lang === 'python' ? lang : null
}

/**
 * CodeMirror wiring, kept out of the React component so the component stays a
 * ~40-line mount/unmount shell. Editor chrome colours come from `chromeTheme`
 * below; oneDark supplies only syntax colours. The completion sources and the
 * snippet library live in ./completions.ts.
 */

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
    '&.cm-editor .cm-activeLine': {
      backgroundColor: 'var(--code-active-line)',
      // The active-line band used to break for 4px between the gutter and the
      // line: `.cm-gutters` ends where `.cm-content` begins, and the 4px
      // paddingLeft above holds the line itself off that edge, so the two
      // highlights never met. Measured at 1280: gutter right 311.61, active line
      // left 315.61 — a 4px stripe of bare canvas down the middle of the
      // highlighted row.
      //
      // A shadow rather than a negative margin because `.cm-line`'s own
      // paddingLeft is dynamic (indentGuides.ts rewrites it per line), so
      // anything that has to stay in step with it will drift. This paints into
      // the content's existing padding, costs no layout, and leaves the iOS
      // selection-handle clearance the padding is there for.
      boxShadow: '-4px 0 0 0 var(--code-active-line)',
    },
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
    // The completion popup. Width is capped against the *viewport*, not the
    // editor, because at 390px an uncapped popup runs off the screen edge and
    // takes its scrollbar with it.
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete': {
      maxWidth: 'calc(100vw - 2 * var(--sp-3))',
    },
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-code)',
      maxHeight: 'min(40vh, 320px)',
      maxWidth: '100%',
    },
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      // 44px rows: this list is tapped, not just arrowed through (§5.2).
      minHeight: 'var(--touch)',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--sp-2)',
      paddingInline: 'var(--sp-3)',
      color: 'var(--text-2)',
    },
    // Selected row carries a 2px accent rule as well as a fill, because the fill
    // alone is ~1.1:1 against the panel and invisible on a phone (principle 2).
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--surface-4)',
      color: 'var(--text-1)',
      boxShadow: 'inset 2px 0 0 0 var(--accent)',
    },
    '&.cm-editor .cm-completionLabel': {
      flex: '1',
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    '&.cm-editor .cm-completionMatchedText': {
      textDecoration: 'none',
      color: 'var(--accent)',
      fontWeight: '600',
    },
    // The plain-English gloss ("count from 0"). Kept at every width — measured at
    // 390px it still fits beside the label, and it is the part that teaches. The
    // label ellipsizes first if something has to give.
    '&.cm-editor .cm-completionDetail': {
      flex: 'none',
      marginLeft: 'var(--sp-3)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-micro)',
      fontStyle: 'normal',
      color: 'var(--text-3)',
    },
    // CodeMirror's default type icons are 𝑥 (U+1D465), 𝐶, 𝑡, ∪, ▢ and a key
    // emoji. Those are exactly the glyphs §3.1 warns about: outside the BMP or
    // outside the common OEM Android fonts, so they arrive as tofu boxes or as
    // colour emoji on the target device. Replaced with plain ASCII in the code
    // font, which every platform has.
    '&.cm-editor .cm-completionIcon': {
      width: '1.4em',
      paddingRight: 'var(--sp-1)',
      fontFamily: 'var(--font-code)',
      fontSize: '90%',
      opacity: '1',
      color: 'var(--text-3)',
      textAlign: 'center',
    },
    // Snippets are the headline of this feature, so they get the accent.
    '&.cm-editor .cm-completionIcon-snippet': { color: 'var(--accent)' },
    '&.cm-editor .cm-completionIcon-snippet::after': { content: "'{}'" },
    '&.cm-editor .cm-completionIcon-keyword::after': { content: "'#'" },
    '&.cm-editor .cm-completionIcon-function::after': { content: "'f'" },
    '&.cm-editor .cm-completionIcon-method::after': { content: "'f'" },
    '&.cm-editor .cm-completionIcon-class::after': { content: "'C'" },
    '&.cm-editor .cm-completionIcon-variable::after': { content: "'x'" },
    '&.cm-editor .cm-completionIcon-text::after': { content: "'a'" },
    // Package/module segments, from import-statement completion (editor/imports.ts).
    '&.cm-editor .cm-completionIcon-namespace::after': { content: "'P'" },
    // math.pi / math.e / math.inf, from member completion (editor/members.ts).
    '&.cm-editor .cm-completionIcon-constant::after': { content: "'K'" },
    // The "no matches" line, and the info panel if a completion ever carries one.
    '&.cm-editor .cm-tooltip.cm-completionInfo': {
      maxWidth: 'min(32ch, calc(100vw - 2 * var(--sp-3)))',
      padding: 'var(--sp-2) var(--sp-3)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-meta)',
      color: 'var(--text-2)',
    },
  },
  { dark: true },
)

/** Lezer grammars are the bulk of the bundle, so they load on demand. */
const langCache = new Map<EditorLang, LanguageSupport>()
async function loadLanguage(lang: EditorLang): Promise<LanguageSupport> {
  const cached = langCache.get(lang)
  if (cached) return cached
  let support: LanguageSupport
  switch (lang) {
    case 'java':
      support = (await import('@codemirror/lang-java')).java()
      break
    case 'python':
      support = (await import('@codemirror/lang-python')).python()
      break
    case 'csharp':
      // No official Lezer grammar for C#; the clike legacy stream mode covers it
      // (keywords, strings, comments, numbers) — enough for syntax colour.
      support = new LanguageSupport(
        StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).csharp),
      )
      break
    case 'html':
      // lang-html brings its own embedded css/js highlighting for <style>/<script>.
      support = (await import('@codemirror/lang-html')).html()
      break
    case 'css':
      support = (await import('@codemirror/lang-css')).css()
      break
    case 'javascript':
      // jsx/typescript on so a .jsx or .ts a later phase adds still highlights.
      support = (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })
      break
  }
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
  /**
   * Replace the current file's whole document with `content` in one dispatch
   * — one undo step, and `onChange` fires exactly as it would for a keystroke,
   * so the result flows into `Project.setContent()` and the normal dirty/save
   * pipeline like any other edit. Used by the "Format file" action.
   *
   * The cursor is kept at its old (line, column), clamped to the reformatted
   * document's bounds — a real diff-based mapping is overkill for a
   * whole-file rewrite that mostly preserves structure, and "same spot,
   * clamped" reads as correct far more often than "line 1, column 0" would.
   * No-ops if `content` is already what the document holds.
   */
  applyEdit(content: string): void
  destroy(): void
}

export function createEditor(
  parent: HTMLElement,
  opts: {
    fontSize: number
    onChange(path: string, content: string): void
    onSave(): void
    /**
     * Identifiers from every *other* file in the project, for completion. Read
     * through a function rather than passed as an array so the view never has to
     * be rebuilt when a file changes; the caller memoises it.
     */
    projectWords?(): readonly string[]
    /**
     * Caret position, 1-based, for the status bar (LAYOUT-VSCODE §3). Called
     * only when it actually moves — the alternative is a React render per
     * keystroke for a number that usually did not change.
     */
    onCursor?(line: number, col: number): void
  },
): EditorController {
  const fontTheme = new Compartment()
  const langConf = new Compartment()
  const states = new Map<string, EditorState>()
  let path: string | null = null
  let applying = false
  let fontSize = opts.fontSize
  const projectWords = () => opts.projectWords?.() ?? []

  let reported = ''
  const reportCursor = (state: EditorState) => {
    if (!opts.onCursor) return
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    const col = head - line.from + 1
    const key = `${line.number}:${col}`
    if (key === reported) return
    reported = key
    opts.onCursor(line.number, col)
  }

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

  /**
   * Everything that depends on which language a file is in: the Lezer grammar
   * (which is what produces syntax colours) and the completion sources. They live
   * in one compartment so a single reconfigure keeps them in step — before this
   * was a unit, a file that gained a `.py` extension could get Python colours
   * while still being offered Java's snippets.
   */
  const languageExtensions = (lang: EditorLang | null) => {
    const support = lang ? langCache.get(lang) : undefined
    return [
      support ? [support] : [],
      autocompletion({
        override: completionSources(completionLang(lang), projectWords),
        // As-you-type, from the first character — plus Ctrl/Cmd+Space, which is
        // what a student who has used an IDE before will reach for.
        activateOnTyping: true,
        selectOnOpen: true,
        // Enough to scroll through, few enough that the popup cannot swallow a
        // 390px screen. The list is ranked, so the tail is rarely what you want.
        maxRenderedOptions: 30,
        icons: true,
      }),
    ]
  }

  const extensions = (lang: EditorLang | null) => [
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
    langConf.of(languageExtensions(lang)),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && path && !applying) opts.onChange(path, u.state.doc.toString())
      if (u.docChanged || u.selectionSet) reportCursor(u.state)
    }),
  ]

  const stateFor = (p: string, content: string) =>
    EditorState.create({ doc: content, extensions: extensions(editorLangForPath(p)) })

  const view = new EditorView({ parent, state: stateFor('', '') })

  /**
   * Point the editor at the grammar `p`'s extension calls for, whatever it was
   * pointed at before. Called on every file the editor shows.
   *
   * This has to compare against what the *state* actually has, not against what
   * has been downloaded. The previous version returned early as soon as the
   * grammar was in `langCache`, on the assumption that a cached grammar means the
   * open state already uses it — and that is false for any state built before the
   * download finished. Two ways a student hit it, and the first is a one-gesture
   * bug: rename `notes.txt` to `notes.py` and the state keeps the no-language
   * configuration it was created with, so the file renders with no syntax colours
   * at all until the tab is closed and reopened. Second, on a slow connection,
   * open a .py and switch tabs before its grammar lands: the late `.then` sees a
   * different file, skips the reconfigure, and the state is cached uncoloured for
   * the rest of the session.
   */
  const syncLanguage = (p: string) => {
    const lang = editorLangForPath(p)
    const support = lang ? langCache.get(lang) : undefined
    if (lang && !support) {
      void loadLanguage(lang).then(() => {
        // Only if this is still the file on screen; any other file gets its own
        // reconfigure from its own open(), which now always runs.
        if (path === p) view.dispatch({ effects: langConf.reconfigure(languageExtensions(lang)) })
      })
      return
    }
    // Reconfiguring re-parses the document, so only do it when it would change
    // something — every file switch would otherwise pay for a re-parse.
    if ((support?.language ?? null) !== view.state.facet(language)) {
      view.dispatch({ effects: langConf.reconfigure(languageExtensions(lang)) })
    }
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
      syncLanguage(p)
      // `setState` swaps the whole state rather than dispatching a selection, so
      // the update listener does not see the new file's caret. Switching tabs has
      // to move the status bar's Ln:Col, so say it here.
      reportCursor(view.state)
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
      if (path === from) {
        path = to
        // A rename can change the language — `notes.txt` becoming `notes.py` is
        // how a student discovers extensions — so the grammar has to be re-read
        // here. Nothing else in the shell would ever ask again for this file.
        syncLanguage(to)
      }
    },
    setFontSize(px) {
      fontSize = px
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(px)) })
    },
    applyEdit(content) {
      if (!path) return
      const cur = view.state.doc
      if (cur.toString() === content) return
      const head = view.state.selection.main.head
      const oldLine = cur.lineAt(head)
      const oldCol = head - oldLine.from
      // Built off-state, so the clamped cursor can be computed and dispatched
      // together with the change — one transaction, one undo step, and the
      // update listener sees a normal docChanged (unlike `open()` above, this
      // is a real edit and must flow to `onChange`/`Project.setContent()`).
      const newDoc = Text.of(content.split(/\r?\n/))
      const lineNumber = Math.min(oldLine.number, newDoc.lines)
      const target = newDoc.line(lineNumber)
      const pos = target.from + Math.min(oldCol, target.length)
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: content },
        selection: { anchor: pos },
        scrollIntoView: true,
      })
    },
    focus: () => view.focus(),
    currentPath: () => path,
    destroy: () => view.destroy(),
  }
}
