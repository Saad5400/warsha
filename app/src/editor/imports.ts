import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { LangId } from '../runtime'

/**
 * Two of the three gaps from the founder report live here:
 *
 *   - **auto-import** — accepting a completion for a class that needs an
 *     import (`Scanner`, `ArrayList`, …) inserts `import java.util.Scanner;`
 *     in the same keystroke, in the right place. `applyWithImport` is the
 *     shared plumbing; `importInsertion` / `pyImportInsertion` decide *where*.
 *   - **import-statement completion** — typing `import java.` or `import ` /
 *     `from ` offers the next segment, so the import line finishes itself.
 *
 * Both auto-import helpers are heuristic, not a build against the real
 * classpath: they read the document as text, never a symbol table. That is
 * enough for a first-year course (the imports a student needs are the ones
 * this file knows about) and wrong in the way every heuristic here is wrong —
 * see completions.ts's header comment.
 */

/** class name → its fully-qualified name. Only classes worth auto-importing; java.lang is never in here. */
export const JAVA_IMPORTS: Record<string, string> = {
  Scanner: 'java.util.Scanner',
  ArrayList: 'java.util.ArrayList',
  LinkedList: 'java.util.LinkedList',
  HashMap: 'java.util.HashMap',
  TreeMap: 'java.util.TreeMap',
  HashSet: 'java.util.HashSet',
  TreeSet: 'java.util.TreeSet',
  Arrays: 'java.util.Arrays',
  Collections: 'java.util.Collections',
  Random: 'java.util.Random',
  List: 'java.util.List',
  Map: 'java.util.Map',
  Set: 'java.util.Set',
  Queue: 'java.util.Queue',
  Deque: 'java.util.Deque',
  ArrayDeque: 'java.util.ArrayDeque',
  Stack: 'java.util.Stack',
  Comparator: 'java.util.Comparator',
  Optional: 'java.util.Optional',
  Iterator: 'java.util.Iterator',
  NoSuchElementException: 'java.util.NoSuchElementException',
  InputMismatchException: 'java.util.InputMismatchException',
  BufferedReader: 'java.io.BufferedReader',
  InputStreamReader: 'java.io.InputStreamReader',
  IOException: 'java.io.IOException',
  File: 'java.io.File',
  FileReader: 'java.io.FileReader',
  FileWriter: 'java.io.FileWriter',
  PrintWriter: 'java.io.PrintWriter',
  FileNotFoundException: 'java.io.FileNotFoundException',
}

/** java.lang needs no import; still worth completing after `import java.lang.` for a curious student. */
const JAVA_LANG_CLASSES = [
  'String', 'Math', 'Integer', 'Double', 'Long', 'Boolean', 'Character', 'Object',
  'System', 'StringBuilder', 'Exception', 'RuntimeException', 'Thread', 'Runnable',
  'Comparable', 'Iterable',
]

const byPackage = (pkg: string) =>
  Object.entries(JAVA_IMPORTS).filter(([, fqcn]) => fqcn.startsWith(`${pkg}.`)).map(([cls]) => cls).sort()

/** package → its classes, curriculum scope only (java.util, java.io, java.lang). */
const JAVA_PACKAGES: Record<string, readonly string[]> = {
  'java.util': byPackage('java.util'),
  'java.io': byPackage('java.io'),
  'java.lang': JAVA_LANG_CLASSES,
}

export const PYTHON_STDLIB_MODULES: readonly (readonly [string, string])[] = [
  ['math', 'square roots, rounding, constants'],
  ['random', 'random numbers and choices'],
  ['sys', 'the running program itself'],
  ['os', 'the operating system'],
  ['json', 'read and write JSON'],
  ['time', 'clocks and delays'],
  ['datetime', 'dates and times'],
  ['collections', 'extra container types'],
  ['itertools', 'building blocks for loops'],
  ['functools', 'building blocks for functions'],
  ['re', 'pattern matching in text'],
  ['string', 'helpers for working with text'],
  ['statistics', 'mean, median, and friends'],
  ['heapq', 'a priority queue'],
  ['bisect', 'binary search on sorted lists'],
]

/* --------------------------------------------------------- inserting an import */

interface Edit {
  from: number
  to: number
  insert: string
}

/**
 * Where `import java.util.Scanner;` belongs in `state`, or `null` if it (or a
 * wildcard covering it) is already there. Text-based on purpose — inserted
 * alphabetically among existing imports, after any existing imports; after
 * the package declaration if there is one and no imports yet; else at the top
 * of the file. Never called for `java.lang`.
 */
export function importInsertion(state: EditorState, fqcn: string): Edit | null {
  if (fqcn.startsWith('java.lang.')) return null
  const pkg = fqcn.slice(0, fqcn.lastIndexOf('.'))
  const doc = state.doc
  let packageLine = 0
  const imports: { line: number; spec: string }[] = []
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text.trim()
    const pkgMatch = /^package\s+([\w.]+)\s*;/.exec(text)
    if (pkgMatch) {
      packageLine = i
      continue
    }
    const impMatch = /^import\s+([\w.]+(?:\.\*)?)\s*;/.exec(text)
    if (impMatch) {
      if (impMatch[1] === fqcn || impMatch[1] === `${pkg}.*`) return null
      imports.push({ line: i, spec: impMatch[1] })
    }
  }
  const insertText = `import ${fqcn};`
  if (imports.length) {
    const before = imports.find((imp) => fqcn.localeCompare(imp.spec) < 0)
    if (before) {
      const at = doc.line(before.line).from
      return { from: at, to: at, insert: `${insertText}\n` }
    }
    const at = doc.line(imports[imports.length - 1].line).to
    return { from: at, to: at, insert: `\n${insertText}` }
  }
  if (packageLine) {
    const at = doc.line(packageLine).to
    return { from: at, to: at, insert: `\n\n${insertText}` }
  }
  return { from: 0, to: 0, insert: `${insertText}\n\n` }
}

/** Same idea for Python: `import math` at the top of the file, unless already imported. */
export function pyImportInsertion(state: EditorState, module: string): Edit | null {
  const doc = state.doc
  const already = new RegExp(`^(import\\s+${module}\\b|from\\s+${module}\\b)`)
  for (let i = 1; i <= doc.lines; i++) {
    if (already.test(doc.line(i).text.trim())) return null
  }
  return { from: 0, to: 0, insert: `import ${module}\n` }
}

/**
 * Shared apply: insert the completion's label where it was typed, plus (if
 * `getEdit` finds one) the import it depends on — one transaction, so Undo
 * reverts both together. `getEdit` runs against `view.state`, i.e. *before*
 * the completion's own insertion, which is what every caller wants: the
 * import decision only depends on what already exists in the file.
 */
export function applyWithImport(getEdit: (state: EditorState) => Edit | null) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const label = completion.label
    const edit = getEdit(view.state)
    const own = { from, to, insert: label }
    // `state.changes()` wants the specs in ascending document order — the
    // import always lands at or near the top of the file, so it almost
    // always sorts before the completion's own edit; asserting that instead
    // of sorting for it silently corrupted the changeset once (§ completions
    // QA), the one time the import edit was not a zero-width insertion.
    const specs = edit ? (edit.from <= own.from ? [edit, own] : [own, edit]) : [own]
    const changes = view.state.changes(specs)
    // The cursor belongs right after the label, in the *new* document. `from`
    // is an old-document position and `label.length` a new-document length —
    // adding them and feeding the sum back into `mapPos` mixes the two
    // coordinate spaces and can ask for a position past the end of the old
    // document (this cost a real "position out of range" failure once,
    // caught by the completions QA suite). Map `from` through the import
    // edit *alone* — the shift `own` itself causes at its own boundary is
    // ambiguous to map through — then add the label length in new-space.
    const shifted = edit ? view.state.changes([edit]).mapPos(from) : from
    view.dispatch({ changes, selection: { anchor: shifted + label.length } })
  }
}

/* ---------------------------------------------------- import-statement completion */

/** Package/namespace segment: inserted with a trailing `.` so the chain continues. */
const namespaceApply = (view: EditorView, completion: Completion, from: number, to: number) => {
  const insert = `${completion.label}.`
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
}

/** Leaf class: closes the statement with `;`, unless one is already there. */
const classImportApply = (view: EditorView, completion: Completion, from: number, to: number) => {
  const line = view.state.doc.lineAt(to)
  const rest = line.text.slice(to - line.from).trimStart()
  const insert = rest.startsWith(';') ? completion.label : `${completion.label};`
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } })
}

function javaImportSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const before = line.text.slice(0, ctx.pos - line.from)
  const m = /^\s*import\s+((?:[A-Za-z_$][\w$]*\.)*)([A-Za-z_$][\w$]*)?$/.exec(before)
  if (!m) return null
  const prefix = m[1]
  const partial = m[2] ?? ''
  const from = ctx.pos - partial.length
  const segments = prefix ? prefix.slice(0, -1).split('.') : []

  let options: Completion[]
  if (segments.length === 0) {
    options = [{ label: 'java', type: 'namespace', boost: 20, apply: namespaceApply }]
  } else if (segments.length === 1 && segments[0] === 'java') {
    options = ['util', 'io', 'lang'].map((seg) => ({ label: seg, type: 'namespace', boost: 20, apply: namespaceApply }))
  } else if (segments.length === 2 && segments[0] === 'java' && JAVA_PACKAGES[`java.${segments[1]}`]) {
    options = JAVA_PACKAGES[`java.${segments[1]}`].map((cls) => ({
      label: cls,
      type: 'class',
      boost: 20,
      apply: classImportApply,
    }))
  } else {
    return null
  }
  return { from, options, validFor: /^[\w$]*$/ }
}

function pythonImportSource(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const before = line.text.slice(0, ctx.pos - line.from)
  const m = /^\s*(?:import|from)\s+([\w.]*)$/.exec(before)
  if (!m) return null
  const partial = m[1]
  const from = ctx.pos - partial.length
  const options = PYTHON_STDLIB_MODULES.map(([mod, detail]): Completion => ({ label: mod, type: 'namespace', detail, boost: 20 }))
  return { from, options, validFor: /^[\w.]*$/ }
}

export function importStatementSource(lang: LangId): CompletionSource {
  return lang === 'java' ? javaImportSource : pythonImportSource
}
