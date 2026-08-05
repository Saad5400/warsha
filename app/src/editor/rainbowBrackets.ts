import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

/**
 * Rainbow brackets — VS Code's bracket-pair colourization. Each nesting level
 * of `( ) [ ] { }` cycles through three hues so a student can see at a glance
 * which close belongs to which open, which is exactly the question a beginner
 * with a "missing }" error is trying to answer.
 *
 * The depth walk rides on the syntax tree, not the raw text, so brackets
 * inside strings and comments stay uncoloured: Lezer emits each real bracket
 * as its own one-character token node named after its literal. The walk starts
 * at the top of the document rather than the viewport — depth is meaningless
 * without the brackets above the fold, and at student file sizes the full pass
 * is cheap — but only visible brackets get decorations.
 *
 * C# is the exception: its clike StreamLanguage mode produces no bracket
 * tokens, so when the tree yields nothing the plugin falls back to counting
 * raw bracket characters. That fallback cannot see strings, which is the
 * accepted cost of a legacy mode.
 */

const OPEN = new Set(['(', '[', '{'])
const CLOSE = new Set([')', ']', '}'])

/** One mark per hue; depth cycles through them mod 3. Colours in `theme` below. */
const MARKS = [0, 1, 2].map((i) => Decoration.mark({ class: `cm-bracket-${i}` }))

function build(view: EditorView): DecorationSet {
  const ranges = view.visibleRanges
  if (ranges.length === 0) return Decoration.none
  const to = ranges[ranges.length - 1].to
  const inView = (pos: number) => ranges.some((r) => pos >= r.from && pos < r.to)

  const builder = new RangeSetBuilder<Decoration>()
  let found = false
  let depth = 0
  syntaxTree(view.state).iterate({
    from: 0,
    to,
    enter: (node) => {
      if (node.to - node.from !== 1) return
      const name = node.name
      if (OPEN.has(name)) {
        found = true
        if (inView(node.from)) builder.add(node.from, node.to, MARKS[depth % 3])
        depth += 1
      } else if (CLOSE.has(name)) {
        found = true
        depth = Math.max(depth - 1, 0)
        if (inView(node.from)) builder.add(node.from, node.to, MARKS[depth % 3])
      }
    },
  })
  return found ? builder.finish() : buildRaw(view)
}

/** Text-level fallback for grammars with no bracket tokens (C#'s stream mode). */
function buildRaw(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  let depth = 0
  let pos = 0
  for (const range of view.visibleRanges) {
    // Carry depth through the text above/between visible ranges so colours
    // stay stable while scrolling, without decorating what is off screen.
    for (const ch of doc.sliceString(pos, range.from)) {
      if (OPEN.has(ch)) depth += 1
      else if (CLOSE.has(ch)) depth = Math.max(depth - 1, 0)
    }
    const text = doc.sliceString(range.from, range.to)
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (OPEN.has(ch)) {
        builder.add(range.from + i, range.from + i + 1, MARKS[depth % 3])
        depth += 1
      } else if (CLOSE.has(ch)) {
        depth = Math.max(depth - 1, 0)
        builder.add(range.from + i, range.from + i + 1, MARKS[depth % 3])
      }
    }
    pos = range.to
  }
  return builder.finish()
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate) {
      // The tree-identity check catches what the flags cannot: a grammar
      // arriving late (langConf reconfigure) and the parser finishing more of
      // the document in the background both swap the tree without a doc or
      // viewport change.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (value) => value.decorations },
)

/**
 * `&.cm-editor` for specificity: the syntax-highlight class that puts the flat
 * punctuation grey on the same span is a single generated class, and these
 * marks must win over it (see the registration order note in setup.ts too).
 */
const theme = EditorView.theme({
  '&.cm-editor .cm-bracket-0': { color: 'var(--code-bracket-1)' },
  '&.cm-editor .cm-bracket-1': { color: 'var(--code-bracket-2)' },
  '&.cm-editor .cm-bracket-2': { color: 'var(--code-bracket-3)' },
})

export function rainbowBrackets() {
  return [plugin, theme]
}
