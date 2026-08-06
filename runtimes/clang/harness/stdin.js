/* stdin model test (v3) — determine which stdin path actually delivers.
 * SDK type defs: run({ stdin: string|Uint8Array }) = batch up-front; and a live
 * instance.stdin WritableStream. v2's un-awaited live write to a blocked scanf
 * failed. Test three variants, same scanf program:
 *   A. BATCH   — run({ stdin: 'Warsha\nMecca\n' })
 *   B. LIVE    — instance.stdin writer, await ready + await write, delayed
 *   C. LIVE+CLOSE — like B but close() after writing (in case flush needs close)
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@latest/dist/index.mjs'

const logEl = document.getElementById('log')
const R = { A: {}, B: {}, C: {} }
window.__STDIN = R
const lines = []
const log = (m, c) => { lines.push(`<span class="${c || 'dim'}">${(c === 'ok' ? '✓ ' : c === 'bad' ? '✗ ' : '  ') + m}</span>`); logEl.className = ''; logEl.innerHTML = lines.join('\n'); console.log(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const SRC = `#include <stdio.h>
int main(void){
  char a[64], b[64];
  printf("Your name: "); fflush(stdout);
  if (scanf("%63s", a) != 1) { printf("no-input-1\\n"); return 1; }
  printf("Hello, %s!\\n", a); fflush(stdout);
  printf("Your city: "); fflush(stdout);
  if (scanf("%63s", b) != 1) { printf("no-input-2\\n"); return 1; }
  printf("%s from %s\\n", a, b); fflush(stdout);
  return 0;
}
`

let progWasm = null
async function loadProg(clang) {
  const dir = new Directory()
  await dir.writeFile('ask.c', SRC)
  const comp = await clang.entrypoint.run({ args: ['/project/ask.c', '-o', '/project/ask.wasm'], mount: { '/project': dir } })
  const cres = await comp.wait()
  if (cres.code !== 0) throw new Error('compile failed: ' + (typeof cres.stderr === 'string' ? cres.stderr : new TextDecoder().decode(cres.stderr)))
  progWasm = await dir.readFile('ask.wasm')
}

function pipeOut(instance) {
  const box = { out: '' }
  const dec = new TextDecoder()
  instance.stdout.pipeTo(new WritableStream({ write: (c) => { box.out += dec.decode(c, { stream: true }) } })).catch(() => {})
  instance.stderr.pipeTo(new WritableStream({ write: (c) => { box.out += dec.decode(c, { stream: true }) } })).catch(() => {})
  return box
}

// A — batch stdin provided up front
async function testA(clang) {
  const prog = await Wasmer.fromFile(progWasm)
  const instance = await prog.entrypoint.run({ stdin: 'Warsha\nMecca\n' })
  const box = pipeOut(instance)
  const fin = await Promise.race([instance.wait(), sleep(8000).then(() => ({ code: 'TIMEOUT' }))])
  R.A = { code: fin.code, out: box.out, ok: box.out.includes('Hello, Warsha!') && box.out.includes('Warsha from Mecca') }
  log(`A. BATCH run({stdin}) → ok=${R.A.ok} code=${fin.code} out=${JSON.stringify(box.out)}`, R.A.ok ? 'ok' : 'bad')
}

// B — live writes, awaited, delayed, no close
async function testB(clang) {
  const prog = await Wasmer.fromFile(progWasm)
  const instance = await prog.entrypoint.run()
  const box = pipeOut(instance)
  const enc = new TextEncoder()
  const w = instance.stdin.getWriter()
  const until = async (s, ms) => { const t = performance.now(); while (!box.out.includes(s)) { if (performance.now() - t > ms) return false; await sleep(50) } return true }
  await until('Your name:', 6000)
  await sleep(600)
  try { await w.ready } catch {}
  await w.write(enc.encode('Warsha\n'))
  const hello = await until('Hello, Warsha!', 5000)
  await until('Your city:', 3000)
  await sleep(400)
  await w.write(enc.encode('Mecca\n'))
  const fin2 = await until('Warsha from Mecca', 5000)
  const fin = await Promise.race([instance.wait().then((f) => f.code), sleep(3000).then(() => 'TIMEOUT')])
  R.B = { ok: hello && fin2, code: fin, out: box.out }
  log(`B. LIVE await-write (no close) → hello=${hello} final=${fin2} code=${fin}`, R.B.ok ? 'ok' : 'bad')
}

// C — live writes then close stdin
async function testC(clang) {
  const prog = await Wasmer.fromFile(progWasm)
  const instance = await prog.entrypoint.run()
  const box = pipeOut(instance)
  const enc = new TextEncoder()
  const w = instance.stdin.getWriter()
  const until = async (s, ms) => { const t = performance.now(); while (!box.out.includes(s)) { if (performance.now() - t > ms) return false; await sleep(50) } return true }
  await until('Your name:', 6000)
  await sleep(400)
  await w.write(enc.encode('Warsha\nMecca\n'))
  await w.close()
  const done = await until('Warsha from Mecca', 6000)
  const fin = await Promise.race([instance.wait().then((f) => f.code), sleep(3000).then(() => 'TIMEOUT')])
  R.C = { ok: done, code: fin, out: box.out }
  log(`C. LIVE write-both+close → ok=${done} code=${fin} out=${JSON.stringify(box.out)}`, R.C.ok ? 'ok' : 'bad')
}

async function main() {
  try {
    log(`crossOriginIsolated = ${self.crossOriginIsolated}`, self.crossOriginIsolated ? 'ok' : 'bad')
    await init()
    const clang = await Wasmer.fromRegistry('clang/clang')
    log('compiling scanf program (warm sysroot)…')
    await loadProg(clang)
    log('compiled — testing stdin variants…', 'ok')
    await testA(clang)
    await testB(clang)
    await testC(clang)
    log(`\n==== stdin: BATCH=${R.A.ok} · LIVE=${R.B.ok} · LIVE+close=${R.C.ok} ====`, (R.A.ok || R.B.ok) ? 'ok' : 'bad')
    document.body.setAttribute('data-stdin', 'done')
    window.__STDIN_DONE = true
  } catch (e) {
    R.fatal = String((e && e.stack) || e)
    log(`FATAL — ${(e && e.message) || e}`, 'bad')
    document.body.setAttribute('data-stdin', 'error')
    window.__STDIN_DONE = true
  }
}
main()
