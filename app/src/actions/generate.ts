/**
 * "Generate…" (Alt+Insert, tab-strip ⋯ menu, Run menu) — JetBrains' Generate
 * dialog, done for a browser-only IDE: a student writing a class asks Warsha to
 * write the boilerplate that reads off its fields — a constructor, getters and
 * setters, `toString()`, `equals()`/`hashCode()`.
 *
 * Java (the real target) is parsed with **web-tree-sitter** — the same WASM
 * tree-sitter runtime and Java grammar `prettier-plugin-java` already ships and
 * runs for "Format file", loaded lazily on first use (mirroring
 * `loadJavaFormatter` in actions/format.ts). A real error-tolerant parser, so
 * generics and arrays (`Map<String, List<Integer>>`, `int[]`) come through
 * whole where a regex would choke. The generated members are spliced before the
 * class body's closing brace and the whole file is run back through `formatJava`
 * so the layout is canonical — we write rough Java and let prettier finish it.
 *
 * Python and C# are best-effort and deliberately lighter: no parser, just a
 * text scan in the house style of completions.ts / imports.ts (read the document
 * as text, never a symbol table). Their output is appended already-indented —
 * there is no C# formatter in-tree, and formatting Python would need Pyodide
 * booted — so those two never touch prettier.
 *
 * Deliberately pure, like format.ts: this file knows nothing about toasts,
 * menus or the editor. `App.tsx` calls `analyzeForGenerate`, opens the menu /
 * field picker, calls `generate`, and applies the result via the editor
 * controller so it lands as one undo step through the normal dirty/save path.
 */
import { EditorState } from '@codemirror/state'
import { Parser, Language, type Node } from 'web-tree-sitter'
import runtimeWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import { langForPath } from '../runtime'
import { assetUrl } from '../runtime/assetUrl'
import { importInsertion } from '../editor/imports'
import { formatJava } from './format'

/** Every generator across the three languages, as a flat union — the menu maps
 *  each to a label, `generate` dispatches on it. Java carries the JetBrains six;
 *  the others are the best-effort subset that stays correct without a parser. */
export type GenerateKind =
  // Java
  | 'constructor'
  | 'getter'
  | 'setter'
  | 'getterSetter'
  | 'toString'
  | 'equalsHashCode'
  // Python (best-effort)
  | 'pyRepr'
  | 'pyEq'
  // C# (best-effort)
  | 'csConstructor'
  | 'csProperties'

export type GenLang = 'java' | 'python' | 'csharp'

/** One field the student can pick in the checkbox picker. The flags are Java's —
 *  Python/C# fill them with neutral defaults (their generators never read them). */
export interface GenField {
  name: string
  /** Full source text of the type: `int`, `String`, `int[]`, `List<String>`. */
  type: string
  final: boolean
  boolean: boolean
  array: boolean
  primitive: boolean
}

/** A menu row: `available` false greys it out (no dead UI — a generator whose
 *  members all already exist, or that has nothing to read, can't be picked). */
export interface GenOption {
  kind: GenerateKind
  available: boolean
}

/** What the parse/scan found — carried to `generate` so it never re-parses. */
export interface GenAnalysis {
  lang: GenLang
  className: string
  /** Non-static instance fields, in declaration order — the picker's rows. */
  fields: GenField[]
  options: GenOption[]
  /** Opaque per-language model (`JavaModel` | `TextModel`), reused by `generate`. */
  model: JavaModel | TextModel
}

/** Why analysis produced nothing the student can act on — App words each one. */
export type GenReason = 'noClass' | 'syntaxError' | 'unsupported'

export type GenResult =
  | { status: 'ok'; source: string }
  /** Everything this generator would write already exists — App shows a quiet
   *  notice and changes nothing (never overwrite student code). */
  | { status: 'exists' }

/** The three languages Generate speaks; other extensions gate the command off. */
export function canGenerate(path: string | null): boolean {
  if (!path) return false
  const lang = langForPath(path)
  return lang === 'java' || lang === 'python' || lang === 'csharp'
}

/* ===================================================================== Java */

interface JavaModel {
  lang: 'java'
  source: string
  className: string
  fields: GenField[]
  /** Method names already defined on the class, for duplicate-skipping. */
  methodNames: Set<string>
  /** Parameter counts of existing constructors — a matching arity is a dup. */
  ctorArities: Set<number>
  /** Byte offset of the class body's closing `}` — members splice in before it. */
  insertIndex: number
}

const JAVA_PRIMITIVES = new Set(['byte', 'short', 'int', 'long', 'float', 'double', 'boolean', 'char'])

let javaParserPromise: Promise<Parser> | null = null

/** Loaded once per page, on the first Generate — never in the initial bundle.
 *  Two WASM assets: web-tree-sitter's own runtime (imported `?url`, Vite hashes
 *  it) and the Java grammar. The grammar is the exact orchard wasm the formatter
 *  ships, but `prettier-plugin-java`'s `exports` field hides its `dist/`, so
 *  Vite can't reach in — it is staged to public/ by `npm run assets` (like the
 *  other bypassed wasm/workers) and loaded by URL, same as the runtime workers. */
function loadJavaParser(): Promise<Parser> {
  if (!javaParserPromise) {
    javaParserPromise = (async () => {
      await Parser.init({ locateFile: () => runtimeWasmUrl })
      const parser = new Parser()
      const grammarUrl = assetUrl('warsha-tree-sitter-java.wasm')
      parser.setLanguage(await Language.load(grammarUrl))
      return parser
    })()
  }
  return javaParserPromise
}

/** Nearest enclosing class declaration, walking up from the cursor; else the
 *  sole top-level class if there is exactly one, else null (ambiguous). Only
 *  `class` — a record's components aren't `field_declaration`s (they live in
 *  `formal_parameters`), so generating off one yields empty, non-canonical
 *  members; records join enums/interfaces in degrading to the "noClass" notice. */
function javaClassAtCursor(root: Node, cursor: number): Node | null {
  let node: Node | null = root.namedDescendantForIndex(cursor)
  for (; node; node = node.parent) {
    if (node.type === 'class_declaration') return node
  }
  const classes = root.namedChildren.filter((c) => c.type === 'class_declaration')
  return classes.length === 1 ? classes[0] : null
}

function javaFieldsAndMembers(body: Node): {
  fields: GenField[]
  methodNames: Set<string>
  ctorArities: Set<number>
} {
  const fields: GenField[] = []
  const methodNames = new Set<string>()
  const ctorArities = new Set<number>()

  for (const member of body.namedChildren) {
    if (member.type === 'field_declaration') {
      // `modifiers` is a plain named child here, not a labelled field — its text
      // is space-joined (`"private final"`, annotations included); split for tokens.
      const modsNode = member.namedChildren.find((c) => c.type === 'modifiers')
      const mods = modsNode ? modsNode.text.split(/\s+/) : []
      if (mods.includes('static')) continue // instance state only
      const baseType = member.childForFieldName('type')?.text ?? 'Object'
      const isFinal = mods.includes('final')
      // Iterate declarators so `int a, b;` yields two fields, not one — and fold
      // in any C-style brackets, which bind to the DECLARATOR, not the type:
      // `int a, b[]` is a scalar and an array; `String data[]` / `int m[][]` are
      // arrays. `int[] data` puts them on the type instead — both fold here.
      for (const decl of member.namedChildren.filter((c) => c.type === 'variable_declarator')) {
        const name = decl.childForFieldName('name')?.text
        if (!name) continue
        const type = baseType + (decl.childForFieldName('dimensions')?.text ?? '')
        fields.push({
          name,
          type,
          final: isFinal,
          boolean: type === 'boolean',
          array: type.endsWith(']'),
          primitive: JAVA_PRIMITIVES.has(type),
        })
      }
    } else if (member.type === 'method_declaration') {
      const name = member.childForFieldName('name')?.text
      if (name) methodNames.add(name)
    } else if (member.type === 'constructor_declaration') {
      const params = member.childForFieldName('parameters')
      const arity = params ? params.namedChildren.filter((p) => p.type.endsWith('parameter')).length : 0
      ctorArities.add(arity)
    }
  }
  return { fields, methodNames, ctorArities }
}

async function analyzeJava(source: string, cursor: number): Promise<GenAnalysis | { reason: GenReason }> {
  const parser = await loadJavaParser()
  const tree = parser.parse(source)
  if (!tree) return { reason: 'unsupported' }
  const cls = javaClassAtCursor(tree.rootNode, Math.min(cursor, source.length))
  if (!cls) return { reason: 'noClass' }
  // A class riddled with parse errors gives wrong field/type text — ask the
  // student to fix syntax first rather than generate something malformed.
  if (cls.hasError) return { reason: 'syntaxError' }
  const className = cls.childForFieldName('name')?.text
  const body = cls.childForFieldName('body')
  if (!className || !body) return { reason: 'noClass' }

  const { fields, methodNames, ctorArities } = javaFieldsAndMembers(body)
  const model: JavaModel = {
    lang: 'java',
    source,
    className,
    fields,
    methodNames,
    ctorArities,
    insertIndex: body.endIndex - 1, // just before the closing brace
  }

  const anyGetterMissing = fields.some((f) => !methodNames.has(getterName(f)))
  const anySetterMissing = fields.some((f) => !f.final && !methodNames.has(setterName(f)))
  const options: GenOption[] = [
    // A constructor is always offerable (empty no-arg for a fieldless class);
    // a same-arity duplicate is caught at generate time, not hidden here.
    { kind: 'constructor', available: true },
    { kind: 'getter', available: anyGetterMissing },
    { kind: 'setter', available: anySetterMissing },
    { kind: 'getterSetter', available: anyGetterMissing || anySetterMissing },
    { kind: 'toString', available: !methodNames.has('toString') },
    { kind: 'equalsHashCode', available: !methodNames.has('equals') || !methodNames.has('hashCode') },
  ]
  return { lang: 'java', className, fields, options, model }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The capitalised property stem a getter/setter is named for. A boolean field
 *  already spelled `isReady` contributes `Ready`, not `IsReady`, so it reads
 *  `isReady()`/`setReady()` — JetBrains' convention — instead of `isIsReady()`. */
const propertyStem = (f: GenField) =>
  f.boolean && /^is[A-Z]/.test(f.name) ? f.name.slice(2) : cap(f.name)
const getterName = (f: GenField) => (f.boolean ? 'is' : 'get') + propertyStem(f)
const setterName = (f: GenField) => 'set' + propertyStem(f)

/** `base`, then `base2`, `base3`, … — the first spelling not already taken. */
function uniqueName(base: string, taken: Set<string>): string {
  let name = base
  for (let i = 2; taken.has(name); i++) name = base + i
  return name
}

function buildConstructor(className: string, fields: GenField[]): string {
  const params = fields.map((f) => `${f.type} ${f.name}`).join(', ')
  const body = fields.map((f) => `    this.${f.name} = ${f.name};`).join('\n')
  return `public ${className}(${params}) {\n${body}\n}`
}

function buildGetter(f: GenField): string {
  return `public ${f.type} ${getterName(f)}() {\n    return ${f.name};\n}`
}

function buildSetter(f: GenField): string {
  return `public void ${setterName(f)}(${f.type} ${f.name}) {\n    this.${f.name} = ${f.name};\n}`
}

function buildToString(className: string, fields: GenField[]): string {
  if (fields.length === 0) return `@Override\npublic String toString() {\n    return "${className}{}";\n}`
  const lines = fields.map((f, i) => {
    const sep = i === 0 ? '' : ', '
    if (f.type === 'String') return `        "${sep}${f.name}='" + ${f.name} + '\\''`
    if (f.array) return `        "${sep}${f.name}=" + Arrays.toString(${f.name})`
    return `        "${sep}${f.name}=" + ${f.name}`
  })
  return `@Override\npublic String toString() {\n    return "${className}{" +\n${lines.join(' +\n')} +\n        '}';\n}`
}

function equalityCompare(f: GenField, other: string): string {
  if (f.type === 'double') return `Double.compare(${f.name}, ${other}.${f.name}) == 0`
  if (f.type === 'float') return `Float.compare(${f.name}, ${other}.${f.name}) == 0`
  if (f.primitive) return `${f.name} == ${other}.${f.name}` // int, boolean, char, long, …
  if (f.array) return `Arrays.equals(${f.name}, ${other}.${f.name})`
  return `Objects.equals(${f.name}, ${other}.${f.name})`
}

function buildEquals(className: string, fields: GenField[]): string {
  // Both locals dodge the field names: a field called `o` would otherwise bind
  // to the parameter (`o == c.o`), a field matching the cast var likewise.
  const taken = new Set(fields.map((f) => f.name))
  const param = uniqueName('o', taken)
  taken.add(param)
  const local = uniqueName(className.charAt(0).toLowerCase() + className.slice(1), taken)
  const head =
    `@Override\npublic boolean equals(Object ${param}) {\n` +
    `    if (this == ${param}) return true;\n` +
    `    if (${param} == null || getClass() != ${param}.getClass()) return false;\n`
  if (fields.length === 0) return head + `    return true;\n}`
  const cast = `    ${className} ${local} = (${className}) ${param};\n`
  const comparisons = fields.map((f) => equalityCompare(f, local)).join('\n            && ')
  return head + cast + `    return ${comparisons};\n}`
}

function buildHashCode(fields: GenField[]): string {
  // Objects.hash(...) over every field; arrays go through Arrays.hashCode so the
  // hash stays consistent with the Arrays.equals used in equals().
  const args = fields.map((f) => (f.array ? `Arrays.hashCode(${f.name})` : f.name)).join(', ')
  return `@Override\npublic int hashCode() {\n    return Objects.hash(${args});\n}`
}

/** Builds the raw member text for a Java generator, or null when everything it
 *  would write already exists (duplicate policy: skip, never overwrite). The
 *  second value lists the FQCNs those members lean on, for auto-import. */
function javaMembers(
  model: JavaModel,
  kind: GenerateKind,
  fields: GenField[],
): { members: string[]; imports: string[] } | null {
  const { className, methodNames, ctorArities } = model
  const members: string[] = []
  const imports = new Set<string>()

  switch (kind) {
    case 'constructor': {
      if (ctorArities.has(fields.length)) return null
      members.push(buildConstructor(className, fields))
      break
    }
    case 'getter':
    case 'setter':
    case 'getterSetter': {
      const wantGet = kind !== 'setter'
      const wantSet = kind !== 'getter'
      for (const f of fields) {
        // Per-field getter-then-setter (setter skipped for final), matching the
        // order JetBrains lays "Getter and Setter" out in.
        if (wantGet && !methodNames.has(getterName(f))) members.push(buildGetter(f))
        if (wantSet && !f.final && !methodNames.has(setterName(f))) members.push(buildSetter(f))
      }
      break
    }
    case 'toString': {
      if (methodNames.has('toString')) return null
      members.push(buildToString(className, fields))
      if (fields.some((f) => f.array)) imports.add('java.util.Arrays')
      break
    }
    case 'equalsHashCode': {
      if (!methodNames.has('equals')) members.push(buildEquals(className, fields))
      if (!methodNames.has('hashCode')) members.push(buildHashCode(fields))
      if (members.length === 0) return null
      imports.add('java.util.Objects') // hashCode always leans on Objects.hash
      if (fields.some((f) => f.array)) imports.add('java.util.Arrays')
      break
    }
    default:
      return null
  }

  if (members.length === 0) return null
  return { members, imports: [...imports] }
}

async function generateJava(model: JavaModel, kind: GenerateKind, chosen: GenField[]): Promise<GenResult> {
  const built = javaMembers(model, kind, chosen)
  if (!built) return { status: 'exists' }

  // Splice the members in just before the class body's closing brace; the
  // formatter fixes indentation and blank lines, so rough spacing is fine.
  const block = built.members.join('\n\n')
  let out =
    model.source.slice(0, model.insertIndex) + '\n\n' + block + '\n' + model.source.slice(model.insertIndex)

  // Add each needed import against the current text, one at a time (importInsertion
  // places alphabetically), then let the single format pass tidy everything.
  for (const fqcn of built.imports.sort()) {
    const edit = importInsertion(EditorState.create({ doc: out }), fqcn)
    if (edit) out = out.slice(0, edit.from) + edit.insert + out.slice(edit.to)
  }

  return { status: 'ok', source: await formatJava(out) }
}

/* ============================================= Python / C# (text-heuristic) */

/** Shared model for the parser-less languages: a class found by scanning lines,
 *  its fields, and where new members belong (already-indented, no formatter). */
interface TextModel {
  lang: 'python' | 'csharp'
  source: string
  className: string
  fields: GenField[]
  methodNames: Set<string>
  /** Character offset to splice pre-indented member text into. */
  insertIndex: number
  /** Indentation (spaces) each generated member sits at. */
  indent: string
}

/** A near-neutral field: the parser-less generators only read name and type. */
const textField = (name: string, type: string): GenField => ({
  name,
  type,
  final: false,
  boolean: type === 'bool' || type === 'boolean',
  array: type.endsWith('[]'),
  primitive: false,
})

/** Byte offset where a line (0-based) starts. */
function lineStart(lines: string[], line: number): number {
  let n = 0
  for (let i = 0; i < line; i++) n += lines[i].length + 1
  return n
}

const indentOf = (line: string) => line.match(/^[ \t]*/)?.[0] ?? ''

/* ---- Python: __repr__ and __eq__ from the __init__ self-assignments ------ */

function analyzePython(source: string, cursor: number): GenAnalysis | { reason: GenReason } {
  const lines = source.split('\n')
  const cursorLine = source.slice(0, cursor).split('\n').length - 1

  // Every `class Name…:` header with its indent, best match = the innermost
  // class whose block contains the cursor, else the only class in the file.
  const heads = lines
    .map((text, i) => ({ i, text, m: /^(\s*)class\s+([A-Za-z_]\w*)/.exec(text) }))
    .filter((h) => h.m) as { i: number; text: string; m: RegExpExecArray }[]
  if (heads.length === 0) return { reason: 'noClass' }

  const blockEnd = (start: number, headIndent: string): number => {
    let end = start
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === '') continue
      if (indentOf(lines[i]).length <= headIndent.length) break
      end = i
    }
    return end
  }

  let head = heads.find((h) => cursorLine >= h.i && cursorLine <= blockEnd(h.i, h.m[1]))
  if (!head) head = heads.length === 1 ? heads[0] : undefined
  if (!head) return { reason: 'noClass' }

  const className = head.m[2]
  const headIndent = head.m[1]
  const end = blockEnd(head.i, headIndent)
  const bodyLines = lines.slice(head.i + 1, end + 1)
  const bodyIndent = indentOf(bodyLines.find((l) => l.trim() !== '') ?? '    ') || headIndent + '    '

  // Fields = `self.NAME = …` assignments (declaration order, de-duplicated).
  const seen = new Set<string>()
  const fields: GenField[] = []
  for (const l of bodyLines) {
    const m = /^\s*self\.([A-Za-z_]\w*)\s*=/.exec(l)
    if (m && !m[1].startsWith('_') && !seen.has(m[1])) {
      seen.add(m[1])
      fields.push(textField(m[1], ''))
    }
  }

  // Methods already defined, for duplicate-skipping.
  const methodNames = new Set<string>()
  for (const l of bodyLines) {
    const m = /^\s*def\s+([A-Za-z_]\w*)/.exec(l)
    if (m) methodNames.add(m[1])
  }

  const options: GenOption[] = [
    { kind: 'pyRepr', available: fields.length > 0 && !methodNames.has('__repr__') },
    { kind: 'pyEq', available: fields.length > 0 && !methodNames.has('__eq__') },
  ]

  const model: TextModel = {
    lang: 'python',
    source,
    className,
    fields,
    methodNames,
    insertIndex: lineStart(lines, end) + lines[end].length, // end of the last body line
    indent: bodyIndent,
  }
  return { lang: 'python', className, fields, options, model }
}

function generatePython(model: TextModel, kind: GenerateKind, chosen: GenField[]): GenResult {
  if (kind === 'pyRepr' && model.methodNames.has('__repr__')) return { status: 'exists' }
  if (kind === 'pyEq' && model.methodNames.has('__eq__')) return { status: 'exists' }

  const ind = model.indent
  const body = ind + '    '
  let method: string
  if (kind === 'pyRepr') {
    const parts = chosen.map((f) => `${f.name}={self.${f.name}!r}`).join(', ')
    method = `${ind}def __repr__(self):\n${body}return f"${model.className}(${parts})"`
  } else {
    // __eq__: type-check, then compare the chosen fields as tuples.
    const self = chosen.map((f) => `self.${f.name}`).join(', ')
    const other = chosen.map((f) => `other.${f.name}`).join(', ')
    const tuple = chosen.length === 1 ? `${self} == ${other}` : `(${self}) == (${other})`
    method =
      `${ind}def __eq__(self, other):\n` +
      `${body}if not isinstance(other, ${model.className}):\n` +
      `${body}    return NotImplemented\n` +
      `${body}return ${tuple}`
  }

  const out = model.source.slice(0, model.insertIndex) + '\n\n' + method + model.source.slice(model.insertIndex)
  return { status: 'ok', source: out }
}

/* ---- C#: constructor + auto-properties from `private T name;` fields ------ */

function analyzeCSharp(source: string, cursor: number): GenAnalysis | { reason: GenReason } {
  const head = /(^|\s)(?:class|struct|record)\s+([A-Za-z_]\w*)/g
  // Every class header with the offset of its opening brace and its match.
  const classes: { name: string; brace: number }[] = []
  for (let m = head.exec(source); m; m = head.exec(source)) {
    const brace = source.indexOf('{', m.index)
    if (brace !== -1) classes.push({ name: m[2], brace })
  }
  if (classes.length === 0) return { reason: 'noClass' }

  // Match each `{` to its `}` so we can tell which class holds the cursor.
  const closeOf = (open: number): number => {
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}' && --depth === 0) return i
    }
    return source.length
  }

  let target = classes.find((c) => cursor > c.brace && cursor <= closeOf(c.brace))
  if (!target) target = classes.length === 1 ? classes[0] : undefined
  if (!target) return { reason: 'noClass' }

  const close = closeOf(target.brace)
  const inner = source.slice(target.brace + 1, close)

  // Fields: `private/protected/internal [readonly] T name;` — skip methods/props
  // (lines with `(` or `{`) and anything public (already a property).
  const fieldRe = /(?:private|protected|internal)\s+(?:readonly\s+)?([A-Za-z_][\w.<>,\s]*?[\w>])\s+([A-Za-z_]\w*)\s*;/g
  const fields: GenField[] = []
  for (let m = fieldRe.exec(inner); m; m = fieldRe.exec(inner)) {
    fields.push(textField(m[2], m[1].trim()))
  }
  // Existing property names, so "auto-properties" never re-declares one.
  const methodNames = new Set<string>()
  const propRe = /(?:public|private|protected|internal)\s+[\w.<>,\s]+?\b([A-Za-z_]\w*)\s*\{\s*get/g
  for (let m = propRe.exec(inner); m; m = propRe.exec(inner)) methodNames.add(m[1])

  const bodyIndent = detectCsIndent(source, target.brace)
  const hasCtor = new RegExp(`(?:public|internal)\\s+${target.name}\\s*\\(`).test(inner)
  const options: GenOption[] = [
    { kind: 'csConstructor', available: fields.length > 0 && !hasCtor },
    { kind: 'csProperties', available: fields.some((f) => !methodNames.has(cap(f.name))) },
  ]
  const model: TextModel = {
    lang: 'csharp',
    source,
    className: target.name,
    fields,
    methodNames,
    insertIndex: lineStartOfBrace(source, close),
    indent: bodyIndent,
  }
  return { lang: 'csharp', className: target.name, fields, options, model }
}

/** Indent for members: one step past the class header's own indentation. */
function detectCsIndent(source: string, brace: number): string {
  const lineFrom = source.lastIndexOf('\n', brace) + 1
  const classIndent = indentOf(source.slice(lineFrom))
  return classIndent + '    '
}

/** Offset of the start of the line the closing brace sits on — new members go
 *  on their own lines just above it. */
function lineStartOfBrace(source: string, close: number): number {
  return source.lastIndexOf('\n', close) + 1
}

function generateCSharp(model: TextModel, kind: GenerateKind, chosen: GenField[]): GenResult {
  if (chosen.length === 0) return { status: 'exists' }
  const ind = model.indent
  const inner = ind + '    '
  let block: string
  if (kind === 'csConstructor') {
    const params = chosen.map((f) => `${f.type} ${f.name}`).join(', ')
    const assigns = chosen.map((f) => `${inner}this.${f.name} = ${f.name};`).join('\n')
    block = `${ind}public ${model.className}(${params})\n${ind}{\n${assigns}\n${ind}}`
  } else {
    // Auto-properties: PascalCase the field name (x → X, name → Name); skip any
    // whose property already exists (never overwrite student code).
    const rows = chosen.filter((f) => !model.methodNames.has(cap(f.name)))
    if (rows.length === 0) return { status: 'exists' }
    block = rows.map((f) => `${ind}public ${f.type} ${cap(f.name)} { get; set; }`).join('\n')
  }
  const out = model.source.slice(0, model.insertIndex) + block + '\n' + model.source.slice(model.insertIndex)
  return { status: 'ok', source: out }
}

/* ================================================================ dispatch */

/**
 * Parse (Java) or scan (Python/C#) the file around the cursor. Resolves to an
 * analysis the menu can render, or a `{ reason }` App turns into a quiet notice.
 */
export async function analyzeForGenerate(
  path: string,
  source: string,
  cursor: number,
): Promise<GenAnalysis | { reason: GenReason }> {
  const lang = langForPath(path)
  if (lang === 'java') return analyzeJava(source, cursor)
  if (lang === 'python') return analyzePython(source, cursor)
  if (lang === 'csharp') return analyzeCSharp(source, cursor)
  return { reason: 'unsupported' }
}

/** The fields a given generator can actually act on — setters drop final fields,
 *  so the picker never shows a row that would produce nothing. */
export function eligibleFields(analysis: GenAnalysis, kind: GenerateKind): GenField[] {
  if (kind === 'setter') return analysis.fields.filter((f) => !f.final)
  return analysis.fields
}

/** Whether picking `kind` should raise the checkbox field picker — only when
 *  there is a real choice to make (more than one eligible field). */
export function needsFieldPicker(analysis: GenAnalysis, kind: GenerateKind): boolean {
  return eligibleFields(analysis, kind).length > 1
}

/**
 * Produce the new whole-file source for `kind` over the chosen field names, or
 * `{ status: 'exists' }` when everything it would write is already there. The
 * caller applies the source as one edit; Java is formatted, Python/C# arrive
 * already-indented.
 */
export async function generate(
  analysis: GenAnalysis,
  kind: GenerateKind,
  fieldNames: string[],
): Promise<GenResult> {
  const pick = new Set(fieldNames)
  const chosen = eligibleFields(analysis, kind).filter((f) => pick.has(f.name))
  if (analysis.model.lang === 'java') return generateJava(analysis.model, kind, chosen)
  if (analysis.model.lang === 'python') return generatePython(analysis.model, kind, chosen)
  return generateCSharp(analysis.model, kind, chosen)
}
