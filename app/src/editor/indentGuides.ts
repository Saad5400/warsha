import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Indent guides — one hairline per nesting level, in `--code-indent-guide`.
 *
 * CodeMirror ships no such extension, and on a phone this is not decoration:
 * Python's whole control flow *is* the indentation, and with `EditorView.
 * lineWrapping` on (which we need, §3.1) a wrapped line makes the eye lose the
 * column it was following. The guides are what put it back.
 *
 * Drawn as a background rather than as widgets, so there is nothing extra in the
 * DOM per line and nothing to keep in sync with the caret: a repeating gradient
 * clipped to `depth × step` paints exactly `depth` rules and no more.
 */

/**
 * Deepest hanging indent we will pay for. On a 390px phone a line indented past
 * ~12 columns has almost no width left for the text itself, so beyond this the
 * wrap goes back to the left edge rather than squeezing the code into a gutter.
 */
const MAX_HANG = 12

/** CodeMirror's own `.cm-line` padding, which the guides have to start after. */
const LINE_PAD = '6px'

const cache = new Map<string, Decoration>()

function decoFor(depth: number, hang: number): Decoration {
  const key = `${depth}:${hang}`
  let deco = cache.get(key)
  if (!deco) {
    // Negative text-indent against a matching padding-left is the hanging-indent
    // trick: the first visual row starts where it always did, and every wrapped
    // row after it lines up with the code's own indentation instead of jumping
    // back to column 0. On a phone, where nearly every Java line wraps, this is
    // the difference between reading a continuation and mistaking it for a new
    // statement.
    const style =
      `--cm-guides:${depth}` +
      (hang > 0 ? `;padding-left:calc(${LINE_PAD} + ${hang}ch);text-indent:-${hang}ch` : '')
    deco = Decoration.line({ attributes: { class: 'cm-indentGuides', style } })
    cache.set(key, deco)
  }
  return deco
}

/** Leading whitespace in columns, counting a tab to the next tab stop. */
function leadingColumns(text: string, tabSize: number): number {
  let n = 0
  for (const ch of text) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += tabSize - (n % tabSize)
    else break
  }
  return n
}

function build(view: EditorView, unit: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, tabSize } = view.state
  for (const range of view.visibleRanges) {
    // A blank line inside a block has no indentation of its own; it inherits the
    // level above it, or the guides break into dashes down a function body.
    let carried = 0
    let pos = range.from
    while (pos <= range.to) {
      const line = doc.lineAt(pos)
      const blank = line.text.trim().length === 0
      const cols = blank ? 0 : leadingColumns(line.text, tabSize)
      const depth = blank ? carried : Math.floor(cols / unit)
      if (!blank) carried = depth
      // A blank line needs the guide but has nothing to wrap, so no hang.
      if (depth > 0) builder.add(line.from, line.from, decoFor(depth, Math.min(cols, MAX_HANG)))
      if (line.to + 1 <= pos) break
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export function indentGuides(unit = 4) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view, unit)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view, unit)
      }
    },
    { decorations: (value) => value.decorations },
  )

  const theme = EditorView.theme({
    '.cm-indentGuides': {
      backgroundImage: `repeating-linear-gradient(to right, var(--code-indent-guide) 0 1px, transparent 1px ${unit}ch)`,
      backgroundRepeat: 'no-repeat',
      // Positioned off the padding box and nudged past `.cm-line`'s own 6px, not
      // off the content box: the hanging indent above moves the content edge, and
      // guides must stay put. Clipping is left alone deliberately — clipping to
      // the content box would also crop the active-line fill this same element
      // carries, leaving indented lines highlighted narrower than the rest.
      backgroundOrigin: 'padding-box',
      backgroundPositionX: LINE_PAD,
      backgroundSize: `calc(var(--cm-guides, 0) * ${unit}ch) 100%`,
    },
  })

  return [plugin, theme]
}
