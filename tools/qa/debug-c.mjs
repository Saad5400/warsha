/* C debugger, driven headlessly against the REAL clang-wasm engine through the
 * dev-only seam `window.__warshaRuntime` (app/src/runtime/index.ts), so it needs
 * a DEV server, not a production build:
 *
 *   cd app && npm run assets && npx vite --port 8094 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8094/ CHROME=... node debug-c.mjs
 *
 * Covers the contract in app/src/runtime/debug.ts for the source-instrumented C
 * engine (runtimes/clang/src/instrument.js): breakpoint stop + locals of every
 * shape (int, double, char, char*, int[5], struct, pointer), Globals,
 * variables(ref) on an array / struct / pointer, stepInto into another file
 * (util.c via util.h) / stepOver / stepOut with the right call stack,
 * setBreakpoints while parked and while running, pause in an infinite loop,
 * scanf under the debugger, stopOnEntry, a trap reported as an exception stop,
 * kill while parked -> onExit(null), a plain run, and compile errors that still
 * name the student's own line and column. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8094/'
/** ONLY=BE runs just scenarios B and E (iteration aid). */
const run = (id) => !process.env.ONLY || process.env.ONLY.includes(id)
const profile = mkdtempSync(join(tmpdir(), 'warsha-dbg-c-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (n, ok, d = '') => (ok ? pass(n, d) : fail(n, d))

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('crash', () => console.log('      PAGE CRASHED'))
ctx.on('close', () => console.log('      CONTEXT CLOSED'))
page.on('close', () => console.log('      PAGE CLOSED'))
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('      navigated ' + f.url()) })
page.on('pageerror', (e) => console.log('      pageerror: ' + e.message))
page.on('console', (m) => { if (process.env.QA_VERBOSE || (m.type() === 'warning' && /warsha c debugger/.test(m.text()))) console.log('      console.' + m.type() + ': ' + m.text().slice(0, 2000)) })
// Mute Vite's HMR socket: an edit elsewhere in the tree would full-reload the page.
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

const setup = () => page.evaluate(() => {
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
    T.s = await T.rt.run(files, entry, T.io, opts)
    return { hasDebug: !!T.s.debug }
  }
  T.last = () => T.stops[T.stops.length - 1]
  T.locals = (s = T.last(), i = 0) => s.frames[i].scopes.find((x) => x.name === 'Locals').variables
  T.summary = (s = T.last()) => s && {
    reason: s.reason,
    description: s.description,
    stack: s.frames.map((f) => `${f.name}@${f.path}:${f.line}`),
    locals: Object.fromEntries(T.locals(s).map((v) => [v.name, v.value])),
    types: Object.fromEntries(T.locals(s).map((v) => [v.name, v.type])),
    globalsExpensive: s.frames[0].scopes.find((x) => x.name === 'Globals')?.expensive === true,
    globals: Object.fromEntries((s.frames[0].scopes.find((x) => x.name === 'Globals')?.variables ?? []).map((v) => [v.name, v.value])),
  }
  T.ref = (name) => T.locals().find((v) => v.name === name)?.ref
})
await setup()

const t0 = Date.now()
await page.evaluate(async () => {
  window.__T.rt = window.__warshaRuntime.runtimeFor('main.c')
  await window.__T.rt.load(() => {})
})
console.log(`      clang loaded in ${Date.now() - t0} ms`)
check('canDebug(main.c) true, canDebug(util.h) false', await page.evaluate(() => window.__T.rt.canDebug('main.c') && !window.__T.rt.canDebug('util.h')))

const waitStops = (n, timeout = 60000) => page.waitForFunction((k) => window.__T.stops.length >= k, n, { timeout }).catch(async (e) => {
  console.log('      state at timeout: ' + (await page.evaluate(() => JSON.stringify({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err, stops: window.__T.stops.length }))))
  throw e
})
const waitExit = (timeout = 60000) => page.waitForFunction(() => window.__T.exit !== undefined, null, { timeout }).catch(async (e) => {
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
/** A fresh engine per scenario. Known @wasmer/sdk limit, independent of the
 *  debugger: around the 10th clang invocation in one worker a compile hangs or
 *  panics (plain Run included). A suite that compiles ~25 times must not trip on it. */
const fresh = async () => {
  // A whole new page, not just a new worker: a dozen engine respawns in one
  // renderer (each run also maps a 4 GiB-max shared wasm memory) can crash it.
  await page.reload()
  await page.waitForFunction(() => self.crossOriginIsolated && window.__warshaRuntime, null, { timeout: 60000 })
  await setup()
  await page.evaluate(async () => {
    window.__T.rt = window.__warshaRuntime.runtimeFor('main.c')
    await window.__T.rt.load(() => {})
  })
}
const at = (s) => s?.stack?.[0]
const J = (x) => JSON.stringify(x)

// ------------------------------------------------------------- A: stepping
const MAIN = [
  '#include <stdio.h>',                       //  1
  '#include "util.h"',                        //  2
  '',                                         //  3
  'typedef struct { int x; int y; } Point;',  //  4
  '',                                         //  5
  'int counter = 7;',                         //  6
  '',                                         //  7
  'int main(void) {',                         //  8
  '    int n = 42;',                          //  9
  '    double ratio = 3.5;',                  // 10
  "    char letter = 'A';",                   // 11
  '    char *word = "hello";',                // 12
  '    int arr[5] = {1, 2, 3, 4, 5};',        // 13
  '    Point pt = {3, 4};',                   // 14
  '    int *ptr = &n;',                       // 15
  '    int sum = add(n, 8);',                 // 16
  '    printf("sum=%d\\n", sum);',            // 17
  '    counter++;',                           // 18
  '    for (int i = 0; i < 3; i++) {',        // 19
  '        sum += arr[i];',                   // 20
  '    }',                                    // 21
  '    printf("done %d %d\\n", counter, sum);', // 22
  '    return 0;',                            // 23
  '}',                                        // 24
].join('\n')
const UTIL_H = ['#ifndef UTIL_H', '#define UTIL_H', 'int add(int a, int b);', '#endif', ''].join('\n')
const UTIL_C = [
  '#include "util.h"',         // 1
  '',                          // 2
  'int add(int a, int b) {',   // 3
  '    int s = a + b;',        // 4
  '    s = s * 1;',            // 5
  '    return s;',             // 6
  '}',                         // 7
].join('\n')
const filesA = [{ path: 'main.c', content: MAIN }, { path: 'util.h', content: UTIL_H }, { path: 'util.c', content: UTIL_C }]

if (run('A')) try {
  const tA = Date.now()
  const r = await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [{ path: 'main.c', line: 16 }] } }), filesA)
  check('debug run exposes session.debug', r.hasDebug)
  await waitStops(1, 180000)
  console.log(`      first debug stop after ${Date.now() - tA} ms (includes loading the C parser)`)
  let s = await summary()
  check('A1 stops at breakpoint main.c:16', s.reason === 'breakpoint' && J(s.stack) === J(['main@main.c:16']), J(s.stack) + ' err=' + (await page.evaluate(() => window.__T.err)))
  const L = s.locals
  check('A1 int / double / char locals', L.n === '42' && L.ratio === '3.5' && L.letter === "65 'A'", J(L))
  check('A1 char* shows address + string', /^0x[0-9a-f]+ "hello"$/.test(L.word ?? ''), L.word)
  check('A1 int[5] preview + type', L.arr === '[1, 2, 3, 4, 5]' && s.types.arr === 'int[5]', `${L.arr} ${s.types.arr}`)
  check('A1 struct preview + typedef name', L.pt === '{x: 3, y: 4}' && s.types.pt === 'Point', `${L.pt} ${s.types.pt}`)
  check('A1 pointer local', /^0x[0-9a-f]+$/.test(L.ptr ?? '') && s.types.ptr === 'int*', `${L.ptr} ${s.types.ptr}`)
  check('A1 locals declared later are not yet shown', !('sum' in L), J(Object.keys(L)))
  check('A1 Globals scope (expensive) has counter = 7', s.globalsExpensive && s.globals.counter === '7', J(s.globals))

  const kids = await page.evaluate(async () => {
    const T = window.__T
    const f = (vs) => vs.map((v) => `${v.name}=${v.value}`)
    return {
      arr: f(await T.s.debug.variables(T.ref('arr'))),
      pt: f(await T.s.debug.variables(T.ref('pt'))),
      ptr: f(await T.s.debug.variables(T.ref('ptr'))),
      word: f(await T.s.debug.variables(T.ref('word'))),
    }
  })
  check('A2 variables(ref) expands int[5]', J(kids.arr) === J(['[0]=1', '[1]=2', '[2]=3', '[3]=4', '[4]=5']), J(kids.arr))
  check('A2 variables(ref) expands a struct by field', J(kids.pt) === J(['x=3', 'y=4']), J(kids.pt))
  check('A2 variables(ref) expands a pointer to *p', J(kids.ptr) === J(['*ptr=42']), J(kids.ptr))
  check('A2 char* expands to its first char', J(kids.word) === J(["*word=104 'h'"]), J(kids.word))

  s = await step('stepInto')
  check('A3 stepInto lands in util.c:4 with add over main', J(s.stack) === J(['add@util.c:4', 'main@main.c:16']) && s.reason === 'step', J(s.stack))
  check('A3 parameters of add', s.locals.a === '42' && s.locals.b === '8' && !('s' in s.locals), J(s.locals))
  s = await step('stepOver')
  check('A4 stepOver -> util.c:5, s = 50', at(s) === 'add@util.c:5' && s.locals.s === '50', J(s.stack) + J(s.locals))
  s = await step('stepOut')
  check('A5 stepOut -> back in main at the next line (17)', J(s.stack) === J(['main@main.c:17']) && s.locals.sum === '50', J(s.stack) + J(s.locals))
  s = await step('stepOver')
  check('A6 stepOver -> 18, printf output arrived before the stop', at(s) === 'main@main.c:18' && (await page.evaluate(() => window.__T.out)) === 'sum=50\n', J(s.stack))
  s = await step('stepOver')
  check('A7 stepOver -> for header 19', at(s) === 'main@main.c:19' && s.globals.counter === '8', J(s.stack) + J(s.globals))
  s = await step('stepOver')
  check('A8 stepOver -> loop body 20 with loop var i = 0', at(s) === 'main@main.c:20' && s.locals.i === '0', J(s.stack) + J(s.locals))
  s = await step('stepOver')
  check('A9 stepOver -> back to the for header each iteration', at(s) === 'main@main.c:19', J(s.stack))

  await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'main.c', line: 22 }]))
  s = await step('continue')
  check('A10 setBreakpoints while parked -> continue stops at 22', s.reason === 'breakpoint' && at(s) === 'main@main.c:22', J(s.stack))
  check('A10 loop variable gone after the loop; sum = 56', !('i' in s.locals) && s.locals.sum === '56', J(s.locals))

  await resume('continue')
  await waitExit()
  const end = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, resumes: window.__T.resumes, stops: window.__T.stops.length }))
  check('A11 runs to completion with exit 0 and full output', end.exit === 0 && end.out === 'sum=50\ndone 8 56\n', J(end))
  check('A11 one onDebugResume per stop', end.resumes === end.stops, J(end))
  const late = await page.evaluate(async () => { try { await window.__T.s.debug.variables(1); return 'resolved' } catch { return 'rejected' } })
  check('A12 variables() after exit rejects', late === 'rejected')
} catch (e) {
  fail('A scenario threw', String(e))
}

// ---------------------------------- B: pause, setBreakpoints while running, kill
if (run('B')) try {
  await fresh()
  const LOOP = [
    '#include <stdio.h>',        // 1
    'int main(void) {',          // 2
    '    long i = 0; printf("go\\n"); fflush(stdout);', // 3 (marker: the loop is really running)
    '    while (1) {',           // 4
    '        i++;',              // 5
    '        if (i < 0) break;', // 6
    '    }',                     // 7
    '    return 0;',             // 8
    '}',                         // 9
  ].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [] } }), [{ path: 'main.c', content: LOOP }])
  // Wait for the program itself, not a fixed delay: a cold/loaded compile can take
  // longer than any constant, and a pause before main runs (correctly) stops at line 3.
  await page.waitForFunction(() => window.__T.out === 'go\n', null, { timeout: 60000 })
  await page.waitForTimeout(500)
  check('B1 infinite loop runs (no stop, no exit)', await page.evaluate(() => window.__T.stops.length === 0 && window.__T.exit === undefined))
  await page.evaluate(() => window.__T.s.debug.pause())
  await waitStops(1, 10000)
  let s = await summary()
  check('B2 pause stops the loop with reason pause', s.reason === 'pause' && /^main@main\.c:[456]$/.test(at(s)) && Number(s.locals.i) > 0, J(s.stack) + J(s.locals))
  await resume('continue')
  await page.waitForTimeout(400)
  check('B3 resumed: running again', await page.evaluate(() => window.__T.stops.length === 1 && window.__T.exit === undefined))
  await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'main.c', line: 5 }]))
  await waitStops(2, 10000)
  s = await summary()
  check('B4 setBreakpoints while running -> stops at 5', s.reason === 'breakpoint' && at(s) === 'main@main.c:5', J(s.stack))
  await page.evaluate(() => window.__T.s.kill())
  await waitExit(10000)
  check('B5 kill while parked -> onExit(null)', await page.evaluate(() => window.__T.exit === null))
} catch (e) {
  fail('B scenario threw', String(e))
}

// ------------------------------------------- C: scanf while debugging, stopOnEntry
if (run('C')) try {
  await fresh()
  const IO = [
    '#include <stdio.h>',              // 1
    'int main(void) {',                // 2
    '    int x = 0;',                  // 3
    '    printf("Enter: ");',          // 4
    '    scanf("%d", &x);',            // 5
    '    int y = x * 2;',              // 6
    '    printf("y=%d\\n", y);',       // 7
    '    return 0;',                   // 8
    '}',                               // 9
  ].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [{ path: 'main.c', line: 7 }], stopOnEntry: true } }), [{ path: 'main.c', content: IO }])
  await waitStops(1, 60000)
  let s = await summary()
  check('C1 stopOnEntry stops at the first line of main', s.reason === 'entry' && at(s) === 'main@main.c:3', J(s))
  await resume('continue')
  await page.waitForFunction(() => window.__T.stdinReqs > 0, null, { timeout: 20000 })
  check('C2 prompt painted before scanf blocks', await page.evaluate(() => window.__T.out === 'Enter: '), J(await page.evaluate(() => window.__T.out)))
  await page.evaluate(() => window.__T.s.writeStdin('21'))
  await waitStops(2, 20000)
  s = await summary()
  check('C3 breakpoint after scanf sees the input', at(s) === 'main@main.c:7' && s.locals.x === '21' && s.locals.y === '42', J(s.stack) + J(s.locals))
  await resume('continue')
  await waitExit()
  check('C4 exits 0 with output', await page.evaluate(() => window.__T.exit === 0 && window.__T.out === 'Enter: y=42\n'), J(await page.evaluate(() => [window.__T.exit, window.__T.out])))
} catch (e) {
  fail('C scenario threw', String(e))
}

// ------------------------------------------- D: trap -> exception stop
if (run('D')) try {
  await fresh()
  const TRAP = [
    '#include <stdio.h>',                   // 1
    'int divide(int a, int b) {',           // 2
    '    return a / b;',                    // 3
    '}',                                    // 4
    'int main(void) {',                     // 5
    '    int zero = 0;',                    // 6
    '    printf("%d\\n", divide(1, zero));', // 7
    '    return 0;',                        // 8
    '}',                                    // 9
  ].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [] } }), [{ path: 'main.c', content: TRAP }])
  await waitStops(1, 60000)
  const s = await summary()
  check('D1 divide by zero -> exception stop in divide with the call stack', s.reason === 'exception' && J(s.stack) === J(['divide@main.c:3', 'main@main.c:7']) && /divide by zero/.test(s.description ?? ''), J(s))
  await resume('continue')
  await waitExit()
  check('D2 run then ends with an error exit', await page.evaluate(() => window.__T.exit === 1), J(await page.evaluate(() => [window.__T.exit, window.__T.err])))
} catch (e) {
  fail('D scenario threw', String(e))
}

// ------------------------------------------- E: plain run + compile errors
if (run('E')) try {
  await fresh()
  const r = await page.evaluate((f) => window.__T.start(f, 'main.c'), filesA)
  await waitExit()
  const end = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, stops: window.__T.stops.length }))
  check('E1 plain run: no debug surface, normal output, no stops', !r.hasDebug && end.exit === 0 && end.out === 'sum=50\ndone 8 56\n' && end.stops === 0, J(end))

  const BAD = [
    '#include <stdio.h>',                 // 1
    'int main(void) {',                   // 2
    '    int a = 1;',                     // 3
    '    int b = undefined_var + a;',     // 4
    '    return 0;',                      // 5
    '}',                                  // 6
  ].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [{ path: 'main.c', line: 3 }] } }), [{ path: 'main.c', content: BAD }])
  await waitExit()
  const bad = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err, stops: window.__T.stops.length }))
  check('E2 compile error under the debugger: exit 1, no stop', bad.exit === 1 && bad.stops === 0, J(bad))
  check('E2 error names the student line and column (main.c:4:13)', /main\.c:4:13: error/.test(bad.err), bad.err)
  check('E2 diagnostics quote the original source, not the instrumentation', !/__wd_/.test(bad.err), bad.err)

  const UTIL_BAD = UTIL_C.replace('s = s * 1;', 's = s * ;')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [] } }), [{ path: 'main.c', content: MAIN }, { path: 'util.h', content: UTIL_H }, { path: 'util.c', content: UTIL_BAD }])
  await waitExit(120000)
  const bad2 = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err }))
  check('E3 error in util.c reported at util.c:5', bad2.exit === 1 && /util\.c:5:\d+: error/.test(bad2.err), bad2.err)

  const LINK = ['int missing(void);', 'int main(void) {', '    return missing();', '}'].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [] } }), [{ path: 'main.c', content: LINK }])
  await waitExit()
  const bad3 = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err }))
  check('E4 link error under the debugger names the missing function', bad3.exit === 1 && /undefined symbol: missing/.test(bad3.err) && !/__wd_/.test(bad3.err), bad3.err)
} catch (e) {
  fail('E scenario threw', String(e))
}

// ----------------- F: a corpus of awkward C (macros, switch, goto, typedefs, VLAs)
if (run('F')) try {
  await fresh()
  const CORPUS = "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <stdbool.h>\n#include <stdint.h>\n#define N 4\n#define LOOP(i, n) for (int i = 0; i < (n); i++)\n#define SWAP(a, b) do { int t_ = a; a = b; b = t_; } while (0)\n\nenum Color { RED, GREEN = 5, BLUE };\ntypedef enum { A1, B1 } Kind;\ntypedef int (*BinOp)(int, int);\ntypedef char String[16];\nunion Num { int i; float f; };\nstruct Inner { short s; unsigned char uc; };\nstruct Outer { struct Inner in; struct Inner arr[2]; double *dp; union Num num; unsigned flags : 3; long long big; };\ntypedef struct Item Item;\nstruct Item { char name[8]; int qty; Item *next; };\n\nstatic int plus(int a, int b) { return a + b; }\nint sum2d(int m[][3], int rows) {\n    int total = 0;\n    for (int r = 0; r < rows; r++)\n        for (int c = 0; c < 3; c++)\n            total += m[r][c];\n    return total;\n}\nint fact(int n) { if (n <= 1) return 1; else return n * fact(n - 1); }\nvoid fill(int *p, size_t n, const char *tag) {\n    size_t i;\n    for (i = 0; i < n; i++) p[i] = (int)i;\n    if (tag) printf(\"%s\\n\", tag);\n}\n\nint main(int argc, char **argv) {\n    int a = 1, *pa = &a, arr3[3] = {0}; bool ok = true; Kind k = B1; enum Color col = BLUE;\n    String s = \"str\"; BinOp op = plus; const int n = N; int vla[n];\n    char *names[] = {\"x\", \"yy\"};\n    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};\n    struct Outer o; memset(&o, 0, sizeof o);\n    Item *head = malloc(sizeof *head); strcpy(head->name, \"apple\"); head->qty = 3; head->next = NULL;\n    static int calls = 0; calls++;\n    unsigned long long big = 1ULL << 40; float fl = 1.25f; long double ld = 2.0L; uint8_t u8 = 200; int8_t i8 = -3;\n    register int fast = 2;\n    int c;\n    LOOP(i, 3) { a += i; }\n    SWAP(a, fast);\n    fill(vla, n, NULL);\n    if (a) ; else a = 2;\n    for (c = 0; c < 2; c++);\n    while (0) {}\n    do a++; while (a < 3);\n    switch (a) {\n    case 0:\n        a = 1;\n    case 1: { int inner = 2; a += inner; }\n        break;\n    case 2: ;\n        int late = 3; a += late;\n        break;\n    default:\n        if (a > 100)\n            goto done;\n        break;\n    }\n    a = (a > 2) ? a : -a;\n    printf(\"%d %d %d %s %d %d %d %d %llu %f %d %d %d %s\\n\", a, *pa, arr3[0], s, op(1, 2), sum2d(grid, 2), fact(5), calls, big, fl, (int)ld, u8, i8, names[1]);\n    printf(\"%d %d %d %d %d\\n\", ok, k, col, o.in.s, head->qty);\n    {\n        int a = 99; // shadows\n        printf(\"%d\\n\", a);\n    }\ndone:\n    free(head);\n    return argc > 5 ? 1 : 0;\n}\n"
  const files = [{ path: 'main.c', content: CORPUS }]
  await page.evaluate((f) => window.__T.start(f, 'main.c'), files)
  await waitExit()
  const plain = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err }))
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [{ path: 'main.c', line: 67 }] } }), files)
  await waitStops(1)
  const s = await summary()
  check('F1 instrumented build compiles (no fallback note) and stops at 67', at(s) === 'main@main.c:67' && !/could not prepare/.test(await page.evaluate(() => window.__T.err)), J(s.stack))
  const L = s.locals
  check('F2 scalars of every width', L.big === '1099511627776' && L.fl === '1.25' && L.u8 === "200 '\\xc8'" && L.i8 === "-3 '\\xfd'" && L.ok === 'true' && L.n === '4' && L.calls === '1', J(L))
  check('F3 typedef\'d array, array of char*, 2-D array, VLA', L.s === '"str"' && /^\[0x[0-9a-f]+ "x", 0x[0-9a-f]+ "yy"\]$/.test(L.names) && L.grid === '[[1, 2, 3], [4, 5, 6]]' && s.types.grid === 'int[2][3]' && L.vla === '[0, 1, 2, 3]', J(L))
  check('F4 params registered (argc, argv)', L.argc === '1' && /^0x/.test(L.argv) && s.types.argv === 'char**', J(L))
  const deep = await page.evaluate(async () => {
    const T = window.__T
    const f = (vs) => vs.map((v) => `${v.name}=${v.value}`)
    const head = await T.s.debug.variables(T.ref('head'))
    const item = await T.s.debug.variables(head[0].ref)
    const o = await T.s.debug.variables(T.ref('o'))
    const inner = await T.s.debug.variables(o.find((v) => v.name === 'in').ref)
    return { head: f(head), item: f(item), o: f(o), inner: f(inner) }
  })
  check('F5 pointer -> struct via typedef chain (Item* -> struct Item)', /^\*head=\{name: "apple", qty: 3, next: NULL\}$/.test(deep.head[0]) && J(deep.item) === J(['name="apple"', 'qty=3', 'next=NULL']), J(deep))
  check('F6 nested struct/union fields decode (bitfield skipped)', deep.o.map((x) => x.split('=')[0]).join(',') === 'in,arr,dp,num,big' && J(deep.inner) === J(['s=0', "uc=0 '\\0'"]), J(deep))
  await resume('continue')
  await waitExit()
  const dbg = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out }))
  check('F7 debug run output identical to the plain run', dbg.exit === plain.exit && dbg.out === plain.out && plain.exit === 0, J({ plain, dbg }))
} catch (e) {
  fail('F scenario threw', String(e))
}

// ------------------- G: when instrumentation can't compile
if (run('G')) try {
  await fresh()
  // A struct the parser sees but the preprocessor drops: the layout constructor
  // can't compile, so the build is retried without layouts — still debuggable.
  const GHOST = ['#include <stdio.h>', '#ifdef NOT_DEFINED', 'struct Ghost { int g; };', '#endif', 'int main(void) {', '    int v = 5;', '    printf("v=%d\\n", v);', '    return 0;', '}'].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [{ path: 'main.c', line: 7 }] } }), [{ path: 'main.c', content: GHOST }])
  await waitStops(1)
  const s = await summary()
  check('G1 struct under #ifdef: retried without layouts, still stops with locals', at(s) === 'main@main.c:7' && s.locals.v === '5' && !/could not prepare/.test(await page.evaluate(() => window.__T.err)), J(s))
  await resume('continue')
  await waitExit()

  // Deliberate trigger for the last resort: a student identifier colliding with the
  // instrumentation's own (reserved) names. The program must still run, plainly.
  const CLASH = ['#include <stdio.h>', 'int main(void) {', '    int __wd_f = 1;', '    printf("still runs %d\\n", __wd_f);', '    return 0;', '}'].join('\n')
  await page.evaluate((f) => window.__T.start(f, 'main.c', { debug: { breakpoints: [{ path: 'main.c', line: 4 }] } }), [{ path: 'main.c', content: CLASH }])
  await waitExit()
  const g = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err, stops: window.__T.stops.length }))
  check('G2 uncompilable instrumentation -> plain run with a one-line note', g.exit === 0 && g.out === 'still runs 1\n' && g.stops === 0 && /could not prepare this program for debugging/.test(g.err), J(g))
} catch (e) {
  fail('G scenario threw', String(e))
}

const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
await ctx.close()
process.exit(failed ? 1 : 0)
