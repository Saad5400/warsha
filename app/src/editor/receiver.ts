import type { CompletionLang } from './completions'
import { enclosingClass, maskJava, maskPython, matchBracket, pythonLiteralType, splitTopLevel, typeIndexFor, type TypeIndex } from './typeIndex'

/**
 * "What type is the thing before this dot?" — read from the text, the way a
 * student's code is actually written:
 *
 *   arr.length            a local array            (`int[] arr = …`)
 *   s.charAt(0)           a parameter              (`static int f(String s)`)
 *   e.getMessage()        a catch variable         (`catch (IOException e)`)
 *   this.radius / super.  the enclosing class / its parent
 *   sc.next().charAt(0)   a chain — each call's return type feeds the next
 *   names.get(0).length() generics — `ArrayList<String>` makes `get` a String
 *   ((Dog) a).bark()      a cast
 *   "text".length()       a literal
 *   self.speed            Python: the enclosing class, attributes included
 *   with open(p) as f     Python: f is a file
 *   line.split()[0].      Python: element types of what a method returns
 *
 * The receiver expression is parsed backwards from the dot into segments
 * (`name`, `call`, `index`, literal…), its base is looked up (local declaration
 * nearest before the caret, then a field of the enclosing class, then a class
 * name for static access), and each later segment is stepped through the member
 * tables' declared return types. Anything it cannot follow returns null, and
 * the caller falls back to plain words — never a wrong type on purpose.
 */

/* ------------------------------------------------------------- the pieces */

export type Segment =
  | { k: 'name'; name: string }
  | { k: 'call'; name: string; args: string }
  | { k: 'index' }
  | { k: 'string' }
  | { k: 'char' }
  | { k: 'number'; float: boolean }
  | { k: 'new'; type: string }
  | { k: 'paren'; inner: string }
  | { k: 'list' }
  | { k: 'brace'; inner: string }

export interface Resolved {
  /** e.g. `ArrayList<String>`, `int[]`, `str`, `list[str]`, `numpy` (a module). */
  type: string
  /** Reached through the class name itself (`Math.`, `Day.`) rather than a value. */
  isStatic: boolean
}

/** What a type-reading member table needs to answer for the resolver. */
export interface MemberTypes {
  /** Return type of `member` on `type` (already substituted), or undefined if unknown. */
  memberType(lang: CompletionLang, type: Resolved, member: string, call: boolean, index: TypeIndex): string | null | undefined
  /** Is this a type name we know (JDK table, module, user class)? */
  isKnownType(lang: CompletionLang, name: string, index: TypeIndex): boolean
  /** Python: the type a builtin/imported callable returns when called bare (`input()`, `Counter()`). */
  callResult(lang: CompletionLang, name: string, index: TypeIndex): string | null
}

const IDENT_CHAR = /[\w$]/

/**
 * Parse the receiver chain that ends just before `end` (the dot). Returns the
 * segments left-to-right and where the expression starts, or null when what
 * precedes the dot is not an expression (a number like `3.`, an operator…).
 */
export function parseChain(text: string, end: number): { segs: Segment[]; from: number } | null {
  const segs: Segment[] = []
  let i = end
  for (;;) {
    const c = text[i - 1]
    if (c === undefined) return null
    let seg: Segment
    if (c === ')') {
      const open = matchBack(text, i - 1)
      if (open < 0) return null
      const inner = text.slice(open + 1, i - 1)
      let j = open
      // `new ArrayList<>()` / `new HashMap<String, Integer>()` — step over the type arguments.
      let generic = ''
      if (text[j - 1] === '>') {
        let depth = 0
        let k = j - 1
        for (; k >= 0; k--) {
          if (text[k] === '>') depth++
          else if (text[k] === '<' && --depth === 0) break
        }
        if (k > 0 && IDENT_CHAR.test(text[k - 1])) {
          generic = text.slice(k, j)
          j = k
        }
      }
      const nameEnd = j
      while (j > 0 && IDENT_CHAR.test(text[j - 1])) j--
      if (j < nameEnd) {
        const name = text.slice(j, nameEnd)
        const before = text.slice(Math.max(0, j - 8), j)
        if (/\bnew\s+$/.test(before)) {
          seg = { k: 'new', type: name + (generic === '<>' ? '' : generic) }
          j = j - (before.length - before.search(/new\s+$/))
          segs.unshift(seg)
          return { segs, from: j }
        }
        seg = { k: 'call', name, args: inner }
        i = j
      } else {
        seg = { k: 'paren', inner }
        i = open
        segs.unshift(seg)
        return { segs, from: i }
      }
    } else if (c === ']') {
      const open = matchBack(text, i - 1)
      if (open < 0) return null
      i = open
      // `[1, 2]` with nothing indexable before it is a list literal.
      const prev = text[i - 1]
      if (prev === undefined || !/[\w$)\]"'}]/.test(prev)) {
        segs.unshift({ k: 'list' })
        return { segs, from: i }
      }
      // An index binds to whatever precedes it directly (`arr[0]`, `m[0][1]`), no dot between.
      segs.unshift({ k: 'index' })
      continue
    } else if (c === '}') {
      const open = matchBack(text, i - 1)
      if (open < 0) return null
      segs.unshift({ k: 'brace', inner: text.slice(open + 1, i - 1) })
      return { segs, from: open }
    } else if (c === '"' || c === "'") {
      let j = i - 2
      while (j >= 0 && !(text[j] === c && text[j - 1] !== '\\')) {
        if (text[j] === '\n') return null
        j--
      }
      if (j < 0) return null
      while (j > 0 && /[rRbBfFuU]/.test(text[j - 1]) && !IDENT_CHAR.test(text[j - 2] ?? ' ')) j--
      const lit = text.slice(j, i)
      segs.unshift(c === "'" && /^'(?:\\.|[^\\'])'$/.test(lit) ? { k: 'char' } : { k: 'string' })
      return { segs, from: j }
    } else if (IDENT_CHAR.test(c)) {
      let j = i - 1
      while (j > 0 && IDENT_CHAR.test(text[j - 1])) j--
      const name = text.slice(j, i)
      if (/^\d/.test(name)) {
        // `3.` is a decimal point, not a member access; `1.5.` never happens.
        return null
      }
      // `new int[5].length`, `new String[n]` — the index segments belong to `new`.
      const before = text.slice(Math.max(0, j - 8), j)
      if (segs.length && segs[0].k === 'index' && /\bnew\s+$/.test(before)) {
        let dims = 0
        while (segs.length && segs[0].k === 'index') {
          segs.shift()
          dims++
        }
        segs.unshift({ k: 'new', type: name + '[]'.repeat(dims) })
        return { segs, from: j - (before.length - before.search(/new\s+$/)) }
      }
      seg = { k: 'name', name }
      i = j
    } else {
      return null
    }
    segs.unshift(seg)
    // Continue only across another dot; anything else ends the expression.
    if (text[i - 1] === '.') {
      i--
      continue
    }
    return { segs, from: i }
  }
}

/** Index of the bracket opening the one closing at `close`, or -1. */
function matchBack(text: string, close: number): number {
  const c = text[close]
  const o = c === ')' ? '(' : c === ']' ? '[' : '{'
  let depth = 0
  for (let i = close; i >= 0; i--) {
    if (text[i] === c) depth++
    else if (text[i] === o && --depth === 0) return i
  }
  return -1
}

/* ------------------------------------------------------------------ types */

const JAVA_PRIMS = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char'])
const JAVA_TYPE = String.raw`(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:\s*<(?:[^<>;{}()]|<[^<>;{}()]*>)*>)?(?:\s*\[\s*\])*`
const NOT_A_TYPE = new Set(['return', 'new', 'throw', 'else', 'case', 'package', 'import', 'yield', 'goto', 'assert', 'instanceof'])

export const baseOf = (t: string) => t.replace(/\s+/g, '').replace(/<.*$/s, '').replace(/(\[\])+$/, '')
export const typeArgs = (t: string): string[] => {
  const lt = t.indexOf('<')
  if (lt === -1) return []
  return splitTopLevel(t.slice(lt + 1, t.lastIndexOf('>')))
}
const isArray = (t: string) => /\[\]$/.test(t.replace(/\s+/g, ''))
const elementOfArray = (t: string) => t.replace(/\s+/g, '').replace(/\[\]$/, '')

/** The declared type of `name` as seen at `pos` in masked Java: nearest declaration before it. */
function javaLocalType(masked: string, name: string, pos: number): string | null {
  const before = masked.slice(0, pos)
  const esc = name.replace(/\$/g, '\\$')
  let found: { at: number; type: string } | null = null
  const note = (at: number, type: string) => {
    if (!found || at > found.at) found = { at, type }
  }
  // `Type name =|;|,|)|:|[` — locals, fields, parameters, for-each, pattern variables.
  const decl = new RegExp(`(?:^|[^\\w$.])(${JAVA_TYPE})\\s+${esc}\\s*(?=[=;,):]|\\[)`, 'g')
  for (const m of before.matchAll(decl)) {
    const t = m[1].replace(/\s+/g, '')
    if (NOT_A_TYPE.has(t)) continue
    if (t === 'var') {
      const rhsStart = m.index! + m[0].length
      const eq = before.indexOf('=', rhsStart)
      if (eq === -1) continue
      let end = before.indexOf(';', eq)
      if (end === -1) end = before.length
      note(m.index!, `=${before.slice(eq + 1, end).trim()}`)
      continue
    }
    note(m.index!, t)
  }
  // `catch (A | B name)` — the first alternative stands for the variable.
  for (const m of before.matchAll(new RegExp(`\\bcatch\\s*\\(\\s*(?:final\\s+)?([\\w$.]+)(?:\\s*\\|\\s*[\\w$.]+)*\\s+${esc}\\s*\\)`, 'g'))) {
    note(m.index!, m[1])
  }
  return found ? (found as { type: string }).type : null
}

/** The type of `name` in Python as seen at `pos`: the nearest binding before it. */
function pythonLocalType(masked: string, raw: string, name: string, pos: number): string | null {
  const before = masked.slice(0, pos)
  const rawBefore = raw.slice(0, pos)
  let found: { at: number; type: string } | null = null
  const note = (at: number, type: string | null) => {
    if (type && (!found || at > found.at)) found = { at, type }
  }
  // `name = rhs` (also `name: T = rhs`); the rhs is evaluated as an expression.
  for (const m of before.matchAll(new RegExp(`^[ \\t]*${name}\\s*(?::\\s*([^=\\n]+))?=(?!=)[ \\t]*([^\\n]*)$`, 'gm'))) {
    const at = m.index!
    if (m[1]) note(at, m[1].trim())
    else note(at, `=${rawBefore.slice(at + m[0].length - m[2].length, at + m[0].length).trim()}`)
  }
  // `for name in expr:`
  for (const m of before.matchAll(new RegExp(`\\bfor\\s+${name}\\s+in\\s+([^\\n]+?):[ \\t]*$`, 'gm'))) {
    const at = m.index! + m[0].lastIndexOf(m[1])
    note(m.index!, `∈${rawBefore.slice(at, at + m[1].length)}`)
  }
  // `with expr as name:`
  for (const m of before.matchAll(new RegExp(`\\bwith\\s+(.+?)\\s+as\\s+${name}\\b`, 'g'))) {
    note(m.index!, `=${rawBefore.slice(m.index! + m[0].indexOf(m[1]), m.index! + m[0].indexOf(m[1]) + m[1].length)}`)
  }
  // `def f(name: T)` / `except E as name`
  for (const m of before.matchAll(new RegExp(`[(,]\\s*${name}\\s*:\\s*([A-Za-z_][\\w.\\[\\], ]*?)\\s*(?=[,)=])`, 'g'))) note(m.index!, m[1].trim())
  for (const m of before.matchAll(new RegExp(`\\bexcept\\s+\\(?\\s*([A-Za-z_][\\w.]*)[^:\\n]*?\\s+as\\s+${name}\\b`, 'g'))) note(m.index!, m[1])
  // `import numpy as np`, `import os`, `from x import y [as z]`
  for (const m of before.matchAll(new RegExp(`^\\s*import\\s+([\\w.]+)\\s+as\\s+${name}\\b`, 'gm'))) note(m.index!, `module:${m[1]}`)
  for (const m of before.matchAll(/^\s*import\s+([\w.,\s]+)$/gm)) {
    for (const mod of m[1].split(',')) if (mod.trim() === name) note(m.index!, `module:${name}`)
  }
  for (const m of before.matchAll(/^\s*from\s+([\w.]+)\s+import\s+([^\n]+)$/gm)) {
    for (const part of m[2].replace(/[()]/g, '').split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/)
      if ((alias ?? orig) === name) note(m.index!, `from:${m[1]}.${orig}`)
    }
  }
  return found ? (found as { type: string }).type : null
}

/* -------------------------------------------------------------- evaluate */

export interface ResolveContext {
  lang: CompletionLang
  raw: string
  masked: string
  /** Where the expression starts — declarations are looked up before this. */
  at: number
  index: TypeIndex
  table: MemberTypes
  depth: number
}

/** Type of a whole expression given as text (a `var x = …` rhs, a Python rhs). */
function evalText(ctx: ResolveContext, expr: string): Resolved | null {
  const e = expr.trim().replace(/;$/, '')
  if (!e || ctx.depth > 6) return null
  if (ctx.lang === 'java') {
    if (/^-?\d+[lL]?$/.test(e)) return { type: /[lL]$/.test(e) ? 'long' : 'int', isStatic: false }
    if (/^-?\d*\.\d+[dDfF]?$/.test(e)) return { type: /[fF]$/.test(e) ? 'float' : 'double', isStatic: false }
    if (e === 'true' || e === 'false') return { type: 'boolean', isStatic: false }
  } else {
    const lit = pythonLiteralType(e)
    if (lit && !lit.endsWith('()')) {
      if (lit === 'list') return { type: listOfLiteral(e), isStatic: false }
      return { type: lit, isStatic: false }
    }
  }
  const parsed = parseChain(e, e.length)
  if (!parsed || parsed.from !== 0) return null
  return evaluate({ ...ctx, raw: e, masked: ctx.lang === 'java' ? maskJava(e) : maskPython(e), at: 0, depth: ctx.depth + 1 }, parsed.segs, ctx)
}

/** `["a", "b"]` → `list[str]`; anything less obvious stays `list`. */
function listOfLiteral(e: string): string {
  const inner = e.slice(1, matchBracket(e, 0))
  const first = splitTopLevel(inner)[0]
  const t = first ? pythonLiteralType(first) : null
  return t && !t.endsWith('()') ? `list[${t}]` : 'list'
}

/** Element type when iterating a value of type `t` (Python `for x in t`). */
function pyElement(t: string): string | null {
  const m = /^(?:list|set|tuple|frozenset|deque)\[(.+)\]$/.exec(t)
  if (m) return m[1]
  if (t === 'str') return 'str'
  if (t === 'range') return 'int'
  if (t === 'file' || t === 'StringIO') return 'str'
  if (/^dict\[(.+?),/.test(t)) return /^dict\[(.+?),/.exec(t)![1]
  if (t === 'csv.reader') return 'list[str]'
  if (t === 'csv.DictReader') return 'dict'
  return null
}

function evaluate(ctx: ResolveContext, segs: Segment[], outer?: ResolveContext): Resolved | null {
  // Declarations are looked up in the outer document, at the outer position.
  const scope = outer ?? ctx
  let cur = base(scope, segs[0])
  for (let i = 1; i < segs.length && cur; i++) cur = step(scope, cur, segs[i])
  return cur
}

function base(scope: ResolveContext, seg: Segment): Resolved | null {
  const { lang, index, table } = scope
  const val = (type: string | null): Resolved | null => (type ? { type, isStatic: false } : null)
  switch (seg.k) {
    case 'string':
      return val(lang === 'java' ? 'String' : 'str')
    case 'char':
      return val(lang === 'java' ? 'char' : 'str')
    case 'number':
      return val(seg.float ? (lang === 'java' ? 'double' : 'float') : 'int')
    case 'list':
      return val('list')
    case 'brace':
      return val(lang === 'python' ? (seg.inner.trim() === '' || /:/.test(seg.inner) ? 'dict' : 'set') : null)
    case 'new':
      return val(seg.type)
    case 'paren': {
      const cast = new RegExp(`^\\s*\\(\\s*(${JAVA_TYPE})\\s*\\)`).exec(seg.inner)
      if (lang === 'java' && cast) return val(cast[1].replace(/\s+/g, ''))
      return evalText({ ...scope }, seg.inner)
    }
    case 'index':
      return null
    case 'call': {
      if (lang === 'python' && seg.name === 'super') {
        const cls = enclosingClass(lang, scope.raw, scope.at)
        return cls?.supers[0] ? val(cls.supers[0]) : null
      }
      // A bare call: a method of the enclosing class, a class (Python), or a builtin.
      const cls = enclosingClass(lang, scope.raw, scope.at)
      if (cls) {
        const t = table.memberType(lang, { type: cls.name, isStatic: false }, seg.name, true, index)
        if (t) return val(t)
      }
      if (lang === 'python') {
        if (index.has(seg.name)) return val(seg.name)
        const local = pythonLocalType(scope.masked, scope.raw, seg.name, scope.at)
        if (local?.startsWith('from:')) {
          const r = table.callResult(lang, local.slice(5), index)
          if (r) return val(r)
          return val(local.slice(5).split('.').pop()!)
        }
        return val(table.callResult(lang, seg.name, index))
      }
      return null
    }
    case 'name': {
      const name = seg.name
      if (lang === 'java') {
        if (name === 'this') {
          const cls = enclosingClass(lang, scope.raw, scope.at)
          return cls ? val(cls.name) : null
        }
        if (name === 'super') {
          const cls = enclosingClass(lang, scope.raw, scope.at)
          return cls?.supers[0] ? val(cls.supers[0]) : null
        }
        const local = javaLocalType(scope.masked, name, scope.at)
        if (local) return local.startsWith('=') ? evalText(scope, local.slice(1)) : val(local)
        // A field of the enclosing class (or one it inherits).
        const cls = enclosingClass(lang, scope.raw, scope.at)
        if (cls) {
          const t = table.memberType(lang, { type: cls.name, isStatic: false }, name, false, index)
          if (t) return val(t)
        }
        if (/^[A-Z]/.test(name) && table.isKnownType(lang, name, index)) return { type: name, isStatic: true }
        return null
      }
      if (name === 'self' || name === 'cls') {
        const cls = enclosingClass(lang, scope.raw, scope.at)
        return cls ? { type: cls.name, isStatic: name === 'cls' } : null
      }
      const local = pythonLocalType(scope.masked, scope.raw, name, scope.at)
      if (local) {
        if (local.startsWith('module:')) return { type: local.slice(7), isStatic: true }
        if (local.startsWith('from:')) {
          const qual = local.slice(5)
          const last = qual.split('.').pop()!
          return table.isKnownType(lang, qual, index)
            ? { type: qual, isStatic: true }
            : table.isKnownType(lang, last, index)
              ? { type: last, isStatic: true }
              : null
        }
        if (local.startsWith('=')) return evalText(scope, local.slice(1))
        if (local.startsWith('∈')) {
          const it = evalText(scope, local.slice(1))
          const el = it ? pyElement(it.type) : null
          return val(el)
        }
        return val(normalizePyAnnotation(local))
      }
      if (index.has(name)) return { type: name, isStatic: true }
      // `@voltage.setter` inside the class that declared `@property def voltage`.
      const owner = enclosingClass(lang, scope.raw, scope.at)
      if (owner?.members.some((m) => m.name === name && m.property)) return { type: 'property', isStatic: true }
      return null
    }
  }
}

/** `List[str]` → `list[str]`, `str` stays — annotations to the resolver's spelling. */
function normalizePyAnnotation(t: string): string {
  return t.replace(/^(List|Dict|Set|Tuple)\b/, (m) => m.toLowerCase())
}

function step(scope: ResolveContext, cur: Resolved, seg: Segment): Resolved | null {
  const { lang, index, table } = scope
  if (seg.k === 'index') {
    if (lang === 'java') return isArray(cur.type) ? { type: elementOfArray(cur.type), isStatic: false } : null
    const el = /^(?:list|tuple)\[(.+)\]$/.exec(cur.type)?.[1] ?? (cur.type === 'str' ? 'str' : null)
    const dictVal = /^dict\[.+?,\s*(.+)\]$/.exec(cur.type)?.[1]
    return el ? { type: el, isStatic: false } : dictVal ? { type: dictVal, isStatic: false } : null
  }
  if (seg.k !== 'name' && seg.k !== 'call') return null
  const t = table.memberType(lang, cur, seg.name, seg.k === 'call', index)
  if (!t) return null
  // A Python module attribute that is itself a class (`csv.DictReader`) stays static until called.
  if (t.startsWith('static:')) return { type: t.slice(7), isStatic: true }
  return { type: t, isStatic: false }
}

/* ------------------------------------------------------------------ entry */

/** Resolve the receiver ending at `dotPos` in `doc`. */
export function resolveReceiver(
  lang: CompletionLang,
  doc: string,
  dotPos: number,
  table: MemberTypes,
): { resolved: Resolved | null; from: number } | null {
  const parsed = parseChain(doc, dotPos)
  if (!parsed) return null
  const masked = lang === 'java' ? maskJava(doc) : maskPython(doc)
  const index = typeIndexFor(lang, doc)
  const ctx: ResolveContext = { lang, raw: doc, masked, at: parsed.from, index, table, depth: 0 }
  return { resolved: evaluate(ctx, parsed.segs), from: parsed.from }
}

export { JAVA_PRIMS, baseOf as typeBase, isArray as isArrayType }
