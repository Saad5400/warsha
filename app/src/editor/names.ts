import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import {
  CS_MODIFIERS,
  CS_TYPE,
  C_PRIMS,
  JAVA_MODIFIERS_RE,
  JAVA_PRIMS,
  JAVA_TYPE,
  RESERVED_WORDS,
  curly,
  declaredNames,
  isThrowableName,
  isTypeWord,
  javaCatchRe,
  javaLike,
  maskCode,
  simpleName,
  stripNullable,
  typeArgs,
  type TextLang,
} from './codeText'
import { enclosingClass } from './typeIndex'
import { recordable, withUsageBoost } from './usage'

/**
 * Variable-name suggestions, the way JetBrains IDEs offer them: when the caret
 * is where a new name goes, suggest names made from what is being named.
 *
 *   Scanner |                  → scanner, sc, input
 *   BufferedReader |           → bufferedReader, reader, br
 *   ArrayList<Student> |       → students, studentList, arrayList, list
 *   Student[] |                → students, studentArray, arr
 *   Map<String, Integer> |     → stringIntegerMap, map
 *   catch (IOException |       → e, ex, ioException, exception
 *   for (String | : names)     → name, string, s, str
 *   int |                      → i, n
 *
 *   C#:      the same shapes (`List<Student> |`, `foreach (var | in students)`)
 *   C:       int | → i, n · char *| → s, str · FILE *| → fp · struct Point | → point, p
 *
 *   Python:  for | in students:      → student, item, i
 *            for | in range(10):     → i, j, n
 *            with open(p) as |:      → f, file
 *            except ValueError as |: → e, error, err
 *
 * Names already declared before the caret are numbered past (`scanner2`) and
 * reserved words never come out (`class` → `aClass`). Pure text; no type checking.
 */

/** Short names a course conventionally uses for these types, after the type-derived ones. */
const CONVENTIONAL: Record<string, readonly string[]> = {
  Scanner: ['sc', 'input'],
  String: ['s', 'str'],
  StringBuilder: ['sb'],
  Random: ['rand'],
  int: ['i', 'n'],
  long: ['l', 'n'],
  short: ['s'],
  byte: ['b'],
  double: ['d', 'value'],
  float: ['f', 'value'],
  boolean: ['b', 'flag'],
  char: ['c', 'ch'],
  Object: ['o', 'obj'],
  Integer: ['i', 'n'],
  Double: ['d'],
  Character: ['c'],
  Boolean: ['b'],
  // C#'s keyword types.
  string: ['s', 'str'],
  bool: ['b', 'flag'],
  decimal: ['d', 'amount'],
  object: ['o', 'obj'],
  PrintWriter: ['pw', 'writer'],
  FileWriter: ['fw', 'writer'],
  BufferedReader: ['br'],
  Iterator: ['it'],
}

/** Containers named after what they hold (`List<Student>` → `students`). */
const COLLECTIONS = /^(?:List|ArrayList|LinkedList|Vector|Set|HashSet|TreeSet|LinkedHashSet|Collection|Iterable|Queue|Deque|ArrayDeque|Stack|PriorityQueue|Iterator|Optional|Stream|IList|IEnumerable|ICollection|SortedSet)$/

/** `BufferedReader` → ['Buffered', 'Reader']; `IOException` → ['IO', 'Exception']; `snake_case` → ['snake', 'case']. */
export function words(name: string): string[] {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
}

const lowerFirst = (ws: string[]) =>
  ws.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('')

/** A plain English plural, good enough for class names: Box→Boxes, City→Cities, Person→People. */
export function plural(w: string): string {
  if (/person$/i.test(w)) return w.slice(0, -6) + (w[w.length - 6] === 'P' ? 'People' : 'people')
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies'
  if (/(?:s|x|z|ch|sh)$/i.test(w)) return w + 'es'
  return w + 's'
}

/** The inverse, for a collection variable's name: students→student, cities→city, boxes→box. */
export function singular(w: string): string | null {
  if (/people$/i.test(w)) return w.slice(0, -6) + (w.length > 6 ? 'Person' : 'person')
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (/[^s]s$/.test(w) && w.length > 2) return w.slice(0, -1)
  return null
}

/** Every trailing run of words, longest first: Buffered Reader → bufferedReader, reader. */
const suffixes = (ws: string[]): string[] => ws.map((_, i) => lowerFirst(ws.slice(i)))

/** Names JetBrains-style for a Java type as written: `ArrayList<Student>`, `int[]`, `Scanner`. */
export function namesForJavaType(type: string): string[] {
  const t = stripNullable(type).replace(/\.\.\.$/, '[]')
  const dims = (t.match(/\[\]/g) ?? []).length
  const base = simpleName(t)
  const out: string[] = []
  if (isThrowableName(base)) out.push('e', 'ex')
  if (dims > 0) {
    // Lowercase bases are primitives (C#'s `string` / `bool` too): `ints`, `strings`.
    if (JAVA_PRIMS.has(base) || /^[a-z]/.test(base) || base === 'String') out.push(plural(base.toLowerCase()))
    else {
      const ws = words(base)
      out.push(...suffixes(ws).map(plural), lowerFirst([...ws, 'Array']))
    }
    if (base === 'int' || base === 'double') out.push('numbers')
    out.push('arr')
    return out
  }
  const args = typeArgs(t)
  if (COLLECTIONS.test(base) && args.length === 1 && args[0] !== '?') {
    const ews = words(simpleName(args[0]))
    out.push(...suffixes(ews).map(plural), lowerFirst([...ews, ...words(base).slice(-1)]))
  } else if (/(?:Map|Dictionary)$/.test(base) && args.length === 2) {
    out.push(lowerFirst([...words(simpleName(args[0])), ...words(simpleName(args[1])), ...words(base).slice(-1)]))
  }
  if (!JAVA_PRIMS.has(base) && !/^[a-z]/.test(base)) out.push(...suffixes(words(base)))
  out.push(...(CONVENTIONAL[base] ?? []))
  return out
}

/* -------------------------------------------------- where a name is expected */

export interface NamingSpot {
  /** Where the half-typed name starts. */
  from: number
  /** Candidate names, best first. */
  names: string[]
  /** A member declaration directly in a class body — it may be a method's name, not a variable's. */
  inClassBody: boolean
}

/** Words whose `(` opens a condition, never a parameter list: `if (Foo |` is not a declaration. */
const CONDITION_HEADS = /\b(?:if|while|switch|return|synchronized)\s*\($/

const JAVA_DECL_SPOT = new RegExp(`(^|[({;,]|->)\\s*${JAVA_MODIFIERS_RE}(${JAVA_TYPE}(?:\\.\\.\\.)?)\\s+$`)
/** C#: its modifiers, `string?`, and `out int |` / `params int[] |` / `foreach (var |`. */
const CS_DECL_SPOT = new RegExp(`(^|[({;,]|=>)\\s*(?:(?:${CS_MODIFIERS.join('|')}|out|ref|params|using)\\s+)*(${CS_TYPE})\\s+$`)
/** C: `int |`, `char *|`, `struct Point |`, `const unsigned long |` at a declaration start or in a parameter list. */
const C_DECL_SPOT = new RegExp(
  `(^|[({;,])\\s*((?:(?:const|unsigned|signed|long|short|static|register)\\s+)*(?:(?:struct|union|enum)\\s+[A-Za-z_]\\w*|[A-Za-z_]\\w*))(\\s*\\*+\\s*|\\s+)$`,
)

/** Names for a C declaration's type: `FILE *` → fp; `char *` → s, str; a struct → its name. */
function namesForCType(type: string, stars: number): string[] {
  const words_ = type.split(/\s+/)
  const base = words_[words_.length - 1]
  if (base === 'FILE') return ['fp', 'file']
  if (base === 'char' && stars) return ['s', 'str', 'name']
  if (stars && !C_PRIMS.has(base)) return [...suffixes(words(base)), 'p', 'ptr']
  if (stars) return ['p', 'ptr']
  if (/^(?:struct|union|enum)\b/.test(type) || !C_PRIMS.has(base)) return [...suffixes(words(base)), base[0].toLowerCase()]
  return [...(CONVENTIONAL[base] ?? (/^(?:unsigned|signed|size_t)$/.test(base) ? ['n', 'count'] : []))]
}
/** `catch (IOException |` — the empty name group leaves the caret right after the type. */
const JAVA_CATCH_SPOT = new RegExp(`${javaCatchRe('')}$`)

/** Is the caret where a new name goes? If so, what would make a good one? */
export function namingSpot(lang: TextLang, state: EditorState, pos: number): NamingSpot | null {
  const line = state.doc.lineAt(pos)
  const rawBefore = state.sliceDoc(line.from, pos)
  // Masked, so a `<` or `(` inside a string or comment is never read as code.
  const before = maskCode(lang, rawBefore)
  const after = state.sliceDoc(pos, line.to)
  const wm = /[A-Za-z_$][\w$]*$/.exec(before)
  const partial = wm ? wm[0] : ''
  const head = before.slice(0, before.length - partial.length)
  const from = pos - partial.length
  if (javaLike(lang)) {
    const c = JAVA_CATCH_SPOT.exec(head)
    if (c) return { from, names: namesForJavaType(c[1]), inClassBody: false }
    const m = (lang === 'csharp' ? CS_DECL_SPOT : JAVA_DECL_SPOT).exec(head)
    if (!m || !isTypeWord(lang, m[2])) return null
    if (m[1] === '(' && CONDITION_HEADS.test(head.slice(0, m.index + 1))) return null
    const type = lang === 'csharp' ? stripNullable(m[2]) : m[2].replace(/\s+/g, '')
    const names = type === 'var' ? [] : namesForJavaType(type)
    // `for (String | : names)` / C#'s `foreach (var | in names)` — the collection's name, singular, comes first.
    const fe = (lang === 'csharp' ? /^\s*\w*\s+in\s+([A-Za-z_$][\w$]*)/ : /^\s*\w*\s*:\s*([A-Za-z_$][\w$]*)/).exec(after)
    if (fe && (lang === 'csharp' ? /\bforeach\s*\(/ : /\bfor\s*\(/).test(head)) {
      const one = singular(fe[1])
      if (one) names.unshift(one)
    }
    if (!names.length) return null
    const doc = state.doc.toString()
    const cls = enclosingClass(lang, doc, from)
    // Directly in a class body: the innermost open brace before the caret is the class's own.
    const inClassBody = !!cls && innermostOpenBrace(maskCode(lang, doc), from) === cls.bodyFrom
    return { from, names, inClassBody }
  }
  if (lang === 'c') {
    const m = C_DECL_SPOT.exec(head)
    if (!m) return null
    const type = m[2].replace(/\s+/g, ' ')
    const last = type.split(' ').pop()!
    // Only a real type opens a declaration: `return |`, `x |` and `else |` do not.
    const typed = C_PRIMS.has(last) || /^(?:struct|union|enum)\s/.test(type) || /^[A-Z]/.test(last)
    if (!typed || RESERVED_WORDS.c.has(last) && !C_PRIMS.has(last)) return null
    if (m[1] === '(' && CONDITION_HEADS.test(head.slice(0, m.index + 1))) return null
    const names = namesForCType(type, (m[3].match(/\*/g) ?? []).length)
    return names.length ? { from, names, inClassBody: false } : null
  }
  // Python
  if (/^\s*(?:async\s+)?for\s+$/.test(head)) {
    const it = /^\s*\w*\s+in\s+(.+?):?\s*$/.exec(after)
    const names: string[] = []
    if (it) {
      const src = it[1].trim()
      if (/^range\s*\(/.test(src)) names.push('i', 'j', 'n')
      else if (/^enumerate\s*\(/.test(src)) names.push('i')
      else {
        const last = /([A-Za-z_]\w*)\s*(?:\(\))?$/.exec(src)?.[1]
        const one = last ? singular(last) : null
        if (one) names.push(one)
        if (/\.(?:items|keys)\(\)$/.test(src)) names.push('key')
        if (/\.values\(\)$/.test(src)) names.push('value')
        if (/^open\s*\(|\.readlines\(\)$|^f$|^file$/.test(src)) names.push('line')
      }
    }
    names.push('item', 'i')
    return { from, names, inClassBody: false }
  }
  const withAs = /\bwith\s+(.+?)\s+as\s+$/.exec(head)
  if (withAs) {
    const e = withAs[1].trim()
    if (/^open\s*\(/.test(e)) return { from, names: ['f', 'file'], inClassBody: false }
    const cls = /([A-Za-z_]\w*)\s*\([^)]*\)$/.exec(e)?.[1]
    return cls ? { from, names: suffixes(words(cls)), inClassBody: false } : null
  }
  if (/\bexcept\s+\(?\s*[A-Za-z_][\w.]*[^:]*?\s+as\s+$/.test(head)) return { from, names: ['e', 'error', 'err'], inClassBody: false }
  return null
}

/** Offset of the innermost `{` still open at `pos` (masked text), or -1. */
function innermostOpenBrace(masked: string, pos: number): number {
  let depth = 0
  for (let i = pos - 1; i >= 0; i--) {
    if (masked[i] === '}') depth++
    else if (masked[i] === '{' && depth-- === 0) return i
  }
  return -1
}

/* ------------------------------------------------------------------ source */

/** Names for the spot, deduped, reserved-word-safe, and numbered past any already taken. */
export function finalNames(lang: TextLang, spot: NamingSpot, taken: ReadonlySet<string> | Map<string, unknown>): string[] {
  const reserved = RESERVED_WORDS[lang]
  const seen = new Set<string>()
  const out: string[] = []
  for (let n of spot.names) {
    if (!n) continue
    if (lang === 'python') n = n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    if (reserved.has(n)) n = curly(lang) ? `a${n[0].toUpperCase()}${n.slice(1)}` : `${n}_`
    if (taken.has(n)) {
      let k = 2
      while (taken.has(`${n}${k}`)) k++
      n = `${n}${k}`
    }
    if (!seen.has(n)) {
      seen.add(n)
      out.push(n)
    }
  }
  return out
}

/** How far back to look for names already in use — about one method. */
const TAKEN_LOOKBACK = 4000

export function nameSource(lang: TextLang): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const spot = namingSpot(lang, ctx.state, ctx.pos)
    if (!spot) return null
    const text = maskCode(lang, ctx.state.sliceDoc(Math.max(0, spot.from - TAKEN_LOOKBACK), spot.from))
    const names = finalNames(lang, spot, declaredNames(lang, text))
    if (!names.length) return null
    const options: Completion[] = names.map((label, i) =>
      recordable(lang, { label, type: 'variable', detail: 'suggested name', boost: 50 - i }),
    )
    return { from: spot.from, options: withUsageBoost(lang, options), validFor: /^[\w$]*$/ }
  }
}
