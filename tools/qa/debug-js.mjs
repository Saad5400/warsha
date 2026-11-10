/* JavaScript / TypeScript debugger, driven headlessly against the REAL JS engine
 * (app/src/runtime/js.ts + jsInstrument.ts) through the dev-only seam
 * `window.__warshaRuntime` (app/src/runtime/index.ts), so it needs a DEV server:
 *
 *   cd app && npx vite --port 8095 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8095/ CHROME=... node debug-js.mjs
 *
 * Covers the contract in app/src/runtime/debug.ts: breakpoint stop with the
 * right line and locals, stepInto (into an imported util.js) / stepOver /
 * stepOut with the right stack, variables(ref) on an array and an object,
 * evaluate (value + error text), setBreakpoints while parked and while running,
 * pause in an infinite loop, kill while parked -> onExit(null), a TypeScript
 * entry whose types shift the emitted lines (stops on the ORIGINAL line), a
 * class method with a `this` scope, a post-mortem exception stop,
 * stopOnEntry, and a plain run that is unchanged. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8095/'
const profile = mkdtempSync(join(tmpdir(), 'warsha-dbg-js-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (n, ok, d = '') => (ok ? pass(n, d) : fail(n, d))
const J = (x) => JSON.stringify(x)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('      pageerror: ' + e.message))

// First visit installs the COOP/COEP service worker and reloads once.
await page.goto(URL_)
for (let i = 0; i < 3; i++) {
  try {
    await page.waitForFunction(() => self.crossOriginIsolated && window.__warshaRuntime, null, { timeout: 30000 })
    break
  } catch {
    await page.reload()
  }
}
check('page is cross-origin isolated with the dev runtime seam', await page.evaluate(() => self.crossOriginIsolated && !!window.__warshaRuntime))

await page.evaluate(() => {
  const T = (window.__T = { rt: null, s: null, stops: [], out: '', err: '', exit: undefined, resumes: 0 })
  T.reset = () => { T.stops = []; T.out = ''; T.err = ''; T.exit = undefined; T.resumes = 0; T.s = null }
  T.io = {
    onStdout: (t) => { T.out += t },
    onStderr: (t) => { T.err += t },
    onStdinRequest: () => {},
    onExit: (c) => { T.exit = c },
    onDebugStop: (s) => { T.stops.push(s) },
    onDebugResume: () => { T.resumes++ },
  }
  T.start = async (files, entry, opts) => {
    if (T.s && T.exit === undefined) T.s.kill()
    T.reset()
    T.rt = window.__warshaRuntime.runtimeFor(entry)
    await T.rt.load(() => {}, { files, entry })
    T.s = await T.rt.run(files, entry, T.io, opts)
    return { hasDebug: !!T.s.debug }
  }
  T.last = () => T.stops[T.stops.length - 1]
  const scope = (s, name) => s.frames[0].scopes.find((x) => x.name === name)
  T.summary = (s = T.last()) => s && {
    reason: s.reason,
    description: s.description,
    stack: s.frames.map((f) => `${f.name}@${f.path}:${f.line}`),
    locals: Object.fromEntries((scope(s, 'Locals')?.variables ?? []).map((v) => [v.name, v.value])),
    self: scope(s, 'this') && Object.fromEntries(scope(s, 'this').variables.map((v) => [v.name, v.value])),
    globals: scope(s, 'Globals') && { expensive: scope(s, 'Globals').expensive === true, names: scope(s, 'Globals').variables.map((v) => v.name) },
  }
  T.ref = (name) => scope(T.last(), 'Locals').variables.find((v) => v.name === name)?.ref
  T.kids = async (name) => (await T.s.debug.variables(T.ref(name))).map((v) => `${v.name}=${v.value}`)
  T.evalv = async (e, f = 0) => { try { return 'ok:' + (await T.s.debug.evaluate(e, f)).value } catch (x) { return 'err:' + x.message } }
})

const waitStops = (n, timeout = 20000) => page.waitForFunction((k) => window.__T.stops.length >= k, n, { timeout }).catch(async (e) => {
  console.log('      state at timeout: ' + (await page.evaluate(() => J0())))
  throw e
})
const waitExit = (timeout = 20000) => page.waitForFunction(() => window.__T.exit !== undefined, null, { timeout })
await page.evaluate(() => { window.J0 = () => JSON.stringify({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err, stops: window.__T.stops.length }) })
const summary = () => page.evaluate(() => window.__T.summary())
const resume = (cmd) => page.evaluate((c) => window.__T.s.debug.resume(c), cmd)
const step = async (cmd) => {
  const n = await page.evaluate(() => window.__T.stops.length)
  await resume(cmd)
  await waitStops(n + 1)
  return summary()
}

check('canDebug: .js/.ts yes, .html/.py no', await page.evaluate(() => {
  const rt = window.__warshaRuntime.runtimeFor('main.js')
  return rt.canDebug('main.js') && rt.canDebug('src/a.ts') && rt.canDebug('x.mjs') && !rt.canDebug('index.html') && !rt.canDebug('a.py')
}))

// ------------------------------------------------------------ A: multi-file ESM
const UTIL = [
  'export function add(a, b) {', // 1
  '  const sum = a + b', //          2
  '  return sum', //                 3
  '}', //                            4
  'export const PI = 3.14', //       5
].join('\n')
const MAIN = [
  "import { add } from './util.js'", // 1
  'const nums = [1, 2, 3]', //          2
  "const cfg = { a: 1, b: 'x' }", //    3
  'let total = 0', //                   4
  'for (const n of nums) {', //         5
  '  total = add(total, n)', //         6
  '}', //                               7
  "console.log('total', total)", //     8
  'const done = true', //               9
].join('\n')
const FILES_A = [{ path: 'main.js', content: MAIN }, { path: 'util.js', content: UTIL }]

const a0 = await page.evaluate(([f]) => window.__T.start(f, 'main.js', { debug: { breakpoints: [{ path: 'main.js', line: 6 }] } }), [FILES_A])
check('A: debug run exposes session.debug', a0.hasDebug)
await waitStops(1)
let s = await summary()
check('A: breakpoint stop on main.js:6', s.reason === 'breakpoint' && J(s.stack) === J(['<module>@main.js:6']), J(s.stack))
check('A: locals at the breakpoint', s.locals.n === '1' && s.locals.total === '0' && s.locals.nums === 'Array(3) [1, 2, 3]' && s.locals.cfg === '{a: 1, b: "x"}' && s.locals.add === 'ƒ add', J(s.locals))
const kidsArr = await page.evaluate(() => window.__T.kids('nums'))
check('A: variables(ref) expands the array', J(kidsArr) === J(['0=1', '1=2', '2=3', 'length=3']), J(kidsArr))
const kidsObj = await page.evaluate(() => window.__T.kids('cfg'))
check('A: variables(ref) expands the object', J(kidsObj) === J(['a=1', 'b="x"']), J(kidsObj))
const ev1 = await page.evaluate(() => window.__T.evalv('total + n * 10'))
const ev2 = await page.evaluate(() => window.__T.evalv('nope + 1'))
const ev3 = await page.evaluate(() => window.__T.evalv('nums.map(x => x * 2)'))
check('A: evaluate value', ev1 === 'ok:10' && ev3 === 'ok:Array(3) [2, 4, 6]', `${ev1} ${ev3}`)
check('A: evaluate error text', ev2 === 'err:ReferenceError: nope is not defined', ev2)

s = await step('stepInto')
check('A: stepInto lands in util.js add()', s.reason === 'step' && J(s.stack) === J(['add@util.js:2', '<module>@main.js:6']), J(s.stack))
check('A: callee locals + Globals (expensive) of util.js', s.locals.a === '0' && s.locals.b === '1' && s.globals?.expensive && s.globals.names.includes('PI'), J(s))
s = await step('stepOver')
check('A: stepOver to util.js:3 with sum', J(s.stack) === J(['add@util.js:3', '<module>@main.js:6']) && s.locals.sum === '1', J(s))
s = await step('stepOut')
check('A: stepOut returns to the call line main.js:6', J(s.stack) === J(['<module>@main.js:6']), J(s.stack))
s = await step('stepOver')
check('A: stepOver (top level) to the next iteration', J(s.stack) === J(['<module>@main.js:6']) && s.locals.n === '2' && s.locals.total === '1', J(s))
await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'main.js', line: 9 }]))
s = await step('continue')
check('A: setBreakpoints while parked moves the stop to line 9', s.reason === 'breakpoint' && J(s.stack) === J(['<module>@main.js:9']), J(s.stack))
check('A: console.log streamed while debugging', (await page.evaluate(() => window.__T.out)) === 'total 6\n')
await resume('continue')
await waitExit()
const ra = await page.evaluate(() => ({ exit: window.__T.exit, resumes: window.__T.resumes, err: window.__T.err }))
check('A: run finishes with exit 0 and onDebugResume per resume', ra.exit === 0 && ra.resumes === 6 && ra.err === '', J(ra))

// ------------------------------------------------------------ B: pause + running setBreakpoints + kill
const LOOP = [
  'let i = 0', //                      1
  'while (true) {', //                 2
  '  i++', //                          3
  '  if (i < 0) console.log(i)', //    4
  '}', //                              5
].join('\n')
await page.evaluate(([c]) => window.__T.start([{ path: 'main.js', content: c }], 'main.js', { debug: { breakpoints: [] } }), [LOOP])
await page.waitForTimeout(400)
await page.evaluate(() => window.__T.s.debug.pause())
await waitStops(1)
s = await summary()
check('B: pause stops an infinite loop', s.reason === 'pause' && /^<module>@main\.js:[34]$/.test(s.stack[0]) && Number(s.locals.i) > 0, J(s))
check('B: variables() rejects while running', await page.evaluate(async () => {
  window.__T.s.debug.resume('continue')
  try { await window.__T.s.debug.variables(1); return false } catch { return true }
}))
await page.waitForTimeout(200)
await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'main.js', line: 4 }]))
await waitStops(2)
s = await summary()
check('B: setBreakpoints while running is honoured', s.reason === 'breakpoint' && s.stack[0] === '<module>@main.js:4', J(s))
await page.evaluate(() => window.__T.s.kill())
await waitExit(5000)
check('B: kill while parked -> onExit(null)', (await page.evaluate(() => window.__T.exit)) === null)

// ------------------------------------------------------------ C: TypeScript, line mapping, class + this
const TS = [
  'interface Pt {', //                     1
  '  x: number', //                        2
  '  y: number', //                        3
  '}', //                                  4
  'type Name = string', //                 5
  'function mk(x: number, y: number): Pt {', // 6
  '  const p: Pt = { x, y }', //           7
  '  return p', //                         8
  '}', //                                  9
  "const who: Name = 'ts'", //            10
  'const pt = mk(3, 4)', //               11
  'console.log(who, pt.x + pt.y)', //     12
  'class Counter {', //                   13
  '  count: number = 0', //               14
  '  inc(by: number): Counter {', //      15
  '    this.count += by', //              16
  '    return this', //                   17
  '  }', //                               18
  '}', //                                 19
  'new Counter().inc(2)', //              20
].join('\n')
await page.evaluate(([c]) => window.__T.start([{ path: 'main.ts', content: c }], 'main.ts', {
  debug: { breakpoints: [{ path: 'main.ts', line: 7 }, { path: 'main.ts', line: 16 }] },
}), [TS])
await waitStops(1)
s = await summary()
check('C: TS breakpoint on the ORIGINAL line 7', J(s.stack) === J(['mk@main.ts:7', '<module>@main.ts:11']), J(s.stack))
check('C: TS locals', s.locals.x === '3' && s.locals.y === '4', J(s.locals))
s = await step('stepOver')
check('C: TS stepOver to line 8 with p', J(s.stack) === J(['mk@main.ts:8', '<module>@main.ts:11']) && s.locals.p === '{x: 3, y: 4}', J(s))
s = await step('continue')
check('C: method frame name + this scope', J(s.stack) === J(['Counter.inc@main.ts:16', '<module>@main.ts:20']) && s.self?.count === '0' && s.locals.by === '2', J(s))
const evThis = await page.evaluate(() => window.__T.evalv('this'))
check('C: evaluate `this` previews a class instance', evThis === 'ok:Counter {count: 0}', evThis)
await resume('continue')
await waitExit()
check('C: TS run finishes with its output', (await page.evaluate(() => window.__T.out)) === 'ts 7\n')

// ------------------------------------------------------------ D: uncaught exception
const BOOM = [
  'function boom(n) {', //                  1
  '  const half = n / 2', //                2
  "  throw new Error('bad ' + half)", //    3
  '}', //                                   4
  'boom(8)', //                             5
].join('\n')
await page.evaluate(([c]) => window.__T.start([{ path: 'main.js', content: c }], 'main.js', { debug: { breakpoints: [] } }), [BOOM])
await waitStops(1)
s = await summary()
check('D: uncaught exception stops post-mortem in the throwing frame', s.reason === 'exception' && s.description === 'Error: bad 4' && J(s.stack) === J(['boom@main.js:3', '<module>@main.js:5']) && s.locals.half === '4', J(s))
await resume('continue')
await waitExit()
const rd = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err }))
check('D: then the error prints and the run exits 1', rd.exit === 1 && rd.err.includes('bad 4'), J(rd))

// ------------------------------------------------------------ E: stopOnEntry (plain script path)
await page.evaluate(() => window.__T.start([{ path: 'main.js', content: "const a = 1\nconsole.log('a', a)" }], 'main.js', { debug: { breakpoints: [], stopOnEntry: true } }))
await waitStops(1)
s = await summary()
check('E: stopOnEntry stops on line 1 with reason entry', s.reason === 'entry' && J(s.stack) === J(['<module>@main.js:1']), J(s))
s = await step('stepOver')
check('E: stepOver to line 2 sees a', s.reason === 'step' && s.stack[0] === '<module>@main.js:2' && s.locals.a === '1', J(s))
await resume('continue')
await waitExit()
check('E: finishes with exit 0', (await page.evaluate(() => window.__T.exit)) === 0)

// ------------------------------------------------------------ F: plain runs unchanged
await page.evaluate(([f]) => window.__T.start(f, 'main.js'), [FILES_A])
await waitExit()
const rf = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, stops: window.__T.stops.length, dbg: !!window.__T.s.debug }))
check('F: plain multi-file run: output, exit 0, no debug surface, no stops', rf.exit === 0 && rf.out === 'total 6\n' && rf.stops === 0 && !rf.dbg, J(rf))
await page.evaluate(() => window.__T.start([{ path: 'main.js', content: "console.log('hi', 1 + 1)" }], 'main.js'))
await waitExit()
const rf2 = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out }))
check('F: plain single-file run unchanged', rf2.exit === 0 && rf2.out === 'hi 2\n', J(rf2))

await ctx.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
