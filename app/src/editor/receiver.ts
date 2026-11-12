import {
  CS_PRIMS,
  C_PRIMS,
  JAVA_TYPE,
  cTypeKey,
  curly,
  isTypeWord,
  javaCatchRe,
  javaLike,
  maskCode,
  matchBack,
  matchBracket,
  splitTopLevel,
  stripNullable,
  typeArgs,
  typeRe,
  type TextLang,
} from './codeText'
import { pythonLiteralType, enclosingClass, typeIndexFor, type TypeIndex } from './typeIndex'

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
 *   line = line.strip()   Python: a rebinding reads the binding before it
 *   foreach (var x in xs) C#: the element of what is iterated (Java's resolver, C# spelling)
 *   p->next->value        C: a struct's fields, through `.` or `->`
 *
 * The receiver expression is parsed backwards from the dot into segments
 * (`name`, `call`, `index`, literal…) over the *masked* document (comments and
 * string contents blanked, quotes and offsets kept — so `s.replace("(", "")` is
 * still one call). Its base is looked up (the nearest declaration before the
 * expression, then a field of the enclosing class, then a class name for static
 * access), and each later segment is stepped through the member tables' return
 * types. A binding's right-hand side is evaluated *at that binding*, so a name is
 * never resolved through its own definition; a depth cap backs that up. Anything
 * it cannot follow is null, and the caller falls back to plain words — never a
 * guessed type.
 */

/* ------------------------------------------------------------- the pieces */

export type Segment =
  | { k: 'name'; name: string }
  | { k: 'call'; name: string; args: string }
  | { k: 'index' }
  | { k: 'string' }
  | { k: 'char' }
  | { k: 'new'; type: string }
  | { k: 'paren'; inner: string }
  | { k: 'list' }
  | { k: 'brace'; inner: string }

export interface Resolved {
  /** e.g. `ArrayList<String>`, `int[]`, `str`, `list[str]`, `numpy` (a module). */
  type: string
  /** Reached through the class or module name itself (`Math.`, `Day.`, `np.`) rather than a value. */
  isStatic: boolean
}

/** What the member tables answer for the resolver (implemented in members.ts). */
export interface MemberTypes {
  /** Type of `member` on `on` (already substituted); null when unknown. `static:` prefix = a class reached by name. */
  memberType(lang: TextLang, on: Resolved, member: string, call: boolean, index: TypeIndex): string | null
  /** Is this a type name we know (JDK table, module, user class)? */
  isKnownType(lang: TextLang, name: string, index: TypeIndex): boolean
  /** Python: the type a builtin/imported callable returns when called bare (`input()`, `Counter()`). */
  callResult(lang: TextLang, name: string): string | null
}

const IDENT_CHAR = /[\w$]/
/** How many nested right-hand sides one resolution may follow. */
const MAX_DEPTH = 6

/**
 * Parse the receiver chain that ends just before `end` (the dot) in masked text.
 * Returns the segments left-to-right and where the expression starts, or null
 * when what precedes the dot is not an expression (`3.` — a decimal point).
 * `arrow`: C, where `->` joins a chain the same way `.` does (`end` is then the `-`).
 */
export function parseChain(text: string, end: number, arrow = false): { segs: Segment[]; from: number } | null {
  const segs: Segment[] = []
  let i = end
  for (;;) {
    const c = text[i - 1]
    if (c === undefined) return null
    if (c === ')') {
      const open = matchBack(text, i - 1)
      if (open < 0) return null
      const inner = text.slice(open + 1, i - 1)
      let j = open
      // `new ArrayList<>()` / `new HashMap<String, Integer>()` — step over the type arguments.
      let generic = ''
      if (text[j - 1] === '>') {
        const lt = matchBack(text, j - 1)
        if (lt > 0 && IDENT_CHAR.test(text[lt - 1])) {
          generic = text.slice(lt, j)
          j = lt
        }
      }
      const nameEnd = j
      while (j > 0 && IDENT_CHAR.test(text[j - 1])) j--
      if (j === nameEnd) {
        // `(…).` — a cast or a grouped expression; nothing continues to its left.
        segs.unshift({ k: 'paren', inner })
        return { segs, from: open }
      }
      const name = text.slice(j, nameEnd)
      const newAt = newKeywordBefore(text, j)
      if (newAt >= 0) {
        segs.unshift({ k: 'new', type: name + (generic === '<>' ? '' : generic) })
        return { segs, from: newAt }
      }
      segs.unshift({ k: 'call', name, args: inner })
      i = j
    } else if (c === ']') {
      const open = matchBack(text, i - 1)
      if (open < 0) return null
      // `[1, 2]` with nothing indexable before it is a list literal.
      if (open === 0 || !/[\w$)\]"'}]/.test(text[open - 1])) {
        segs.unshift({ k: 'list' })
        return { segs, from: open }
      }
      // An index binds to whatever precedes it directly (`arr[0]`, `m[0][1]`), no dot between.
      segs.unshift({ k: 'index' })
      i = open
      continue
    } else if (c === '}') {
      const open = matchBack(text, i - 1)
      if (open < 0) return null
      segs.unshift({ k: 'brace', inner: text.slice(open + 1, i - 1) })
      return { segs, from: open }
    } else if (c === '"' || c === "'") {
      // Masked: the literal's inside is blank, so the opening quote is the previous one on the line.
      let j = i - 2
      while (j >= 0 && text[j] !== c) {
        if (text[j] === '\n') return null
        j--
      }
      if (j < 0) return null
      const charLit = c === "'" && i - j <= 4
      while (j > 0 && /[rRbBfFuU]/.test(text[j - 1]) && !IDENT_CHAR.test(text[j - 2] ?? ' ')) j--
      segs.unshift(charLit ? { k: 'char' } : { k: 'string' })
      return { segs, from: j }
    } else if (IDENT_CHAR.test(c)) {
      let j = i - 1
      while (j > 0 && IDENT_CHAR.test(text[j - 1])) j--
      const name = text.slice(j, i)
      if (/^\d/.test(name)) return null
      // `new int[5].length`, `new String[n]` — the index segments belong to `new`.
      const newAt = segs[0]?.k === 'index' ? newKeywordBefore(text, j) : -1
      if (newAt >= 0) {
        let dims = 0
        while (segs[0]?.k === 'index') {
          segs.shift()
          dims++
        }
        segs.unshift({ k: 'new', type: name + '[]'.repeat(dims) })
        return { segs, from: newAt }
      }
      segs.unshift({ k: 'name', name })
      i = j
    } else {
      return null
    }
    // Continue only across another dot (or C's `->`); anything else ends the expression.
    if (arrow && text[i - 1] === '>' && text[i - 2] === '-') {
      i -= 2
      continue
    }
    if (text[i - 1] !== '.') return { segs, from: i }
    i--
  }
}

/** Start of a `new` keyword directly before `at` (spaces between), or -1. */
function newKeywordBefore(text: string, at: number): number {
  let k = at
  while (k > 0 && /\s/.test(text[k - 1])) k--
  if (k === at || k < 3 || text.slice(k - 3, k) !== 'new' || IDENT_CHAR.test(text[k - 4] ?? '')) return -1
  return k - 3
}

/* ---------------------------------------------------------------- bindings */

/** Where a name was bound, and to what: a written type, or an expression to evaluate there. */
type Binding = { at: number; type: string } | { at: number; expr: string; element?: boolean } | { at: number; module: string } | { at: number; from: string }

/** The nearest binding that is still in scope at `pos`. */
function nearest(list: Binding[], visible: (at: number) => boolean): Binding | null {
  for (const b of [...list].sort((x, y) => y.at - x.at)) if (visible(b.at)) return b
  return null
}

/**
 * Java: is a declaration at `at` still in scope at `pos`? Its scope is the block
 * that holds it — or, for a parameter / for / catch / try-with-resources header
 * (inside an unclosed `(`), the statement or block that header opens. So a local
 * of one method never types a same-named variable in another.
 */
function javaVisible(masked: string, at: number, pos: number): boolean {
  // Inside a `( … )` header?
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = masked[i]
    if (c === ')') depth++
    else if (c === '(') {
      if (depth === 0) {
        const close = matchBracket(masked, i)
        let k = close + 1
        while (k < masked.length && /\s/.test(masked[k])) k++
        // `) throws IOException {` — step over a throws clause to the body.
        const thr = /^throws\s+[\w$.,\s]+?(?=\{)/.exec(masked.slice(k, k + 200))
        if (thr) k += thr[0].length
        const end = masked[k] === '{' ? matchBracket(masked, k) : masked.indexOf(';', k)
        return pos > close && pos <= (end === -1 ? masked.length : end)
      }
      depth--
    } else if ((c === '{' || c === '}' || c === ';') && depth === 0) break
  }
  // Otherwise the innermost block around the declaration.
  depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const c = masked[i]
    if (c === '}') depth++
    else if (c === '{' && depth-- === 0) return matchBracket(masked, i) >= pos
  }
  return true
}

/**
 * Python: a binding inside a function is visible only in that function (a `def`
 * line's own parameters included); one at module level is visible everywhere.
 */
function pythonVisible(masked: string, at: number, pos: number): boolean {
  const lineStart = masked.lastIndexOf('\n', at - 1) + 1
  const indent = (s: string) => s.length - s.trimStart().length
  const lineOf = (from: number) => masked.slice(from, masked.indexOf('\n', from) === -1 ? masked.length : masked.indexOf('\n', from))
  let defStart = -1
  if (/^\s*(?:async\s+)?def\b/.test(lineOf(lineStart))) defStart = lineStart
  else {
    let level = indent(lineOf(lineStart))
    for (let s = lineStart - 1; s > 0 && level > 0; ) {
      const from = masked.lastIndexOf('\n', s - 1) + 1
      const l = lineOf(from)
      if (l.trim() && indent(l) < level) {
        if (/^\s*(?:async\s+)?def\b/.test(l)) {
          defStart = from
          break
        }
        level = indent(l)
      }
      s = from - 1
    }
  }
  if (defStart === -1) return true
  // The function's body runs until a non-blank line indented no deeper than its `def`.
  const defIndent = indent(lineOf(defStart))
  let i = masked.indexOf('\n', defStart)
  while (i !== -1 && i < pos) {
    const l = lineOf(i + 1)
    if (l.trim() && indent(l) <= defIndent && i + 1 < pos) return false
    i = masked.indexOf('\n', i + 1)
  }
  return pos > defStart
}

/** The nearest declaration of `name` before `pos` in masked Java (or C#: same shapes, its own type words). */
function javaBinding(masked: string, name: string, pos: number, lang: 'java' | 'csharp' = 'java'): Binding | null {
  const before = masked.slice(0, pos)
  const esc = name.replace(/\$/g, '\\$')
  const found: Binding[] = []
  const TYPE = typeRe(lang)
  if (lang === 'csharp') {
    // `foreach (var x in xs)` / `foreach (string s in names)` — scoped to the loop, like a Java for-each header.
    for (const m of before.matchAll(new RegExp(`\\bforeach\\s*\\(\\s*(${TYPE})\\s+${esc}\\s+in\\s+([^)]*)\\)`, 'g'))) {
      const t = stripNullable(m[1])
      const at = m.index! + m[0].indexOf('(') + 1
      found.push(t === 'var' ? { at, expr: m[2], element: true } : { at, type: t })
    }
  }
  // `Type name =|;|,|)|:|[` — locals, fields, parameters, for-each, pattern variables.
  for (const m of before.matchAll(new RegExp(`(?:^|[^\\w$.])(${TYPE})\\s+${esc}\\s*(?=[=;,):]|\\[)`, 'g'))) {
    const t = lang === 'csharp' ? stripNullable(m[1]) : m[1].replace(/\s+/g, '')
    if (!isTypeWord(lang, t)) continue
    if (t === 'var') {
      const eq = before.indexOf('=', m.index! + m[0].length)
      if (eq === -1) continue
      let end = before.indexOf(';', eq)
      if (end === -1) end = before.length
      found.push({ at: m.index!, expr: before.slice(eq + 1, end) })
    } else found.push({ at: m.index! + m[0].length, type: t }) // after the name: inside a `(…)` header for a parameter
  }
  // `catch (A | B name)` — the first alternative stands for the variable.
  for (const m of before.matchAll(new RegExp(`${javaCatchRe(esc)}\\s*\\)`, 'g'))) found.push({ at: m.index! + m[0].indexOf('(') + 1, type: m[1] })
  // `int... nums` — varargs are an array.
  for (const m of before.matchAll(new RegExp(`(?:^|[^\\w$.])(${JAVA_TYPE})\\s*\\.\\.\\.\\s*${esc}\\s*(?=[,)])`, 'g')))
    found.push({ at: m.index! + m[0].length, type: `${m[1].replace(/\s+/g, '')}[]` })
  // C#'s varargs: `params int[] nums` is already an array, caught above.
  return nearest(found, (at) => javaVisible(masked, at, pos))
}

/**
 * The nearest declaration of `name` in masked C: `int x`, `struct Point p`,
 * `Point *p`, `char name[50]`, a parameter. Visibility is the same block rule as
 * Java's. The type comes back as a key (`Point[]` for a pointer or array).
 */
function cBinding(masked: string, name: string, pos: number): Binding | null {
  const before = masked.slice(0, pos)
  const found: Binding[] = []
  const re = new RegExp(
    `(?:^|[^\\w.>])((?:(?:const|unsigned|signed|long|short|static|register|volatile)\\s+)*(?:(?:struct|union|enum)\\s+)?[A-Za-z_]\\w*)\\s*(\\**)\\s*\\b${name}\\s*((?:\\[[^\\]]*\\])*)\\s*(?=[=;,)\\[])`,
    'g',
  )
  for (const m of before.matchAll(re)) {
    const word = m[1].replace(/^.*\s/, '')
    if (!C_PRIMS.has(word) && !/\b(?:struct|union|enum)\s/.test(m[1]) && !/^[A-Z]/.test(word) && !/_t$/.test(word)) continue
    const key = cTypeKey(`${m[1]} ${m[2]}${m[3]}`)
    if (key) found.push({ at: m.index! + m[0].length, type: key })
  }
  return nearest(found, (at) => javaVisible(masked, at, pos))
}

/** The nearest binding of `name` before `pos` in masked Python. */
function pythonBinding(masked: string, name: string, pos: number): Binding | null {
  const before = masked.slice(0, pos)
  const found: Binding[] = []
  // `name = rhs` / `name: T = rhs`
  for (const m of before.matchAll(new RegExp(`^[ \\t]*${name}[ \\t]*(?::[ \\t]*([^=\\n]+))?=(?!=)[ \\t]*([^\\n]*)$`, 'gm'))) {
    found.push(m[1] ? { at: m.index!, type: m[1].trim() } : { at: m.index!, expr: m[2] })
  }
  // `for name in expr:` — the element of what is iterated.
  for (const m of before.matchAll(new RegExp(`\\bfor[ \\t]+${name}[ \\t]+in[ \\t]+([^\\n]+?):[ \\t]*$`, 'gm'))) {
    found.push({ at: m.index!, expr: m[1], element: true })
  }
  // `with expr as name`
  for (const m of before.matchAll(new RegExp(`\\bwith[ \\t]+([^\\n]+?)[ \\t]+as[ \\t]+${name}\\b`, 'g'))) found.push({ at: m.index!, expr: m[1] })
  // `def f(name: T)` and `except E as name`
  for (const m of before.matchAll(new RegExp(`[(,][ \\t]*${name}[ \\t]*:[ \\t]*([A-Za-z_][\\w.\\[\\], ]*?)[ \\t]*(?=[,)=])`, 'g')))
    found.push({ at: m.index!, type: m[1].trim() })
  for (const m of before.matchAll(new RegExp(`\\bexcept[ \\t]+\\(?[ \\t]*([A-Za-z_][\\w.]*)[^:\\n]*?[ \\t]+as[ \\t]+${name}\\b`, 'g')))
    found.push({ at: m.index!, type: m[1] })
  // `import numpy as np`, `import os`, `from x import y [as z]`
  for (const m of before.matchAll(new RegExp(`^[ \\t]*import[ \\t]+([\\w.]+)[ \\t]+as[ \\t]+${name}\\b`, 'gm'))) found.push({ at: m.index!, module: m[1] })
  for (const m of before.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)$/gm)) {
    for (const mod of m[1].split(',')) if (mod.trim() === name) found.push({ at: m.index!, module: name })
  }
  for (const m of before.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+([^\n]+)$/gm)) {
    for (const part of m[2].replace(/[()]/g, '').split(',')) {
      const [orig, alias] = part.trim().split(/\s+as\s+/)
      if ((alias ?? orig) === name) found.push({ at: m.index!, from: `${m[1]}.${orig}` })
    }
  }
  return nearest(found, (at) => pythonVisible(masked, at, pos))
}

/* -------------------------------------------------------------- evaluate */

interface Scope {
  lang: TextLang
  /** The whole document, raw — the type index and enclosing class read it. */
  raw: string
  /** The same document masked — every binding lookup reads this. */
  masked: string
  /** Names are resolved as of this offset. */
  at: number
  index: TypeIndex
  table: MemberTypes
  depth: number
}

const val = (type: string | null | undefined): Resolved | null => (type ? { type, isStatic: false } : null)

/** Type of an expression given as (masked) text, resolved as of `at`. */
function evalText(scope: Scope, expr: string, at: number): Resolved | null {
  const e = expr.trim().replace(/;$/, '').trim()
  if (!e || scope.depth >= MAX_DEPTH) return null
  if (scope.lang === 'java') {
    if (/^-?\d+[lL]?$/.test(e)) return val(/[lL]$/.test(e) ? 'long' : 'int')
    if (/^-?\d*\.\d+[dDfF]?$/.test(e)) return val(/[fF]$/.test(e) ? 'float' : 'double')
    if (e === 'true' || e === 'false') return val('boolean')
  } else if (scope.lang === 'csharp') {
    if (/^-?\d+[lL]?$/.test(e)) return val(/[lL]$/.test(e) ? 'long' : 'int')
    if (/^-?\d*\.?\d+[dDfFmM]$|^-?\d*\.\d+$/.test(e)) return val(/[fF]$/.test(e) ? 'float' : /[mM]$/.test(e) ? 'decimal' : 'double')
    if (e === 'true' || e === 'false') return val('bool')
    if (/^\$?@?\$?"/.test(e)) return val('string')
  } else if (scope.lang === 'c') {
    return null
  } else {
    const lit = pythonLiteralType(e)
    if (lit && !lit.endsWith('()')) return val(lit === 'list' ? listOfLiteral(e) : lit)
  }
  const parsed = parseChain(e, e.length)
  if (!parsed || parsed.from !== 0) return null
  return evaluate({ ...scope, at, depth: scope.depth + 1 }, parsed.segs)
}

/** `["a", "b"]` → `list[str]`; anything less obvious stays `list`. */
function listOfLiteral(e: string): string {
  const first = splitTopLevel(e.slice(1, matchBracket(e, 0)))[0]
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
  const d = /^dict\[(.+?),/.exec(t)
  if (d) return d[1]
  if (t === 'csv.reader') return 'list[str]'
  if (t === 'csv.DictReader') return 'dict'
  return null
}

/** C#: what `foreach` over a value of type `t` yields — `List<T>` → T, `T[]` → T, a Dictionary's pairs. */
function csElement(t: string): string | null {
  const s = t.replace(/\s+/g, '')
  if (/\[\]$/.test(s)) return s.slice(0, -2)
  if (s === 'string' || s === 'String') return 'char'
  const base = s.replace(/<.*$/, '')
  const args = typeArgs(s)
  if (/Dictionary$/.test(base) && args.length === 2) return `KeyValuePair<${args[0]},${args[1]}>`
  return args.length === 1 ? args[0] : null
}

/** C# reaches these through their keyword (`int.Parse`, `string.Join`) — lowercase, yet a type. */
const csKeywordType = (name: string) => CS_PRIMS.has(name)

function evaluate(scope: Scope, segs: Segment[]): Resolved | null {
  let cur = base(scope, segs[0])
  for (let i = 1; i < segs.length && cur; i++) cur = step(scope, cur, segs[i])
  return cur
}

function fromBinding(scope: Scope, b: Binding): Resolved | null {
  if ('type' in b) return val(scope.lang === 'python' ? b.type.replace(/^(List|Dict|Set|Tuple)\b/, (m) => m.toLowerCase()) : b.type)
  if ('module' in b) return { type: b.module, isStatic: true }
  if ('from' in b) {
    const last = b.from.split('.').pop()!
    if (scope.table.isKnownType(scope.lang, b.from, scope.index)) return { type: b.from, isStatic: true }
    return scope.table.isKnownType(scope.lang, last, scope.index) ? { type: last, isStatic: true } : null
  }
  const r = evalText(scope, b.expr, b.at)
  if (!b.element) return r
  return val(r ? (scope.lang === 'csharp' ? csElement(r.type) : pyElement(r.type)) : null)
}

function base(scope: Scope, seg: Segment): Resolved | null {
  const { lang, index, table } = scope
  // `java` below means the Java-like engine (Java and C#); `curly` adds C.
  const java = javaLike(lang)
  const cs = lang === 'csharp'
  switch (seg.k) {
    case 'string':
      return lang === 'c' ? null : val(lang === 'java' ? 'String' : cs ? 'string' : 'str')
    case 'char':
      return lang === 'c' ? null : val(java ? 'char' : 'str')
    case 'list':
      return lang === 'c' || lang === 'csharp' ? null : val('list')
    case 'brace':
      return curly(lang) ? null : val(seg.inner.trim() === '' || /:/.test(seg.inner) ? 'dict' : 'set')
    case 'new':
      return lang === 'c' ? null : val(cs ? stripNullable(seg.type) : seg.type)
    case 'paren': {
      const cast = java ? new RegExp(`^\\s*\\(\\s*(${typeRe(lang)})\\s*\\)`).exec(seg.inner) : null
      if (cast) return val(cs ? stripNullable(cast[1]) : cast[1].replace(/\s+/g, ''))
      return lang === 'c' ? null : evalText(scope, seg.inner, scope.at)
    }
    case 'index':
      return null
    case 'call': {
      const cls = enclosingClass(lang, scope.raw, scope.at)
      if (lang === 'python' && seg.name === 'super') return val(cls?.supers[0])
      // A bare call: a method of the enclosing class first.
      const own = cls && lang !== 'c' ? table.memberType(lang, { type: cls.name, isStatic: false }, seg.name, true, index) : null
      if (own) return val(own)
      if (curly(lang)) return null
      if (index.has(seg.name)) return val(seg.name)
      const b = pythonBinding(scope.masked, seg.name, scope.at)
      if (b && 'from' in b) return val(table.callResult(lang, b.from) ?? b.from.split('.').pop())
      return val(table.callResult(lang, seg.name))
    }
    case 'name': {
      const name = seg.name
      const cls = enclosingClass(lang, scope.raw, scope.at)
      if (lang === 'c') {
        const b = cBinding(scope.masked, name, scope.at)
        return b ? fromBinding(scope, b) : null
      }
      if (java ? name === 'this' : name === 'self' || name === 'cls') return cls ? { type: cls.name, isStatic: name === 'cls' } : null
      if (java && name === (cs ? 'base' : 'super')) return val(cls?.supers.find((s) => s !== 'Enum'))
      const b = java ? javaBinding(scope.masked, name, scope.at, lang) : pythonBinding(scope.masked, name, scope.at)
      if (b) return fromBinding(scope, b)
      if (java && cls) {
        // A field of the enclosing class (or one it inherits).
        const field = table.memberType(lang, { type: cls.name, isStatic: false }, name, false, index)
        if (field) return val(field)
      }
      if (table.isKnownType(lang, name, index) && (!java || /^[A-Z]/.test(name) || (cs && csKeywordType(name)))) return { type: name, isStatic: true }
      // `@voltage.setter` inside the class that declared `@property def voltage`.
      if (lang === 'python' && cls?.members.some((m) => m.name === name && m.property)) return { type: 'property', isStatic: true }
      return null
    }
  }
}

function step(scope: Scope, cur: Resolved, seg: Segment): Resolved | null {
  const { lang, index, table } = scope
  if (seg.k === 'index') {
    const t = cur.type.replace(/\s+/g, '')
    if (curly(lang) && /\[\]$/.test(t)) return val(t.slice(0, -2))
    if (lang === 'java' || lang === 'c') return null
    if (lang === 'csharp') {
      // An indexer: `list[0]` is a T, `dict[key]` a TValue, `s[0]` a char.
      if (t === 'string' || t === 'String') return val('char')
      const args = typeArgs(t)
      return val(/Dictionary$/.test(t.replace(/<.*$/, '')) ? args[1] : args.length === 1 ? args[0] : null)
    }
    // `df["score"]` is a column; `s[0]` of a str is a str.
    const el = /^(?:list|tuple)\[(.+)\]$/.exec(t)?.[1] ?? (t === 'str' ? 'str' : t === 'DataFrame' ? 'Series' : null)
    return val(el ?? /^dict\[.+?,(.+)\]$/.exec(t)?.[1])
  }
  if (seg.k !== 'name' && seg.k !== 'call') return null
  const t = table.memberType(lang, cur, seg.name, seg.k === 'call', index)
  if (!t) return null
  return t.startsWith('static:') ? { type: t.slice(7), isStatic: true } : val(t)
}

/* ------------------------------------------------------------------ entry */

let maskMemo: { lang: TextLang; doc: string; masked: string } | null = null

/** The masked form of `doc`, memoised for the last document seen (one keystroke, several sources). */
export function maskedDoc(lang: TextLang, doc: string): string {
  if (!maskMemo || maskMemo.doc !== doc || maskMemo.lang !== lang) maskMemo = { lang, doc, masked: maskCode(lang, doc) }
  return maskMemo.masked
}

/** Resolve the receiver ending at `dotPos` in `doc`. */
export function resolveReceiver(
  lang: TextLang,
  doc: string,
  dotPos: number,
  table: MemberTypes,
): { resolved: Resolved | null; from: number } | null {
  const masked = maskedDoc(lang, doc)
  const parsed = parseChain(masked, dotPos, lang === 'c')
  if (!parsed) return null
  const scope: Scope = { lang, raw: doc, masked, at: parsed.from, index: typeIndexFor(lang, doc), table, depth: 0 }
  return { resolved: evaluate(scope, parsed.segs), from: parsed.from }
}

