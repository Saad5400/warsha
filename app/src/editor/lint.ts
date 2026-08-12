import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import { linter, type Diagnostic, type Action } from '@codemirror/lint'
import { StateEffect, type EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { COPY } from '../copy'
import { isExtEnabled } from '../extensions/registry'
import { scanStructural, OPEN_TO_CLOSE, type StructuralIssue } from './structuralScan'
import type { EditorLang } from './setup'

/**
 * The static-analysis layer — the red line under code the editor can already
 * see is wrong, without waiting for Run.
 *
 * Warsha has no language server and no per-keystroke compiler (Run is where the
 * real ECJ/Roslyn/clang/Pyodide live), so this is deliberately NOT a type
 * checker. It is three things a plain parse can do honestly:
 *
 *   1. Syntax errors from the Lezer grammar itself. The grammars that back
 *      Java, Python, JavaScript, HTML and CSS emit error nodes for input they
 *      cannot parse; those become the red underline any editor draws for a
 *      half-typed or malformed line. C and C# run on the `clike` stream mode,
 *      which has no error nodes, so they get no syntax underline — better none
 *      than a wrong one.
 *
 *   2. A short, hand-picked list of beginner mistakes that PARSE but mean
 *      something other than the student intended — the ones worth a specific
 *      message and a one-tap fix. Every rule here walks the syntax tree rather
 *      than the raw text, so it never fires inside a string or a comment, and
 *      each is chosen to have effectively no false positives on a first-course
 *      program. When in doubt, a rule is left out: a linter that cries wolf on
 *      valid code is worse for a beginner than one that stays quiet.
 *
 *   3. The structural scan (editor/structuralScan.ts) — the mistakes the grammar
 *      loses in a cascade far from their source: an unclosed brace reported at
 *      end of file, a Python block with no colon, a string with no end quote. It
 *      reads raw text (skipping comments and strings) rather than the tree, so it
 *      names the exact bracket. This one is opt-in: it backs the default-on
 *      "Beginner helper" extension, and when it finds a real structural break it
 *      takes over from item 1, whose error nodes past the break are just noise.
 *
 * The fixes are the point of the feature ("auto fix suggestions"): each
 * `Diagnostic` that can be repaired mechanically carries an `Action` that
 * rewrites exactly the offending span, so the tooltip and the problems panel
 * both offer a button that does the edit.
 */

/** The languages a linter is attached to. The rest (`csharp`, `c`) get none. */
const LINTED: ReadonlySet<EditorLang> = new Set(['java', 'python', 'javascript', 'html', 'css'])

/** No red underline until a line has settled — mid-keystroke a grammar sees
 *  errors on nearly every incomplete line, and flashing them is noise. */
const LINT_DELAY = 500

/** A ceiling on syntax-error underlines: one broken brace can cascade into a
 *  wall of error nodes, and a screen of red teaches a beginner nothing. */
const MAX_SYNTAX_ERRORS = 50

/** Receiver expressions safe to call `.equals()` on with no wrapping parens —
 *  everything else (a `+` concatenation, a ternary) gets parenthesised so the
 *  method call still binds to the whole operand. */
const JAVA_PRIMARY: ReadonlySet<string> = new Set([
  'Identifier',
  'FieldAccess',
  'MethodInvocation',
  'ArrayAccess',
  'ParenthesizedExpression',
  'StringLiteral',
])

const text = (state: EditorState, node: { from: number; to: number }) =>
  state.doc.sliceString(node.from, node.to)

/** Replace the diagnostic's own span in a single dispatch — the shape every fix
 *  here takes. `from`/`to` come from CodeMirror, already mapped through any edits
 *  since the lint ran, so the fix lands on the right characters even if the
 *  student typed elsewhere in the meantime. */
function replace(insert: string): Action['apply'] {
  return (view, from, to) => {
    view.dispatch({ changes: { from, to, insert }, scrollIntoView: true })
    view.focus()
  }
}

/**
 * `name == "yes"` in Java compares object identity, not text, so it is almost
 * never what a student means — and it compiles, so Run won't tell them either.
 * Rewrite `a == "b"` to `a.equals("b")` (and `a != "b"` to `!a.equals("b")`),
 * parenthesising the receiver when precedence needs it.
 */
function javaStringEquals(state: EditorState, node: SyntaxNode, out: Diagnostic[]) {
  const op = node.getChild('CompareOp')
  if (!op) return
  const opText = text(state, op)
  if (opText !== '==' && opText !== '!=') return
  const left = node.firstChild
  const right = node.lastChild
  if (!left || !right || left === right) return
  const isString = (n: SyntaxNode) => n.name === 'StringLiteral'
  if (!isString(left) && !isString(right)) return

  const leftText = text(state, left)
  const receiver = JAVA_PRIMARY.has(left.name) ? leftText : `(${leftText})`
  const fixed = `${opText === '!=' ? '!' : ''}${receiver}.equals(${text(state, right)})`
  out.push({
    from: node.from,
    to: node.to,
    severity: 'warning',
    source: 'Warsha',
    message: COPY.lintJavaStringEquals,
    actions: [{ name: COPY.lintFixEquals, apply: replace(fixed) }],
  })
}

/**
 * `==` / `!=` in JavaScript coerce their two sides before comparing, which
 * surprises beginners (`0 == ""`, `1 == "1"`). Suggest the strict `===` / `!==`.
 * The one place `==` is idiomatic — `x == null`, which also catches `undefined`
 * — is deliberately left alone, so the fix never changes working behaviour.
 */
function jsLooseEquals(state: EditorState, node: SyntaxNode, out: Diagnostic[]) {
  const op = node.getChild('CompareOp')
  if (!op) return
  const opText = text(state, op)
  if (opText !== '==' && opText !== '!=') return
  const left = node.firstChild
  const right = node.lastChild
  const nullish = (n: SyntaxNode | null) =>
    !!n && (n.name === 'null' || (n.name === 'VariableName' && text(state, n) === 'undefined'))
  if (nullish(left) || nullish(right)) return

  const strict = opText === '==' ? '===' : '!=='
  out.push({
    from: op.from,
    to: op.to,
    severity: 'warning',
    source: 'Warsha',
    message: COPY.lintJsLooseEquals,
    actions: [{ name: COPY.lintFixStrictEquals(strict), apply: replace(strict) }],
  })
}

/**
 * `x == None` works but reads against the grain; `is` is how Python asks
 * "is this the None object", and it is the form every style guide and every
 * `None` check in the standard library uses. `==` → `is`, `!=` → `is not`.
 */
function pyNoneCompare(state: EditorState, node: SyntaxNode, out: Diagnostic[]) {
  const op = node.getChild('CompareOp')
  if (!op) return
  const opText = text(state, op)
  if (opText !== '==' && opText !== '!=') return
  const left = node.firstChild
  const right = node.lastChild
  if (left?.name !== 'None' && right?.name !== 'None') return

  const keyword = opText === '==' ? 'is' : 'is not'
  out.push({
    from: op.from,
    to: op.to,
    severity: 'warning',
    source: 'Warsha',
    message: COPY.lintPyEqNone,
    // The button names the whole `is None` / `is not None`; the edit only swaps
    // the operator, since the `None` operand is already there.
    actions: [
      { name: COPY.lintFixIsNone(`${keyword} None`), apply: replace(keyword) },
    ],
  })
}

/**
 * `print "hello"` is Python 2. In Python 3 `print` is a function and this line
 * is a genuine SyntaxError — it will not run — which is why the grammar keeps a
 * dedicated `PrintStatement` node for it and why this is an error, not a hint.
 *
 * The fix wraps the arguments in the call parentheses. It works off the whole
 * line, not the `PrintStatement` node: the grammar only takes the first
 * expression (`print a, b` parses as `print a` plus a stray comma), so the node
 * alone would drop the rest. A trailing `# comment` is kept outside the call,
 * and the line is marked seen so the stray comma does not also draw its own red
 * line.
 */
function pyPrint2(
  state: EditorState,
  tree: Tree,
  node: SyntaxNode,
  seenLines: Set<number>,
  out: Diagnostic[],
) {
  const keyword = node.firstChild
  if (!keyword || state.doc.sliceString(keyword.from, keyword.to) !== 'print') return
  const line = state.doc.lineAt(node.from)
  let to = line.to
  tree.iterate({
    from: keyword.to,
    to: line.to,
    enter(r) {
      if (r.name === 'Comment' && r.from < to) to = r.from
    },
  })
  const args = state.doc.sliceString(keyword.to, to).trim()
  if (!args) return
  seenLines.add(line.number)
  out.push({
    from: node.from,
    to,
    severity: 'error',
    source: 'Warsha',
    message: COPY.lintPyPrint2,
    actions: [{ name: COPY.lintFixPrintCall, apply: replace(`print(${args})`) }],
  })
}

/**
 * The generic red line: turn the grammar's own error nodes into diagnostics.
 * Zero-length error nodes (an insertion point where a token is missing) are
 * widened to cover one character so the underline is visible, and at most one
 * is reported per line so a single mistake never paints the whole file red.
 */
function syntaxErrors(state: EditorState, error: SyntaxNode, seenLines: Set<number>, out: Diagnostic[]) {
  if (out.length >= MAX_SYNTAX_ERRORS) return
  let from = error.from
  let to = error.to
  const line = state.doc.lineAt(from)
  if (from === to) {
    if (from < line.to) to = from + 1
    else if (from > line.from) from = from - 1
    else return // an empty line — nothing to underline
  }
  if (seenLines.has(line.number)) return
  seenLines.add(line.number)
  out.push({ from, to, severity: 'error', source: 'Warsha', message: COPY.lintSyntax })
}

/** Insert the matching closer at end of file, on its own line. */
function appendClosing(close: string): Action['apply'] {
  return (view) => {
    const end = view.state.doc.length
    const nl = end > 0 && view.state.doc.sliceString(end - 1, end) !== '\n' ? '\n' : ''
    view.dispatch({ changes: { from: end, to: end, insert: `${nl}${close}` }, scrollIntoView: true })
    view.focus()
  }
}

/** Insert `text` at the diagnostic's end — where a missing closing quote goes. */
function insertAtEnd(text: string): Action['apply'] {
  return (view, _from, to) => {
    view.dispatch({ changes: { from: to, to, insert: text }, scrollIntoView: true })
    view.focus()
  }
}

/** Add the `:` a Python block header is missing, before any trailing comment. */
const appendColon: Action['apply'] = (view, from) => {
  const line = view.state.doc.lineAt(from)
  const hash = line.text.indexOf('#')
  let end = hash === -1 ? line.text.length : hash
  while (end > 0 && (line.text[end - 1] === ' ' || line.text[end - 1] === '\t')) end--
  const pos = line.from + end
  view.dispatch({ changes: { from: pos, to: pos, insert: ':' }, scrollIntoView: true })
  view.focus()
}

/** One structural issue → a red Diagnostic. Fixes are computed against the live
 *  state at apply time, so they land correctly even after further typing. */
function structuralDiagnostic(iss: StructuralIssue): Diagnostic {
  const base = { from: iss.from, to: iss.to, severity: 'error' as const, source: 'Warsha' }
  switch (iss.kind) {
    case 'bracket-unclosed': {
      const close = OPEN_TO_CLOSE[iss.ch!]
      return {
        ...base,
        message: COPY.lintBracketUnclosed(iss.ch!, close),
        actions: [{ name: COPY.lintFixAddBracket(close), apply: appendClosing(close) }],
      }
    }
    case 'bracket-stray':
      return {
        ...base,
        message: COPY.lintBracketStray(iss.ch!),
        actions: [{ name: COPY.lintFixRemove(iss.ch!), apply: replace('') }],
      }
    case 'bracket-mismatch':
      return { ...base, message: COPY.lintBracketMismatch(iss.ch!) }
    case 'string-unterminated':
      return {
        ...base,
        message: COPY.lintStringUnterminated,
        actions: [{ name: COPY.lintFixCloseString, apply: insertAtEnd(iss.ch ?? '"') }],
      }
    case 'java-char-literal':
      return {
        ...base,
        message: COPY.lintCharLiteral,
        actions: [{ name: COPY.lintFixDoubleQuotes, apply: replace(iss.replacement ?? '') }],
      }
    case 'py-missing-colon':
      return {
        ...base,
        message: COPY.lintMissingColon,
        actions: [{ name: COPY.lintFixAddColon, apply: appendColon }],
      }
    case 'java-case':
      return {
        ...base,
        message: COPY.lintCaseTypo(iss.ch ?? '', iss.replacement ?? ''),
        actions: [{ name: COPY.lintFixUseCase(iss.replacement ?? ''), apply: replace(iss.replacement ?? '') }],
      }
    case 'java-missing-semicolon':
      return {
        ...base,
        message: COPY.lintMissingSemicolon,
        actions: [{ name: COPY.lintFixAddSemicolon, apply: insertAtEnd(';') }],
      }
  }
}

/** The opt-in structural scan: push its diagnostics, mark their lines seen so the
 *  grammar underline never doubles them, and report whether the parse is now too
 *  broken for the grammar's follow-on error nodes to be worth showing. */
function structuralPass(state: EditorState, lang: EditorLang, seenLines: Set<number>, out: Diagnostic[]): boolean {
  const { issues, brokeStructure } = scanStructural(state.doc.toString(), lang)
  for (const iss of issues) {
    seenLines.add(state.doc.lineAt(iss.from).number)
    out.push(structuralDiagnostic(iss))
  }
  return brokeStructure
}

/** Exported so the rules can be exercised against a bare `EditorState` in
 *  isolation; the app itself only ever reaches this through `linting` below.
 *  `beginnerHelper` gates the opt-in structural scan (extensions/registry.ts). */
export function diagnostics(
  state: EditorState,
  lang: EditorLang,
  opts: { beginnerHelper?: boolean } = {},
): Diagnostic[] {
  // The full document, not the viewport slice `syntaxTree` may hand back for a
  // large file — a student file is small enough to parse whole in the budget.
  const tree = ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state)
  const out: Diagnostic[] = []
  const seenLines = new Set<number>()
  // The scan runs first: its lines seed `seenLines`, and a real structural break
  // silences the grammar's cascade below in favour of its one precise mark.
  const brokeStructure = opts.beginnerHelper ? structuralPass(state, lang, seenLines, out) : false

  tree.iterate({
    enter(ref) {
      if (ref.type.isError) {
        if (!brokeStructure) syntaxErrors(state, ref.node, seenLines, out)
        return
      }
      switch (lang) {
        case 'java':
          if (ref.name === 'BinaryExpression') javaStringEquals(state, ref.node, out)
          break
        case 'javascript':
          if (ref.name === 'BinaryExpression') jsLooseEquals(state, ref.node, out)
          break
        case 'python':
          if (ref.name === 'BinaryExpression') pyNoneCompare(state, ref.node, out)
          else if (ref.name === 'PrintStatement') pyPrint2(state, tree, ref.node, seenLines, out)
          break
      }
    },
  })

  // CM renders in document order; sorting keeps overlapping marks predictable.
  return out.sort((a, b) => a.from - b.from || a.to - b.to)
}

/**
 * The lint extension for one language, or `[]` for a language Warsha does not
 * analyse. Lives in the per-language compartment in setup.ts, so switching or
 * renaming a file swaps the rule set (and clears the old file's diagnostics)
 * in the same reconfigure that swaps the grammar.
 */
/** Dispatched by setExtensions when a toggle changes what the linter reports —
 *  the Beginner helper is read per pass, so the lint has to be told to re-run
 *  even though the document did not change. `needsRefresh` below picks it up. */
export const refreshLint = StateEffect.define<null>()

export function linting(lang: EditorLang | null) {
  if (!lang || !LINTED.has(lang)) return []
  // `isExtEnabled` is read per lint pass (not captured), so toggling the
  // Beginner helper takes effect as soon as the lint re-runs. A plain
  // forceLinting cannot start that run (it only hurries a scheduled one), so a
  // `refreshLint` effect schedules the run and setExtensions then forces it.
  return linter(
    (view) => diagnostics(view.state, lang, { beginnerHelper: isExtEnabled('beginner-helper') }),
    {
      delay: LINT_DELAY,
      needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLint))),
    },
  )
}
