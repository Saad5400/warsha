import { EditorState, Facet, RangeSetBuilder, type Extension } from '@codemirror/state'
import { indentUnit, getIndentUnit } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/**
 * Per-file indentation, VS Code-style: what the file *stores* is detected from
 * its own lines (detectIndentation), and how wide one level is *drawn* is a
 * separate, per-device display preference.
 *
 * Why two things: projects sync across devices and via live collab, so a phone
 * must never rewrite a file's indentation just to make it fit. Instead a
 * 4-space file on a 390px screen is drawn with every level 2 columns wide —
 * the text keeps its real spaces (Tab/Enter insert the file's own unit, so new
 * lines always match old ones), only their rendered width shrinks, uniformly.
 */

/** User preference: `auto` = 2 columns per level off-desk, the file's own unit at desk. */
export type IndentDisplayPref = 'auto' | 2 | 4 | 8

export const INDENT_DISPLAY_CHOICES: readonly IndentDisplayPref[] = ['auto', 2, 4, 8]

/** What a file stores: tabs, or spaces in units of `unit`. */
export interface FileIndent {
  tabs: boolean
  unit: number
}

/** Storage default when a file has nothing indented yet — the same on every device. */
export const DEFAULT_INDENT: FileIndent = { tabs: false, unit: 4 }

/**
 * detectIndentation. Tabs win when more lines lead with a tab than with spaces.
 * For spaces, the unit is the most common *increase* in leading spaces between
 * consecutive non-blank lines — an increase is almost always exactly one level,
 * where a decrease can close several at once. Javadoc/block-comment
 * continuation lines (` * …`) are skipped: their one-space offset is not a level.
 */
export function detectIndent(text: string): FileIndent {
  let tabLines = 0
  let spaceLines = 0
  const deltas = new Map<number, number>()
  let prev = 0
  // Cap the scan — a huge generated file need not be read end to end to know its style.
  const lines = text.split('\n', 10_000)
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.trim().length === 0) continue
    if (line[0] === '\t') {
      tabLines++
      continue
    }
    let n = 0
    while (n < line.length && line[n] === ' ') n++
    if (line[n] === '\t') continue // mixed run: says nothing reliable
    if (n > 0) spaceLines++
    if (line[n] === '*' && n > prev) continue // ` * ` under `/**`
    const d = n - prev
    if (d >= 2 && d <= 8) deltas.set(d, (deltas.get(d) ?? 0) + 1)
    prev = n
  }
  if (tabLines > spaceLines) return { tabs: true, unit: 4 }
  let best = 0
  let bestCount = 0
  for (const [d, count] of deltas) {
    // Ties go to the smaller unit: 2 and 4 equally common means 4 is two levels of 2.
    if (count > bestCount || (count === bestCount && d < best)) {
      best = d
      bestCount = count
    }
  }
  return best ? { tabs: false, unit: best } : DEFAULT_INDENT
}

/** The file's detected indentation, so a later reconfigure can rebuild from it. */
export const fileIndent = Facet.define<FileIndent, FileIndent>({
  combine: (values) => values[0] ?? DEFAULT_INDENT,
})

/** Columns one indentation level is DRAWN with; 0 = as stored. */
export const indentDisplay = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
})

/**
 * Drawn width of `cols` leading columns. Whole levels scale to the display
 * size; a partial-level leftover (the ` * ` under a Javadoc `/**`, a
 * continuation aligned by hand) stays 1 column per space, so it keeps lining
 * up with the text it was aligned to.
 */
export function drawnColumns(cols: number, stored: number, shown: number): number {
  if (stored === shown || stored <= 0) return cols
  return Math.floor(cols / stored) * shown + (cols % stored)
}

/** Columns one level occupies in the document text (tabs: the tab size). */
export function storedLevel(state: EditorState): number {
  return getIndentUnit(state)
}

/** Columns one level is drawn with on screen. */
export function displayedLevel(state: EditorState): number {
  return state.facet(indentDisplay) || getIndentUnit(state)
}

export function resolveDisplay(pref: IndentDisplayPref, info: FileIndent, desk: boolean): number {
  if (pref !== 'auto') return pref
  return desk ? (info.tabs ? 4 : info.unit) : 2
}

/**
 * The indentation slice of a file's state — lives in one compartment, so a
 * preference change is a single reconfigure. Spaces files keep their real
 * unit for editing and draw it scaled; tab files simply get the display size
 * as their tab size (that is what "Tab Size" means), so nothing needs scaling.
 */
export function indentConfig(info: FileIndent, pref: IndentDisplayPref, desk: boolean): Extension {
  const d = resolveDisplay(pref, info, desk)
  if (info.tabs) return [fileIndent.of(info), indentUnit.of('\t'), EditorState.tabSize.of(d), indentDisplay.of(d)]
  return [
    fileIndent.of(info),
    indentUnit.of(' '.repeat(info.unit)),
    EditorState.tabSize.of(info.unit),
    indentDisplay.of(d),
  ]
}

/** What the status bar shows: `Spaces: 2` / `Tab Size: 4`. */
export function indentStatus(state: EditorState): { tabs: boolean; size: number } {
  return { tabs: state.facet(fileIndent).tabs, size: displayedLevel(state) }
}

const fitCache = new Map<string, Decoration>()

function fitMark(stored: number, shown: number): Decoration {
  const key = `${stored}:${shown}`
  let deco = fitCache.get(key)
  if (!deco) {
    // Monospace, so one space is 1ch; letter-spacing adds (or removes) after
    // every glyph, making each space shown/stored ch wide. Text stays intact,
    // so the caret still lands between the real spaces — just closer together.
    const ls = (shown / stored - 1).toFixed(4)
    deco = Decoration.mark({ class: 'cm-indentFit', attributes: { style: `letter-spacing:${ls}ch` } })
    fitCache.set(key, deco)
  }
  return deco
}

function buildFit(view: EditorView): DecorationSet {
  const { state } = view
  const shown = state.facet(indentDisplay)
  const info = state.facet(fileIndent)
  if (info.tabs || !shown || shown === info.unit) return Decoration.none
  const mark = fitMark(info.unit, shown)
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = state.doc.lineAt(pos)
      let n = 0
      while (n < line.length && line.text.charCodeAt(n) === 32) n++
      // Whole levels only — see drawnColumns.
      const whole = n - (n % info.unit)
      if (whole > 0) builder.add(line.from, line.from + whole, mark)
      pos = line.to + 1
    }
  }
  return builder.finish()
}

/** Draws leading spaces at the display size. A no-op when display = stored. */
export const indentFit = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildFit(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.reconfigured))
        this.decorations = buildFit(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)
