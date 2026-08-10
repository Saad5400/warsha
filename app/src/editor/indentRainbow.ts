import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Indent Rainbow — a faint tint behind each indentation level, cycling three
 * hues. Where indentGuides.ts draws one hairline per level, this fills the
 * whole column band, which reads the nesting depth at a glance in code that
 * runs deep (a Java switch inside a loop inside a method). Off by default; it
 * and the guides can run together, the tint sitting under the lines.
 *
 * Same background-as-decoration approach as the guides: a repeating gradient
 * clipped to `depth × unit` columns paints exactly `depth` bands and nothing
 * per-line in the DOM. Hues reuse the rainbow-bracket tokens at low alpha, so
 * the two rainbow features share one palette.
 */

/** Matches indentGuides' cap — past ~12 columns a phone has no width for text. */
const MAX_HANG = 12

/** CodeMirror's own `.cm-line` padding the bands have to start after. */
const LINE_PAD = '6px'

const cache = new Map<string, Decoration>()

function decoFor(depth: number, hang: number): Decoration {
  const key = `${depth}:${hang}`
  let deco = cache.get(key)
  if (!deco) {
    let style = `--cm-rainbow:${depth}`
    // Same hanging-indent trick as the guides, so bands line up under wrapped
    // code instead of column 0 when both features are on.
    if (hang > 0) style += `;padding-left:calc(${LINE_PAD} + ${hang}ch);text-indent:-${hang}ch`
    deco = Decoration.line({ attributes: { class: 'cm-indentRainbow', style } })
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
    // A blank line inside a block inherits the level above it, or the bands
    // break into gaps down a function body.
    let carried = 0
    let pos = range.from
    while (pos <= range.to) {
      const line = doc.lineAt(pos)
      const blank = line.text.trim().length === 0
      const cols = blank ? 0 : leadingColumns(line.text, tabSize)
      const depth = blank ? carried : Math.floor(cols / unit)
      if (!blank) carried = depth
      if (depth > 0) builder.add(line.from, line.from, decoFor(depth, Math.min(cols, MAX_HANG)))
      if (line.to + 1 <= pos) break
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export function indentRainbow(unit = 4) {
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

  // One period of the gradient is three bands wide; background-size clips it to
  // `depth` bands. Hues are the bracket-rainbow tokens softened to a wash.
  const band = (token: string) => `color-mix(in srgb, var(${token}) 11%, transparent)`
  const theme = EditorView.theme({
    '.cm-indentRainbow': {
      backgroundImage:
        `repeating-linear-gradient(to right,` +
        ` ${band('--code-bracket-1')} 0 ${unit}ch,` +
        ` ${band('--code-bracket-2')} ${unit}ch ${2 * unit}ch,` +
        ` ${band('--code-bracket-3')} ${2 * unit}ch ${3 * unit}ch)`,
      backgroundRepeat: 'no-repeat',
      // Padding-box so the hanging indent moves content but not the bands.
      backgroundOrigin: 'padding-box',
      backgroundPositionX: LINE_PAD,
      backgroundSize: `calc(var(--cm-rainbow, 0) * ${unit}ch) 100%`,
    },
  })

  return [plugin, theme]
}
