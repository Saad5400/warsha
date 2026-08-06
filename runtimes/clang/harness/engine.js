/* Engine harness — drives the REAL worker (../src/clang.worker.js) over the SAB,
 * exactly as ClangRuntime does, so it validates the worker + the wire protocol end
 * to end. Scenarios:
 *   T1 printf         — compile + run, stdout correct, exit 0
 *   T2 interactive    — two scanf reads, delivered live after each prompt
 *   T3 no-fflush prompt — a printf prompt WITHOUT '\n'/fflush still shows before input
 *   T4 compile error  — clang diagnostics on stderr, exit 1, nothing runs
 *   T5 exit code      — return 42 surfaces as exit 42
 * Results captured to window.__ENG.
 */
const logEl = document.getElementById('log')
const R = { tests: {} }
window.__ENG = R
const lines = []
const log = (m, c) => { lines.push(`<span class="${c || 'dim'}">${(c === 'ok' ? '✓ ' : c === 'bad' ? '✗ ' : c === 'out' ? '· ' : '  ') + m}</span>`); logEl.className = ''; logEl.innerHTML = lines.join('\n'); console.log(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const HEADER_BYTES = 8
const STDIN_CAPACITY = 64 * 1024
const sab = new SharedArrayBuffer(HEADER_BYTES + STDIN_CAPACITY)
const ctrl = new Int32Array(sab, 0, 2)
const data = new Uint8Array(sab, HEADER_BYTES)
const enc = new TextEncoder()
const scratch = new Uint8Array(STDIN_CAPACITY)

let worker
let session = null // { onStdout, onStderr, onStdinRequest, resolveExit }

function spawn() {
  worker = new Worker('/src/clang.worker.js', { type: 'module' })
  worker.onmessage = (ev) => {
    const m = ev.data
    if (m.type === 'progress') { R.lastProgress = m; return }
    if (m.type === 'ready') { R.ready = m; bootResolve && bootResolve(); return }
    if (m.type === 'fatal') { if (m.duringBoot && bootReject) bootReject(new Error(m.text)); else session && session.onStderr('[fatal] ' + m.text) ; session && session.resolveExit && session.resolveExit(1); return }
    if (!session) return
    if (m.type === 'stdout') session.onStdout(m.text)
    else if (m.type === 'stderr') session.onStderr(m.text)
    else if (m.type === 'stdin-request') session.onStdinRequest()
    else if (m.type === 'done') session.resolveExit(m.code)
  }
  worker.onerror = (e) => { if (bootReject) bootReject(new Error(e.message || 'worker error')) }
}

let bootResolve, bootReject
function boot() {
  return new Promise((res, rej) => { bootResolve = res; bootReject = rej; worker.postMessage({ type: 'init', sab }) })
}

function writeStdin(line) {
  const text = line.replace(/\r?\n$/, '') + '\n'
  const { written } = enc.encodeInto(text, scratch)
  data.set(scratch.subarray(0, written), 0)
  Atomics.store(ctrl, 1, written)
  Atomics.store(ctrl, 0, 1)
  Atomics.notify(ctrl, 0)
}
function writeEof() { Atomics.store(ctrl, 1, 0); Atomics.store(ctrl, 0, 2); Atomics.notify(ctrl, 0) }

// Run a program; `feed` is an async fn given ({out}) that can call writeStdin when
// a prompt is seen. Returns { code, out, err }.
function runProgram(files, entry, feed) {
  return new Promise((resolve) => {
    const box = { out: '', err: '' }
    Atomics.store(ctrl, 0, 0)
    session = {
      onStdout: (t) => { box.out += t },
      onStderr: (t) => { box.err += t },
      onStdinRequest: () => { if (feed) feed(box, writeStdin, writeEof) },
      resolveExit: (code) => { session = null; resolve({ code, ...box }) },
    }
    worker.postMessage({ type: 'run', files, entry })
  })
}

const PRINTF = { 'main.c': '#include <stdio.h>\nint main(void){ printf("hello from C %d\\n", 6*7); return 0; }\n' }
const INTERACTIVE = {
  'main.c': `#include <stdio.h>
int main(void){
  char name[64]; int age;
  printf("Name: "); fflush(stdout);
  if (scanf("%63s", name) != 1) return 1;
  printf("Age: "); fflush(stdout);
  if (scanf("%d", &age) != 1) return 1;
  printf("Hello %s, next year you are %d\\n", name, age + 1);
  return 0;
}
`,
}
const NOFLUSH = {
  // No fflush, prompt has no trailing newline: exercises the unbuffered-stdout shim.
  'main.c': `#include <stdio.h>
int main(void){
  int x;
  printf("Enter a number: ");
  if (scanf("%d", &x) != 1) return 1;
  printf("squared = %d\\n", x*x);
  return 0;
}
`,
}
const BADCODE = { 'main.c': '#include <stdio.h>\nint main(void){ printf("%d\\n", undeclared_thing); retrn 0; }\n' }
const EXIT42 = { 'main.c': 'int main(void){ return 42; }\n' }

async function main() {
  try {
    log(`crossOriginIsolated = ${self.crossOriginIsolated}`, self.crossOriginIsolated ? 'ok' : 'bad')
    spawn()
    const t0 = performance.now()
    log('booting engine (download + warm)…')
    await boot()
    log(`ready: ${R.ready.version} in ${(R.ready.bootMs / 1000).toFixed(1)}s`, 'ok')

    // T1 printf
    const t1 = await runProgram(PRINTF, 'main.c')
    R.tests.printf = t1
    log(`T1 printf → code=${t1.code} out=${JSON.stringify(t1.out)}`, t1.code === 0 && t1.out.includes('hello from C 42') ? 'ok' : 'bad')

    // T2 interactive: feed after each prompt, checking the prompt is visible first
    const t2 = await runProgram(INTERACTIVE, 'main.c', async (box, wStdin) => {
      // called on each stdin-request
      if (!box.out.includes('Name:')) log('  T2: Name prompt not shown before request!', 'bad')
      if (box.out.includes('Age:')) wStdin('30'); else wStdin('Warsha')
    })
    R.tests.interactive = t2
    log(`T2 interactive → code=${t2.code} out=${JSON.stringify(t2.out)}`, t2.code === 0 && t2.out.includes('Hello Warsha, next year you are 31') ? 'ok' : 'bad')

    // T3 no-fflush prompt must appear before we feed input
    let sawPromptBeforeInput = false
    const t3 = await runProgram(NOFLUSH, 'main.c', async (box, wStdin) => {
      sawPromptBeforeInput = box.out.includes('Enter a number:')
      wStdin('9')
    })
    R.tests.noflush = { ...t3, sawPromptBeforeInput }
    log(`T3 no-fflush prompt → code=${t3.code} promptShown=${sawPromptBeforeInput} out=${JSON.stringify(t3.out)}`, t3.code === 0 && sawPromptBeforeInput && t3.out.includes('squared = 81') ? 'ok' : 'bad')

    // T4 compile error
    const t4 = await runProgram(BADCODE, 'main.c')
    R.tests.compileError = t4
    log(`T4 compile-error → code=${t4.code} err=${JSON.stringify(t4.err.slice(0, 160))}`, t4.code === 1 && /error/i.test(t4.err) && t4.out === '' ? 'ok' : 'bad')

    // T5 exit code
    const t5 = await runProgram(EXIT42, 'main.c')
    R.tests.exit42 = t5
    log(`T5 exit-code → code=${t5.code}`, t5.code === 42 ? 'ok' : 'bad')

    const pass = t1.code === 0 && t2.out.includes('you are 31') && sawPromptBeforeInput && t4.code === 1 && t5.code === 42
    log(`\n==== engine: printf=${t1.code === 0} · interactive=${t2.out.includes('you are 31')} · noFlushPrompt=${sawPromptBeforeInput} · compileErr=${t4.code === 1} · exit42=${t5.code === 42} → ${pass ? 'ALL PASS' : 'FAIL'} (${((performance.now() - t0) / 1000).toFixed(1)}s)`, pass ? 'ok' : 'bad')
    document.body.setAttribute('data-eng', 'done')
    window.__ENG_DONE = true
  } catch (e) {
    R.fatal = String((e && e.stack) || e)
    log(`FATAL — ${(e && e.message) || e}`, 'bad')
    document.body.setAttribute('data-eng', 'error')
    window.__ENG_DONE = true
  }
}
main()
