// M1 harness driver — owns the SharedArrayBuffer, spawns the engine worker, and
// stands in for the app: it answers each stdin-request by writing a canned line
// into the SAB and notifying, exactly as CSharpRuntime.writeStdin() will. Proves
// boot, streaming stdout, compile diagnostics, and BLOCKING Console.ReadLine().

const out = document.getElementById('out')
const log = (m) => { out.textContent += m; console.log(m.replace(/\n$/, '')) }
const banner = (m) => log(`\n\x1b?=== ${m} ===\n`.replace('\x1b?', ''))

const STDIN_CAPACITY = 64 * 1024
const HEADER_BYTES = 8
const sab = new SharedArrayBuffer(HEADER_BYTES + STDIN_CAPACITY)
const ctrl = new Int32Array(sab, 0, 2)
const data = new Uint8Array(sab, HEADER_BYTES)
const enc = new TextEncoder()

// A scripted set of answers, consumed in order as the program asks for input.
let answers = []
function writeStdin(line) {
  const bytes = enc.encode(line)
  data.set(bytes.subarray(0, STDIN_CAPACITY), 0)
  Atomics.store(ctrl, 1, Math.min(bytes.length, STDIN_CAPACITY))
  Atomics.store(ctrl, 0, 1) // STATE_LINE
  Atomics.notify(ctrl, 0)
}
function writeEof() {
  Atomics.store(ctrl, 1, 0)
  Atomics.store(ctrl, 0, 2) // STATE_EOF
  Atomics.notify(ctrl, 0)
}

const worker = new Worker('./dotnet.worker.js', { type: 'module' })
let ready = null
const readyPromise = new Promise((r) => (ready = r))

worker.onmessage = (ev) => {
  const m = ev.data
  switch (m.type) {
    case 'progress': break // spike: don't spam the log with byte counts
    case 'ready': log(`[worker] ready — ${m.version}, boot ${m.bootMs} ms, ${m.refs} refs\n`); ready(); break
    case 'stdout': log(m.text); break
    case 'stderr': log('[err] ' + m.text); break
    case 'stdin-request':
      // Reply after a tick, the way a user typing would — proves the worker is
      // genuinely parked in Atomics.wait and resumes on notify.
      setTimeout(() => {
        if (answers.length) { const a = answers.shift(); log(`\x1b?<< ${a}\n`.replace('\x1b?', '')); writeStdin(a) }
        else writeEof()
      }, 30)
      break
    case 'done': log(`[worker] done — exit ${m.code}, ${m.ms} ms\n`); pending && pending(m); break
    case 'fatal': log(`[FATAL] ${m.text}\n`); pending && pending(m); break
  }
}

let pending = null
function run(files, entry, inputs) {
  answers = inputs.slice()
  return new Promise((resolve) => {
    pending = (m) => { pending = null; resolve(m) }
    worker.postMessage({ type: 'run', files, entry })
  })
}

worker.postMessage({ type: 'init', sab })
await readyPromise

// 1. prompt-then-read on one line (the core interactive contract)
banner('interactive: name')
await run(
  { 'Program.cs': `using System;
class P { static void Main() {
  Console.Write("Your name: ");
  var name = Console.ReadLine();
  Console.WriteLine($"Hello, {name}!");
} }` },
  'Program.cs',
  ['Warsha'],
)

// 2. two int reads + arithmetic (buffered Read path via int.Parse)
banner('interactive: sum of two ints')
await run(
  { 'Program.cs': `using System;
class P { static void Main() {
  Console.Write("a? "); int a = int.Parse(Console.ReadLine());
  Console.Write("b? "); int b = int.Parse(Console.ReadLine());
  Console.WriteLine($"a + b = {a + b}");
} }` },
  'Program.cs',
  ['17', '25'],
)

// 3. multi-file project (proves cross-file compile into one assembly)
banner('multi-file project')
await run(
  {
    'Program.cs': `using System;
class P { static void Main() {
  Console.WriteLine(Greeter.Greet("Warsha"));
} }`,
    'Greeter.cs': `static class Greeter { public static string Greet(string who) => $"Hi, {who}, from another file."; }`,
  },
  'Program.cs',
  [],
)

// 4. loop reading lines until EOF (proves EOF handling)
banner('read until EOF')
await run(
  { 'Program.cs': `using System;
class P { static void Main() {
  string line; int n = 0;
  while ((line = Console.ReadLine()) != null) { n++; Console.WriteLine($"got: {line}"); }
  Console.WriteLine($"total lines: {n}");
} }` },
  'Program.cs',
  ['one', 'two', 'three'],
)

// 5. compile error (diagnostics streamed to stderr, exit 1, nothing runs)
banner('compile error')
await run(
  { 'Program.cs': `class P { static void Main() { int x = ; } }` },
  'Program.cs',
  [],
)

log('\n[js] M1 harness complete\n')
window.__WARSHA_M1_DONE__ = true
