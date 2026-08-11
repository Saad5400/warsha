/**
 * ProjectBridge — the echo-guarded Y.Doc ↔ Project materializer. Uses a real
 * `Project` on its default in-memory store. `Project.setContent` debounces via
 * `window.setTimeout`, so give the harness a `window`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).window ??= globalThis

import { Project } from '../../src/fs/project.ts'
import { MemoryStore } from '../../src/fs/opfs.ts'
import { ProjectBridge } from '../../src/collab/materialize.ts'
import { filesMap, ydCreateFile } from '../../src/collab/doc.ts'

const tick = () => new Promise((r) => setTimeout(r, 0))

test('a remote Y.Doc file add materializes into Project (no echo/duplication)', async () => {
  const doc = new Y.Doc()
  const project = new Project()
  const bridge = new ProjectBridge(doc, project)

  // Simulate a remote update arriving (as a provider would apply it).
  const remote = new Y.Doc()
  ydCreateFile(remote, 'main.py', 'print(1)\n')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))
  await tick()

  assert.equal(project.read('main.py'), 'print(1)\n')
  // Exactly one file each side — the guard prevented a re-mirror loop.
  assert.equal([...filesMap(doc).keys()].length, 1)
  assert.deepEqual(project.paths(), ['main.py'])
  bridge.destroy()
})

test('a local Project.createFile mirrors into the Y.Doc', async () => {
  const doc = new Y.Doc()
  const project = new Project()
  const bridge = new ProjectBridge(doc, project)

  await project.createFile('a.txt', 'hi')
  await tick()

  const files = filesMap(doc)
  assert.ok(files.has('a.txt'))
  assert.equal(files.get('a.txt')!.toString(), 'hi')
  assert.equal([...files.keys()].length, 1) // not duplicated by the echo
  bridge.destroy()
})

test('a remote content edit reaches Project', async () => {
  const doc = new Y.Doc()
  const project = new Project()
  const bridge = new ProjectBridge(doc, project)

  ydCreateFile(doc, 'x.txt', 'abc')
  await tick()
  assert.equal(project.read('x.txt'), 'abc')

  const remote = new Y.Doc()
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
  filesMap(remote).get('x.txt')!.insert(3, 'DEF')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))
  await tick()

  assert.equal(project.read('x.txt'), 'abcDEF')
  bridge.destroy()
})

test('a remote delete removes the file from Project', async () => {
  const doc = new Y.Doc()
  const project = new Project()
  const bridge = new ProjectBridge(doc, project)
  ydCreateFile(doc, 'gone.txt', 'x')
  await tick()
  assert.ok(project.has('gone.txt'))

  const remote = new Y.Doc()
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
  filesMap(remote).delete('gone.txt')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))
  await tick()

  assert.ok(!project.has('gone.txt'))
  bridge.destroy()
})

// ---- the project-epoch gate (the P0 room-wipe bug) --------------------------
// A project switch during a live session re-points the shared `Project` at a
// DIFFERENT project's store. The bridge must go inert in BOTH directions: never
// diff the new project's files into the room doc (which uploaded strangers and
// ydRemove'd every real room file), and never materialize the room into the new
// project's OPFS.

test('switching the Project to another store gates the bridge — the room doc survives', async () => {
  const project = new Project()
  await project.createFile('main.py', 'print("mine")')

  const doc = new Y.Doc()
  ydCreateFile(doc, 'main.py', 'print("mine")')
  ydCreateFile(doc, 'shared.py', 'print("room")')
  const bridge = new ProjectBridge(doc, project)
  await tick()
  assert.ok(project.has('shared.py'), 'sanity: the room materialized while the bridge was live')

  // The student switches projects: the new store holds an unrelated file set.
  const other = new MemoryStore()
  await other.writeFile('unrelated.txt', 'not part of the room')
  await project.switchStore(other) // emits the NEW project's structure synchronously

  // The room doc is untouched: nothing removed, nothing foreign uploaded.
  const files = filesMap(doc)
  assert.deepEqual([...files.keys()].sort(), ['main.py', 'shared.py'])
  assert.equal(files.get('shared.py')!.toString(), 'print("room")')
  assert.ok(!files.has('unrelated.txt'), 'the new project must not leak into the room')

  // And the reverse direction is dead too: a remote edit no longer writes into
  // the (wrong) project now attached.
  const remote = new Y.Doc()
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc))
  ydCreateFile(remote, 'late.py', 'arrived after the switch')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))
  await tick()
  assert.ok(!project.has('late.py'), 'a stale bridge must not materialize into the new project')
  bridge.destroy()
})

// ---- the mirror gate (the host-reload / join clobber race) ------------------
// A joining doc arrives async; until it has, the doc's file set is partial and a
// Project→doc diff would mint fresh Y.Texts that clobber the real ones in flight.

test('mirror off: pre-sync structure events do not upload; enableMirror reconciles once', async () => {
  const project = new Project()
  await project.createFile('local.py', 'x = 1')
  const doc = new Y.Doc()
  const bridge = new ProjectBridge(doc, project, { mirror: false })

  // Structure changes during the pre-sync window must NOT reach the doc.
  await project.createFile('during-window.py', 'y = 2')
  await tick()
  assert.equal([...filesMap(doc).keys()].length, 0, 'nothing uploads before the initial sync')

  // The real doc state lands (as a provider would apply it)…
  const remote = new Y.Doc()
  ydCreateFile(remote, 'main.py', 'print(1)')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote))
  await tick()
  assert.equal(project.read('main.py'), 'print(1)', 'materialize direction still works while gated')

  // …then the session opens the mirror: one reconciliation pass picks up the
  // local files made during the window, without touching the synced one.
  bridge.enableMirror()
  await tick()
  const keys = [...filesMap(doc).keys()].sort()
  assert.deepEqual(keys, ['during-window.py', 'local.py', 'main.py'])
  assert.equal(filesMap(doc).get('main.py')!.toString(), 'print(1)')
  bridge.destroy()
})
