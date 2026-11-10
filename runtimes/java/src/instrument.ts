/* Source instrumentation for the Java debugger.
 *
 * CheerpJ has no JDWP, so a debug run compiles a REWRITTEN copy of the
 * student's sources: every statement gets a call into warsha.Dbg (bootstrap/
 * Dbg.java) in front of it, and every method/constructor/lambda body is wrapped
 * so Dbg can keep a call stack. Dbg decides, per call, whether to park the
 * program (breakpoint, step, pause) through an async native -- the same
 * mechanism that parks a Scanner read.
 *
 * THE ONE RULE: never add or remove a newline. Every insertion is spliced into
 * an existing line, so the line numbers Dbg reports, and any compiler error
 * the rewritten source could produce, are the student's own.
 *
 *   x = f(y);
 * becomes
 *   warsha.Dbg.l(7,0,"y,x",new Object[]{y,x},this);x = f(y);
 *
 * Locals passed to a hook are the ones Java's definite-assignment rules let us
 * read there: parameters, catch parameters, enhanced-for variables, resources,
 * and locals declared earlier in an enclosing block WITH an initializer (or
 * assigned by a plain `x = ...;` statement in the same block before the hook).
 * Lambda and local/anonymous class bodies start a fresh scope, since reading an
 * enclosing local there would require it to be effectively final.
 *
 * Parsing is web-tree-sitter with the app's Java grammar, handed in by the
 * caller (runtimes import nothing from npm). This module only needs the
 * structural subset of its Node API typed below.
 */

export interface TSNode {
  type: string
  text: string
  startIndex: number
  endIndex: number
  startPosition: { row: number; column: number }
  isNamed: boolean
  children: (TSNode | null)[]
  namedChildren: (TSNode | null)[]
  childForFieldName(name: string): TSNode | null
}

export interface JavaParserLike {
  parse(source: string): { rootNode: TSNode; delete?(): void } | null
}

interface Insertion {
  pos: number
  text: string
  close: boolean
  seq: number
}

interface Ctx {
  /** Simple name of the innermost class, `Outer$1` for anonymous ones. */
  cls: string
  /** No `this` available (static context, compact constructor, super(...) args). */
  noThis: boolean
  /** Name of the enclosing method, for lambda frame names. */
  method: string
  anonCounter: { n: number }
}

const HOOKABLE = new Set([
  'expression_statement',
  'local_variable_declaration',
  'return_statement',
  'if_statement',
  'while_statement',
  'for_statement',
  'enhanced_for_statement',
  'do_statement',
  'switch_expression',
  'switch_statement',
  'try_statement',
  'try_with_resources_statement',
  'throw_statement',
  'break_statement',
  'continue_statement',
  'yield_statement',
  'assert_statement',
  'synchronized_statement',
  'labeled_statement',
])

const CLASS_DECLS = new Set([
  'class_declaration',
  'enum_declaration',
  'record_declaration',
  'interface_declaration',
  'annotation_type_declaration',
])


/**
 * Rewrites one Java source file for a debug run. `fileId` is the number Dbg
 * reports frames under; the runtime maps it back to a project path.
 * Returns the source unchanged if it does not parse cleanly enough to trust.
 */
export function instrumentJava(parser: JavaParserLike, source: string, fileId: number): string {
  const tree = parser.parse(source)
  if (!tree) return source
  try {
    return new Instrumenter(source, fileId).run(tree.rootNode)
  } finally {
    tree.delete?.()
  }
}

class Instrumenter {
  private readonly inserts: Insertion[] = []
  private seq = 0
  private lastHookLine = -1

  private readonly source: string
  private readonly fileId: number

  constructor(source: string, fileId: number) {
    this.source = source
    this.fileId = fileId
  }

  run(root: TSNode): string {
    this.walk(root, { cls: 'Main', noThis: true, method: 'main', anonCounter: { n: 0 } })
    if (!this.inserts.length) return this.source
    const sorted = [...this.inserts].sort((a, b) => {
      if (a.pos !== b.pos) return a.pos - b.pos
      if (a.close !== b.close) return a.close ? -1 : 1
      return a.close ? b.seq - a.seq : a.seq - b.seq
    })
    let out = ''
    let at = 0
    for (const ins of sorted) {
      out += this.source.slice(at, ins.pos) + ins.text
      at = ins.pos
    }
    return out + this.source.slice(at)
  }

  private insert(pos: number, text: string, close = false): void {
    this.inserts.push({ pos, text, close, seq: this.seq++ })
  }

  // --- declarations ----------------------------------------------------------

  /** Generic descent: finds classes, lambdas and anonymous classes anywhere. */
  private walk(node: TSNode, ctx: Ctx): void {
    if (CLASS_DECLS.has(node.type)) return this.classDecl(node, ctx)
    if (node.type === 'lambda_expression') return this.lambda(node, ctx)
    if (node.type === 'object_creation_expression') {
      const body = kids(node).find((c) => c.type === 'class_body')
      for (const c of kids(node)) if (c !== body) this.walk(c, ctx)
      if (body) {
        ctx.anonCounter.n++
        const anon: Ctx = { cls: `${ctx.cls}$${ctx.anonCounter.n}`, noThis: false, method: ctx.method, anonCounter: { n: 0 } }
        this.classBody(body, anon, false)
      }
      return
    }
    if (node.type === 'switch_expression') return this.switchBlock(node, ctx, [], false)
    for (const c of kids(node)) this.walk(c, ctx)
  }

  private classDecl(node: TSNode, outer: Ctx): void {
    const name = node.childForFieldName('name')?.text ?? outer.cls
    const ctx: Ctx = { cls: name, noThis: false, method: outer.method, anonCounter: { n: 0 } }
    const body = node.childForFieldName('body')
    const isInterface = node.type === 'interface_declaration' || node.type === 'annotation_type_declaration'
    if (body) this.classBody(body, ctx, isInterface)
  }

  private classBody(body: TSNode, ctx: Ctx, isInterface: boolean): void {
    for (const member of kids(body)) this.member(member, ctx, isInterface)
  }

  private member(member: TSNode, ctx: Ctx, isInterface: boolean): void {
    switch (member.type) {
      case 'method_declaration': {
        const name = member.childForFieldName('name')?.text ?? 'method'
        const body = member.childForFieldName('body')
        const isStatic = hasModifier(member, 'static')
        const mctx: Ctx = { ...ctx, method: name, noThis: isStatic }
        if (body) this.functionBody(body, mctx, `${ctx.cls}.${name}`, params(member.childForFieldName('parameters')), member)
        return
      }
      case 'constructor_declaration': {
        const body = member.childForFieldName('body')
        const mctx: Ctx = { ...ctx, method: 'new', noThis: false }
        if (body) this.functionBody(body, mctx, `${ctx.cls}.<init>`, params(member.childForFieldName('parameters')), member)
        return
      }
      case 'compact_constructor_declaration': {
        const body = member.childForFieldName('body') ?? kids(member).find((c) => c.type === 'block') ?? null
        const mctx: Ctx = { ...ctx, method: 'new', noThis: true }
        // Compact constructor parameters are the record components, implicitly.
        const record = parentRecordParams(member)
        if (body) this.functionBody(body, mctx, `${ctx.cls}.<init>`, record, member)
        return
      }
      case 'static_initializer': {
        const body = kids(member).find((c) => c.type === 'block')
        if (body) this.functionBody(body, { ...ctx, method: 'clinit', noThis: true }, `${ctx.cls}.<clinit>`, [], member)
        return
      }
      case 'block':
        // Instance initializer.
        this.functionBody(member, { ...ctx, method: 'init', noThis: false }, `${ctx.cls}.<init>`, [], member)
        return
      case 'field_declaration':
      case 'constant_declaration': {
        const fctx: Ctx = { ...ctx, noThis: isInterface || hasModifier(member, 'static') }
        for (const c of kids(member)) this.walk(c, fctx)
        return
      }
      case 'enum_body_declarations':
        for (const c of kids(member)) this.member(c, ctx, false)
        return
      case 'enum_constant': {
        const body = member.childForFieldName('body')
        for (const c of kids(member)) if (c !== body) this.walk(c, { ...ctx, noThis: true })
        if (body) {
          const name = member.childForFieldName('name')?.text ?? 'constant'
          this.classBody(body, { cls: `${ctx.cls}.${name}`, noThis: false, method: ctx.method, anonCounter: { n: 0 } }, false)
        }
        return
      }
      default:
        if (CLASS_DECLS.has(member.type)) return this.classDecl(member, ctx)
        for (const c of kids(member)) this.walk(c, ctx)
    }
  }

  private lambda(node: TSNode, ctx: Ctx): void {
    const body = node.childForFieldName('body')
    const ps = lambdaParams(node.childForFieldName('parameters') ?? kids(node)[0] ?? null)
    if (body && body.type === 'block') {
      this.functionBody(body, ctx, `${ctx.cls}.lambda$${ctx.method}`, ps, node)
    } else if (body) {
      this.walk(body, ctx)
    }
  }

  /**
   * `{ stmts }` -> `{ enter(...);try{ stmts }catch(Throwable t){thrown(t);throw t;}finally{exit();} }`,
   * after any explicit `super(...)`/`this(...)` in a constructor body.
   */
  private functionBody(block: TSNode, ctx: Ctx, frameName: string, scope: string[], decl: TSNode): void {
    const all = block.children.filter((c): c is TSNode => !!c)
    const open = all[0]
    const close = all[all.length - 1]
    if (!open || open.type !== '{' || !close || close.type !== '}') return
    let stmts = all.slice(1, -1).filter((c) => c.isNamed)
    let pos = open.endIndex
    const fnCtx = ctx
    const first = stmts.find((s) => !isComment(s))
    if (first && first.type === 'explicit_constructor_invocation') {
      // Arguments run before `this` exists.
      this.walk(first, { ...ctx, noThis: true })
      pos = first.endIndex
      stmts = stmts.filter((s) => s.startIndex >= first.endIndex)
    }
    const line = decl.startPosition.row + 1
    const enter = `warsha.Dbg.enter(${javaString(frameName)},${this.fileId},${line});try{`
    const exit = `}catch(java.lang.Throwable $dbgT){warsha.Dbg.thrown($dbgT);throw $dbgT;}finally{warsha.Dbg.exit();}`
    if (!stmts.some((s) => !isComment(s))) {
      // Empty body: one insertion, so open and close cannot be reordered.
      this.insert(pos, enter + exit)
      return
    }
    this.insert(pos, enter)
    // "First statement on this line" is per body: a lambda written on one line
    // must still be able to stop (breakpoint, step into) inside its own body.
    const savedLine = this.lastHookLine
    this.lastHookLine = -1
    this.statements(stmts, fnCtx, [...scope])
    this.lastHookLine = savedLine
    this.insert(close.startIndex, exit, true)
  }

  // --- statements ------------------------------------------------------------

  /** A statement list in one block; `scope` is copied, so it never leaks out. */
  private statements(stmts: TSNode[], ctx: Ctx, inherited: string[]): void {
    const scope = [...inherited]
    const unassigned = new Set<string>()
    for (const stmt of stmts) {
      if (isComment(stmt)) continue
      if (HOOKABLE.has(stmt.type)) this.hook(stmt, ctx, scope)
      this.statement(stmt, ctx, scope)
      if (stmt.type === 'local_variable_declaration') {
        for (const d of kids(stmt)) {
          if (d.type !== 'variable_declarator') continue
          const name = d.childForFieldName('name')?.text
          if (!name) continue
          if (d.childForFieldName('value')) addVar(scope, name)
          else unassigned.add(name)
        }
      } else if (stmt.type === 'expression_statement' && unassigned.size) {
        const e = kids(stmt)[0]
        if (e?.type === 'assignment_expression') {
          const left = e.childForFieldName('left')
          const op = e.childForFieldName('operator')?.text ?? e.children.find((c) => c && !c.isNamed)?.text
          if (left?.type === 'identifier' && op === '=' && unassigned.has(left.text)) {
            unassigned.delete(left.text)
            addVar(scope, left.text)
          }
        }
      }
    }
  }

  private hook(stmt: TSNode, ctx: Ctx, scope: string[]): void {
    const line = stmt.startPosition.row + 1
    const fn = line === this.lastHookLine ? 's' : 'l'
    this.lastHookLine = line
    const names = javaString(scope.join(','))
    const values = scope.length ? `new Object[]{${scope.join(',')}}` : 'null'
    const self = ctx.noThis ? 'null' : 'this'
    this.insert(stmt.startIndex, `warsha.Dbg.${fn}(${line},${this.fileId},${names},${values},${self});`)
  }

  /** A single statement position that may be brace-less: wrap it so a hook fits. */
  private body(node: TSNode | null, ctx: Ctx, scope: string[]): void {
    if (!node) return
    if (node.type === 'block') return this.statements(namedKids(node), ctx, scope)
    if (node.type === ';' || node.type === 'empty_statement') return
    if (!HOOKABLE.has(node.type)) return this.statement(node, ctx, scope)
    this.insert(node.startIndex, '{')
    this.statements([node], ctx, scope)
    this.insert(node.endIndex, '}', true)
  }

  private statement(stmt: TSNode, ctx: Ctx, scope: string[]): void {
    switch (stmt.type) {
      case 'block':
        return this.statements(namedKids(stmt), ctx, scope)
      case 'if_statement': {
        this.walkField(stmt, 'condition', ctx)
        this.body(stmt.childForFieldName('consequence'), ctx, scope)
        const alt = stmt.childForFieldName('alternative')
        // `else if` stays a chain: its own condition is walked, bodies hooked.
        if (alt?.type === 'if_statement') this.statement(alt, ctx, scope)
        else this.body(alt, ctx, scope)
        return
      }
      case 'while_statement':
        this.walkField(stmt, 'condition', ctx)
        return this.body(stmt.childForFieldName('body'), ctx, scope)
      case 'do_statement':
        this.body(stmt.childForFieldName('body'), ctx, scope)
        return this.walkField(stmt, 'condition', ctx)
      case 'for_statement': {
        const inner = [...scope]
        const body = stmt.childForFieldName('body')
        for (const c of kids(stmt)) {
          if (c === body) continue
          if (c.type === 'local_variable_declaration') {
            for (const d of kids(c)) {
              if (d.type !== 'variable_declarator') continue
              const value = d.childForFieldName('value')
              if (value) this.walk(value, ctx)
              const name = d.childForFieldName('name')?.text
              if (name && value) addVar(inner, name)
            }
          } else this.walk(c, ctx)
        }
        return this.body(body, ctx, inner)
      }
      case 'enhanced_for_statement': {
        this.walkField(stmt, 'value', ctx)
        const inner = [...scope]
        const name = stmt.childForFieldName('name')
        if (name?.type === 'identifier') addVar(inner, name.text)
        else if (name) for (const id of identifiers(name)) addVar(inner, id)
        return this.body(stmt.childForFieldName('body'), ctx, inner)
      }
      case 'labeled_statement': {
        // The hook went before the label; the labelled statement itself must stay
        // directly after it or `continue label` breaks.
        const inner = namedKids(stmt).filter((c) => c.type !== 'identifier')[0]
        if (inner) this.statement(inner, ctx, scope)
        return
      }
      case 'try_statement':
      case 'try_with_resources_statement': {
        const inner = [...scope]
        for (const c of kids(stmt)) {
          if (c.type === 'resource_specification') {
            for (const r of kids(c)) {
              if (r.type !== 'resource') continue
              const value = r.childForFieldName('value')
              if (value) this.walk(value, ctx)
              else this.walk(r, ctx)
              const name = r.childForFieldName('name')?.text
              if (name && value) addVar(inner, name)
            }
          } else if (c.type === 'block') {
            this.statements(namedKids(c), ctx, inner)
          } else if (c.type === 'catch_clause') {
            const cscope = [...scope]
            const param = kids(c).find((k) => k.type === 'catch_formal_parameter')
            const pname = param?.childForFieldName('name')?.text
            if (pname) addVar(cscope, pname)
            const block = c.childForFieldName('body') ?? kids(c).find((k) => k.type === 'block')
            if (block) this.statements(namedKids(block), ctx, cscope)
          } else if (c.type === 'finally_clause') {
            const block = kids(c).find((k) => k.type === 'block')
            if (block) this.statements(namedKids(block), ctx, scope)
          }
        }
        return
      }
      case 'switch_expression':
      case 'switch_statement':
        return this.switchBlock(stmt, ctx, scope, true)
      case 'synchronized_statement':
        for (const c of kids(stmt)) {
          if (c.type === 'block') this.statements(namedKids(c), ctx, scope)
          else this.walk(c, ctx)
        }
        return
      default:
        if (CLASS_DECLS.has(stmt.type)) return this.classDecl(stmt, ctx)
        // expression_statement, return, throw, local declarations, yield...:
        // only lambdas / anonymous classes / switch expressions inside matter.
        for (const c of kids(stmt)) this.walk(c, ctx)
    }
  }

  /**
   * `asStatement` is true for a switch STATEMENT, whose rule bodies are
   * statements and may be wrapped. A switch EXPRESSION's `case 1 -> 5;` body is
   * a value and is left alone; block bodies and statement groups get hooks
   * either way. Lambdas and anonymous classes inside a switch expression's
   * blocks cannot see our locals list (`scope` is [] there by construction).
   */
  private switchBlock(sw: TSNode, ctx: Ctx, scope: string[], asStatement: boolean): void {
    const block = sw.childForFieldName('body') ?? kids(sw).find((c) => c.type === 'switch_block')
    for (const c of kids(sw)) if (c !== block) this.walk(c, ctx)
    if (!block) return
    for (const entry of kids(block)) {
      if (entry.type === 'switch_block_statement_group') {
        const stmts = namedKids(entry).filter((c) => c.type !== 'switch_label')
        for (const l of namedKids(entry)) if (l.type === 'switch_label') this.walk(l, ctx)
        this.statements(stmts, ctx, scope)
      } else if (entry.type === 'switch_rule') {
        const parts = namedKids(entry)
        for (const p of parts) {
          if (p.type === 'switch_label') this.walk(p, ctx)
          else if (p.type === 'block') this.statements(namedKids(p), ctx, scope)
          else if (asStatement && (p.type === 'expression_statement' || p.type === 'throw_statement')) {
            this.insert(p.startIndex, '{')
            this.statements([p], ctx, scope)
            this.insert(p.endIndex, '}', true)
          } else this.walk(p, ctx)
        }
      }
    }
  }

  private walkField(node: TSNode, field: string, ctx: Ctx): void {
    const c = node.childForFieldName(field)
    if (c) this.walk(c, ctx)
  }
}

// --- helpers -----------------------------------------------------------------

function kids(node: TSNode): TSNode[] {
  return node.namedChildren.filter((c): c is TSNode => !!c)
}

function namedKids(node: TSNode): TSNode[] {
  return kids(node)
}

function isComment(node: TSNode): boolean {
  return node.type === 'line_comment' || node.type === 'block_comment' || node.type === 'comment'
}

function addVar(scope: string[], name: string): void {
  if (name === '_' || !/^[A-Za-z_$][\w$]*$/.test(name)) return
  // A redeclared name (shadowing in a lambda is impossible here) replaces the old one.
  const i = scope.indexOf(name)
  if (i >= 0) scope.splice(i, 1)
  scope.push(name)
}

function hasModifier(decl: TSNode, word: string): boolean {
  const mods = decl.namedChildren.find((c) => c?.type === 'modifiers')
  if (!mods) return false
  return mods.children.some((c) => c?.text === word)
}

function params(node: TSNode | null): string[] {
  const out: string[] = []
  if (!node) return out
  for (const p of kids(node)) {
    if (p.type === 'formal_parameter') {
      const name = p.childForFieldName('name')
      if (name) addVar(out, name.text)
    } else if (p.type === 'spread_parameter') {
      const decl = kids(p).find((c) => c.type === 'variable_declarator')
      const name = decl?.childForFieldName('name') ?? kids(p).filter((c) => c.type === 'identifier').pop()
      if (name) addVar(out, name.text)
    }
  }
  return out
}

function lambdaParams(node: TSNode | null): string[] {
  if (!node) return []
  if (node.type === 'identifier') return [node.text]
  if (node.type === 'formal_parameters') return params(node)
  if (node.type === 'inferred_parameters') return kids(node).filter((c) => c.type === 'identifier').map((c) => c.text)
  return []
}

function parentRecordParams(ctor: TSNode): string[] {
  // compact_constructor_declaration -> class_body -> record_declaration
  let n: TSNode | null = (ctor as TSNode & { parent?: TSNode | null }).parent ?? null
  while (n && n.type !== 'record_declaration') n = (n as TSNode & { parent?: TSNode | null }).parent ?? null
  return n ? params(n.childForFieldName('parameters')) : []
}

function identifiers(node: TSNode): string[] {
  if (node.type === 'identifier') return [node.text]
  return kids(node).flatMap(identifiers)
}

function javaString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}
