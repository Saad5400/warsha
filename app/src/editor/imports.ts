import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { LangId } from '../runtime'
import { recordable, withUsageBoost } from './usage'
import { JAVA_FQCN } from './javaApi.generated'
import { CSHARP_IMPLICIT_USINGS, CSHARP_NAMESPACES, CSHARP_USINGS } from './csharpApi'
import { C_HEADERS, C_STD_HEADERS } from './cApi'

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
 * `JAVA_FQCN` (vendored from JDK reflection — see javaApi.generated.ts) or, for
 * the classes added after that vendoring, `JAVA_FQCN_EXTRA` below. The editor
 * test suite fails if any name here resolves to neither.
 */
const IMPORTABLE: readonly string[] = [
  'Scanner', 'ArrayList', 'LinkedList', 'HashMap', 'TreeMap', 'LinkedHashMap', 'HashSet', 'TreeSet',
  'LinkedHashSet', 'PriorityQueue', 'Arrays', 'Objects', 'Collections', 'Random', 'List', 'Map', 'Set',
  'Queue', 'Deque', 'ArrayDeque', 'Stack', 'Comparator', 'Optional', 'Iterator', 'NoSuchElementException',
  'InputMismatchException', 'Stream', 'IntStream', 'Collectors', 'BufferedReader', 'BufferedWriter',
  'InputStreamReader', 'IOException', 'File', 'FileReader', 'FileWriter', 'PrintWriter',
  'FileNotFoundException', 'Files', 'Path', 'Paths', 'Vector', 'Date', 'Locale', 'ConcurrentModificationException',
  'Instant', 'Duration', 'Year', 'LocalDate', 'LocalDateTime', 'FileOutputStream', 'IllegalFormatConversionException',
  'MissingFormatArgumentException', 'UnknownFormatConversionException',
]

/**
 * Fully-qualified names for classes the course material needs that the vendored
 * javaApi.generated.ts predates (its generator is not in this repo, so it is not
 * hand-edited). Checked against JDK 17 reflection when added (2026-11-12). Fold
 * these into the generated file whenever it is next regenerated.
 */
const JAVA_FQCN_EXTRA: Readonly<Record<string, string>> = {
  Vector: 'java.util.Vector',
  Date: 'java.util.Date',
  Locale: 'java.util.Locale',
  ConcurrentModificationException: 'java.util.ConcurrentModificationException',
  IllegalFormatConversionException: 'java.util.IllegalFormatConversionException',
  MissingFormatArgumentException: 'java.util.MissingFormatArgumentException',
  UnknownFormatConversionException: 'java.util.UnknownFormatConversionException',
  FileOutputStream: 'java.io.FileOutputStream',
  Instant: 'java.time.Instant',
  Duration: 'java.time.Duration',
  Year: 'java.time.Year',
  LocalDate: 'java.time.LocalDate',
  LocalDateTime: 'java.time.LocalDateTime',
}

/** A JDK class's fully-qualified name, if the editor knows it. */
export const javaFqcn = (name: string): string | undefined => JAVA_FQCN[name] ?? JAVA_FQCN_EXTRA[name]

/** Every IMPORTABLE name that resolves to no fully-qualified name — empty, or a test fails. */
export const unresolvedImportables = (): string[] => IMPORTABLE.filter((n) => !javaFqcn(n))

/** class name → its fully-qualified name, from the curated selection above. */
export const JAVA_IMPORTS: Record<string, string> = Object.fromEntries(
  IMPORTABLE.filter((name) => javaFqcn(name)).map((name) => [name, javaFqcn(name)!]),
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
  ['io', 'in-memory files (StringIO)'],
  ['numpy', 'fast arrays and maths — import numpy as np'],
  ['pandas', 'tables of data — import pandas as pd'],
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
 * A line-per-directive header (`using System.Text;`, `#include <stdio.h>`): null
 * when `already` matches a line, else the line after the last line `group`
 * matches, else the top of the file.
 */
function directiveInsertion(state: EditorState, line: string, already: RegExp, group: RegExp): Edit | null {
  const doc = state.doc
  let last = 0
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text.trim()
    if (already.test(text)) return null
    if (group.test(text)) last = i
  }
  if (last) {
    const at = doc.line(last).to
    return { from: at, to: at, insert: `\n${line}` }
  }
  return { from: 0, to: 0, insert: `${line}\n` }
}

/** C#: `using System.Text;` after the other usings, unless already there. */
export function usingInsertion(state: EditorState, ns: string): Edit | null {
  const esc = ns.replace(/\./g, '\\.')
  return directiveInsertion(state, `using ${ns};`, new RegExp(`^(?:global\\s+)?using\\s+${esc}\\s*;`), /^using\s+[\w.]+\s*;/)
}

/**
 * C# / C: the `using` / `#include` a dictionary name needs — a note for its detail
 * and an apply that adds the line (if missing) in the same edit. Null when none is
 * needed: a C# namespace the runtime already imports globally needs nothing.
 */
export function directiveFor(lang: 'csharp' | 'c', label: string): { note: string; apply: Completion['apply'] } | null {
  if (lang === 'csharp') {
    const ns = CSHARP_USINGS[label.split('.')[0]]
    if (!ns || CSHARP_IMPLICIT_USINGS.has(ns)) return null
    return { note: `adds using ${ns}`, apply: applyWithImport((s) => usingInsertion(s, ns)) }
  }
  const header = C_HEADERS[label]
  return header ? { note: `adds #include <${header}>`, apply: applyWithImport((s) => includeInsertion(s, header)) } : null
}

/** C: `#include <stdio.h>` after the other includes, unless already there. */
export function includeInsertion(state: EditorState, header: string): Edit | null {
  const esc = header.replace(/\./g, '\\.')
  return directiveInsertion(state, `#include <${header}>`, new RegExp(`^#\\s*include\\s*[<"]${esc}[>"]`), /^#\s*include\b/)
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

/** `from math import sq|` — the module's own names (and further ones after a comma). */
function pythonFromImportSource(ctx: CompletionContext, modules: Record<string, readonly Completion[]>): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos)
  const before = line.text.slice(0, ctx.pos - line.from)
  const m = /^\s*from\s+([\w.]+)\s+import\s+\(?(?:[\w\s]+,\s*)*(\w*)$/.exec(before)
  if (!m) return null
  const members = modules[m[1]]
  if (!members) return null
  const options = members.map((c): Completion => ({ label: c.label, type: c.type, detail: c.detail, boost: 20 }))
  return { from: ctx.pos - m[2].length, options, validFor: /^\w*$/ }
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

const USING_PATH = /^\s*using\s+([\w.]*)$/
const INCLUDE_PATH = /^\s*#\s*include\s*<([\w./]*)$/

/** Is the caret in a `using System.|` path (C#) or an `#include <|` (C)? The dictionary steps aside there. */
export function inDirective(lang: string, state: EditorState, pos: number): boolean {
  if (lang !== 'csharp' && lang !== 'c') return false
  const line = state.doc.lineAt(pos)
  return (lang === 'c' ? INCLUDE_PATH : USING_PATH).test(state.sliceDoc(line.from, pos))
}

/** `using Sys|` (C#) / `#include <st|` (C): the namespaces and headers a course uses. */
function directiveSource(re: RegExp, rows: readonly (readonly [string, string])[], validFor: RegExp, close?: string) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const line = ctx.state.doc.lineAt(ctx.pos)
    const m = re.exec(line.text.slice(0, ctx.pos - line.from))
    if (!m) return null
    const rest = line.text.slice(ctx.pos - line.from)
    const options = rows.map(([label, detail]): Completion => ({
      label,
      type: 'namespace',
      detail,
      boost: 20,
      ...(close && !rest.startsWith(close) ? { apply: label + close } : {}),
    }))
    return { from: ctx.pos - m[1].length, options, validFor }
  }
}

/** `pyTables`: every Python receiver table (modules included), for `from x import …`. */
export function importStatementSource(lang: LangId, pyTables: Record<string, readonly Completion[]> = {}): CompletionSource {
  const base =
    lang === 'java'
      ? javaImportSource
      : lang === 'csharp'
        ? directiveSource(USING_PATH, CSHARP_NAMESPACES, /^[\w.]*$/, ';')
        : lang === 'c'
          ? directiveSource(INCLUDE_PATH, C_STD_HEADERS, /^[\w./]*$/, '>')
          : (ctx: CompletionContext) => pythonFromImportSource(ctx, pyTables) ?? pythonImportSource(ctx)
  // Record and re-rank by usage, same as the other sources — a student who
  // always imports Scanner sees it lead the list.
  return (ctx: CompletionContext) => {
    const res = base(ctx)
    return res ? { ...res, options: withUsageBoost(lang, res.options.map((o) => recordable(lang, o))) } : null
  }
}
