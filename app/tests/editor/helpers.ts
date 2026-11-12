/**
 * Drives the real completion sources headlessly: a document with a `‸` caret,
 * the language's parser, an explicit (Ctrl+Space) completion context — then the
 * labels CodeMirror would offer for what is typed so far.
 */
import { EditorState } from '@codemirror/state'
import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import { ensureSyntaxTree } from '@codemirror/language'
import { java } from '@codemirror/lang-java'
import { python } from '@codemirror/lang-python'
import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { c as cMode, csharp as csharpMode } from '@codemirror/legacy-modes/mode/clike'
import { completionSources, type CompletionLang } from '../../src/editor/completions.ts'
import { setProjectSource, type ProjectFileText } from '../../src/editor/projectSource.ts'

let revision = 0
/** Runs `body` with these as the other project files, then clears them — even if it throws. */
export function withProjectFiles(files: ProjectFileText[], body: () => void): void {
  setProjectSource(() => files, ++revision)
  try {
    body()
  } finally {
    setProjectSource(() => [], ++revision)
  }
}

const sources: Record<CompletionLang, ReturnType<typeof completionSources>> = {
  java: completionSources('java', () => []),
  python: completionSources('python', () => []),
  csharp: completionSources('csharp', () => []),
  c: completionSources('c', () => []),
}
/** The grammar setup.ts loads for each language (C# and C: the clike stream mode). */
const grammar = {
  java: () => java(),
  python: () => python(),
  csharp: () => new LanguageSupport(StreamLanguage.define(csharpMode)),
  c: () => new LanguageSupport(StreamLanguage.define(cMode)),
}

export interface Offered {
  labels: string[]
  byLabel: Map<string, Completion>
}

/** What the popup would list at `‸`, filtered by the typed prefix (case-insensitive). */
export function offered(lang: CompletionLang, docWithCaret: string): Offered {
  const pos = docWithCaret.indexOf('‸')
  if (pos === -1) throw new Error('no ‸ caret in the test document')
  const doc = docWithCaret.replace('‸', '')
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [grammar[lang]()] })
  ensureSyntaxTree(state, doc.length, 5000)
  const ctx = new CompletionContext(state, pos, true)
  const labels: string[] = []
  const byLabel = new Map<string, Completion>()
  for (const source of sources[lang]) {
    const r = source(ctx)
    if (!r || r instanceof Promise) continue
    const typed = doc.slice(r.from, pos).toLowerCase()
    const ranked = [...r.options].sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0))
    for (const o of ranked) {
      const l = o.label.toLowerCase()
      if (typed && !l.startsWith(typed) && !l.slice(l.lastIndexOf('.') + 1).startsWith(typed)) continue
      labels.push(o.label)
      if (!byLabel.has(o.label)) byLabel.set(o.label, o)
    }
  }
  return { labels, byLabel }
}

/** A Java file with a `main` holding `body`, and optional classes before `Main`. */
export const javaMain = (body: string, classes = '') =>
  `import java.util.*;\nimport java.io.*;\n${classes}public class Main {\n  public static void main(String[] args) {\n${body}\n  }\n}\n`
