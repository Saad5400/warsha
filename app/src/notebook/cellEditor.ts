/**
 * One notebook cell's CodeMirror editor.
 *
 * Built from the SAME pieces as the file editor (editor/setup.ts exports its
 * syntax colours, chrome theme, font metrics and grammar loader; the
 * completion sources, hover docs, linter and debugger gutter are the shared
 * modules) — a cell is not a second editor product, it is the editor sized to
 * its code. What a cell adds:
 *   - `textContext`: the code cells above it, so completion and hover resolve
 *     `df` from cell 1 inside cell 3 (editor/textContext.ts);
 *   - `foreignLines`: its IPython lines, which the linter leaves alone;
 *   - its debug path, `nb.ipynb#cell=<id>`, for breakpoints and the stop arrow;
 *   - the notebook's keys: Shift+Enter / Ctrl+Enter / Alt+Enter run, Escape
 *     leaves to command mode, ArrowUp/Down at the edges move between cells.
 * What it drops: the search panel (one per cell would be noise), the active
 * line band (in a column of editors only the focused one should glow), the
 * 40vh scroll padding and the full-height fill.
 */
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  tooltips,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, acceptCompletion, completionStatus } from '@codemirror/autocomplete'
import { highlightSelectionMatches } from '@codemirror/search'
import { lintKeymap } from '@codemirror/lint'
import {
  DESK_MEDIA,
  chromeTheme,
  codeFontTheme,
  editorExceptionSink,
  loadLanguage,
  syntaxColors,
} from '../editor/setup'
import { completionSources } from '../editor/completions'
import { hoverDocs } from '../editor/hoverDocs'
import { linting, foreignLines } from '../editor/lint'
import { textContext } from '../editor/textContext'
import { debugExtension, debugTheme, lineNumberToggle, toggleBreakpointAtCursor } from '../editor/debugExt'
import { enabledEditorExtensions } from '../extensions/registry'
import { magicLinesOf } from './magics'
import type { CellType } from './nbformat'

export type RunMode = 'run' | 'advance' | 'insert'

export interface CellEditorOptions {
  doc: string
  type: CellType
  /** The cell's debug path (`nb.ipynb#cell=<id>`); code cells only. */
  path: string
  fontSize: number
  /** Code of the cells above (code cells), read lazily on every completion. */
  context(): string
  projectWords(): readonly string[]
  onChange(text: string): void
  onRun(mode: RunMode): void
  /** Escape: hand the keyboard to the notebook's command mode. */
  onEscape(): void
  /** Caret pressed past the first/last line: move to the neighbouring cell. */
  onLeave(direction: -1 | 1): void
  onFocus(): void
  onSave(): void
}

export interface CellEditor {
  view: EditorView
  /** Replace the text (an outside change: undo, a remote edit, a format) without echoing onChange. */
  setDoc(text: string): void
  setFontSize(px: number): void
  focus(where?: 'start' | 'end'): void
  destroy(): void
}

const deskMq = typeof window !== 'undefined' ? window.matchMedia(DESK_MEDIA) : null

/** A cell editor is as tall as its code; its chrome sits flush in the cell box. */
const cellTheme = EditorView.theme({
  '&.cm-editor': { backgroundColor: 'transparent' },
  '&.cm-editor.cm-focused': { outline: 'none' },
  '&.cm-editor .cm-scroller': { overflowX: 'auto' },
  '&.cm-editor .cm-content': { paddingTop: '6px', paddingBottom: '6px' },
  '&.cm-editor .cm-gutters': { backgroundColor: 'transparent' },
  '&.cm-editor .cm-lineNumbers .cm-gutterElement': { minWidth: '2ch', paddingInline: '4px 6px' },
})

export function createCellEditor(parent: HTMLElement, opts: CellEditorOptions): CellEditor {
  const fontConf = new Compartment()
  const langConf = new Compartment()
  const deskConf = new Compartment()
  const code = opts.type === 'code'
  let applying = false
  let fontSize = opts.fontSize

  const deskExt = (): Extension =>
    // Cells wrap on touch (a horizontally scrolling line is unreadable on a phone),
    // and markdown/raw text always wraps — it is prose.
    [deskMq?.matches ? EditorView.editorAttributes.of({ class: 'cm-desk' }) : [], !deskMq?.matches || !code ? EditorView.lineWrapping : []]

  // Stable identity: textContext caches its virtual state per function.
  const context = () => opts.context()

  const atEdge = (view: EditorView, dir: -1 | 1) => {
    if (completionStatus(view.state) !== null) return false
    const sel = view.state.selection.main
    if (!sel.empty) return false
    const line = view.state.doc.lineAt(sel.head)
    if (dir < 0 ? line.number !== 1 : line.number !== view.state.doc.lines) return false
    opts.onLeave(dir)
    return true
  }

  const notebookKeys = Prec.highest(
    keymap.of([
      { key: 'Shift-Enter', run: () => (opts.onRun('advance'), true) },
      { key: 'Mod-Enter', run: () => (opts.onRun('run'), true) },
      { key: 'Alt-Enter', run: () => (opts.onRun('insert'), true) },
      {
        key: 'Escape',
        run: (v) => {
          // Escape closes the completion popup first, as everywhere in the editor.
          if (completionStatus(v.state) !== null) return false
          opts.onEscape()
          return true
        },
      },
      { key: 'ArrowUp', run: (v) => atEdge(v, -1) },
      { key: 'ArrowDown', run: (v) => atEdge(v, 1) },
      { key: 'Mod-s', preventDefault: true, run: () => (opts.onSave(), true) },
      { key: 'F9', preventDefault: true, run: (v) => (code ? toggleBreakpointAtCursor(v, opts.path) : false) },
    ]),
  )

  const languageExt = (): Extension => {
    if (!code) return []
    return [
      autocompletion({
        override: completionSources('python', opts.projectWords),
        activateOnTyping: true,
        selectOnOpen: true,
        maxRenderedOptions: 30,
        icons: true,
      }),
      hoverDocs('python'),
      linting('python'),
    ]
  }

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      notebookKeys,
      // The popup and the docs card may use the notebook's whole scroll area, not just
      // this cell's few lines (see setup.ts for why tooltips are absolutely positioned).
      tooltips({
        position: 'absolute',
        tooltipSpace: (view) => {
          const r = (view.dom.closest('.notebook-scroller') ?? view.dom).getBoundingClientRect()
          return { top: r.top, left: r.left, bottom: r.bottom, right: r.right }
        },
      }),
      code ? [debugExtension(opts.path), debugTheme, lineNumbers({ domEventHandlers: lineNumberToggle(opts.path) })] : [],
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      indentUnit.of('    '),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      deskConf.of(deskExt()),
      EditorView.contentAttributes.of({
        autocapitalize: 'none',
        autocorrect: 'off',
        spellcheck: 'false',
        'data-gramm': 'false',
        'aria-label': code ? 'Code cell' : 'Markdown cell',
      }),
      keymap.of([
        { key: 'Tab', run: acceptCompletion },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      syntaxHighlighting(syntaxColors),
      enabledEditorExtensions(),
      chromeTheme,
      cellTheme,
      fontConf.of(codeFontTheme(fontSize)),
      langConf.of([]),
      textContext.of(context),
      foreignLines.of((s) => new Set(magicLinesOf(s.doc.toString()))),
      EditorView.exceptionSink.of(editorExceptionSink),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applying) opts.onChange(u.state.doc.toString())
        if (u.focusChanged && u.view.hasFocus) opts.onFocus()
      }),
    ],
  })

  const view = new EditorView({ parent, state })
  if (code) {
    void loadLanguage('python').then((support) => {
      if (!view.dom.isConnected && !parent.isConnected) return
      view.dispatch({ effects: langConf.reconfigure([support, languageExt()]) })
    })
  }
  const onDesk = () => view.dispatch({ effects: deskConf.reconfigure(deskExt()) })
  deskMq?.addEventListener('change', onDesk)

  return {
    view,
    setDoc(text) {
      if (view.state.doc.toString() === text) return
      applying = true
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
      applying = false
    },
    setFontSize(px) {
      if (px === fontSize) return
      fontSize = px
      view.dispatch({ effects: fontConf.reconfigure(codeFontTheme(px)) })
    },
    focus(where) {
      view.focus()
      if (where) view.dispatch({ selection: { anchor: where === 'start' ? 0 : view.state.doc.length } })
    },
    destroy() {
      deskMq?.removeEventListener('change', onDesk)
      view.destroy()
    },
  }
}
