/* Decisive C++ test — NO timeout. Answers the two binary questions the profiler
 * couldn't (its 90s timeout aborted each libc++ compile mid-flight):
 *   1. Does <iostream> ever COMPILE + RUN successfully? (is libc++ in the package?)
 *   2. After a one-time cold libc++ load, is a SECOND <iostream> compile fast?
 * Let it run to completion however long the cold compile takes.
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@latest/dist/index.mjs'

const logEl = document.getElementById('log')
const R = { steps: {} }
window.__CPP = R
const lines = []
function log(msg, cls) {
  lines.push(`<span class="${cls || 'dim'}">${(cls === 'ok' ? '✓ ' : cls === 'bad' ? '✗ ' : '  ') + msg}</span>`)
  logEl.className = ''
  logEl.innerHTML = lines.join('\n')
  console.log(msg)
}
const t = () => performance.now()
const IOSTREAM = '#include <iostream>\nint main(){ std::cout << "hello from C++ " << (2+2) << std::endl; return 0; }\n'

async function collect(inst) {
  const o = await inst.wait()
  const dec = (x) => (typeof x === 'string' ? x : new TextDecoder().decode(x || new Uint8Array()))
  return { code: o.code, stdout: dec(o.stdout), stderr: dec(o.stderr) }
}
async function compile(clang, name, source, args) {
  const dir = new Directory()
  await dir.writeFile(name, source)
  const c0 = t()
  const inst = await clang.entrypoint.run({ args, mount: { '/project': dir } })
  const res = await collect(inst)
  return { ms: Math.round(t() - c0), ...res, dir }
}

async function main() {
  try {
    log(`crossOriginIsolated = ${self.crossOriginIsolated}`, self.crossOriginIsolated ? 'ok' : 'bad')
    await init()
    const clang = await Wasmer.fromRegistry('clang/clang')
    log('clang ready; warming C sysroot…')
    await compile(clang, 'w.c', 'int main(void){return 0;}\n', ['/project/w.c', '-o', '/project/w.wasm'])
    log('warm done. Cold <iostream> compile (may take minutes, no timeout)…', 'dim')

    const a = t()
    const c1 = await compile(clang, 'a.cpp', IOSTREAM, ['-std=c++17', '/project/a.cpp', '-o', '/project/a.wasm'])
    R.steps.cold = { ms: c1.ms, code: c1.code, stderr: c1.stderr.slice(0, 500) }
    log(`COLD <iostream> compile: ${c1.ms}ms, code ${c1.code}`, c1.code === 0 ? 'ok' : 'bad')
    if (c1.code !== 0) { log(`stderr: ${c1.stderr.slice(0, 500)}`, 'bad'); throw new Error('iostream compile failed') }

    // Run it.
    const wasm = await c1.dir.readFile('a.wasm')
    const prog = await Wasmer.fromFile(wasm)
    const run = await collect(await prog.entrypoint.run())
    R.steps.run = { code: run.code, stdout: run.stdout }
    log(`C++ RUN → ${JSON.stringify(run.stdout)} (code ${run.code})`, run.code === 0 ? 'ok' : 'bad')

    // Second, WARM <iostream> compile — the number that decides student UX.
    log(`elapsed since cold start: ${Math.round((t() - a) / 1000)}s. Warm <iostream> compile…`, 'dim')
    const c2 = await compile(clang, 'b.cpp', IOSTREAM.replace('2+2', '3+4'), ['-std=c++17', '/project/b.cpp', '-o', '/project/b.wasm'])
    R.steps.warm = { ms: c2.ms, code: c2.code }
    log(`WARM <iostream> compile: ${c2.ms}ms, code ${c2.code}`, c2.code === 0 ? 'ok' : 'bad')

    log(`\n==== C++ VERDICT: works=${R.steps.run?.code === 0} · cold=${R.steps.cold?.ms}ms · warm=${R.steps.warm?.ms}ms ====`, R.steps.run?.code === 0 ? 'ok' : 'bad')
    document.body.setAttribute('data-cpp', 'done')
    window.__CPP_DONE = true
  } catch (e) {
    R.fatal = String((e && e.stack) || e)
    log(`FATAL — ${(e && e.message) || e}`, 'bad')
    document.body.setAttribute('data-cpp', 'error')
    window.__CPP_DONE = true
  }
}
main()
