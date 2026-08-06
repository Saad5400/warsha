/* Warsha C runtime — clang-wasm worker.
 *
 * MUST be started as `new Worker(url, { type: "module" })`.
 *
 * Two-phase, and split across two runtimes on purpose (see runtimes/clang/M0-FINDINGS.md):
 *   1. COMPILE — the @wasmer/sdk `clang/clang` package (clang 16 + wasm-ld) compiles
 *      the student's .c files to a WASIX `.wasm`. clang diagnostics stream to stderr;
 *      a non-zero exit ends the run with code 1 and nothing executes.
 *   2. RUN — we execute that `.wasm` OURSELVES under @bjorn3/browser_wasi_shim, NOT
 *      through the SDK's runner. The SDK's live stdin never delivers to a blocked
 *      scanf (only batch does), so self-hosting is the only way to get interactive
 *      prompt/response. The package emits WASIX (imports wasi_snapshot_preview1.* +
 *      wasix_32v1.futex/signal + a shared env.memory), so we supply our own shared
 *      memory (limits parsed from the binary) and stub the wasix_32v1 funcs — a
 *      single-threaded student program never contends a futex.
 *
 * stdin blocks on the shared buffer exactly like the Python/C# workers: our stdin
 * `Fd.fd_read` parks on `Atomics.wait` until the main thread posts a line. The one
 * difference from C#: this is a BYTE stream (scanf/getchar/fread read bytes, not
 * lines), and the delivered bytes keep their trailing '\n'.
 *
 * Protocol (main -> worker):
 *   { type: "init", sab }
 *   { type: "run", files: { [path]: content }, entry: string }
 * (worker -> main):
 *   { type: "progress", phase, message, loaded?, total? }
 *   { type: "ready", version, bootMs }
 *   { type: "stdout" | "stderr", text }
 *   { type: "stdin-request" }
 *   { type: "done", code, ms }
 *   { type: "fatal", text, duringBoot? }
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@0.10.0/dist/index.mjs'
import { WASI, Fd, wasi as wasiDefs } from 'https://unpkg.com/@bjorn3/browser_wasi_shim@0.4.2/dist/index.js'

// --- stdin shared-memory protocol (identical layout to the Python/C# workers) ---
// ctrl[0]: 0 = no data (worker parks), 1 = line ready, 2 = EOF
// ctrl[1]: byte length of the pending line in `data`
let ctrl = null
let data = null

let clang = null

const CHARDEV = wasiDefs && wasiDefs.FILETYPE_CHARACTER_DEVICE != null ? wasiDefs.FILETYPE_CHARACTER_DEVICE : 2

/* A synthetic translation unit compiled alongside the student's code. wasi-libc is
 * musl-based and does NOT flush a line-buffered stdout when stdin is read (that is a
 * glibc extension), so a `printf("Enter: ")` prompt with no '\n' and no fflush would
 * never reach the console before the program blocks on input. Making stdout/stderr
 * unbuffered via a constructor (runs before main, from _start's ctor pass) means every
 * write reaches our host Fd immediately; the host then coalesces those writes so bulk
 * output stays fast. Student source is untouched. */
const RT_SHIM = `#include <stdio.h>
__attribute__((constructor)) static void __warsha_unbuffer(void){
  setvbuf(stdout, 0, _IONBF, 0);
  setvbuf(stderr, 0, _IONBF, 0);
}
`

// --- host output: coalesce guest writes, but never hide a prompt -----------------
// The guest's stdout is unbuffered (above), so a no-newline prompt reaches us as a
// write; we buffer host-side for throughput and flush on threshold, before the guest
// blocks on stdin, and at exit — so prompts are never stranded behind buffering.
const FLUSH_THRESHOLD = 8192

class OutFd extends Fd {
  constructor(kind) {
    super()
    this.kind = kind // 'stdout' | 'stderr'
    this.decoder = new TextDecoder('utf-8', { fatal: false })
    this.pending = ''
  }
  fd_write(dataBytes) {
    this.pending += this.decoder.decode(dataBytes, { stream: true })
    if (this.pending.length >= FLUSH_THRESHOLD) this.flush()
    return { ret: 0, nwritten: dataBytes.byteLength }
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new wasiDefs.Fdstat(CHARDEV, 0) } }
  flush() {
    if (this.pending.length === 0) return
    self.postMessage({ type: this.kind, text: this.pending })
    this.pending = ''
  }
}

class StdinFd extends Fd {
  constructor(onBeforeBlock) {
    super()
    this.onBeforeBlock = onBeforeBlock // flush stdout/stderr before we park
    this.buf = new Uint8Array(0)       // undelivered bytes from the current line
    this.pos = 0
    this.eof = false
  }
  fd_read(size) {
    if (this.pos >= this.buf.length) {
      if (this.eof) return { ret: 0, data: new Uint8Array(0) } // stays EOF once closed
      const line = this.#requestLine()
      if (line === null) { this.eof = true; return { ret: 0, data: new Uint8Array(0) } }
      this.buf = line
      this.pos = 0
    }
    const n = Math.min(size, this.buf.length - this.pos)
    const out = this.buf.slice(this.pos, this.pos + n)
    this.pos += n
    return { ret: 0, data: out }
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new wasiDefs.Fdstat(CHARDEV, 0) } }
  /** Park the worker until the main thread hands over a line (or EOF). Returns the
   *  raw bytes INCLUDING the trailing '\n', or null on EOF. */
  #requestLine() {
    if (this.onBeforeBlock) this.onBeforeBlock()
    Atomics.store(ctrl, 0, 0)
    self.postMessage({ type: 'stdin-request' })
    while (Atomics.load(ctrl, 0) === 0) Atomics.wait(ctrl, 0, 0, 250)
    const state = Atomics.load(ctrl, 0)
    Atomics.store(ctrl, 0, 0)
    if (state === 2) return null // EOF
    const len = Atomics.load(ctrl, 1)
    return data.slice(0, len) // a fresh (non-shared) copy of the bytes
  }
}

// --- WASIX binary helpers --------------------------------------------------------

/** Parse the first imported memory's limits from a wasm binary's import section. */
function memoryImportLimits(bytes) {
  let o = 8 // magic(4) + version(4)
  const u32 = () => { let r = 0, s = 0, b; do { b = bytes[o++]; r |= (b & 0x7f) << s; s += 7 } while (b & 0x80); return r >>> 0 }
  while (o < bytes.length) {
    const id = bytes[o++]
    const size = u32()
    const end = o + size
    if (id === 2) {
      const count = u32()
      for (let i = 0; i < count; i++) {
        const mlen = u32(); o += mlen
        const nlen = u32(); o += nlen
        const kind = bytes[o++]
        if (kind === 0) { u32() }
        else if (kind === 1) { o++; const f = bytes[o++]; u32(); if (f & 1) u32() }
        else if (kind === 2) { const flags = bytes[o++]; const min = u32(); const max = (flags & 1) ? u32() : undefined; return { min, max, shared: !!(flags & 2) } }
        else if (kind === 3) { o++; o++ }
      }
      return null
    }
    o = end
  }
  return null
}

/** Run a compiled WASIX module to completion on THIS thread. Blocks in fd_read via
 *  Atomics.wait when the program reads stdin; a Stop is the worker being terminated. */
function runWasm(wasmBytes) {
  const out = new OutFd('stdout')
  const err = new OutFd('stderr')
  const flushAll = () => { out.flush(); err.flush() }
  const stdin = new StdinFd(flushAll)
  const wasi = new WASI(['program'], [], [stdin, out, err], { debug: false })

  const mod = new WebAssembly.Module(wasmBytes)
  const imports = WebAssembly.Module.imports(mod)
  const importObj = { wasi_snapshot_preview1: wasi.wasiImport }

  const wasixNames = imports.filter((i) => i.module === 'wasix_32v1').map((i) => i.name)
  if (wasixNames.length) {
    importObj.wasix_32v1 = {}
    for (const n of wasixNames) importObj.wasix_32v1[n] = () => 0
  }

  const memImp = imports.find((i) => i.module === 'env' && i.name === 'memory')
  let mem = null
  if (memImp) {
    const lim = memoryImportLimits(wasmBytes)
    const desc = { initial: lim.min, maximum: lim.max ?? lim.min }
    if (lim.shared) desc.shared = true
    mem = new WebAssembly.Memory(desc)
    importObj.env = { memory: mem }
  }
  for (const i of imports) {
    if (i.module === 'env' && i.name !== 'memory' && i.kind === 'function') {
      importObj.env = importObj.env || {}
      if (!importObj.env[i.name]) importObj.env[i.name] = () => 0
    }
  }

  const instance = new WebAssembly.Instance(mod, importObj)
  if (!(instance.exports.memory instanceof WebAssembly.Memory) && mem) {
    Object.defineProperty(instance.exports, 'memory', { value: mem, configurable: true })
  }

  // start() returns the process exit code: it catches WASIProcExit (proc_exit,
  // which is how a normal `return N` from main arrives via crt's _start) and
  // returns its code; it only rethrows a genuine trap/error.
  let code = 0
  try {
    code = wasi.start(instance)
  } catch (e) {
    flushAll()
    throw e
  }
  flushAll()
  return code
}

// --- compile ---------------------------------------------------------------------

const decodeMaybe = (x) => (typeof x === 'string' ? x : new TextDecoder().decode(x || new Uint8Array()))

/** Compile all .c files (plus the rt shim) into one WASIX executable. Returns the
 *  wasm bytes, or null after streaming clang's diagnostics if compilation failed. */
async function compile(files) {
  const dir = new Directory()
  await dir.writeFile('__warsha_rt.c', RT_SHIM)
  const cfiles = ['/project/__warsha_rt.c']
  for (const [path, content] of Object.entries(files)) {
    await dir.writeFile(path, content)
    if (path.endsWith('.c')) cfiles.push('/project/' + path)
  }
  const args = ['-Wl,--export-memory', '-O1', ...cfiles, '-lm', '-o', '/project/out.wasm']
  const inst = await clang.entrypoint.run({ args, mount: { '/project': dir } })
  const res = await inst.wait()
  const diag = decodeMaybe(res.stderr)
  if (diag) self.postMessage({ type: 'stderr', text: diag.endsWith('\n') ? diag : diag + '\n' })
  if (res.code !== 0) return null
  // `dir` is mounted AT /project inside the guest, so its OWN paths are relative to
  // its root: the guest wrote /project/out.wasm, which is `out.wasm` here.
  return await dir.readFile('out.wasm')
}

// --- boot -------------------------------------------------------------------------

// M0: ~30 MB compressed toolchain download. Floor for the byte counter until the SDK
// exposes a real total; refined in a later pass.
const EXPECTED_TOTAL_BYTES = 30_000_000
const DOWNLOAD_MESSAGE = 'Downloading C toolchain (clang, one-time)…'

let bytesLoaded = 0
let lastProgressAt = 0

function installFetchProgress() {
  const original = self.fetch.bind(self)
  self.fetch = async (input, initArg) => {
    const response = await original(input, initArg)
    try {
      if (!response.ok || !response.body) return response
      const reader = response.body.getReader()
      const counted = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read()
          if (done) { controller.close(); return }
          bytesLoaded += value.byteLength
          const now = performance.now()
          if (now - lastProgressAt > 100) {
            lastProgressAt = now
            self.postMessage({
              type: 'progress', phase: 'download', message: DOWNLOAD_MESSAGE,
              loaded: bytesLoaded, total: Math.max(EXPECTED_TOTAL_BYTES, bytesLoaded),
            })
          }
          controller.enqueue(value)
        },
        cancel: (reason) => reader.cancel(reason),
      })
      return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers })
    } catch {
      return response
    }
  }
  return () => { self.fetch = original }
}

async function boot() {
  const t0 = performance.now()
  self.postMessage({ type: 'progress', phase: 'download', message: DOWNLOAD_MESSAGE })

  const restoreFetch = installFetchProgress()
  try {
    await init()
    clang = await Wasmer.fromRegistry('clang/clang')
  } finally {
    restoreFetch()
  }

  // Warm the WASI sysroot: the first compile that pulls in <stdio.h> demand-loads
  // system headers + libc out of the package (~24 s, M0). Pay it here, behind the
  // progress UI, so the student's first Run is sub-second — the Java/C# bar.
  self.postMessage({ type: 'progress', phase: 'compile', message: 'Warming the C compiler…' })
  const warm = new Directory()
  await warm.writeFile('w.c', '#include <stdio.h>\nint main(void){return 0;}\n')
  const wi = await clang.entrypoint.run({ args: ['/project/w.c', '-o', '/project/w.wasm'], mount: { '/project': warm } })
  await wi.wait()

  self.postMessage({ type: 'ready', version: 'C · clang 16 (wasm)', bootMs: Math.round(performance.now() - t0) })
}

// --- messages ---------------------------------------------------------------------

self.onmessage = (ev) => {
  const msg = ev.data
  if (msg.type === 'init') {
    ctrl = new Int32Array(msg.sab, 0, 2)
    data = new Uint8Array(msg.sab, 8)
    boot().catch((e) => self.postMessage({ type: 'fatal', text: String((e && e.stack) || e), duringBoot: true }))
    return
  }
  if (msg.type === 'run') {
    ;(async () => {
      const t0 = performance.now()
      let wasm
      try {
        wasm = await compile(msg.files)
      } catch (e) {
        self.postMessage({ type: 'fatal', text: 'compile: ' + String((e && e.stack) || e) })
        return
      }
      if (!wasm) { self.postMessage({ type: 'done', code: 1, ms: Math.round(performance.now() - t0) }); return }
      try {
        const code = runWasm(wasm)
        self.postMessage({ type: 'done', code: Number(code) | 0, ms: Math.round(performance.now() - t0) })
      } catch (e) {
        self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
      }
    })()
    return
  }
}
