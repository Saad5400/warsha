/**
 * LaTeX math → MathML, for `$…$` in markdown cells and `text/latex` outputs.
 *
 * Browsers render MathML Core natively (Chrome/Android Chrome 109+, Safari,
 * Firefox), so math costs no typesetting library — KaTeX/MathJax would be the
 * single largest thing in the bundle. This covers what course notebooks write:
 * fractions, roots, sub/superscripts, Greek, operators and relations, big
 * operators with limits, accents, \text and font styles, \left…\right fences,
 * matrices/cases/aligned environments. Anything it does not know renders as a
 * visible <merror> of the command, never a silent gap.
 *
 * Output is built from escaped text only — no input reaches the DOM as markup.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ',
  omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const OPS: Record<string, string> = {
  times: '×', cdot: '⋅', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼', simeq: '≃', equiv: '≡',
  cong: '≅', propto: '∝', ll: '≪', gg: '≫', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆',
  supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅',
  forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨', oplus: '⊕',
  otimes: '⊗', to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', Leftrightarrow: '⇔', iff: '⟺', implies: '⟹', mapsto: '↦', uparrow: '↑',
  downarrow: '↓', mid: '∣', parallel: '∥', perp: '⊥', angle: '∠', triangle: '△', ldots: '…', cdots: '⋯',
  vdots: '⋮', ddots: '⋱', dots: '…', prime: '′', infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ',
  Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', degree: '°', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖', lbrace: '{', rbrace: '}', '{': '{', '}': '}', '|': '‖',
  colon: ':', quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
  '%': '%', '#': '#', '&': '&', _: '_', '$': '$',
}

/** Big operators: limits go under/over in display style. */
const BIG: Record<string, string> = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂' }
/** Named functions: upright, and `lim`/`max`… take limits under. */
const FUNCS = new Set('sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp det dim gcd deg hom ker arg'.split(' '))
const LIMFUNCS = new Set('lim limsup liminf max min sup inf argmax argmin Pr'.split(' '))
const ACCENTS: Record<string, string> = { hat: '^', widehat: '^', bar: '¯', overline: '¯', vec: '→', dot: '˙', ddot: '¨', tilde: '~', widetilde: '~', overrightarrow: '→' }
const FONTS: Record<string, string> = { mathbf: 'bold', boldsymbol: 'bold-italic', mathit: 'italic', mathrm: 'normal', mathbb: 'double-struck', mathcal: 'script', mathfrak: 'fraktur', mathsf: 'sans-serif', mathtt: 'monospace', operatorname: 'normal' }

type Tok = { t: 'cmd' | 'char' | 'open' | 'close' | 'sup' | 'sub' | 'amp' | 'nl' | 'space'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i))
      if (!m) {
        i++
        continue
      }
      if (m[1] === '\\') out.push({ t: 'nl', v: '' })
      else out.push({ t: 'cmd', v: m[1] })
      i += m[0].length
      continue
    }
    if (c === '{') out.push({ t: 'open', v: c })
    else if (c === '}') out.push({ t: 'close', v: c })
    else if (c === '^') out.push({ t: 'sup', v: c })
    else if (c === '_') out.push({ t: 'sub', v: c })
    else if (c === '&') out.push({ t: 'amp', v: c })
    else if (/\s/.test(c)) out.push({ t: 'space', v: c })
    else out.push({ t: 'char', v: c })
    i++
  }
  return out
}

class Parser {
  i = 0
  constructor(
    private toks: Tok[],
    private display: boolean,
  ) {}

  peek(): Tok | undefined {
    while (this.toks[this.i]?.t === 'space') this.i++
    return this.toks[this.i]
  }
  next(): Tok | undefined {
    const t = this.peek()
    this.i++
    return t
  }

  /** A row until `}`, `\right`, `\end`, `&`, `\\`, or the end. */
  row(): string {
    const items: string[] = []
    for (;;) {
      const t = this.peek()
      if (!t || t.t === 'close' || t.t === 'amp' || t.t === 'nl') break
      if (t.t === 'cmd' && (t.v === 'right' || t.v === 'end')) break
      items.push(this.scripted())
    }
    return items.length === 1 ? items[0] : `<mrow>${items.join('')}</mrow>`
  }

  /** One atom plus any ^/_ after it. */
  scripted(): string {
    const t = this.peek()
    let limits = false
    if (t?.t === 'cmd' && (BIG[t.v] || LIMFUNCS.has(t.v))) limits = this.display && t.v !== 'int' && t.v !== 'oint' && t.v !== 'iint'
    let base = this.atom()
    let sub: string | null = null
    let sup: string | null = null
    for (;;) {
      const n = this.peek()
      if (n?.t === 'sub' && sub === null) {
        this.next()
        sub = this.arg()
      } else if (n?.t === 'sup' && sup === null) {
        this.next()
        sup = this.arg()
      } else if (n?.t === 'char' && n.v === "'") {
        this.next()
        sup = (sup ?? '') + '<mo>′</mo>'
      } else break
    }
    if (sub !== null && sup !== null) return limits ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`
    if (sub !== null) return limits ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`
    if (sup !== null) {
      if (sup.startsWith('<mo>′')) base = `<mrow>${base}</mrow>`
      return limits ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`
    }
    return base
  }

  /** A `{group}` or a single atom — the argument of ^, _, \frac… */
  arg(): string {
    const t = this.peek()
    if (t?.t === 'open') {
      this.next()
      const r = this.row()
      if (this.peek()?.t === 'close') this.next()
      return r
    }
    if (t?.t === 'char' && /\d/.test(t.v)) {
      this.next()
      return `<mn>${esc(t.v)}</mn>`
    }
    return this.atom()
  }

  /** Raw text of a `{group}` (for \text, \begin names). */
  rawGroup(): string {
    if (this.peek()?.t !== 'open') return ''
    this.next()
    let depth = 1
    let s = ''
    while (this.i < this.toks.length) {
      const t = this.toks[this.i++]
      if (t.t === 'open') depth++
      else if (t.t === 'close' && --depth === 0) break
      s += t.t === 'cmd' ? (OPS[t.v] ?? '\\' + t.v) : t.t === 'nl' ? ' ' : t.v
    }
    return s
  }

  atom(): string {
    const t = this.next()
    if (!t) return '<mrow></mrow>'
    switch (t.t) {
      case 'open': {
        const r = this.row()
        if (this.peek()?.t === 'close') this.next()
        return `<mrow>${r}</mrow>`
      }
      case 'char': {
        if (/\d/.test(t.v)) {
          let num = t.v
          while (this.toks[this.i]?.t === 'char' && /[\d.]/.test(this.toks[this.i].v)) num += this.toks[this.i++].v
          return `<mn>${esc(num)}</mn>`
        }
        if (/[A-Za-z]/.test(t.v)) return `<mi>${esc(t.v)}</mi>`
        return `<mo>${esc(t.v)}</mo>`
      }
      case 'cmd':
        return this.command(t.v)
      case 'close':
        return ''
      default:
        return `<mo>${esc(t.v)}</mo>`
    }
  }

  command(name: string): string {
    if (GREEK[name]) return /^[A-Z]/.test(name) ? `<mi mathvariant="normal">${GREEK[name]}</mi>` : `<mi>${GREEK[name]}</mi>`
    if (BIG[name]) return `<mo largeop="true" movablelimits="${this.display ? 'false' : 'true'}">${BIG[name]}</mo>`
    if (FUNCS.has(name)) return `<mi mathvariant="normal">${name}</mi><mo>⁡</mo>`
    if (LIMFUNCS.has(name)) return `<mo movablelimits="${this.display ? 'false' : 'true'}">${name}</mo>`
    if (name in OPS) return OPS[name] === '' ? '' : `<mo>${esc(OPS[name])}</mo>`
    switch (name) {
      case 'frac':
      case 'dfrac':
      case 'tfrac':
        return `<mfrac>${this.arg()}${this.arg()}</mfrac>`
      case 'binom':
        return `<mrow><mo>(</mo><mfrac linethickness="0">${this.arg()}${this.arg()}</mfrac><mo>)</mo></mrow>`
      case 'sqrt': {
        if (this.peek()?.t === 'char' && this.peek()!.v === '[') {
          this.next()
          const idx: string[] = []
          while (this.peek() && !(this.peek()!.t === 'char' && this.peek()!.v === ']')) idx.push(this.scripted())
          this.next()
          return `<mroot>${this.arg()}<mrow>${idx.join('')}</mrow></mroot>`
        }
        return `<msqrt>${this.arg()}</msqrt>`
      }
      case 'text':
      case 'textrm':
      case 'textit':
      case 'textbf':
      case 'mbox':
        return `<mtext>${esc(this.rawGroup())}</mtext>`
      case 'left': {
        const open = this.fence()
        const body = this.row()
        let close = ''
        if (this.peek()?.t === 'cmd' && this.peek()!.v === 'right') {
          this.next()
          close = this.fence()
        }
        return `<mrow>${open}${body}${close}</mrow>`
      }
      case 'begin':
        return this.environment(this.rawGroup())
      case 'underline':
        return `<munder accent="true">${this.arg()}<mo>_</mo></munder>`
      case 'overbrace':
        return `<mover>${this.arg()}<mo>⏞</mo></mover>`
      case 'underbrace':
        return `<munder>${this.arg()}<mo>⏟</mo></munder>`
      case 'displaystyle':
      case 'limits':
      case 'nolimits':
      case 'big':
      case 'Big':
      case 'bigg':
      case 'Bigg':
        return ''
    }
    if (ACCENTS[name]) return `<mover accent="true">${this.arg()}<mo>${ACCENTS[name]}</mo></mover>`
    if (FONTS[name]) {
      const body = name === 'operatorname' ? `<mi>${esc(this.rawGroup())}</mi>` : this.arg()
      return `<mstyle mathvariant="${FONTS[name]}">${body.replace(/<mi>/g, `<mi mathvariant="${FONTS[name]}">`)}</mstyle>`
    }
    return `<merror><mtext>\\${esc(name)}</mtext></merror>`
  }

  fence(): string {
    const t = this.next()
    if (!t) return ''
    const v = t.t === 'cmd' ? (OPS[t.v] ?? '') : t.v
    return v === '.' ? '' : `<mo fence="true" stretchy="true">${esc(v)}</mo>`
  }

  environment(name: string): string {
    const rows: string[][] = [[]]
    for (;;) {
      const t = this.peek()
      if (!t) break
      if (t.t === 'cmd' && t.v === 'end') {
        this.next()
        this.rawGroup()
        break
      }
      if (t.t === 'amp') {
        this.next()
        rows[rows.length - 1].push('')
        continue
      }
      if (t.t === 'nl') {
        this.next()
        rows.push([])
        continue
      }
      const cell = this.row()
      const r = rows[rows.length - 1]
      if (r.length && r[r.length - 1] === '') r[r.length - 1] = cell
      else r.push(cell)
    }
    const aligned = /^(aligned|align\*?|eqnarray\*?|split|gathered)$/.test(name)
    const table = `<mtable${aligned ? ' columnalign="right left"' : name === 'cases' ? ' columnalign="left left"' : ''}>${rows
      .filter((r) => r.length)
      .map((r) => `<mtr>${r.map((c) => `<mtd>${c}</mtd>`).join('')}</mtr>`)
      .join('')}</mtable>`
    const fences: Record<string, [string, string]> = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''] }
    const f = fences[name]
    return f ? `<mrow><mo fence="true">${esc(f[0])}</mo>${table}${f[1] ? `<mo fence="true">${esc(f[1])}</mo>` : ''}</mrow>` : table
  }
}

/** One formula (without its `$` delimiters) as a `<math>` element's markup. */
export function texToMathML(tex: string, display: boolean): string {
  let body: string
  try {
    const p = new Parser(tokenize(tex), display)
    const parts: string[] = []
    // Stray closers at top level are skipped rather than ending the formula early.
    while (p.peek()) {
      parts.push(p.row())
      if (p.peek()) p.next()
    }
    body = parts.join('')
  } catch {
    body = `<merror><mtext>${esc(tex)}</mtext></merror>`
  }
  const row = body.startsWith('<mrow>') && body.endsWith('</mrow>') ? body : `<mrow>${body}</mrow>`
  return `<math${display ? ' display="block"' : ''}><semantics>${row}<annotation encoding="application/x-tex">${esc(tex)}</annotation></semantics></math>`
}
