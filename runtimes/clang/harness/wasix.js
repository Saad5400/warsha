/* Decisive self-hosted-execution spike (user chose interactive stdin).
 * The clang/clang package emits WASIX: imports wasi_snapshot_preview1.* (preview1-
 * compatible), wasix_32v1.{callback_signal,futex_wait,futex_wake,futex_wake_all},
 * and env.memory (shared). Plan: use the SDK ONLY to compile; run the .wasm ourselves
 * under @bjorn3/browser_wasi_shim (v0.4.2 API: fd_read(size)->{ret,data},
 * fd_write(data)->{ret,nwritten}), supplying env.memory ourselves and stubbing the
 * wasix_32v1 funcs (single-threaded student code never contends a futex). Custom
 * stdin Fd is our hook point; on a worker its fd_read blocks on a SAB (Python/C#
 * pattern). This page proves it RUNS + reads stdin with a pre-filled buffer.
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@latest/dist/index.mjs'
import * as shim from 'https://unpkg.com/@bjorn3/browser_wasi_shim@0.4.2/dist/index.js'

const logEl = document.getElementById('log')
const R = {}
window.__WASIX = R
const lines = []
const log = (m, c) => { lines.push(`<span class="${c || 'dim'}">${(c === 'ok' ? '✓ ' : c === 'bad' ? '✗ ' : '  ') + m}</span>`); logEl.className = ''; logEl.innerHTML = lines.join('\n'); console.log(m) }

const CHARDEV = (shim.wasi && shim.wasi.FILETYPE_CHARACTER_DEVICE != null) ? shim.wasi.FILETYPE_CHARACTER_DEVICE : 2

const PRINTF = '#include <stdio.h>\nint main(void){ printf("hello wasix %d\\n", 2+2); return 0; }\n'
const SCANF = `#include <stdio.h>
int main(void){
  char a[64], b[64];
  printf("Your name: "); fflush(stdout);
  if (scanf("%63s", a) != 1) { printf("no-input-1\\n"); return 1; }
  printf("Hi, %s!\\n", a); fflush(stdout);
  printf("Your city: "); fflush(stdout);
  if (scanf("%63s", b) != 1) { printf("no-input-2\\n"); return 2; }
  printf("%s in %s\\n", a, b); fflush(stdout);
  return 0;
}
`

let clang
async function compileC(src) {
  const dir = new Directory()
  await dir.writeFile('p.c', src)
  const comp = await clang.entrypoint.run({ args: ['-Wl,--export-memory', '/project/p.c', '-o', '/project/p.wasm'], mount: { '/project': dir } })
  const cres = await comp.wait()
  const stderr = typeof cres.stderr === 'string' ? cres.stderr : new TextDecoder().decode(cres.stderr || new Uint8Array())
  if (cres.code !== 0) throw new Error('compile failed: ' + stderr.slice(0, 300))
  return await dir.readFile('p.wasm')
}

// Parse the first imported memory's limits from the wasm binary.
function memoryImportLimits(bytes) {
  let o = 8 // magic(4) + version(4)
  const u32 = () => { let r = 0, s = 0, b; do { b = bytes[o++]; r |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return r >>> 0 }
  while (o < bytes.length) {
    const id = bytes[o++]
    const size = u32()
    const end = o + size
    if (id === 2) { // import section
      const count = u32()
      for (let i = 0; i < count; i++) {
        const mlen = u32(); o += mlen
        const nlen = u32(); o += nlen
        const kind = bytes[o++]
        if (kind === 0) { u32() }                       // func
        else if (kind === 1) { o++; const f = bytes[o++]; u32(); if (f & 1) u32() } // table
        else if (kind === 2) { const flags = bytes[o++]; const min = u32(); const max = (flags & 1) ? u32() : undefined; return { min, max, shared: !!(flags & 2) } } // memory
        else if (kind === 3) { o++; o++ }               // global
      }
      return null
    }
    o = end
  }
  return null
}

class CaptureFd extends shim.Fd {
  constructor(onBytes) { super(); this.onBytes = onBytes }
  fd_write(data) { this.onBytes(data); return { ret: 0, nwritten: data.byteLength } }
  fd_fdstat_get() { return { ret: 0, fdstat: new shim.wasi.Fdstat(CHARDEV, 0) } }
}

class BufferStdin extends shim.Fd {
  constructor(bytes) { super(); this.bytes = bytes; this.pos = 0 }
  fd_read(size) {
    const n = Math.min(size, this.bytes.length - this.pos)
    const data = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return { ret: 0, data }
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new shim.wasi.Fdstat(CHARDEV, 0) } }
}

async function runWasm(wasmBytes, stdinBytes) {
  const dec = new TextDecoder()
  let out = ''
  const sink = (bytes) => { out += dec.decode(bytes, { stream: true }) }
  const fds = [new BufferStdin(stdinBytes), new CaptureFd(sink), new CaptureFd(sink)]
  const wasi = new shim.WASI(['prog'], [], fds, { debug: false })

  const mod = await WebAssembly.compile(wasmBytes)
  const imports = WebAssembly.Module.imports(mod)
  const importObj = { wasi_snapshot_preview1: wasi.wasiImport }

  // stub wasix_32v1.*
  const wasixNames = imports.filter((i) => i.module === 'wasix_32v1').map((i) => i.name)
  if (wasixNames.length) {
    const stub = () => 0
    importObj.wasix_32v1 = {}
    for (const n of wasixNames) importObj.wasix_32v1[n] = stub
  }

  // supply env.memory if imported
  const memImp = imports.find((i) => i.module === 'env' && i.name === 'memory')
  let mem = null
  if (memImp) {
    const lim = memoryImportLimits(wasmBytes)
    const desc = { initial: lim.min, maximum: lim.max ?? lim.min }
    if (lim.shared) desc.shared = true
    mem = new WebAssembly.Memory(desc)
    importObj.env = { memory: mem }
    R.memDesc = { ...lim, applied: desc }
  }
  // any other env.* imports → stub as functions (best effort)
  for (const i of imports) {
    if (i.module === 'env' && i.name !== 'memory' && i.kind === 'function') {
      importObj.env = importObj.env || {}
      if (!importObj.env[i.name]) importObj.env[i.name] = () => 0
    }
  }

  const instance = await WebAssembly.instantiate(mod, importObj)
  // If module didn't export memory, hand the shim ours.
  if (!(instance.exports.memory instanceof WebAssembly.Memory) && mem) {
    Object.defineProperty(instance.exports, 'memory', { value: mem, configurable: true })
  }
  let code = 0
  try { wasi.start(instance) } catch (e) {
    if (e instanceof shim.WASIProcExit) code = e.code
    else throw e
  }
  return { code, out }
}

async function main() {
  try {
    log(`crossOriginIsolated = ${self.crossOriginIsolated}`, self.crossOriginIsolated ? 'ok' : 'bad')
    await init()
    clang = await Wasmer.fromRegistry('clang/clang')
    log('clang ready; warming sysroot + compiling printf…')
    const pw = await compileC(PRINTF)
    const impList = WebAssembly.Module.imports(await WebAssembly.compile(pw)).map((i) => i.module + '.' + i.name)
    R.imports = impList
    log(`printf compiled (${pw.length}B). imports: ${impList.join(', ')}`)
    const r1 = await runWasm(pw, new Uint8Array())
    R.printf = r1
    log(`1. printf → code=${r1.code} out=${JSON.stringify(r1.out)}`, r1.out.includes('hello wasix 4') && r1.code === 0 ? 'ok' : 'bad')
    R.mem = R.memDesc

    log('compiling scanf…')
    const sw = await compileC(SCANF)
    const r2 = await runWasm(sw, new TextEncoder().encode('Warsha\nMecca\n'))
    R.scanf = r2
    log(`2. scanf (buffered stdin) → code=${r2.code} out=${JSON.stringify(r2.out)}`, r2.out.includes('Hi, Warsha!') && r2.out.includes('Warsha in Mecca') ? 'ok' : 'bad')

    const ok = r1.code === 0 && r2.out.includes('Warsha in Mecca')
    log(`\n==== self-hosted WASIX: printf=${r1.code === 0} · scanf-stdin=${r2.out.includes('Warsha in Mecca')} ====`, ok ? 'ok' : 'bad')
    document.body.setAttribute('data-wasix', 'done')
    window.__WASIX_DONE = true
  } catch (e) {
    R.fatal = String((e && e.stack) || e)
    log(`FATAL — ${(e && e.message) || e}`, 'bad')
    document.body.setAttribute('data-wasix', 'error')
    window.__WASIX_DONE = true
  }
}
main()
