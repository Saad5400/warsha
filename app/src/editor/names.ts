import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import type { CompletionLang } from './completions'
import { recordable, withUsageBoost } from './usage'

/**
 * Variable-name suggestions, the way JetBrains IDEs offer them: when the caret
 * is where a new name goes, suggest names made from what is being named.
 *
 *   Scanner |                  → scanner, sc, input
 *   BufferedReader |           → bufferedReader, reader
 *   ArrayList<Student> |       → students, studentList, arrayList, list
 *   Student[] |                → students, studentArray
 *   Map<String, Integer> |     → map, stringIntegerMap
 *   catch (IOException |       → e, ex, ioException, exception
 *   for (String | : names)     → name, s, string
 *   int |                      → i, n
 *
 *   Python:  for | in students:      → student
 *            for | in range(10):     → i
 *            with open(p) as |:      → f, file
 *            except ValueError as |: → e, error
 *
 * Names already declared before the caret are skipped (or numbered, `scanner2`)
 * and keywords never come out (`class` → `aClass`). Pure text; no type checking.
 */

const JAVA_KEYWORDS = new Set(
  `abstract assert boolean break byte case catch char class const continue default do double else enum extends final
finally float for goto if implements import instanceof int interface long native new package private protected public
return short static strictfp super switch synchronized this throw throws transient try void volatile while true false
null var record yield`.split(/\s+/),
)
const PY_KEYWORDS = new Set(
  `False None True and as assert async await break class continue def del elif else except finally for from global if
import in is lambda nonlocal not or pass raise return try while with yield`.split(/\s+/),
)

/** Short names a course conventionally uses for these types, after the type-derived one. */
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
  PrintWriter: ['pw', 'writer'],
  FileWriter: ['fw', 'writer'],
  BufferedReader: ['br'],
  Iterator: ['it'],
}

const PRIMS = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char'])
const COLLECTIONS = /^(?:List|ArrayList|LinkedList|Vector|Set|HashSet|TreeSet|LinkedHashSet|Collection|Iterable|Queue|Deque|ArrayDeque|Stack|PriorityQueue|Iterator|Optional|Stream)$/

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

/** A plain English plural, good enough for class names: Box→boxes, City→cities, Student→students. */
export function plural(w: string): string {
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies'
  if (/(?:s|x|z|ch|sh)$/i.test(w)) return w + 'es'
  if (/person$/i.test(w)) return w.slice(0, -6) + (w[w.length - 6] === 'P' ? 'People' : 'people')
  return w + 's'
}

/** The inverse, for a collection variable's name: students→student, cities→city, boxes→box. */
export function singular(w: string): string | null {
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(?:ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2)
  if (/[^s]s$/.test(w) && w.length > 2) return w.slice(0, -1)
  if (/people$/i.test(w)) return w.slice(0, -6) + (w.length > 6 ? 'Person' : 'person')
  return null
}

/** Every trailing run of words, longest first: Buffered Reader → bufferedReader, reader. */
function suffixes(ws: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < ws.length; i++) out.push(lowerFirst(ws.slice(i)))
  return out
}

const typeArgsOf = (t: string): string[] => {
  const lt = t.indexOf('<')
  if (lt === -1) return []
  const inner = t.slice(lt + 1, t.lastIndexOf('>'))
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '<') depth++
    else if (inner[i] === '>') depth--
    else if (inner[i] === ',' && depth === 0) {
      out.push(inner.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(inner.slice(start).trim())
  return out.filter(Boolean)
}
const bare = (t: string) => t.replace(/<.*$/s, '').replace(/\[\]/g, '').replace(/^.*\./, '').trim()

/** Names JetBrains-style for a Java type as written: `ArrayList<Student>`, `int[]`, `Scanner`. */
export function namesForJavaType(type: string, opts: { exception?: boolean } = {}): string[] {
  const t = type.replace(/\s+/g, '').replace(/\.\.\.$/, '[]')
  const dims = (t.match(/\[\]/g) ?? []).length
  const base = bare(t)
  const out: string[] = []
  if (opts.exception || /(?:Exception|Error|Throwable)$/.test(base)) out.push('e', 'ex')
  if (dims > 0) {
    if (PRIMS.has(base) || base === 'String') out.push(plural(base.toLowerCase()))
    else {
      const ws = words(base)
      out.push(...suffixes(ws).map((s) => plural(s)))
      out.push(lowerFirst([...ws, 'Array']))
    }
    if (base === 'int' || base === 'double') out.push('numbers')
    out.push('arr')
    return out
  }
  const args = typeArgsOf(t)
  if (COLLECTIONS.test(base) && args.length === 1 && args[0] !== '?') {
    const el = bare(args[0])
    const ews = words(el)
    out.push(...suffixes(ews).map((s) => plural(s)))
    out.push(lowerFirst([...ews, ...words(base).slice(-1)]))
  } else if (/Map$/.test(base) && args.length === 2) {
    out.push(lowerFirst([...words(bare(args[0])), ...words(bare(args[1])), 'Map']))
  }
  if (PRIMS.has(base)) {
    out.push(...(CONVENTIONAL[base] ?? []))
    return out
  }
  out.push(...suffixes(words(base)))
  out.push(...(CONVENTIONAL[base] ?? []))
  return out
}

/* -------------------------------------------------- where a name is expected */

const JAVA_TYPE = String.raw`(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:\s*<(?:[^<>;{}()=]|<[^<>;{}()=]*>)*>)?(?:\s*\[\s*\])*(?:\.\.\.)?`
const NOT_TYPE = new Set([
  'return', 'new', 'throw', 'else', 'case', 'package', 'import', 'yield', 'goto', 'class', 'interface', 'enum',
  'record', 'extends', 'implements', 'throws', 'instanceof', 'assert', 'break', 'continue', 'default', 'do', 'try',
  'this', 'super', 'null', 'true', 'false', 'permits', 'sealed', 'void',
])
const JAVA_MODS = /(?:(?:public|private|protected|static|final|abstract|transient|volatile|synchronized)\s+)*/.source

export interface NamingSpot {
  /** Where the half-typed name starts. */
  from: number
  /** Candidate names, best first. */
  names: string[]
}

/** Is the caret where a new name goes? If so, what would make a good one? */
export function namingSpot(lang: CompletionLang, state: EditorState, pos: number): NamingSpot | null {
  const line = state.doc.lineAt(pos)
  const before = state.sliceDoc(line.from, pos)
  const after = state.sliceDoc(pos, line.to)
  const wm = /[A-Za-z_$][\w$]*$/.exec(before)
  const partial = wm ? wm[0] : ''
  const head = before.slice(0, before.length - partial.length)
  const from = pos - partial.length
  if (lang === 'java') {
    // `catch (IOException | Foo |`
    const c = /\bcatch\s*\(\s*(?:final\s+)?([\w$.]+)(?:\s*\|\s*[\w$.]+)*\s+$/.exec(head)
    if (c) return { from, names: namesForJavaType(c[1], { exception: true }) }
    const m = new RegExp(`(?:^|[({;,]|->)\\s*${JAVA_MODS}(${JAVA_TYPE})\\s+$`).exec(head)
    if (!m) return null
    const type = m[1].replace(/\s+/g, '')
    if (NOT_TYPE.has(type)) return null
    // A bare lowercase word is a type only when it is a primitive or `var`.
    if (/^[a-z_$][\w$]*$/.test(type) && !PRIMS.has(type) && type !== 'var') return null
    // `for (String | : names)` — the collection's name, singular, comes first.
    const fe = /^\s*\w*\s*:\s*([A-Za-z_$][\w$]*)/.exec(after)
    const names = type === 'var' ? [] : namesForJavaType(type)
    if (fe && /\bfor\s*\(/.test(head)) {
      const one = singular(fe[1])
      if (one) names.unshift(one)
    }
    return names.length ? { from, names } : null
  }
  // Python
  const forIn = /^\s*(?:async\s+)?for\s+$/.exec(head)
  if (forIn) {
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
        if (/\.items\(\)$/.test(src)) names.push('key')
        if (/\.keys\(\)$/.test(src)) names.push('key')
        if (/\.values\(\)$/.test(src)) names.push('value')
        if (/^open\s*\(|\.readlines\(\)$|^f$|^file$/.test(src)) names.push('line')
      }
    }
    names.push('item', 'i')
    return { from, names }
  }
  const withAs = /\bwith\s+(.+?)\s+as\s+$/.exec(head)
  if (withAs) {
    const e = withAs[1].trim()
    if (/^open\s*\(/.test(e)) return { from, names: ['f', 'file'] }
    const cls = /([A-Za-z_]\w*)\s*\([^)]*\)$/.exec(e)?.[1]
    return cls ? { from, names: suffixes(words(cls)).map((s) => s.toLowerCase()) } : null
  }
  const exAs = /\bexcept\s+\(?\s*([A-Za-z_][\w.]*)[^:]*?\s+as\s+$/.exec(head)
  if (exAs) return { from, names: ['e', 'error', 'err'] }
  return null
}

/* ------------------------------------------------------------------ source */

const declaredBefore = (lang: CompletionLang, text: string): Set<string> => {
  const out = new Set<string>()
  const re =
    lang === 'java'
      ? /\b[A-Za-z_$][\w$<>,\s[\].]*?\s+([a-z_$][\w$]*)\s*(?=[=;,):])/g
      : /^[ \t]*([A-Za-z_]\w*)\s*=(?!=)|\bfor\s+([A-Za-z_]\w*)|\bas\s+([A-Za-z_]\w*)/gm
  for (const m of text.matchAll(re)) out.add(m[1] ?? m[2] ?? m[3])
  return out
}

/** Names for the spot, deduped, keyword-safe, and numbered past any already taken nearby. */
export function finalNames(lang: CompletionLang, spot: NamingSpot, taken: Set<string>): string[] {
  const kws = lang === 'java' ? JAVA_KEYWORDS : PY_KEYWORDS
  const seen = new Set<string>()
  const out: string[] = []
  for (let n of spot.names) {
    if (!n) continue
    if (lang === 'python') n = n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    if (kws.has(n)) n = lang === 'java' ? `a${n[0].toUpperCase()}${n.slice(1)}` : `${n}_`
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

export function nameSource(lang: CompletionLang): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const spot = namingSpot(lang, ctx.state, ctx.pos)
    if (!spot) return null
    // Look back a bounded way for names already in use — the method, roughly.
    const text = ctx.state.sliceDoc(Math.max(0, spot.from - 4000), spot.from)
    const names = finalNames(lang, spot, declaredBefore(lang, text))
    if (!names.length) return null
    const options: Completion[] = names.map((label, i) =>
      recordable(lang, { label, type: 'variable', detail: 'suggested name', boost: 50 - i }),
    )
    return { from: spot.from, options: withUsageBoost(lang, options), validFor: /^[\w$]*$/ }
  }
}
