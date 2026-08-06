/**
 * Headless syntax highlighting, shared by "Share as image" and "Share as PDF".
 *
 * Both actions render code outside the editor, so both need the same thing: a
 * file's source tokenised into per-line, per-class segments under some
 * `HighlightStyle`, without an EditorView existing. The grammar imports stay
 * dynamic for the same reason `editor/setup.ts` loads them lazily — the Lezer
 * grammars are the bulk of the bundle, and a student who never shares a Java
 * file should never download its grammar twice as fast. This cache is a third,
 * independent one (editor, share-image historically, now here) on the same
 * argument as before: loaded grammars are tiny to hold twice, and sharing the
 * editor's would mean reaching into its internals.
 *
 * The grammar picked per file comes from `editorLangForPath` — the editor's
 * own per-file mapping — not the runtime's `langForPath`, which answers
 * "which engine runs this project" and therefore lumps html/css into `web`.
 * (The share-image card used `langForPath` and fell through to the Python
 * grammar for every non-Java file, which is how an HTML file shared as an
 * image came out coloured as Python.)
 */
import { highlightTree, tags as t } from '@lezer/highlight'
import type { Tree } from '@lezer/common'
import { HighlightStyle, StreamLanguage } from '@codemirror/language'
import { editorLangForPath } from '../editor/setup'

export interface Segment {
  text: string
  cls: string | null
}

/** Finer than `EditorLang` — a headless parse must pick the exact dialect
 *  itself, since a TSX parse of plain JS reads `a < b` as a tag. */
type GrammarKey = 'java' | 'python' | 'csharp' | 'c' | 'html' | 'css' | 'js' | 'jsx' | 'ts' | 'tsx'

function grammarKeyForPath(path: string): GrammarKey | null {
  const lang = editorLangForPath(path)
  if (lang !== 'javascript') return lang
  if (/\.tsx$/i.test(path)) return 'tsx'
  if (/\.jsx$/i.test(path)) return 'jsx'
  if (/\.ts$/i.test(path)) return 'ts'
  return 'js'
}

interface CodeParser {
  parse(input: string): Tree
}

const parserCache = new Map<GrammarKey, CodeParser>()

async function parserFor(key: GrammarKey): Promise<CodeParser> {
  const cached = parserCache.get(key)
  if (cached) return cached
  let parser: CodeParser
  switch (key) {
    case 'java':
      parser = (await import('@codemirror/lang-java')).javaLanguage.parser
      break
    case 'python':
      parser = (await import('@codemirror/lang-python')).pythonLanguage.parser
      break
    case 'csharp':
      // Same story as the editor: no Lezer grammar for C#, the clike stream
      // mode covers keywords/strings/comments/numbers.
      parser = StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).csharp).parser
      break
    case 'c':
      // Same clike family as the editor's C grammar.
      parser = StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).c).parser
      break
    case 'html':
      // htmlLanguage carries the mixed parser, so <style> and <script> bodies
      // highlight as css/js inside the one tree.
      parser = (await import('@codemirror/lang-html')).htmlLanguage.parser
      break
    case 'css':
      parser = (await import('@codemirror/lang-css')).cssLanguage.parser
      break
    case 'js':
      parser = (await import('@codemirror/lang-javascript')).javascriptLanguage.parser
      break
    case 'jsx':
      parser = (await import('@codemirror/lang-javascript')).jsxLanguage.parser
      break
    case 'ts':
      parser = (await import('@codemirror/lang-javascript')).typescriptLanguage.parser
      break
    case 'tsx':
      parser = (await import('@codemirror/lang-javascript')).tsxLanguage.parser
      break
  }
  parserCache.set(key, parser)
  return parser
}

/**
 * Tokenises `code` into per-line segments under `style`. A token spanning a
 * newline is split at each `\n` into same-class segments — building one HTML
 * string and cutting on `\n` would leave an unbalanced span dangling across lines.
 */
export async function highlightLines(code: string, path: string, style: HighlightStyle): Promise<Segment[][]> {
  const lines: Segment[][] = [[]]
  const push = (text: string, cls: string | null) => {
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ text: part, cls })
    })
  }
  const key = grammarKeyForPath(path)
  if (!key) {
    push(code, null)
    return lines
  }
  const parser = await parserFor(key)
  const tree = parser.parse(code)
  let pos = 0
  highlightTree(tree, style, (from, to, cls) => {
    if (from > pos) push(code.slice(pos, from), null)
    push(code.slice(from, to), cls)
    pos = to
  })
  if (pos < code.length) push(code.slice(pos), null)
  return lines
}

/** The literal CSS rules CodeMirror generated for `style`'s classes
 *  (`.ͼp { color: ... }`, etc) — for a plain `<style>` block inside an
 *  off-screen card, where no EditorView exists to mount them. */
export function highlightCss(style: HighlightStyle): string {
  return style.module?.getRules() ?? ''
}

/**
 * VS Code Light+ colours — the light-side sibling of the editor's Dark+
 * `syntaxColors` (setup.ts). Literals allowed here for the same reason as
 * there: syntax colour is editor-domain, not chrome.
 */
export const printHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.definitionKeyword], color: '#0000FF' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#AF00DB' },
  { tag: [t.string, t.special(t.string), t.character, t.docString], color: '#A31515' },
  { tag: [t.regexp], color: '#811F3F' },
  { tag: [t.number, t.integer, t.float], color: '#098658' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#008000' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#795E26' },
  { tag: [t.typeName, t.className, t.namespace], color: '#267F99' },
  { tag: [t.variableName, t.propertyName], color: '#001080' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#001080' },
  { tag: [t.attributeName], color: '#E50000' },
  { tag: [t.bool, t.null, t.atom, t.self], color: '#0000FF' },
  { tag: [t.constant(t.variableName), t.standard(t.variableName), t.special(t.variableName)], color: '#0070C1' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.derefOperator], color: '#000000' },
  { tag: [t.tagName], color: '#800000' },
  { tag: [t.attributeValue], color: '#0000FF' },
  { tag: [t.annotation, t.meta], color: '#795E26' },
  { tag: [t.escape], color: '#EE0000' },
  { tag: [t.link, t.url], color: '#001080', textDecoration: 'underline' },
  { tag: [t.heading], color: '#0000FF', fontWeight: 'bold' },
  { tag: [t.invalid], color: '#CD3131' },
])
