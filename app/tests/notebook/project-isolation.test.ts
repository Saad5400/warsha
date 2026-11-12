/**
 * QA B1: two projects never share a notebook. Every notebook starter saves as `notebook.ipynb`,
 * and the shell's one Project object reads and writes whichever project is attached — so an open
 * notebook keyed by path alone showed project A's cells under project B and saved them over B's
 * file. These drive the real Project, the real projects store and the real notebook registry,
 * wired the way App.tsx wires them, through every way of leaving a project.
 *
 * Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeNotebook, parseNotebook, newCell, createNotebook, type Notebook } from '../../src/notebook/nbformat.ts'
import { templates } from '../../src/templates.ts'
import type { FsSnapshot } from '../../src/fs/types.ts'
import type { ProjectMeta } from '../../src/fs/projects.ts'

const g = globalThis as Record<string, unknown>
g.window ??= globalThis
g.requestAnimationFrame ??= (fn: () => void) => setTimeout(fn, 0) as unknown as number
g.cancelAnimationFrame ??= (id: number) => clearTimeout(id)
const { closeNotebooksExcept, closeNotebooksForSwitch, flushNotebooks, notebookDocument, notebookFileChanged, notebookModel, openNotebook, revealCell } = await import('../../src/notebook/document.ts')
const { Project } = await import('../../src/fs/project.ts')
const { MemoryStore } = await import('../../src/fs/opfs.ts')
const { createProjects } = await import('../../src/fs/projects.ts')

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
// Storage takes real time (OPFS does), so React renders between a switch's steps. A memory
// store answering in a microtask would let a switch finish before any render could land in it.
const snapshotNow = MemoryStore.prototype.snapshot
MemoryStore.prototype.snapshot = async function (this: InstanceType<typeof MemoryStore>) {
  await tick(2)
  return snapshotNow.call(this)
}
const NB = 'notebook.ipynb'
const starter = (name: string): FsSnapshot => {
  const t = templates.find((x) => x.name === name)
  if (!t) throw new Error(`no starter ${name}`)
  return t.snapshot
}
const PANDAS = starter('Data with pandas')
const BASICS = starter('Python basics notebook')
const heading = (text: string | undefined) => (text ? parseNotebook(text).cells[0].source.split('\n')[0] : undefined)
const firstCode = (nb: Notebook | null | undefined) => nb?.cells.find((c) => c.type === 'code')

function fakeKernel() {
  const k = {
    epoch: 1,
    load: async () => {},
    runs: [] as { workspace?: string; files: string[] }[],
    async execute(files: { path: string }[], cell: { workspace?: string }, io: { onExit?(c: number): void }) {
      k.runs.push({ workspace: cell.workspace, files: files.map((f) => f.path) })
      setTimeout(() => io.onExit?.(0), 1)
      return { kill() {}, writeStdin() {} }
    },
    interrupt() {},
    restart: async () => {},
  }
  return k
}

/** The shell, as App.tsx + useProject wire it: one Project, the projects store, the notebook
 *  registry's hooks, and the notebook I/O. Transitions call the same store/Project APIs, in the
 *  same order, as useProject's open / createProject / adoptShared / deleteProject. */
async function shell() {
  const projects = createProjects()
  const project = new Project()
  const kernel = fakeKernel()
  const offs = [
    project.onBeforeSave(flushNotebooks),
    project.onBeforeSwitch(closeNotebooksForSwitch),
    project.onContentChange((path) => notebookFileChanged(project.owner, path, project.read(path))),
  ]
  const errors: string[] = []
  const io = {
    read: (p: string) => project.read(p),
    write: (p: string, t: string) => {
      if (project.has(p)) project.setContent(p, t)
    },
    files: () => project.sourceFiles(),
    owner: () => project.owner,
    onFilesChanged: (change: { written: { path: string; content: string }[]; deleted: string[] }) => void project.applyProgramChanges(change),
    onFailure() {},
    messages: () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '' }),
  }
  /** What App's render does on every pass: the open tab's document. */
  const render = (path = NB) => notebookDocument(path, kernel as never, io)
  const open = async (meta: ProjectMeta) => {
    await project.switchStore(projects.storeFor(meta.id), meta.id)
    await projects.touch(meta.id)
  }
  const create = async (name: string, snapshot?: FsSnapshot) => {
    await project.saveAll()
    const meta = await projects.create(name, snapshot)
    await open(meta)
    return meta
  }
  const disk = async (meta: ProjectMeta) => (await projects.storeFor(meta.id).snapshot()).files.find((f) => f.path === NB)?.content
  const done = () => {
    closeNotebooksForSwitch()
    for (const off of offs) off()
  }
  const origError = console.error
  console.error = (...a: unknown[]) => void errors.push(a.map(String).join(' '))
  const restore = () => (console.error = origError)
  return { projects, project, kernel, io, render, open, create, disk, errors, done: () => (done(), restore()) }
}

/** No render showed A's notebook under any other project, and at least one fell mid-switch. */
function assertNoLeak(seen: ({ owner: string; heading: string } | null)[], a: ProjectMeta) {
  assert.ok(seen.includes(null), `a render fell inside the switch: ${JSON.stringify(seen)}`)
  for (const r of seen) {
    if (r && r.owner !== a.id) assert.notEqual(r.heading, '# Data with pandas', `A's notebook shown under ${r.owner}: ${JSON.stringify(seen)}`)
  }
}

/** Edit A's open notebook (a pending, not yet written, edit), then leave by `leave`, rendering
 *  the way React does across every await of the switch. Returns what each render saw. */
async function leaveWithPendingEdit(s: Awaited<ReturnType<typeof shell>>, leave: () => Promise<unknown>) {
  const a = s.render()!
  const id = firstCode(a.get().model)!.id
  a.updateCell(id, (c) => ({ ...c, source: c.source + '\n# edited in A' }))
  /** Each render: null (no document — mid-switch), or the document's project and first line. */
  const seen: ({ owner: string; heading: string } | null)[] = []
  let switching = true
  const pass = () => {
    if (!switching) return
    const doc = s.render()
    seen.push(doc ? { owner: doc.owner, heading: heading(serializeNotebook(doc.get().model ?? createNotebook())) ?? '' } : null)
    setTimeout(pass, 0)
  }
  const leaving = leave()
  pass()
  await leaving
  switching = false
  return { a, seen }
}

const transitions: { name: string; to(s: Awaited<ReturnType<typeof shell>>, a: ProjectMeta): Promise<ProjectMeta> }[] = [
  {
    name: 'Home → open another project',
    async to(s) {
      const b = await s.projects.create('Python basics notebook', BASICS)
      await s.open(b)
      return b
    },
  },
  { name: 'Home → new project from a notebook starter', to: (s) => s.create('Python basics notebook', BASICS) },
  { name: 'import a .zip as a new project', to: (s) => s.create('Imported', { files: [{ path: NB, content: BASICS.files[0].content }], dirs: [] }) },
  {
    name: 'a share link landing on an existing copy',
    async to(s) {
      // adoptShared: saveAll, then the first project whose files match the link is opened.
      const b = await s.projects.create('Shared', BASICS)
      await s.project.saveAll()
      await s.open(b)
      return b
    },
  },
]

for (const t of transitions) {
  test(`B1 ${t.name}: B shows its own notebook, A's edit lands in A, nothing of A reaches B`, async () => {
    const s = await shell()
    try {
      const a = await s.create('Data with pandas', PANDAS)
      assert.equal(heading(s.project.read(NB)), '# Data with pandas')
      let b!: ProjectMeta
      const { a: docA, seen } = await leaveWithPendingEdit(s, async () => (b = await t.to(s, a)))
      // Mid-switch, no render may open a document from the files being left.
      assertNoLeak(seen, a)
      // A's pending edit was written to A before the store swapped, and A's document is closed.
      assert.match((await s.disk(a))!, /# edited in A/)
      assert.ok(docA.closed)
      // B's tab: B's cells.
      const docB = s.render()!
      assert.notEqual(docB, docA)
      assert.equal(docB.owner, b.id)
      assert.equal(heading(serializeNotebook(docB.get().model!)), '# Python basics, one cell at a time')
      // Edit B and save: only B changes.
      docB.updateCell(firstCode(docB.get().model)!.id, (c) => ({ ...c, source: '# edited in B' }))
      await s.project.saveAll()
      assert.match((await s.disk(b))!, /# edited in B/)
      assert.doesNotMatch((await s.disk(b))!, /Data with pandas|edited in A/)
      const onA = (await s.disk(a))!
      assert.equal(heading(onA), '# Data with pandas')
      assert.doesNotMatch(onA, /edited in B|Python basics/)
      // The late document of A can no longer write anywhere.
      docA.updateCell(firstCode(docA.get().model)!.id, (c) => ({ ...c, source: 'late' }))
      docA.flush()
      await s.project.saveAll()
      assert.doesNotMatch((await s.disk(b))!, /late/)
      // And back to A: A's own cells, with its edit.
      await s.open(a)
      const back = s.render()!
      assert.equal(back.owner, a.id)
      assert.equal(heading(serializeNotebook(back.get().model!)), '# Data with pandas')
      assert.match(firstCode(back.get().model)!.source, /# edited in A/)
    } finally {
      s.done()
    }
  })
}

test('B1 joining a collab room (a fresh empty project): A\'s notebook does not follow, and nothing is written', async () => {
  const s = await shell()
  try {
    const a = await s.create('Data with pandas', PANDAS)
    let room!: ProjectMeta
    const { seen } = await leaveWithPendingEdit(s, async () => (room = await s.create('Live session')))
    assertNoLeak(seen, a)
    assert.match((await s.disk(a))!, /# edited in A/)
    // The room's project has no notebook.ipynb: the tab (until adoptProject replaces it) is an
    // empty in-memory notebook, and an edit there is not written into the room's project.
    const doc = s.render()!
    assert.equal(doc.owner, room.id)
    assert.equal(doc.get().model!.cells.length, 1)
    doc.replace((nb) => ({ ...nb, cells: [newCell('code', 'x = 1')] }))
    await s.project.saveAll()
    assert.equal(await s.disk(room), undefined)
  } finally {
    s.done()
  }
})

test('B1 deleting the open project: its notebook is flushed and closed first, nothing resurrects it, the survivor shows its own', async () => {
  const s = await shell()
  try {
    const b = await s.create('Python basics notebook', BASICS)
    const a = await s.create('Data with pandas', PANDAS)
    const storeA = s.projects.storeFor(a.id)
    const { a: docA, seen } = await leaveWithPendingEdit(s, async () => {
      // useProject.deleteProject, for the open project: let go of its storage, remove it, open the survivor.
      await s.project.switchStore(new MemoryStore())
      await s.projects.remove(a.id)
      const writesAfterRemove = JSON.stringify(await storeA.snapshot())
      await s.open(b)
      await s.project.saveAll()
      assert.equal(JSON.stringify(await storeA.snapshot()), writesAfterRemove, 'nothing reached the removed project after its removal')
    })
    assertNoLeak(seen, a)
    assert.ok(docA.closed)
    const docB = s.render()!
    assert.equal(docB.owner, b.id)
    assert.equal(heading(serializeNotebook(docB.get().model!)), '# Python basics, one cell at a time')
    assert.equal(heading(await s.disk(b)), '# Python basics, one cell at a time')
  } finally {
    s.done()
  }
})

test('B1 deleting the LAST project: the shell is left on an empty store, and no notebook can write into the deleted one', async () => {
  const s = await shell()
  try {
    const a = await s.create('Data with pandas', PANDAS)
    const storeA = s.projects.storeFor(a.id)
    const docA = s.render()!
    docA.updateCell(firstCode(docA.get().model)!.id, (c) => ({ ...c, source: 'pending' }))
    await s.project.switchStore(new MemoryStore())
    await s.projects.remove(a.id)
    const after = JSON.stringify(await storeA.snapshot())
    assert.ok(docA.closed)
    assert.equal(s.project.read(NB), undefined, 'the deleted project\'s files are not left in memory')
    docA.flush()
    await s.project.saveAll()
    assert.equal(JSON.stringify(await storeA.snapshot()), after)
  } finally {
    s.done()
  }
})

test('B1 guard: a document loaded from A refuses (and logs) a write once B is attached, even if the switch hooks were bypassed', async () => {
  const s = await shell()
  try {
    const a = await s.create('Data with pandas', PANDAS)
    const b = await s.projects.create('Python basics notebook', BASICS)
    const docA = s.render()!
    // A future bug: the store swaps without the notebooks being closed first.
    closeNotebooksForSwitch()
    const stale = notebookDocument(NB, s.kernel as never, s.io)!
    assert.equal(stale.owner, a.id)
    s.project['beforeSwitch'] = [] // nothing closes it this time
    await s.project.switchStore(s.projects.storeFor(b.id), b.id)
    stale.updateCell(firstCode(stale.get().model)!.id, (c) => ({ ...c, source: 'cross-project' }))
    stale.flush()
    await s.project.saveAll()
    assert.doesNotMatch((await s.disk(b))!, /cross-project|Data with pandas/)
    assert.equal(heading(s.project.read(NB)), '# Python basics, one cell at a time')
    assert.ok(s.errors.some((e) => /refused a cross-project notebook write/.test(e) && e.includes(a.id) && e.includes(b.id)), JSON.stringify(s.errors))
    // A program's file write-back from A's session is refused the same way.
    stale['session']['host'].onFilesChanged({ written: [{ path: 'passed.csv', content: 'x' }], deleted: [] })
    await tick(5)
    assert.equal(s.project.read('passed.csv'), undefined)
    // The registry never hands A's document to B's tab: B gets its own, and A's is closed.
    const docB = s.render()!
    assert.notEqual(docB, stale)
    assert.equal(docB.owner, b.id)
    assert.ok(stale.closed)
    assert.ok(docA.closed)
  } finally {
    s.done()
  }
})

test('B1 the kernel runs a notebook in the workspace of the project it belongs to', async () => {
  const s = await shell()
  try {
    const a = await s.create('Data with pandas', PANDAS)
    const doc = s.render()!
    doc.runAll()
    await tick(30)
    assert.ok(s.kernel.runs.length > 0)
    assert.ok(s.kernel.runs.every((r) => r.workspace === a.id), JSON.stringify(s.kernel.runs))
    assert.ok(s.kernel.runs[0].files.includes('scores.csv'))
  } finally {
    s.done()
  }
})

test('B1 every path-taking registry call is scoped to its project', async () => {
  const s = await shell()
  try {
    const a = await s.create('Data with pandas', PANDAS)
    const docA = s.render()!
    // Another project's id never finds A's document, whatever the path.
    assert.equal(openNotebook('someone-else', NB), undefined)
    assert.equal(openNotebook(a.id, NB), docA)
    assert.equal(openNotebook(null, NB), undefined)
    // A content change reported for another project is not merged into A's document.
    const before = serializeNotebook(docA.get().model!)
    notebookFileChanged('someone-else', NB, serializeNotebook(createNotebook([newCell('code', 'foreign')])))
    assert.equal(serializeNotebook(docA.get().model!), before)
    // The debugger's reader asks by project too: another project's id parses the given text.
    assert.equal(notebookModel(a.id, NB, undefined), docA.get().model)
    assert.equal(notebookModel('someone-else', NB, undefined), null)
    // A reveal queued under one project is not delivered to another's notebook of that name.
    revealCell('someone-else', 'other.ipynb', 'x', 1)
    // closeNotebooksExcept keeps the attached project's open tabs, closes the rest.
    closeNotebooksExcept(a.id, new Set([NB]))
    assert.ok(!docA.closed)
    closeNotebooksExcept('someone-else', new Set([NB]))
    assert.ok(docA.closed)
  } finally {
    s.done()
  }
})
