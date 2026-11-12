import {
  baseOf,
  isTypeWord,
  maskCode,
  matchBracket,
  modifiersOf,
  splitTopLevel,
  stripNullable,
  typeRe,
  type TextLang,
} from './codeText'
import { projectFiles, projectRevision } from './projectSource'

/**
 * The student's own types, read from the project's source text: every class,
 * interface, enum and record, with its fields, methods, constants and parents.
 *
 * This is what lets `account.` offer `deposit` / `getBalance` / `toString` the
 * way a real IDE does, instead of every word in the file — and what lets a
 * subclass offer what it inherits. It is still a text scan, not a compiler:
 * the bodies of methods are skipped, generics are kept as written, and an
 * unparseable fragment is simply left out. Good enough for course-sized code,
 * which is where it is used.
 *
 * Two inputs, merged with the open file winning: the other project files (via
 * the projectSource seam, cached per project revision) and the document being
 * edited (re-scanned only when that document object changes).
 */

export type MemberKind = 'method' | 'field' | 'constant' | 'class'

export interface MemberInfo {
  name: string
  kind: MemberKind
  /** Return type for a method, declared type for a field; null when unknown. */
  type: string | null
  /** Parameter list as written, without the parentheses (methods only). */
  params?: string
  isStatic: boolean
  /** Python: declared with `@property` — so `@name.setter` can follow it. */
  property?: boolean
  /** Java `private`, Python `__name`: reachable only from inside its own class. */
  isPrivate?: boolean
}

export interface ClassInfo {
  name: string
  /** `module` is a project .py file, reached through `import helper` (its top-level names). */
  kind: 'class' | 'interface' | 'enum' | 'record' | 'module'
  /** `extends` first, then `implements` (Java) / the bases in order (Python). */
  supers: string[]
  members: MemberInfo[]
  /** Character range of the body in the text it came from — for "which class am I in". */
  bodyFrom: number
  bodyTo: number
}

export type TypeIndex = Map<string, ClassInfo>

/* -------------------------------------------------------------- java, c# */

const modifierWords = (lang: 'java' | 'csharp') => new RegExp(`(?<![\\w-])(?:${modifiersOf(lang).join('|')})(?![\\w-])`, 'g')
const MODIFIER_WORDS = { java: modifierWords('java'), csharp: modifierWords('csharp') }

/** The text of a block body at its own depth: nested `{…}` collapsed to `{}`. */
function topLevel(text: string, from: number, to: number): string {
  let out = ''
  for (let i = from; i < to; i++) {
    if (text[i] === '{') {
      const end = matchBracket(text, i)
      out += '{}'
      i = end
    } else out += text[i]
  }
  return out
}

/**
 * Java and C# classes: the same scan, with C#'s spelling where it differs —
 * `class Dog : Animal, IPet` for parents, `struct`, `{ get; set; }` properties
 * (collapsed to `{}` like a method body, so they read as fields), `const` /
 * `static readonly` constants, `[Attributes]`, and positional `record P(int X);`.
 */
function scanJavaInto(src: string, index: TypeIndex, lang: 'java' | 'csharp' = 'java'): void {
  const cs = lang === 'csharp'
  const TYPE = typeRe(lang)
  const clean = (t: string) => (cs ? stripNullable(t) : t.replace(/\s+/g, ''))
  const text = maskCode(lang, src)
  const head = cs
    ? /\b(class|interface|enum|record|struct)\s+([A-Za-z_$][\w$]*)\s*(<[^{;]*?>)?\s*(\([^)]*\))?([^{;]*)\{/g
    : /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\s*(<[^{]*?>)?\s*(\([^)]*\))?([^{;]*)\{/g
  if (cs) {
    // `record Point(int X, int Y);` — no body: its parameters are its properties.
    for (const r of text.matchAll(/\brecord\s+(?:(?:class|struct)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::[^;{]*)?;/g)) {
      const members: MemberInfo[] = []
      for (const p of splitTopLevel(r[2])) {
        const pm = new RegExp(`^(${TYPE})\\s+([A-Za-z_$][\\w$]*)$`).exec(p.trim())
        if (pm) members.push({ name: pm[2], kind: 'field', type: stripNullable(pm[1]), isStatic: false })
      }
      index.set(r[1], { name: r[1], kind: 'record', supers: [], members, bodyFrom: r.index!, bodyTo: r.index! + r[0].length })
    }
  }
  let m: RegExpExecArray | null
  while ((m = head.exec(text))) {
    const [, rawKind, name, , recordParams, tail] = m
    const kind = rawKind === 'struct' ? 'class' : rawKind
    const open = m.index + m[0].length - 1
    const close = matchBracket(text, open)
    const supers: string[] = []
    if (cs) {
      // `class Dog : Animal, IPet where T : …` — the base class (if any) first, as written.
      const colon = /^\s*:\s*([^{]*?)(?=\bwhere\b|$)/.exec(tail)
      if (colon) for (const s of splitTopLevel(colon[1])) supers.push(baseOf(s))
    }
    const ext = cs ? null : /\bextends\s+([^{]*?)(?=\bimplements\b|\bpermits\b|$)/.exec(tail)
    const impl = cs ? null : /\bimplements\s+([^{]*?)(?=\bpermits\b|$)/.exec(tail)
    for (const part of [ext?.[1], impl?.[1]]) {
      if (part) for (const s of splitTopLevel(part)) supers.push(baseOf(s))
    }
    // An enum is-a java.lang.Enum (name(), ordinal()…); `values`/`valueOf` are its synthetic statics.
    if (kind === 'enum' && !cs) supers.unshift('Enum')
    const members: MemberInfo[] = []
    const body = topLevel(text, open + 1, close)
    let rest = body
    if (kind === 'enum') {
      // Constants come first, up to the first `;` (or the end of the body).
      const semi = body.indexOf(';')
      const consts = semi === -1 ? body : body.slice(0, semi)
      for (const c of splitTopLevel(consts.replace(/\{\}/g, ''))) {
        const id = /^([A-Za-z_$][\w$]*)/.exec(c)
        if (id) members.push({ name: id[1], kind: 'constant', type: name, isStatic: true })
      }
      rest = semi === -1 ? '' : body.slice(semi + 1)
      if (!cs) members.push(
        { name: 'values', kind: 'method', type: `${name}[]`, params: '', isStatic: true },
        { name: 'valueOf', kind: 'method', type: name, params: 'String name', isStatic: true },
      )
    }
    if (kind === 'record' && recordParams) {
      for (const p of splitTopLevel(recordParams.slice(1, -1))) {
        const pm = new RegExp(`^(${TYPE})\\s+([A-Za-z_$][\\w$]*)$`).exec(p.trim())
        if (pm) {
          // Java's record components are accessor methods (`p.x()`); C#'s are properties (`p.X`).
          if (cs) members.push({ name: pm[2], kind: 'field', type: stripNullable(pm[1]), isStatic: false })
          else members.push({ name: pm[2], kind: 'method', type: pm[1], params: '', isStatic: false })
        }
      }
    }
    // Each top-level statement ends at `;` or a collapsed `{}` body.
    for (const raw of rest.split(/;|\{\}/)) {
      let stmt = raw.replace(/@[\w.]+(?:\([^)]*\))?/g, ' ').replace(/\s+/g, ' ').trim()
      if (cs) stmt = stmt.replace(/^(?:\[[^\]]*\]\s*)+/, '') // `[Obsolete] public void X()`
      // A nested class/interface/enum is its own entry (the head regex finds it), not a field.
      if (!stmt || (cs ? /\b(?:class|interface|enum|record|struct)\s+[A-Za-z_$]/ : /\b(?:class|interface|enum|record)\s+[A-Za-z_$]/).test(stmt)) continue
      const isStatic = cs ? /\b(?:static|const)\b/.test(stmt) : /\bstatic\b/.test(stmt) || kind === 'interface' && !/\(/.test(stmt)
      const isPrivate = /\bprivate\b/.test(stmt)
      const plain = stmt.replace(MODIFIER_WORDS[lang], ' ').replace(/^\s*<[^>]*>\s*/, '').trim()
      const meth = new RegExp(`^(${TYPE})\\s+([A-Za-z_$][\\w$]*)\\s*(?:<[^>()]*>\\s*)?\\(([^)]*)\\)`).exec(plain)
      if (meth && (meth[1] === 'void' || isTypeWord(lang, meth[1]))) {
        members.push({ name: meth[2], kind: 'method', type: clean(meth[1]), params: meth[3].trim(), isStatic, isPrivate })
        continue
      }
      if (/^[A-Za-z_$][\w$]*\s*\(/.test(plain)) continue // a constructor
      const field = new RegExp(`^(${TYPE})\\s+(.+)$`).exec(plain)
      if (field && isTypeWord(lang, field[1])) {
        const type = clean(field[1])
        for (const decl of splitTopLevel(field[2])) {
          const id = /^([A-Za-z_$][\w$]*)\s*(\[\s*\])*\s*(?:=|$)/.exec(decl)
          if (id) {
            const constant = cs ? /\bconst\b/.test(stmt) || (isStatic && /\breadonly\b/.test(stmt)) : isStatic && /\bfinal\b/.test(stmt)
            members.push({ name: id[1], kind: constant ? 'constant' : 'field', type: type + (id[2] ? '[]' : ''), isStatic, isPrivate })
          }
        }
      }
    }
    index.set(name, { name, kind: kind as ClassInfo['kind'], supers, members, bodyFrom: open, bodyTo: close })
  }
}

/* ----------------------------------------------------------------------- c */

/**
 * C structs: `struct Point { int x, y; };`, `typedef struct [Tag] { … } Point;` —
 * each filed under its tag and its typedef name. Fields keep the type as written
 * (`char[50]`, `struct Node *`) for display; codeText's cTypeKey reads them when a chain goes on.
 */
function scanCInto(src: string, index: TypeIndex): void {
  const text = maskCode('c', src)
  for (const m of text.matchAll(/\b(typedef\s+)?(?:struct|union)\s+([A-Za-z_]\w*)?\s*\{/g)) {
    const open = m.index! + m[0].length - 1
    const close = matchBracket(text, open)
    const members: MemberInfo[] = []
    for (const raw of topLevel(text, open + 1, close).split(';')) {
      const stmt = raw.replace(/\s+/g, ' ').trim()
      // `int x, y` / `char name[50]` / `struct Node *next` — the type, then the declarators.
      const fm = /^((?:(?:const|unsigned|signed|long|short|volatile)\s+)*(?:(?:struct|union|enum)\s+)?[A-Za-z_]\w*)\s*(.+)$/.exec(stmt)
      if (!fm || /\(/.test(fm[2])) continue
      for (const decl of splitTopLevel(fm[2])) {
        const dm = /^(\**)\s*([A-Za-z_]\w*)\s*((?:\[[^\]]*\])*)/.exec(decl)
        if (dm) members.push({ name: dm[2], kind: 'field', type: `${fm[1]}${dm[1] ? ' ' + dm[1] : ''}${dm[3]}`, isStatic: false })
      }
    }
    const info = (name: string): ClassInfo => ({ name, kind: 'class', supers: [], members, bodyFrom: open, bodyTo: close })
    if (m[2]) index.set(m[2], info(m[2]))
    const alias = m[1] ? /^\s*([A-Za-z_]\w*)\s*;/.exec(text.slice(close + 1, close + 200))?.[1] : undefined
    if (alias) index.set(alias, info(alias))
  }
  // `typedef struct Point Point;` — a second name for a struct declared elsewhere.
  for (const m of text.matchAll(/\btypedef\s+(?:struct|union)\s+([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*;/g)) {
    const tagged = index.get(m[1])
    if (tagged) index.set(m[2], { ...tagged, name: m[2] })
  }
}

/* ------------------------------------------------------------------ python */

const indentOf = (line: string) => line.length - line.trimStart().length

/** Rough type of a Python right-hand side, as text: literals and `Name(...)` calls. */
export function pythonLiteralType(rhs: string): string | null {
  const r = rhs.trim()
  if (/^(?:[rRuU]|[fF][rR]?|[rR][fF])?["']/.test(r)) return 'str'
  if (/^[bB][rR]?["']/.test(r)) return 'bytes'
  if (r.startsWith('[')) return 'list'
  if (r.startsWith('{')) return r === '{}' || /:/.test(r) ? 'dict' : 'set'
  if (r.startsWith('(')) return /,/.test(r) ? 'tuple' : null
  if (/^-?\d+$/.test(r)) return 'int'
  if (/^-?\d*\.\d+(?:e-?\d+)?$/i.test(r)) return 'float'
  if (r === 'True' || r === 'False') return 'bool'
  const call = /^([A-Za-z_][\w.]*)\s*\(/.exec(r)
  return call ? `${call[1]}()` : null
}

function scanPythonInto(src: string, index: TypeIndex): void {
  const text = maskCode('python', src)
  const lines = text.split('\n')
  const offsets: number[] = []
  let off = 0
  for (const l of lines) {
    offsets.push(off)
    off += l.length + 1
  }
  for (let i = 0; i < lines.length; i++) {
    const cm = /^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/.exec(lines[i])
    if (!cm) continue
    const base = cm[1].length
    const name = cm[2]
    const supers = (cm[3] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.includes('=') && s !== 'object')
    let end = i + 1
    while (end < lines.length && (lines[end].trim() === '' || indentOf(lines[end]) > base)) end++
    const members = new Map<string, MemberInfo>()
    const add = (mi: MemberInfo) => {
      // `__balance` is name-mangled: private to the class (dunders like `__init__` are not).
      if (mi.name.startsWith('__') && !mi.name.endsWith('__')) mi.isPrivate = true
      if (!members.has(mi.name)) members.set(mi.name, mi)
    }
    let bodyIndent = -1
    let pendingDecorators: string[] = []
    for (let j = i + 1; j < end; j++) {
      const l = lines[j]
      if (!l.trim()) continue
      const ind = indentOf(l)
      if (bodyIndent === -1) bodyIndent = ind
      if (ind === bodyIndent) {
        const deco = /^\s*@([\w.]+)/.exec(l)
        if (deco) {
          pendingDecorators.push(deco[1])
          continue
        }
        const def = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/.exec(l)
        if (def) {
          const isProp = pendingDecorators.includes('property')
          const isSetter = pendingDecorators.some((d) => d.endsWith('.setter') || d.endsWith('.deleter'))
          const isStatic = pendingDecorators.includes('staticmethod') || pendingDecorators.includes('classmethod')
          if (!isSetter) {
            add({
              name: def[1],
              kind: isProp ? 'field' : 'method',
              type: def[3]?.trim() ?? null,
              params: def[2].split(',').map((p) => p.trim()).filter((p) => p && p !== 'self' && p !== 'cls').join(', '),
              isStatic,
              property: isProp,
            })
          }
          pendingDecorators = []
          continue
        }
        pendingDecorators = []
        const attr = /^\s*([A-Za-z_]\w*)\s*(?::\s*([^=]+))?=(?!=)\s*(.*)$/.exec(l)
        if (attr) add({ name: attr[1], kind: 'field', type: attr[2]?.trim() ?? pythonLiteralType(attr[3]), isStatic: true })
      }
      // `self.x = …` anywhere inside the class's methods.
      for (const sa of l.matchAll(/\bself\.([A-Za-z_]\w*)\s*(?::\s*([^=]+))?=(?!=)\s*([^\n]*)/g)) {
        add({ name: sa[1], kind: 'field', type: sa[2]?.trim() ?? pythonLiteralType(sa[3]), isStatic: false })
      }
    }
    index.set(name, {
      name,
      kind: 'class',
      supers,
      members: [...members.values()],
      bodyFrom: offsets[i],
      bodyTo: end < lines.length ? offsets[end] : text.length,
    })
  }
}

/** A project .py file as a module: its top-level functions, classes and assignments. */
function scanPythonModule(path: string, src: string, index: TypeIndex): void {
  const name = path.replace(/^.*\//, '').replace(/\.py$/, '')
  if (!/^[A-Za-z_]\w*$/.test(name) || index.has(name)) return
  const text = maskCode('python', src)
  const members: MemberInfo[] = []
  const seen = new Set<string>()
  const add = (m: MemberInfo) => {
    if (!seen.has(m.name)) seen.add(m.name), members.push(m)
  }
  for (const m of text.matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/gm))
    add({ name: m[1], kind: 'method', type: m[3]?.trim() ?? null, params: m[2].trim(), isStatic: true })
  for (const m of text.matchAll(/^class\s+([A-Za-z_]\w*)/gm)) add({ name: m[1], kind: 'class', type: m[1], isStatic: true })
  for (const m of text.matchAll(/^([A-Za-z_]\w*)\s*=(?!=)\s*([^\n]*)$/gm))
    add({ name: m[1], kind: 'field', type: pythonLiteralType(m[2]), isStatic: true })
  index.set(name, { name, kind: 'module', supers: [], members, bodyFrom: 0, bodyTo: 0 })
}

/* ------------------------------------------------------------------- cache */

const scanInto = (lang: TextLang, src: string, index: TypeIndex) =>
  lang === 'python' ? scanPythonInto(src, index) : lang === 'c' ? scanCInto(src, index) : scanJavaInto(src, index, lang)

/** Which project files feed each language's index. */
const PROJECT_FILES: Record<TextLang, RegExp> = { java: /\.java$/, python: /\.py$/, csharp: /\.cs$/, c: /\.[ch]$/ }

let projectCache: { rev: number; byLang: Record<TextLang, TypeIndex> } | null = null
let docCache: { doc: string; lang: TextLang; index: TypeIndex } | null = null
let mergedCache: { doc: string; lang: TextLang; rev: number; index: TypeIndex } | null = null

function projectIndex(lang: TextLang): TypeIndex {
  const rev = projectRevision()
  if (!projectCache || projectCache.rev !== rev) {
    const byLang: Record<TextLang, TypeIndex> = { java: new Map(), python: new Map(), csharp: new Map(), c: new Map() }
    const langs = Object.keys(PROJECT_FILES) as TextLang[]
    for (const f of projectFiles()) {
      const l = langs.find((k) => PROJECT_FILES[k].test(f.path))
      if (l) scanInto(l, f.content, byLang[l])
    }
    // Modules after classes, so a class never loses its name to a same-named file.
    for (const f of projectFiles()) if (f.path.endsWith('.py')) scanPythonModule(f.path, f.content, byLang.python)
    projectCache = { rev, byLang }
  }
  return projectCache.byLang[lang]
}

/** The classes of the open document alone (re-scanned only when it changes). */
function docIndex(lang: TextLang, doc: string): TypeIndex {
  if (!docCache || docCache.doc !== doc || docCache.lang !== lang) {
    const index: TypeIndex = new Map()
    scanInto(lang, doc, index)
    docCache = { doc, lang, index }
  }
  return docCache.index
}

/** Every user type visible from this document: project files, overridden by the open one. */
export function typeIndexFor(lang: TextLang, doc: string): TypeIndex {
  const rev = projectRevision()
  if (!mergedCache || mergedCache.doc !== doc || mergedCache.lang !== lang || mergedCache.rev !== rev) {
    const merged = new Map(projectIndex(lang))
    for (const [k, v] of docIndex(lang, doc)) merged.set(k, v)
    mergedCache = { doc, lang, rev, index: merged }
  }
  return mergedCache.index
}

/** The innermost class whose body contains `pos` in the open document. */
export function enclosingClass(lang: TextLang, doc: string, pos: number): ClassInfo | null {
  let best: ClassInfo | null = null
  for (const c of docIndex(lang, doc).values()) {
    if (c.bodyFrom < pos && pos <= c.bodyTo && (!best || c.bodyFrom > best.bodyFrom)) best = c
  }
  return best
}
