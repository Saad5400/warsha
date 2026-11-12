/* Python debugger, driven headlessly against the REAL Pyodide engine through
 * the dev-only seam `window.__warshaRuntime` (app/src/runtime/index.ts), so it
 * needs a DEV server, not a production build:
 *
 *   cd app && npx vite --port 8091 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8091/ CHROME=... node debug-python.mjs
 *
 * Covers the contract in app/src/runtime/debug.ts: breakpoint stop with the
 * right line and locals, stepInto (into another file) / stepOver / stepOut
 * with the right frame stack, variables(ref) on a list and an object,
 * evaluate (value + error text), setBreakpoints while parked and while
 * running, pause in an infinite loop, a post-mortem exception stop, input()
 * under the debugger, stopOnEntry, kill while parked -> onExit(null), and a
 * plain run that is unchanged. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8091/'
const profile = mkdtempSync(join(tmpdir(), 'warsha-dbg-py-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (n, ok, d = '') => (ok ? pass(n, d) : fail(n, d))

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('      pageerror: ' + e.message))
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('      navigated: ' + f.url()) })
// Mute Vite's HMR socket: an edit anywhere in the tree (other work in progress)
// would otherwise full-reload the page mid-scenario and wipe the harness. The
// mocked socket opens and simply never delivers an update.
await page.routeWebSocket(/./, () => {})

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

// In-page harness: one session at a time; every io callback is recorded.
await page.evaluate(() => {
  const T = (window.__T = { rt: null, s: null, ev: [], stops: [], out: '', err: '', exit: undefined, resumes: 0, stdinReqs: 0 })
  T.reset = () => { T.ev = []; T.stops = []; T.out = ''; T.err = ''; T.exit = undefined; T.resumes = 0; T.stdinReqs = 0; T.s = null }
  T.io = {
    onStdout: (t) => { T.out += t },
    onStderr: (t) => { T.err += t },
    onStdinRequest: () => { T.stdinReqs++ },
    onExit: (c) => { T.exit = c },
    onDebugStop: (s) => { T.stops.push(s) },
    onDebugResume: () => { T.resumes++ },
  }
  T.start = async (files, entry, opts) => {
    // A failed earlier scenario must not wedge the next one.
    if (T.s && T.exit === undefined) T.s.kill()
    T.reset()
    T.s = await T.rt.run(files, entry, T.io, opts)
    return { hasDebug: !!T.s.debug }
  }
  T.last = () => T.stops[T.stops.length - 1]
  T.summary = (s = T.last()) => s && {
    reason: s.reason,
    description: s.description,
    stack: s.frames.map((f) => `${f.name}@${f.path}:${f.line}`),
    locals: Object.fromEntries(s.frames[0].scopes.find((x) => x.name === 'Locals').variables.map((v) => [v.name, v.value])),
    globalsExpensive: s.frames[0].scopes.find((x) => x.name === 'Globals')?.expensive === true,
    globals: s.frames[0].scopes.find((x) => x.name === 'Globals')?.variables.map((v) => v.name),
  }
  T.ref = (name) => T.last().frames[0].scopes.find((x) => x.name === 'Locals').variables.find((v) => v.name === name)?.ref
})

const t0 = Date.now()
await page.evaluate(async () => {
  window.__T.rt = window.__warshaRuntime.runtimeFor('main.py')
  await window.__T.rt.load(() => {})
})
console.log(`      Pyodide loaded in ${Date.now() - t0} ms`)
check('canDebug(main.py) is true, canDebug(x.txt) false', await page.evaluate(() => window.__T.rt.canDebug('main.py') && !window.__T.rt.canDebug('x.txt')))

const waitStops = (n, timeout = 20000) => page.waitForFunction((k) => window.__T.stops.length >= k, n, { timeout })
const waitExit = (timeout = 20000) => page.waitForFunction(() => window.__T.exit !== undefined, null, { timeout }).catch(async (e) => {
  console.log('      state at timeout: ' + (await page.evaluate(() => JSON.stringify({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err, resumes: window.__T.resumes, stops: window.__T.stops.length, stdin: window.__T.stdinReqs }))))
  throw e
})
const resume = (cmd) => page.evaluate((c) => window.__T.s.debug.resume(c), cmd)
const summary = () => page.evaluate(() => window.__T.summary())
const step = async (cmd) => {
  const n = await page.evaluate(() => window.__T.stops.length)
  await resume(cmd)
  await waitStops(n + 1)
  return summary()
}
const at = (s) => s?.stack?.[0]
const J = (x) => JSON.stringify(x)
const ONLY = process.env.ONLY ?? 'ABCDE'

// ------------------------------------------------------------- A: stepping
const MAIN = [
  'from helpers import Point, add', //  1
  '',                               //  2
  'def double(n):',                 //  3
  '    r = n * 2',                  //  4
  '    return r',                   //  5
  '',                               //  6
  'nums = [1, 2, 3]',               //  7
  'p = Point(1, 2)',                //  8
  'total = add(nums[0], nums[1])',  //  9
  'd = double(total)',              // 10
  'print("d", d)',                  // 11
  "info = {'a': 1}",                // 12
  'print("done", total, d, info)',  // 13
].join('\n')
const HELPERS = [
  'class Point:',                   // 1
  '    def __init__(self, x, y):',  // 2
  '        self.x = x',             // 3
  '        self.y = y',             // 4
  '',                               // 5
  'def add(a, b):',                 // 6
  '    s = a + b',                  // 7
  '    return s',                   // 8
].join('\n')
const filesA = [{ path: 'main.py', content: MAIN }, { path: 'helpers.py', content: HELPERS }]

if (ONLY.includes('A')) try {
  const r = await page.evaluate((f) => window.__T.start(f, 'main.py', { debug: { breakpoints: [{ path: 'main.py', line: 9 }] } }), filesA)
  check('debug run exposes session.debug', r.hasDebug)
  await waitStops(1)
  let s = await summary()
  check('A1 stops at breakpoint main.py:9', s.reason === 'breakpoint' && at(s) === '<module>@main.py:9', J(s.stack))
  check('A1 locals show list + object reprs, no class/function/module noise',
    s.locals.nums === '[1, 2, 3]' && s.locals.p === 'Point(x=1, y=2)' && !('Point' in s.locals) && !('add' in s.locals) && !('double' in s.locals) && !('__name__' in s.locals),
    J(s.locals))
  check('A1 Globals scope is expensive and filtered', s.globalsExpensive && s.globals.includes('nums') && !s.globals.includes('__builtins__'), J(s.globals))

  const kids = await page.evaluate(async () => {
    const T = window.__T
    const list = await T.s.debug.variables(T.ref('nums'))
    const obj = await T.s.debug.variables(T.ref('p'))
    return { list: list.map((v) => `${v.name}=${v.value}:${v.type}`), obj: obj.map((v) => `${v.name}=${v.value}`) }
  })
  check('A2 variables(ref) expands a list as 0,1,2', J(kids.list) === J(['0=1:int', '1=2:int', '2=3:int']), J(kids.list))
  check('A2 variables(ref) expands an object by attribute', J(kids.obj) === J(['x=1', 'y=2']), J(kids.obj))

  const ev = await page.evaluate(async () => {
    const T = window.__T
    const ok = await T.s.debug.evaluate('nums[1] + 10', 0)
    let bad = null
    try { await T.s.debug.evaluate('nope', 0) } catch (e) { bad = e.message }
    const str = await T.s.debug.evaluate("'hi'", 0)
    return { ok: ok.value, type: ok.type, bad, str: str.value }
  })
  check('A3 evaluate returns a value', ev.ok === '12' && ev.type === 'int' && ev.str === "'hi'", J(ev))
  check('A3 evaluate error is student-facing text', ev.bad === "NameError: name 'nope' is not defined", ev.bad)

  s = await step('stepInto')
  check('A4 stepInto lands in helpers.py:7 with add over <module>',
    J(s.stack) === J(['add@helpers.py:7', '<module>@main.py:9']) && s.reason === 'step', J(s.stack))
  check('A4 locals of add', s.locals.a === '1' && s.locals.b === '2', J(s.locals))
  s = await step('stepOver')
  check('A5 stepOver -> helpers.py:8', at(s) === 'add@helpers.py:8' && s.locals.s === '3', J(s.stack) + J(s.locals))
  s = await step('stepOut')
  check('A6 stepOut -> back in caller at main.py:9', J(s.stack) === J(['<module>@main.py:9']), J(s.stack))
  s = await step('stepOver')
  check('A7 stepOver -> main.py:10, total assigned', at(s) === '<module>@main.py:10' && s.locals.total === '3', J(s.stack) + J(s.locals))
  s = await step('stepOver')
  check('A8 stepOver steps OVER double() -> main.py:11', at(s) === '<module>@main.py:11' && s.locals.d === '6', J(s.stack) + J(s.locals))
  check('A8 stdout from before the stop is intact', await page.evaluate(() => window.__T.out === ''), await page.evaluate(() => JSON.stringify(window.__T.out)))

  await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'main.py', line: 13 }]))
  s = await step('continue')
  check('A9 setBreakpoints while parked -> continue stops at main.py:13', s.reason === 'breakpoint' && at(s) === '<module>@main.py:13', J(s.stack))
  check('A9 dict repr', s.locals.info === "{'a': 1}", s.locals.info)
  check('A9 stdout printed while running', await page.evaluate(() => window.__T.out === 'd 6\n'), await page.evaluate(() => JSON.stringify(window.__T.out)))

  await resume('continue')
  await waitExit()
  const end = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, resumes: window.__T.resumes, stops: window.__T.stops.length }))
  check('A10 runs to completion with exit 0 and full output', end.exit === 0 && end.out.endsWith("done 3 6 {'a': 1}\n"), J(end))
  check('A10 one onDebugResume per stop', end.resumes === end.stops, J(end))
  const late = await page.evaluate(async () => { try { await window.__T.s.debug.variables(1); return 'resolved' } catch (e) { return 'rejected' } })
  check('A11 variables() after exit rejects', late === 'rejected')
} catch (e) {
  fail('A scenario threw', String(e))
}

// ---------------------------------- B: setBreakpoints while running, pause, kill
if (ONLY.includes('B')) try {
  const LOOP = ['i = 0', 'while True:', '    i += 1', '    if i == -1:', "        print('never')"].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.py', { debug: { breakpoints: [] } }), [{ path: 'main.py', content: LOOP }])
  await page.waitForTimeout(800)
  check('B0 no stop without breakpoints', await page.evaluate(() => window.__T.stops.length === 0 && window.__T.exit === undefined))
  await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'main.py', line: 4 }]))
  await waitStops(1, 5000)
  let s = await summary()
  check('B1 setBreakpoints while RUNNING takes effect', s.reason === 'breakpoint' && at(s) === '<module>@main.py:4', J(s.stack))
  await page.evaluate(() => window.__T.s.debug.setBreakpoints([]))
  await resume('continue')
  await page.waitForTimeout(600)
  check('B2 cleared breakpoints -> keeps running', await page.evaluate(() => window.__T.stops.length === 1 && window.__T.resumes === 1))
  const tp = Date.now()
  await page.evaluate(() => window.__T.s.debug.pause())
  await waitStops(2, 5000)
  s = await summary()
  check('B3 pause stops an infinite loop', s.reason === 'pause' && /^<module>@main\.py:[234]$/.test(at(s)) && Number(s.locals.i) > 0, `${J(s.stack)} i=${s.locals.i} in ${Date.now() - tp}ms`)
  await page.evaluate(() => window.__T.s.kill())
  await waitExit(5000)
  check('B4 kill while parked -> onExit(null)', await page.evaluate(() => window.__T.exit === null))
} catch (e) {
  fail('B scenario threw', String(e))
}

// ----------------------------------------------------------- C: exception
if (ONLY.includes('C')) try {
  const EXC = ['def f(x):', '    y = x - 1', '    return 10 / (x - x)', '', 'f(5)'].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.py', { debug: { breakpoints: [] } }), [{ path: 'main.py', content: EXC }])
  await waitStops(1)
  const s = await summary()
  check('C1 exception stop at the raising frame', s.reason === 'exception' && J(s.stack) === J(['f@main.py:3', '<module>@main.py:5']), J(s.stack))
  check('C1 description', s.description === 'ZeroDivisionError: division by zero', s.description)
  check('C1 post-mortem locals readable', s.locals.x === '5' && s.locals.y === '4', J(s.locals))
  const ev = await page.evaluate(async () => (await window.__T.s.debug.evaluate('x * y', 0)).value)
  check('C2 evaluate in a post-mortem frame', ev === '20', ev)
  await resume('continue')
  await waitExit()
  const end = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err }))
  check('C3 resume ends the run with the traceback and exit 1', end.exit === 1 && end.err.includes('ZeroDivisionError: division by zero') && end.err.includes('main.py", line 3'), J(end))
} catch (e) {
  fail('C scenario threw', String(e))
}

// -------------------------------------------- D: input() + stopOnEntry
if (ONLY.includes('D')) try {
  const INP = ["name = input('Name? ')", "greeting = 'hi ' + name", 'print(greeting)'].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.py', { debug: { breakpoints: [{ path: 'main.py', line: 3 }], stopOnEntry: true } }), [{ path: 'main.py', content: INP }])
  await waitStops(1)
  let s = await summary()
  check('D1 stopOnEntry stops on line 1', s.reason === 'entry' && at(s) === '<module>@main.py:1', J(s))
  await resume('continue')
  await page.waitForFunction(() => window.__T.stdinReqs > 0, null, { timeout: 10000 }).catch(async (e) => { console.log("      D state: " + (await page.evaluate(() => JSON.stringify({ out: window.__T.out, err: window.__T.err, resumes: window.__T.resumes, stops: window.__T.stops.length, exit: window.__T.exit })))); throw e })
  await page.evaluate(() => window.__T.s.writeStdin('Sam'))
  await waitStops(2)
  s = await summary()
  check('D2 input() works under the debugger', s.reason === 'breakpoint' && at(s) === '<module>@main.py:3' && s.locals.greeting === "'hi Sam'", J(s))
  await resume('continue')
  await waitExit()
  const end = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out }))
  check('D3 exits 0 with prompt and greeting', end.exit === 0 && end.out === 'Name? hi Sam\n', J(end))
} catch (e) {
  fail('D scenario threw', String(e))
}

// ------------------------------------------------------- E: plain run
if (ONLY.includes('E')) try {
  const r = await page.evaluate((f) => window.__T.start(f, 'main.py'), filesA)
  await waitExit()
  const end = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, stops: window.__T.stops.length }))
  check('E1 plain run has no session.debug', !r.hasDebug)
  check('E1 plain run unchanged (output, exit 0, no stops)', end.exit === 0 && end.out === "d 6\ndone 3 6 {'a': 1}\n" && end.stops === 0, J(end))
} catch (e) {
  fail('E scenario threw', String(e))
}

await ctx.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
