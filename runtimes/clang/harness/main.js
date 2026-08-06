/* clang-wasm M0 spike driver — latency profiler.
 *
 * The naive spike proved C compiles+runs but a cold C++ <iostream> compile ran
 * >6 min. This version isolates WHERE the C++ cost is, with a per-step timeout so
 * one slow step can't hang the report:
 *   0. warm C compile           -> the real per-compile cost (no JIT warmup)
 *   1. C++ trivial (no headers) -> C++ *mode* overhead alone
 *   2. C++ <vector>+<string>    -> STL headers minus iostream
 *   3. C++ <iostream>           -> the full cost students hit
 *   4. interactive stdin (C)    -> scanf drivable?
 * Reports timings + which headers are the tax. Loads @wasmer/sdk from unpkg
 * (server sends COEP: credentialless so the cross-origin load works, isolated).
 */
import {
  init,
  Wasmer,
  Directory,
} from 'https://unpkg.com/@wasmer/sdk@latest/dist/index.mjs'

const logEl = document.getElementById('log')
const results = { isolated: null, commands: null, steps: {} }
window.__SPIKE = results

const lines = []
function log(msg, cls) {
  const tag = cls === 'ok' ? '✓ ' : cls === 'bad' ? '✗ ' : cls === 'warn' ? '! ' : '  '
  lines.push({ msg: tag + msg, cls: cls || 'dim' })
  logEl.className = ''
  logEl.innerHTML = lines
    .map((l) => `<span class="${l.cls}">${l.msg.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`)
    .join('\n')
  console.log(msg)
}

const t = () => performance.now()
const TIMEOUT_MS = 90_000
let clang = null

function withTimeout(promise, label) {
  let to
  const timer = new Promise((_, rej) => (to = setTimeout(() => rej(new Error(`TIMEOUT >${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)))
  return Promise.race([promise, timer]).finally(() => clearTimeout(to))
}

async function collect(instance) {
  const output = await instance.wait()
  const dec = (x) => (typeof x === 'string' ? x : new TextDecoder().decode(x || new Uint8Array()))
  return { code: output.code, stdout: dec(output.stdout), stderr: dec(output.stderr) }
}

/** Compile only (no run). Returns { ok, ms, code, stderr }. */
async function compileOnly(key, { name, source, args }) {
  const dir = new Directory()
  await dir.writeFile(name, source)
  const c0 = t()
  try {
    const inst = await withTimeout(clang.entrypoint.run({ args, mount: { '/project': dir } }), key)
    const res = await withTimeout(collect(inst), key + ':wait')
    const ms = Math.round(t() - c0)
    return { ok: res.code === 0, ms, code: res.code, stderr: res.stderr.slice(0, 400), dir }
  } catch (e) {
    return { ok: false, ms: Math.round(t() - c0), error: String(e && e.message || e) }
  }
}

async function main() {
  try {
    results.isolated = self.crossOriginIsolated === true
    log(`crossOriginIsolated = ${results.isolated}`, results.isolated ? 'ok' : 'bad')

    const i0 = t()
    await init()
    log(`SDK init ok (${Math.round(t() - i0)}ms)`, 'ok')

    log('fetching clang/clang…')
    const d0 = t()
    clang = await Wasmer.fromRegistry('clang/clang')
    log(`clang package ready (${Math.round(t() - d0)}ms)`, 'ok')
    results.commands = Object.keys(clang.commands || {})

    // Warm-up compile (pays the one-time clang JIT) — not measured.
    log('warm-up clang…')
    await compileOnly('warmup', { name: 'w.c', source: 'int main(void){return 0;}\n', args: ['/project/w.c', '-o', '/project/w.wasm'] })

    // 0. warm C
    const c = await compileOnly('c', { name: 'a.c', source: '#include <stdio.h>\nint main(void){printf("hi");return 0;}\n', args: ['/project/a.c', '-o', '/project/a.wasm'] })
    results.steps.cWarm = c
    log(`0. warm C compile: ${c.ok ? c.ms + 'ms' : 'FAIL ' + (c.error || c.stderr)}`, c.ok ? 'ok' : 'bad')

    // 1. C++ trivial (no headers)
    const cpp0 = await compileOnly('cpp0', { name: 'b.cpp', source: 'int main(){return 0;}\n', args: ['-std=c++17', '/project/b.cpp', '-o', '/project/b.wasm'] })
    results.steps.cppTrivial = cpp0
    log(`1. C++ no-headers: ${cpp0.ok ? cpp0.ms + 'ms' : 'FAIL ' + (cpp0.error || cpp0.stderr)}`, cpp0.ok ? 'ok' : 'bad')

    // 2. C++ <vector> + <string> (STL minus iostream)
    const cpp1 = await compileOnly('cpp1', { name: 'c.cpp', source: '#include <vector>\n#include <string>\nint main(){std::vector<std::string> v{"a","b"};return (int)v.size()-2;}\n', args: ['-std=c++17', '/project/c.cpp', '-o', '/project/c.wasm'] })
    results.steps.cppStl = cpp1
    log(`2. C++ <vector>+<string>: ${cpp1.ok ? cpp1.ms + 'ms' : 'FAIL ' + (cpp1.error || cpp1.stderr)}`, cpp1.ok ? 'ok' : 'bad')

    // 3. C++ <iostream> (the full student cost)
    const cpp2 = await compileOnly('cpp2', { name: 'd.cpp', source: '#include <iostream>\nint main(){std::cout<<"hello from C++"<<std::endl;return 0;}\n', args: ['-std=c++17', '/project/d.cpp', '-o', '/project/d.wasm'] })
    results.steps.cppIostream = cpp2
    if (cpp2.ok) {
      log(`3. C++ <iostream> compile: ${cpp2.ms}ms — now running…`, 'ok')
      try {
        const wasm = await cpp2.dir.readFile('d.wasm')
        const prog = await Wasmer.fromFile(wasm)
        const run = await withTimeout(prog.entrypoint.run(), 'cpp-run')
        const rres = await collect(run)
        results.steps.cppRun = { ok: rres.code === 0, stdout: rres.stdout }
        log(`   C++ run → ${JSON.stringify(rres.stdout)} (code ${rres.code})`, rres.code === 0 ? 'ok' : 'bad')
      } catch (e) {
        log(`   C++ run error — ${e}`, 'bad')
      }
    } else {
      log(`3. C++ <iostream>: ${cpp2.error ? cpp2.error : 'FAIL ' + cpp2.stderr}`, cpp2.error ? 'warn' : 'bad')
    }

    // 4. interactive stdin (C scanf)
    try {
      const dir = new Directory()
      await dir.writeFile('ask.c', '#include <stdio.h>\nint main(void){char n[64];printf("Your name: ");if(scanf("%63s",n)==1)printf("Hello, %s!\\n",n);return 0;}\n')
      const comp = await compileOnly('stdinc', { name: 'ask.c', source: '#include <stdio.h>\nint main(void){char n[64];printf("Your name: ");if(scanf("%63s",n)==1)printf("Hello, %s!\\n",n);return 0;}\n', args: ['/project/ask.c', '-o', '/project/ask.wasm'] })
      if (comp.ok) {
        const wasm = await comp.dir.readFile('ask.wasm')
        const prog = await Wasmer.fromFile(wasm)
        const inst = await prog.entrypoint.run()
        const w = inst.stdin?.getWriter?.()
        if (w) { await w.write(new TextEncoder().encode('Warsha\n')); await w.close() }
        const rres = await collect(inst)
        results.steps.stdin = { ok: /Hello, Warsha!/.test(rres.stdout), hadWriter: !!w, stdout: rres.stdout, code: rres.code }
        log(`4. stdin scanf: writer=${!!w} → ${JSON.stringify(rres.stdout)}`, results.steps.stdin.ok ? 'ok' : 'warn')
      } else {
        log(`4. stdin compile failed`, 'bad')
      }
    } catch (e) {
      results.steps.stdin = { ok: false, error: String(e) }
      log(`4. stdin error — ${e}`, 'warn')
    }

    log(`\n==== profile done — C warm=${results.steps.cWarm?.ms}ms · C++trivial=${results.steps.cppTrivial?.ms}ms · C++stl=${results.steps.cppStl?.ms}ms · C++iostream=${results.steps.cppIostream?.ms || results.steps.cppIostream?.error} ====`, 'ok')
    document.body.setAttribute('data-spike', 'done')
    window.__SPIKE_DONE = true
  } catch (e) {
    log(`FATAL — ${(e && e.stack) || e}`, 'bad')
    document.body.setAttribute('data-spike', 'error')
    window.__SPIKE_DONE = true
    results.fatal = String((e && e.stack) || e)
  }
}

main()
