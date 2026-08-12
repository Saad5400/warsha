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
  runScopeHandlers,
  tooltips,
  type Panel,
  type ViewUpdate,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  search,
  searchKeymap,
  highlightSelectionMatches,
  openSearchPanel,
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from '@codemirror/search'
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
import { lintKeymap, openLintPanel, closeLintPanel, forEachDiagnostic } from '@codemirror/lint'
import { enabledEditorExtensions } from '../extensions/registry'
// Type-only: the collab binding is built in ../collab and injected via
// `setCollab`, so the editor stays free of any yjs/y-codemirror.next import and
// the base app tree-shakes collaboration away entirely.
import type { CollabBinding } from '../collab/editorBridge'
import { completionSources, type CompletionLang } from './completions'
import { hoverDocs } from './hoverDocs'
import { linting } from './lint'

/**
 * Editor exception sink (M1). y-codemirror.next's remote-selection plugin can throw
 * a bounds `RangeError` ("Invalid position N in document of length M") when a remote
 * awareness cursor resolves to a Y.Text index momentarily ahead of the local
 * CodeMirror document during a concurrent content/awareness sync race (multi-peer
 * editing). CodeMirror already ISOLATES the throw — the plugin is skipped for that
 * one update and re-renders correctly on the next — so it is non-fatal; but by
 * default it floods `console.error`. We swallow ONLY that specific benign error
 * (a bounds RangeError raised from the remote-selection plugin) and forward
 * everything else, so genuine plugin crashes still surface.
 *
 * Why not a "real" fix: the only precise fix is a two-line index clamp inside the
 * library's `YRemoteSelectionsPluginValue.update`, which lives in node_modules
 * (must not be patched). Recomposing `yCollab` from exports to substitute a clamped
 * selections plugin is impossible — y-codemirror.next does not export its
 * undo-manager facet/plugin, so a recompose would silently break the verified-good
 * per-file local-only CRDT undo. Swallowing the isolated, benign error in our own
 * wiring is the clean, low-risk path. Documented in COLLAB-SYNC-CONTRACT §7.4.
 */
function editorExceptionSink(err: unknown): void {
  const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : ''
  const isBounds = err instanceof RangeError && /Invalid position \d+ in document of length \d+/.test(err.message)
  const fromRemoteSelections = /y-codemirror|YRemoteSelection|RemoteSelection/.test(stack)
  // Swallow the known benign case; a stack that lost the signature still only ever
  // swallows this exact bounds RangeError, never an unrelated exception.
  if (isBounds && (fromRemoteSelections || stack === '')) return
  console.error(err)
}

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
export type EditorLang = 'java' | 'python' | 'csharp' | 'c' | 'html' | 'css' | 'javascript'

export function editorLangForPath(path: string): EditorLang | null {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.cs')) return 'csharp'
  if (path.endsWith('.c') || path.endsWith('.h')) return 'c'
  if (/\.html?$/i.test(path)) return 'html'
  // Svelte/Vue single-file components are HTML-shaped — a template with embedded
  // <script>/<style> blocks — so the HTML grammar (which highlights those blocks
  // as JS/CSS) colours them properly. Their framework-specific bits ({count},
  // {{ }}, directives) aren't specially tokenised, but the file is no longer flat
  // white text, and this needs no extra grammar package.
  if (/\.(svelte|vue)$/i.test(path)) return 'html'
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
/**
 * A bold wavy underline as a repeating background image — the lint squiggle.
 *
 * `text-decoration: wavy` is what a first pass reached for, but Chrome draws it
 * thin and shallow, and on the dark canvas the soft `--danger` red all but
 * vanishes (the "barely visible" report). @codemirror/lint's own SVG is nearly
 * as faint (stroke .7). This wave is taller (amplitude 2 over a 4px tile) and
 * heavier (stroke 1.2), so it reads as an angry squiggle rather than a hairline.
 *
 * The colour is baked into the data URI — a `data:` URI cannot read a CSS custom
 * property — so these three are the literal --danger/--warn/--info values from
 * docs/design/tokens.css and must be kept in step with them. The editor is
 * dark-only (see syntaxColors), so there is no light-theme variant to track.
 */
const squiggle = (color: string) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="4">` +
    `<path d="m0 3 l1.5 -2 l1.5 2 l1.5 -2 l1.5 2" fill="none" stroke="${color}" stroke-width="1.2"/>` +
    `</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
const DANGER_SQUIGGLE = squiggle('#FF8A8F') // --danger
const WARN_SQUIGGLE = squiggle('#E5B95C') // --warn
const INFO_SQUIGGLE = squiggle('#7FC4F5') // --info

const chromeTheme = EditorView.theme(
  {
    '&.cm-editor': {
      backgroundColor: 'var(--code-bg)',
      color: 'var(--text-1)',
      // CODE IS LTR IN EVERY LANGUAGE, and this is the pin that keeps it so.
      //
      // With Arabic selected the app sets `<html dir="rtl">`, and CodeMirror
      // reads its direction from the computed style — so without this the whole
      // editor flips: the gutter jumps to the right, line 1 starts at the right
      // margin, and `if (x) {` renders with its brace on the wrong side. No
      // language Warsha runs is written right-to-left, and the student's
      // textbook, their teacher's slides and every stack trace they will ever
      // read agree.
      //
      // Arabic INSIDE the code still renders correctly: this fixes the
      // paragraph direction of each line, and the bidi algorithm still shapes
      // and orders an Arabic run within a string literal — `print("مرحبا")`
      // looks right, the line around it does not move.
      direction: 'ltr',
      // Belt and braces: `direction` sets the flow, but an inherited
      // `text-align: right` from an RTL ancestor would still push short lines
      // across the canvas.
      textAlign: 'left',
    },
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
    // Drop the fill while a selection exists (desk does the same, line ~670).
    // drawSelection paints the selection in a layer BELOW the content, so this
    // opaque fill would otherwise cover it on the caret's line — and a part-line
    // selection sits entirely on that line, which is why it looked invisible.
    '&.cm-editor.cm-hasSelection .cm-activeLine': {
      backgroundColor: 'transparent',
      boxShadow: 'none',
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
    // ---- Find widget (custom `createPanel` — the FindPanel class below — on
    // VS Code's find-widget anatomy: chevron | [input + toggle chips] count
    // prev next close, with the replace row collapsed behind the chevron).
    // Touch is the default here: a full-width bar docked at the panel top,
    // 16px input (iOS zoom guard), 36px icon buttons whose ::after pseudo
    // carries the 44px effective target. The .cm-desk block below compacts
    // everything to VS Code's own metrics and pins the widget top-right.
    '&.cm-editor .cm-panels': { backgroundColor: 'transparent' },
    '&.cm-editor .cm-panels-top': { borderBottom: 'none' },
    '&.cm-editor .cm-panel.cm-search': {
      display: 'flex',
      alignItems: 'stretch',
      gap: '4px',
      backgroundColor: 'var(--widget-bg)',
      borderBottom: '1px solid var(--border-widget)',
      fontFamily: 'var(--font-ui)',
      fontSize: '13px',
      color: 'var(--text-2)',
      padding: '6px 8px',
    },
    // @codemirror/search's baseTheme absolutely-positions `[name=close]` and
    // puts `.2em .6em` margins on every input/button (its stock panel's
    // layout). Those selectors are (0,2,1); ours below are (0,2,0) — this
    // (0,3,1) rule puts the flex layout back in charge.
    '&.cm-editor .cm-panel.cm-search .cm-find-btn, &.cm-editor .cm-panel.cm-search .cm-find-chip, &.cm-editor .cm-panel.cm-search .cm-find-toggle, &.cm-editor .cm-panel.cm-search .cm-find-input': {
      position: 'relative',
      margin: '0',
    },
    '.cm-find-toggle': {
      flex: 'none',
      alignSelf: 'stretch',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      padding: '0',
      border: 'none',
      borderRadius: '3px',
      background: 'transparent',
      color: 'var(--text-2)',
      position: 'relative',
      cursor: 'pointer',
    },
    '.cm-find-body': {
      flex: '1',
      minWidth: '0',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    },
    '.cm-find-row': { display: 'flex', alignItems: 'center', gap: '4px' },
    '.cm-find-row-replace': { display: 'none' },
    '&.cm-editor .cm-find-replace-shown .cm-find-row-replace': { display: 'flex' },
    // The bordered box is the WRAP (input + chips inside it, VS Code-style);
    // the input itself is borderless, so the wrap's :focus-within accent
    // border is the visible focus ring — never invisible, just relocated one
    // element up (the index.css "no focus:outline-none" rule's intent).
    '.cm-find-input-wrap': {
      flex: '1',
      minWidth: '0',
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      backgroundColor: 'var(--input-bg)',
      border: '1px solid var(--input-border)',
      borderRadius: '2px',
      paddingRight: '2px',
    },
    '.cm-find-input-wrap:focus-within': { borderColor: 'var(--accent)' },
    // VS Code turns the box red when the needle finds nothing; keep it red
    // while focused too (the :focus-within accent would otherwise win on
    // specificity).
    '.cm-find-input-wrap.cm-find-no-match, .cm-find-input-wrap.cm-find-no-match:focus-within': {
      borderColor: 'var(--danger)',
    },
    '.cm-find-input': {
      flex: '1',
      minWidth: '0',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      color: 'var(--text-1)',
      fontFamily: 'var(--font-ui)',
      fontSize: '16px',
      padding: '9px 8px',
    },
    '.cm-find-input::placeholder': { color: 'var(--input-placeholder)' },
    // Match-case / whole-word / regex, as VS Code's compact toggle chips
    // riding inside the input box. aria-pressed doubles as the styling hook.
    '.cm-find-chip': {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '24px',
      height: '24px',
      padding: '0',
      border: '1px solid transparent',
      borderRadius: '3px',
      background: 'transparent',
      color: 'var(--text-2)',
      position: 'relative',
      cursor: 'pointer',
    },
    '.cm-find-chip:hover': { backgroundColor: 'var(--toolbar-hover-bg)' },
    '.cm-find-chip[aria-pressed="true"]': {
      backgroundColor: 'var(--accent-soft)',
      borderColor: 'var(--accent)',
      color: 'var(--text-1)',
    },
    '.cm-find-count': {
      flex: 'none',
      textAlign: 'center',
      fontSize: '12px',
      color: 'var(--text-2)',
      whiteSpace: 'nowrap',
    },
    '.cm-find-btn': {
      flex: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      padding: '0',
      border: 'none',
      borderRadius: '3px',
      background: 'transparent',
      color: 'var(--text-2)',
      position: 'relative',
      cursor: 'pointer',
    },
    '.cm-find-btn:hover, .cm-find-toggle:hover': { backgroundColor: 'var(--toolbar-hover-bg)' },
    '.cm-find-btn:disabled': { opacity: '0.4', pointerEvents: 'none' },
    // 44px effective targets on touch: 32px visual + 6px halo on buttons,
    // 24px visual + 10px halo on the chips and chevron (DENSITY.md pattern —
    // a 390px row cannot fit five 44px boxes AND a usable input, so the
    // halos carry the difference; they overlap a little, which beats a
    // 30px-wide find input).
    '.cm-find-btn::after': { content: '""', position: 'absolute', inset: '-6px' },
    '.cm-find-chip::after, .cm-find-toggle::after': {
      content: '""',
      position: 'absolute',
      inset: '-10px',
    },
    '.cm-find-btn svg, .cm-find-chip svg, .cm-find-toggle svg': {
      display: 'block',
      width: '16px',
      height: '16px',
    },
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
    //
    // Every `vw`/`vh` here divides by --ui-scale, and only the vw/vh part does.
    // A viewport unit inside the zoomed #root resolves against the raw viewport
    // and THEN paints scaled (the view scale block in index.css), so a bare
    // 100vw cap is the view scale too small — at 0.7 the popup gave up a third
    // of the phone screen it was entitled to. The px and ch caps beside them are
    // UI lengths and stay scaled, which is the whole point of them.
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete': {
      maxWidth: 'calc(100vw / var(--ui-scale, 1) - 2 * var(--sp-3))',
    },
    '&.cm-editor .cm-tooltip.cm-tooltip-autocomplete > ul': {
      fontFamily: 'var(--font-code)',
      maxHeight: 'min(calc(40vh / var(--ui-scale, 1)), 320px)',
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
      maxWidth: 'min(32ch, calc(100vw / var(--ui-scale, 1) - 2 * var(--sp-3)))',
      padding: 'var(--sp-2) var(--sp-3)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-meta)',
      color: 'var(--text-2)',
    },
    // An info panel hosting a docs card (dictionary entries carry one) gets
    // the card's own measure — 32ch truncates a signature line too eagerly.
    '&.cm-editor .cm-tooltip.cm-completionInfo:has(.cm-docs)': {
      maxWidth: 'min(420px, calc(100vw / var(--ui-scale, 1) - 2 * var(--sp-3)))',
    },
    // On a phone the popup is nearly viewport-wide, so CodeMirror finds no room to
    // set the info panel beside the option list and falls back to its `-narrow`
    // placement: 30px in from the list's own edge — i.e. painted directly ON TOP
    // of the options (the reported overlap). Better to drop it there: every row
    // already carries its one-line gloss in `.cm-completionDetail`, and the full
    // docs card is a long-press away (the bottom docs dock). The side panel stays
    // untouched at desk, where there is room for it and this narrow case never
    // triggers unless the editor pane itself is squeezed thinner than the popup.
    '&.cm-editor .cm-tooltip.cm-completionInfo.cm-completionInfo-left-narrow, &.cm-editor .cm-tooltip.cm-completionInfo.cm-completionInfo-right-narrow':
      {
        display: 'none',
      },
    // ---- Docs card (hover / long-press / Ctrl+K Ctrl+I — editor/hoverDocs.ts).
    // One card DOM (`.cm-docs`, built in completions.ts), two hosts: the hover
    // tooltip below and the completion info panel above. VS Code's hover-widget
    // look at both densities: --code-widget-bg panel, 1px --border-widget, 3px
    // radius, subtle shadow, capped at ~420px against the viewport.
    '&.cm-editor .cm-tooltip.cm-tooltip-docs': {
      backgroundColor: 'var(--code-widget-bg)',
      border: '1px solid var(--border-widget)',
      borderRadius: '3px',
      boxShadow: 'var(--shadow-raised)',
      maxWidth: 'min(420px, calc(100vw / var(--ui-scale, 1) - 2 * var(--sp-3)))',
      padding: 'var(--sp-2) var(--sp-3)',
    },
    '&.cm-editor .cm-docs': {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--sp-1)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-meta)',
      lineHeight: '1.5',
      color: 'var(--text-2)',
    },
    // The signature line, in the code font — VS Code's hover anatomy.
    '&.cm-editor .cm-docs-signature': {
      fontFamily: 'var(--font-code)',
      color: 'var(--text-1)',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    },
    '&.cm-editor .cm-docs-body': { whiteSpace: 'pre-line' },
    // A user doc comment's lead sentence (renderDocCard's boldLead).
    '&.cm-editor .cm-docs-body strong': { color: 'var(--text-1)', fontWeight: '600' },
    '&.cm-editor .cm-docs-example': {
      fontFamily: 'var(--font-code)',
      fontSize: 'var(--fs-micro)',
      color: 'var(--text-3)',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    },
    // A touch long-press docks the SAME docs card (editor/hoverDocs.ts) as a
    // bottom strip rather than a tooltip above the word — on touch the OS
    // selection bar owns the space above the word. A CodeMirror bottom panel:
    // full-width, out of that bar's path, tall content scrolling within itself,
    // and clear of the home indicator. `.cm-panel` is CM's own class; the panel
    // hosts the unchanged `.cm-docs` styled above.
    '&.cm-editor .cm-panels-bottom': { borderTop: 'none' },
    '&.cm-editor .cm-panel.cm-docs-dock': {
      backgroundColor: 'var(--code-widget-bg)',
      borderTop: '1px solid var(--border-widget)',
      boxShadow: 'var(--shadow-raised)',
      padding: 'var(--sp-2) var(--sp-3)',
      paddingBottom: 'max(var(--sp-2), env(safe-area-inset-bottom))',
      maxHeight: '45%',
      overflowY: 'auto',
    },
    // ---- The red line (editor/lint.ts) and its problems panel. -----------
    // The squiggle. The browser's own `text-decoration: wavy` renders faint and
    // shallow on the dark canvas — barely a line — and @codemirror/lint's stock
    // SVG is nearly as thin, so paint a bolder wave (taller amplitude, heavier
    // stroke) via `squiggle()` above, in Design's severity colours. Keep the
    // package's `repeat-x`/`left bottom` positioning, which already sits the
    // wave right under the glyphs. `&.cm-editor` (0,2,0) beats the bare class.
    '&.cm-editor .cm-lintRange': {
      backgroundRepeat: 'repeat-x',
      backgroundPosition: 'left bottom',
      // A touch of room so the wave clears descenders (g, p, y) instead of
      // colliding with them; `skip-ink` does not apply to a background image.
      paddingBottom: '2px',
    },
    '&.cm-editor .cm-lintRange-error': { backgroundImage: DANGER_SQUIGGLE },
    '&.cm-editor .cm-lintRange-warning': { backgroundImage: WARN_SQUIGGLE },
    '&.cm-editor .cm-lintRange-info, &.cm-editor .cm-lintRange-hint': {
      backgroundImage: INFO_SQUIGGLE,
    },
    // The range lit while its diagnostic is hovered or selected in the panel.
    '&.cm-editor .cm-lintRange-active': {
      backgroundColor: 'color-mix(in srgb, var(--warn) 20%, transparent)',
    },
    // The message tooltip (hover, and the panel row) inherits `.cm-tooltip`'s
    // surface above; these style its parts. `cm-tooltip-lint` caps width so a
    // sentence never runs off a phone, same viewport maths as the popup.
    '&.cm-editor .cm-tooltip-lint': {
      maxWidth: 'min(360px, calc(100vw / var(--ui-scale, 1) - 2 * var(--sp-3)))',
      padding: 'var(--sp-1) 0',
    },
    '&.cm-editor .cm-diagnostic': {
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-meta)',
      lineHeight: '1.5',
      color: 'var(--text-2)',
      padding: 'var(--sp-1) var(--sp-3)',
      borderLeft: '3px solid transparent',
    },
    '&.cm-editor .cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
    '&.cm-editor .cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
    '&.cm-editor .cm-diagnostic-info, &.cm-editor .cm-diagnostic-hint': {
      borderLeftColor: 'var(--info)',
    },
    // The fix button. The default is a grey pill; make it a real Warsha button,
    // with a 44px tap target held off-glyph by an ::after halo (the same trick
    // the find buttons use) so a thumb can hit it in the panel on a phone.
    '&.cm-editor .cm-diagnosticAction': {
      display: 'inline-block',
      position: 'relative',
      marginTop: 'var(--sp-2)',
      marginRight: 'var(--sp-2)',
      padding: '4px var(--sp-3)',
      borderRadius: 'var(--r-sm)',
      backgroundColor: 'var(--surface-4)',
      color: 'var(--text-1)',
      border: '1px solid var(--border-subtle)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--fs-meta)',
      cursor: 'pointer',
    },
    '&.cm-editor .cm-diagnosticAction:hover': { backgroundColor: 'var(--surface-3)' },
    '&.cm-editor .cm-diagnosticSource': {
      fontSize: 'var(--fs-micro)',
      color: 'var(--text-3)',
      marginTop: 'var(--sp-1)',
    },
    // The problems panel — the touch/keyboard way to reach every red line at
    // once (the status bar's problems item opens it). Docks at the bottom on
    // the same anatomy as the docs dock above.
    '&.cm-editor .cm-panel.cm-panel-lint': {
      backgroundColor: 'var(--code-widget-bg)',
      borderTop: '1px solid var(--border-widget)',
      boxShadow: 'var(--shadow-raised)',
    },
    '&.cm-editor .cm-panel.cm-panel-lint ul': {
      maxHeight: '35vh',
      paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
    },
    '&.cm-editor .cm-panel.cm-panel-lint ul [aria-selected]': {
      backgroundColor: 'var(--surface-4)',
    },
    '&.cm-editor .cm-panel.cm-panel-lint button[name="close"]': {
      color: 'var(--text-3)',
      cursor: 'pointer',
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
    // the panels container collapses to nothing). Metrics compact to VS
    // Code's own: 24px input row, 20px chips, 22px icon buttons.
    '&.cm-editor.cm-desk .cm-panel.cm-search': {
      position: 'absolute',
      top: '0',
      right: '14px',
      width: 'auto',
      zIndex: '10',
      border: '1px solid var(--border-widget)',
      borderTop: 'none',
      borderRadius: '0 0 4px 4px',
      boxShadow: 'var(--shadow-raised)',
      padding: '4px 6px 4px 2px',
      gap: '2px',
    },
    '&.cm-editor.cm-desk .cm-find-body': { gap: '4px' },
    '&.cm-editor.cm-desk .cm-find-input-wrap': { flex: 'none', width: '200px' },
    '&.cm-editor.cm-desk .cm-find-input': { fontSize: '13px', padding: '3px 5px' },
    '&.cm-editor.cm-desk .cm-find-chip': { width: '20px', height: '20px' },
    '&.cm-editor.cm-desk .cm-find-btn': { width: '22px', height: '22px' },
    '&.cm-editor.cm-desk .cm-find-toggle': { width: '16px' },
    // Fine pointer: the touch hit halo is off (it would overlap neighbours
    // at these VS Code metrics, and 22px is fine to click).
    '&.cm-editor.cm-desk .cm-find-btn::after, &.cm-editor.cm-desk .cm-find-chip::after, &.cm-editor.cm-desk .cm-find-toggle::after': {
      display: 'none',
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

/**
 * ------------------------------------------------------------- Find widget
 *
 * A custom `createPanel` for @codemirror/search, replacing the stock panel
 * (text-label "next / previous / all" buttons and bare checkboxes — founder:
 * "does not look like real vscode") with VS Code's find-widget anatomy:
 *
 *   [›] [ needle   Aa ab .* ] 1 of 12  ↑ ↓ ×
 *       [ replace           ]  ⇄ ⇄*        (collapsed behind the chevron)
 *
 * All search *behavior* is still @codemirror/search's own commands — this
 * class only owns the DOM. Styling lives in chromeTheme above (touch default
 * + .cm-desk compaction); icons are verbatim VS Code codicon paths.
 */
const findIcons = {
  'arrow-up': '<path d="M13.854 7.14576L8.85401 2.14576C8.65901 1.95076 8.34201 1.95076 8.14701 2.14576L3.14601 7.14576C2.95101 7.34076 2.95101 7.65776 3.14601 7.85276C3.34101 8.04776 3.65801 8.04776 3.85301 7.85276L7.99901 3.70676V13.4998C7.99901 13.7758 8.22301 13.9998 8.49901 13.9998C8.77501 13.9998 8.99901 13.7758 8.99901 13.4998V3.70676L13.145 7.85276C13.243 7.95076 13.371 7.99876 13.499 7.99876C13.627 7.99876 13.755 7.94976 13.853 7.85276C14.048 7.65776 14.048 7.34076 13.853 7.14576H13.854Z"/>',
  'arrow-down': '<path d="M13.854 8.146C13.659 7.951 13.342 7.951 13.147 8.146L9.00096 12.292V2.5C9.00096 2.224 8.77696 2 8.50096 2C8.22496 2 8.00096 2.224 8.00096 2.5V12.293L3.85496 8.147C3.65996 7.952 3.34296 7.952 3.14796 8.147C2.95296 8.342 2.95296 8.659 3.14796 8.854L8.14796 13.854C8.24596 13.952 8.37396 14 8.50196 14C8.62996 14 8.75796 13.951 8.85596 13.854L13.856 8.854C14.051 8.659 14.051 8.342 13.856 8.147L13.854 8.146Z"/>',
  close:
    '<path d="M13.85 13.1502C14.05 13.3502 14.05 13.6602 13.85 13.8602C13.75 13.9602 13.62 14.0102 13.5 14.0102C13.38 14.0102 13.24 13.9602 13.15 13.8602L8 8.71023L2.85 13.8602C2.75 13.9602 2.62 14.0102 2.5 14.0102C2.38 14.0102 2.24 13.9602 2.15 13.8602C1.95 13.6602 1.95 13.3502 2.15 13.1502L7.3 8.00023L2.15 2.85023C1.95 2.65023 1.95 2.34023 2.15 2.14023C2.35 1.94023 2.66 1.94023 2.86 2.14023L8.01 7.29023L13.16 2.14023C13.36 1.94023 13.67 1.94023 13.87 2.14023C14.07 2.34023 14.07 2.65023 13.87 2.85023L8.72 8.00023L13.87 13.1502H13.85Z"/>',
  'case-sensitive':
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.02602 3.34176C4.16218 2.93404 4.83818 2.93398 4.97426 3.34176L6.97426 9.34274C6.97526 9.34674 6.97817 9.35544 6.97817 9.35544L7.97426 12.3427C8.06126 12.6047 7.91984 12.8875 7.65786 12.9756C7.60486 12.9926 7.55165 13.0009 7.49965 13.0009C7.29082 13.0008 7.09602 12.868 7.02602 12.6591L6.14028 10.0009H2.86L1.97426 12.6591C1.88728 12.919 1.60634 13.0634 1.34243 12.9746C1.08043 12.8866 0.93902 12.6038 1.02602 12.3418L2.02211 9.35544C2.02311 9.35144 2.02602 9.34274 2.02602 9.34274L4.02602 3.34176ZM3.19399 8.99997H5.80629L4.49965 5.08102L3.19399 8.99997Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M11.8581 6.66794C13.165 6.73296 13.9427 7.48427 13.9967 8.69626L13.9997 8.83297V12.5078C13.9957 12.7568 13.809 12.9621 13.568 12.9951L13.4997 13C13.2469 12.9998 13.0376 12.8121 13.0045 12.5683L12.9997 12.5V12.4297C12.3407 12.8066 11.7316 13 11.1666 13C9.94081 12.9998 8.99965 12.1369 8.99965 10.833C8.99967 9.68299 9.79211 8.82889 11.1061 8.66989C11.7279 8.59493 12.3589 8.64164 12.9987 8.80954C12.9915 8.07194 12.6279 7.70704 11.8082 7.66598C11.1672 7.63398 10.7158 7.72415 10.4518 7.90915C10.2258 8.06799 9.91347 8.01301 9.75551 7.78708C9.59671 7.56115 9.65178 7.24878 9.87758 7.09079C10.3165 6.78283 10.9138 6.64715 11.6666 6.6611L11.8581 6.66794ZM12.7965 9.8154C12.2587 9.66749 11.7361 9.62551 11.2262 9.68747C10.4042 9.78747 9.99868 10.2244 9.99868 10.8574C9.99884 11.5881 10.474 12.0242 11.1657 12.0244C11.6196 12.0244 12.1777 11.8137 12.8336 11.3818L12.9987 11.2695V9.87594L12.7965 9.8154Z"/>',
  'whole-word':
    '<path d="M15.5 12.5C15.776 12.5 16 12.724 16 13V13.5C16 14.327 15.327 15 14.5 15H1.5C0.673 15 0 14.327 0 13.5V13C0 12.724 0.224 12.5 0.5 12.5C0.776 12.5 1 12.724 1 13V13.5C1 13.775 1.224 14 1.5 14H14.5C14.776 14 15 13.775 15 13.5V13C15 12.724 15.224 12.5 15.5 12.5Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M4.8584 5.6709C6.16516 5.73603 6.94308 6.48734 6.99707 7.69922L7 7.83594V11.5107C6.996 11.7596 6.80919 11.9649 6.56836 11.998L6.5 12.0029C6.24709 12.0029 6.038 11.8152 6.00488 11.5713L6 11.5029V11.4326C5.341 11.8096 4.73199 12.0029 4.16699 12.0029C2.941 12.0029 2 11.1399 2 9.83594C2.00003 8.68597 2.79247 7.83185 4.10645 7.67285C4.7283 7.59793 5.35918 7.64552 5.99902 7.81348C5.99202 7.07548 5.62762 6.70995 4.80762 6.66895C4.16686 6.637 3.7161 6.72717 3.45215 6.91211C3.22615 7.07111 2.91386 7.01604 2.75586 6.79004C2.5969 6.56404 2.65194 6.25174 2.87793 6.09375C3.31692 5.78579 3.91404 5.65006 4.66699 5.66406L4.8584 5.6709ZM5.79688 8.81836C5.25888 8.67037 4.73558 8.62843 4.22559 8.69043C3.40389 8.79054 2.99902 9.22747 2.99902 9.86035C2.99917 10.5911 3.47413 11.0273 4.16602 11.0273C4.62001 11.0273 5.17799 10.8168 5.83398 10.3848L5.99902 10.2725V8.87891L5.79688 8.81836Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M9.55078 2.00586C9.78578 2.02986 9.97307 2.21715 9.99707 2.45215C10 2.46907 10 2.48601 10 2.50293V6.60254C10.418 6.22566 10.9371 6.00293 11.5 6.00293C12.881 6.00293 14 7.34596 14 9.00293C14 10.6599 12.881 12.0029 11.5 12.0029C10.9371 12.0029 10.418 11.7802 10 11.4033V11.5029C10 11.7619 9.80278 11.974 9.55078 12C9.53385 12.003 9.51693 12.0029 9.5 12.0029C9.224 12.0029 9 11.7789 9 11.5029V2.50293C9 2.486 9.00095 2.46907 9.00293 2.45215C9.02793 2.20015 9.241 2.00293 9.5 2.00293C9.51692 2.00293 9.53386 2.00388 9.55078 2.00586ZM11.4355 7.00391C11.0307 7.03208 10.5769 7.31545 10.29 7.82227C10.1232 8.12611 10.018 8.49479 10.002 8.89453C9.99995 8.92952 10 8.96597 10 9.00195C10 9.03795 10.001 9.07438 10.002 9.10938C10.018 9.50814 10.1222 9.87582 10.2891 10.1797C10.576 10.6875 11.0307 10.9728 11.4355 11C11.4565 11.002 11.478 11.002 11.5 11.002C11.522 11.002 11.5435 11.001 11.5645 11C11.9693 10.9728 12.424 10.6875 12.7109 10.1797C12.8778 9.87582 12.982 9.50814 12.998 9.10938C13 9.07438 13 9.03795 13 9.00195C13 8.96597 12.999 8.92952 12.998 8.89453C12.982 8.49479 12.8768 8.12611 12.71 7.82227C12.4231 7.31545 11.9693 7.03109 11.5645 7.00391C11.5435 7.00191 11.522 7.00195 11.5 7.00195C11.478 7.00195 11.4565 7.00291 11.4355 7.00391Z"/>',
  regex:
    '<path d="M11.498 5H9.705L10.973 3.732C11.168 3.537 11.168 3.22 10.973 3.025C10.778 2.83 10.461 2.83 10.266 3.025L8.998 4.293V2.5C8.998 2.224 8.774 2 8.498 2C8.222 2 7.998 2.224 7.998 2.5V4.293L6.73 3.025C6.535 2.83 6.218 2.83 6.023 3.025C5.828 3.22 5.828 3.537 6.023 3.732L7.291 5H5.498C5.222 5 4.998 5.224 4.998 5.5C4.998 5.776 5.222 6 5.498 6H7.291L6.023 7.268C5.828 7.463 5.828 7.78 6.023 7.975C6.121 8.073 6.249 8.121 6.377 8.121C6.505 8.121 6.633 8.072 6.731 7.975L7.999 6.707V8.5C7.999 8.776 8.223 9 8.499 9C8.775 9 8.999 8.776 8.999 8.5V6.707L10.267 7.975C10.365 8.073 10.493 8.121 10.621 8.121C10.749 8.121 10.877 8.072 10.975 7.975C11.17 7.78 11.17 7.463 10.975 7.268L9.707 6H11.5C11.776 6 12 5.776 12 5.5C12 5.224 11.776 5 11.5 5H11.498ZM5 12C5 12.552 4.552 13 4 13C3.448 13 3 12.552 3 12C3 11.448 3.448 11 4 11C4.552 11 5 11.448 5 12Z"/>',
  'chevron-right':
    '<path d="M6.14601 3.14579C5.95101 3.34079 5.95101 3.65779 6.14601 3.85279L10.292 7.99879L6.14601 12.1448C5.95101 12.3398 5.95101 12.6568 6.14601 12.8518C6.34101 13.0468 6.65801 13.0468 6.85301 12.8518L11.353 8.35179C11.548 8.15679 11.548 7.83979 11.353 7.64478L6.85301 3.14479C6.65801 2.94979 6.34101 2.95079 6.14601 3.14579Z"/>',
  'chevron-down':
    '<path d="M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"/>',
  replace:
    '<path fill-rule="evenodd" clip-rule="evenodd" d="M10 2.813C10.295 2.619 10.634 2.5 11 2.5C12.103 2.5 13 3.509 13 4.75C13 5.991 12.103 7 11 7C10.62 7 10.269 6.873 9.966 6.666C9.897 6.86 9.717 7 9.5 7C9.224 7 9 6.776 9 6.5V1.5C9 1.224 9.224 1 9.5 1C9.776 1 10 1.224 10 1.5V2.813ZM10 4.75C10 5.439 10.448 6 11 6C11.552 6 12 5.439 12 4.75C12 4.061 11.552 3.5 11 3.5C10.448 3.5 10 4.061 10 4.75Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M2 9H7C7.552 9 8 9.448 8 10V15C8 15.552 7.552 16 7 16H2C1.448 16 1 15.552 1 15V10C1 9.448 1.448 9 2 9ZM5.039 13.645C4.81 13.849 4.199 13.968 3.83 13.506C3.617 13.24 3.5 12.88 3.5 12.492C3.5 12.104 3.618 11.744 3.83 11.478C4.201 11.014 4.811 11.133 5.04 11.339C5.244 11.525 5.56 11.507 5.746 11.303C5.931 11.098 5.915 10.782 5.709 10.597C4.922 9.887 3.733 10.001 3.049 10.853C2.695 11.297 2.5 11.878 2.5 12.492C2.5 13.106 2.695 13.688 3.049 14.131C3.43 14.605 3.945 14.867 4.5 14.867C4.941 14.867 5.359 14.701 5.708 14.387C5.913 14.202 5.93 13.886 5.745 13.681C5.559 13.476 5.243 13.458 5.039 13.645Z"/><path d="M3.99998 4.5C3.99998 3.673 4.67298 3 5.49998 3H7.50198C7.77798 3 8.00198 3.224 8.00198 3.5C8.00198 3.776 7.77798 4 7.50198 4H5.50198C5.22598 4 5.00198 4.225 5.00198 4.5V6.293L6.14798 5.147C6.34298 4.952 6.65998 4.952 6.85498 5.147C7.04998 5.342 7.04998 5.659 6.85498 5.854L4.85498 7.854C4.75698 7.951 4.62898 8 4.50098 8C4.37298 8 4.24498 7.952 4.14698 7.854L2.14698 5.854C1.95198 5.659 1.95198 5.342 2.14698 5.147C2.34198 4.952 2.65898 4.952 2.85398 5.147L3.99998 6.293V4.5Z"/>',
  'replace-all':
    '<path d="M14 13V10C14 8.35 12.65 7 11 7H5.12L4.12 8H11C12.1 8 13 8.9 13 10V14C13.55 14 14 13.55 14 13Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M10.999 5.5V2.75C10.999 1.765 10.12 1.25 9.25 1.25C8.362 1.25 7.989 1.553 7.896 1.646C7.701 1.841 7.687 2.17 7.882 2.365C8.076 2.561 8.379 2.573 8.575 2.378C8.57462 2.37825 8.57506 2.37797 8.575 2.378C8.58734 2.36997 8.77165 2.25 9.249 2.25C9.279 2.25 9.999 2.256 9.999 2.75V3.056C9.795 3.023 9.551 3 9.249 3C7.936 3 7.249 3.754 7.249 4.5C7.249 5.246 7.936 6 9.249 6C9.621 6 9.91 5.937 10.144 5.851C10.235 5.943 10.36 6 10.499 6C10.775 6 10.999 5.776 10.999 5.5ZM9.25 4C9.622 4 9.856 4.038 10 4.074V4.811C9.907 4.885 9.697 5 9.25 5C8.601 5 8.25 4.742 8.25 4.5C8.25 4.258 8.601 4 9.25 4Z"/><path d="M5.001 13.074C4.857 13.038 4.623 13 4.251 13C3.602 13 3.251 13.258 3.251 13.5C3.251 13.742 3.602 14 4.251 14C4.698 14 4.908 13.885 5.001 13.811V13.074Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M12 15V10C12 9.448 11.552 9 11 9H2C1.448 9 1 9.448 1 10V15C1 15.552 1.448 16 2 16H11C11.552 16 12 15.552 12 15ZM4.251 10.25C5.121 10.25 6 10.765 6 11.75V14.5C6 14.776 5.776 15 5.5 15C5.361 15 5.236 14.943 5.145 14.851C4.911 14.937 4.622 15 4.25 15C2.937 15 2.25 14.246 2.25 13.5C2.25 12.754 2.937 12 4.25 12C4.552 12 4.796 12.023 5 12.056V11.75C5 11.256 4.28 11.25 4.25 11.25C3.78749 11.25 3.6007 11.3631 3.57831 11.3767C3.57688 11.3775 3.57612 11.378 3.576 11.378C3.38 11.573 3.077 11.561 2.883 11.365C2.688 11.17 2.702 10.841 2.897 10.646C2.99 10.553 3.363 10.25 4.251 10.25ZM8.33 11.611C8.117 11.877 8 12.237 8 12.625C8 13.013 8.117 13.373 8.33 13.639C8.699 14.101 9.31 13.982 9.539 13.778C9.743 13.591 10.059 13.609 10.245 13.814C10.43 14.019 10.414 14.335 10.208 14.52C9.86 14.834 9.442 15 9 15C8.445 15 7.929 14.739 7.549 14.264C7.195 13.82 7 13.239 7 12.625C7 12.011 7.195 11.429 7.549 10.986C8.233 10.134 9.422 10.02 10.209 10.73C10.414 10.915 10.431 11.231 10.246 11.436C10.06 11.64 9.744 11.658 9.54 11.472C9.311 11.266 8.701 11.147 8.33 11.611Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M14 6C15.103 6 16 4.991 16 3.75C16 2.509 15.103 1.5 14 1.5C13.634 1.5 13.295 1.619 13 1.813V0.5C13 0.224 12.776 0 12.5 0C12.224 0 12 0.224 12 0.5V5.5C12 5.776 12.224 6 12.5 6C12.717 6 12.897 5.86 12.966 5.666C13.269 5.873 13.62 6 14 6ZM14 2.5C14.552 2.5 15 3.061 15 3.75C15 4.439 14.552 5 14 5C13.448 5 13 4.439 13 3.75C13 3.061 13.448 2.5 14 2.5Z"/><path d="M1.99998 4.5C1.99998 3.673 2.67298 3 3.49998 3H5.50198C5.77798 3 6.00198 3.224 6.00198 3.5C6.00198 3.776 5.77798 4 5.50198 4H3.50198C3.22598 4 3.00198 4.225 3.00198 4.5V6.293L4.14798 5.147C4.34298 4.952 4.65998 4.952 4.85498 5.147C5.04998 5.342 5.04998 5.659 4.85498 5.854L2.85498 7.854C2.75698 7.951 2.62898 8 2.50098 8C2.37298 8 2.24498 7.952 2.14698 7.854L0.146982 5.854C-0.0480176 5.659 -0.0480176 5.342 0.146982 5.147C0.341982 4.952 0.658982 4.952 0.853982 5.147L1.99998 6.293V4.5Z"/>',
} as const

function findIcon(name: keyof typeof findIcons): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = findIcons[name]
  return svg
}

/** Lets the Mod-h command reach the live panel to pop its replace row open. */
const findPanels = new WeakMap<EditorView, FindPanel>()

class FindPanel implements Panel {
  dom: HTMLElement
  top = true
  private searchField: HTMLInputElement
  private replaceField: HTMLInputElement
  private countEl: HTMLElement
  private wrapEl: HTMLElement
  private toggleBtn: HTMLButtonElement
  /** prev/next/replace/replace-all — dead without a valid non-empty needle,
   *  so they disable rather than sit there doing nothing (no dead UI). */
  private navBtns: HTMLButtonElement[] = []
  private caseSensitive: boolean
  private wholeWord: boolean
  private regexp: boolean
  private replaceShown = false

  constructor(readonly view: EditorView) {
    const q = getSearchQuery(view.state)
    this.caseSensitive = q.caseSensitive
    this.wholeWord = q.wholeWord
    this.regexp = q.regexp

    const button = (
      cls: string,
      name: string,
      label: string,
      icon: keyof typeof findIcons,
      onClick: () => void,
    ) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.name = name
      b.setAttribute('aria-label', label)
      b.title = label
      b.appendChild(findIcon(icon))
      // Keep focus in the find input across button taps — VS Code's widget
      // never yields focus to its own buttons (close still returns focus to
      // the editor: the input is inside the panel, which is the check
      // closeSearchPanel makes).
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => {
        e.preventDefault()
        onClick()
      })
      return b
    }
    const chip = (name: string, label: string, icon: keyof typeof findIcons, get: () => boolean, flip: () => void) => {
      const b = button('cm-find-chip', name, label, icon, () => {
        flip()
        b.setAttribute('aria-pressed', String(get()))
        this.commit(true)
      })
      b.setAttribute('aria-pressed', String(get()))
      return b
    }
    const input = (name: string, label: string) => {
      const i = document.createElement('input')
      i.type = 'text'
      i.className = 'cm-find-input'
      i.name = name
      i.placeholder = label
      i.setAttribute('aria-label', label)
      i.autocomplete = 'off'
      i.autocapitalize = 'off'
      i.spellcheck = false
      return i
    }

    this.searchField = input('search', 'Find')
    // openSearchPanel focuses/selects `[main-field]` when the panel is
    // already open (a second Mod-f re-seeds from the selection).
    this.searchField.setAttribute('main-field', 'true')
    this.searchField.value = q.search
    this.searchField.addEventListener('input', (e) => this.commit(!(e as InputEvent).isComposing))

    this.replaceField = input('replace', 'Replace')
    this.replaceField.value = q.replace
    this.replaceField.addEventListener('input', () => this.commit(false))

    this.wrapEl = document.createElement('div')
    this.wrapEl.className = 'cm-find-input-wrap'
    this.wrapEl.append(
      this.searchField,
      chip('case', 'Match case', 'case-sensitive', () => this.caseSensitive, () => (this.caseSensitive = !this.caseSensitive)),
      chip('word', 'Whole word', 'whole-word', () => this.wholeWord, () => (this.wholeWord = !this.wholeWord)),
      chip('re', 'Use regular expression', 'regex', () => this.regexp, () => (this.regexp = !this.regexp)),
    )

    this.countEl = document.createElement('span')
    this.countEl.className = 'cm-find-count'
    this.countEl.setAttribute('aria-live', 'polite')

    const prev = button('cm-find-btn', 'prev', 'Previous match (Shift+Enter)', 'arrow-up', () =>
      findPrevious(this.view),
    )
    const next = button('cm-find-btn', 'next', 'Next match (Enter)', 'arrow-down', () =>
      findNext(this.view),
    )
    const close = button('cm-find-btn', 'close', 'Close (Escape)', 'close', () =>
      closeSearchPanel(this.view),
    )

    const findRow = document.createElement('div')
    findRow.className = 'cm-find-row cm-find-row-find'
    findRow.append(this.wrapEl, this.countEl, prev, next, close)

    const replaceWrap = document.createElement('div')
    replaceWrap.className = 'cm-find-input-wrap'
    replaceWrap.append(this.replaceField)
    const doReplace = button('cm-find-btn', 'replace', 'Replace', 'replace', () => replaceNext(this.view))
    const doReplaceAll = button('cm-find-btn', 'replaceAll', 'Replace all', 'replace-all', () =>
      replaceAll(this.view),
    )
    const replaceRow = document.createElement('div')
    replaceRow.className = 'cm-find-row cm-find-row-replace'
    replaceRow.append(replaceWrap, doReplace, doReplaceAll)

    this.navBtns = [prev, next, doReplace, doReplaceAll]

    this.toggleBtn = button('cm-find-toggle', 'toggleReplace', 'Toggle replace', 'chevron-right', () =>
      this.setReplaceShown(!this.replaceShown),
    )
    this.toggleBtn.setAttribute('aria-expanded', 'false')

    const body = document.createElement('div')
    body.className = 'cm-find-body'
    body.append(findRow, replaceRow)

    this.dom = document.createElement('div')
    this.dom.className = 'cm-search cm-find'
    this.dom.addEventListener('keydown', this.onKeydown)
    this.dom.append(this.toggleBtn, body)

    findPanels.set(view, this)
    this.refresh()
  }

  mount() {
    this.searchField.focus()
    this.searchField.select()
  }

  update(u: ViewUpdate) {
    let setQ = false
    for (const tr of u.transactions)
      for (const ef of tr.effects) if (ef.is(setSearchQuery)) setQ = true
    // Another command rewrote the query (a re-opened panel re-seeds from the
    // selection) — mirror it into the fields before recounting.
    if (setQ) this.syncFields(getSearchQuery(u.state))
    if (setQ || u.docChanged || u.selectionSet) this.refresh()
  }

  destroy() {
    findPanels.delete(this.view)
  }

  setReplaceShown(show: boolean) {
    if (this.replaceShown === show) return
    this.replaceShown = show
    this.dom.classList.toggle('cm-find-replace-shown', show)
    this.toggleBtn.setAttribute('aria-expanded', String(show))
    this.toggleBtn.replaceChildren(findIcon(show ? 'chevron-down' : 'chevron-right'))
  }

  focusReplace() {
    this.setReplaceShown(true)
    this.replaceField.focus()
    this.replaceField.select()
  }

  private onKeydown = (e: KeyboardEvent) => {
    // Scoped bindings first: Escape→close (focus returns to the editor),
    // Mod-f→reselect, F3/Mod-g→next, Mod-Alt-Enter→replace all.
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && e.target === this.searchField) {
      e.preventDefault()
      ;(e.shiftKey ? findPrevious : findNext)(this.view)
    } else if (e.key === 'Enter' && e.target === this.replaceField) {
      e.preventDefault()
      replaceNext(this.view)
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'h' || e.key === 'H')) {
      // Mod-h inside the widget = VS Code's "toggle replace while finding".
      e.preventDefault()
      this.focusReplace()
    }
  }

  /** Field state → SearchQuery. `literal: true`: a student's "\n" is two
   *  characters unless they asked for regex, same as VS Code's find box. */
  private query(): SearchQuery {
    return new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseSensitive,
      wholeWord: this.wholeWord,
      regexp: this.regexp,
      replace: this.replaceField.value,
      literal: true,
    })
  }

  /** Push the fields into the search state; `follow` also moves the current
   *  match to the needle as it is typed (VS Code's live-jump), anchored at
   *  the selection start so extending the needle keeps the same match. */
  private commit(follow: boolean) {
    const q = this.query()
    if (!q.eq(getSearchQuery(this.view.state))) {
      this.view.dispatch({ effects: setSearchQuery.of(q) })
      if (follow && q.search && q.valid) {
        const { main } = this.view.state.selection
        if (!main.empty) this.view.dispatch({ selection: { anchor: main.from } })
        // findNext select-all's the focused search field on a hit (its
        // Enter-to-repeat behaviour). Mid-type that makes the next keystroke
        // replace the needle instead of extending it, so put the caret back.
        const caret: [number, number] = [this.searchField.selectionStart ?? 0, this.searchField.selectionEnd ?? 0]
        findNext(this.view)
        this.searchField.setSelectionRange(caret[0], caret[1])
      }
    }
    this.refresh()
  }

  private syncFields(q: SearchQuery) {
    if (this.searchField.value !== q.search) this.searchField.value = q.search
    if (this.replaceField.value !== q.replace) this.replaceField.value = q.replace
    this.caseSensitive = q.caseSensitive
    this.wholeWord = q.wholeWord
    this.regexp = q.regexp
    const chips = this.wrapEl.querySelectorAll<HTMLButtonElement>('.cm-find-chip')
    const on = [q.caseSensitive, q.wholeWord, q.regexp]
    chips.forEach((c, i) => c.setAttribute('aria-pressed', String(on[i])))
  }

  /** "N of M" — recounted per edit/selection move. Students' files are small;
   *  the count still caps at 999 so a pathological file cannot stall typing. */
  private refresh() {
    const state = this.view.state
    const q = getSearchQuery(state)
    let text = ''
    let none = false
    if (q.search && q.valid) {
      const { from, to } = state.selection.main
      let total = 0
      let current = 0
      const cursor = q.getCursor(state)
      for (let step = cursor.next(); !step.done; step = cursor.next()) {
        total++
        if (step.value.from === from && step.value.to === to) current = total
        if (total > 999) break
      }
      const cap = total > 999 ? '999+' : String(total)
      text = total === 0 ? 'No results' : current ? `${current} of ${cap}` : `${cap} found`
      none = total === 0
    }
    this.countEl.textContent = text
    this.wrapEl.classList.toggle('cm-find-no-match', none)
    const dead = !q.search || !q.valid || none
    for (const b of this.navBtns) b.disabled = dead
  }
}

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
    case 'c':
      // Same clike family (there is no dedicated Lezer C grammar); covers keywords,
      // types, strings, comments, numbers and the preprocessor — enough for colour.
      support = new LanguageSupport(
        StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).c),
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
  /**
   * Swap the enabled toggleable extensions to match the registry's current
   * state (extensions/registry.ts, backed by prefs). Called after the
   * Extensions view flips a switch — one live reconfigure, no editor rebuild.
   */
  setExtensions(): void
  /**
   * Attach or detach the live-collaboration binding (contract edge #1). Passing
   * a binding invalidates the per-file `states` cache and rebuilds the on-screen
   * file so its EditorState gains (or loses) the yCollab extension bound to that
   * file's `Y.Text`; passing `null` returns every file to solo editing.
   */
  setCollab(binding: CollabBinding | null): void
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
  /**
   * Toggle the problems panel — the list of every diagnostic in the file, each
   * with its fix button. The status bar's problems item calls this; it is the
   * pointer/touch route to the same panel the lint keymap opens (setup.ts).
   */
  toggleProblems(): void
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
    /**
     * How many errors and warnings the linter currently reports, for the status
     * bar's problems item (editor/lint.ts). Called only when the tally changes,
     * for the same reason as `onCursor` — not on every keystroke.
     */
    onDiagnostics?(counts: { errors: number; warnings: number }): void
  },
): EditorController {
  const fontTheme = new Compartment()
  const langConf = new Compartment()
  // Holds the enabled toggleable extensions; `setExtensions` reconfigures it
  // when the student flips a switch in the Extensions view.
  const extConf = new Compartment()
  const states = new Map<string, EditorState>()
  let path: string | null = null
  let applying = false
  // The live-collaboration binding, or null when solo. When set for the open
  // file, its Y.Text is the source of truth: yCollab is added to that file's
  // state (below), and the write-back listener is suppressed so a synced change
  // does not echo back out through onChange → Project.setContent (edge #2).
  let collab: CollabBinding | null = null
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

  // The diagnostics feed for the status bar's problems item. The linter writes
  // its results in with a state effect a beat after an edit, which lands as its
  // own update — so counting here, and skipping when the tally has not moved,
  // is enough to keep the bar current without a count on every keystroke.
  let reportedDiag = ''
  const reportDiagnostics = (state: EditorState) => {
    if (!opts.onDiagnostics) return
    let errors = 0
    let warnings = 0
    forEachDiagnostic(state, (d) => {
      if (d.severity === 'error') errors++
      else if (d.severity === 'warning') warnings++
    })
    const key = `${errors}:${warnings}`
    if (key === reportedDiag) return
    reportedDiag = key
    opts.onDiagnostics({ errors, warnings })
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
      // Docs on hover (mouse), long-press (touch) and Ctrl/Cmd+K Ctrl/Cmd+I —
      // in this compartment because the built-in dictionary is per-language,
      // and a rename (.txt → .py) must swap the hover vocabulary with the
      // grammar. See editor/hoverDocs.ts.
      hoverDocs(completionLang(lang)),
      // The red line and its one-tap fixes. In this compartment for the same
      // reason as the grammar it reads: a rename swaps the rule set, and the
      // reconfigure clears the old language's diagnostics with it. Only some
      // languages get one — see editor/lint.ts. No lint *gutter*: it would
      // reserve a column of width on every grammar file, and horizontal pixels
      // are the scarcest thing on a 390px phone (see the gutter notes above).
      linting(lang),
    ]
  }

  const extensions = (lang: EditorLang | null, p: string) => {
    // Is this file a live collab doc? If so, yCollab owns its history (its own
    // CRDT undo manager), so native history()/historyKeymap are dropped for it.
    const collabExt = p && collab?.isCollab(p) ? collab.extensionFor(p) : null
    // A viewer's editor is read-only (contract §7.4): block every local edit at
    // the source so nothing reaches the Y.Text (no peer, no OPFS divergence),
    // while yCollab's programmatic dispatches still stream remote edits in.
    // `editable:false` also drops the caret/contenteditable so it reads as a view.
    // NOT gated on collabExt (L7): a guest whose role is unknown/viewer must be
    // read-only on a file whose Y.Text has not synced in yet too — otherwise it
    // could type into an about-to-be-tracked file during the fail-closed window.
    const collabReadOnly = collab != null && collab.readOnly()
    return [
    // Where the completion popup and the docs card are allowed to be.
    //
    // Both are CodeMirror "tooltips": CM measures the caret with
    // getBoundingClientRect and writes the result straight back as the widget's
    // own left/top. Which coordinate space those px land in is the whole story
    // under the view scale (`#root { zoom: var(--ui-scale) }`, index.css):
    //
    //   - `position: fixed` — CM's default everywhere but iOS — writes UNZOOMED
    //     viewport px into a box that lives inside the zoomed #root, where a px
    //     length paints multiplied by --ui-scale. At 0.7 the popup landed 30% of
    //     the way back toward the viewport's top-left corner, further adrift the
    //     further down the file the caret was: the reported bug. CM cannot see
    //     it coming, because it only suspects a scale when the tooltip has an
    //     offsetParent, and `zoom` (unlike a transform) leaves that null.
    //   - `position: absolute` converts into the editor's own box AND divides by
    //     the editor's measured scale — rect ÷ offsetWidth, which reads `zoom`
    //     exactly right — so CM's px are finally in the space they land in.
    //     This is the path iOS has taken all along.
    //
    // Absolute costs the one thing fixed gave away free: the popup is now a
    // child of .cm-editor, so .editor-pane's overflow:hidden would slice
    // anything hanging past the editor (with the console open there is plenty of
    // window below the pane, so CM would happily place one there). Hence
    // tooltipSpace: the PANE, not the window, is the room a tooltip may use, so
    // CM flips it above the caret or shrinks it to fit instead. VS Code keeps
    // its suggest widget inside the editor for the same reason.
    tooltips({
      position: 'absolute',
      tooltipSpace: (view) => {
        const r = (view.dom.closest('.editor-pane') ?? view.dom).getBoundingClientRect()
        return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
      },
    }),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    // yCollab brings its own (CRDT) undo manager, so a collab file skips the
    // native local history — otherwise Mod-Z could revert a peer's edit.
    collabExt ? [] : history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    // The find widget mounts above the code (`top: true`) with the custom
    // VS Code-anatomy panel above, styled in chromeTheme (floating top-right
    // at desk, full-width docked bar on touch).
    search({ top: true, createPanel: (v) => new FindPanel(v) }),
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
      // VS Code muscle memory: Mod-h opens the same widget with the replace
      // row popped open (replace lives behind the chevron, not a separate
      // surface). The panel is created synchronously inside openSearchPanel's
      // dispatch, so the WeakMap lookup right after it is safe.
      {
        key: 'Mod-h',
        run: (v) => {
          openSearchPanel(v)
          findPanels.get(v)?.focusReplace()
          return true
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      // Native undo bindings are replaced by yCollab's (yUndoManagerKeymap,
      // added inside collabExt) when the file is collaborative.
      ...(collabExt ? [] : historyKeymap),
      ...completionKeymap,
      // Mod-Shift-m opens the problems panel, F8 / Shift-F8 step through the
      // red lines — the keyboard path; the status bar's problems item is the
      // pointer/touch one, and both call the same openLintPanel.
      ...lintKeymap,
      indentWithTab,
    ]),
    // Dark+ syntax colours (see syntaxColors above — oneDark is gone);
    // chromeTheme keeps the surfaces, gutter, caret and selection on Design's
    // tokens. With no unlayered oneDark module in the fight any more, the
    // `&.cm-editor` specificity in chromeTheme is belt-and-braces, and cheap.
    syntaxHighlighting(syntaxColors),
    // Toggleable editor extensions (Rainbow Brackets, Indent Guides, Indent
    // Rainbow — see extensions/registry.ts), swapped live via `setExtensions`.
    // After syntaxHighlighting so bracket depth marks beat the flat punctuation
    // grey (#D4D4D4) on the same spans; the registry keeps brackets last.
    extConf.of(enabledEditorExtensions()),
    chromeTheme,
    fontTheme.of(themeFor(fontSize)),
    langConf.of(languageExtensions(lang)),
    // The per-file yCollab binding (edge #1) — bound to this file's Y.Text plus
    // awareness (remote cursors) and the CRDT undo keymap. Empty when solo.
    collabExt ?? [],
    // Viewer read-only: EditorState.readOnly rejects user-event edits, editable
    // false removes the contenteditable/caret. yCollab's remote dispatches are
    // programmatic, so incoming edits still render.
    collabReadOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
    // M1: swallow y-codemirror.next's benign remote-selection bounds RangeError so
    // it stops spamming the console under concurrent multi-peer editing. Everything
    // else still logs. See `editorExceptionSink`.
    EditorView.exceptionSink.of(editorExceptionSink),
    EditorView.updateListener.of((u) => {
      // Suppress write-back for a collab file: its Project (and OPFS) copy is
      // fed from the Y.Text via the materializer, so a synced doc change here
      // must not loop back out through onChange → Project.setContent (edge #2).
      if (u.docChanged && path && !applying && !(collab?.isCollab(path)))
        opts.onChange(path, u.state.doc.toString())
      if (u.docChanged || u.selectionSet) reportCursor(u.state)
      // The linter's results and a language reconfigure both arrive as effect
      // transactions, not doc changes — so key off effects to catch the moment
      // the red lines land (or clear on a language swap).
      if (u.docChanged || u.transactions.some((tr) => tr.effects.length > 0)) {
        reportDiagnostics(u.state)
      }
    }),
    ]
  }

  const stateFor = (p: string, content: string) =>
    EditorState.create({ doc: content, extensions: extensions(editorLangForPath(p), p) })

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
      // For a collab file the Y.Text is authoritative and yCollab keeps the doc
      // in step, so never force-replace from `content` (a possibly-stale
      // Project read mid-materialize) — that would fight the CRDT merge (edge #2).
      const isCollab = collab?.isCollab(p) ?? false
      if (path === p) {
        if (!isCollab && view.state.doc.toString() !== content) {
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
      // not changed underneath us. A collab file never reuses a stale-content
      // cache — it rebuilds so yCollab initialises from the live Y.Text.
      const next = saved && (isCollab || saved.doc.toString() === content) ? saved : stateFor(p, content)
      applying = true
      view.setState(next)
      applying = false
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(fontSize)) })
      syncLanguage(p)
      // `setState` swaps the whole state rather than dispatching a selection, so
      // the update listener does not see the new file's caret. Switching tabs has
      // to move the status bar's Ln:Col, so say it here — and the problems count
      // too, since a cached state carries the file's own diagnostics with it.
      reportCursor(view.state)
      reportDiagnostics(view.state)
    },
    closeFile(p) {
      states.delete(p)
      if (path === p) {
        path = null
        applying = true
        view.setState(stateFor('', ''))
        applying = false
        // The empty state has no linter — clear the problems count with the file.
        reportDiagnostics(view.state)
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
    setExtensions() {
      // Re-reads the registry (which reads prefs), so the caller just persists
      // the toggle then calls this — no need to pass the new set through.
      view.dispatch({ effects: extConf.reconfigure(enabledEditorExtensions()) })
    },
    setCollab(binding) {
      collab = binding
      // Per-file states cache states built for the *old* collab mode — drop it
      // so every file rebuilds with (or without) its yCollab binding (edge #1).
      states.clear()
      if (!path) return
      // Rebuild the on-screen file's state in the new mode. Keep the current doc
      // text — for a collab file it already equals the Y.Text (the materializer
      // made Project match before this fires), so yCollab initialises cleanly.
      const p = path
      const content = view.state.doc.toString()
      // H1: when this file becomes collab-bound but the local editor holds text
      // the Y.Text does NOT yet have — a reused-room restart where the host typed
      // into the still-unbound editor between Start and the async rebind — splice
      // those local edits INTO the Y.Text first. yCollab's sync plugin only
      // observes its Y.Text; it never reconciles a mismatched initial CM doc, so
      // without this the pre-bind edits would sit in CM/OPFS forever and never
      // reach the shared doc, the blob store, or peers ("Live" but silently dead).
      // replaceDoc is a minimal diff (a no-op on the normal path, where the
      // materializer already made content == Y.Text) and is swallowed for a
      // read-only viewer — so this only ever captures a writable participant's own
      // un-synced local edits, never clobbers with a viewer's or an empty buffer.
      if (binding?.isCollab(p)) binding.replaceDoc(p, content)
      applying = true
      view.setState(stateFor(p, content))
      applying = false
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(fontSize)) })
      syncLanguage(p)
      reportCursor(view.state)
      reportDiagnostics(view.state)
    },
    applyEdit(content) {
      if (!path) return
      // On a collab file, Format/Generate must land as a *minimal* Y.Text splice
      // (edge #2), not a whole-doc CM replace that yCollab would turn into a
      // delete-all + reinsert and clobber a peer's concurrent edit. yCollab then
      // reflects the Y.Text change back into this view.
      if (collab?.replaceDoc(path, content)) return
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
    toggleProblems() {
      // No exported "is it open" — the docked panel's own class is the tell.
      if (view.dom.querySelector('.cm-panel-lint')) closeLintPanel(view)
      else {
        openLintPanel(view)
        view.focus()
      }
    },
    focus: () => view.focus(),
    currentPath: () => path,
    destroy: () => view.destroy(),
  }
}
