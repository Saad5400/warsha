import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Indent guides — one hairline per nesting level, in `--code-indent-guide`.
 *
 * CodeMirror ships no such extension, and on a phone this is not decoration:
 * Python's whole control flow *is* the indentation, and with `EditorView.
 * lineWrapping` on (which touch needs, §3.1; desk scrolls instead) a wrapped
 * line makes the eye lose the column it was following. The guides put it back.
 *
 * Drawn as a background rather than as widgets, so there is nothing extra in the
 * DOM per line and nothing to keep in sync with the caret: a repeating gradient
 * clipped to `depth × step` paints exactly `depth` rules and no more.
 */

/** Deepest hanging indent we pay for — past ~12 columns a 390px phone has no
 *  width left for text, so the wrap resets to the left edge instead of
 *  squeezing into a gutter. */
const MAX_HANG = 12

/** CodeMirror's own `.cm-line` padding, which the guides have to start after. */
const LINE_PAD = '6px'

const cache = new Map<string, Decoration>()

function decoFor(depth: number, hang: number, active: number, unit: number): Decoration {
  const key = `${unit}:${depth}:${hang}:${active}`
  let deco = cache.get(key)
  if (!deco) {
    // Negative text-indent + matching padding-left is the hanging-indent trick:
    // the first row stays put, and wrapped rows line up with the code's own
    // indent instead of column 0 — the difference between reading a
    // continuation and mistaking it for a new statement.
    let style = `--cm-guides:${depth}`
    if (hang > 0) style += `;padding-left:calc(${LINE_PAD} + ${hang}ch);text-indent:-${hang}ch`
    // The caret's level re-paints via a second background layer
    // (--code-indent-guide-active, see theme below); this just gives its
    // 0-width default a width and a position.
    if (active > 0)
      style +=
        `;--cm-guide-active-x:calc(${LINE_PAD} + ${(active - 1) * unit}ch)` +
        ';--cm-guide-active-w:1px'
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

/** The nesting level the caret sits in — its guide is the "active" one
 *  (VS Code's highlightActiveIndentation). A blank caret line inherits the
 *  nearest non-blank line above, matching the guides' own carried depth. */
function caretDepth(view: EditorView, unit: number): number {
  const { doc, tabSize, selection } = view.state
  let line = doc.lineAt(selection.main.head)
  let n = line.number
  while (n > 1 && line.text.trim().length === 0) line = doc.line(--n)
  return Math.floor(leadingColumns(line.text, tabSize) / unit)
}

function build(view: EditorView, unit: number): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc, tabSize } = view.state
  const activeDepth = caretDepth(view, unit)
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
      // Only lines deep enough to *have* the active level's guide light it up.
      if (depth > 0)
        builder.add(
          line.from,
          line.from,
          decoFor(depth, Math.min(cols, MAX_HANG), depth >= activeDepth ? activeDepth : 0, unit),
        )
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
        // selectionSet too: the active level follows the caret.
        if (update.docChanged || update.viewportChanged || update.selectionSet)
          this.decorations = build(update.view, unit)
      }
    },
    { decorations: (value) => value.decorations },
  )

  const theme = EditorView.theme({
    '.cm-indentGuides': {
      // Two layers: the active-level rule (1px gradient, width 0 until decoFor
      // turns it on) then the repeating base hairlines — brightest first, so
      // active sits over its base twin.
      backgroundImage:
        'linear-gradient(var(--code-indent-guide-active), var(--code-indent-guide-active)), ' +
        `repeating-linear-gradient(to right, var(--code-indent-guide) 0 1px, transparent 1px ${unit}ch)`,
      backgroundRepeat: 'no-repeat',
      // Padding-box, not content-box: the hanging indent moves the content edge
      // but guides must stay put. Clipping is left alone — clipping to
      // content-box would also crop this element's active-line fill, narrowing
      // indented lines' highlight.
      backgroundOrigin: 'padding-box',
      backgroundPositionX: `var(--cm-guide-active-x, 0px), ${LINE_PAD}`,
      backgroundSize:
        `var(--cm-guide-active-w, 0px) 100%, calc(var(--cm-guides, 0) * ${unit}ch) 100%`,
    },
  })

  return [plugin, theme]
}
