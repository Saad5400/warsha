import {
  completeFromList,
  ifNotIn,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import type { LangId } from '../runtime'

/**
 * Completions and snippets — the "where is the IntelliSense?" layer.
 *
 * Three sources per language, ranked so the most useful thing is on top:
 *
 *   1. **Snippets** (`boost: 60`) — `sout`, `psvm`, `fori`. Deliberately the same
 *      abbreviations IntelliJ and VS Code use, because a student who has seen a
 *      teacher type `sout` in class will try `sout` here, and the muscle memory
 *      is worth more than any name we could invent.
 *   2. **Keywords + a small beginner API dictionary** (`boost: 20` / `10`) — the
 *      names from the first four weeks of a course, each with a plain-English
 *      `detail`. This is a hand-written list, not semantic analysis: it does not
 *      know the type of `sc`, so it offers `nextLine` wherever a word is being
 *      typed. Real type-aware completion is v0.2.
 *   3. **Identifiers already in the project** (`boost: 0`) — every word in the
 *      open file plus every word in every other file, so `studentName` completes
 *      after you have typed it once, anywhere.
 *
 * Snippet templates use `${name}` for a tab stop and a leading tab per level;
 * CodeMirror expands each tab to the editor's `indentUnit` and re-indents to the
 * line the snippet lands on. Tab / Shift-Tab walk the stops, Escape leaves them.
 */

/* ------------------------------------------------------------------ snippets */

const snip = (label: string, template: string, detail: string): Completion =>
  snippetCompletion(template, { label, detail, type: 'snippet', boost: 60 })

/** Java. `sout` / `souf` / `psvm` are IntelliJ's abbreviations, on purpose. */
export const JAVA_SNIPPETS: readonly Completion[] = [
  snip('sout', 'System.out.println(${});', 'print a line'),
  snip('souf', 'System.out.printf("${%s}%n", ${value});', 'print with a format'),
  snip('serr', 'System.err.println(${});', 'print to the error stream'),
  snip('psvm', 'public static void main(String[] args) {\n\t${}\n}', 'the main method'),
  snip('main', 'public static void main(String[] args) {\n\t${}\n}', 'the main method'),
  snip('fori', 'for (int i = 0; i < ${count}; i++) {\n\t${}\n}', 'count from 0'),
  snip('foreach', 'for (${String} ${item} : ${items}) {\n\t${}\n}', 'loop over a list or array'),
  snip('while', 'while (${condition}) {\n\t${}\n}', 'repeat while true'),
  snip('ifelse', 'if (${condition}) {\n\t${}\n} else {\n\t\n}', 'if / else'),
  snip('class', 'class ${Name} {\n\t${}\n}', 'a class'),
  snip('method', 'public ${void} ${name}(${}) {\n\t\n}', 'a method'),
  snip('scanner', 'Scanner ${sc} = new Scanner(System.in);', 'read what the user types'),
  snip('try', 'try {\n\t${}\n} catch (${Exception} e) {\n\tSystem.out.println(e.getMessage());\n}', 'try / catch'),
]

export const PYTHON_SNIPPETS: readonly Completion[] = [
  snip('main', 'if __name__ == "__main__":\n\t${}', 'run this when the file runs'),
  snip('def', 'def ${name}(${}):\n\t${}', 'a function'),
  snip('fori', 'for i in range(${n}):\n\t${}', 'count from 0'),
  snip('foreach', 'for ${item} in ${items}:\n\t${}', 'loop over a list'),
  snip('while', 'while ${condition}:\n\t${}', 'repeat while true'),
  snip('ifelse', 'if ${condition}:\n\t${}\nelse:\n\t', 'if / else'),
  snip('class', 'class ${Name}:\n\tdef __init__(self, ${}):\n\t\t${}', 'a class'),
  snip('input', '${name} = input("${What is your name?} ")', 'ask the user for something'),
  snip('tryex', 'try:\n\t${}\nexcept ${Exception} as e:\n\tprint(e)', 'try / except'),
  snip('fstr', 'f"${text} {${value}}"', 'put a value inside text'),
]

/* ------------------------------------------------------------------ keywords */

const KEYWORDS: Record<LangId, readonly string[]> = {
  java: `abstract assert boolean break byte case catch char class continue default do double else enum extends
final finally float for if implements import instanceof int interface long new package private protected public
return short static super switch this throw throws try void while true false null`.split(/\s+/),
  python: `and as assert async await break class continue def del elif else except False finally for from global
if import in is lambda None nonlocal not or pass raise return True try while with yield`.split(/\s+/),
}

/* ------------------------------------------------- beginner API dictionaries */

/** `[label, detail]`. Kept to what a first-year course actually uses. */
const JAVA_API: readonly (readonly [string, string])[] = [
  ['System.out.println', 'print a line'],
  ['System.out.print', 'print with no line break'],
  ['System.out.printf', 'print with a format'],
  ['System.err.println', 'print to the error stream'],
  ['println', 'print a line'],
  ['print', 'print with no line break'],
  ['printf', 'print with a format'],
  ['Scanner', 'reads what the user types'],
  ['nextLine', 'read one whole line'],
  ['nextInt', 'read a whole number'],
  ['nextDouble', 'read a decimal number'],
  ['next', 'read one word'],
  ['hasNextLine', 'is there another line?'],
  ['hasNextInt', 'is the next thing a number?'],
  ['length', 'how many characters'],
  ['charAt', 'the character at a position'],
  ['substring', 'a piece of the text'],
  ['equals', 'are these the same?'],
  ['equalsIgnoreCase', 'the same, ignoring capitals'],
  ['toUpperCase', 'ALL CAPITALS'],
  ['toLowerCase', 'all lower case'],
  ['trim', 'remove spaces at both ends'],
  ['split', 'break text into pieces'],
  ['contains', 'does it contain this?'],
  ['indexOf', 'where this appears, or -1'],
  ['replace', 'swap one piece for another'],
  ['isEmpty', 'is it empty?'],
  ['toString', 'this object as text'],
  ['String.valueOf', 'a number as text'],
  ['Integer.parseInt', 'text as a whole number'],
  ['Double.parseDouble', 'text as a decimal number'],
  ['Math.abs', 'distance from zero'],
  ['Math.max', 'the larger of two'],
  ['Math.min', 'the smaller of two'],
  ['Math.pow', 'to the power of'],
  ['Math.sqrt', 'square root'],
  ['Math.round', 'to the nearest whole number'],
  ['Math.random', 'a random number from 0 to 1'],
  ['ArrayList', 'a list that can grow'],
  ['add', 'put something in'],
  ['get', 'the item at a position'],
  ['set', 'replace the item at a position'],
  ['size', 'how many items'],
  ['remove', 'take something out'],
  ['HashMap', 'pairs of key and value'],
  ['put', 'store a value under a key'],
  ['containsKey', 'is this key in there?'],
  ['getMessage', 'what went wrong, as text'],
]

const PYTHON_API: readonly (readonly [string, string])[] = [
  ['print', 'show something'],
  ['input', 'ask the user for something'],
  ['len', 'how many'],
  ['range', 'a run of numbers'],
  ['str', 'as text'],
  ['int', 'as a whole number'],
  ['float', 'as a decimal number'],
  ['bool', 'as True or False'],
  ['list', 'as a list'],
  ['dict', 'as pairs of key and value'],
  ['set', 'as a set, with no repeats'],
  ['tuple', 'as a tuple that cannot change'],
  ['sum', 'add them all up'],
  ['min', 'the smallest'],
  ['max', 'the largest'],
  ['abs', 'distance from zero'],
  ['round', 'to the nearest whole number'],
  ['sorted', 'in order'],
  ['reversed', 'back to front'],
  ['enumerate', 'each item with its position'],
  ['zip', 'pair two lists up'],
  ['type', 'what kind of thing is this'],
  ['isinstance', 'is it this kind of thing?'],
  ['upper', 'ALL CAPITALS'],
  ['lower', 'all lower case'],
  ['strip', 'remove spaces at both ends'],
  ['split', 'break text into pieces'],
  ['join', 'glue pieces together'],
  ['replace', 'swap one piece for another'],
  ['startswith', 'does it start with this?'],
  ['endswith', 'does it end with this?'],
  ['find', 'where this appears, or -1'],
  ['format', 'fill in the blanks'],
  ['append', 'add to the end of a list'],
  ['extend', 'add all of another list'],
  ['insert', 'add at a position'],
  ['pop', 'take the last one out'],
  ['sort', 'put a list in order'],
  ['reverse', 'turn a list back to front'],
  ['index', 'where an item is'],
  ['count', 'how many times it appears'],
  ['keys', 'all the keys'],
  ['values', 'all the values'],
  ['items', 'every key and value'],
  ['get', 'the value for a key'],
  ['update', 'merge in more pairs'],
  ['self', 'this object, inside a class'],
  ['__init__', 'set a new object up'],
]

/* ------------------------------------------------------------------- sources */

const WORD_BEFORE = /[\w$]+/
/** Words shorter than this are noise; they match half the file. */
const MIN_IDENT_CHARS = 2

const staticOptions = (lang: LangId): Completion[] => {
  const api = lang === 'java' ? JAVA_API : PYTHON_API
  const snippets = lang === 'java' ? JAVA_SNIPPETS : PYTHON_SNIPPETS
  return [
    ...snippets,
    ...api.map(([label, detail]): Completion => ({
      label,
      detail,
      type: label.includes('.') ? 'method' : /^[A-Z]/.test(label) ? 'class' : 'function',
      boost: 10,
    })),
    ...KEYWORDS[lang].map((label): Completion => ({ label, type: 'keyword', boost: 20 })),
  ]
}

/**
 * Snippets, keywords and the API dictionary. Fires from the first character, so
 * typing `s` already offers `sout` — the abbreviations only pay off if they turn
 * up before you have finished typing them.
 */
function staticSource(lang: LangId): CompletionSource {
  const inner = completeFromList(staticOptions(lang))
  return (ctx: CompletionContext) => {
    if (!ctx.explicit && !ctx.matchBefore(WORD_BEFORE)) return null
    return inner(ctx)
  }
}

const IDENT = /[A-Za-z_$][\w$]*/g

/**
 * Every identifier in this file and in every other file in the project, so a
 * name only has to be typed once anywhere to complete everywhere.
 */
function identifierSource(projectWords: () => readonly string[]): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(WORD_BEFORE)
    if (!before || (before.to === before.from && !ctx.explicit)) return null
    if (!ctx.explicit && before.to - before.from < MIN_IDENT_CHARS) return null

    const seen = new Set<string>()
    const doc = ctx.state.doc.sliceString(0)
    let m: RegExpExecArray | null
    IDENT.lastIndex = 0
    while ((m = IDENT.exec(doc))) if (m[0].length > 2) seen.add(m[0])
    for (const w of projectWords()) seen.add(w)
    // The half-typed word itself is never a useful suggestion.
    seen.delete(before.text)

    return {
      from: before.from,
      options: [...seen].map((label) => ({ label, type: 'variable' })),
      validFor: /^[\w$]*$/,
    }
  }
}

/** Pull identifiers out of arbitrary source text — used across the project. */
export function wordsInSource(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  IDENT.lastIndex = 0
  while ((m = IDENT.exec(text))) if (m[0].length > 2) out.push(m[0])
  return out
}

/**
 * Node types where a suggestion popup is never wanted. A student typing a
 * sentence inside `println("...")` should not be offered `nextDouble`.
 */
const NOT_IN = ['String', 'TemplateString', 'FormatString', 'Comment', 'LineComment', 'BlockComment']

export function completionSources(lang: LangId | null, projectWords: () => readonly string[]): CompletionSource[] {
  const ident = ifNotIn(NOT_IN, identifierSource(projectWords))
  if (!lang) return [ident]
  return [ifNotIn(NOT_IN, staticSource(lang)), ident]
}

/** What shipped, for Education to review. Keyed the way the docs will want it. */
export const SNIPPET_MANIFEST = {
  java: JAVA_SNIPPETS.map((s) => s.label),
  python: PYTHON_SNIPPETS.map((s) => s.label),
} as const
