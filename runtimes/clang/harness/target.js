/* Decisive: can the clang/clang package emit PLAIN wasm32-wasi (preview1, exported
 * memory, no wasix futex/signal imports)? If yes → we can self-host execution with
 * a WASI shim + SAB blocking stdin (full interactive input, like Python/C#). If every
 * target still emits wasix_32v1.* / imported env.memory → execution is bound to the
 * Wasmer SDK runtime, and stdin must be BATCH (run({stdin})), since the SDK's live
 * stdin doesn't deliver to a blocked scanf.
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@latest/dist/index.mjs'

const logEl = document.getElementById('log')
const R = {}
window.__TARGET = R
const lines = []
const log = (m, c) => { lines.push(`<span class="${c || 'dim'}">${(c === 'ok' ? '✓ ' : c === 'bad' ? '✗ ' : '  ') + m}</span>`); logEl.className = ''; logEl.innerHTML = lines.join('\n'); console.log(m) }

const SRC = '#include <stdio.h>\nint main(void){ printf("hi %d\\n", 2+2); return 0; }\n'

let clang
async function tryFlags(label, extraArgs) {
  try {
    const dir = new Directory()
    await dir.writeFile('p.c', SRC)
    const args = [...extraArgs, '/project/p.c', '-o', '/project/p.wasm']
    const comp = await clang.entrypoint.run({ args, mount: { '/project': dir } })
    const cres = await comp.wait()
    const stderr = typeof cres.stderr === 'string' ? cres.stderr : new TextDecoder().decode(cres.stderr || new Uint8Array())
    if (cres.code !== 0) { R[label] = { code: cres.code, err: stderr.slice(0, 200) }; log(`${label}: compile FAILED code=${cres.code} — ${stderr.slice(0, 160)}`, 'bad'); return }
    const bytes = await dir.readFile('p.wasm')
    const mod = await WebAssembly.compile(bytes)
    const imports = WebAssembly.Module.imports(mod).map((i) => i.module + '.' + i.name)
    const exports = WebAssembly.Module.exports(mod).map((e) => e.name)
    const modules = [...new Set(imports.map((i) => i.split('.')[0]))]
    const wasix = imports.some((i) => i.startsWith('wasix'))
    const memImported = imports.some((i) => i === 'env.memory')
    const memExported = exports.includes('memory')
    const plain = !wasix && !memImported && memExported && modules.every((m) => m === 'wasi_snapshot_preview1')
    R[label] = { code: 0, bytes: bytes.length, modules, wasix, memImported, memExported, plain }
    log(`${label}: modules=[${modules.join(',')}] wasix=${wasix} memImported=${memImported} memExported=${memExported} → PLAIN-WASI=${plain}`, plain ? 'ok' : 'bad')
  } catch (e) {
    R[label] = { fatal: String(e && e.message || e) }
    log(`${label}: ERROR ${e && e.message || e}`, 'bad')
  }
}

async function main() {
  try {
    await init()
    clang = await Wasmer.fromRegistry('clang/clang')
    log('clang ready; warming sysroot + probing targets…')
    await tryFlags('default', [])
    await tryFlags('target=wasm32-wasi', ['--target=wasm32-wasi'])
    await tryFlags('target=wasm32-wasip1', ['--target=wasm32-wasip1'])
    await tryFlags('target=wasm32-unknown-wasi', ['--target=wasm32-unknown-wasi'])
    await tryFlags('wasi+export-memory', ['--target=wasm32-wasi', '-Wl,--export-memory,--no-import-memory'])
    await tryFlags('exec-model=command', ['-mexec-model=command'])
    await tryFlags('export-memory-only', ['-Wl,--export-memory'])
    const anyPlain = Object.entries(R).filter(([k, v]) => v && v.plain).map(([k]) => k)
    log(`\n==== plain-WASI targets: ${anyPlain.length ? anyPlain.join(', ') : 'NONE — execution is Wasmer-SDK/WASIX-bound → batch stdin'} ====`, anyPlain.length ? 'ok' : 'bad')
    document.body.setAttribute('data-target', 'done')
    window.__TARGET_DONE = true
  } catch (e) {
    R.fatal = String((e && e.stack) || e)
    log(`FATAL — ${(e && e.message) || e}`, 'bad')
    document.body.setAttribute('data-target', 'error')
    window.__TARGET_DONE = true
  }
}
main()
