import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import WebSocket from 'ws'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

const SECRET = 'test-secret'
const DOC_ID = '01ARZ3NDEKTSV4RRFFQ69SJGNK'

function makeEnv() {
  const env = loadEnv()
  env.DEV_SHARED_SECRET = SECRET
  env.RATE_LIMIT_MAX = 100000
  return env
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for ws message')), timeoutMs)
    ws.once('message', (raw) => {
      clearTimeout(timer)
      resolve(JSON.parse(String(raw)) as Record<string, unknown>)
    })
  })
}

describe('WS /v1/signal room access (§7.2)', () => {
  let app: FastifyInstance
  let repo: FakeRepo
  let base: string

  beforeEach(async () => {
    repo = new FakeRepo()
    // A persisted doc locked down to its owner: link access none, no ACL.
    repo.seed({
      id: DOC_ID,
      owner: `device:${SECRET}`,
      version: 1,
      s3Key: null,
      name: null,
      linkAccess: 'none',
      sizeBytes: 0,
      updatedAt: new Date(),
    })
    app = await buildApp({ env: makeEnv(), repo, storage: new FakeStorage() })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (typeof address === 'string' || !address) throw new Error('no address')
    base = `ws://127.0.0.1:${address.port}/v1/signal`
  })

  afterEach(async () => {
    await app.close()
  })

  it('denies subscribe on a persisted doc without viewer access; owner relays fine', async () => {
    const stranger = await connect(base) // anonymous, link_access none → no role
    const owner = await connect(`${base}?token=${SECRET}`)
    try {
      stranger.send(JSON.stringify({ type: 'subscribe', topics: [DOC_ID] }))
      expect(await nextMessage(stranger)).toEqual({ type: 'access-denied', topic: DOC_ID })

      owner.send(JSON.stringify({ type: 'subscribe', topics: [DOC_ID] }))
      owner.send(JSON.stringify({ type: 'publish', topic: DOC_ID, payload: 'hi' }))
      // Only the owner is in the room: it gets its own publish back, clients: 1.
      const relayed = await nextMessage(owner)
      expect(relayed).toMatchObject({ type: 'publish', topic: DOC_ID, payload: 'hi', clients: 1 })
    } finally {
      stranger.close()
      owner.close()
    }
  })

  it('publish to a topic the socket never subscribed to is dropped (finding H5)', async () => {
    const owner = await connect(`${base}?token=${SECRET}`)
    const stranger = await connect(base) // anonymous → denied on this private room
    try {
      owner.send(JSON.stringify({ type: 'subscribe', topics: [DOC_ID] }))
      // Flush the owner's subscribe with a ping/pong round-trip.
      owner.send(JSON.stringify({ type: 'ping' }))
      expect(await nextMessage(owner)).toEqual({ type: 'pong' })

      stranger.send(JSON.stringify({ type: 'subscribe', topics: [DOC_ID] }))
      expect(await nextMessage(stranger)).toEqual({ type: 'access-denied', topic: DOC_ID })

      // The denied stranger tries to inject SDP/ICE into the private room anyway.
      stranger.send(JSON.stringify({ type: 'publish', topic: DOC_ID, payload: 'evil-offer' }))

      // The owner must NOT receive it: its next message is its own pong, proving
      // the malicious publish was never fanned out.
      owner.send(JSON.stringify({ type: 'ping' }))
      expect(await nextMessage(owner)).toEqual({ type: 'pong' })
    } finally {
      owner.close()
      stranger.close()
    }
  })

  it('accepts a single-use signaling ticket (?ticket=) in place of ?token=', async () => {
    // Mint a ticket for the owner (dev bearer principal) over HTTP.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/signal-ticket',
      headers: { authorization: `Bearer ${SECRET}` },
    })
    expect(res.statusCode).toBe(201)
    const { ticket } = res.json() as { ticket: string }
    expect(ticket).toMatch(/^tkt_/)

    const ws = await connect(`${base}?ticket=${ticket}`)
    try {
      ws.send(JSON.stringify({ type: 'subscribe', topics: [DOC_ID] }))
      ws.send(JSON.stringify({ type: 'publish', topic: DOC_ID, payload: 'ok' }))
      // The ticket authenticated the socket as the owner → subscribe allowed, so
      // the publish is relayed back to it (clients: 1).
      expect(await nextMessage(ws)).toMatchObject({ type: 'publish', topic: DOC_ID, payload: 'ok', clients: 1 })
    } finally {
      ws.close()
    }
  })

  it('rooms with no persisted doc stay open to anonymous sockets (pre-first-PUT P2P)', async () => {
    const UNPERSISTED = '01ARZ3NDEKTSV4RRFFQ69FRESH'
    const a = await connect(base)
    const b = await connect(base)
    try {
      a.send(JSON.stringify({ type: 'subscribe', topics: [UNPERSISTED] }))
      b.send(JSON.stringify({ type: 'subscribe', topics: [UNPERSISTED] }))
      // ping/pong round-trip on b so its subscribe is definitely processed.
      b.send(JSON.stringify({ type: 'ping' }))
      expect(await nextMessage(b)).toEqual({ type: 'pong' })

      a.send(JSON.stringify({ type: 'publish', topic: UNPERSISTED, payload: 42 }))
      expect(await nextMessage(b)).toMatchObject({ type: 'publish', topic: UNPERSISTED, payload: 42 })
    } finally {
      a.close()
      b.close()
    }
  })
})
