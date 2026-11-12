/* Warsha C debugger — source instrumenter.
 *
 * There is no in-browser wasm debugger, so a DEBUG run compiles an instrumented copy
 * of the student's sources (plain runs never see this file). Parsing is tree-sitter
 * (tree-sitter-c grammar, web-tree-sitter runtime); the caller hands in a ready
 * Parser so this module stays a pure source-to-source transform (Node-testable).
 *
 * What gets inserted — ALWAYS on the same line as the code it instruments (never a
 * newline), so clang's line numbers, and the debugger's, stay the student's:
 *   - `__wd_line(FID, LINE);` before every statement (and inside loop conditions, so a
 *     loop header line is revisited each iteration). Brace-less if/else/for/while/do
 *     bodies are wrapped in `{ }` to make room.
 *   - Function entry: a cleanup-guarded `__wd_enter(...)` as the body's first
 *     declaration (the cleanup pops the shadow frame on every return path), then one
 *     `__wd_reg(name, &param, type, …)` per parameter.
 *   - After each local declaration: a cleanup-guarded `__wd_mark()` plus `__wd_reg` per
 *     declarator, so leaving the block drops those variables from the shadow frame.
 *     (No guard where a jump could bypass it: direct children of a switch body, and
 *     functions that use goto — clang rejects jumping past a cleanup variable.)
 *   - `for (int i = 0; …)`: the init declaration is hoisted into a `{ … }` around the
 *     loop (same scope, same line) so `i` can be registered once.
 *   - One `__attribute__((constructor))` appended per .c registering its globals and
 *     the field layout (offsetof/sizeof) of every struct/union visible to it.
 *
 * Type descriptors (the JS side decodes memory by these) are written outermost
 * derivation first: `*char` is char*, `[]int` is an int array whose length comes from
 * a runtime `sizeof` (dims d0..d2), `[3]*char` is char*[3], `*[3]int` is int(*)[3].
 * The base is a normalized C type (`int`, `unsigned char`, `double`, `_Bool`,
 * `struct Point`, a typedef'd anonymous struct's name) or `?name` when unknown.
 */

export const PRELUDE = `#define __WD_IMP(n) __attribute__((import_module("warsha"), import_name(n)))
__WD_IMP("line") void __wd_line(int, int);
__WD_IMP("enter") int __wd_enter(const char *, int, int);
__WD_IMP("leave") void __wd_leave(int);
__WD_IMP("mark") int __wd_mark(void);
__WD_IMP("unreg") void __wd_unreg(int);
__WD_IMP("reg") void __wd_reg(const char *, const volatile void *, const char *, int, int, int);
__WD_IMP("greg") void __wd_greg(const char *, const volatile void *, const char *, int, int, int);
__WD_IMP("ssize") void __wd_ssize(const char *, int);
__WD_IMP("sfield") void __wd_sfield(const char *, const char *, const char *, int, int, int, int);
#undef __WD_IMP
static __inline__ __attribute__((unused)) void __wd_leave_c(int *p) { __wd_leave(*p); }
static __inline__ __attribute__((unused)) void __wd_unreg_c(int *p) { __wd_unreg(*p); }
`

const KNOWN_TYPEDEFS = {
  size_t: 'unsigned long', ssize_t: 'long', ptrdiff_t: 'long', intptr_t: 'long', uintptr_t: 'unsigned long',
  int8_t: 'signed char', uint8_t: 'unsigned char', int16_t: 'short', uint16_t: 'unsigned short',
  int32_t: 'int', uint32_t: 'unsigned int', int64_t: 'long long', uint64_t: 'unsigned long long',
  bool: '_Bool', _Bool: '_Bool', wchar_t: 'int', off_t: 'long long', time_t: 'long long', clock_t: 'long long',
  FILE: '?FILE',
}

const QUALIFIERS = new Set(['const', 'volatile', 'restrict', '__restrict', '_Atomic', 'static', 'extern', 'register', 'inline', 'auto'])

/** Normalize a primitive / sized type spelling ("long int", "unsigned", "char signed"). */
function normPrim(text) {
  const t = text.split(/\s+/).filter((w) => w && !QUALIFIERS.has(w))
  if (t.length === 1 && KNOWN_TYPEDEFS[t[0]]) return KNOWN_TYPEDEFS[t[0]]
  const has = (w) => t.includes(w)
  const longs = t.filter((w) => w === 'long').length
  const u = has('unsigned') ? 'unsigned ' : ''
  if (has('void')) return 'void'
  if (has('char')) return has('unsigned') ? 'unsigned char' : has('signed') ? 'signed char' : 'char'
  if (has('_Bool') || has('bool')) return '_Bool'
  if (has('float')) return 'float'
  if (has('double')) return longs ? 'long double' : 'double'
  if (has('short')) return u + 'short'
  if (longs >= 2) return u + 'long long'
  if (longs === 1) return u + 'long'
  if (has('int') || has('unsigned') || has('signed')) return u + 'int'
  return '?' + t.join(' ')
}

const isIntLiteral = (s) => /^(0[xX][0-9a-fA-F]+|\d+)[uUlL]*$/.test(s.trim())

class Edits {
  constructor() { this.list = []; this.seq = 0 }
  /** Text placed at `pos`. Openers at one position keep insertion order. */
  open(pos, text) { this.list.push({ pos, end: pos, text, rank: 1, seq: this.seq++ }) }
  /** Text placed at `pos` that closes something opened earlier: inner (later) closers first, all before openers. */
  close(pos, text) { this.list.push({ pos, end: pos, text, rank: 0, seq: -this.seq++ }) }
  replace(pos, end, text) { this.list.push({ pos, end, text, rank: 2, seq: this.seq++ }) }
  apply(src) {
    const l = this.list.slice().sort((a, b) => a.pos - b.pos || a.rank - b.rank || a.seq - b.seq)
    let out = ''
    let cur = 0
    for (const e of l) {
      if (e.pos < cur) continue // overlapping (inside a replaced range) — cannot happen by construction
      out += src.slice(cur, e.pos) + e.text
      cur = e.end
    }
    return out + src.slice(cur)
  }
}

function cstr(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function childrenOf(node) {
  const out = []
  for (let i = 0; i < node.childCount; i++) out.push(node.child(i))
  return out
}

function namedChildrenOf(node) {
  const out = []
  for (let i = 0; i < node.namedChildCount; i++) out.push(node.namedChild(i))
  return out
}

/** Top-level items, looking through #if/#ifdef wrappers and extern "C"-style blocks. */
function topLevel(root) {
  const out = []
  const walk = (n) => {
    for (const c of namedChildrenOf(n)) {
      if (c.type === 'preproc_if' && /^\s*0\s*$/.test(c.childForFieldName('condition')?.text ?? '')) {
        const alt = c.childForFieldName('alternative')
        if (alt) walk(alt) // `#if 0 … #else …`: only the #else side exists
      } else if (/^preproc_(if|ifdef|else|elif|elifdef)$/.test(c.type) || c.type === 'linkage_specification' || c.type === 'declaration_list') walk(c)
      else out.push(c)
    }
  }
  walk(root)
  return out
}

function hasStorage(decl, word) {
  return namedChildrenOf(decl).some((c) => c.type === 'storage_class_specifier' && c.text === word)
}

/**
 * Walk a declarator to its name. Returns { name, prefix } where prefix is the
 * outermost-first derivation string (`*`, `[N]`, `[?]`, `[]`, `F` for function),
 * or null if this declarator isn't something we understand.
 */
function analyzeDeclarator(d) {
  const derivs = []
  while (d) {
    switch (d.type) {
      case 'identifier':
      case 'field_identifier':
      case 'type_identifier':
        return { name: d.text, prefix: derivs.reverse().join('') }
      case 'init_declarator':
        d = d.childForFieldName('declarator')
        break
      case 'pointer_declarator':
      case 'abstract_pointer_declarator':
        derivs.push('*')
        d = d.childForFieldName('declarator')
        break
      case 'array_declarator': {
        const size = d.childForFieldName('size')
        derivs.push(size ? (isIntLiteral(size.text) ? `[${parseInt(size.text)}]` : '[?]') : '[]')
        d = d.childForFieldName('declarator')
        break
      }
      case 'function_declarator':
        derivs.push('F')
        d = d.childForFieldName('declarator')
        break
      case 'parenthesized_declarator':
      case 'attributed_declarator':
        d = d.namedChildren ? namedChildrenOf(d).find((c) => /declarator|identifier/.test(c.type)) : null
        break
      default:
        return null
    }
  }
  return null
}

/** Type environment: typedef name -> descriptor; struct key -> { cType, fields }. */
class Env {
  constructor() {
    this.typedefs = new Map()
    this.structs = new Map()
  }
  baseOf(typeNode) {
    if (!typeNode) return '?'
    switch (typeNode.type) {
      case 'primitive_type':
      case 'sized_type_specifier':
        return normPrim(typeNode.text)
      case 'struct_specifier':
      case 'union_specifier': {
        const kw = typeNode.type === 'struct_specifier' ? 'struct' : 'union'
        const name = typeNode.childForFieldName('name')
        return name ? `${kw} ${name.text}` : '?anon'
      }
      case 'enum_specifier':
        return 'int'
      case 'type_identifier':
        return this.typedefs.get(typeNode.text) ?? KNOWN_TYPEDEFS[typeNode.text] ?? '?' + typeNode.text
      default:
        return '?' + typeNode.text.replace(/\s+/g, ' ').slice(0, 40)
    }
  }
  /** Descriptor for `type declarator` (null when it's a function, or not understood). */
  describe(typeNode, declarator) {
    const a = analyzeDeclarator(declarator)
    if (!a || !a.name) return null
    let prefix = a.prefix
    if (prefix.startsWith('F')) return { name: a.name, func: true }
    const fi = prefix.indexOf('F')
    if (fi >= 0) return { name: a.name, desc: prefix.slice(0, fi) + '?fn' }
    return { name: a.name, desc: prefix + this.baseOf(typeNode) }
  }
  /** Record a struct/union definition (and any nested named ones). */
  addStruct(spec, keyOverride) {
    const body = spec.childForFieldName('body')
    if (!body) return null
    const kw = spec.type === 'struct_specifier' ? 'struct' : 'union'
    const nameNode = spec.childForFieldName('name')
    const key = nameNode ? `${kw} ${nameNode.text}` : keyOverride
    if (!key) return null
    const fields = []
    for (const fd of namedChildrenOf(body)) {
      if (fd.type !== 'field_declaration') continue
      if (namedChildrenOf(fd).some((c) => c.type === 'bitfield_clause')) continue
      const type = fd.childForFieldName('type')
      if (type && (type.type === 'struct_specifier' || type.type === 'union_specifier')) this.addStruct(type, null)
      for (const d of fd.childrenForFieldName ? fd.childrenForFieldName('declarator') : []) {
        if (!d) continue
        const r = this.describe(type, d)
        if (r && r.desc) fields.push({ name: r.name, desc: r.desc })
      }
    }
    this.structs.set(key, { cType: key, fields })
    return key
  }
  /** Fold one parsed file's top-level typedefs and struct definitions into this env. */
  collect(root) {
    for (const n of topLevel(root)) {
      if (n.type === 'type_definition') {
        const type = n.childForFieldName('type')
        const decls = n.childrenForFieldName('declarator').filter(Boolean)
        let anonKey = null
        if (type && (type.type === 'struct_specifier' || type.type === 'union_specifier')) {
          const named = type.childForFieldName('name')
          // `typedef struct { … } Point;` — the struct is known only by the typedef name.
          const first = decls.length ? analyzeDeclarator(decls[0]) : null
          const k = this.addStruct(type, !named && first && first.prefix === '' ? first.name : null)
          if (!named) anonKey = k
        }
        for (const d of decls) {
          const a = analyzeDeclarator(d)
          if (!a || !a.name) continue
          if (a.prefix.includes('F')) { this.typedefs.set(a.name, a.prefix.startsWith('F') ? '?fn' : a.prefix.slice(0, a.prefix.indexOf('F')) + '?fn'); continue }
          const base = anonKey ?? this.baseOf(type)
          this.typedefs.set(a.name, a.prefix + base)
        }
      } else if (n.type === 'declaration' || n.type === 'struct_specifier' || n.type === 'union_specifier') {
        const type = n.type === 'declaration' ? n.childForFieldName('type') : n
        if (type && (type.type === 'struct_specifier' || type.type === 'union_specifier')) this.addStruct(type, null)
      } else if (n.type === 'function_definition') {
        const type = n.childForFieldName('type')
        if (type && (type.type === 'struct_specifier' || type.type === 'union_specifier')) this.addStruct(type, null)
      }
    }
  }
}

/**
 * Leading array derivations get their length at runtime via sizeof (works for
 * `int a[] = {…}`, `int a[N]` with a macro N, and VLAs alike). Returns the descriptor
 * with those dims as `[]` and the C expressions computing them.
 */
function withDims(desc, access) {
  const dims = []
  let rest = desc
  let out = ''
  let e = access
  while (rest.startsWith('[') && dims.length < 3) {
    const close = rest.indexOf(']')
    out += '[]'
    dims.push(`(int)(sizeof(${e})/sizeof((${e})[0]))`)
    e = `(${e})[0]`
    rest = rest.slice(close + 1)
  }
  // Any array dim we can't size at runtime (behind a pointer, or deeper than 3) keeps
  // its literal length, or 0 when unknown.
  out += rest.replace(/\[(\?|)\]/g, '[0]')
  while (dims.length < 3) dims.push('0')
  return { desc: out, dims }
}

/** Parameters: an outermost array is really a pointer (`int a[]` / `int m[][3]`). */
function paramDesc(desc) {
  return desc.replace(/^\[[^\]]*\]/, '*')
}

const STATEMENTS = new Set([
  'expression_statement', 'declaration', 'return_statement', 'break_statement', 'continue_statement',
  'goto_statement', 'if_statement', 'for_statement', 'while_statement', 'do_statement', 'switch_statement',
  'compound_statement', 'labeled_statement', 'attributed_statement', 'case_statement', 'type_definition',
])

function resolveInclude(fromPath, spec, all) {
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : ''
  const norm = (p) => {
    const parts = []
    for (const s of p.split('/')) {
      if (!s || s === '.') continue
      if (s === '..') parts.pop()
      else parts.push(s)
    }
    return parts.join('/')
  }
  for (const cand of [norm(dir + spec), norm(spec)]) if (cand in all) return cand
  return null
}

/**
 * Instrument a project for a debug run.
 * @param parser a web-tree-sitter Parser with the C language set
 * @param files  { path: content } — every project file; only .c/.h are touched
 * @param opts   { layouts: false } skips the struct-layout constructor entries (the
 *   retry when a struct the parser saw isn't really compiled, e.g. under #ifdef)
 * @returns { files: { path: instrumented }, meta: { paths, lines, funcs } }
 *   meta.paths[fid] = project path; meta.lines[fid] = sorted hookable lines;
 *   meta.funcs[fid] = [[startLine, endLine], …] of function bodies (for breakpoint snapping).
 */
export function instrument(parser, files, opts = {}) {
  const layouts = opts.layouts !== false
  const sources = Object.keys(files).filter((p) => /\.(c|h)$/.test(p)).sort()
  const trees = new Map()
  for (const p of sources) trees.set(p, parser.parse(files[p]))

  // Include closure (project headers only), in include order.
  const includesOf = (p, seen = new Set()) => {
    const out = []
    const tree = trees.get(p)
    if (!tree) return out
    const visit = (n) => {
      for (const c of namedChildrenOf(n)) {
        if (c.type === 'preproc_include') {
          const path = c.childForFieldName('path')
          if (path && path.type === 'string_literal') {
            const spec = path.text.slice(1, -1)
            const r = resolveInclude(p, spec, files)
            if (r && !seen.has(r) && trees.has(r)) {
              seen.add(r)
              out.push(...includesOf(r, seen), r)
            }
          }
        } else if (/^preproc_|^translation_unit$|^linkage_specification$|^declaration_list$/.test(c.type)) visit(c)
      }
    }
    visit(tree.rootNode)
    return out
  }

  const outFiles = {}
  const meta = { paths: [], lines: [], funcs: [] }

  sources.forEach((path, fid) => {
    meta.paths[fid] = path
    const src = files[path]
    const tree = trees.get(path)
    const env = new Env()
    const headers = includesOf(path, new Set([path]))
    for (const h of headers) env.collect(trees.get(h).rootNode)
    env.collect(tree.rootNode)

    const edits = new Edits()
    const lines = new Set()
    const funcs = []
    let guardN = 0
    const isHeader = path.endsWith('.h')

    const hook = (row) => {
      lines.add(row + 1)
      return `__wd_line(${fid},${row + 1});`
    }

    const regCalls = (decl, ctx, fn = '__wd_reg') => {
      const type = decl.childForFieldName('type')
      const calls = []
      for (const d of decl.childrenForFieldName('declarator').filter(Boolean)) {
        const r = env.describe(type, d)
        if (!r || !r.desc || r.func) continue
        const { desc, dims } = withDims(r.desc, r.name)
        calls.push(`${fn}(${cstr(r.name)},&${r.name},${cstr(desc)},${dims.join(',')});`)
      }
      void ctx
      return calls
    }

    const declRegs = (decl, ctx) => {
      if (hasStorage(decl, 'register') || hasStorage(decl, 'extern')) return ''
      const calls = regCalls(decl, ctx)
      if (!calls.length) return ''
      const guard = ctx.guards && !ctx.inSwitch
        ? `__attribute__((cleanup(__wd_unreg_c))) int __wd_v${guardN++} = __wd_mark(); `
        : ''
      return ' ' + guard + calls.join(' ')
    }

    const isFuncDecl = (decl) => {
      const ds = decl.childrenForFieldName('declarator').filter(Boolean)
      return ds.length > 0 && ds.every((d) => {
        const a = analyzeDeclarator(d)
        return a && a.prefix.startsWith('F')
      })
    }

    /** Insert a hook right after a parenthesized condition's '('. */
    const condHook = (paren, row) => {
      if (paren && paren.type === 'parenthesized_expression') edits.open(paren.startIndex + 1, hook(row).slice(0, -1) + ', ')
    }

    const visitBody = (n, ctx) => {
      if (!n) return
      if (n.type === 'compound_statement') return visitStmt(n, ctx)
      if (n.type === 'expression_statement' && n.text.trim() === ';') return
      edits.open(n.startIndex, '{ ')
      visitStmt(n, ctx)
      edits.close(n.endIndex, ' }')
    }

    // Statements tree-sitter couldn't parse cleanly (usually a macro like
    // `FOREACH(x) {`) are left alone, and so is whatever follows one: it may be the
    // macro's loop body, where a hook in front would silently become the body.
    // A following `{ … }` is still instrumented inside, where that's safe.
    const broken = (n) => n.type === 'ERROR' || n.hasError
    const visitItems = (container, ctx) => {
      let afterBroken = false
      for (const c of namedChildrenOf(container)) {
        if (c.type === 'ERROR') { afterBroken = true; continue }
        if (!STATEMENTS.has(c.type)) continue
        if (afterBroken) {
          if (c.type === 'compound_statement') visitStmt(c, ctx)
        } else if (broken(c) && c.type !== 'compound_statement') {
          // skip
        } else visitStmt(c, ctx)
        afterBroken = broken(c)
      }
    }

    const visitStmt = (n, ctx, opts = {}) => {
      const row = n.startPosition.row
      switch (n.type) {
        case 'compound_statement':
          return visitItems(n, { ...ctx, inSwitch: false })
        case 'type_definition':
          return
        case 'declaration': {
          if (isFuncDecl(n) || hasStorage(n, 'extern')) return
          const hasInit = n.childrenForFieldName('declarator').some((d) => d && d.type === 'init_declarator')
          if (hasInit && !hasStorage(n, 'static')) edits.open(n.startIndex, hook(row) + ' ')
          const regs = declRegs(n, ctx)
          if (regs) edits.open(n.endIndex, regs)
          return
        }
        case 'expression_statement':
          if (n.text.trim() === ';') return
          edits.open(n.startIndex, hook(row) + ' ')
          return
        case 'return_statement':
        case 'break_statement':
        case 'continue_statement':
        case 'goto_statement':
        case 'attributed_statement':
          edits.open(n.startIndex, hook(row) + ' ')
          return
        case 'labeled_statement': {
          const inner = namedChildrenOf(n).find((c) => c.type !== 'statement_identifier' && STATEMENTS.has(c.type))
          if (inner) visitStmt(inner, ctx)
          else {
            // `label: ;` or a label before a declaration — make it an expression statement.
            const colon = childrenOf(n).find((c) => c.type === ':')
            if (colon) edits.open(colon.endIndex, ' ' + hook(row))
          }
          return
        }
        case 'if_statement': {
          const cond = n.childForFieldName('condition')
          if (opts.elseIf) condHook(cond, row)
          else edits.open(n.startIndex, hook(row) + ' ')
          visitBody(n.childForFieldName('consequence'), ctx)
          const alt = n.childForFieldName('alternative')
          if (alt) {
            const s = alt.type === 'else_clause' ? namedChildrenOf(alt).find((c) => STATEMENTS.has(c.type)) : alt
            if (s && s.type === 'if_statement') visitStmt(s, ctx, { elseIf: true })
            else visitBody(s, ctx)
          }
          return
        }
        case 'while_statement':
          edits.open(n.startIndex, hook(row) + ' ')
          condHook(n.childForFieldName('condition'), row)
          visitBody(n.childForFieldName('body'), ctx)
          return
        case 'do_statement': {
          edits.open(n.startIndex, hook(row) + ' ')
          visitBody(n.childForFieldName('body'), ctx)
          const cond = n.childForFieldName('condition')
          const kw = childrenOf(n).find((c) => c.type === 'while')
          if (cond) condHook(cond, (kw ?? cond).startPosition.row)
          return
        }
        case 'for_statement': {
          edits.open(n.startIndex, hook(row) + ' ')
          const init = n.childForFieldName('initializer')
          let wrapped = false
          if (init && init.type === 'declaration' && !init.text.includes('\n')) {
            const regs = declRegs(init, ctx)
            if (regs) {
              // Hoist `int i = 0;` into a block around the loop: same scope, same line.
              edits.open(n.startIndex, '{ ' + init.text + regs + ' ')
              edits.replace(init.startIndex, init.endIndex, ';')
              wrapped = true
            }
          }
          const cond = n.childForFieldName('condition')
          if (cond) {
            edits.open(cond.startIndex, '(' + hook(row).slice(0, -1) + ', ')
            edits.close(cond.endIndex, ')')
          } else {
            const semis = childrenOf(n).filter((c) => c.type === ';')
            const last = semis[semis.length - 1]
            if (last) edits.open(last.startIndex, '(' + hook(row).slice(0, -1) + ',1)')
          }
          visitBody(n.childForFieldName('body'), ctx)
          if (wrapped) edits.close(n.endIndex, ' }')
          return
        }
        case 'switch_statement': {
          edits.open(n.startIndex, hook(row) + ' ')
          const body = n.childForFieldName('body')
          if (body) {
            const sctx = { ...ctx, inSwitch: true }
            for (const c of namedChildrenOf(body)) {
              if (c.type === 'case_statement') {
                const value = c.childForFieldName('value')
                for (const s of namedChildrenOf(c)) {
                  if (s === value || (value && s.startIndex === value.startIndex)) continue
                  if (STATEMENTS.has(s.type)) visitStmt(s, sctx)
                }
              } else if (STATEMENTS.has(c.type)) visitStmt(c, sctx)
            }
          }
          return
        }
        case 'case_statement':
          return
        default:
          return
      }
    }

    const findFuncDeclarator = (d) => {
      while (d && d.type !== 'function_declarator') {
        if (d.type === 'pointer_declarator' || d.type === 'attributed_declarator') d = d.childForFieldName('declarator') ?? namedChildrenOf(d).find((c) => /declarator/.test(c.type))
        else if (d.type === 'parenthesized_declarator') d = namedChildrenOf(d)[0]
        else return null
      }
      return d
    }

    const globals = []
    for (const n of topLevel(tree.rootNode)) {
      if (n.type === 'function_definition') {
        const body = n.childForFieldName('body')
        const fd = findFuncDeclarator(n.childForFieldName('declarator'))
        const nameNode = fd && fd.childForFieldName('declarator')
        if (!body || !fd || !nameNode || nameNode.type !== 'identifier') continue
        const name = nameNode.text
        // A jump past a cleanup-guarded declaration is a compile error, so functions
        // with goto, or with case labels inside nested blocks (Duff's device), register
        // their locals unguarded (deduplicated in the engine instead).
        const usesGoto = body.descendantsOfType('goto_statement').length > 0
        const deepCase = body.descendantsOfType('case_statement').some((c) => c.parent?.parent?.type !== 'switch_statement')
        const ctx = { guards: !usesGoto && !deepCase, inSwitch: false }
        let entry = `__attribute__((cleanup(__wd_leave_c))) int __wd_f = __wd_enter(${cstr(name)},${fid},${nameNode.startPosition.row + 1});`
        const params = fd.childForFieldName('parameters')
        if (params) {
          for (const p of namedChildrenOf(params)) {
            if (p.type !== 'parameter_declaration') continue
            const pd = p.childForFieldName('declarator')
            if (!pd) continue
            const r = env.describe(p.childForFieldName('type'), pd)
            if (!r || !r.desc || hasStorage(p, 'register')) continue
            const desc = paramDesc(r.desc)
            const { desc: d2, dims } = withDims(desc, r.name)
            entry += ` __wd_reg(${cstr(r.name)},&${r.name},${cstr(d2)},${dims.join(',')});`
          }
        }
        edits.open(body.startIndex + 1, ' ' + entry)
        funcs.push([body.startPosition.row + 1, body.endPosition.row + 1])
        visitItems(body, ctx)
      } else if (n.type === 'declaration' && !isHeader) {
        if (hasStorage(n, 'extern') || isFuncDecl(n)) continue
        globals.push(...regCalls(n, null, '__wd_greg'))
      }
    }

    let ctor = ''
    if (!isHeader) {
      const parts = [...globals]
      const seen = new Set()
      for (const [key, s] of layouts ? env.structs : []) {
        if (seen.has(key)) continue
        seen.add(key)
        parts.push(`__wd_ssize(${cstr(key)},(int)sizeof(${s.cType}));`)
        for (const f of s.fields) {
          const { desc, dims } = withDims(f.desc, `((${s.cType}*)0)->${f.name}`)
          parts.push(`__wd_sfield(${cstr(key)},${cstr(f.name)},${cstr(desc)},(int)__builtin_offsetof(${s.cType},${f.name}),${dims.join(',')});`)
        }
      }
      if (parts.length) ctor = `\n__attribute__((constructor)) static void __wd_init_${fid}(void){ ${parts.join(' ')} }\n`
    }

    outFiles[path] = edits.apply(src) + ctor
    meta.lines[fid] = [...lines].sort((a, b) => a - b)
    meta.funcs[fid] = funcs
  })

  return { files: outFiles, meta }
}
