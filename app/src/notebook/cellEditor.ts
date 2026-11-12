/**
 * One notebook cell's CodeMirror editor.
 *
 * Built from the SAME stacks as the file editor — setup.ts's `editingStack`
 * (input, keymap, colours, toggleable extensions, chrome) and `languageStack`
 * (grammar, completion, hover docs, lint) — so a cell is not a second editor
 * product that can drift from the first; it is the editor sized to its code. What a cell adds:
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
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { indentUnit } from '@codemirror/language'
import { completionStatus } from '@codemirror/autocomplete'
import { DESK_MEDIA, codeFontTheme, editingStack, languageStack, loadLanguage, tooltipsWithin } from '../editor/setup'
import { foreignLines } from '../editor/lint'
import { textContext } from '../editor/textContext'
import { debugExtension, debugTheme, lineNumberToggle, toggleBreakpointAtCursor } from '../editor/debugExt'
import { magicLinesOf } from './magics'
import type { CellType } from './nbformat'

export type RunMode = 'run' | 'advance' | 'insert'

export interface CellEditorOptions {
  doc: string
  type: CellType
  /** The cell's debug path (`nb.ipynb#cell=<id>`); code cells only. */
  path: string
  fontSize: number
  /** A live-collab viewer: the cell can be read and selected, never edited. */
  readOnly?: boolean
  /** Line numbers (off by default in a notebook, as in Colab). */
  lineNumbers?: boolean
  /** The empty cell's hint. CodeMirror's own placeholder, drawn AT the caret position. */
  placeholder?: string
  /** Where the code's text starts, px from the editor's left edge; reported on mount and on every geometry change. */
  onTextEdge?(px: number): void
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
  /** Shift+Alt+F — the file editor's Format chord, for this cell. */
  onFormat(): void
}

export interface CellEditor {
  view: EditorView
  /** Replace the text (an outside change: undo, a remote edit, a format) without echoing onChange. */
  setDoc(text: string): void
  setFontSize(px: number): void
  setReadOnly(readOnly: boolean): void
  setLineNumbers(on: boolean): void
  focus(where?: 'start' | 'end'): void
  destroy(): void
}

const deskMq = typeof window !== 'undefined' ? window.matchMedia(DESK_MEDIA) : null

/** A cell editor is as tall as its code; its chrome sits flush in the cell box. */
const cellTheme = EditorView.theme({
  '&.cm-editor': { backgroundColor: 'transparent' },
  '&.cm-editor.cm-focused': { outline: 'none' },
  '&.cm-editor .cm-scroller': { overflowX: 'auto' },
  // 6px above and below the code: the run button is centred on the first line from this (CellView).
  '&.cm-editor .cm-content': { paddingTop: '6px', paddingBottom: '6px' },
  // The file editor's desk inset (12px) is room beside a page-tall gutter; in a cell box it
  // is just distance between the run button and the code. 4px, as on touch.
  '&.cm-editor.cm-desk .cm-content, &.cm-editor .cm-content': { paddingLeft: '4px' },
  '&.cm-editor .cm-gutters': { backgroundColor: 'transparent' },
  // When shown, numbers are muted and stand clear of the code.
  '&.cm-editor .cm-lineNumbers .cm-gutterElement': { minWidth: '2ch', paddingInline: '6px 12px', color: 'var(--text-3)' },
  '&.cm-editor .cm-placeholder': { color: 'var(--text-3)', fontStyle: 'normal' },
})

export function createCellEditor(parent: HTMLElement, opts: CellEditorOptions): CellEditor {
  const fontConf = new Compartment()
  const langConf = new Compartment()
  const deskConf = new Compartment()
  const roConf = new Compartment()
  const lnConf = new Compartment()
  const lnExt = (on: boolean): Extension => (on && code ? lineNumbers({ domEventHandlers: lineNumberToggle(opts.path) }) : [])
  const roExt = (ro: boolean): Extension => (ro ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [])
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
      { key: 'Shift-Alt-f', preventDefault: true, run: () => (code ? (opts.onFormat(), true) : false) },
      { key: 'F9', preventDefault: true, run: (v) => (code ? toggleBreakpointAtCursor(v, opts.path) : false) },
    ]),
  )

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      notebookKeys,
      // The popup and the docs card may use the notebook's whole scroll area, not just this cell's lines.
      tooltipsWithin('.notebook-scroller'),
      code ? [debugExtension(opts.path), debugTheme] : [],
      lnConf.of(lnExt(!!opts.lineNumbers)),
      opts.placeholder ? placeholder(opts.placeholder) : [],
      // The same editing core as the file editor (setup.ts); the notebook's own keys are above.
      editingStack({ history: true, keys: [] }),
      indentUnit.of('    '),
      deskConf.of(deskExt()),
      roConf.of(roExt(!!opts.readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': code ? 'Code cell' : 'Markdown cell' }),
      // Above the shared chrome theme, whose editor background would paint over the code box.
      Prec.high(cellTheme),
      fontConf.of(codeFontTheme(fontSize)),
      langConf.of([]),
      textContext.of(context),
      foreignLines.of((s) => new Set(magicLinesOf(s.doc.toString()))),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applying) opts.onChange(u.state.doc.toString())
        if (u.focusChanged && u.view.hasFocus) opts.onFocus()
        if (u.geometryChanged) reportEdge()
      }),
    ],
  })

  // Outputs line up with the code's text: tell the cell where that is (gutters move it).
  let edge = -1
  const reportEdge = () =>
    view.requestMeasure({
      read: () => {
        const at = view.coordsAtPos(0)
        return at ? Math.round(at.left - view.dom.getBoundingClientRect().left) : -1
      },
      write: (x) => {
        if (x >= 0 && x !== edge) opts.onTextEdge?.((edge = x))
      },
    })
  const view = new EditorView({ parent, state })
  reportEdge()
  if (code) {
    void loadLanguage('python').then((support) => {
      if (!view.dom.isConnected && !parent.isConnected) return
      view.dispatch({ effects: langConf.reconfigure(languageStack('python', support, opts.projectWords)) })
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
    setLineNumbers(on) {
      view.dispatch({ effects: lnConf.reconfigure(lnExt(on)) })
    },
    setReadOnly(ro) {
      view.dispatch({ effects: roConf.reconfigure(roExt(ro)) })
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
