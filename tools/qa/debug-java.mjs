/* Java debugger, driven headlessly against the REAL CheerpJ engine through the
 * dev-only seam `window.__warshaRuntime` (app/src/runtime/index.ts), so it
 * needs a DEV server, not a production build:
 *
 *   cd app && npm run assets && npx vite --port 8092 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8092/ CHROME=... node debug-java.mjs
 *
 * Covers the contract in app/src/runtime/debug.ts as the Java engine delivers
 * it (source instrumentation, runtimes/java/src/instrument.ts + bootstrap/
 * Dbg.java): breakpoint stop with line + locals, variables(ref) on an int[],
 * an ArrayList and an object, stepInto into Helper.java, stepOver, stepOut, the
 * frame stack, setBreakpoints while parked and while running, pause in an
 * infinite loop, Scanner input under the debugger, an uncaught-exception stop,
 * the `this` scope, stopOnEntry, kill while parked -> onExit(null), a plain run
 * that is unchanged, a compile error that still quotes the student's own line,
 * and the cost of a 100k-iteration loop under the debugger. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8092/'
const profile = mkdtempSync(join(tmpdir(), 'warsha-dbg-java-'))

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
// Mute Vite's HMR socket: an edit elsewhere in the tree would full-reload the
// page mid-scenario and wipe the harness.
await page.routeWebSocket(/./, () => {})

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
  T.scope = (name, s = T.last()) => s.frames[0].scopes.find((x) => x.name === name)
  T.summary = (s = T.last()) => s && {
    reason: s.reason,
    description: s.description,
    stack: s.frames.map((f) => `${f.name}@${f.path}:${f.line}`),
    locals: Object.fromEntries(T.scope('Locals', s).variables.map((v) => [v.name, v.value])),
    self: T.scope('this', s) ? Object.fromEntries(T.scope('this', s).variables.map((v) => [v.name, v.value])) : null,
  }
  T.ref = (name) => T.scope('Locals').variables.find((v) => v.name === name)?.ref
  T.vars = async (name) => (await T.s.debug.variables(T.ref(name))).map((v) => `${v.name}=${v.value}`)
})

const t0 = Date.now()
await page.evaluate(async () => {
  window.__T.rt = window.__warshaRuntime.runtimeFor('Main.java')
  await window.__T.rt.load(() => {})
})
console.log(`      CheerpJ loaded in ${Date.now() - t0} ms`)
check('canDebug(Main.java) true, canDebug(x.txt) false', await page.evaluate(() => window.__T.rt.canDebug('Main.java') && !window.__T.rt.canDebug('x.txt')))

const BIG = 120000
const state = () => page.evaluate(() => JSON.stringify({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err.slice(0, 800), resumes: window.__T.resumes, stops: window.__T.stops.length, stdin: window.__T.stdinReqs }))
const waitStops = (n, timeout = BIG) => page.waitForFunction((k) => window.__T.stops.length >= k, n, { timeout }).catch(async (e) => {
  console.log('      state at timeout: ' + (await state()))
  throw e
})
const waitExit = (timeout = BIG) => page.waitForFunction(() => window.__T.exit !== undefined, null, { timeout }).catch(async (e) => {
  console.log('      state at timeout: ' + (await state()))
  throw e
})
const resume = (cmd) => page.evaluate((c) => window.__T.s.debug.resume(c), cmd)
const summary = () => page.evaluate(() => window.__T.summary())
const step = async (cmd) => {
  const n = await page.evaluate(() => window.__T.stops.length)
  await resume(cmd)
  await waitStops(n + 1, 30000)
  return summary()
}
const at = (s) => s?.stack?.[0]
const J = (x) => JSON.stringify(x)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (files, opts) => page.evaluate(([f, o]) => window.__T.start(f, 'Main.java', o), [files, opts])

// ------------------------------------------------------------- A: stepping
const MAIN = [
  'import java.util.*;',                                                              //  1
  '',                                                                                 //  2
  'public class Main {',                                                              //  3
  '    static class Point { int x; int y; Point(int x, int y) { this.x = x; this.y = y; } }', //  4
  '',                                                                                 //  5
  '    public static void main(String[] args) {',                                    //  6
  '        int[] arr = {1, 2, 3};',                                                   //  7
  '        List<String> names = new ArrayList<>(List.of("ann", "bob", "cy"));',       //  8
  '        Point pt = new Point(3, 4);',                                              //  9
  '        int total = 0;',                                                           // 10
  '        for (int i = 0; i < arr.length; i++) {',                                   // 11
  '            total += Helper.twice(arr[i]);',                                       // 12
  '        }',                                                                        // 13
  '        System.out.println("total " + total);',                                    // 14
  '        int after = total + 1;',                                                   // 15
  '        System.out.println("after " + after);',                                    // 16
  '    }',                                                                            // 17
  '}',                                                                                // 18
].join('\n')
const HELPER = [
  'public class Helper {',                    // 1
  '    public static int twice(int n) {',     // 2
  '        int r = n * 2;',                   // 3
  '        return r;',                        // 4
  '    }',                                    // 5
  '}',                                        // 6
].join('\n')
const filesA = [{ path: 'Main.java', content: MAIN }, { path: 'Helper.java', content: HELPER }]

try {
  const r = await run(filesA, { debug: { breakpoints: [{ path: 'Main.java', line: 12 }] } })
  check('debug run exposes session.debug', r.hasDebug)
  await waitStops(1)
  console.log(`      first debug stop after ${Math.round(await page.evaluate(() => performance.now() - window.__T.t0))} ms`)
  let s = await summary()
  check('A1 stops at breakpoint Main.java:12', s.reason === 'breakpoint' && at(s) === 'Main.main@Main.java:12', J(s.stack))
  check('A1 locals', s.locals.total === '0' && s.locals.i === '0' && s.locals.arr === 'int[3]' && s.locals.names === 'ArrayList size=3' && /^Point \{x=3, y=4\}$/.test(s.locals.pt) && s.locals.args === 'String[0]', J(s.locals))

  const arr = await page.evaluate(() => window.__T.vars('arr'))
  check('A2 variables(int[])', J(arr) === J(['[0]=1', '[1]=2', '[2]=3']), J(arr))
  const names = await page.evaluate(() => window.__T.vars('names'))
  check('A2 variables(ArrayList)', J(names) === J(['[0]="ann"', '[1]="bob"', '[2]="cy"']), J(names))
  const pt = await page.evaluate(() => window.__T.vars('pt'))
  check('A2 variables(object fields)', J(pt) === J(['x=3', 'y=4']), J(pt))

  s = await step('stepInto')
  check('A3 stepInto lands in Helper.twice', at(s) === 'Helper.twice@Helper.java:3' && s.locals.n === '1', J(s))
  check('A3 call stack has both frames', J(s.stack) === J(['Helper.twice@Helper.java:3', 'Main.main@Main.java:12']), J(s.stack))
  check('A3 static frame has no this scope', s.self === null)

  s = await step('stepOver')
  check('A4 stepOver -> Helper.java:4 with r', at(s) === 'Helper.twice@Helper.java:4' && s.locals.r === '2', J(s))

  s = await step('stepOut')
  check('A5 stepOut back in Main.main (next iteration)', at(s) === 'Main.main@Main.java:12' && s.stack.length === 1 && s.locals.total === '2' && s.locals.i === '1', J(s))

  // Replace the set while parked: drop :12, add :15.
  await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'Main.java', line: 15 }]))
  s = await step('continue')
  check('A6 setBreakpoints while parked -> next stop Main.java:15', s.reason === 'breakpoint' && at(s) === 'Main.main@Main.java:15' && s.locals.total === '12', J(s))
  const outSoFar = await page.evaluate(() => window.__T.out)
  check('A6 output before the stop arrived', outSoFar.includes('total 12'), J(outSoFar))

  s = await step('stepOver')
  check('A7 stepOver -> Main.java:16 with after', at(s) === 'Main.main@Main.java:16' && s.locals.after === '13', J(s))
  const rejected = await page.evaluate(async () => {
    window.__T.s.debug.resume('continue')
    try { await window.__T.s.debug.variables(1); return false } catch { return true }
  })
  check('A8 variables() rejects while running', rejected)
  await waitExit()
  const A = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, resumes: window.__T.resumes }))
  check('A9 program finishes with exit 0 and full output', A.exit === 0 && A.out.includes('after 13'), J(A))
} catch (e) { fail('A stepping scenario', e.message) }

// ------------------------------------------------------------- E: stopOnEntry + this scope
const THIS_MAIN = [
  'public class Main {',                                   // 1
  '    int count = 7;',                                    // 2
  '    String label = "box";',                             // 3
  '    int bump(int by) {',                                // 4
  '        count += by;',                                  // 5
  '        return count;',                                 // 6
  '    }',                                                 // 7
  '    public static void main(String[] args) {',          // 8
  '        Main m = new Main();',                          // 9
  '        System.out.println(m.bump(3));',                // 10
  '    }',                                                 // 11
  '}',                                                     // 12
].join('\n')
try {
  await run([{ path: 'Main.java', content: THIS_MAIN }], { debug: { breakpoints: [{ path: 'Main.java', line: 6 }], stopOnEntry: true } })
  await waitStops(1)
  let s = await summary()
  check('E1 stopOnEntry stops at the first line of main', s.reason === 'entry' && at(s) === 'Main.main@Main.java:9', J(s))
  s = await step('continue')
  check('E2 breakpoint in an instance method', s.reason === 'breakpoint' && J(s.stack) === J(['Main.bump@Main.java:6', 'Main.main@Main.java:10']), J(s.stack))
  check('E2 this scope lists fields', s.self && s.self.count === '10' && s.self.label === '"box"', J(s.self))
  check('E2 locals has the parameter', s.locals.by === '3', J(s.locals))
  await resume('continue')
  await waitExit()
  check('E3 exits 0 with output', await page.evaluate(() => window.__T.exit === 0 && window.__T.out.trim() === '10'))
} catch (e) { fail('E entry/this scenario', e.message) }

// ------------------------------------------------------------- B: pause, breakpoints mid-run, kill
const LOOP = [
  'public class Main {',                                    // 1
  '    public static void main(String[] args) {',           // 2
  '        long n = 0;',                                     // 3
  '        while (true) {',                                  // 4
  '            n++;',                                        // 5
  '            if (n % 1000000 == 0) System.out.print("");', // 6
  '        }',                                               // 7
  '    }',                                                   // 8
  '}',                                                       // 9
].join('\n')
try {
  await run([{ path: 'Main.java', content: LOOP }], { debug: { breakpoints: [] } })
  // Wait until it is genuinely spinning (compile done), then pause.
  await page.waitForFunction(() => window.__T.rt.lastRun === null, null, { timeout: 5000 }).catch(() => {})
  await sleep(4000)
  await page.evaluate(() => window.__T.s.debug.pause())
  await waitStops(1, 60000)
  let s = await summary()
  check('B1 pause stops an infinite loop', s.reason === 'pause' && /Main\.main@Main\.java:(5|6)$/.test(at(s)) && Number(s.locals.n) >= 0, J(s))

  await page.evaluate(() => window.__T.s.debug.setBreakpoints([]))
  await resume('continue')
  await sleep(1000)
  const stopsBefore = await page.evaluate(() => window.__T.stops.length)
  check('B2 continues running with no breakpoints', stopsBefore === 1 && (await page.evaluate(() => window.__T.exit)) === undefined)
  await page.evaluate(() => window.__T.s.debug.setBreakpoints([{ path: 'Main.java', line: 5 }]))
  await waitStops(2, 30000)
  s = await summary()
  check('B3 setBreakpoints while running -> stops at Main.java:5', s.reason === 'breakpoint' && at(s) === 'Main.main@Main.java:5', J(s))

  await page.evaluate(() => window.__T.s.kill())
  await waitExit(10000)
  check('B4 kill while parked -> onExit(null)', (await page.evaluate(() => window.__T.exit)) === null)
} catch (e) { fail('B pause/kill scenario', e.message) }

// ------------------------------------------------------------- C: Scanner under the debugger
const SCAN = [
  'import java.util.Scanner;',                              // 1
  'public class Main {',                                    // 2
  '    public static void main(String[] args) {',           // 3
  '        Scanner sc = new Scanner(System.in);',            // 4
  '        System.out.print("Name: ");',                     // 5
  '        String name = sc.nextLine();',                    // 6
  '        System.out.println("Hi " + name);',               // 7
  '    }',                                                   // 8
  '}',                                                       // 9
].join('\n')
try {
  await run([{ path: 'Main.java', content: SCAN }], { debug: { breakpoints: [{ path: 'Main.java', line: 7 }] } })
  await page.waitForFunction(() => window.__T.stdinReqs > 0, null, { timeout: BIG })
  check('C1 prompt printed before the read blocks', (await page.evaluate(() => window.__T.out)) === 'Name: ')
  await page.evaluate(() => window.__T.s.writeStdin('Sara'))
  await waitStops(1)
  const s = await summary()
  check('C2 stop after the read sees the input', at(s) === 'Main.main@Main.java:7' && s.locals.name === '"Sara"', J(s))
  await resume('continue')
  await waitExit()
  check('C3 output + exit 0', await page.evaluate(() => window.__T.exit === 0 && window.__T.out.includes('Hi Sara')))
} catch (e) { fail('C Scanner scenario', e.message) }

// ------------------------------------------------------------- D: uncaught exception
const EXC = [
  'public class Main {',                                    //  1
  '    static int div(int a, int b) {',                     //  2
  '        int q = a / b;',                                  //  3
  '        return q;',                                       //  4
  '    }',                                                   //  5
  '    public static void main(String[] args) {',           //  6
  '        int x = 5;',                                      //  7
  '        System.out.println(div(x, 0));',                  //  8
  '    }',                                                   //  9
  '}',                                                       // 10
].join('\n')
try {
  await run([{ path: 'Main.java', content: EXC }], { debug: { breakpoints: [] } })
  await waitStops(1)
  const s = await summary()
  check('D1 exception stop at the throwing frame', s.reason === 'exception' && J(s.stack) === J(['Main.div@Main.java:3', 'Main.main@Main.java:8']), J(s))
  check('D1 description', /ArithmeticException: \/ by zero/.test(s.description ?? ''), s.description)
  check('D1 locals at the throw', s.locals.a === '5' && s.locals.b === '0', J(s.locals))
  await resume('continue')
  await waitExit()
  const D = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err }))
  check('D2 then terminates as a normal run would', D.exit === 1 && D.err.includes('ArithmeticException'), J(D))
} catch (e) { fail('D exception scenario', e.message) }

// ------------------------------------------------------------- F: plain run unchanged
try {
  const r = await run(filesA, undefined)
  await waitExit()
  const F = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, stops: window.__T.stops.length }))
  check('F1 plain run: no debug surface, no stops, same output', !r.hasDebug && F.exit === 0 && F.stops === 0 && F.out === 'total 12\nafter 13\n', J(F))
} catch (e) { fail('F plain run', e.message) }

// ------------------------------------------------------------- G: compile error under the debugger
const BAD = [
  'public class Main {',                                    // 1
  '    public static void main(String[] args) {',           // 2
  '        int x = 1;',                                      // 3
  '        String s = x;',                                   // 4
  '    }',                                                   // 5
  '}',                                                       // 6
].join('\n')
try {
  await run([{ path: 'Main.java', content: BAD }], { debug: { breakpoints: [{ path: 'Main.java', line: 3 }] } })
  await waitExit()
  const G = await page.evaluate(() => ({ exit: window.__T.exit, err: window.__T.err, stops: window.__T.stops.length }))
  check('G1 compile error: non-zero exit, no stops', G.exit !== 0 && G.exit !== null && G.stops === 0, J(G))
  check('G2 diagnostic names Main.java line 4 and quotes the student line', /Main\.java \(at line 4\)/.test(G.err) && G.err.includes('String s = x;') && !G.err.includes('warsha.Dbg'), G.err)
} catch (e) { fail('G compile error', e.message) }

// ------------------------------------------------------------- H: cost of a 100k loop
const PERF = [
  'public class Main {',
  '    public static void main(String[] args) {',
  '        long s = 0;',
  '        for (int i = 0; i < 100000; i++) {',
  '            s += i % 7;',
  '        }',
  '        System.out.println(s);',
  '    }',
  '}',
].join('\n')
try {
  // Plain first: the compile is paid inside the measured window either way.
  await run([{ path: 'Main.java', content: PERF }], undefined)
  await waitExit()
  const plain = await page.evaluate(() => ({ ms: performance.now() - window.__T.t0, run: window.__T.rt.lastRun, out: window.__T.out }))
  await run([{ path: 'Main.java', content: PERF }], { debug: { breakpoints: [] } })
  await waitExit()
  const dbg = await page.evaluate(() => ({ ms: performance.now() - window.__T.t0, run: window.__T.rt.lastRun, out: window.__T.out, err: window.__T.err }))
  console.log(`      100k loop: plain run ${Math.round(plain.run?.runMs)} ms, debug run ${Math.round(dbg.run?.runMs)} ms (compile ${Math.round(plain.run?.compileMs)} / ${Math.round(dbg.run?.compileMs)} ms)`)
  check('H1 100k-iteration loop under the debugger is usable (< 10 s) and correct', dbg.out === plain.out && dbg.err === '' && dbg.run.runMs < 10000, `${Math.round(dbg.run.runMs)} ms`)
} catch (e) { fail('H perf', e.message) }

// ------------------------------------------------------------- K: the instrumenter vs. the language
// Every construct the rewriter has a rule for (records, enums with bodies,
// interfaces, this(...), switch rules/expressions/groups, labels, brace-less
// bodies, try-with-resources, lambdas, anonymous + local classes, text blocks,
// non-ASCII text): ECJ must accept the rewritten source and it must behave
// exactly like the original.
const CONSTRUCTS = `import java.util.*;
import java.util.function.*;

public class Main {
    static int counter = 0;
    int inst = 5;
    { inst++; }
    static { counter = 1; }

    record Point(int x, int y) {
        Point {
            if (x < 0) throw new IllegalArgumentException("neg");
        }
        int sum() { return x + y; }
    }

    enum Color { RED, GREEN { @Override String hi() { return "g"; } }; String hi() { return "c"; } }

    interface Shape { double area(); default String label() { String s = "shape"; return s; } static int k() { return 1; } }

    static class Box implements Shape {
        private final double w;
        Box(double w) { this.w = w; }
        Box() { this(2.0); int q = 3; q++; }
        public double area() { return w * w; }
    }

    static int sw(int x) {
        int y = switch (x) {
            case 1 -> 5;
            case 2 -> { int t = x * 2; yield t; }
            default -> x;
        };
        switch (x) {
            case 1 -> System.out.println("one");
            case 2 -> { System.out.println("two"); }
            default -> throw new IllegalStateException();
        }
        switch (x) {
            case 1:
                int z = 3;
                y += z;
                break;
            default:
                y--;
        }
        return y;
    }

    public static void main(String[] args) throws Exception {
        int a = 1, b;
        b = 2;
        final int c;
        if (a > 0) c = 1; else c = 2;
        System.out.println(a + b + c);
        for (int i = 0, j; i < 3; i++) a += i;
        for (String s : List.of("x", "y")) System.out.println(s);
        int k = 0;
        while (k < 2) k++;
        do k--; while (k > 0);
        outer:
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                if (j == 1) continue outer;
                if (i == 2) break outer;
            }
        }
        if (a == 1) System.out.println("a"); else if (a == 2) System.out.println("b"); else System.out.println("c");
        try (Scanner sc = new Scanner("hello")) {
            System.out.println(sc.next());
        } catch (Exception e) {
            System.out.println(e);
        } finally {
            k = 9;
        }
        Runnable r = () -> { int inner = 4; System.out.println("lambda " + inner); };
        r.run();
        Function<Integer, Integer> sq = x -> x * x;
        BiFunction<Integer, Integer, Integer> add = (x, y) -> { return x + y; };
        System.out.println(sq.apply(3) + add.apply(1, 2));
        Comparator<String> cmp = new Comparator<String>() {
            @Override public int compare(String p, String q) { int d = p.length() - q.length(); return d; }
        };
        List<String> list = new ArrayList<>(List.of("ccc", "a", "bb"));
        list.sort(cmp);
        System.out.println(list + " " + new Point(1, 2).sum() + " " + new Box().area() + Color.GREEN.hi());
        System.out.println(sw(1) + sw(2));
        Object o = "str";
        if (o instanceof String str && !str.isEmpty()) System.out.println(str.length());
        synchronized (Main.class) { counter++; }
        assert counter > 0;
        class Local { int v = 3; int get() { return v; } }
        System.out.println(new Local().get() + new Main().inst);
        var text = """
            hi
            there""";
        System.out.println(text);
        String uni = "مرحبا😀"; System.out.println(uni); int after = 1;
        ;
    }
}
`
try {
  const files = [{ path: 'Main.java', content: CONSTRUCTS }, { path: 'Helper.java', content: HELPER }]
  await run(files, undefined)
  await waitExit()
  const plain = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err }))
  await run(files, { debug: { breakpoints: [] } })
  await waitExit()
  const dbg = await page.evaluate(() => ({ exit: window.__T.exit, out: window.__T.out, err: window.__T.err }))
  check('K1 construct zoo: debug run compiles and matches the plain run', plain.exit === 0 && J(dbg) === J(plain) && plain.out.includes('[a, bb, ccc] 3 4.0g'), J({ plain, dbg }))
} catch (e) { fail('K construct zoo', e.message) }

await ctx.close()
const failed = results.filter((r) => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
