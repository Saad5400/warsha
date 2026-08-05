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
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search'
import {
  indentOnInput,
  bracketMatching,
  indentUnit,
  language,
  LanguageSupport,
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  acceptCompletion,
} from '@codemirror/autocomplete'
import { indentGuides } from './indentGuides'
import { rainbowBrackets } from './rainbowBrackets'
import { completionSources, type CompletionLang } from './completions'

/**
 * The density gate, same expression as index.css's DENSITY media: desktop
 * metrics only where the pointer can actually hit them. Used two ways — as an
 * `@media` key inside theme objects, and via `matchMedia`. CAUTION: style-mod
 * at-rule keys only tolerate child keys WITHOUT `&` (fontTheme). A `&`-key
 * inside a media object gets the at-rule text substituted for `&`, emitting an
 * unparsable selector that fails as `not all` — desk chrome rules therefore
 * gate on the `.cm-desk` root class (an editorAttributes facet) instead.
 */
const DESK_MEDIA = '(min-width:900px) and (hover:hover) and (pointer:fine)'
const DESK_KEY = `@media ${DESK_MEDIA}`

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
 * below; syntax colours from `syntaxColors` (VSCode Dark+ values). The
 * completion sources and the snippet library live in ./completions.ts.
 */

/**
 * Syntax colours — the VSCode Dark+ family, replacing oneDark (founder,
 * 2026-08-05: oneDark's red-leaning identifiers on our near-black canvas read
 * garish, and "looks like the editor in every tutorial" is the product's own
 * familiarity rule, LAYOUT-VSCODE). The hex values are Dark+'s, checked
 * against the editor canvas (--surface-1): the dimmest ink here (#6A9955
 * comments) clears 6:1, everything else 7:1+.
 *
 * These are the only colour literals outside tokens.css, deliberately: syntax
 * colour is an editor-domain palette, not chrome — the chrome stays entirely
 * on Design's tokens via `chromeTheme` below.
 */
const syntaxColors = HighlightStyle.define(
  [
    { tag: [t.keyword, t.modifier, t.operatorKeyword, t.definitionKeyword], color: '#569CD6' },
    { tag: [t.controlKeyword, t.moduleKeyword], color: '#C586C0' },
    { tag: [t.string, t.special(t.string), t.character, t.docString, t.regexp], color: '#CE9178' },
    { tag: [t.number, t.integer, t.float], color: '#B5CEA8' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6A9955' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#DCDCAA' },
    { tag: [t.typeName, t.className, t.namespace], color: '#4EC9B0' },
    { tag: [t.variableName, t.propertyName, t.attributeName], color: '#9CDCFE' },
    { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#9CDCFE' },
    { tag: [t.bool, t.null, t.atom, t.self], color: '#569CD6' },
    { tag: [t.constant(t.variableName), t.standard(t.variableName), t.special(t.variableName)], color: '#4FC1FF' },
    { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: '#D4D4D4' },
    { tag: [t.tagName], color: '#569CD6' },
    { tag: [t.attributeValue], color: '#CE9178' },
    { tag: [t.annotation, t.meta], color: '#DCDCAA' },
    { tag: [t.escape], color: '#D7BA7D' },
    { tag: [t.link, t.url], color: '#9CDCFE', textDecoration: 'underline' },
    { tag: [t.heading], color: '#569CD6', fontWeight: 'bold' },
    { tag: [t.invalid], color: '#F44747' },
  ],
  { themeType: 'dark' },
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
 * editor canvas was rendering oneDark's own `#282c34` instead of `--surface-1`,
 * which made the code area a visibly different grey from every panel around it.
 * Same story for the gutter, the active line, and a `#528bff` 1px caret where
 * the spec asks for a 2px `--code-caret` one.
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
      // Touch-only seam patch: the 4px content padding above holds the line's
      // fill off the gutter edge, so the shadow paints the band across the gap
      // (a negative margin would drift — indentGuides.ts rewrites `.cm-line`
      // padding per line). Desk overrides the whole model below: VS Code draws
      // the active line as a 1px border, not a fill.
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
    // The unqualified rule is what paints when the editor is *not* focused —
    // VS Code keeps an unfocused selection visible but drops it to a neutral
    // grey. The focused paint goes through `.cm-selectionLayer`, spelled out in
    // full rather than hoping a shorter path is enough.
    '&.cm-editor .cm-selectionBackground': { backgroundColor: 'var(--code-selection-inactive)' },
    '&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'var(--code-selection)',
    },
    '&.cm-editor .cm-content ::selection': { backgroundColor: 'var(--code-selection)' },
    '&.cm-editor .cm-matchingBracket, &.cm-editor.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--code-bracket)',
      outline: '1px solid var(--code-bracket-border)',
      outlineOffset: '-1px',
      color: 'inherit',
    },
    '&.cm-editor.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: 'transparent',
      color: 'var(--danger)',
    },
    '&.cm-editor .cm-searchMatch': { backgroundColor: 'var(--code-search-match)' },
    '&.cm-editor .cm-searchMatch.cm-searchMatch-selected': {
      // VS Code marks the current match by hue (darker amber), not by ink swap.
      backgroundColor: 'var(--code-search-match-selected)',
      color: 'inherit',
    },
    // Other occurrences of the selected text — dimmer than a search match.
    '&.cm-editor .cm-selectionMatch': { backgroundColor: 'var(--code-selection-match)' },
    // ---- Find widget (@codemirror/search, mounted with `top: true`). The
    // container keeps no chrome of its own so the panel can float like
    // VS Code's find widget; at desk it pins to the top-right corner (below).
    '&.cm-editor .cm-panels': { backgroundColor: 'transparent' },
    '&.cm-editor .cm-panels-top': { borderBottom: 'none' },
    '&.cm-editor .cm-panel.cm-search': {
      backgroundColor: 'var(--widget-bg)',
      border: '1px solid var(--border-widget)',
      borderRadius: '0 0 4px 4px',
      boxShadow: 'var(--shadow-raised)',
      fontFamily: 'var(--font-ui)',
      fontSize: '13px',
      color: 'var(--text-2)',
      padding: '4px 8px',
    },
    '&.cm-editor .cm-panel.cm-search input': {
      backgroundColor: 'var(--input-bg)',
      border: '1px solid var(--input-border)',
      borderRadius: '2px',
      color: 'var(--text-1)',
    },
    '&.cm-editor .cm-panel.cm-search input::placeholder': { color: 'var(--input-placeholder)' },
    '&.cm-editor .cm-panel.cm-search input:focus': { borderColor: 'var(--accent)' },
    '&.cm-editor .cm-panel.cm-search button.cm-button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--btn-secondary-bg)',
      border: '1px solid var(--btn-border)',
      borderRadius: '2px',
      color: 'var(--btn-secondary-fg)',
    },
    '&.cm-editor .cm-panel.cm-search button.cm-button:hover': {
      backgroundColor: 'var(--btn-secondary-hover-bg)',
    },
    '&.cm-editor .cm-panel.cm-search [name="close"]': { color: 'var(--text-2)' },
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
    // ---- Desktop (fine-pointer) metrics: VS Code's own editor chrome. Touch
    // keeps every rule above untouched — these rules only override. Gated by
    // the `.cm-desk` root class (an editorAttributes facet in `extensions()`,
    // same mechanism as `.cm-hasSelection`), NOT by an `@media` key: style-mod
    // substitutes the at-rule text for `&` inside a media object, which
    // renders every `&`-key under it as an unparsable selector — the whole
    // block silently becomes `not all`.
    // Active line as a 1px border, not a fill; the border disappears while a
    // selection exists, exactly as VS Code hides the line highlight during a
    // selection.
    '&.cm-editor.cm-desk .cm-activeLine': {
      backgroundColor: 'transparent',
      boxShadow: 'none',
      outline: '1px solid var(--code-active-line-border)',
      outlineOffset: '-1px',
    },
    '&.cm-editor.cm-desk.cm-hasSelection .cm-activeLine': { outline: 'none' },
    '&.cm-editor.cm-desk .cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--code-gutter-fg-active)',
    },
    // Line numbers breathe: 8px off the edge, 16px before the code. The
    // content's 12px replaces the 4px iOS-handle clearance (no handles here).
    '&.cm-editor.cm-desk .cm-lineNumbers .cm-gutterElement': { padding: '0 16px 0 8px' },
    '&.cm-editor.cm-desk .cm-content': { paddingLeft: '12px' },
    // No line wrap at desk (see `extensions()`), so the horizontal scrollbar
    // exists — keep it thin and dark rather than the chunky platform default.
    '&.cm-editor.cm-desk .cm-scroller::-webkit-scrollbar': { height: '10px', width: '10px' },
    '&.cm-editor.cm-desk .cm-scroller::-webkit-scrollbar-track': { background: 'transparent' },
    '&.cm-editor.cm-desk .cm-scroller::-webkit-scrollbar-thumb': {
      background: 'var(--scrollbar-slider)',
      borderRadius: '0',
    },
    '&.cm-editor.cm-desk .cm-scroller::-webkit-scrollbar-thumb:hover': {
      background: 'var(--scrollbar-slider-hover)',
    },
    // Find widget pins to the editor's top-right corner and overlays the
    // code instead of pushing it down (.cm-editor is position:relative, so
    // the panels container collapses to nothing).
    '&.cm-editor.cm-desk .cm-panel.cm-search': {
      position: 'absolute',
      top: '0',
      right: '14px',
      width: 'auto',
      zIndex: '10',
    },
    // Completion popup on VS Code's suggest-widget metrics: flat dark panel,
    // 22px rows, blue selection with white ink (no accent rail — the fill is
    // now far above the 1.1:1 that made the rail necessary on touch).
    '&.cm-editor.cm-desk .cm-tooltip': {
      backgroundColor: 'var(--code-widget-bg)',
      border: '1px solid var(--border-widget)',
      borderRadius: '3px',
    },
    '&.cm-editor.cm-desk .cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      minHeight: '22px',
      paddingInline: '8px',
      fontSize: '13px',
    },
    '&.cm-editor.cm-desk .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--list-active-sel-bg)',
      color: 'var(--list-active-sel-fg)',
      boxShadow: 'none',
    },
    '&.cm-editor.cm-desk .cm-completionMatchedText': {
      color: 'var(--list-highlight)',
      fontWeight: '400',
    },
    // VS Code's suggest kind colours (an editor-domain palette like
    // syntaxColors above, so literals are correct here — not chrome).
    '&.cm-editor.cm-desk .cm-completionIcon-function, &.cm-editor.cm-desk .cm-completionIcon-method': {
      color: '#B180D7',
    },
    '&.cm-editor.cm-desk .cm-completionIcon-variable, &.cm-editor.cm-desk .cm-completionIcon-constant': {
      color: '#75BEFF',
    },
    '&.cm-editor.cm-desk .cm-completionIcon-class': { color: '#EE9D28' },
    '&.cm-editor.cm-desk .cm-completionIcon-keyword, &.cm-editor.cm-desk .cm-completionIcon-snippet': {
      color: 'var(--text-3)',
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
  /**
   * Move the caret to the start of `line` (1-based, clamped to the document)
   * and scroll it into view. Consumed by the status bar's Ln/Col item and the
   * quick-input `:` mode — the widget parses the number, the editor moves.
   */
  gotoLine(line: number): void
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
   *
   * Leading is density-split: 1.6 on touch (finger-height rows), VS Code's
   * tighter 1.35 at desk. The gutter also drops its fixed 13px at desk — VS
   * Code renders line numbers at the code size.
   */
  const themeFor = (px: number) => {
    const leading = `${Math.round(px * 1.6)}px`
    const deskLeading = `${Math.round(px * 1.35)}px`
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
      [DESK_KEY]: {
        '.cm-content': { lineHeight: deskLeading },
        '.cm-gutters': { fontSize: `${px}px`, lineHeight: deskLeading },
        '.cm-lineNumbers .cm-gutterElement': { lineHeight: deskLeading },
      },
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
    // The find widget mounts above the code (`top: true`), styled in
    // chromeTheme as VS Code's floating top-right panel at desk.
    search({ top: true }),
    // Select a word and every other occurrence lights up (--code-selection-match).
    highlightSelectionMatches(),
    // VS Code hides the active-line highlight while a selection exists; the
    // desk chromeTheme rules key off this class. An attributes facet rather
    // than a ViewPlugin because facets may derive from state on every update,
    // where a plugin writing DOM in update() is a documented foot-gun.
    EditorView.editorAttributes.of((v) =>
      v.state.selection.main.empty ? null : { class: 'cm-hasSelection' },
    ),
    // The desk chromeTheme rules key off `.cm-desk` on the root — a class, not
    // an `@media` key, because style-mod cannot host `&`-keys inside an
    // at-rule (see the note in chromeTheme). Evaluated once per state build,
    // the same resize caveat as lineWrapping below.
    window.matchMedia(DESK_MEDIA).matches
      ? EditorView.editorAttributes.of({ class: 'cm-desk' })
      : [],
    indentUnit.of('    '),
    // Python's control flow *is* its indentation, and line wrapping makes the
    // eye lose the column. One hairline per level puts it back.
    indentGuides(4),
    // Wrap rather than scroll horizontally on touch: a wrapped line is readable
    // on a phone, a horizontally-scrolling one is not. At desk it is the
    // opposite — VS Code does not wrap — so the choice is evaluated once per
    // state build (a resize across 900px mid-session keeps the old behavior
    // until the next file open; acceptable, and cheaper than a reconfigure).
    window.matchMedia(DESK_MEDIA).matches ? [] : EditorView.lineWrapping,
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
      // Swallow defaultKeymap's insertBlankLine on Mod-Enter: returning true
      // stops CodeMirror from editing the document, but the DOM event still
      // bubbles, so the shell's run-file handler fires — without this, running
      // via Ctrl+Enter also inserted a blank line at the caret.
      { key: 'Mod-Enter', run: () => true },
      ...searchKeymap,
      // VS Code muscle memory: Mod-h opens the same panel (replace is part of
      // the one widget here, not a separate surface).
      { key: 'Mod-h', run: openSearchPanel },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    // Dark+ syntax colours (see syntaxColors above — oneDark is gone);
    // chromeTheme keeps the surfaces, gutter, caret and selection on Design's
    // tokens. With no unlayered oneDark module in the fight any more, the
    // `&.cm-editor` specificity in chromeTheme is belt-and-braces, and cheap.
    syntaxHighlighting(syntaxColors),
    // After syntaxHighlighting so the depth marks beat the flat punctuation
    // grey (#D4D4D4) on the same spans.
    rainbowBrackets(),
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
    gotoLine(line) {
      const doc = view.state.doc
      const clamped = Math.max(1, Math.min(Math.floor(line), doc.lines))
      view.dispatch({ selection: { anchor: doc.line(clamped).from }, scrollIntoView: true })
      view.focus()
    },
    focus: () => view.focus(),
    currentPath: () => path,
    destroy: () => view.destroy(),
  }
}
