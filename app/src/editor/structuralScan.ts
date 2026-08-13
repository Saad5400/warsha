import type { EditorLang } from './setup'

/**
 * The structural scanner — the half of "beginner mistakes" a plain parse can be
 * sure of by reading the raw text rather than the syntax tree: a bracket that
 * never closes, a string with no end quote, a Java char literal holding more
 * than one character, a Python block header missing its colon, a class name in
 * the wrong case, a Java statement with no `;`. These are the mistakes the Lezer
 * grammar either swallows into a cascade of error nodes far from the real spot
 * (a dropped `}` reported at end of file) or cannot see at all (`system` parses
 * as a valid name), so they slip past lint.ts today.
 *
 * It runs only for Java and Python — the two languages Warsha teaches — and only
 * when the "Beginner helper" extension is on, so it stays out of the always-on
 * rules in lint.ts. The output is plain data: lint.ts turns each issue into a
 * Diagnostic with a message and a one-tap fix. Keeping detection free of
 * CodeMirror and of copy is what lets it be exercised on a bare string.
 *
 * Same doctrine as lint.ts: when in doubt, stay quiet. The tokeniser blanks
 * comments and strings into a "code view" before it counts a bracket, checks a
 * case, or judges a missing `;`, so nothing here fires on a brace inside a
 * string or a keyword in a comment. The missing-`;` rule in particular is built
 * to under-report (it stays silent on array initialisers, lambda tails and
 * anything mid-expression) rather than risk a red line under valid code.
 */

export type StructuralKind =
  | 'bracket-unclosed'
  | 'bracket-stray'
  | 'bracket-mismatch'
  | 'string-unterminated'
  | 'java-char-literal'
  | 'py-missing-colon'
  | 'java-case'
  | 'java-missing-semicolon'

export interface StructuralIssue {
  kind: StructuralKind
  from: number
  to: number
  /** The bracket or quote the message and fix key on (`(`, `}`, `"`, …). */
  ch?: string
  /** The corrected text a fix inserts: the `"…"` for a char literal, or the
   *  right-cased class name for a case typo. */
  replacement?: string
}

export interface ScanResult {
  issues: StructuralIssue[]
  /** True when the text is broken in a way that makes the grammar's own error
   *  nodes downstream noise — the caller drops those in favour of the precise
   *  issues here. */
  brokeStructure: boolean
}

const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' }
const CLOSE_TO_OPEN: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** Issues that leave the rest of the parse unreliable, so `brokeStructure`
 *  hides the grammar's follow-on error nodes behind the one precise mark here.
 *  A case typo is not here — `system.out` parses fine, it just resolves wrong. */
const CASCADING: ReadonlySet<StructuralKind> = new Set<StructuralKind>([
  'bracket-unclosed',
  'bracket-stray',
  'bracket-mismatch',
  'string-unterminated',
  'py-missing-colon',
  'java-missing-semicolon',
])

/** A soft ceiling, mirroring lint.ts: a wall of marks teaches nothing. */
const MAX_ISSUES = 50

/** Sentinel a string collapses to in the code view: a value token that ends a
 *  statement (so `s = "hi"` still reads as finished) but never merges with an
 *  identifier or opens a real string. */
const STRING_MARK = '"'

const isSpace = (c: string) => c === ' ' || c === '\t'
const isWord = (c: string) => /[A-Za-z0-9_$]/.test(c)

/** Walk a single-line string from its opening quote at `start`; returns the
 *  index just past the closing quote, or flags it unterminated at the line end. */
function scanQuoted(doc: string, start: number, quote: string, issues: StructuralIssue[]): number {
  const n = doc.length
  let i = start + 1
  while (i < n) {
    const c = doc[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '\n') break
    if (c === quote) return i + 1
    i++
  }
  issues.push({ kind: 'string-unterminated', from: start, to: i, ch: quote })
  return i
}

/** Java `'…'`: one character, or a compile error. Flags anything that is not a
 *  single char / valid escape, offering the double-quoted string as the fix. */
function scanJavaChar(doc: string, start: number, issues: StructuralIssue[]): number {
  const n = doc.length
  let i = start + 1
  while (i < n) {
    const c = doc[i]
    if (c === '\n') break
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === "'") {
      const inner = doc.slice(start + 1, i)
      if (!isSingleJavaChar(inner)) {
        issues.push({
          kind: 'java-char-literal',
          from: start,
          to: i + 1,
          replacement: `"${inner.replace(/"/g, '\\"')}"`,
        })
      }
      return i + 1
    }
    i++
  }
  issues.push({ kind: 'string-unterminated', from: start, to: i, ch: "'" })
  return i
}

function isSingleJavaChar(inner: string): boolean {
  if (inner.length === 1) return inner !== '\\'
  if (inner[0] === '\\') {
    if (/^\\u[0-9a-fA-F]{4}$/.test(inner)) return true
    if (/^\\[btnfr0'"\\]$/.test(inner)) return true
    if (/^\\[0-3]?[0-7]{1,2}$/.test(inner)) return true // octal escape
  }
  return false
}

const readWord = (doc: string, from: number, to: number): string => {
  let i = from
  while (i < to && /[A-Za-z_]/.test(doc[i])) i++
  return doc.slice(from, i)
}

/** Comments → spaces, strings → one STRING_MARK then spaces; newlines survive so
 *  every offset still lines up with `doc`. Lets the line-oriented rules below
 *  reason about structure without ever seeing inside a string or comment. */
function toCodeView(doc: string, stringSpans: [number, number][], commentSpans: [number, number][]): string {
  const a = doc.split('')
  for (const [s, e] of commentSpans) for (let p = s; p < e; p++) if (a[p] !== '\n') a[p] = ' '
  for (const [s, e] of stringSpans) for (let p = s; p < e; p++) if (a[p] !== '\n') a[p] = p === s ? STRING_MARK : ' '
  return a.join('')
}

/** Python compound-statement heads that must end in a colon. */
const PY_BLOCK_KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'elif', 'else', 'for', 'while', 'def', 'class', 'try', 'except', 'finally', 'with',
])

/**
 * A Python block header with no trailing colon — `for i in range(10)` before its
 * body. Checked line by line on the code view, but only when the line begins at
 * bracket depth 0 (so a `for` clause continued inside a comprehension's `[` is
 * left alone) and its first word is a block keyword. Continuation lines (open
 * bracket or trailing `\`) are skipped rather than guessed at.
 */
function pyMissingColons(code: string, issues: StructuralIssue[]): void {
  const n = code.length
  let pos = 0
  let depth = 0
  while (pos < n) {
    const ls = pos
    let le = code.indexOf('\n', ls)
    if (le === -1) le = n

    let k = ls
    while (k < le && isSpace(code[k])) k++

    const startDepth = depth
    for (let p = ls; p < le; p++) {
      const ch = code[p]
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1)
    }

    if (startDepth === 0 && k < le && PY_BLOCK_KEYWORDS.has(readWord(code, k, le))) {
      let ce = le
      while (ce > k && isSpace(code[ce - 1])) ce--
      const last = ce > k ? code[ce - 1] : ''
      const continued = depth > startDepth || last === '\\'
      if (last && last !== ':' && !continued) {
        issues.push({ kind: 'py-missing-colon', from: k, to: k + readWord(code, k, le).length })
      }
    }
    pos = le + 1
  }
}

/** Well-known JDK classes and the case they should have. Type position (`string
 *  s`, `new scanner()`) is safe for all of these — no such lowercase type
 *  exists. None here collides with a primitive keyword (`boolean`, `double`…),
 *  so a valid `boolean b` is never touched. */
const CASE_TYPES = new Map<string, string>([
  ['string', 'String'], ['integer', 'Integer'], ['character', 'Character'],
  ['scanner', 'Scanner'], ['system', 'System'], ['math', 'Math'], ['object', 'Object'],
  ['stringbuilder', 'StringBuilder'], ['arrays', 'Arrays'], ['arraylist', 'ArrayList'],
  ['list', 'List'], ['map', 'Map'], ['set', 'Set'], ['hashmap', 'HashMap'], ['hashset', 'HashSet'],
  ['collections', 'Collections'], ['exception', 'Exception'], ['thread', 'Thread'],
])

/** The subset also safe in receiver position (`system.out`): names a student
 *  would never pick for a variable. `string`/`scanner`/`list` are excluded —
 *  `scanner.next()` on a variable named `scanner` is normal, not a typo. */
const CASE_RECEIVERS = new Map<string, string>([
  ['system', 'System'], ['math', 'Math'], ['arrays', 'Arrays'],
  ['collections', 'Collections'], ['integer', 'Integer'], ['character', 'Character'],
])

/** `system.out`, `string name`, `new scanner()` — a known class miscased. Only
 *  fires where the identifier is unmistakably a type or a class receiver, so a
 *  variable that merely shares a class's letters is never flagged. */
function javaCaseTypos(code: string, issues: StructuralIssue[]): void {
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const word = m[0]
    const idx = m.index
    const lower = word.toLowerCase()
    if (!CASE_TYPES.has(lower) && !CASE_RECEIVERS.has(lower)) continue

    let p = idx - 1
    while (p >= 0 && isSpace(code[p])) p--
    if (p >= 0 && code[p] === '.') continue // a member (`foo.system`), not a type

    let prevStart = p
    while (prevStart >= 0 && isWord(code[prevStart])) prevStart--
    const prevWord = code.slice(prevStart + 1, p + 1)

    let q = idx + word.length
    while (q < code.length && isSpace(code[q])) q++
    const next = code[q] ?? ''

    const typePos = /[A-Za-z_$]/.test(next) || prevWord === 'new'
    const receiverPos = next === '.'
    const correct = typePos ? CASE_TYPES.get(lower) : receiverPos ? CASE_RECEIVERS.get(lower) : undefined
    if (!correct || correct === word) continue

    issues.push({ kind: 'java-case', from: idx, to: idx + word.length, ch: word, replacement: correct })
  }
}

/** Line heads that never take a trailing `;` of their own. */
const JAVA_BLOCK_HEADS: ReadonlySet<string> = new Set([
  'if', 'else', 'for', 'while', 'switch', 'do', 'try', 'catch', 'finally', 'synchronized',
])

/** If the next line begins with one of these, this line was not finished — it is
 *  a method chain, a split expression, or a block/label body. `}` is absent on
 *  purpose: a statement followed by the closing brace is the common real case. */
const JAVA_CONTINUES: ReadonlySet<string> = new Set([
  '.', '+', '-', '*', '/', '%', '?', ':', '&', '|', '^', '=', '<', '>', ')', ']', '{', ',', ';',
])

/** A char that can end a finished expression (identifier/number tail, a call or
 *  index close, or a string). Anything else — an operator, `{`, `,` — means the
 *  line is still going. */
const endsExpression = (c: string) => isWord(c) || c === ')' || c === ']' || c === STRING_MARK

/**
 * A Java statement with no `;`. This is the rule most able to cry wolf, so it is
 * deliberately timid: it works on the code view, and only marks a line when it
 * is a self-contained statement — balanced on `()`/`[]`, not inside an array
 * initialiser or enum body, not a block header (`if`, `for`, a method signature
 * ending in `{`), ending in something that finishes an expression, and followed
 * by a line that does not continue it. When any of that is unclear it stays
 * silent (missing `;` after a `}` initialiser, for one), leaving it to Run.
 */
function javaMissingSemicolons(code: string, issues: StructuralIssue[]): void {
  const n = code.length
  const lines: [number, number][] = []
  {
    let s = 0
    for (let i = 0; i < n; i++) {
      if (code[i] === '\n') {
        lines.push([s, i])
        s = i + 1
      }
    }
    lines.push([s, n])
  }

  let round = 0
  const braces: ('block' | 'init' | 'enum')[] = []
  let prevSig = ''

  const firstSig = (li: number): string => {
    for (let p = lines[li][0]; p < lines[li][1]; p++) if (!isSpace(code[p])) return code[p]
    return ''
  }
  const nextLineStart = (li: number): string => {
    for (let j = li + 1; j < lines.length; j++) {
      const f = firstSig(j)
      if (f) return f
    }
    return ''
  }

  for (let li = 0; li < lines.length; li++) {
    const [ls, le] = lines[li]
    let k = ls
    while (k < le && isSpace(code[k])) k++
    const firstChar = k < le ? code[k] : ''
    const firstWord = readWord(code, k, le)

    const startRound = round
    let lastSig = ''
    let lastPos = -1
    for (let p = ls; p < le; p++) {
      const ch = code[p]
      if (isSpace(ch)) continue
      if (ch === '(' || ch === '[') round++
      else if (ch === ')' || ch === ']') round = Math.max(0, round - 1)
      else if (ch === '{') braces.push(firstWord === 'enum' ? 'enum' : prevSig === '=' || prevSig === ',' || prevSig === ']' ? 'init' : 'block')
      else if (ch === '}') braces.pop()
      lastSig = ch
      lastPos = p
      prevSig = ch
    }

    if (lastPos < 0) continue
    if (startRound !== 0 || round !== 0) continue // mid-expression across lines
    const top = braces.length ? braces[braces.length - 1] : 'block'
    if (top === 'init' || top === 'enum') continue
    if (firstChar === '@' || JAVA_BLOCK_HEADS.has(firstWord)) continue
    if (!endsExpression(lastSig)) continue
    const nxt = nextLineStart(li)
    if (nxt && JAVA_CONTINUES.has(nxt)) continue

    issues.push({ kind: 'java-missing-semicolon', from: lastPos, to: lastPos + 1 })
  }
}

/** Scan `doc` for the structural mistakes above. `lang` gates the ruleset; only
 *  Java and Python are analysed, anything else returns no issues. */
export function scanStructural(doc: string, lang: EditorLang): ScanResult {
  if (lang !== 'java' && lang !== 'python') return { issues: [], brokeStructure: false }

  const issues: StructuralIssue[] = []
  const stack: { ch: string; pos: number }[] = []
  const stringSpans: [number, number][] = []
  const commentSpans: [number, number][] = []
  const n = doc.length
  let i = 0

  const lineEnd = (p: number) => {
    const nl = doc.indexOf('\n', p)
    return nl === -1 ? n : nl
  }

  while (i < n) {
    const c = doc[i]

    if (lang === 'java' && c === '/' && doc[i + 1] === '/') {
      const s = i
      i = lineEnd(i)
      commentSpans.push([s, i])
      continue
    }
    if (lang === 'python' && c === '#') {
      const s = i
      i = lineEnd(i)
      commentSpans.push([s, i])
      continue
    }
    if (lang === 'java' && c === '/' && doc[i + 1] === '*') {
      const s = i
      const end = doc.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      commentSpans.push([s, i])
      continue
    }

    if (c === '"' || c === "'") {
      const from = i
      // Triple quotes: Python strings and Java text blocks, which may span lines.
      if (doc[i + 1] === c && doc[i + 2] === c) {
        const triple = c + c + c
        const end = doc.indexOf(triple, i + 3)
        if (end === -1) {
          issues.push({ kind: 'string-unterminated', from, to: n, ch: triple })
          i = n
        } else {
          i = end + 3
        }
        stringSpans.push([from, i])
        continue
      }
      i = lang === 'java' && c === "'" ? scanJavaChar(doc, i, issues) : scanQuoted(doc, i, c, issues)
      stringSpans.push([from, i])
      continue
    }

    if (c === '(' || c === '[' || c === '{') {
      stack.push({ ch: c, pos: i })
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      const top = stack[stack.length - 1]
      if (!top) {
        issues.push({ kind: 'bracket-stray', from: i, to: i + 1, ch: c })
      } else if (top.ch !== CLOSE_TO_OPEN[c]) {
        issues.push({ kind: 'bracket-mismatch', from: i, to: i + 1, ch: c })
        stack.pop()
      } else {
        stack.pop()
      }
      i++
      continue
    }

    i++
  }

  for (const open of stack) {
    issues.push({ kind: 'bracket-unclosed', from: open.pos, to: open.pos + 1, ch: open.ch })
  }

  const code = toCodeView(doc, stringSpans, commentSpans)
  if (lang === 'python') {
    pyMissingColons(code, issues)
  } else {
    javaCaseTypos(code, issues)
    // A missing `;` only makes sense once the brackets balance; a real imbalance
    // already has its own precise mark, and guessing statements through it is noise.
    if (!stack.length) javaMissingSemicolons(code, issues)
  }

  issues.sort((a, b) => a.from - b.from || a.to - b.to)
  if (issues.length > MAX_ISSUES) issues.length = MAX_ISSUES
  return { issues, brokeStructure: issues.some((x) => CASCADING.has(x.kind)) }
}

export { OPEN_TO_CLOSE }
