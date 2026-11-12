/**
 * The text the editor's code-reading features see AROUND a document — the
 * seam that lets a notebook cell resolve names defined in the cells above it.
 *
 * Every completion source, the receiver resolver, the type index and the hover
 * docs read the document's TEXT (declarations, assignments, imports). A cell
 * editor holds one cell, so on its own `df.` in cell 3 knows nothing of
 * `df = pd.read_csv(...)` in cell 1. Rather than teach each of those modules
 * about notebooks, an editor may carry a `textContext` — a function returning
 * the text that logically precedes its document — and `contextual()` hands
 * those features a VIRTUAL state, `prefix + doc`, with the caret shifted by the
 * prefix length. They run unchanged against it; their results' positions are
 * shifted back by the caller. An editor without the facet (every ordinary file)
 * gets its own state back, untouched and at no cost.
 *
 * The virtual state is parsed with the real document's language, so features
 * that consult the syntax tree (no completions inside a string, no docs inside
 * a comment) keep working. It is cached per context and moved forward with a
 * minimal change, so the parse is incremental across keystrokes.
 */
import { EditorState, Facet } from '@codemirror/state'
import { ensureSyntaxTree, language } from '@codemirror/language'

/** The text that precedes this editor's document (for a cell: the code cells above it). */
export const textContext = Facet.define<() => string, (() => string) | null>({
  combine: (values) => values[0] ?? null,
})

export interface Contextual {
  state: EditorState
  pos: number
  /** Add to a position in the real document to get the virtual one; subtract to map back. */
  offset: number
}

const cache = new WeakMap<() => string, EditorState>()

/** Joiner between the context and the document: a blank line, so the document starts a fresh statement. */
const SEP = '\n\n'

export function contextual(state: EditorState, pos: number): Contextual {
  const get = state.facet(textContext)
  if (!get) return { state, pos, offset: 0 }
  const prefix = get()
  if (!prefix) return { state, pos, offset: 0 }
  const head = prefix + SEP
  const text = head + state.doc.toString()
  const lang = state.facet(language)
  let virtual = cache.get(get)
  if (!virtual || virtual.facet(language) !== lang) {
    virtual = EditorState.create({ doc: text, extensions: lang ? [lang.extension] : [] })
  } else {
    const old = virtual.doc.toString()
    if (old !== text) {
      // Minimal replace: common prefix and suffix kept, so the parser reuses its tree.
      let a = 0
      const max = Math.min(old.length, text.length)
      while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++
      let b = 0
      while (b < max - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++
      virtual = virtual.update({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) } }).state
    }
  }
  const offset = head.length
  virtual = virtual.update({ selection: { anchor: pos + offset } }).state
  // Features read the tree synchronously; parse enough of it now (bounded).
  ensureSyntaxTree(virtual, virtual.doc.length, 200)
  cache.set(get, virtual)
  return { state: virtual, pos: pos + offset, offset }
}
