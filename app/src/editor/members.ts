import type { EditorState } from '@codemirror/state'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { LangId } from '../runtime'

/**
 * The third gap: `variable.` should offer that variable's methods. There is
 * no language server here, so "the variable's type" is a guess from scanning
 * the document as text — `Scanner sc = new Scanner(...)` makes `sc` a
 * Scanner, `xs = [...]` makes `xs` a Python list. Wrong or absent for
 * anything cleverer (reassignment, a method's return type, a parameter) — a
 * beginner course's own code rarely is.
 *
 * The scan only ever looks at the text *before* the dot the student just
 * typed, and only when a `name.` context is actually detected (bounded
 * look-back below), so it never runs on every keystroke of an unrelated
 * line. The single-slot memo further skips re-scanning while the student
 * types the member name itself, since the text before the dot has not moved.
 */

const method = (label: string, detail: string): Completion => ({ label, type: 'method', detail, boost: 30 })

export const JAVA_MEMBERS: Record<string, readonly Completion[]> = {
  Scanner: [
    method('nextLine', 'String — read one whole line'),
    method('nextInt', 'int — read a whole number'),
    method('nextDouble', 'double — read a decimal number'),
    method('next', 'String — read one word'),
    method('hasNextLine', 'boolean — is there another line?'),
    method('hasNextInt', 'boolean — is the next thing a number?'),
    method('hasNext', 'boolean — is there anything left to read?'),
    method('close', 'void — stop reading'),
  ],
  String: [
    method('length', 'int — how many characters'),
    method('charAt', 'char, at(int) — the character at a position'),
    method('substring', 'String, (int, int) — a piece of the text'),
    method('equals', 'boolean, (Object) — are these the same?'),
    method('equalsIgnoreCase', 'boolean, (String) — the same, ignoring capitals'),
    method('toUpperCase', 'String — ALL CAPITALS'),
    method('toLowerCase', 'String — all lower case'),
    method('trim', 'String — remove spaces at both ends'),
    method('split', 'String[], (String) — break text into pieces'),
    method('contains', 'boolean, (CharSequence) — does it contain this?'),
    method('indexOf', 'int, (String) — where this appears, or -1'),
    method('replace', 'String, (CharSequence, CharSequence) — swap one piece for another'),
    method('isEmpty', 'boolean — is it empty?'),
    method('isBlank', 'boolean — empty or only spaces? (Java 11+)'),
    method('strip', 'String — remove spaces at both ends (Java 11+)'),
    method('repeat', 'String, (int) — the text repeated n times (Java 11+)'),
    method('lines', 'Stream<String> — split into lines (Java 11+)'),
    method('formatted', 'String, (args…) — fill in the blanks, like printf (Java 15+)'),
    method('compareTo', 'int, (String) — alphabetical order'),
    method('startsWith', 'boolean, (String) — does it start with this?'),
    method('endsWith', 'boolean, (String) — does it end with this?'),
    method('concat', 'String, (String) — glue text onto the end'),
    method('toString', 'String — this text'),
  ],
  ArrayList: [
    method('add', 'boolean, (E) — put something in'),
    method('get', 'E, (int) — the item at a position'),
    method('set', 'E, (int, E) — replace the item at a position'),
    method('size', 'int — how many items'),
    method('remove', 'E, (int) — take something out'),
    method('isEmpty', 'boolean — is it empty?'),
    method('contains', 'boolean, (Object) — is this in the list?'),
    method('indexOf', 'int, (Object) — where an item is'),
    method('clear', 'void — remove everything'),
    method('forEach', 'void, (action) — do something with each item'),
    method('stream', 'Stream<E> — start a pipeline over the items'),
  ],
  HashMap: [
    method('put', 'V, (K, V) — store a value under a key'),
    method('get', 'V, (Object) — the value for a key'),
    method('getOrDefault', 'V, (Object, V) — the value for a key, or a fallback'),
    method('containsKey', 'boolean, (Object) — is this key in there?'),
    method('containsValue', 'boolean, (Object) — is this value in there?'),
    method('remove', 'V, (Object) — take a pair out'),
    method('size', 'int — how many pairs'),
    method('isEmpty', 'boolean — is it empty?'),
    method('keySet', 'Set<K> — all the keys'),
    method('values', 'Collection<V> — all the values'),
    method('entrySet', 'Set<Map.Entry<K,V>> — every key and value'),
  ],
  Math: [
    method('abs', 'double, (double) — distance from zero'),
    method('max', '(double, double) — the larger of two'),
    method('min', '(double, double) — the smaller of two'),
    method('pow', 'double, (double, double) — to the power of'),
    method('sqrt', 'double, (double) — square root'),
    method('round', 'long, (double) — to the nearest whole number'),
    method('floor', 'double, (double) — round down'),
    method('ceil', 'double, (double) — round up'),
    method('random', 'double — a random number from 0 to 1'),
  ],
  Arrays: [
    method('sort', 'void, (int[]) — put an array in order'),
    method('toString', 'String, (int[]) — an array as text'),
    method('fill', 'void, (int[], val) — set every slot to the same value'),
    method('asList', 'List<T>, (T...) — an array as a list'),
    method('equals', 'boolean, (a, b) — are these two arrays the same?'),
    method('copyOf', 'T[], (arr, int) — a copy, resized'),
  ],
  Random: [
    method('nextInt', 'int, (int) — a random whole number below this'),
    method('nextDouble', 'double — a random decimal from 0 to 1'),
    method('nextBoolean', 'boolean — a random true or false'),
    method('nextLong', 'long — a random whole number'),
  ],
  StringBuilder: [
    method('append', 'StringBuilder, (x) — add to the end'),
    method('toString', 'String — this text so far'),
    method('length', 'int — how many characters'),
    method('reverse', 'StringBuilder — back to front'),
    method('insert', 'StringBuilder, (int, x) — add at a position'),
    method('deleteCharAt', 'StringBuilder, (int) — remove one character'),
    method('charAt', 'char, (int) — the character at a position'),
    method('setCharAt', 'void, (int, char) — replace one character'),
  ],
  // Modern Java (9–17). These are the static-factory holders, so `List.` /
  // `Optional.` / `Collectors.` offer what a Java 17 course actually types.
  List: [
    method('of', 'List<E>, (E...) — a fixed list of these items'),
    method('copyOf', 'List<E>, (Collection) — a fixed copy of another collection'),
  ],
  Map: [
    method('of', 'Map<K,V>, (k, v, …) — a fixed map of these pairs'),
    method('copyOf', 'Map<K,V>, (Map) — a fixed copy of another map'),
    method('entry', 'Entry<K,V>, (k, v) — one key/value pair'),
  ],
  Set: [
    method('of', 'Set<E>, (E...) — a fixed set of these items, no repeats'),
    method('copyOf', 'Set<E>, (Collection) — a fixed copy, no repeats'),
  ],
  Optional: [
    method('of', 'Optional<T>, (T) — wrap a value that is definitely there'),
    method('ofNullable', 'Optional<T>, (T) — wrap a value that might be null'),
    method('empty', 'Optional<T> — an Optional holding nothing'),
    method('isPresent', 'boolean — is there a value?'),
    method('isEmpty', 'boolean — is it empty?'),
    method('get', 'T — the value (throws if empty)'),
    method('orElse', 'T, (T) — the value, or this fallback'),
    method('ifPresent', 'void, (action) — run code only if there is a value'),
    method('map', 'Optional<U>, (fn) — transform the value if present'),
  ],
  Stream: [
    method('of', 'Stream<T>, (T...) — a stream of these items'),
  ],
  Collectors: [
    method('toList', 'Collector — gather into a list'),
    method('toSet', 'Collector — gather into a set, no repeats'),
    method('joining', 'Collector, (sep) — glue the pieces into one String'),
    method('groupingBy', 'Collector, (fn) — group items by a key'),
    method('counting', 'Collector — count the items in each group'),
  ],
  Collections: [
    method('sort', 'void, (List) — put a list in order'),
    method('reverse', 'void, (List) — flip a list back to front'),
    method('shuffle', 'void, (List) — mix a list randomly'),
    method('max', 'T, (Collection) — the largest item'),
    method('min', 'T, (Collection) — the smallest item'),
    method('emptyList', 'List<T> — a fixed empty list'),
  ],
  Integer: [
    method('parseInt', 'int, (String) — text as a whole number'),
    method('valueOf', 'Integer, (String) — text as an Integer'),
    method('toString', 'String, (int) — a number as text'),
    { label: 'MAX_VALUE', type: 'constant', detail: 'the largest int', boost: 30 },
    { label: 'MIN_VALUE', type: 'constant', detail: 'the smallest int', boost: 30 },
  ],
  Double: [
    method('parseDouble', 'double, (String) — text as a decimal number'),
    method('valueOf', 'Double, (String) — text as a Double'),
    method('toString', 'String, (double) — a decimal as text'),
  ],
}

export const PYTHON_MEMBERS: Record<string, readonly Completion[]> = {
  str: [
    method('upper', '() — ALL CAPITALS'),
    method('lower', '() — all lower case'),
    method('strip', '() — remove spaces at both ends'),
    method('split', '(sep) — break text into pieces'),
    method('join', '(iterable) — glue pieces together with this between them'),
    method('replace', '(old, new) — swap one piece for another'),
    method('startswith', '(s) — does it start with this?'),
    method('endswith', '(s) — does it end with this?'),
    method('find', '(s) — where this appears, or -1'),
    method('format', '(*args) — fill in the blanks'),
    method('index', '(s) — where this appears'),
    method('count', '(s) — how many times it appears'),
    method('isdigit', '() — is it all digits?'),
    method('isalpha', '() — is it all letters?'),
    method('title', '() — Title Case'),
    method('capitalize', '() — Capitalize the first letter'),
    method('zfill', '(n) — pad with leading zeros'),
  ],
  list: [
    method('append', '(x) — add to the end'),
    method('extend', '(iterable) — add all of another list'),
    method('insert', '(i, x) — add at a position'),
    method('pop', '(i=-1) — take an item out, and return it'),
    method('remove', '(x) — take the first match out'),
    method('sort', '(key=, reverse=) — put in order'),
    method('reverse', '() — turn back to front'),
    method('index', '(x) — where an item is'),
    method('count', '(x) — how many times it appears'),
    method('clear', '() — remove everything'),
    method('copy', '() — a shallow copy'),
  ],
  dict: [
    method('keys', '() — all the keys'),
    method('values', '() — all the values'),
    method('items', '() — every key and value'),
    method('get', '(k, default) — the value for a key, or a fallback'),
    method('update', '(other) — merge in more pairs'),
    method('pop', '(k) — take a pair out, and return its value'),
    method('setdefault', '(k, default) — get a key, setting it if missing'),
    method('clear', '() — remove everything'),
    method('copy', '() — a shallow copy'),
  ],
  set: [
    method('add', '(x) — put something in'),
    method('remove', '(x) — take something out (error if missing)'),
    method('discard', '(x) — take something out (no error if missing)'),
    method('union', '(other) — everything in either set'),
    method('intersection', '(other) — only what is in both sets'),
    method('difference', '(other) — what is only in this set'),
    method('issubset', '(other) — is every item also in other?'),
    method('clear', '() — remove everything'),
    method('pop', '() — take an arbitrary item out'),
  ],
  math: [
    method('sqrt', '(x) — square root'),
    method('floor', '(x) — round down'),
    method('ceil', '(x) — round up'),
    method('pow', '(x, y) — to the power of'),
    method('factorial', '(n) — n!'),
    method('gcd', '(a, b) — greatest common divisor'),
    { label: 'pi', type: 'constant', detail: '3.14159…', boost: 30 },
    { label: 'e', type: 'constant', detail: "2.71828…, Euler's number", boost: 30 },
    { label: 'inf', type: 'constant', detail: 'infinity', boost: 30 },
  ],
  random: [
    method('randint', '(a, b) — a random whole number from a to b'),
    method('random', '() — a random decimal from 0 to 1'),
    method('choice', '(seq) — a random item from a list'),
    method('shuffle', '(seq) — mix a list randomly, in place'),
    method('uniform', '(a, b) — a random decimal in a range'),
    method('sample', '(seq, k) — k random items, no repeats'),
  ],
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const JAVA_CONSTRUCTIBLE = ['Scanner', 'ArrayList', 'HashMap', 'Random', 'StringBuilder'] as const

/** Types you call statically (`List.of`, `Optional.of`, `Math.abs`) — the class
 *  name itself is the receiver, no `new` and no variable to infer. */
const JAVA_STATIC_HOLDERS = new Set([
  'Math', 'Arrays', 'Collections', 'List', 'Map', 'Set', 'Optional', 'Collectors', 'Stream', 'Integer', 'Double',
])

function inferJavaType(doc: string, name: string): string | null {
  if (JAVA_STATIC_HOLDERS.has(name)) return name
  const esc = escapeRe(name)
  for (const type of JAVA_CONSTRUCTIBLE) {
    if (new RegExp(`\\b${type}\\b(?:<[^>]*>)?\\s+${esc}\\s*=\\s*new\\s+${type}\\b`).test(doc)) return type
  }
  if (new RegExp(`\\bString\\s+${esc}\\s*=`).test(doc)) return 'String'
  return null
}

function inferPythonType(doc: string, name: string): string | null {
  const esc = escapeRe(name)
  if (new RegExp(`^\\s*(?:import|from)\\s+${esc}\\b`, 'm').test(doc)) return name === 'math' || name === 'random' ? name : null
  const re = new RegExp(`\\b${esc}\\s*=\\s*([^\\n]+)`, 'g')
  let rhs: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(doc))) rhs = m[1].trim()
  if (!rhs) return null
  if (/^(?:f|r|rb|br|b)?["']/.test(rhs)) return 'str'
  if (rhs.startsWith('[')) return 'list'
  if (rhs.startsWith('{')) {
    if (rhs === '{}') return 'dict'
    const close = rhs.lastIndexOf('}')
    const body = close === -1 ? rhs.slice(1) : rhs.slice(1, close)
    return /:/.test(body) ? 'dict' : 'set'
  }
  if (/^str\s*\(/.test(rhs)) return 'str'
  if (/^list\s*\(/.test(rhs)) return 'list'
  if (/^dict\s*\(/.test(rhs)) return 'dict'
  if (/^set\s*\(/.test(rhs)) return 'set'
  return null
}

/** One-slot memo: the text before a given dot does not change while the member name after it is being typed. */
let memoKey = ''
let memoResult: string | null = null

function resolveReceiverType(lang: LangId, state: EditorState, name: string, dotPos: number): string | null {
  const key = `${lang}:${dotPos}:${name}`
  if (key === memoKey) return memoResult
  const doc = state.sliceDoc(0, dotPos)
  memoResult = lang === 'java' ? inferJavaType(doc, name) : inferPythonType(doc, name)
  memoKey = key
  return memoResult
}

const RECEIVER = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/
/** Identifiers longer than this cannot be receivers worth resolving; bounds the look-back slice. */
const LOOKBACK = 80

export function memberSource(lang: LangId): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const text = ctx.state.sliceDoc(Math.max(0, ctx.pos - LOOKBACK), ctx.pos)
    const m = RECEIVER.exec(text)
    if (!m) return null
    const name = m[1]
    const partial = m[2] ?? ''
    const dotPos = ctx.pos - partial.length - 1
    const from = ctx.pos - partial.length
    const typeKey = resolveReceiverType(lang, ctx.state, name, dotPos)
    if (!typeKey) return null
    const members = (lang === 'java' ? JAVA_MEMBERS : PYTHON_MEMBERS)[typeKey]
    if (!members) return null
    return { from, options: [...members], validFor: /^[\w$]*$/ }
  }
}
