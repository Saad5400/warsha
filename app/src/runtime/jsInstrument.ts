import { parse } from 'acorn'

/**
 * Source instrumentation for the JavaScript / TypeScript debugger (js.ts).
 *
 * A Web Worker has no debugger API we can drive, so a debug run executes a
 * REWRITTEN copy of each user file: acorn parses it and we splice small hook
 * calls into the text — never removing or reordering anything, and never adding
 * a newline, so every original line keeps its number (error stacks too):
 *
 *   function add(a, b) { return a + b }
 *     ↓
 *   function add(a, b) {const __wdf=__wd.e("add",1,()=>this,__wdG);try{
 *     __wd.l(__wdf,3,()=>{…push("a",a,0)…});return a + b
 *   }catch(__wde){__wd.c(__wde,__wdf);throw __wde}finally{__wd.x(__wdf)}}
 *
 *  - `__wd.l(frame, line, getter)` before every statement: the worker runtime
 *    (DEBUG_RUNTIME below) checks breakpoints / step state / the pause flag there
 *    and, when it stops, calls `getter` to read the in-scope bindings. The getter
 *    is a closure over the REAL variables (so values are live, and a TDZ `let`
 *    simply throws and is skipped); it returns flat (name, value, kind) triples,
 *    kind 0 = this function's locals, 1 = an enclosing function's (Closure).
 *  - `__wd.e` / `__wd.x` bracket every function body for the call stack; the
 *    catch arm records where an exception left the innermost frame so an
 *    uncaught one can stop post-mortem with the real stack.
 *  - `await x` → `__wd.r(f, await __wd.s(f, (x)))` (same for `yield`) takes the
 *    suspended frame off the stack and puts it back on resume, so async stacks
 *    stay honest across awaits.
 *  - Unbraced `if`/`for`/`while`/`else` bodies get braces so they can hold a hook;
 *    expression-bodied arrows become `{ … return (expr) }`.
 *
 * Evaluation uses no direct `eval` (which would deopt every function and break
 * esbuild's renaming); the worker evaluates with `new Function(...names)` over
 * the getter's values instead — so an evaluated assignment changes a copy, not
 * the program's variable (documented limit).
 *
 * TypeScript: the caller transpiles first and passes esbuild's source map; every
 * hook's line is mapped back to the ORIGINAL source line through it.
 */

export interface InstrumentOptions {
  /** File id baked into the hooks; the worker maps it back to the path. */
  fid: number
  sourceType: 'script' | 'module'
  /** esbuild source map (JSON text) when `code` is transpiled output, to map hook lines back to the original source. */
  map?: string
}

export interface InstrumentResult {
  code: string
  /** Original-source lines that carry a hook — where a breakpoint can bind. Sorted. */
  lines: number[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any

interface Binding { name: string; pos: number; tdz: boolean }
interface Scope { names: Binding[]; parent: Scope | null; fn: boolean }
interface Edit { pos: number; text: string; close: boolean; seq: number }

const HIDDEN = /^__wd/

export function instrument(code: string, opts: InstrumentOptions): InstrumentResult {
  const ast = parse(code, {
    ecmaVersion: 'latest',
    sourceType: opts.sourceType,
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: opts.sourceType === 'script',
    allowHashBang: true,
  }) as N

  const mapLine = opts.map ? lineMapper(opts.map) : (line: number) => line
  const fid = opts.fid
  const edits: Edit[] = []
  let seq = 0
  const open = (pos: number, text: string) => edits.push({ pos, text, close: false, seq: seq++ })
  const close = (pos: number, text: string) => edits.push({ pos, text, close: true, seq: seq++ })
  const hookLines = new Set<number>()

  // ---------------------------------------------------------------- bindings
  const patternNames = (p: N, out: string[] = []): string[] => {
    if (!p) return out
    switch (p.type) {
      case 'Identifier': out.push(p.name); break
      case 'ObjectPattern': for (const prop of p.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out); break
      case 'ArrayPattern': for (const el of p.elements) patternNames(el, out); break
      case 'AssignmentPattern': patternNames(p.left, out); break
      case 'RestElement': patternNames(p.argument, out); break
    }
    return out
  }

  /** `var`s anywhere in a function body (not crossing into nested functions). */
  const collectVars = (node: N, out: Binding[]) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) collectVars(n, out); return }
    if (typeof node.type !== 'string') return
    if (/Function/.test(node.type) || node.type === 'ClassDeclaration' || node.type === 'ClassExpression') return
    if (node.type === 'VariableDeclaration' && node.kind === 'var') {
      for (const d of node.declarations) for (const name of patternNames(d.id)) out.push({ name, pos: 0, tdz: false })
    }
    for (const k in node) {
      if (k === 'loc' || k === 'type') continue
      const v = node[k]
      if (v && typeof v === 'object') collectVars(v, out)
    }
  }

  /** Lexical declarations made directly in a statement list. */
  const lexicals = (stmts: N[], out: Binding[]) => {
    for (let s of stmts) {
      if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') s = s.declaration
      if (!s) continue
      if (s.type === 'VariableDeclaration' && s.kind !== 'var') {
        for (const d of s.declarations) for (const name of patternNames(d.id)) out.push({ name, pos: s.start, tdz: true })
      } else if (s.type === 'ClassDeclaration' && s.id) {
        out.push({ name: s.id.name, pos: s.start, tdz: true })
      } else if (s.type === 'FunctionDeclaration' && s.id) {
        out.push({ name: s.id.name, pos: 0, tdz: false })
      } else if (s.type === 'ImportDeclaration') {
        for (const sp of s.specifiers) out.push({ name: sp.local.name, pos: 0, tdz: false })
      }
    }
    return out
  }

  /** Getter source for the bindings visible at `pos` from `scope`. */
  const getter = (scope: Scope, pos: number): string => {
    const seen = new Set<string>()
    let body = ''
    let kind = 0
    for (let s: Scope | null = scope; s; s = s.parent) {
      if (!s.parent) break // the module scope is shown as Globals, via __wdG
      for (const b of s.names) {
        if (seen.has(b.name) || HIDDEN.test(b.name)) continue
        if (b.tdz && b.pos >= pos) continue
        seen.add(b.name)
        body += `try{__wdo.push(${JSON.stringify(b.name)},${b.name},${kind})}catch{}`
      }
      if (s.fn) kind = 1
    }
    return body ? `()=>{const __wdo=[];${body}return __wdo}` : '0'
  }
  /** Module-level hooks: their locals are the module scope itself (filtered by position). */
  const moduleGetter = (scope: Scope, pos: number): string => {
    const seen = new Set<string>()
    let body = ''
    for (let s: Scope | null = scope; s; s = s.parent) {
      for (const b of s.names) {
        if (seen.has(b.name) || HIDDEN.test(b.name)) continue
        if (b.tdz && b.pos >= pos) continue
        seen.add(b.name)
        body += `try{__wdo.push(${JSON.stringify(b.name)},${b.name},0)}catch{}`
      }
    }
    return body ? `()=>{const __wdo=[];${body}return __wdo}` : '0'
  }

  // ---------------------------------------------------------------- walk
  interface Ctx { scope: Scope; topLevel: boolean }

  const hookText = (ctx: Ctx, node: N): string | null => {
    const line = mapLine(node.loc.start.line, node.loc.start.column)
    if (line == null) return null
    hookLines.add(line)
    const g = ctx.topLevel ? moduleGetter(ctx.scope, node.start) : getter(ctx.scope, node.start)
    return `__wd.l(__wdf,${line},${g});`
  }

  const hookable = (s: N): boolean => {
    switch (s.type) {
      case 'FunctionDeclaration':
      case 'ImportDeclaration':
      case 'EmptyStatement':
      case 'BlockStatement':
      case 'ExportAllDeclaration':
        return false
      case 'ExpressionStatement':
        return !s.directive
      case 'ExportNamedDeclaration':
        return !!s.declaration && s.declaration.type !== 'FunctionDeclaration'
      case 'ExportDefaultDeclaration':
        return s.declaration.type !== 'FunctionDeclaration'
      default:
        return true
    }
  }

  const statementList = (stmts: N[], ctx: Ctx) => {
    for (const s of stmts) {
      if (hookable(s)) {
        const h = hookText(ctx, s)
        if (h) open(s.start, h)
      }
      visit(s, ctx)
    }
  }

  const blockScope = (ctx: Ctx, names: Binding[]): Ctx => ({ scope: { names, parent: ctx.scope, fn: false }, topLevel: ctx.topLevel })

  /** A loop/if body: braces added when it is a lone statement so it can hold a hook. */
  const body = (s: N, ctx: Ctx) => {
    if (!s) return
    if (s.type === 'BlockStatement' || s.type === 'EmptyStatement' || s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration' || s.type === 'VariableDeclaration') {
      visit(s, ctx)
      return
    }
    const h = hookText(ctx, s)
    open(s.start, '{' + (h ?? ''))
    visit(s, ctx)
    close(s.end, '}')
  }

  const keyName = (key: N, computed: boolean): string => {
    if (!computed && key.type === 'Identifier') return key.name
    if (key.type === 'PrivateIdentifier') return '#' + key.name
    if (key.type === 'Literal') return String(key.value)
    return '<computed>'
  }

  const fnFrame = (fn: N, ctx: Ctx, hint: string | null) => {
    const name = (fn.id && fn.id.name) || hint || '<anonymous>'
    const params: Binding[] = []
    for (const p of fn.params) for (const n of patternNames(p)) params.push({ name: n, pos: 0, tdz: false })
    if (fn.type === 'FunctionExpression' && fn.id) params.push({ name: fn.id.name, pos: 0, tdz: false })
    const vars: Binding[] = []
    if (fn.body.type === 'BlockStatement') collectVars(fn.body.body, vars)
    const fnScope: Scope = { names: [...params, ...vars], parent: ctx.scope, fn: true }
    const inner: Ctx = { scope: fnScope, topLevel: false }
    // Default values / destructuring defaults may hold functions of their own.
    for (const p of fn.params) visit(p, inner)

    const thisArg = fn.type === 'ArrowFunctionExpression' ? '0' : '()=>this'
    const prefix = `;const __wdf=__wd.e(${JSON.stringify(name)},${fid},${thisArg},__wdG);try{`
    const suffix = `}catch(__wde){__wd.c(__wde,__wdf);throw __wde}finally{__wd.x(__wdf)}`

    if (fn.body.type === 'BlockStatement') {
      const stmts = fn.body.body
      let at = fn.body.start + 1
      for (const s of stmts) {
        if (s.type === 'ExpressionStatement' && s.directive) at = s.end
        else break
      }
      open(at, prefix)
      const bctx = blockScope(inner, lexicals(stmts, []))
      statementList(stmts, bctx)
      close(fn.body.end - 1, suffix)
    } else {
      // Expression body: `=> expr` becomes `=> {…; return (expr)}`.
      let at = fn.body.start
      while (at > fn.start && code[at - 1] !== '>') at--
      const h = hookText(inner, fn.body)
      open(at, '{' + prefix + (h ?? '') + 'return (')
      visit(fn.body, inner)
      close(fn.end, ')' + suffix + '}')
    }
  }

  const classBody = (cls: N, ctx: Ctx, hint: string | null) => {
    const cname = (cls.id && cls.id.name) || hint || '<anonymous>'
    if (cls.superClass) visit(cls.superClass, ctx)
    for (const el of cls.body.body) {
      if (el.type === 'MethodDefinition') {
        if (el.computed) visit(el.key, ctx)
        const k = keyName(el.key, el.computed)
        const label = el.kind === 'constructor' ? `new ${cname}` : el.kind === 'get' || el.kind === 'set' ? `${cname}.${el.kind} ${k}` : `${cname}.${k}`
        fnFrame(el.value, ctx, label)
      } else if (el.type === 'PropertyDefinition') {
        if (el.computed) visit(el.key, ctx)
        if (el.value) visit(el.value, ctx, `${cname}.${keyName(el.key, el.computed)}`)
      } else if (el.type === 'StaticBlock') {
        // Treated as a tiny function so its hooks have a frame of their own.
        const lb = code.indexOf('{', el.start)
        const sScope: Scope = { names: [], parent: ctx.scope, fn: true }
        collectVars(el.body, sScope.names)
        const sctx: Ctx = { scope: sScope, topLevel: false }
        open(lb + 1, `;const __wdf=__wd.e(${JSON.stringify(cname + ' static')},${fid},()=>this,__wdG);try{`)
        statementList(el.body, blockScope(sctx, lexicals(el.body, [])))
        close(el.end - 1, `}catch(__wde){__wd.c(__wde,__wdf);throw __wde}finally{__wd.x(__wdf)}`)
      } else {
        visit(el, ctx)
      }
    }
  }

  const generic = (node: N, ctx: Ctx) => {
    for (const k in node) {
      if (k === 'loc' || k === 'type' || k === 'start' || k === 'end') continue
      const v = node[k]
      if (!v || typeof v !== 'object') continue
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, ctx) }
      else if (typeof v.type === 'string') visit(v, ctx)
    }
  }

  const hintOf = (n: N): string | null => {
    if (!n) return null
    if (n.type === 'Identifier') return n.name
    if (n.type === 'MemberExpression' && !n.computed) return n.property.name ?? null
    return null
  }

  function visit(node: N, ctx: Ctx, hint: string | null = null): void {
    if (!node) return
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        fnFrame(node, ctx, hint)
        return
      case 'ClassDeclaration':
      case 'ClassExpression':
        classBody(node, ctx, hint)
        return
      case 'BlockStatement':
        statementList(node.body, blockScope(ctx, lexicals(node.body, [])))
        return
      case 'StaticBlock':
        return // handled by classBody
      case 'SwitchStatement': {
        visit(node.discriminant, ctx)
        const all: N[] = []
        for (const c of node.cases) all.push(...c.consequent)
        const sctx = blockScope(ctx, lexicals(all, []))
        for (const c of node.cases) {
          if (c.test) visit(c.test, sctx)
          statementList(c.consequent, sctx)
        }
        return
      }
      case 'ForStatement': {
        let fctx = ctx
        if (node.init && node.init.type === 'VariableDeclaration' && node.init.kind !== 'var') {
          fctx = blockScope(ctx, node.init.declarations.flatMap((d: N) => patternNames(d.id)).map((name: string) => ({ name, pos: node.init.start, tdz: false })))
        }
        visit(node.init, fctx); visit(node.test, fctx); visit(node.update, fctx)
        body(node.body, fctx)
        return
      }
      case 'ForInStatement':
      case 'ForOfStatement': {
        let fctx = ctx
        if (node.left.type === 'VariableDeclaration' && node.left.kind !== 'var') {
          fctx = blockScope(ctx, node.left.declarations.flatMap((d: N) => patternNames(d.id)).map((name: string) => ({ name, pos: 0, tdz: false })))
        }
        visit(node.left, fctx); visit(node.right, ctx)
        body(node.body, fctx)
        return
      }
      case 'IfStatement':
        visit(node.test, ctx)
        body(node.consequent, ctx)
        body(node.alternate, ctx)
        return
      case 'WhileStatement':
      case 'DoWhileStatement':
        visit(node.test, ctx)
        body(node.body, ctx)
        return
      case 'WithStatement':
        visit(node.object, ctx)
        body(node.body, ctx)
        return
      case 'LabeledStatement':
        visit(node.body, ctx) // never brace a labelled loop: `continue label` needs it bare
        return
      case 'CatchClause': {
        const cctx = blockScope(ctx, patternNames(node.param).map((name) => ({ name, pos: 0, tdz: false })))
        if (node.param) visit(node.param, cctx)
        visit(node.body, cctx)
        return
      }
      case 'VariableDeclarator':
        visit(node.id, ctx)
        visit(node.init, ctx, hintOf(node.id))
        return
      case 'AssignmentExpression':
        visit(node.left, ctx)
        visit(node.right, ctx, hintOf(node.left))
        return
      case 'Property':
        if (node.computed) visit(node.key, ctx)
        visit(node.value, ctx, node.kind === 'get' || node.kind === 'set' ? `${node.kind} ${keyName(node.key, node.computed)}` : keyName(node.key, node.computed))
        return
      case 'AwaitExpression':
        open(node.start, '__wd.r(__wdf,')
        open(node.argument.start, '__wd.s(__wdf,(')
        visit(node.argument, ctx)
        close(node.argument.end, '))')
        close(node.end, ')')
        return
      case 'YieldExpression':
        open(node.start, '__wd.r(__wdf,')
        if (node.argument) {
          open(node.argument.start, '__wd.s(__wdf,(')
          visit(node.argument, ctx)
          close(node.argument.end, '))')
          close(node.end, ')')
        } else {
          close(node.end, ' __wd.s(__wdf))')
        }
        return
      default:
        generic(node, ctx)
    }
  }

  // ---------------------------------------------------------------- program
  const prog = ast.body as N[]
  const modNames: Binding[] = []
  collectVars(prog, modNames)
  lexicals(prog, modNames)
  const modScope: Scope = { names: modNames, parent: null, fn: true }

  let at = 0
  if (code.startsWith('#!')) { const nl = code.indexOf('\n'); at = nl === -1 ? code.length : nl + 1 }
  for (const s of prog) {
    if (s.type === 'ExpressionStatement' && s.directive) at = s.end
    else break
  }
  // Globals getter: every module binding, guarded (TDZ), hoisted so any function can call it.
  let gbody = ''
  const seen = new Set<string>()
  for (const b of modNames) {
    if (seen.has(b.name) || HIDDEN.test(b.name)) continue
    seen.add(b.name)
    gbody += `try{__wdo.push(${JSON.stringify(b.name)},${b.name},0)}catch{}`
  }
  open(at, `;function __wdG(){const __wdo=[];${gbody}return __wdo}const __wdf=__wd.e("<module>",${fid},0,0);`)
  statementList(prog, { scope: modScope, topLevel: true })
  close(code.length, '\n;__wd.x(__wdf);')

  // ---------------------------------------------------------------- splice
  edits.sort((a, b) => a.pos - b.pos || (a.close === b.close ? a.seq - b.seq : a.close ? -1 : 1))
  let out = ''
  let last = 0
  for (const e of edits) {
    out += code.slice(last, e.pos) + e.text
    last = e.pos
  }
  out += code.slice(last)
  return { code: out, lines: [...hookLines].sort((a, b) => a - b) }
}

// ------------------------------------------------------------------ source maps

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Generated (1-based line, 0-based column) → original 1-based line, from a v3 source map's `mappings`. null = synthetic code with no source. */
export function lineMapper(mapJson: string): (line: number, col: number) => number | null {
  const map = JSON.parse(mapJson) as { mappings: string }
  const lines: Array<Array<[number, number]>> = [[]]
  let genCol = 0, srcLine = 0
  let seg: number[] = []
  let value = 0, shift = 0
  const flush = () => {
    if (seg.length) {
      genCol += seg[0]
      if (seg.length >= 4) {
        srcLine += seg[2]
        lines[lines.length - 1].push([genCol, srcLine])
      }
    }
    seg = []
  }
  for (const ch of map.mappings) {
    if (ch === ';') { flush(); lines.push([]); genCol = 0; continue }
    if (ch === ',') { flush(); continue }
    const d = B64.indexOf(ch)
    if (d < 0) continue
    value += (d & 31) << shift
    if (d & 32) { shift += 5; continue }
    seg.push(value & 1 ? -(value >>> 1) : value >>> 1)
    value = 0; shift = 0
  }
  flush()
  return (line, col) => {
    const segs = lines[line - 1]
    if (!segs || !segs.length) return null
    let best = segs[0]
    for (const s of segs) { if (s[0] <= col) best = s; else break }
    return best[1] + 1
  }
}

// ------------------------------------------------------------------ worker side

/**
 * The debugger half that runs INSIDE the JS worker, prepended to js.ts's worker
 * source for debug runs only (a plain run's worker is byte-for-byte the old one).
 *
 * Shared memory (Int32 slots, then two byte regions):
 *   [0] CMD   — command sequence; the main thread bumps it after writing JSON to
 *               the command region, the parked worker Atomics.waits on it.
 *   [1] PAUSE — set by the main thread; checked by every hook.
 *   [2] GEN   — breakpoint seqlock (odd while the main thread is writing).
 *   [3] CMDLEN, [4] BPLEN.
 * The worker answers commands with postMessage (a parked worker can still post).
 */
export const SAB_BYTES = 1 << 18
export const CMD_OFF = 64
export const CMD_MAX = 1 << 16
export const BP_OFF = CMD_OFF + CMD_MAX
export const BP_MAX = SAB_BYTES - BP_OFF

export const DEBUG_RUNTIME = String.raw`
;(() => {
const D = (self.__wd = {})
const CMD = 0, PAUSE = 1, GEN = 2, CMDLEN = 3, BPLEN = 4
const CMD_OFF = ${CMD_OFF}, BP_OFF = ${BP_OFF}
let i32 = null, u8 = null, files = [], bps = new Map(), bpGen = 0, cmdSeen = 0
const stack = []
let mode = 0, stepDepth = 0, evaluating = 0, entry = false, exc = null
let refs = new Map(), nextRef = 1, stopped = []
const dec = new TextDecoder()
const readStr = (off, len) => dec.decode(u8.slice(off, off + len))

function loadBps() {
  const g = Atomics.load(i32, GEN)
  if (g & 1) return
  const txt = readStr(BP_OFF, Atomics.load(i32, BPLEN))
  if (Atomics.load(i32, GEN) !== g) return
  bpGen = g
  const next = new Map()
  try { const o = JSON.parse(txt); for (const k in o) if (o[k].length) next.set(+k, new Set(o[k])) } catch (e) {}
  bps = next
}

self.addEventListener('message', (ev) => {
  const d = ev.data
  if (!d || d.type !== 'run' || !d.debug) return
  i32 = new Int32Array(d.debug.sab, 0, 16)
  u8 = new Uint8Array(d.debug.sab)
  files = d.debug.files
  loadBps()
  if (d.debug.stopOnEntry) { mode = 1; entry = true }
  // Every uncaught path in the worker (top level, timers, rejections) funnels into onErr.
  const orig = onErr
  onErr = (e) => { try { D.u(e) } catch (x) {} orig(e) }
})

function fix(f) {
  const i = stack.lastIndexOf(f)
  if (i >= 0) stack.length = i + 1
  else stack.push(f)
}

D.e = (name, fid, self_, G) => {
  const f = { name, fid, line: 0, get: 0, self: self_, G, threw: false }
  stack.push(f)
  return f
}
D.l = (f, line, get) => {
  f.line = line
  f.get = get
  if (stack[stack.length - 1] !== f) fix(f)
  if (evaluating || !i32) return
  if (Atomics.load(i32, GEN) !== bpGen) loadBps()
  let reason = null
  if (Atomics.load(i32, PAUSE)) reason = 'pause'
  else if (bps.size) { const s = bps.get(f.fid); if (s && s.has(line)) reason = 'breakpoint' }
  if (!reason && mode) {
    if (mode === 1) reason = entry ? 'entry' : 'step'
    else if (mode === 2 ? stack.length <= stepDepth : stack.length < stepDepth) reason = 'step'
  }
  if (reason) stop(reason, undefined, stack)
}
D.x = (f) => {
  const i = stack.lastIndexOf(f)
  if (i < 0) return
  stack.length = i
  // Returning to the caller ends a step there, on the call line (as VS Code does).
  if (f.threw || evaluating || !stack.length || !mode) return
  if (mode === 1 || stack.length < stepDepth) stop('step', undefined, stack)
}
D.c = (e, f) => {
  f.threw = true
  if (evaluating) return
  if (!exc || exc.e !== e) exc = { e, frames: stack.map((fr) => Object.assign({}, fr)) }
}
D.s = (f, v) => { const i = stack.lastIndexOf(f); if (i >= 0) stack.splice(i, 1); return v }
D.r = (f, v) => { if (stack[stack.length - 1] !== f) fix(f); return v }
D.u = (e) => {
  if (evaluating || !i32) return
  const frames = exc && exc.e === e ? exc.frames : stack.slice()
  exc = null
  if (!frames.length) return
  let desc
  try { desc = e instanceof Error ? (e.name + ': ' + e.message) : ('Uncaught ' + preview(e, 0)) } catch (x) { desc = 'Uncaught exception' }
  stop('exception', desc, frames)
}

// ---------------------------------------------------------------- values
const isClass = (fn) => { try { return /^class[\s{]/.test(Function.prototype.toString.call(fn)) } catch (e) { return false } }
const ctorName = (v) => {
  try {
    const p = Object.getPrototypeOf(v)
    if (!p) return ''
    const c = p.constructor
    return (c && typeof c.name === 'string' && c.name) || ''
  } catch (e) { return '' }
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
function preview(v, depth) {
  switch (typeof v) {
    case 'string': return JSON.stringify(depth ? clip(v, 40) : v)
    case 'number': return Object.is(v, -0) ? '-0' : String(v)
    case 'bigint': return v + 'n'
    case 'boolean': case 'undefined': return String(v)
    case 'symbol': return v.toString()
    case 'function': return isClass(v) ? 'class ' + (v.name || '(anonymous)') : 'ƒ ' + (v.name || 'anonymous')
  }
  if (v === null) return 'null'
  try {
    if (Array.isArray(v)) {
      const head = 'Array(' + v.length + ')'
      if (depth) return head
      return head + ' [' + list(v.length, (i) => (i in v ? preview(v[i], 1) : 'empty')) + ']'
    }
    if (ArrayBuffer.isView(v) && typeof v.length === 'number') {
      const head = ctorName(v) + '(' + v.length + ')'
      return depth ? head : head + ' [' + list(v.length, (i) => preview(v[i], 1)) + ']'
    }
    if (v instanceof Map) {
      const head = 'Map(' + v.size + ')'
      if (depth) return head
      const es = [...v.entries()]
      return head + ' {' + list(es.length, (i) => preview(es[i][0], 1) + ' => ' + preview(es[i][1], 1)) + '}'
    }
    if (v instanceof Set) {
      const head = 'Set(' + v.size + ')'
      if (depth) return head
      const vs = [...v]
      return head + ' {' + list(vs.length, (i) => preview(vs[i], 1)) + '}'
    }
    if (v instanceof Date) return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString()
    if (v instanceof RegExp) return String(v)
    if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message
    if (typeof Promise !== 'undefined' && v instanceof Promise) return 'Promise'
    const cn = ctorName(v)
    if (depth) return cn && cn !== 'Object' ? cn : '{…}'
    const keys = Object.keys(v)
    const body = list(keys.length, (i) => {
      const d = Object.getOwnPropertyDescriptor(v, keys[i])
      return keys[i] + ': ' + (d && 'value' in d ? preview(d.value, 1) : '(...)')
    })
    return (cn && cn !== 'Object' ? cn + ' ' : '') + '{' + body + '}'
  } catch (e) { return '{…}' }
}
function list(n, item) {
  let s = ''
  for (let i = 0; i < n; i++) {
    const part = (i ? ', ' : '') + item(i)
    if (s.length + part.length > 80) return s + (i ? ', …' : '…')
    s += part
  }
  return s
}
function typeOf(v) {
  if (v === null) return 'null'
  if (typeof v !== 'object') return typeof v
  return ctorName(v) || 'Object'
}
function expandable(v) {
  if (v === null || typeof v !== 'object') return false
  return !(v instanceof Date || v instanceof RegExp || v instanceof Promise)
}
function mk(name, v) {
  const out = { name: String(name), value: preview(v, 0), type: typeOf(v) }
  if (expandable(v)) { const r = nextRef++; refs.set(r, v); out.ref = r }
  return out
}
const CAP = 200
function children(v) {
  const out = []
  if (Array.isArray(v) || (ArrayBuffer.isView(v) && typeof v.length === 'number')) {
    for (let i = 0; i < v.length && out.length < CAP; i++) out.push(mk(String(i), v[i]))
    out.push(mk('length', v.length))
    return out
  }
  if (v instanceof Map) {
    for (const [k, x] of v) { if (out.length >= CAP) break; out.push(mk(preview(k, 1), x)) }
    out.push(mk('size', v.size))
    return out
  }
  if (v instanceof Set) {
    let i = 0
    for (const x of v) { if (out.length >= CAP) break; out.push(mk(String(i++), x)) }
    out.push(mk('size', v.size))
    return out
  }
  for (const k of Object.getOwnPropertyNames(v)) {
    if (out.length >= CAP) break
    const d = Object.getOwnPropertyDescriptor(v, k)
    if (d && 'value' in d) out.push(mk(k, d.value))
    else out.push({ name: k, value: '(...)', type: 'accessor' })
  }
  return out
}
function triples(get) {
  if (!get) return []
  try { return get() || [] } catch (e) { return [] }
}
function thisOf(f) {
  if (!f.self) return undefined
  try { const t = f.self(); return t === self ? undefined : t } catch (e) { return undefined }
}
function scopesOf(f) {
  const locals = [], closure = []
  const t = triples(f.get)
  for (let i = 0; i < t.length; i += 3) (t[i + 2] ? closure : locals).push(mk(t[i], t[i + 1]))
  const scopes = [{ name: 'Locals', variables: locals }]
  const th = thisOf(f)
  if (th !== undefined && th !== null) scopes.push({ name: 'this', variables: expandable(th) ? children(th) : [mk('this', th)] })
  if (closure.length) scopes.push({ name: 'Closure', variables: closure })
  if (f.G) {
    const g = triples(f.G), vars = []
    for (let i = 0; i < g.length; i += 3) vars.push(mk(g[i], g[i + 1]))
    scopes.push({ name: 'Globals', variables: vars, expensive: true })
  }
  return scopes
}

const IDENT = /^[A-Za-z_$][\w$]*$/
function evaluate(expr, idx) {
  const f = stopped[idx]
  if (!f) throw new Error('No such frame')
  const vals = new Map()
  const g = f.G ? triples(f.G) : []
  for (let i = 0; i < g.length; i += 3) vals.set(g[i], g[i + 1])
  const t = triples(f.get)
  for (let i = t.length - 3; i >= 0; i -= 3) if (t[i + 2]) vals.set(t[i], t[i + 1])
  for (let i = t.length - 3; i >= 0; i -= 3) if (!t[i + 2]) vals.set(t[i], t[i + 1])
  const names = [...vals.keys()].filter((n) => IDENT.test(n) && n !== 'arguments' && n !== 'eval')
  let fn
  try { fn = new Function(...names, 'return (' + expr + '\n)') }
  catch (e) { fn = new Function(...names, expr) }
  evaluating++
  try { return mk(expr, fn.apply(thisOf(f), names.map((n) => vals.get(n)))) }
  finally { evaluating-- }
}
function errText(e) {
  if (e instanceof Error) return (e.name || 'Error') + ': ' + e.message
  try { return 'Uncaught ' + preview(e, 0) } catch (x) { return String(e) }
}

// ---------------------------------------------------------------- stop / park
function stop(reason, description, frameList) {
  Atomics.store(i32, PAUSE, 0)
  refs = new Map(); nextRef = 1
  stopped = frameList.slice().reverse()
  const frames = stopped.map((f) => ({ name: f.name, path: files[f.fid] || '?', line: f.line, scopes: scopesOf(f) }))
  postMessage({ type: 'dbg-stop', stopped: description ? { reason, description, frames } : { reason, frames } })
  for (;;) {
    Atomics.wait(i32, CMD, cmdSeen)
    const seq = Atomics.load(i32, CMD)
    if (seq === cmdSeen) continue
    cmdSeen = seq
    let cmd
    try { cmd = JSON.parse(readStr(CMD_OFF, Atomics.load(i32, CMDLEN))) } catch (e) { continue }
    if (cmd.op === 'resume') {
      entry = false
      mode = cmd.cmd === 'stepInto' ? 1 : cmd.cmd === 'stepOver' ? 2 : cmd.cmd === 'stepOut' ? 3 : 0
      stepDepth = frameList === stack ? stack.length : 0
      if (reason === 'exception') mode = 0
      refs = new Map(); stopped = []
      postMessage({ type: 'dbg-resumed' })
      return
    }
    let reply
    try {
      if (cmd.op === 'vars') {
        const v = refs.get(cmd.ref)
        if (v === undefined) throw new Error('That value is no longer available')
        reply = { ok: true, result: children(v) }
      } else {
        reply = { ok: true, result: evaluate(cmd.expr, cmd.frame | 0) }
      }
    } catch (e) { reply = { ok: false, error: errText(e) } }
    postMessage(Object.assign({ type: 'dbg-reply', id: cmd.id }, reply))
  }
}
})();
`
