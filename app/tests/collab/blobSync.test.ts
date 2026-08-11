/**
 * BlobSyncProvider — the compare-and-swap / 409-retry path (contract §5.3),
 * against an in-memory mock of the dumb blob store. No network, no DOM.
 * Also covers the push-hygiene rules: origin-gated pushes, no-op-409
 * quiescence, terminal 401/413 handling, and the client-side size cap.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { BlobSyncProvider, type SyncStatus } from '../../src/collab/blobSync.ts'
import type { WarshaApi, DocPutResult } from '../../src/collab/api.ts'

/** A CAS blob store exactly like the server contract: If-Match or 409. */
function mockStore() {
  let version = 0
  let bytes: Uint8Array = new Uint8Array()
  let puts = 0
  const api: WarshaApi = {
    baseUrl: 'mock',
    async getDoc(id) {
      if (version === 0) return { error: 'not-found' as const }
      return { id, version, blob: bytes.length ? bytes : null }
    },
    async putDoc(_id, ifMatch, next): Promise<DocPutResult> {
      puts++
      if (ifMatch === version) {
        version += 1
        bytes = next
        return { ok: true, version }
      }
      return { ok: false, conflict: true, version, blob: bytes.length ? bytes : null }
    },
    async createDoc() {
      return { id: 'mock', version: 0 }
    },
    async getIce() {
      return null
    },
    signalingUrl() {
      return 'ws://mock/v1/signal'
    },
    async health() {
      return true
    },
  }
  return { api, state: () => ({ version, bytes }), puts: () => puts }
}

const set = (doc: Y.Doc, key: string, value: string) => {
  doc.getMap<string>('m').set(key, value)
}

test('flush persists the current snapshot via CAS', async () => {
  const { api, state } = mockStore()
  const doc = new Y.Doc()
  const p = new BlobSyncProvider('doc1', doc, api, { debounceMs: 5 })
  await p.whenSynced

  set(doc, 'a', '1')
  await p.flush()

  assert.equal(state().version, 1)
  // A fresh reader gets the change back.
  const reader = new Y.Doc()
  Y.applyUpdate(reader, state().bytes)
  assert.equal(reader.getMap('m').get('a'), '1')
  p.destroy()
})

test('a 409 is merged (applyUpdate) and the PUT retried to success', async () => {
  const { api, state } = mockStore()

  // Provider P is at version 0 and makes an edit.
  const docP = new Y.Doc()
  const p = new BlobSyncProvider('doc1', docP, api, { debounceMs: 1000 })
  await p.whenSynced
  set(docP, 'p', 'from-P')

  // Meanwhile a second writer Q lands a different edit first, bumping the server
  // to version 1 — so P's next PUT (If-Match: 0) will 409.
  const docQ = new Y.Doc()
  set(docQ, 'q', 'from-Q')
  const put = await api.putDoc('doc1', 0, Y.encodeStateAsUpdate(docQ))
  assert.equal(put.ok, true)
  assert.equal(state().version, 1)

  // P flushes: expect 409 → applyUpdate(Q) → retry with If-Match:1 → 200.
  await p.flush()

  assert.equal(state().version, 2)
  // P merged Q's change in.
  assert.equal(docP.getMap('m').get('q'), 'from-Q')
  assert.equal(docP.getMap('m').get('p'), 'from-P')
  // The final server state carries BOTH edits.
  const reader = new Y.Doc()
  Y.applyUpdate(reader, state().bytes)
  assert.equal(reader.getMap('m').get('p'), 'from-P')
  assert.equal(reader.getMap('m').get('q'), 'from-Q')
  p.destroy()
})

test('a non-conflict network error keeps the change pending, not dropped', async () => {
  let calls = 0
  const api: WarshaApi = {
    baseUrl: 'mock',
    async getDoc() {
      return { error: 'network' as const }
    },
    async putDoc(): Promise<DocPutResult> {
      calls++
      return { ok: false, conflict: false, status: 0 } // offline
    },
    async createDoc() {
      return null
    },
    async getIce() {
      return null
    },
    signalingUrl() {
      return 'ws://mock/v1/signal'
    },
    async health() {
      return false
    },
  }
  const doc = new Y.Doc()
  const p = new BlobSyncProvider('doc1', doc, api, { debounceMs: 5 })
  await p.whenSynced
  set(doc, 'a', '1')
  await p.flush()
  assert.equal(calls, 1)
  // Still dirty → a later flush retries rather than silently losing the edit.
  await p.flush()
  assert.equal(calls, 2)
  p.destroy()
})

test('remote-origin updates (webrtc/indexeddb siblings) do NOT schedule a push', async () => {
  const { api, puts } = mockStore()
  const doc = new Y.Doc()
  const p = new BlobSyncProvider('doc1', doc, api, { debounceMs: 5 })
  await p.whenSynced

  // Simulate a y-webrtc-style provider applying a remote peer's update.
  const fakeWebrtcRoom = { name: 'room' }
  p.remoteOrigins.add(fakeWebrtcRoom)
  const remote = new Y.Doc()
  set(remote, 'r', 'from-peer')
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), fakeWebrtcRoom)

  await p.flush()
  assert.equal(puts(), 0, 'a remote update must not be re-pushed (the PUT storm)')

  // A genuinely local change still pushes — and carries the merged remote state.
  set(doc, 'l', 'local')
  await p.flush()
  assert.equal(puts(), 1)
  p.destroy()
})

test('a no-op 409 (server already superset) adopts the version and goes quiescent', async () => {
  const { api, state, puts } = mockStore()
  const docP = new Y.Doc()
  const p = new BlobSyncProvider('doc1', docP, api, { debounceMs: 100000 })
  await p.whenSynced
  set(docP, 'p', 'x') // local edit → dirty

  // Another tab already pushed a SUPERSET of P's state (P's edit + its own).
  const docQ = new Y.Doc()
  Y.applyUpdate(docQ, Y.encodeStateAsUpdate(docP))
  set(docQ, 'q', 'y')
  await api.putDoc('doc1', 0, Y.encodeStateAsUpdate(docQ))
  const putsBefore = puts()
  const versionBefore = state().version

  // P's flush 409s; the returned blob contains everything P has → adopt, don't retry.
  await p.flush()
  assert.equal(puts(), putsBefore + 1, 'exactly one PUT — no retry after a no-op conflict')
  assert.equal(state().version, versionBefore, 'no version burned (that was the 409 ping-pong)')
  assert.equal(docP.getMap('m').get('q'), 'y', 'server state merged in')

  // Quiescent: nothing pending, nothing pushed.
  await p.flush()
  assert.equal(puts(), putsBefore + 1)
  p.destroy()
})

test('401 is terminal: one PUT, then the provider stops pushing entirely', async () => {
  let calls = 0
  const statuses: SyncStatus[] = []
  const api: WarshaApi = {
    baseUrl: 'mock',
    async getDoc() {
      return { error: 'not-found' as const }
    },
    async putDoc(): Promise<DocPutResult> {
      calls++
      return { ok: false, conflict: false, status: 401 }
    },
    async createDoc() {
      return null
    },
    async getIce() {
      return null
    },
    signalingUrl() {
      return 'ws://mock/v1/signal'
    },
    async health() {
      return true
    },
  }
  const doc = new Y.Doc()
  const p = new BlobSyncProvider('doc1', doc, api, { debounceMs: 5, onStatus: (s) => statuses.push(s) })
  await p.whenSynced
  set(doc, 'a', '1')
  await p.flush()
  assert.equal(calls, 1)
  assert.ok(statuses.includes('auth'), 'the failure is surfaced, not silent')

  // Later edits neither schedule nor flush — the token will not heal mid-session.
  set(doc, 'b', '2')
  await p.flush()
  assert.equal(calls, 1)
  p.destroy()
})

test('client-side size cap: an oversized doc never PUTs, surfaces too-large', async () => {
  const { api, puts } = mockStore()
  const statuses: SyncStatus[] = []
  const doc = new Y.Doc()
  const p = new BlobSyncProvider('doc1', doc, api, {
    debounceMs: 5,
    maxBytes: 32, // tiny cap for the test; real default is the contract's 5 MB
    onStatus: (s) => statuses.push(s),
  })
  await p.whenSynced
  set(doc, 'big', 'x'.repeat(1024))
  await p.flush()
  assert.equal(puts(), 0, 'over-cap must not enter a 413 loop')
  assert.ok(statuses.includes('too-large'))

  // Parked, not spinning: a second flush with nothing new stays quiet.
  await p.flush()
  assert.equal(puts(), 0)
  p.destroy()
})

test('a server 413 parks the push the same way (no retry loop)', async () => {
  let calls = 0
  const statuses: SyncStatus[] = []
  const api: WarshaApi = {
    baseUrl: 'mock',
    async getDoc() {
      return { error: 'not-found' as const }
    },
    async putDoc(): Promise<DocPutResult> {
      calls++
      return { ok: false, conflict: false, status: 413 }
    },
    async createDoc() {
      return null
    },
    async getIce() {
      return null
    },
    signalingUrl() {
      return 'ws://mock/v1/signal'
    },
    async health() {
      return true
    },
  }
  const doc = new Y.Doc()
  const p = new BlobSyncProvider('doc1', doc, api, { debounceMs: 5, onStatus: (s) => statuses.push(s) })
  await p.whenSynced
  set(doc, 'a', '1')
  await p.flush()
  assert.equal(calls, 1)
  assert.ok(statuses.includes('too-large'))
  await p.flush()
  assert.equal(calls, 1, 'parked — no infinite 413 retries')
  p.destroy()
})

test('a seeded doc is pushed even if nobody ever types (host walks away)', async () => {
  const { api, state } = mockStore()
  const doc = new Y.Doc()
  set(doc, 'seed', 'content') // seeded BEFORE the provider attaches
  const p = new BlobSyncProvider('doc1', doc, api, { debounceMs: 5, skipInitialFetch: true })
  // No local edit at all — the constructor-time dirty flag must flush the seed.
  await new Promise((r) => setTimeout(r, 30))
  await p.flush()
  assert.equal(state().version, 1, 'the seed reached the store without a keystroke')
  const reader = new Y.Doc()
  Y.applyUpdate(reader, state().bytes)
  assert.equal(reader.getMap('m').get('seed'), 'content')
  p.destroy()
})
