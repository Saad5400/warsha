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
 *   { type: "run", files: { [path]: content }, entry: string, debug?: { sab, stopOnEntry } }
 * (worker -> main):
 *   { type: "progress", phase, message, loaded?, total? }
 *   { type: "ready", version, bootMs }
 *   { type: "stdout" | "stderr", text }
 *   { type: "stdin-request" }
 *   { type: "files", written, deleted, skipped }   sent before "done"; see below
 *   { type: "done", code, ms }
 *   { type: "fatal", text, duringBoot? }
 *   { type: "dbg-stop", stopped }       debug runs only: the program is parked
 *   { type: "dbg-vars", id, vars?, error? }   answer to a variables(ref) request
 *
 * DEBUG RUNS (see runtimes/clang/src/instrument.js + app/src/runtime/debug.ts): the
 * sources are instrumented (tree-sitter-c, loaded on the first debug run only) and
 * compiled at -O0; the instrumentation calls `warsha.*` wasm imports served by
 * DebugEngine below. A stop PARKS the program inside the `line` import on
 * Atomics.wait over a second SharedArrayBuffer — the worker's event loop is blocked
 * for the whole run, so every control message (resume, pause, breakpoints, variables
 * requests) travels through that buffer, never postMessage. Layout (Int32 slots):
 *   [0] state  0 parked/idle · 1 variables request pending · 2 resume
 *   [1] resume command  0 continue · 1 stepOver · 2 stepInto · 3 stepOut
 *   [2] pause flag (main sets, worker clears when it stops)
 *   [3] breakpoint generation · [4] breakpoint JSON byte length
 *   [5] request id · [6] request ref
 *   bytes 32.. breakpoint JSON: [{ path, line }]
 */
import { init, Wasmer, Directory } from 'https://unpkg.com/@wasmer/sdk@0.10.0/dist/index.mjs'
import {
  WASI,
  Fd,
  File as WasiFile,
  Directory as WasiDirectory,
  PreopenDirectory,
  wasi as wasiDefs,
} from 'https://unpkg.com/@bjorn3/browser_wasi_shim@0.4.2/dist/index.js'

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
// A completed line also goes out if the last flush was >= FLUSH_INTERVAL_MS ago, so
// `printf("Working...\n");` before a long computation shows up while it runs (no
// timer can fire in a busy worker), yet a tight print loop still batches.
const FLUSH_THRESHOLD = 8192
const FLUSH_INTERVAL_MS = 50

class OutFd extends Fd {
  constructor(kind) {
    super()
    this.kind = kind // 'stdout' | 'stderr'
    this.decoder = new TextDecoder('utf-8', { fatal: false })
    this.pending = ''
    this.lastFlush = 0
  }
  fd_write(dataBytes) {
    const text = this.decoder.decode(dataBytes, { stream: true })
    this.pending += text
    if (this.pending.length >= FLUSH_THRESHOLD) this.flush()
    else if (text.includes('\n') && performance.now() - this.lastFlush >= FLUSH_INTERVAL_MS) this.flush()
    return { ret: 0, nwritten: dataBytes.byteLength }
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new wasiDefs.Fdstat(CHARDEV, 0) } }
  flush() {
    if (this.pending.length === 0) return
    self.postMessage({ type: this.kind, text: this.pending })
    this.pending = ''
    this.lastFlush = performance.now()
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

// --- the program's files ------------------------------------------------------------
// The project is the program's working directory: every project file is mounted in an
// in-memory WASI directory, preopened as "/" (wasi-libc resolves a relative path
// against its cwd, which starts at "/"), so fopen("data.txt", "r") reads the file the
// student sees beside main.c and fopen("out.txt", "w") creates one. After the run the
// tree is diffed against what went in, and the difference is posted back so the shell
// can write it into the project — otherwise output files would die with the run.
// The project is text-only: a binary or oversized file is reported as skipped.

const WRITE_BACK_LIMIT_BYTES = 1024 * 1024
const textEncoder = new TextEncoder()
const strictDecoder = new TextDecoder('utf-8', { fatal: true })

/** { "a/b.txt": "…" } -> nested WASI Directory contents. */
function buildProjectTree(files) {
  const root = new Map()
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/').filter(Boolean)
    let dir = root
    for (let i = 0; i < parts.length - 1; i++) {
      let next = dir.get(parts[i])
      if (!(next instanceof WasiDirectory)) {
        next = new WasiDirectory(new Map())
        dir.set(parts[i], next)
      }
      dir = next.contents
    }
    dir.set(parts[parts.length - 1], new WasiFile(textEncoder.encode(content)))
  }
  return root
}

function walkTree(contents, prefix, out) {
  for (const [name, entry] of contents) {
    const rel = prefix ? `${prefix}/${name}` : name
    if (entry instanceof WasiDirectory) walkTree(entry.contents, rel, out)
    else if (entry instanceof WasiFile) out.set(rel, entry.data)
  }
  return out
}

function collectFileChanges(sent, contents) {
  const written = []
  const skipped = []
  const now = walkTree(contents, '', new Map())
  for (const [rel, bytes] of now) {
    let text = null
    if (bytes.byteLength <= WRITE_BACK_LIMIT_BYTES) {
      try {
        text = strictDecoder.decode(bytes)
        if (text.includes('\u0000')) text = null
      } catch {
        text = null
      }
    }
    if (text === null) skipped.push(rel)
    else if (sent[rel] !== text) written.push({ path: rel, content: text })
  }
  const deleted = Object.keys(sent).filter((p) => !now.has(p))
  return { written, deleted, skipped }
}

function postFileChanges(sent, contents) {
  try {
    const change = collectFileChanges(sent, contents)
    if (change.written.length || change.deleted.length || change.skipped.length) {
      self.postMessage({ type: 'files', ...change })
    }
  } catch (e) {
    self.postMessage({ type: 'stderr', text: `[Warsha: could not save files your program wrote: ${e}]\n` })
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
 *  Atomics.wait when the program reads stdin; a Stop is the worker being terminated.
 *  `projectDir` (a Map from buildProjectTree) is preopened as the program's cwd and
 *  mutated in place by the program's file writes. */
function runWasm(wasmBytes, projectDir, makeDebugger) {
  const out = new OutFd('stdout')
  const err = new OutFd('stderr')
  const flushAll = () => { out.flush(); err.flush() }
  const dbg = makeDebugger ? makeDebugger(flushAll) : null
  const stdin = new StdinFd(flushAll)
  const wasi = new WASI(['program'], [], [stdin, out, err, new PreopenDirectory('/', projectDir)], { debug: false })

  const mod = new WebAssembly.Module(wasmBytes)
  const imports = WebAssembly.Module.imports(mod)
  const importObj = { wasi_snapshot_preview1: wasi.wasiImport }
  if (dbg) importObj.warsha = dbg.imports()

  const wasixNames = imports.filter((i) => i.module === 'wasix_32v1').map((i) => i.name)
  if (wasixNames.length) {
    importObj.wasix_32v1 = {}
    for (const n of wasixNames) importObj.wasix_32v1[n] = () => 0
    // WASIX libc may ask the host for its cwd instead of tracking it itself. A stub
    // that "succeeds" without writing anything would hand it garbage, and every
    // relative fopen() would then miss the project dir. Answer "/" — the preopen.
    if (wasixNames.includes('getcwd')) {
      importObj.wasix_32v1.getcwd = (bufPtr, lenPtr) => {
        const memory = instanceMemory()
        if (!memory) return wasiDefs.ERRNO_NOSYS ?? 52
        const view = new DataView(memory.buffer)
        const cap = view.getUint32(lenPtr, true)
        const cwd = textEncoder.encode('/')
        view.setUint32(lenPtr, cwd.byteLength, true)
        if (cap < cwd.byteLength) return wasiDefs.ERRNO_RANGE ?? 68
        new Uint8Array(memory.buffer, bufPtr, cwd.byteLength).set(cwd)
        return 0
      }
    }
  }

  let instance = null
  const instanceMemory = () => mem || (instance && instance.exports.memory) || null
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

  instance = new WebAssembly.Instance(mod, importObj)
  if (!(instance.exports.memory instanceof WebAssembly.Memory) && mem) {
    Object.defineProperty(instance.exports, 'memory', { value: mem, configurable: true })
  }
  if (dbg) dbg.mem = mem || instance.exports.memory

  // start() returns the process exit code: it catches WASIProcExit (proc_exit,
  // which is how a normal `return N` from main arrives via crt's _start) and
  // returns its code; it only rethrows a genuine trap/error.
  let code = 0
  try {
    code = wasi.start(instance)
  } catch (e) {
    flushAll()
    if (dbg) dbg.trap(e)
    throw e
  }
  flushAll()
  return code
}

// --- debugger -----------------------------------------------------------------------

const D_STATE = 0, D_CMD = 1, D_PAUSE = 2, D_BPGEN = 3, D_BPLEN = 4, D_REQID = 5, D_REQREF = 6
const D_HEADER = 32
const ST_PARKED = 0, ST_REQ = 1, ST_RESUME = 2
const STEP_MODES = ['continue', 'over', 'into', 'out']

const BASE_SIZES = {
  char: 1, 'signed char': 1, 'unsigned char': 1, _Bool: 1, short: 2, 'unsigned short': 2,
  int: 4, 'unsigned int': 4, long: 4, 'unsigned long': 4, 'long long': 8, 'unsigned long long': 8,
  float: 4, double: 8, 'long double': 16,
}
const CHARS = new Set(['char', 'signed char', 'unsigned char'])
const MAX_CHILDREN = 1000
const MAX_STRING = 200
const latin1 = new TextDecoder('utf-8', { fatal: false })

function charLiteral(v) {
  const c = v & 0xff
  const named = { 0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 39: "\\'", 92: '\\\\' }
  if (named[c]) return `'${named[c]}'`
  if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`
  return `'\\x${c.toString(16).padStart(2, '0')}'`
}

function quoteC(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/[\x00-\x1f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '"'
}

const fmtFloat = (v) => (Number.isFinite(v) ? String(parseFloat(v.toPrecision(7))) : String(v).replace('Infinity', 'inf'))
const fmtDouble = (v) => (Number.isFinite(v) ? String(v) : String(v).replace('Infinity', 'inf'))

/** Serves the instrumentation's `warsha.*` imports: a shadow call stack with the
 *  address + type descriptor of every live variable, the line/step/breakpoint logic,
 *  and value decoding straight out of wasm memory while parked. */
class DebugEngine {
  constructor(sab, meta, stopOnEntry, flush) {
    this.i32 = new Int32Array(sab, 0, D_HEADER / 4)
    this.bpBytes = new Uint8Array(sab, D_HEADER)
    this.meta = meta
    this.flush = flush
    this.mem = null
    this.frames = []        // { name, fid, line, vars: [{ name, addr, desc, dims }] }
    this.globals = []
    this.structs = new Map() // key -> { size, fields: [{ name, off, desc, dims }] }
    this.strs = new Map()
    this.types = new Map()
    this.mode = stopOnEntry ? 'entry' : 'continue'
    this.startDepth = 0
    this.lastF = -1; this.lastL = -1; this.lastD = -1
    this.bpGen = -1
    this.bps = new Map()     // fid -> Set(line)
    this.refs = [null]
    this.pathFid = new Map(meta.paths.map((p, i) => [p, i]))
  }

  imports() {
    return {
      line: (f, l) => this.line(f, l),
      enter: (name, f, l) => { this.frames.push({ name: this.str(name), fid: f, line: l, vars: [] }); return this.frames.length },
      leave: (d) => { if (d - 1 < this.frames.length) this.frames.length = Math.max(0, d - 1) },
      mark: () => { const t = this.frames[this.frames.length - 1]; return t ? t.vars.length : 0 },
      unreg: (m) => { const t = this.frames[this.frames.length - 1]; if (t && m < t.vars.length) t.vars.length = m },
      reg: (name, addr, desc, d0, d1, d2) => {
        const t = this.frames[this.frames.length - 1]
        if (!t) return
        const v = { name: this.str(name), addr: addr >>> 0, desc: this.str(desc), dims: [d0, d1, d2] }
        // Unguarded registrations (switch bodies, goto functions) re-run: replace, don't pile up.
        const i = t.vars.findIndex((x) => x.name === v.name && x.addr === v.addr)
        if (i >= 0) t.vars[i] = v
        else t.vars.push(v)
      },
      greg: (name, addr, desc, d0, d1, d2) => {
        const n = this.str(name)
        if (!this.globals.some((g) => g.name === n)) this.globals.push({ name: n, addr: addr >>> 0, desc: this.str(desc), dims: [d0, d1, d2] })
      },
      ssize: (key, size) => {
        const k = this.str(key)
        if (!this.structs.has(k)) this.structs.set(k, { size, fields: [] })
      },
      sfield: (key, name, desc, off, d0, d1, d2) => {
        const s = this.structs.get(this.str(key))
        const n = this.str(name)
        if (s && !s.fields.some((f) => f.name === n)) s.fields.push({ name: n, off, desc: this.str(desc), dims: [d0, d1, d2] })
      },
    }
  }

  // --- memory -------------------------------------------------------------------
  u8() { return new Uint8Array(this.mem.buffer) }
  view() { return new DataView(this.mem.buffer) }
  inBounds(addr, size) { return addr > 0 && addr + Math.max(size, 1) <= this.mem.buffer.byteLength }
  cstring(ptr, max) {
    const u8 = this.u8()
    let end = ptr
    const lim = Math.min(u8.length, ptr + max)
    while (end < lim && u8[end] !== 0) end++
    return { text: latin1.decode(u8.slice(ptr, end)), truncated: end === lim && u8[end] !== 0 }
  }
  /** Interned C string (names, descriptors: string literals with stable addresses). */
  str(ptr) {
    let s = this.strs.get(ptr)
    if (s === undefined) { s = this.cstring(ptr >>> 0, 4096).text; this.strs.set(ptr, s) }
    return s
  }

  // --- breakpoints & stepping ---------------------------------------------------
  reloadBps() {
    const gen = Atomics.load(this.i32, D_BPGEN)
    const len = Atomics.load(this.i32, D_BPLEN)
    this.bpGen = gen
    let list = []
    try { list = JSON.parse(new TextDecoder().decode(this.bpBytes.slice(0, len))) } catch { list = [] }
    const bps = new Map()
    for (const bp of list) {
      const fid = this.pathFid.get(bp.path)
      if (fid === undefined) continue
      const line = this.snap(fid, bp.line)
      if (line == null) continue
      if (!bps.has(fid)) bps.set(fid, new Set())
      bps.get(fid).add(line)
    }
    this.bps = bps
  }
  /** A breakpoint on a line with no code (blank, `{`, a declaration without an
   *  initializer) moves to the next line that has some, within the same function. */
  snap(fid, line) {
    const lines = this.meta.lines[fid] || []
    if (lines.includes(line)) return line
    const next = lines.find((l) => l > line)
    if (next == null) return null
    const fn = (this.meta.funcs[fid] || []).find(([s, e]) => next >= s && next <= e)
    if (!fn) return null
    return fn[0] <= line || fn[0] - line <= 2 ? next : null
  }

  line(f, l) {
    const depth = this.frames.length
    const top = this.frames[depth - 1]
    if (top) { top.line = l; top.fid = f }
    // Several hooks on one line (`a++; b++;`, a one-line loop, a for header's init +
    // condition) are one stop, not several: a repeat of the previous event is skipped.
    const same = f === this.lastF && l === this.lastL && depth === this.lastD
    this.lastF = f; this.lastL = l; this.lastD = depth
    if (Atomics.load(this.i32, D_BPGEN) !== this.bpGen) this.reloadBps()
    const paused = Atomics.load(this.i32, D_PAUSE) !== 0
    if (same && !paused) return
    let reason = null
    if (paused) reason = 'pause'
    else if (this.mode === 'entry') reason = 'entry'
    else if (this.bps.get(f)?.has(l)) reason = 'breakpoint'
    else if (this.mode === 'into' || (this.mode === 'over' && depth <= this.startDepth) || (this.mode === 'out' && depth < this.startDepth)) reason = 'step'
    if (reason) this.stop(reason)
  }

  /** Park the program: report the stop, serve variables requests, return on resume. */
  stop(reason, description) {
    this.flush()
    Atomics.store(this.i32, D_PAUSE, 0)
    this.refs = [null]
    const stopped = { reason, frames: this.buildFrames() }
    if (description) stopped.description = description
    Atomics.store(this.i32, D_STATE, ST_PARKED)
    self.postMessage({ type: 'dbg-stop', stopped })
    for (;;) {
      Atomics.wait(this.i32, D_STATE, ST_PARKED)
      const s = Atomics.load(this.i32, D_STATE)
      if (s === ST_REQ) {
        const id = Atomics.load(this.i32, D_REQID)
        const ref = Atomics.load(this.i32, D_REQREF)
        let reply
        try {
          reply = { type: 'dbg-vars', id, vars: this.children(ref) }
        } catch (e) {
          reply = { type: 'dbg-vars', id, error: String((e && e.message) || e) }
        }
        // Back to PARKED *before* replying: the main thread sends the next queued
        // request the moment this reply lands, and resetting after it would wipe
        // that request out (both sides then wait forever). The CAS still leaves a
        // RESUME that raced in untouched.
        Atomics.compareExchange(this.i32, D_STATE, ST_REQ, ST_PARKED)
        self.postMessage(reply)
        continue
      }
      if (s === ST_RESUME) break
    }
    Atomics.store(this.i32, D_STATE, ST_PARKED)
    this.mode = STEP_MODES[Atomics.load(this.i32, D_CMD)] || 'continue'
    this.startDepth = this.frames.length
    this.refs = [null]
  }

  /** A trap (segfault, divide by zero, abort) — the shadow stack is still intact
   *  (cleanups never ran), so show where it happened before the run ends. */
  trap(e) {
    if (!this.mem || !this.frames.length) return
    const msg = String((e && e.message) || e)
    const desc = /out of bounds/i.test(msg) ? `Segmentation fault: ${msg}`
      : /divide by zero/i.test(msg) ? `Arithmetic exception: ${msg}`
      : /unreachable/i.test(msg) ? `Aborted (${msg})`
      : msg
    try { this.stop('exception', desc) } catch { /* reporting is best-effort */ }
  }

  // --- values -------------------------------------------------------------------
  type(desc, dims) {
    const key = desc + '|' + dims.join(',')
    let t = this.types.get(key)
    if (t) return t
    let i = 0, di = 0
    const go = () => {
      if (desc[i] === '*') { i++; return { k: 'ptr', to: go() } }
      if (desc[i] === '[') {
        const j = desc.indexOf(']', i)
        const inner = desc.slice(i + 1, j)
        i = j + 1
        const n = inner === '' ? (dims[di++] | 0) : parseInt(inner, 10) || 0
        return { k: 'arr', n, of: go() }
      }
      return { k: 'base', name: desc.slice(i) }
    }
    t = go()
    this.types.set(key, t)
    return t
  }
  sizeOf(t) {
    if (t.k === 'ptr') return 4
    if (t.k === 'arr') return t.n * this.sizeOf(t.of)
    return BASE_SIZES[t.name] ?? this.structs.get(t.name)?.size ?? 0
  }
  typeName(t) {
    if (t.k === 'base') return t.name.startsWith('?') ? (t.name === '?fn' ? 'function' : t.name.slice(1)) : t.name
    if (t.k === 'ptr') return t.to.k === 'arr' ? `${this.typeName(t.to)}*` : `${this.typeName(t.to)}*`
    let dims = ''
    let e = t
    while (e.k === 'arr') { dims += `[${e.n}]`; e = e.of }
    return this.typeName(e) + dims
  }
  isScalar(t) { return t.k === 'ptr' || (t.k === 'base' && t.name in BASE_SIZES) }
  newRef(addr, t, name) { this.refs.push({ addr, t, name }); return this.refs.length - 1 }

  scalar(addr, name) {
    const dv = this.view()
    switch (name) {
      case 'char': case 'signed char': { const v = dv.getInt8(addr); return `${v} ${charLiteral(v)}` }
      case 'unsigned char': { const v = dv.getUint8(addr); return `${v} ${charLiteral(v)}` }
      case '_Bool': return dv.getUint8(addr) ? 'true' : 'false'
      case 'short': return String(dv.getInt16(addr, true))
      case 'unsigned short': return String(dv.getUint16(addr, true))
      case 'int': case 'long': return String(dv.getInt32(addr, true))
      case 'unsigned int': case 'unsigned long': return String(dv.getUint32(addr, true))
      case 'long long': return String(dv.getBigInt64(addr, true))
      case 'unsigned long long': return String(dv.getBigUint64(addr, true))
      case 'float': return fmtFloat(dv.getFloat32(addr, true))
      case 'double': return fmtDouble(dv.getFloat64(addr, true))
      case 'long double': return '<long double>'
    }
    return '?'
  }

  /** One-line display of a value; `deep` limits nested previews. */
  display(addr, t, deep = 0) {
    const size = this.sizeOf(t)
    if (!this.inBounds(addr, size)) return `<unreadable 0x${addr.toString(16)}>`
    if (t.k === 'base') {
      if (t.name in BASE_SIZES) return this.scalar(addr, t.name)
      const s = this.structs.get(t.name)
      if (!s) return t.name.startsWith('?') ? `{…}` : `${t.name} {…}`
      if (deep > 1) return '{…}'
      const parts = s.fields.slice(0, 6).map((f) => `${f.name}: ${this.display(addr + f.off, this.type(f.desc, f.dims), deep + 1)}`)
      return `{${parts.join(', ')}${s.fields.length > 6 ? ', …' : ''}}`
    }
    if (t.k === 'ptr') {
      const p = this.view().getUint32(addr, true)
      if (p === 0) return 'NULL'
      const hex = '0x' + p.toString(16)
      if (t.to.k === 'base' && CHARS.has(t.to.name) && this.inBounds(p, 1)) {
        const { text, truncated } = this.cstring(p, MAX_STRING)
        return `${hex} ${quoteC(text)}${truncated ? '…' : ''}`
      }
      return hex
    }
    // array
    if (t.of.k === 'base' && CHARS.has(t.of.name)) {
      const { text, truncated } = this.cstring(addr, Math.min(t.n, MAX_STRING))
      return quoteC(text) + (truncated && t.n > MAX_STRING ? '…' : '')
    }
    if (deep > 1) return '[…]'
    const es = this.sizeOf(t.of)
    const n = Math.min(t.n, 10)
    const parts = []
    for (let i = 0; i < n; i++) parts.push(this.display(addr + i * es, t.of, deep + 1))
    return `[${parts.join(', ')}${t.n > n ? ', …' : ''}]`
  }

  expandable(addr, t) {
    if (t.k === 'arr') return t.n > 0
    if (t.k === 'base') return !!this.structs.get(t.name)?.fields.length
    // pointer: expandable to *p when it points at something we can decode
    if (t.to.k === 'base' && (t.to.name === 'void' || t.to.name.startsWith('?'))) return false
    if (!this.inBounds(addr, 4)) return false
    const p = this.view().getUint32(addr, true)
    return p !== 0 && this.inBounds(p, Math.max(1, this.sizeOf(t.to)))
  }

  value(name, addr, t) {
    const v = { name, value: this.display(addr, t), type: this.typeName(t) }
    if (this.inBounds(addr, this.sizeOf(t)) && this.expandable(addr, t)) v.ref = this.newRef(addr, t, name)
    return v
  }

  children(ref) {
    const r = this.refs[ref]
    if (!r) throw new Error('This value is no longer available (the program has moved on).')
    const { addr, t } = r
    if (t.k === 'arr') {
      const es = this.sizeOf(t.of)
      const out = []
      for (let i = 0; i < Math.min(t.n, MAX_CHILDREN); i++) out.push(this.value(`[${i}]`, addr + i * es, t.of))
      return out
    }
    if (t.k === 'ptr') {
      const p = this.view().getUint32(addr, true)
      return [this.value(`*${r.name}`, p, t.to)]
    }
    const s = this.structs.get(t.name)
    return s ? s.fields.map((f) => this.value(f.name, addr + f.off, this.type(f.desc, f.dims))) : []
  }

  buildFrames() {
    const globals = this.globals.map((g) => this.value(g.name, g.addr, this.type(g.desc, g.dims)))
    const frames = []
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const fr = this.frames[i]
      // An inner block's variable shadows an outer one of the same name: show the live one.
      const latest = new Map()
      for (const v of fr.vars) latest.set(v.name, v)
      const locals = [...latest.values()].map((v) => this.value(v.name, v.addr, this.type(v.desc, v.dims)))
      const scopes = [{ name: 'Locals', variables: locals }]
      if (globals.length) scopes.push({ name: 'Globals', variables: globals, expensive: true })
      frames.push({ name: fr.name, path: this.meta.paths[fr.fid] ?? '', line: fr.line, scopes })
    }
    return frames
  }
}

// The C parser + instrumenter, loaded on the first DEBUG run only (plain runs never
// pay for it). Same-origin assets staged into public/ by `npm run assets`.
let instrumenterPromise = null
function loadInstrumenter() {
  if (!instrumenterPromise) {
    instrumenterPromise = (async () => {
      const at = (name) => new URL(name, self.location.href).href
      const TS = await import(at('warsha-web-tree-sitter.js'))
      await TS.Parser.init({ locateFile: () => at('warsha-web-tree-sitter.wasm') })
      const parser = new TS.Parser()
      parser.setLanguage(await TS.Language.load(at('warsha-tree-sitter-c.wasm')))
      const mod = await import(at('warsha-clang-instrument.js'))
      return { parser, instrument: mod.instrument, prelude: mod.PRELUDE }
    })()
    instrumenterPromise.catch(() => { instrumenterPromise = null })
  }
  return instrumenterPromise
}

// --- compile ---------------------------------------------------------------------

const decodeMaybe = (x) => (typeof x === 'string' ? x : new TextDecoder().decode(x || new Uint8Array()))

/** Compile all .c files (plus the rt shim) into one WASIX executable. Returns the
 *  wasm bytes, or null after streaming clang's diagnostics if compilation failed. */
async function compile(files, opts = {}) {
  const dir = new Directory()
  await dir.writeFile('__warsha_rt.c', RT_SHIM)
  const cfiles = ['/project/__warsha_rt.c']
  for (const [path, content] of Object.entries(files)) {
    await dir.writeFile(path, content)
    if (path.endsWith('.c')) cfiles.push('/project/' + path)
  }
  // A debug build: the instrumented sources + the hook prelude force-included into
  // every TU (so no line moves), -O0, and -w — any warning would quote the
  // instrumented line; the plain build's diagnostics are the student-facing ones.
  const extra = []
  if (opts.prelude) {
    await dir.writeFile('__wd_prelude.h', opts.prelude)
    extra.push('-include', '/project/__wd_prelude.h', '-w')
  }
  const args = ['-Wl,--export-memory', opts.prelude ? '-O0' : '-O1', ...extra, ...cfiles, '-lm', '-o', '/project/out.wasm']
  // `stdin: ''` hands clang a CLOSED stdin. Left open, an invocation that doesn't
  // end in a wasm-ld spawn (e.g. a compile error in any .c but the first, or
  // -fsyntax-only) sat ~20 s in inst.wait() before returning.
  const inst = await clang.entrypoint.run({ args, mount: { '/project': dir }, stdin: '' })
  const res = await inst.wait()
  const diag = decodeMaybe(res.stderr)
  if (opts.quiet) {
    if (res.code !== 0) { opts.quiet.diag = diag; return null }
    return await dir.readFile('out.wasm')
  }
  if (diag) self.postMessage({ type: 'stderr', text: diag.endsWith('\n') ? diag : diag + '\n' })
  if (res.code !== 0) return null
  // `dir` is mounted AT /project inside the guest, so its OWN paths are relative to
  // its root: the guest wrote /project/out.wasm, which is `out.wasm` here.
  return await dir.readFile('out.wasm')
}

/** Debug build. Returns { wasm, meta } to debug; null after a real compile error;
 *  or { plainWasm } when only the instrumentation failed — the program still runs,
 *  just without stopping, and the console says so.
 *  The instrumented build is compiled quietly (-w; its diagnostics would quote
 *  instrumented lines). Only if it fails is the PLAIN source compiled, and that
 *  build's diagnostics are the ones shown — the student's own lines and columns. One
 *  clang invocation per successful debug run, same as Run (each invocation is costly
 *  in clang-wasm, so no separate syntax pass). */
async function compileForDebug(files) {
  let why = ''
  for (const layouts of [true, false]) {
    let instr = null
    try {
      const { parser, instrument, prelude } = await loadInstrumenter()
      const { files: out, meta } = instrument(parser, files, { layouts })
      instr = { files: { ...files, ...out }, meta, prelude }
    } catch (e) {
      why = String((e && e.message) || e)
      break
    }
    const quiet = {}
    const wasm = await compile(instr.files, { prelude: instr.prelude, quiet })
    if (wasm) return { wasm, meta: instr.meta }
    why = quiet.diag || 'unknown'
    // Only the struct-layout constructor broke (a struct the parser saw but the
    // preprocessor dropped): retry without layouts — structs then show as `{…}`.
    if (layouts && /__wd_init_/.test(why)) continue
    // wasm-ld only runs once every TU compiled, so a link error (undefined function,
    // two mains) is the student's own; it quotes no source line, so its text is exact.
    if (/wasm-ld: error:/.test(why) && !/__wd_/.test(why)) {
      self.postMessage({ type: 'stderr', text: why.endsWith('\n') ? why : why + '\n' })
      return null
    }
    break
  }
  const plainWasm = await compile(files)
  if (!plainWasm) return null
  console.warn('[warsha c debugger] instrumentation failed:', why)
  self.postMessage({ type: 'stderr', text: '[Warsha: could not prepare this program for debugging; running it without breakpoints.]\n' })
  return { plainWasm }
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
      let makeDebugger = null
      try {
        if (msg.debug) {
          const built = await compileForDebug(msg.files)
          if (built && built.wasm) {
            wasm = built.wasm
            makeDebugger = (flush) => new DebugEngine(msg.debug.sab, built.meta, !!msg.debug.stopOnEntry, flush)
          } else if (built === null) {
            wasm = null // a genuine compile error, already reported from the plain build
          } else {
            wasm = built.plainWasm
          }
        } else {
          wasm = await compile(msg.files)
        }
      } catch (e) {
        self.postMessage({ type: 'fatal', text: 'compile: ' + String((e && e.stack) || e) })
        return
      }
      if (!wasm) { self.postMessage({ type: 'done', code: 1, ms: Math.round(performance.now() - t0) }); return }
      const projectDir = buildProjectTree(msg.files)
      try {
        const code = runWasm(wasm, projectDir, makeDebugger)
        postFileChanges(msg.files, projectDir)
        self.postMessage({ type: 'done', code: Number(code) | 0, ms: Math.round(performance.now() - t0) })
      } catch (e) {
        // A trap (segfault, abort) still keeps whatever the program wrote before it.
        postFileChanges(msg.files, projectDir)
        self.postMessage({ type: 'fatal', text: String((e && e.stack) || e) })
      }
    })()
    return
  }
}
