import type { CompletionLang } from './completions'
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

export type MemberKind = 'method' | 'field' | 'constant'

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
}

export interface ClassInfo {
  name: string
  kind: 'class' | 'interface' | 'enum' | 'record'
  /** `extends` first, then `implements` (Java) / the bases in order (Python). */
  supers: string[]
  members: MemberInfo[]
  /** Character range of the body in the text it came from — for "which class am I in". */
  bodyFrom: number
  bodyTo: number
}

export type TypeIndex = Map<string, ClassInfo>

/* ------------------------------------------------------------------ shared */

/** Blanks out comments and the inside of string/char literals, keeping every
 *  offset, so brace-matching and regexes never trip over `"{"` or `// }`. */
export function maskJava(src: string): string {
  const out = src.split('')
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' '
    } else if (c === '/' && next === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      if (i < n) out[i] = out[i + 1] = ' '
      i += 2
    } else if (c === '"' && src.startsWith('"""', i)) {
      i += 3
      while (i < n && !src.startsWith('"""', i)) {
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      i += 3
    } else if (c === '"' || c === "'") {
      i++
      while (i < n && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') out[i++] = ' '
        out[i++] = ' '
      }
      i++
    } else i++
  }
  return out.join('')
}

/** Python: comments and string contents blanked, offsets kept. */
export function maskPython(src: string): string {
  const out = src.split('')
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '#') {
      while (i < n && src[i] !== '\n') out[i++] = ' '
    } else if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i)
      const q = triple ? c.repeat(3) : c
      i += q.length
      while (i < n && !src.startsWith(q, i) && (triple || src[i] !== '\n')) {
        if (src[i] === '\\') out[i++] = ' '
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      i += q.length
    } else i++
  }
  return out.join('')
}

/** Index of the bracket closing the one at `open`, or the text's end. */
export function matchBracket(text: string, open: number): number {
  const o = text[open]
  const c = o === '{' ? '}' : o === '(' ? ')' : o === '[' ? ']' : '>'
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++
    else if (text[i] === c && --depth === 0) return i
  }
  return text.length
}

/** Splits on commas that are not inside <>, (), [] — `Map<K, V> m, int x`. */
export function splitTopLevel(s: string, sep = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '<' || c === '(' || c === '[') depth++
    else if (c === '>' || c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

/* -------------------------------------------------------------------- java */

const JAVA_MODIFIERS = /\b(?:public|private|protected|static|final|abstract|default|synchronized|native|transient|volatile|strictfp|sealed|non-sealed)\b/g
const JAVA_TYPE = String.raw`[A-Za-z_$][\w$.]*(?:\s*<[^;{}()]*?>)?(?:\s*\[\s*\])*`

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

function scanJavaInto(src: string, index: TypeIndex): void {
  const text = maskJava(src)
  const head = /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\s*(<[^{]*?>)?\s*(\([^)]*\))?([^{;]*)\{/g
  let m: RegExpExecArray | null
  while ((m = head.exec(text))) {
    const [, kind, name, , recordParams, tail] = m
    const open = m.index + m[0].length - 1
    const close = matchBracket(text, open)
    const supers: string[] = []
    const ext = /\bextends\s+([^{]*?)(?=\bimplements\b|\bpermits\b|$)/.exec(tail)
    const impl = /\bimplements\s+([^{]*?)(?=\bpermits\b|$)/.exec(tail)
    for (const part of [ext?.[1], impl?.[1]]) {
      if (part) for (const s of splitTopLevel(part)) supers.push(s.replace(/<.*$/s, '').trim())
    }
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
    }
    if (kind === 'record' && recordParams) {
      for (const p of splitTopLevel(recordParams.slice(1, -1))) {
        const pm = new RegExp(`^(${JAVA_TYPE})\\s+([A-Za-z_$][\\w$]*)$`).exec(p.trim())
        if (pm) {
          members.push({ name: pm[2], kind: 'method', type: pm[1], params: '', isStatic: false })
        }
      }
    }
    // Each top-level statement ends at `;` or a collapsed `{}` body.
    for (const raw of rest.split(/;|\{\}/)) {
      const stmt = raw.replace(/@[\w.]+(?:\([^)]*\))?/g, ' ').replace(/\s+/g, ' ').trim()
      if (!stmt) continue
      const isStatic = /\bstatic\b/.test(stmt) || kind === 'interface' && !/\(/.test(stmt)
      const plain = stmt.replace(JAVA_MODIFIERS, ' ').replace(/^\s*<[^>]*>\s*/, '').trim()
      const meth = new RegExp(`^(${JAVA_TYPE})\\s+([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)`).exec(plain)
      if (meth) {
        members.push({ name: meth[2], kind: 'method', type: meth[1].replace(/\s+/g, ''), params: meth[3].trim(), isStatic })
        continue
      }
      if (/^[A-Za-z_$][\w$]*\s*\(/.test(plain)) continue // a constructor
      const field = new RegExp(`^(${JAVA_TYPE})\\s+(.+)$`).exec(plain)
      if (field && !/^(?:return|new|throw|else|import|package)\b/.test(field[1])) {
        const type = field[1].replace(/\s+/g, '')
        for (const decl of splitTopLevel(field[2])) {
          const id = /^([A-Za-z_$][\w$]*)\s*(\[\s*\])*\s*(?:=|$)/.exec(decl)
          if (id) {
            const constant = isStatic && /\bfinal\b/.test(stmt)
            members.push({ name: id[1], kind: constant ? 'constant' : 'field', type: type + (id[2] ? '[]' : ''), isStatic })
          }
        }
      }
    }
    index.set(name, { name, kind: kind as ClassInfo['kind'], supers, members, bodyFrom: open, bodyTo: close })
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
  const text = maskPython(src)
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

/* ------------------------------------------------------------------- cache */

export function scanSource(lang: CompletionLang, src: string, index: TypeIndex = new Map()): TypeIndex {
  if (lang === 'java') scanJavaInto(src, index)
  else scanPythonInto(src, index)
  return index
}

let projectCache: { rev: number; java: TypeIndex; python: TypeIndex } | null = null
let docCache: { doc: string; lang: CompletionLang; index: TypeIndex } | null = null

function projectIndex(lang: CompletionLang): TypeIndex {
  const rev = projectRevision()
  if (!projectCache || projectCache.rev !== rev) {
    const java: TypeIndex = new Map()
    const python: TypeIndex = new Map()
    for (const f of projectFiles()) {
      if (f.path.endsWith('.java')) scanJavaInto(f.content, java)
      else if (f.path.endsWith('.py')) scanPythonInto(f.content, python)
    }
    projectCache = { rev, java, python }
  }
  return projectCache[lang]
}

/** Every user type visible from this document: project files, overridden by the open one. */
export function typeIndexFor(lang: CompletionLang, doc: string): TypeIndex {
  if (!docCache || docCache.doc !== doc || docCache.lang !== lang) {
    docCache = { doc, lang, index: scanSource(lang, doc) }
  }
  const merged = new Map(projectIndex(lang))
  for (const [k, v] of docCache.index) merged.set(k, v)
  return merged
}

/** The innermost class whose body contains `pos` in the open document. */
export function enclosingClass(lang: CompletionLang, doc: string, pos: number): ClassInfo | null {
  typeIndexFor(lang, doc)
  let best: ClassInfo | null = null
  for (const c of docCache!.index.values()) {
    if (c.bodyFrom < pos && pos <= c.bodyTo && (!best || c.bodyFrom > best.bodyFrom)) best = c
  }
  return best
}
