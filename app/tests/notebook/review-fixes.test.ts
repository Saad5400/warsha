/**
 * Regression tests for the independent review of feat/notebooks — one block per
 * finding, named after it, so a reader can find the test for a fix and the fix
 * for a test. Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown, renderInline, safeUrl } from '../../src/notebook/markdown.ts'
import { texToMathML } from '../../src/notebook/tex.ts'
import { appendStream, appendStreamText, streamDisplay, STREAM_LIMIT, TRIMMED_NOTE } from '../../src/notebook/outputs.ts'
import { createNotebook, mergeNotebooks, newCell, parseNotebook, serializeNotebook, NotebookParseError, type Notebook } from '../../src/notebook/nbformat.ts'

// session.ts and document.ts schedule with the browser's timers; Node has the same ones.
const g = globalThis as Record<string, unknown>
g.window ??= globalThis
g.requestAnimationFrame ??= (fn: () => void) => setTimeout(fn, 0) as unknown as number
g.cancelAnimationFrame ??= (id: number) => clearTimeout(id)
const { NotebookSession } = await import('../../src/notebook/session.ts')
const { NotebookDocument, closeNotebooksExcept, closeNotebooksForSwitch, notebookDocument, notebookFileChanged } = await import('../../src/notebook/document.ts')
const { Project } = await import('../../src/fs/project.ts')
const { MemoryStore } = await import('../../src/fs/opfs.ts')

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

/* ---------------------------------------------------- 1. URL sanitizer (XSS) */

test('#1 xss: control characters and embedded tabs cannot smuggle a javascript: URL', () => {
  for (const evil of ['\u0001javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'vbscript:x', 'data:text/html,<script>1</script>', '\\\\evil.com/x', 'file:///etc/passwd']) {
    assert.equal(safeUrl(evil, {}, false), null, JSON.stringify(evil))
    const html = renderMarkdown(`[x](${evil.replace(/\s/g, (c) => (c === ' ' ? '%20' : c))}) <a href="${evil}">y</a> <img src="${evil}">`)
    assert.doesNotMatch(html, /href="[^"]*script:/i, JSON.stringify(evil))
    assert.doesNotMatch(html, /src="[^"]*script:/i, JSON.stringify(evil))
  }
})

test('#1 xss: http(s), mailto, #fragments and relative paths are the only links; all but #frag open away', () => {
  assert.equal(safeUrl('https://x.org/a', {}, false), 'https://x.org/a')
  assert.equal(safeUrl('mailto:a@b.c', {}, false), 'mailto:a@b.c')
  assert.equal(safeUrl('#section', {}, false), '#section')
  assert.equal(safeUrl('docs/page.html', {}, false), 'docs/page.html')
  assert.equal(safeUrl('//evil.com/x', {}, false), 'https://evil.com/x', 'protocol-relative is spelled out')
  const html = renderMarkdown('[a](//evil.com) [b](notes.html) [c](#top) <a href="//evil.com">d</a>')
  assert.match(html, /<a href="https:\/\/evil\.com" target="_blank" rel="noopener noreferrer">a<\/a>/)
  assert.match(html, /<a href="notes\.html" target="_blank" rel="noopener noreferrer">b<\/a>/)
  assert.match(html, /<a href="#top">c<\/a>/)
  assert.match(html, /<a href="https:\/\/evil\.com" target="_blank" rel="noopener noreferrer">d<\/a>/)
  // An HTML entity in an attribute stays text: the browser decodes our &amp; back to a literal &.
  assert.doesNotMatch(renderMarkdown('<a href="&#106;avascript:alert(1)">e</a>'), /href="&#106;/)
})

/* ------------------------------------------------------- 2. TeX never hangs */

test('#2 tex: stray closers inside environments terminate', () => {
  for (const tex of ['\\begin{cases} a \\right) \\end{cases}', '\\begin{pmatrix} 1 } 2 \\end{pmatrix}', '\\begin{aligned} x &= } \\\\ \\right] \\end{aligned}', '\\begin{cases}}}}}', '\\left( \\begin{matrix} \\right']) {
    const out = texToMathML(tex, true)
    assert.match(out, /^<math/, tex)
  }
})

test('#2 tex: fuzz — random and truncated TeX always returns, quickly', () => {
  const pieces = ['\\frac', '{', '}', '^', '_', '&', '\\\\', '\\left(', '\\right)', '\\begin{cases}', '\\end{cases}', '\\begin{pmatrix}', '\\end{pmatrix}', '\\sqrt', '[', ']', 'x', '1', '\\alpha', '\\text{a}', '\\sum', ' ', '\\right', '\\end', '\\begin{aligned}', "'", '\\hat', '\\mathbb']
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  const t0 = Date.now()
  for (let i = 0; i < 3000; i++) {
    let s = ''
    const n = 1 + Math.floor(rand() * 40)
    for (let k = 0; k < n; k++) s += pieces[Math.floor(rand() * pieces.length)]
    for (const cut of [s, s.slice(0, Math.floor(s.length / 2))]) assert.match(texToMathML(cut, rand() < 0.5), /^<math/)
  }
  assert.ok(Date.now() - t0 < 5000, `fuzz took ${Date.now() - t0} ms`)
  // A pathologically deep formula is an error, not a crash or a hang.
  assert.match(texToMathML('{'.repeat(20000) + 'x', true), /^<math/)
})

/* ------------------------------------------ 5 & 6. streams: fast, \r kept raw */

test('#5 streams: 20,000 print() chunks append in linear time', () => {
  const t0 = Date.now()
  let o = appendStream([], 'stdout', '')
  for (let i = 0; i < 20000; i++) o = appendStream(o, 'stdout', `${i}\n`)
  const ms = Date.now() - t0
  assert.equal(o.length, 1)
  assert.ok((o[0].text as string).endsWith('19999\n'))
  assert.ok(ms < 1500, `took ${ms} ms`)
})

test('#5 streams: a runaway stream is capped, oldest lines dropped once with a note', () => {
  let t = ''
  const line = 'x'.repeat(9999) + '\n'
  for (let i = 0; i < (STREAM_LIMIT / 10000) * 2.5; i++) t = appendStreamText(t, line)
  assert.ok(t.length <= STREAM_LIMIT + line.length)
  assert.ok(t.startsWith(TRIMMED_NOTE))
  assert.equal(t.indexOf(TRIMMED_NOTE, 1), -1)
})

test('#6 \\r: progress frames across chunks fold to the last frame, not glued together', () => {
  let o = appendStream([], 'stdout', '0%\r')
  for (const c of ['1%\r', '2%\r', 'done\n']) o = appendStream(o, 'stdout', c)
  assert.equal(o[0].text, 'done\n')
  let p = appendStream([], 'stdout', '10%')
  p = appendStream(p, 'stdout', '\r55%')
  assert.equal(streamDisplay(p[0].text as string), '55%', 'the open line folds on display')
})

/* ----------------------------------------- 7. nested inline placeholders */

test('#7 links: code spans, emphasis and math inside link text render (no "undefined")', () => {
  const a = renderInline('[`read_csv`](https://x.org)')
  assert.equal(a, '<a href="https://x.org" target="_blank" rel="noopener noreferrer"><code>read_csv</code></a>')
  const b = renderInline('[**b** $x$](https://x.org)')
  assert.doesNotMatch(b, /undefined|\u0000/)
  assert.match(b, /<strong>b<\/strong> <math>/)
})

/* ----------------------------------------------- 4. collab: 3-way merge */

function nb(cells: [string, string][]): Notebook {
  const n = createNotebook([])
  n.cells = cells.map(([id, src]) => ({ ...newCell('code', src), id }))
  return n
}

test('#4 merge: each side keeps its own edits; deletions do not eat edits', () => {
  const base = nb([['a', 'A'], ['b', 'B'], ['c', 'C']])
  const local = nb([['a', 'A local'], ['b', 'B'], ['c', 'C'], ['n', 'new local']])
  const remote = nb([['a', 'A'], ['b', 'B remote'], ['r', 'new remote']])
  const m = mergeNotebooks(base, local, remote)
  // n follows its nearest local predecessor that survived (c was deleted remotely): b.
  assert.deepEqual(m.cells.map((c) => [c.id, c.source]), [['a', 'A local'], ['b', 'B remote'], ['n', 'new local'], ['r', 'new remote']])
  // c: deleted remotely, untouched locally → gone. Edited locally and deleted remotely → kept.
  const m2 = mergeNotebooks(base, nb([['a', 'A'], ['c', 'C edited']]), nb([['a', 'A']]))
  assert.deepEqual(m2.cells.map((c) => c.source), ['A', 'C edited'])
})

test('#4 document: a remote edit arriving while a local write is pending is merged, not reverted', async () => {
  const base = serializeNotebook(nb([['a', 'A'], ['b', 'B']]))
  let file = base
  const writes: string[] = []
  const io = {
    read: () => file,
    write: (_p: string, t: string) => void writes.push((file = t)),
    files: () => [],
    owner: () => 'p',
    onFilesChanged() {},
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' }),
  }
  const doc = new NotebookDocument('n.ipynb', fakeKernel(), io)
  doc.updateCell('a', (c) => ({ ...c, source: 'A mine' })) // pending (coalesced)
  const theirs = serializeNotebook(nb([['a', 'A'], ['b', 'B theirs']]))
  file = theirs
  doc.syncFrom(theirs)
  doc.flush()
  const saved = parseNotebook(writes.at(-1)!).cells.map((c) => c.source)
  assert.deepEqual(saved, ['A mine', 'B theirs'])
  doc.dispose()
})

/* --------------------------------------------- 3. wrong project / resurrection */

function fakeKernel(opts: { onExecute?: (io: Record<string, (...a: unknown[]) => void>) => void } = {}) {
  const k = {
    epoch: 1,
    restarted: [] as string[],
    interrupted: 0,
    executed: [] as { notebook: string }[],
    load: async () => {},
    execute: async (_f: unknown, cell: { notebook: string }, io: Record<string, (...a: unknown[]) => void>) => {
      k.executed.push(cell)
      // A cell the test does not hold open finishes at once: the kernel's turn is shared by every session.
      if (opts.onExecute) opts.onExecute(io)
      else setTimeout(() => io.onExit?.(0), 1)
      return { kill() {}, writeStdin() {} }
    },
    interrupt: () => void k.interrupted++,
    restart: async (key: string) => void k.restarted.push(key),
  }
  return k
}

test('#3 project switch: pending notebook edits land in the project being LEFT, never the next one', async () => {
  const a = new MemoryStore()
  const b = new MemoryStore()
  const other = serializeNotebook(nb([['z', 'project B code']]))
  await a.writeFile('notebook.ipynb', serializeNotebook(nb([['a', 'A']])))
  await b.writeFile('notebook.ipynb', other)
  const project = new Project(a)
  await project.load()
  project.onBeforeSave(() => {})
  project.onBeforeSwitch(closeNotebooksForSwitch)
  const io = {
    read: (p: string) => project.read(p),
    write: (p: string, t: string) => project.has(p) && project.setContent(p, t),
    files: () => project.sourceFiles(),
    owner: () => project.owner,
    onFilesChanged() {},
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' }),
  }
  const doc = notebookDocument('notebook.ipynb', fakeKernel(), io)
  doc.updateCell('a', (c) => ({ ...c, source: 'A edited' }))
  await project.switchStore(b)
  assert.equal(project.read('notebook.ipynb'), other, 'project B untouched')
  assert.match((await a.snapshot()).files[0].content, /A edited/, 'the edit reached project A')
  // The closed document no longer writes anywhere.
  doc.updateCell('a', (c) => ({ ...c, source: 'late' }))
  doc.flush()
  assert.equal(project.read('notebook.ipynb'), other)
})

test('#3 dispose: a late output after close is dropped; a deleted notebook is not recreated', async () => {
  let ioRef: Record<string, (...a: unknown[]) => void> = {}
  const k = fakeKernel({ onExecute: (io) => (ioRef = io) })
  let file: string | undefined = serializeNotebook(nb([['a', 'print(1)']]))
  const writes: string[] = []
  const doc = new NotebookDocument('n.ipynb', k, {
    read: () => file,
    write: (_p, t) => {
      if (file === undefined) return // the io's own rule: a deleted file is not recreated
      writes.push(t)
    },
    files: () => [],
    owner: () => 'p',
    onFilesChanged() {},
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' }),
  })
  doc.session.run(['a'])
  await tick(10)
  file = undefined // deleted while running
  doc.dispose()
  const n = writes.length
  ioRef.onStdout?.('late\n')
  ioRef.onOutput?.('display', { output_type: 'display_data', data: { 'text/plain': 'x' }, metadata: {} })
  ioRef.onExit?.(0)
  await tick(150)
  assert.equal(writes.length, n)
  assert.ok(!doc.get().model?.cells[0].outputs.some((o) => JSON.stringify(o).includes('late')))
})

/* -------------------------------------------- 8. namespace key per document */

test('#8 namespace: keyed per open notebook, kept across rename, never shared by a reused name', async () => {
  const k = fakeKernel()
  const host = { files: () => [], workspace: () => 'p', cell: () => newCell('code', 'x'), update() {}, cellIds: () => [], onFilesChanged() {}, onFailure() {} }
  const msgs = () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' })
  const s1 = new NotebookSession('lab.ipynb', k, host, msgs)
  s1.run(['c1'])
  await tick(10)
  s1.rename('lab2.ipynb')
  const key = s1.key
  s1.dispose()
  await tick(10)
  assert.deepEqual(k.restarted, [key], 'dispose frees the namespace it used, by key')
  const s2 = new NotebookSession('lab.ipynb', k, host, msgs)
  assert.notEqual(s2.key, key, 'a later notebook with the same name gets a fresh namespace')
  assert.equal(k.executed[0].notebook, key)
  s2.dispose()
})

/* ----------------------------- 9. interrupt reaches a cell waiting its turn */

test('#9 interrupt: a cell waiting behind another notebook\'s cell is cancelled too', async () => {
  let finishA: (() => void) | null = null
  const k = fakeKernel({ onExecute: (io) => (finishA ??= () => io.onExit?.(0)) })
  const host = { files: () => [], workspace: () => 'p', cell: () => newCell('code', 'x'), update() {}, cellIds: () => [], onFilesChanged() {}, onFailure() {} }
  const msgs = () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' })
  const a = new NotebookSession('a.ipynb', k, host, msgs)
  const b = new NotebookSession('b.ipynb', k, host, msgs)
  a.run(['a1'])
  await tick(10)
  b.run(['b1']) // shifted off b's queue, waiting for the kernel behind a1
  await tick(10)
  assert.equal(b.busy, true)
  b.interrupt()
  assert.equal(b.busy, false)
  assert.equal(b.get().cells.b1, undefined)
  finishA!()
  await tick(20)
  assert.deepEqual(k.executed.map((c) => c.notebook), [a.key], 'b1 never started')
  a.dispose()
  b.dispose()
})

/* ---------------------------------------------------- 11. malformed input */

test('#11 parse: a non-object cell is an error, never silently dropped on save', () => {
  assert.throws(() => parseNotebook(JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: 'code', source: '', metadata: {}, outputs: [] }, 'oops'] })), NotebookParseError)
})

test('#11 parse: an nbformat-3 heading cell becomes a markdown heading; outputs without a type are dropped', () => {
  const n = parseNotebook(JSON.stringify({
    nbformat: 4, nbformat_minor: 0, metadata: {},
    cells: [
      { cell_type: 'heading', level: 2, source: 'Results', metadata: {} },
      { cell_type: 'code', source: 'x', metadata: {}, execution_count: 1, outputs: [{ text: 'no type' }, { output_type: 'stream', name: 'stdout', text: 'ok' }] },
    ],
  }))
  assert.equal(n.cells[0].type, 'markdown')
  assert.equal(n.cells[0].source, '## Results')
  const saved = JSON.parse(serializeNotebook(n))
  assert.equal(saved.cells[0].cell_type, 'markdown')
  assert.ok(!('level' in saved.cells[0]))
  assert.deepEqual(saved.cells[1].outputs.map((o: { output_type: string }) => o.output_type), ['stream'])
})

/* ------------------------------------- suspected: initialize on empty text */

test('suspected: an empty .ipynb opens as an empty notebook and writes NOTHING until edited', async () => {
  const writes: string[] = []
  const doc = new NotebookDocument('n.ipynb', fakeKernel(), {
    read: () => '',
    write: (_p, t) => void writes.push(t),
    files: () => [],
    owner: () => 'p',
    onFilesChanged() {},
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' }),
  })
  assert.equal(doc.get().model?.cells.length, 1)
  await tick(400)
  doc.flush()
  assert.deepEqual(writes, [])
  // The real content arriving later simply loads.
  doc.syncFrom(serializeNotebook(nb([['r', 'real']])))
  assert.equal(doc.get().model?.cells[0].source, 'real')
  doc.dispose()
})

/* ------------------------ suspected: program and cell debugging collide */

test('suspected: a program run cannot reset the debug store under a paused notebook cell', async () => {
  const { debugStore } = await import('../../src/debug/store.ts')
  const cell = {}
  debugStore.begin(true, cell)
  debugStore.onStop({ reason: 'breakpoint', frames: [{ name: '<module>', path: 'n.ipynb#cell=a', line: 2, scopes: [] }] }, cell)
  // A plain Run of main.py starting and ending meanwhile:
  debugStore.begin(false)
  debugStore.end()
  assert.equal(debugStore.get().phase, 'paused', 'the cell is still paused, with its stop')
  assert.equal(debugStore.busyFor('program'), true, 'the program side sees a debug session it must not start over')
  debugStore.end(cell)
  assert.equal(debugStore.get().phase, 'inactive')
  assert.equal(debugStore.busyFor('program'), false)
})

/* =================================================== re-review (A, B, C) */

const noIds = (sources: string[]) =>
  JSON.stringify({ cells: sources.map((s) => ({ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: s })), metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 1) + '\n'

test('A(i) ids: cells without stored ids get the same minted id on every parse', () => {
  const t = noIds(['a = 1', 'b = 2', 'a = 1'])
  const one = parseNotebook(t).cells.map((c) => c.id)
  assert.deepEqual(parseNotebook(t).cells.map((c) => c.id), one)
  assert.equal(new Set(one).size, 3, 'identical cells still get distinct ids')
  // Duplicate stored ids: the second is minted, deterministically too.
  const dup = JSON.stringify({ cells: ['x', 'y'].map((s) => ({ cell_type: 'code', id: 'same', metadata: {}, outputs: [], source: s, execution_count: null })), metadata: {}, nbformat: 4, nbformat_minor: 5 })
  assert.deepEqual(parseNotebook(dup).cells.map((c) => c.id), parseNotebook(dup).cells.map((c) => c.id))
})

test('A(i) merge: a notebook without ids is merged, not doubled', () => {
  let file = noIds(['a = 1', 'b = 2'])
  const writes: string[] = []
  const doc = new NotebookDocument('old.ipynb', fakeKernel(), {
    read: () => file,
    write: (_p, t) => void writes.push((file = t)),
    files: () => [],
    owner: () => 'p',
    onFilesChanged() {},
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' }),
  })
  assert.deepEqual(writes, [], 'opening writes nothing (minted ids are not persisted into an unedited file)')
  const a = doc.get().model!.cells[0].id
  doc.updateCell(a, (c) => ({ ...c, source: 'a = 10' }))
  doc.syncFrom(noIds(['a = 1', 'b = 20']))
  doc.flush()
  assert.deepEqual(parseNotebook(writes.at(-1)!).cells.map((c) => c.source), ['a = 10', 'b = 20'])
  doc.dispose()
})

test('A(ii) sync: a file change reaches an open notebook through the registry, view or not', () => {
  let file = serializeNotebook(nb([['a', 'A'], ['b', 'B']]))
  const doc = notebookDocument('bg.ipynb', fakeKernel(), {
    read: () => file,
    write: (_p, t) => void (file = t),
    files: () => [],
    owner: () => 'p',
    onFilesChanged() {},
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '', stoppedAtError: () => '' }),
  })
  doc.updateCell('a', (c) => ({ ...c, outputs: [{ output_type: 'stream', name: 'stdout', text: 'running…' }] })) // a cell streaming
  notebookFileChanged('p', 'bg.ipynb', serializeNotebook(nb([['a', 'A'], ['b', 'B theirs']])))
  doc.flush()
  const saved = parseNotebook(file).cells
  assert.equal(saved[1].source, 'B theirs', "the collaborator's edit survives the output flush")
  assert.equal(saved[0].outputs.length, 1, 'and so does the local output')
  closeNotebooksExcept('p', new Set())
})

test('B fragments: only heading slugs; #room=/#share= and friends are refused', () => {
  for (const evil of ['#room=abc', '#share=eJxz', '#a/b', '#x?y', '#a=1']) assert.equal(safeUrl(evil, {}, false), null, evil)
  assert.equal(safeUrl('#load-the-data', {}, false), '#load-the-data')
  assert.equal(safeUrl('#الفصل_1', {}, false), '#الفصل_1')
  const html = renderMarkdown('## Load the data\n\n[go](#load-the-data) [evil](#room=abc)')
  assert.match(html, /<h2 id="nb-load-the-data"/, 'heading ids are namespaced away from the page\'s own ids')
  assert.match(html, /<a href="#load-the-data">go<\/a>/)
  assert.doesNotMatch(html, /room=/)
})

test('C interrupt: a download that never ends is stopped at the ceiling', async () => {
  const { INTERRUPT_LIMITS } = await import('../../src/notebook/session.ts')
  const saved = { ...INTERRUPT_LIMITS }
  INTERRUPT_LIMITS.escalateMs = 20
  INTERRUPT_LIMITS.ceilingMs = 120
  let killed = 0
  let exitFn: ((c: number | null) => void) | null = null
  const k = fakeKernel({ onExecute: (io) => (exitFn = io.onExit as (c: number | null) => void) })
  k.execute = async (_f: unknown, cell: { notebook: string }, io: Record<string, (...a: unknown[]) => void>) => {
    k.executed.push(cell)
    exitFn = io.onExit as (c: number | null) => void
    return { kill: () => (killed++, exitFn?.(null)), writeStdin() {} } // never starts (no onExecuteInput), never ends
  }
  const host = { files: () => [], workspace: () => 'p', cell: () => newCell('code', 'import big'), update() {}, cellIds: () => [], onFilesChanged() {}, onFailure() {} }
  const s = new NotebookSession('d.ipynb', k, host, () => ({ restarted: '', forcedRestart: 'forced', lost: '', debugBusy: '', stoppedAtError: () => '' }))
  s.run(['c'])
  await tick(10)
  s.interrupt()
  await tick(60)
  assert.equal(killed, 0, 'still downloading: given time to honour the interrupt')
  await tick(200)
  assert.equal(killed, 1, 'past the ceiling: restarted')
  assert.equal(s.get().running, null)
  Object.assign(INTERRUPT_LIMITS, saved)
  s.dispose()
})

test('C debugger: a program\'s stop/resume cannot leak into a cell\'s debug session', async () => {
  const { debugStore } = await import('../../src/debug/store.ts')
  const cell = {}
  debugStore.begin(true, cell)
  debugStore.onStop({ reason: 'breakpoint', frames: [{ name: '<module>', path: 'n.ipynb#cell=a', line: 2, scopes: [] }] }, cell)
  const seq = debugStore.get().stopSeq
  debugStore.onStop({ reason: 'breakpoint', frames: [{ name: '<module>', path: 'main.py', line: 9, scopes: [] }] }) // the program's
  debugStore.onResume() // the program's
  assert.equal(debugStore.get().stopSeq, seq)
  assert.equal(debugStore.get().stopped?.frames[0].path, 'n.ipynb#cell=a')
  assert.equal(debugStore.get().phase, 'paused')
  debugStore.end(cell)
})
