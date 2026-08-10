import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { LangId } from '../runtime'
import { recordable, withUsageBoost } from './usage'
import { JAVA_FQCN } from './javaApi.generated'

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

/**
 * The classes worth auto-importing — the curated scope of a first-year course.
 * java.lang is deliberately absent (needs no import), and so is a class like
 * PrintStream that a student reaches through `System.out`, never `new`.
 *
 * Only the *selection* is editorial; each fully-qualified name is looked up from
 * `JAVA_FQCN` (generated from JDK reflection — see javaApi.generated.ts), so a
 * mistyped or drifted package can no longer creep in. The audit in
 * `gen-java-api.mjs` fails if any name here is missing from the JDK.
 */
const IMPORTABLE: readonly string[] = [
  'Scanner', 'ArrayList', 'LinkedList', 'HashMap', 'TreeMap', 'LinkedHashMap', 'HashSet', 'TreeSet',
  'LinkedHashSet', 'PriorityQueue', 'Arrays', 'Objects', 'Collections', 'Random', 'List', 'Map', 'Set',
  'Queue', 'Deque', 'ArrayDeque', 'Stack', 'Comparator', 'Optional', 'Iterator', 'NoSuchElementException',
  'InputMismatchException', 'Stream', 'IntStream', 'Collectors', 'BufferedReader', 'BufferedWriter',
  'InputStreamReader', 'IOException', 'File', 'FileReader', 'FileWriter', 'PrintWriter',
  'FileNotFoundException', 'Files', 'Path', 'Paths',
]

/** class name → its fully-qualified name, from the curated selection above. */
export const JAVA_IMPORTS: Record<string, string> = Object.fromEntries(
  IMPORTABLE.map((name) => [name, JAVA_FQCN[name]]),
)

/** java.lang needs no import; still worth completing after `import java.lang.` for a curious student. */
const JAVA_LANG_CLASSES = [
  'String', 'Math', 'Integer', 'Double', 'Long', 'Boolean', 'Character', 'Object',
  'System', 'StringBuilder', 'Exception', 'RuntimeException', 'Thread', 'Runnable',
  'Comparable', 'Iterable',
]

/** Exact package, not prefix: `java.util` must not swallow `java.util.stream.*`. */
const byPackage = (pkg: string) =>
  Object.entries(JAVA_IMPORTS).filter(([, fqcn]) => fqcn.slice(0, fqcn.lastIndexOf('.')) === pkg).map(([cls]) => cls).sort()

/** package → its classes, curriculum scope only (java.util, java.io, java.lang, java.util.stream). */
const JAVA_PACKAGES: Record<string, readonly string[]> = {
  'java.util': byPackage('java.util'),
  'java.io': byPackage('java.io'),
  'java.lang': JAVA_LANG_CLASSES,
  'java.util.stream': byPackage('java.util.stream'),
  'java.nio.file': byPackage('java.nio.file'),
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
  ['csv', 'read and write CSV data files'],
  ['typing', 'type hints for annotations'],
  ['pathlib', 'file paths as objects'],
]

/* --------------------------------------------------------- inserting an import */

interface Edit {
  from: number
  to: number
  insert: string
}

/**
 * Where `import java.util.Scanner;` belongs, or `null` if it (or a covering
 * wildcard) is already there. Text-based on purpose: inserted alphabetically
 * among existing imports, else after the package line, else at the top of the
 * file. Never called for `java.lang`.
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
 * Shared apply: inserts the completion's label plus, if `getEdit` finds one,
 * the import it depends on — one transaction, so Undo reverts both together.
 * `getEdit` runs against the state *before* the completion's own insertion.
 */
export function applyWithImport(getEdit: (state: EditorState) => Edit | null) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const label = completion.label
    const edit = getEdit(view.state)
    const own = { from, to, insert: label }
    // `state.changes()` needs specs in ascending order. The import edit almost
    // always sorts before `own`; assuming that instead of sorting silently
    // corrupted a changeset once (§ completions QA).
    const specs = edit ? (edit.from <= own.from ? [edit, own] : [own, edit]) : [own]
    const changes = view.state.changes(specs)
    // Map `from` through the import edit alone, then add the label length in
    // new-space — mixing old-doc `from` with new-doc `label.length` directly
    // once asked for a position past the old document's end (§ completions QA).
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
  const path = segments.join('.')

  let options: Completion[]
  if (segments.length === 0) {
    options = [{ label: 'java', type: 'namespace', boost: 20, apply: namespaceApply }]
  } else if (path === 'java') {
    options = ['util', 'io', 'nio', 'lang'].map((seg) => ({ label: seg, type: 'namespace', boost: 20, apply: namespaceApply }))
  } else if (path === 'java.nio') {
    // The one sub-package a course reaches for: java.nio.file (Files, Path, Paths).
    options = [{ label: 'file', type: 'namespace', boost: 20, apply: namespaceApply }]
  } else if (JAVA_PACKAGES[path]) {
    options = JAVA_PACKAGES[path].map((cls) => ({
      label: cls,
      type: 'class',
      boost: 20,
      apply: classImportApply,
    }))
    // java.util also holds the java.util.stream sub-package (Stream, Collectors…).
    if (path === 'java.util') options.push({ label: 'stream', type: 'namespace', boost: 10, apply: namespaceApply })
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
  const base = lang === 'java' ? javaImportSource : pythonImportSource
  // Record and re-rank by usage, same as the other sources — a student who
  // always imports Scanner sees it lead the list.
  return (ctx: CompletionContext) => {
    const res = base(ctx)
    return res ? { ...res, options: withUsageBoost(lang, res.options.map((o) => recordable(lang, o))) } : null
  }
}
