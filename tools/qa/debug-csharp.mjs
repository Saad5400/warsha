/* C# debugger, driven headlessly against the REAL .NET-wasm + Roslyn engine
 * through the dev-only seam `window.__warshaRuntime` (app/src/runtime/index.ts),
 * so it needs a DEV server (and the staged bundle in app/public/warsha-dotnet):
 *
 *   runtimes/csharp/build.sh
 *   cd app && npx vite --port 8093 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8093/ CHROME=... node debug-csharp.mjs
 *
 * Covers the contract in app/src/runtime/debug.ts for C#: breakpoint stop with
 * the right line and locals, stepInto into a method of a class in another file
 * (Helper.cs) / stepOver / stepOut with the right call stack (outer frame keeps
 * its locals), variables(ref) on an int[], a List<int> and an object,
 * setBreakpoints while running and while parked, pause in an infinite loop,
 * Console.ReadLine under the debugger, a top-level-statements program, an
 * uncaught-exception stop at the throwing frame (a caught one does not stop),
 * stopOnEntry, kill while parked -> onExit(null), compile-error line numbers,
 * a plain run that is unchanged, and the cost of a 100k-iteration loop. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8093/'
const profile = mkdtempSync(join(tmpdir(), 'warsha-dbg-cs-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (n, ok, d = '') => (ok ? pass(n, d) : fail(n, d))
const j = (x) => JSON.stringify(x)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('      pageerror: ' + e.message))
page.on('console', (m) => { if (m.text().includes('warsha-debug')) console.log('      console: ' + m.text()) })
// Mute Vite's HMR socket: other work in the tree must not full-reload the page mid-run.
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

await page.evaluate(() => {
  const T = (window.__T = { rt: null, s: null, stops: [], out: '', err: '', exit: undefined, resumes: 0, stdinReqs: 0 })
  T.reset = () => { T.stops = []; T.out = ''; T.err = ''; T.exit = undefined; T.resumes = 0; T.stdinReqs = 0; T.s = null }
  T.io = {
    onStdout: (t) => { T.out += t },
    onStderr: (t) => { T.err += t },
    onStdinRequest: () => { T.stdinReqs++ },
    onExit: (c) => { T.exit = c },
    onDebugStop: (s) => { T.stops.push(s) },
    onDebugResume: () => { T.resumes++ },
  }
  T.start = async (files, entry, opts) => {
    if (T.s && T.exit === undefined) T.s.kill()
    T.reset()
    T.t0 = performance.now()
    T.s = await T.rt.run(files, entry, T.io, opts)
    return { hasDebug: !!T.s.debug }
  }
  T.last = () => T.stops[T.stops.length - 1]
  T.scope = (frame, name) => frame.scopes.find((x) => x.name === name)?.variables ?? []
  T.summary = (s = T.last()) => s && {
    reason: s.reason,
    description: s.description,
    stack: s.frames.map((f) => `${f.name}@${f.path}:${f.line}`),
    locals: Object.fromEntries(T.scope(s.frames[0], 'Locals').map((v) => [v.name, v.value])),
    types: Object.fromEntries(T.scope(s.frames[0], 'Locals').map((v) => [v.name, v.type])),
    self: Object.fromEntries(T.scope(s.frames[0], 'this').map((v) => [v.name, v.value])),
    outer: s.frames[1] && Object.fromEntries(T.scope(s.frames[1], 'Locals').map((v) => [v.name, v.value])),
  }
  T.ref = (name) => T.scope(T.last().frames[0], 'Locals').find((v) => v.name === name)?.ref
  T.vars = async (name) => {
    const kids = await T.s.debug.variables(T.ref(name))
    return kids.map((k) => `${k.name}=${k.value}`)
  }
})

const waitStops = (n, timeout = 30000) => page.waitForFunction((k) => window.__T.stops.length >= k, n, { timeout }).catch(async (e) => {
  console.log('      state: ' + (await page.evaluate(() => JSON.stringify({ out: window.__T.out, err: window.__T.err, stops: window.__T.stops.length, exit: window.__T.exit }))))
  throw e
})
const waitExit = (timeout = 30000) => page.waitForFunction(() => window.__T.exit !== undefined, null, { timeout }).catch(async (e) => {
  console.log('      state: ' + (await page.evaluate(() => JSON.stringify({ out: window.__T.out, err: window.__T.err, stops: window.__T.stops.length, exit: window.__T.exit }))))
  throw e
})
const summary = () => page.evaluate(() => window.__T.summary())
const resume = (cmd) => page.evaluate((c) => window.__T.s.debug.resume(c), cmd)
const T = (fn, arg) => page.evaluate(fn, arg)

async function scenario(name, fn) {
  try {
    await fn()
  } catch (e) {
    fail(name, String(e.message || e).split('\n')[0])
  }
}

// --- boot ---------------------------------------------------------------------
const boot = await page.evaluate(async () => {
  const t0 = performance.now()
  window.__T.rt = window.__warshaRuntime.runtimeFor('Program.cs')
  await window.__T.rt.load(() => {})
  return { id: window.__T.rt.id, ms: Math.round(performance.now() - t0), canDebug: window.__T.rt.canDebug?.('Program.cs'), canDebugPy: window.__T.rt.canDebug?.('main.py') }
})
check('C# engine boots via the dev seam', boot.id === 'csharp', `${boot.ms} ms`)
check('canDebug: true for .cs, false otherwise', boot.canDebug === true && boot.canDebugPy === false)

// --- the main program: breakpoint, locals, refs, step into another file -----------
const PROGRAM = [
  'using System;',                                   // 1
  'using System.Collections.Generic;',               // 2
  '',                                                // 3
  'class Program',                                   // 4
  '{',                                               // 5
  '    static void Main(string[] args)',             // 6
  '    {',                                           // 7
  '        int count = 3;',                          // 8
  '        int[] nums = { 10, 20, 30 };',            // 9
  '        var list = new List<int> { 1, 2, 3 };',   // 10
  '        var h = new Helper("calc", 2);',          // 11
  '        int total = h.Scale(count);',             // 12
  '        string msg = "done";',                    // 13
  '        Console.WriteLine(msg + " " + total + " " + nums.Length + " " + list.Count);', // 14
  '    }',                                           // 15
  '}',                                               // 16
].join('\n')
const HELPER = [
  'public class Helper',                             // 1
  '{',                                               // 2
  '    public string Name;',                         // 3
  '    private int factor;',                         // 4
  '    public Helper(string name, int factor)',      // 5
  '    {',                                           // 6
  '        Name = name;',                            // 7
  '        this.factor = factor;',                   // 8
  '    }',                                           // 9
  '    public int Scale(int x)',                     // 10
  '    {',                                           // 11
  '        int r = x * factor;',                     // 12
  '        return r + 1;',                           // 13
  '    }',                                           // 14
  '}',                                               // 15
].join('\n')
const MAIN_FILES = [{ path: 'Program.cs', content: PROGRAM }, { path: 'Helper.cs', content: HELPER }]

await scenario('breakpoint + steps', async () => {
  const r = await T((f) => window.__T.start(f, 'Program.cs', { debug: { breakpoints: [{ path: 'Program.cs', line: 12 }] } }), MAIN_FILES)
  check('debug run exposes session.debug', r.hasDebug === true)
  await waitStops(1)
  let s = await summary()
  const ms = await T(() => Math.round(performance.now() - window.__T.t0))
  check('breakpoint stop: reason + line', s.reason === 'breakpoint' && s.stack[0] === 'Program.Main@Program.cs:12', `${j(s.stack)} after ${ms} ms`)
  check('breakpoint stop: locals with VS Code values', s.locals.count === '3' && s.locals.nums === 'int[3]' && s.locals.list === 'Count = 3' && s.locals.h === '{Helper}' && s.locals.args === 'string[0]' && !('total' in s.locals) && !('msg' in s.locals), j(s.locals))
  check('breakpoint stop: types', s.types.count === 'int' && s.types.list === 'List<int>' && s.types.h === 'Helper', j(s.types))

  const arr = await T(() => window.__T.vars('nums'))
  check('variables(ref) on int[]', j(arr) === j(['[0]=10', '[1]=20', '[2]=30']), j(arr))
  const lst = await T(() => window.__T.vars('list'))
  check('variables(ref) on List<int>', j(lst) === j(['[0]=1', '[1]=2', '[2]=3']), j(lst))
  const obj = await T(() => window.__T.vars('h'))
  check('variables(ref) on an object (public + private fields)', j(obj) === j(['Name="calc"', 'factor=2']), j(obj))
  const both = await T(async () => { const T = window.__T; const [a, b] = await Promise.all([T.vars('nums'), T.vars('h')]); return [a.length, b.length] })
  check('concurrent variables() calls both answer', j(both) === j([3, 2]), j(both))

  await resume('stepInto')
  await waitStops(2)
  s = await summary()
  check('stepInto lands in Helper.cs (another file)', s.reason === 'step' && s.stack[0] === 'Helper.Scale@Helper.cs:12', j(s.stack))
  check('call stack: Helper.Scale above Program.Main', j(s.stack) === j(['Helper.Scale@Helper.cs:12', 'Program.Main@Program.cs:12']), j(s.stack))
  check('callee locals + this scope', s.locals.x === '3' && s.self.factor === '2' && s.self.Name === '"calc"', j({ l: s.locals, t: s.self }))
  check('outer frame keeps its locals', s.outer && s.outer.count === '3' && s.outer.h === '{Helper}', j(s.outer))

  await resume('stepOver')
  await waitStops(3)
  s = await summary()
  check('stepOver inside callee', s.stack[0] === 'Helper.Scale@Helper.cs:13' && s.locals.r === '6', j({ st: s.stack[0], l: s.locals }))

  await resume('stepOut')
  await waitStops(4)
  s = await summary()
  check('stepOut returns to caller (next line)', s.stack.length === 1 && s.stack[0] === 'Program.Main@Program.cs:13' && s.locals.total === '7', j({ st: s.stack, l: s.locals }))

  await resume('stepOver')
  await waitStops(5)
  s = await summary()
  check('stepOver in Main', s.stack[0] === 'Program.Main@Program.cs:14' && s.locals.msg === '"done"', j({ st: s.stack, l: s.locals }))

  const running = await T(() => window.__T.s.debug.variables(1).then(() => 'resolved', (e) => 'rejected'))
  check('variables() while parked still works', running === 'resolved')
  await resume('continue')
  await waitExit()
  const end = await T(() => ({ exit: window.__T.exit, out: window.__T.out, resumes: window.__T.resumes, late: null }))
  check('continue runs to completion', end.exit === 0 && end.out.trim() === 'done 7 3 3', j(end))
  check('onDebugResume fired once per resume', end.resumes === 5, String(end.resumes))
  const late = await T(() => window.__T.s.debug.variables(1).then(() => 'resolved', () => 'rejected'))
  check('variables() after exit rejects', late === 'rejected')
})

// --- breakpoint in a constructor + stopOnEntry ---------------------------------------
await scenario('stopOnEntry + ctor breakpoint', async () => {
  await T((f) => window.__T.start(f, 'Program.cs', { debug: { breakpoints: [{ path: 'Helper.cs', line: 8 }], stopOnEntry: true } }), MAIN_FILES)
  await waitStops(1)
  let s = await summary()
  check('stopOnEntry: first user line', s.reason === 'entry' && s.stack[0] === 'Program.Main@Program.cs:8', j(s))
  await resume('continue')
  await waitStops(2)
  s = await summary()
  check('breakpoint inside a constructor in Helper.cs', s.reason === 'breakpoint' && s.stack[0] === 'Helper..ctor@Helper.cs:8' && s.locals.name === '"calc"' && s.self.Name === '"calc"', j(s))
  await resume('continue')
  await waitExit()
  check('…then runs to the end', (await T(() => window.__T.exit)) === 0)
})

// --- setBreakpoints while running, pause in an infinite loop, kill while parked -------
const LOOP = [
  'using System;',                // 1
  'class Program {',              // 2
  '  static void Main() {',       // 3
  '    long i = 0;',              // 4
  '    while (true)',             // 5
  '    {',                        // 6
  '      i++;',                   // 7
  '      if (i < 0) break;',      // 8
  '    }',                        // 9
  '  }',                          // 10
  '}',                            // 11
].join('\n')
await scenario('live breakpoints + pause + kill', async () => {
  await T((f) => window.__T.start(f, 'Program.cs', { debug: { breakpoints: [] } }), [{ path: 'Program.cs', content: LOOP }])
  await page.waitForTimeout(1500)
  check('no breakpoints: the loop just runs', (await T(() => window.__T.stops.length)) === 0)
  await T(() => window.__T.s.debug.setBreakpoints([{ path: 'Program.cs', line: 7 }]))
  await waitStops(1, 10000)
  let s = await summary()
  check('setBreakpoints while running takes effect', s.reason === 'breakpoint' && s.stack[0] === 'Program.Main@Program.cs:7' && Number(s.locals.i) > 0, j(s))
  // Clear while parked, continue, then pause.
  await T(() => window.__T.s.debug.setBreakpoints([]))
  await resume('continue')
  await page.waitForTimeout(800)
  check('setBreakpoints([]) while parked clears it', (await T(() => window.__T.stops.length)) === 1)
  await T(() => window.__T.s.debug.pause())
  await waitStops(2, 10000)
  s = await summary()
  check('pause() stops a running infinite loop', s.reason === 'pause' && /Program\.cs:(7|8)$/.test(s.stack[0]), j(s))
  await T(() => window.__T.s.kill())
  await waitExit(5000)
  check('kill while parked -> onExit(null)', (await T(() => window.__T.exit)) === null)
})

// --- top-level statements + Console.ReadLine under the debugger ---------------------
const TOP = [
  'Console.Write("Name: ");',                          // 1
  'string? name = Console.ReadLine();',                // 2
  'var greeting = Greet(name);',                       // 3
  'Console.WriteLine(greeting);',                      // 4
  '',                                                  // 5
  'static string Greet(string? who)',                  // 6
  '{',                                                 // 7
  '    var text = "Hi " + who;',                       // 8
  '    return text;',                                  // 9
  '}',                                                 // 10
].join('\n')
await scenario('top-level + ReadLine', async () => {
  await T((f) => window.__T.start(f, 'Program.cs', { debug: { breakpoints: [{ path: 'Program.cs', line: 3 }, { path: 'Program.cs', line: 9 }] } }), [{ path: 'Program.cs', content: TOP }])
  await page.waitForFunction(() => window.__T.stdinReqs > 0, null, { timeout: 30000 })
  check('ReadLine prompts under the debugger', (await T(() => window.__T.out)) === 'Name: ')
  await T(() => window.__T.s.writeStdin('Ada'))
  await waitStops(1)
  let s = await summary()
  check('top-level program stops at a breakpoint with its locals', s.reason === 'breakpoint' && s.stack[0] === 'Program.Main@Program.cs:3' && s.locals.name === '"Ada"', j(s))
  await resume('continue')
  await waitStops(2)
  s = await summary()
  check('local function frame in a top-level program', s.stack[0] === 'Program.Main.Greet@Program.cs:9' && s.locals.text === '"Hi Ada"' && s.locals.who === '"Ada"' && s.stack.length === 2, j(s))
  await resume('continue')
  await waitExit()
  const end = await T(() => ({ exit: window.__T.exit, out: window.__T.out }))
  check('…and finishes with the input', end.exit === 0 && end.out === 'Name: Hi Ada\n', j(end))
})

// --- uncaught exception ----------------------------------------------------------------
const EXC = [
  'using System;',                                      // 1
  'class Program {',                                    // 2
  '  static int Div(int a, int b) {',                   // 3
  '    return a / b;',                                  // 4
  '  }',                                                // 5
  '  static void Main() {',                             // 6
  '    try { int.Parse("nope"); } catch (FormatException) { Console.WriteLine("caught"); }', // 7
  '    int zero = 0;',                                  // 8
  '    Console.WriteLine(Div(10, zero));',              // 9
  '  }',                                                // 10
  '}',                                                  // 11
].join('\n')
await scenario('exception', async () => {
  await T((f) => window.__T.start(f, 'Program.cs', { debug: { breakpoints: [] } }), [{ path: 'Program.cs', content: EXC }])
  await waitStops(1)
  const s = await summary()
  check('a caught exception does not stop', (await T(() => window.__T.out)) === 'caught\n' && (await T(() => window.__T.stops.length)) === 1)
  check('uncaught exception stops with its description', s.reason === 'exception' && s.description === 'System.DivideByZeroException: Attempted to divide by zero.', j(s))
  check('…at the throwing frame, with the call stack', j(s.stack) === j(['Program.Div@Program.cs:4', 'Program.Main@Program.cs:9']) && s.locals.a === '10' && s.locals.b === '0' && s.outer?.zero === '0', j(s))
  await resume('continue')
  await waitExit()
  const end = await T(() => ({ exit: window.__T.exit, err: window.__T.err }))
  check('…then terminates as a plain run would', end.exit === 1 && end.err.includes('System.DivideByZeroException'), j(end).slice(0, 200))
})

// --- compile errors keep their lines; plain runs are untouched ------------------------
await scenario('compile error', async () => {
  const BAD = ['using System;', 'class Program {', '  static void Main() {', '    int x = 1;', '    Console.WriteLine(y);', '  }', '}'].join('\n')
  await T((f) => window.__T.start(f, 'Program.cs', { debug: { breakpoints: [{ path: 'Program.cs', line: 4 }] } }), [{ path: 'Program.cs', content: BAD }])
  await waitExit()
  const end = await T(() => ({ exit: window.__T.exit, err: window.__T.err, stops: window.__T.stops.length }))
  check('compile error under the debugger: original line numbers', end.exit === 1 && end.stops === 0 && end.err.includes('Program.cs(5,23): error CS0103'), end.err.trim())
})

await scenario('plain run', async () => {
  const r = await T((f) => window.__T.start(f, 'Program.cs'), MAIN_FILES)
  await waitExit()
  const end = await T(() => ({ exit: window.__T.exit, out: window.__T.out, stops: window.__T.stops.length }))
  check('plain run: no debug surface, same output', r.hasDebug === false && end.exit === 0 && end.out.trim() === 'done 7 3 3' && end.stops === 0, j({ r, end }))
})

// --- cost of debugging a hot loop ----------------------------------------------------
const HOT = [
  'using System;',
  'class Program {',
  '  static int Sq(int v) { int s = v * v; return s % 7; }',
  '  static void Main() {',
  '    long sum = 0;',
  '    for (int i = 0; i < 100000; i++)',
  '    {',
  '      sum += Sq(i);',
  '    }',
  '    Console.WriteLine(sum);',
  '  }',
  '}',
].join('\n')
await scenario('perf', async () => {
  const times = {}
  for (const mode of ['plain', 'debug']) {
    await T(([f, m]) => window.__T.start(f, 'Program.cs', m === 'debug' ? { debug: { breakpoints: [] } } : undefined), [[{ path: 'Program.cs', content: HOT }], mode])
    await waitExit(60000)
    times[mode] = await T(() => ({ ms: Math.round(performance.now() - window.__T.t0), out: window.__T.out.trim(), exit: window.__T.exit }))
  }
  check('100k-iteration loop with a call per iteration under the debugger', times.debug.exit === 0 && times.debug.out === times.plain.out && times.debug.ms < 8000, j(times))
})

await ctx.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
