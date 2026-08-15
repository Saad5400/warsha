/**
 * HeadlessSync — the Phase-C headless durable engine (seedOnce backfill + the
 * persistent open-project engine). Against an in-memory CAS mock of the dumb blob
 * store; no network, no DOM. `Project.setContent` debounces via `window.setTimeout`,
 * so the harness needs a `window` (as materialize.test.ts does). IndexedDB is absent
 * in node — HeadlessSync's `tryIdb` swallows the construction throw and durable S3
 * sync runs on its own, which is exactly what these tests exercise.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).window ??= globalThis

import { Project } from '../../src/fs/project.ts'
import { MemoryStore } from '../../src/fs/opfs.ts'
import { HeadlessSync, seedOnce, materializeCloudDoc } from '../../src/collab/headlessSync.ts'
import type { WarshaApi, DocPutResult } from '../../src/collab/api.ts'
import type { FsSnapshot } from '../../src/fs/types.ts'

const tick = () => new Promise((r) => setTimeout(r, 0))

/** A CAS blob store exactly like the server contract: If-Match or 409. */
function mockStore() {
  let version = 0
  let bytes: Uint8Array = new Uint8Array()
  let puts = 0
  const api = {
    baseUrl: 'mock',
    async getDoc(id: string) {
      if (version === 0) return { error: 'not-found' as const }
      return { id, version, blob: bytes.length ? bytes : null }
    },
    async putDoc(_id: string, ifMatch: number, next: Uint8Array): Promise<DocPutResult> {
      puts++
      if (ifMatch === version) {
        version += 1
        bytes = next
        return { ok: true, version }
      }
      return { ok: false, conflict: true, version, blob: bytes.length ? bytes : null }
    },
  } as unknown as WarshaApi
  return { api, state: () => ({ version, bytes }), puts: () => puts }
}

/** A store that rejects every PUT with a given non-conflict status (+optional quota). */
function rejectingStore(status: number, quota?: true) {
  let puts = 0
  const api = {
    baseUrl: 'mock',
    async getDoc() {
      return { error: 'not-found' as const }
    },
    async putDoc(): Promise<DocPutResult> {
      puts++
      return quota
        ? { ok: false, conflict: false, status, quota: true }
        : { ok: false, conflict: false, status }
    },
  } as unknown as WarshaApi
  return { api, puts: () => puts }
}

const snap = (files: Record<string, string>): FsSnapshot => ({
  files: Object.entries(files).map(([path, content]) => ({ path, content })),
  dirs: [],
})

test('seedOnce seeds a fresh doc, pushes it once via CAS, and reports ok', async () => {
  const { api, state, puts } = mockStore()
  const res = await seedOnce('DOC0000000000000000000001', snap({ 'main.py': 'print(1)\n' }), api)

  assert.equal(res.status, 'ok')
  assert.equal(state().version, 1, 'the seed reached the store (If-Match:0 create)')
  assert.equal(puts(), 1, 'exactly one push for a one-shot seed')

  // The pushed blob round-trips back to the same files (what a cross-device open GETs).
  const back = await materializeCloudDoc('DOC0000000000000000000001', api)
  assert.deepEqual(back, { files: [{ path: 'main.py', content: 'print(1)\n' }], dirs: [] })
})

test('seedOnce surfaces a quota 403 as {status:"quota"} — the manager stops backfill', async () => {
  const { api, puts } = rejectingStore(403, true)
  const res = await seedOnce('DOC0000000000000000000002', snap({ 'a.txt': 'x' }), api)
  assert.equal(res.status, 'quota')
  assert.equal(puts(), 1, 'one attempt, parked — no 403 retry loop')
})

test('seedOnce surfaces an over-cap as {status:"too-large"} — the manager skips it', async () => {
  // A server 413 (belt to the client-cap braces) parks and reports too-large.
  const { api } = rejectingStore(413)
  const res = await seedOnce('DOC0000000000000000000003', snap({ 'big.txt': 'y'.repeat(64) }), api)
  assert.equal(res.status, 'too-large')
})

test('attach: local Project edits reach the durable store (binding-less content bridge)', async () => {
  const { api, state } = mockStore()
  const project = new Project()
  await project.createFile('main.py', 'print("hello")')

  const engine = new HeadlessSync('DOC0000000000000000000010', project, api, { fresh: false })
  await tick()
  // A later edit — the content bridge is Project→Y.Doc via a debounced snapshot; flush
  // lands it immediately rather than waiting out the debounce.
  await project.createFile('util.py', 'x = 1')
  project.setContent('main.py', 'print("world")')
  await engine.flush()

  assert.ok(state().version >= 1, 'the project was pushed to the store')
  const back = await materializeCloudDoc('DOC0000000000000000000010', api)
  assert.ok(back)
  const byPath = Object.fromEntries(back!.files.map((f) => [f.path, f.content]))
  assert.equal(byPath['main.py'], 'print("world")')
  assert.equal(byPath['util.py'], 'x = 1')
  engine.destroy()
})

test('single-engine invariant mechanism: after flush+destroy the engine stops pushing', async () => {
  // The manager destroys the headless engine BEFORE a CollabSession starts on the same
  // docId, so the session is the sole writer. Proof of the mechanism: once destroyed, a
  // further local edit + flush pushes NOTHING more from the (torn-down) headless engine.
  const { api, state } = mockStore()
  const project = new Project()
  await project.createFile('main.py', 'v1')

  const engine = new HeadlessSync('DOC0000000000000000000020', project, api, { fresh: false })
  await tick()
  await engine.flush()
  const versionAtHandover = state().version
  assert.ok(versionAtHandover >= 1)

  engine.destroy()

  // Simulate the edits a following CollabSession would own — the dead engine must not push.
  project.setContent('main.py', 'v2-owned-by-session')
  await engine.flush() // no-op: destroyed
  await tick()
  assert.equal(state().version, versionAtHandover, 'a destroyed engine pushes nothing further')
})

test('attach honors the store-epoch gate: a switched-away Project is not diffed into the doc', async () => {
  const { api, state } = mockStore()
  const project = new Project()
  await project.createFile('room.py', 'print("room")')

  const engine = new HeadlessSync('DOC0000000000000000000030', project, api, { fresh: false })
  await tick()
  await engine.flush()
  const versionBefore = state().version

  // The app switches this Project to an UNRELATED store (a different project). The
  // engine's content bridge must go inert — never diff the new files into this doc.
  const other = new MemoryStore()
  await other.writeFile('unrelated.txt', 'not part of the room')
  await project.switchStore(other)

  await engine.flush() // stale (epoch bumped) → the snapshot step is skipped
  await tick()
  const back = await materializeCloudDoc('DOC0000000000000000000030', api)
  assert.ok(back)
  assert.deepEqual(
    back!.files.map((f) => f.path),
    ['room.py'],
    'the unrelated project must not leak into the room doc after a switch',
  )
  assert.ok(state().version >= versionBefore)
  engine.destroy()
})
