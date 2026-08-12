import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

/**
 * Tests for the live Yjs sync relay (WS /v1/sync) that replaced the y-webrtc
 * signaling relay. The load-bearing property is the ★ write-block: a viewer socket
 * may read and relay cursors, but its document updates never merge or fan out.
 */

const SECRET = 'test-secret'
const DOC_ID = '01ARZ3NDEKTSV4RRFFQ69SJGNK'
const UNPERSISTED = '01ARZ3NDEKTSV4RRFFQ69FRESH'

const messageSync = 0

function makeEnv() {
  const env = loadEnv()
  env.DEV_SHARED_SECRET = SECRET
  env.RATE_LIMIT_MAX = 100000
  // Shrink the durable snapshot cap so the live room-doc ceiling (2×) is small
  // enough to breach with a handful of frames — the size-ceiling test would
  // otherwise have to stream tens of MB. Harmless for the tiny-frame tests.
  env.MAX_SNAPSHOT_BYTES = 64 * 1024
  return env
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

/** A local doc that mirrors everything the socket applies, so a test can assert
 *  on the shared state as this peer sees it. */
class Peer {
  readonly doc = new Y.Doc()
  constructor(readonly ws: WebSocket) {
    ws.on('message', (raw: ArrayBuffer) => this.onMessage(raw))
  }

  private onMessage(raw: ArrayBuffer): void {
    const decoder = decoding.createDecoder(new Uint8Array(raw))
    const messageType = decoding.readVarUint(decoder)
    if (messageType !== messageSync) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    // Applies SyncStep2 / update to this peer's doc; a SyncStep1 would write a reply
    // into `encoder` which we deliberately ignore (the test drives sync explicitly).
    syncProtocol.readSyncMessage(decoder, encoder, this.doc, this)
  }

  /** Encode + send a document update (an editor edit) to the server, and apply it
   *  locally too — a real client's edit originates in its own doc; the server never
   *  echoes an author's own update back, so this is how the author's mirror reflects
   *  it. A viewer optimistically shows its own (server-dropped) edit the same way. */
  sendUpdate(mutate: (doc: Y.Doc) => void): void {
    const scratch = new Y.Doc()
    mutate(scratch)
    const update = Y.encodeStateAsUpdate(scratch)
    Y.applyUpdate(this.doc, update)
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, messageSync)
    syncProtocol.writeUpdate(enc, update)
    this.ws.send(encoding.toUint8Array(enc))
    scratch.destroy()
  }

  /** Ask the server for its state (SyncStep1) and resolve when the reply lands. Also
   *  a synchronization barrier: the reply proves the server drained this socket's
   *  earlier frames, and per-connection FIFO means any earlier server->peer frame
   *  arrived first. */
  requestState(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.off('message', onMsg)
        reject(new Error('timed out waiting for sync reply'))
      }, timeoutMs)
      const onMsg = (raw: ArrayBuffer): void => {
        const decoder = decoding.createDecoder(new Uint8Array(raw))
        if (decoding.readVarUint(decoder) !== messageSync) return
        clearTimeout(timer)
        this.ws.off('message', onMsg)
        resolve()
      }
      this.ws.on('message', onMsg)
      const enc = encoding.createEncoder()
      encoding.writeVarUint(enc, messageSync)
      syncProtocol.writeSyncStep1(enc, this.doc)
      this.ws.send(encoding.toUint8Array(enc))
    })
  }

  text(): string {
    return this.doc.getText('t').toString()
  }

  destroy(): void {
    this.ws.close()
    this.doc.destroy()
  }
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('WS /v1/sync live relay + write-block (§7.2)', () => {
  let app: FastifyInstance
  let repo: FakeRepo
  let base: string

  beforeEach(async () => {
    repo = new FakeRepo()
    // A persisted doc whose LINK access is viewer: anyone with the link may read
    // (connect), but only the owner may write.
    repo.seed({
      id: DOC_ID,
      owner: `device:${SECRET}`,
      version: 1,
      s3Key: null,
      name: null,
      linkAccess: 'viewer',
      sizeBytes: 0,
      updatedAt: new Date(),
    })
    app = await buildApp({ env: makeEnv(), repo, storage: new FakeStorage() })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (typeof address === 'string' || !address) throw new Error('no address')
    base = `ws://127.0.0.1:${address.port}/v1/sync`
  })

  afterEach(async () => {
    await app.close()
  })

  it('requires viewer+ to connect to a persisted doc; a stranger with no role is dropped', async () => {
    // linkAccess is viewer, so an anonymous socket DOES get viewer and may connect.
    // Make the doc private (link none) to prove the connect gate rejects no-role.
    await repo.updateDocMeta(DOC_ID, { linkAccess: 'none' })
    const stranger = await connect(`${base}/${DOC_ID}`)
    const closed = new Promise<number>((resolve) => stranger.on('close', (code) => resolve(code)))
    expect(await closed).toBe(1008)
  })

  it('closes a RESOLVED-but-unauthorized socket with a terminal code (no reconnect loop)', async () => {
    // Doc private to its owner (link none). A DIFFERENT authenticated device
    // resolves to a real principal that still earns no role → PERMANENT deny:
    // re-minting a ticket resolves the same principal, so reconnecting can't help.
    await repo.updateDocMeta(DOC_ID, { linkAccess: 'none' })
    await repo.createDevice('other-device')
    const ws = await connect(`${base}/${DOC_ID}?token=other-device`)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    // 4403 sits in y-websocket's 4400-4499 "do not reconnect" range — unlike the
    // retriable 1008 an anonymous (re-mintable) socket still gets — so the client
    // stops hammering instead of spinning an infinite reconnect loop.
    expect(await closed).toBe(4403)
  })

  it('closes a writer with a terminal code once the room doc exceeds the size ceiling', async () => {
    // An unpersisted room is writable by anyone; stream distinct large updates to
    // grow its ephemeral doc. With MAX_SNAPSHOT_BYTES shrunk in the test env, the
    // 2× ceiling is breached after a few frames and the offending socket is closed
    // with the terminal 4413 rather than the doc growing without bound.
    const ws = await connect(`${base}/${UNPERSISTED}?token=${SECRET}`)
    const editor = new Peer(ws)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    try {
      const chunk = 'x'.repeat(40 * 1024)
      for (let i = 0; i < 40; i++) {
        if (ws.readyState !== WebSocket.OPEN) break
        try {
          editor.sendUpdate((d) => d.getText('t').insert(0, `${i}:${chunk}`))
        } catch {
          break // socket closed mid-flight
        }
        await new Promise((r) => setTimeout(r, 5))
      }
      expect(await closed).toBe(4413)
    } finally {
      editor.destroy()
    }
  })

  it('editor (owner) write reaches a second (viewer) socket', async () => {
    const editor = new Peer(await connect(`${base}/${DOC_ID}?token=${SECRET}`))
    const viewer = new Peer(await connect(`${base}/${DOC_ID}`)) // anon → viewer via linkAccess
    try {
      // The editor edits AFTER the viewer joined, so the server relays the update live.
      editor.sendUpdate((d) => d.getText('t').insert(0, 'hello'))
      await waitFor(() => viewer.text() === 'hello')
      expect(viewer.text()).toBe('hello')
    } finally {
      editor.destroy()
      viewer.destroy()
    }
  })

  it('★ viewer write does NOT reach the room doc or a second socket', async () => {
    const editor = new Peer(await connect(`${base}/${DOC_ID}?token=${SECRET}`))
    const viewer = new Peer(await connect(`${base}/${DOC_ID}`)) // anon → viewer
    try {
      // The viewer (read-only link holder) tries to inject an edit.
      viewer.sendUpdate((d) => d.getText('t').insert(0, 'evil'))
      // Barrier 1: the server has drained the viewer's frames (evil dropped).
      await viewer.requestState()
      // Barrier 2: any (hypothetical) fan-out to the editor arrived before this reply
      // (per-connection FIFO). If the write had NOT been blocked, 'evil' would now be
      // in the editor's doc.
      await editor.requestState()
      expect(editor.text()).toBe('')

      // And the room doc itself is unpolluted: a fresh writer edit merges cleanly on
      // top of an empty doc, and the editor never observes 'evil'.
      editor.sendUpdate((d) => d.getText('t').insert(0, 'ok'))
      await waitFor(() => editor.text() === 'ok')
      expect(editor.text()).toBe('ok')
    } finally {
      editor.destroy()
      viewer.destroy()
    }
  })

  it('accepts a single-use ticket (?ticket=) in place of ?token=', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/signal-ticket',
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(res.statusCode).toBe(201)
    const { ticket } = res.json() as { ticket: string }

    // Make the doc private so only an authenticated owner may connect: the ticket
    // must be what authorizes this socket.
    await repo.updateDocMeta(DOC_ID, { linkAccess: 'none' })
    const owner = new Peer(await connect(`${base}/${DOC_ID}?ticket=${ticket}`))
    const guest = new Peer(await connect(`${base}/${DOC_ID}?token=${SECRET}`))
    try {
      owner.sendUpdate((d) => d.getText('t').insert(0, 'via-ticket'))
      await waitFor(() => guest.text() === 'via-ticket')
      expect(guest.text()).toBe('via-ticket')
    } finally {
      owner.destroy()
      guest.destroy()
    }
  })

  it('rejects a non-ULID room', async () => {
    const ws = await connect(`${base}/not-a-ulid`)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    expect(await closed).toBe(1008)
  })

  it('an unpersisted room is open to anyone and relays writes', async () => {
    const a = new Peer(await connect(`${base}/${UNPERSISTED}`))
    const b = new Peer(await connect(`${base}/${UNPERSISTED}`))
    try {
      a.sendUpdate((d) => d.getText('t').insert(0, 'p2p'))
      await waitFor(() => b.text() === 'p2p')
      expect(b.text()).toBe('p2p')
    } finally {
      a.destroy()
      b.destroy()
    }
  })

  it('evicts a room when the last connection closes (no leak / no stale state)', async () => {
    // First occupant writes into the ephemeral room doc.
    const first = new Peer(await connect(`${base}/${UNPERSISTED}`))
    first.sendUpdate((d) => d.getText('t').insert(0, 'ephemeral'))
    // A peer that joins while `first` is connected sees the state (room is alive).
    const second = new Peer(await connect(`${base}/${UNPERSISTED}`))
    await second.requestState()
    await waitFor(() => second.text() === 'ephemeral')
    expect(second.text()).toBe('ephemeral')

    // Everyone leaves → the room must be evicted (doc destroyed, map entry gone).
    const firstClosed = new Promise((r) => first.ws.on('close', r))
    const secondClosed = new Promise((r) => second.ws.on('close', r))
    first.destroy()
    second.destroy()
    await Promise.all([firstClosed, secondClosed])

    // A fresh join to the SAME room gets a brand-new empty doc — proof the prior
    // room (and its 'ephemeral' state) was evicted rather than lingering in memory.
    const reborn = new Peer(await connect(`${base}/${UNPERSISTED}`))
    try {
      await reborn.requestState()
      // Give any (erroneously retained) state a chance to arrive, then assert empty.
      await new Promise((r) => setTimeout(r, 100))
      expect(reborn.text()).toBe('')
    } finally {
      reborn.destroy()
    }
  })
})
