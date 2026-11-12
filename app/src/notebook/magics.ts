/**
 * IPython's syntax on top of Python — `%magics`, `%%cell magics`, `!shell`,
 * `obj?` — rewritten into plain Python BEFORE the kernel compiles a cell.
 *
 * The one rule: line N of the output is line N of the input. Every rewrite
 * replaces a line with exactly one line (a call into the kernel's `_warsha_k`
 * helper, at the same indentation), and a cell magic's header becomes a blank
 * line. So a traceback, a breakpoint, the debugger's stop arrow and a
 * SyntaxError caret all land on the line the student actually wrote — the
 * kernel compiles this output under the cell's own path, and registers the
 * ORIGINAL source for that path in linecache, so the line a traceback quotes is
 * the `%time` the student typed, not our rewrite of it.
 *
 * Only a line that starts a statement is rewritten: inside a triple-quoted
 * string, an open bracket or after a backslash continuation, `!` and `%` are
 * just characters. That needs a small scanner rather than a regex, which is
 * also what IPython does (it tokenises).
 *
 * The other consumers of `magicLines`: the cell editor's linter skips them (a
 * Lezer Python parse of `!pip install x` is an error node) and the formatter
 * masks them from black.
 */

export interface CellMagic {
  /** Without the `%%`: `time`, `writefile`, `html`… */
  name: string
  args: string
  /** Everything after the header line, raw (a `%%writefile` body is written verbatim). */
  body: string
  /** Whether `code` holds the body as runnable Python (`%%time`) or the body is data (`%%html`). */
  python: boolean
}

export interface CellTransform {
  /** Plain Python with the input's exact line count. */
  code: string
  cellMagic: CellMagic | null
  /** The argument text of each pip line, in order; line k calls `_warsha_k.pip(k)`. The kernel installs
   *  them all before the cell runs (installing is asynchronous, the cell is not). */
  pip: string[]
  /** 1-based numbers of the lines that were IPython syntax rather than Python. */
  magicLines: number[]
}

/** Cell magics whose body is Python the kernel runs (under a timer, a capture, …). */
const PYTHON_BODY = new Set(['time', 'timeit', 'capture', 'python', 'python3', 'debug'])

const HELPER = '_warsha_k'

/** A Python string literal for `s`. JSON's escapes (`\"`, `\\`, `\n`, `\uXXXX`) are all valid Python. */
const py = (s: string) => JSON.stringify(s)

/**
 * For each line: does a new statement start here? False inside a triple-quoted
 * string, inside open brackets, or after a backslash continuation.
 */
export function statementStarts(lines: readonly string[]): boolean[] {
  const starts: boolean[] = []
  let triple: string | null = null
  let depth = 0
  let continued = false
  for (const line of lines) {
    starts.push(triple === null && depth === 0 && !continued)
    continued = false
    let i = 0
    const n = line.length
    while (i < n) {
      if (triple !== null) {
        const end = line.indexOf(triple, i)
        if (end === -1) {
          i = n
          break
        }
        i = end + 3
        triple = null
        continue
      }
      const c = line[i]
      if (c === '#') break
      if (c === '"' || c === "'") {
        if (line.startsWith(c.repeat(3), i)) {
          triple = c.repeat(3)
          i += 3
          continue
        }
        // A one-line string: skip to its closing quote (escapes honoured).
        i++
        while (i < n && line[i] !== c) i += line[i] === '\\' ? 2 : 1
        i++
        continue
      }
      if (c === '(' || c === '[' || c === '{') depth++
      else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--
      else if (c === '\\' && i === n - 1) continued = true
      i++
    }
  }
  return starts
}

/** `pip …` / `pip3 …` / `python -m pip …` as a shell command → the pip argument text, else null. */
function pipArgs(command: string): string | null {
  const m = /^(?:pip3?|python3?\s+-m\s+pip)(?:\s+([\s\S]*))?$/.exec(command.trim())
  return m ? (m[1] ?? '').trim() : null
}

/**
 * Rewrite one statement-starting line, or return null when it is plain Python.
 * `index` is the line's 1-based number, passed to magics that compile code of
 * their own (`%time stmt`) so a traceback from inside them names this line.
 */
function rewriteLine(line: string, index: number, pip: string[]): string | null {
  const indent = /^[ \t]*/.exec(line)![0]
  const rest = line.slice(indent.length)
  const body = rest.replace(/\s+$/, '')
  if (!body) return null

  const pipCall = (args: string) => {
    pip.push(args)
    return `${HELPER}.pip(${pip.length - 1})`
  }

  // `files = !ls` / `out = %who_ls` — IPython's capture assignment.
  const assign = /^([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*)\s*=\s*([!%])([\s\S]*)$/.exec(body)
  if (assign) {
    const [, target, sigil, tail] = assign
    if (sigil === '!') return `${indent}${target} = ${HELPER}.system(${py(tail.trim())}, capture=True)`
    const lm = /^%?([A-Za-z_]\w*)\s*([\s\S]*)$/.exec(tail)
    if (lm) return `${indent}${target} = ${HELPER}.line_magic(${py(lm[1])}, ${py(lm[2].trim())}, ${index})`
  }

  if (body.startsWith('!')) {
    const capture = body.startsWith('!!')
    const command = body.slice(capture ? 2 : 1).trim()
    const p = pipArgs(command)
    if (p !== null && !capture) return indent + pipCall(p)
    return `${indent}${HELPER}.system(${py(command)}${capture ? ', capture=True' : ''})`
  }

  if (body.startsWith('%')) {
    // `%%name` past line 1 is not a cell magic; IPython reports it as an unknown line magic.
    const m = /^%{1,2}([A-Za-z_][\w.]*)?\s*([\s\S]*)$/.exec(body)
    const name = m?.[1] ?? ''
    const args = (m?.[2] ?? '').trim()
    if (name === 'pip') return indent + pipCall(args)
    return `${indent}${HELPER}.line_magic(${py(body.startsWith('%%') ? '%' + name : name)}, ${py(args)}, ${index})`
  }

  // `obj?` / `obj??` / `?obj` / `??obj` — help on a (dotted) name.
  const help = /^(\?{1,2})([A-Za-z_][\w.]*)$/.exec(body) ?? /^([A-Za-z_][\w.]*)(\?{1,2})$/.exec(body)
  if (help) {
    const [name, marks] = help[1].startsWith('?') ? [help[2], help[1]] : [help[1], help[2]]
    return `${indent}${HELPER}.pinfo(${py(name)}, ${marks.length === 2 ? 'True' : 'False'})`
  }
  return null
}

export function transformCell(source: string): CellTransform {
  const lines = source.split('\n')
  const pip: string[] = []
  const magicLines: number[] = []
  let cellMagic: CellMagic | null = null
  let first = 0

  const header = /^%%([A-Za-z_][\w.]*)[ \t]*(.*)$/.exec(lines[0] ?? '')
  if (header) {
    const name = header[1]
    const python = PYTHON_BODY.has(name)
    cellMagic = { name, args: header[2].trim(), body: lines.slice(1).join('\n'), python }
    magicLines.push(1)
    if (!python) {
      // The body is data, not code: nothing to compile, but the line count still holds.
      return { code: lines.map(() => '').join('\n'), cellMagic, pip, magicLines: lines.map((_, i) => i + 1) }
    }
    first = 1
  }

  const out = lines.slice()
  if (header) out[0] = ''
  const starts = statementStarts(lines.slice(first))
  for (let i = first; i < lines.length; i++) {
    if (!starts[i - first]) continue
    const rewritten = rewriteLine(lines[i], i + 1, pip)
    if (rewritten === null) continue
    out[i] = rewritten
    magicLines.push(i + 1)
  }
  return { code: out.join('\n'), cellMagic, pip, magicLines }
}

/** Just the IPython-syntax line numbers of a cell — for the editor (lint, format). */
export const magicLinesOf = (source: string): number[] => transformCell(source).magicLines

/**
 * A cell made safe for a Python formatter (black): each IPython line becomes a
 * marker comment at its own indentation, and `restore` puts the original lines
 * back into the formatted text. A cell whose body is data (`%%writefile`,
 * `%%html`) has nothing to format and comes back as null.
 */
export function maskMagicsForFormat(source: string): { masked: string; restore(formatted: string): string } | null {
  const t = transformCell(source)
  if (t.cellMagic && !t.cellMagic.python) return null
  const lines = source.split('\n')
  const originals = new Map<number, string>()
  for (const n of t.magicLines) {
    const line = lines[n - 1]
    const indent = /^[ \t]*/.exec(line)![0]
    originals.set(originals.size, line.slice(indent.length))
    lines[n - 1] = `${indent}# warsha-magic-${originals.size - 1}`
  }
  return {
    masked: lines.join('\n'),
    restore: (formatted) =>
      formatted.replace(/^([ \t]*)# warsha-magic-(\d+)$/gm, (m, indent: string, i: string) =>
        originals.has(Number(i)) ? indent + originals.get(Number(i)) : m,
      ),
  }
}
