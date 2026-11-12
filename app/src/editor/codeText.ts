/**
 * The text-level vocabulary every editor feature that reads Java or Python *as
 * text* shares: what a type looks like, the keywords, comment/string masking,
 * bracket matching, and "which names are declared before here". One copy, so
 * the completion sources, the receiver resolver, the type index and the name
 * suggester can never disagree about what `Map<String, Integer>[]` is.
 *
 * A leaf on purpose — it imports nothing from the editor, so any module can use
 * it without an import cycle. (structuralScan.ts keeps its own tokenizer: it
 * also *reports* unterminated literals, which a mask cannot.)
 */

export type TextLang = 'java' | 'python'

/* ---------------------------------------------------------------- keywords */

export const KEYWORDS: Record<TextLang, readonly string[]> = {
  java: `abstract assert boolean break byte case catch char class continue default do double else enum extends
final finally float for if implements import instanceof int interface long new package private protected public
return short static super switch this throw throws try void while true false null
var record sealed permits yield synchronized transient volatile native strictfp`.split(/\s+/),
  python: `and as assert async await break class continue def del elif else except False finally for from global
if import in is lambda None nonlocal not or pass raise return True try while with yield case`.split(/\s+/),
}

/** Words that can never name a variable: the keywords, plus Java's reserved-but-unused pair. */
export const RESERVED_WORDS: Record<TextLang, ReadonlySet<string>> = {
  java: new Set([...KEYWORDS.java, 'goto', 'const']),
  python: new Set(KEYWORDS.python),
}

/* -------------------------------------------------------------- java types */

export const JAVA_PRIMS: ReadonlySet<string> = new Set(['int', 'long', 'short', 'byte', 'double', 'float', 'boolean', 'char'])

export const JAVA_MODIFIERS = [
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'default', 'synchronized', 'native',
  'transient', 'volatile', 'strictfp', 'sealed', 'non-sealed',
] as const

/** Regex source: zero or more modifiers, each followed by whitespace. */
export const JAVA_MODIFIERS_RE = `(?:(?:${JAVA_MODIFIERS.join('|')})\\s+)*`

/** Regex source for type arguments: only what a type can contain — names, dots, commas, `?`,
 *  `[]`, one nested level — so a comparison like `n < 1 || n >` never reads as generics. */
const TYPE_ARGS = String.raw`<(?:[\w$.,\s?\[\]]|<[\w$.,\s?\[\]]*>)*>`

/** Regex source for a written Java type: `java.util.List`, `Map<String, List<Integer>>`, `int[][]`. */
export const JAVA_TYPE = String.raw`(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*(?:\s*${TYPE_ARGS})?(?:\s*\[\s*\])*`

/** Words a `Type name` regex can catch in the type slot that are not types (`return x;`, `new Foo`). */
export const JAVA_NOT_A_TYPE: ReadonlySet<string> = new Set([
  'return', 'new', 'throw', 'else', 'case', 'package', 'import', 'yield', 'goto', 'assert', 'instanceof', 'class',
  'interface', 'enum', 'record', 'extends', 'implements', 'throws', 'break', 'continue', 'default', 'do', 'try',
  'this', 'super', 'null', 'true', 'false', 'permits', 'sealed', 'void',
])

/** Is this captured type-slot text really a type? Lowercase words only when primitive or `var`. */
export function isJavaTypeWord(t: string): boolean {
  const s = t.replace(/\s+/g, '')
  if (JAVA_NOT_A_TYPE.has(s)) return false
  if (/^[a-z_$][\w$]*$/.test(s)) return JAVA_PRIMS.has(s) || s === 'var'
  return true
}

/** Regex source for `catch (A | B name` — group 1 is the first alternative. `name` defaults to any identifier. */
export const javaCatchRe = (name = '[A-Za-z_$][\\w$]*') =>
  `\\bcatch\\s*\\(\\s*(?:final\\s+)?([\\w$.]+)(?:\\s*\\|\\s*[\\w$.]+)*\\s+(${name})`

/** `ArrayList<String>[]` → `ArrayList` (package kept). */
export const baseOf = (t: string) => t.replace(/\s+/g, '').replace(/<.*$/s, '').replace(/(\[\])+$/, '')
/** `java.util.ArrayList<String>[]` → `ArrayList`. */
export const simpleName = (t: string) => baseOf(t).replace(/^.*\./, '')
/** `Map<String, List<Integer>>` → [`String`, `List<Integer>`]. */
export function typeArgs(t: string): string[] {
  const lt = t.indexOf('<')
  if (lt === -1) return []
  return splitTopLevel(t.slice(lt + 1, t.lastIndexOf('>')))
}
export const isThrowableName = (name: string) => /(?:Exception|Error|Throwable)$/.test(name)

/* --------------------------------------------------------------- brackets */

/** Splits on `sep` outside <>, (), [] — `Map<K, V> m, int x`. Empty parts dropped. */
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

const PAIRS: Record<string, string> = { '{': '}', '(': ')', '[': ']', '<': '>' }
const PAIRS_BACK: Record<string, string> = { '}': '{', ')': '(', ']': '[', '>': '<' }

/** Index of the bracket closing the one at `open`, or the text's end when unclosed. */
export function matchBracket(text: string, open: number): number {
  const o = text[open]
  const c = PAIRS[o]
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++
    else if (text[i] === c && --depth === 0) return i
  }
  return text.length
}

/** Index of the bracket opening the one at `close`, or -1 when unopened. */
export function matchBack(text: string, close: number): number {
  const c = text[close]
  const o = PAIRS_BACK[c]
  let depth = 0
  for (let i = close; i >= 0; i--) {
    if (text[i] === c) depth++
    else if (text[i] === o && --depth === 0) return i
  }
  return -1
}

/* ----------------------------------------------------------------- masking */

/** Comments and the *inside* of string/char literals blanked to spaces; quotes,
 *  newlines and every offset kept. Brackets and regexes then never trip over
 *  `"{"` or `// }`, and a literal still reads as a literal (`"   ".length()`). */
export function maskCode(lang: TextLang, src: string): string {
  return lang === 'java' ? maskJava(src) : maskPython(src)
}

function maskJava(src: string): string {
  const out = src.split('')
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') out[i++] = ' '
    } else if (c === '/' && next === '*') {
      out[i] = out[i + 1] = ' '
      i += 2
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
        if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') out[i++] = ' '
        out[i++] = ' '
      }
      i++
    } else i++
  }
  return out.join('')
}

function maskPython(src: string): string {
  const out = src.split('')
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    if (c === '#') {
      while (i < n && src[i] !== '\n') out[i++] = ' '
    } else if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i)
      const q = triple ? c.repeat(3) : c
      i += q.length
      while (i < n && !src.startsWith(q, i) && (triple || src[i] !== '\n')) {
        if (src[i] === '\\' && i + 1 < n && src[i + 1] !== '\n') out[i++] = ' '
        if (src[i] !== '\n') out[i] = ' '
        i++
      }
      i += q.length
    } else i++
  }
  return out.join('')
}

/* --------------------------------------------------------- declared names */

export type IdentRole = 'variable' | 'function' | 'class'

/** The `Type name` slot of a declaration — primitives, `String`, `var` or any Capitalised type. */
const DECL_TYPE = `(?:${[...JAVA_PRIMS].join('|')}|var|[A-Z][\\w$]*)(?:\\s*${TYPE_ARGS})?(?:\\s*\\[\\s*\\])*`

/** Best-effort "this name was declared here" (locals, parameters, fields, methods,
 *  classes; Python assignments, loop/with/except targets). Reads the text given;
 *  a false positive only ever nudges ranking or numbers a suggested name. */
export function declaredNames(lang: TextLang, doc: string): Map<string, IdentRole> {
  const out = new Map<string, IdentRole>()
  const add = (name: string | undefined, role: IdentRole) => {
    if (name && !out.has(name)) out.set(name, role)
  }
  if (lang === 'java') {
    for (const m of doc.matchAll(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'class')
    // `Type name` in a declaration / parameter / for-each (the name is followed by = ; , ) or :).
    for (const m of doc.matchAll(new RegExp(`\\b${DECL_TYPE}\\s+([a-z_$][\\w$]*)\\s*(?=[=;,):])`, 'g'))) add(m[1], 'variable')
    for (const m of doc.matchAll(new RegExp(javaCatchRe(), 'g'))) add(m[2], 'variable')
    // `returnType name(` — a method declaration (a preceding type rules out a bare call).
    for (const m of doc.matchAll(new RegExp(`\\b${DECL_TYPE}\\s+([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')))
      if (!out.has(m[1])) add(m[1], 'function')
  } else {
    for (const m of doc.matchAll(/\bdef\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'function')
    for (const m of doc.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'class')
    for (const m of doc.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*(?:[-+*/%|&^@]|\/\/|\*\*|>>|<<)?=(?!=)/gm)) add(m[1], 'variable')
    for (const m of doc.matchAll(/\bfor\s+([A-Za-z_$][\w$]*)\s+in\b/g)) add(m[1], 'variable')
    for (const m of doc.matchAll(/\bas\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'variable')
    for (const m of doc.matchAll(/\bdef\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g))
      for (const p of m[1].split(',')) {
        const n = p.trim().replace(/^\*+/, '').split(/[:=]/)[0].trim()
        if (n && n !== 'self' && /^[A-Za-z_$][\w$]*$/.test(n)) add(n, 'variable')
      }
  }
  return out
}
