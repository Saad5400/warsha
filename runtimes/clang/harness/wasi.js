/* Self-hosted WASI execution spike. Decision: @wasmer/sdk's live stdin does NOT
 * deliver to a blocked scanf (only batch run({stdin}) works), so we can't get the
 * interactive prompt/read contract through the SDK's runner. This tests the
 * architecturally-consistent alternative: use the SDK ONLY to compile (clang →
 * .wasm bytes), then EXECUTE the WASI module ourselves with @bjorn3/browser_wasi_shim
 * — which lets us supply a custom stdin Fd. On a worker that Fd's fd_read can block
 * on a SAB (Atomics.wait), exactly like the Python/C# engines. This page proves the
 * shim runs clang's output and reads stdin; the SAB-blocking part is the proven
 * Python/C# pattern and is exercised in the engine, not here.
 *
 * Questions:
 *   1. Does the shim instantiate + run clang's WASI output at all? (printf baseline)
 *   2. Does a pre-filled stdin File feed scanf correctly? (stdin plumbing)
 *   3. Does a CUSTOM stdin Fd (our own fd_read) also feed scanf? (the engine's hook)
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@latest/dist/index.mjs'
import * as shim from 'https://unpkg.com/@bjorn3/browser_wasi_shim@latest/dist/index.js'

const logEl = document.getElementById('log')
const R = {}
window.__WASI = R
const lines = []
const log = (m, c) => { lines.push(`<span class="${c || 'dim'}">${(c === 'ok' ? '✓ ' : c === 'bad' ? '✗ ' : '  ') + m}</span>`); logEl.className = ''; logEl.innerHTML = lines.join('\n'); console.log(m) }

const PRINTF = `#include <stdio.h>
int main(void){ printf("hello from wasi-shim %d\\n", 2+2); return 0; }
`
const SCANF = `#include <stdio.h>
int main(void){
  char a[64], b[64];
  printf("Your name: "); fflush(stdout);
  if (scanf("%63s", a) != 1) { printf("no-input-1\\n"); return 1; }
  printf("Hello, %s!\\n", a); fflush(stdout);
  printf("Your city: "); fflush(stdout);
  if (scanf("%63s", b) != 1) { printf("no-input-2\\n"); return 2; }
  printf("%s from %s\\n", a, b); fflush(stdout);
  return 0;
}
`

let clang
async function compileC(src) {
  const dir = new Directory()
  await dir.writeFile('p.c', src)
  const comp = await clang.entrypoint.run({ args: ['/project/p.c', '-o', '/project/p.wasm'], mount: { '/project': dir } })
  const cres = await comp.wait()
  if (cres.code !== 0) throw new Error('compile failed: ' + (typeof cres.stderr === 'string' ? cres.stderr : new TextDecoder().decode(cres.stderr)))
  return await dir.readFile('p.wasm')
}

// A capturing stdout/stderr Fd built on the shim's Fd base class.
class CaptureFd extends shim.Fd {
  constructor(onBytes) { super(); this.onBytes = onBytes }
  fd_write(view8, iovs) {
    let nwritten = 0
    for (const iov of iovs) {
      this.onBytes(view8.slice(iov.buf, iov.buf + iov.buf_len))
      nwritten += iov.buf_len
    }
    return { ret: 0, nwritten }
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new shim.Fdstat(2 /* CHARACTER_DEVICE */, 0) } }
}

// A custom stdin Fd that serves bytes from a fixed buffer (non-blocking here; in the
// engine this is where fd_read does Atomics.wait on the SAB for the next line).
class BufferStdin extends shim.Fd {
  constructor(bytes) { super(); this.bytes = bytes; this.pos = 0 }
  fd_read(view8, iovs) {
    let nread = 0
    for (const iov of iovs) {
      const remaining = this.bytes.length - this.pos
      if (remaining <= 0) break
      const n = Math.min(iov.buf_len, remaining)
      view8.set(this.bytes.subarray(this.pos, this.pos + n), iov.buf)
      this.pos += n
      nread += n
    }
    return { ret: 0, nread }
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new shim.Fdstat(2, 0) } }
}

function runWasm(wasmBytes, stdinFd) {
  const dec = new TextDecoder()
  let out = ''
  const sink = (bytes) => { out += dec.decode(bytes, { stream: true }) }
  const fds = [
    stdinFd,
    new CaptureFd(sink),  // stdout (fd 1)
    new CaptureFd(sink),  // stderr (fd 2)
  ]
  const wasi = new shim.WASI(['prog'], [], fds, { debug: false })
  let code = 0
  return WebAssembly.compile(wasmBytes)
    .then((mod) => {
      window.__IMPORTS = WebAssembly.Module.imports(mod)
      log(`imports: ${JSON.stringify(window.__IMPORTS.map((i) => i.module + '.' + i.name + ':' + i.kind))}`)
      return WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport })
    })
    .then((instance) => {
      try { code = wasi.start(instance) ?? 0 } catch (e) {
        // proc_exit throws a special value in some shim versions
        if (e && typeof e.code === 'number') code = e.code
        else if (typeof e === 'number') code = e
        else throw e
      }
      return { code, out }
    })
}

async function main() {
  try {
    log(`crossOriginIsolated = ${self.crossOriginIsolated}`, self.crossOriginIsolated ? 'ok' : 'bad')
    log(`shim exports: ${Object.keys(shim).sort().join(', ')}`)
    await init()
    clang = await Wasmer.fromRegistry('clang/clang')
    log('clang ready; warming C sysroot + compiling printf…')
    const pw = await compileC(PRINTF)
    log(`printf compiled (${pw.length} bytes); running via shim…`)
    const r1 = await runWasm(pw, new BufferStdin(new Uint8Array()))
    R.printf = r1
    log(`1. printf → code=${r1.code} out=${JSON.stringify(r1.out)}`, r1.out.includes('hello from wasi-shim 4') && r1.code === 0 ? 'ok' : 'bad')

    log('compiling scanf…')
    const sw = await compileC(SCANF)

    // 2. pre-filled File stdin (the shim's own OpenFile)
    const fileStdin = new shim.OpenFile(new shim.File(new TextEncoder().encode('Warsha\nMecca\n')))
    const r2 = await runWasm(sw, fileStdin)
    R.fileStdin = r2
    log(`2. File stdin → code=${r2.code} out=${JSON.stringify(r2.out)}`, r2.out.includes('Hello, Warsha!') && r2.out.includes('Warsha from Mecca') ? 'ok' : 'bad')

    // 3. custom stdin Fd (our own fd_read — the engine's hook point)
    const r3 = await runWasm(sw, new BufferStdin(new TextEncoder().encode('Warsha\nMecca\n')))
    R.customStdin = r3
    log(`3. custom Fd stdin → code=${r3.code} out=${JSON.stringify(r3.out)}`, r3.out.includes('Hello, Warsha!') && r3.out.includes('Warsha from Mecca') ? 'ok' : 'bad')

    const ok = R.printf?.code === 0 && R.fileStdin?.out.includes('Warsha from Mecca') && R.customStdin?.out.includes('Warsha from Mecca')
    log(`\n==== WASI-shim: printf=${R.printf?.code === 0} · fileStdin=${R.fileStdin?.out.includes('Warsha from Mecca')} · customFd=${R.customStdin?.out.includes('Warsha from Mecca')} ====`, ok ? 'ok' : 'bad')
    document.body.setAttribute('data-wasi', 'done')
    window.__WASI_DONE = true
  } catch (e) {
    R.fatal = String((e && e.stack) || e)
    log(`FATAL — ${(e && e.message) || e}`, 'bad')
    document.body.setAttribute('data-wasi', 'error')
    window.__WASI_DONE = true
  }
}
main()
