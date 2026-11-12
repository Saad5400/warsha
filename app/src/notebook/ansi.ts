/**
 * ANSI SGR colour codes → styled runs. Tracebacks saved by Jupyter and Colab
 * are full of `\x1b[0;31m`, and pip's progress output too; showing them raw
 * reads as corruption. Colours map onto the terminal palette tokens
 * (`--ansi-*`, THEME-V4) the console already uses. Every other escape sequence
 * is dropped.
 */

export interface AnsiRun {
  text: string
  /** CSS colour (a `var(--ansi-*)`), or null for the default ink. */
  fg: string | null
  bg: string | null
  bold: boolean
  underline: boolean
}

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const color = (i: number, bright: boolean) => `var(--ansi-${bright ? 'bright-' : ''}${NAMES[i]})`

/** xterm's 256-colour cube and grey ramp, for `38;5;n`. */
function color256(n: number): string {
  if (n < 8) return color(n, false)
  if (n < 16) return color(n - 8, true)
  if (n < 232) {
    const v = n - 16
    const c = (x: number) => (x === 0 ? 0 : 55 + x * 40)
    return `rgb(${c(Math.floor(v / 36))},${c(Math.floor(v / 6) % 6)},${c(v % 6)})`
  }
  const g = 8 + (n - 232) * 10
  return `rgb(${g},${g},${g})`
}

// eslint-disable-next-line no-control-regex
const ESCAPES = /\x1b\[([0-9;]*)([A-Za-z])|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g

export function parseAnsi(text: string): AnsiRun[] {
  const runs: AnsiRun[] = []
  let fg: string | null = null
  let bg: string | null = null
  let bold = false
  let underline = false
  let last = 0
  const push = (s: string) => {
    if (!s) return
    const prev = runs[runs.length - 1]
    if (prev && prev.fg === fg && prev.bg === bg && prev.bold === bold && prev.underline === underline) prev.text += s
    else runs.push({ text: s, fg, bg, bold, underline })
  }
  ESCAPES.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ESCAPES.exec(text))) {
    push(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[2] !== 'm') continue
    const codes = (m[1] || '0').split(';').map((x) => Number(x) || 0)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]
      if (c === 0) [fg, bg, bold, underline] = [null, null, false, false]
      else if (c === 1) bold = true
      else if (c === 4) underline = true
      else if (c === 22) bold = false
      else if (c === 24) underline = false
      else if (c >= 30 && c <= 37) fg = color(c - 30, false)
      else if (c >= 90 && c <= 97) fg = color(c - 90, true)
      else if (c === 39) fg = null
      else if (c >= 40 && c <= 47) bg = color(c - 40, false)
      else if (c >= 100 && c <= 107) bg = color(c - 100, true)
      else if (c === 49) bg = null
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
        const v = color256(codes[i + 2] ?? 0)
        if (c === 38) fg = v
        else bg = v
        i += 2
      } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        const v = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
        if (c === 38) fg = v
        else bg = v
        i += 4
      }
    }
  }
  push(text.slice(last))
  return runs
}

/** The text with every escape sequence removed (copying a traceback, searching it). */
export const stripAnsi = (text: string): string => parseAnsi(text).map((r) => r.text).join('')
