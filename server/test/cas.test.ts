import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

const SECRET = 'test-secret'
const DOC_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const AUTH = { authorization: `Bearer ${SECRET}` }
// The doc starts committed at version 3 with this object holding its bytes.
const SEED_KEY = `docs/${DOC_ID}/3-seed.ydoc`
const SEED_BYTES = Buffer.from([1, 2, 3])

function makeEnv() {
  const env = loadEnv()
  env.DEV_SHARED_SECRET = SECRET
  env.MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024
  env.RATE_LIMIT_MAX = 100000 // don't let the limiter interfere with the test
  return env
}

function putReq(app: FastifyInstance, ifMatch: string, payload: Buffer, id = DOC_ID) {
  return app.inject({
    method: 'PUT',
    url: `/v1/docs/${id}`,
    headers: { ...AUTH, 'content-type': 'application/octet-stream', 'if-match': ifMatch },
    payload,
  })
}

describe('PUT /v1/docs/:id compare-and-swap', () => {
  let app: FastifyInstance
  let repo: FakeRepo
  let storage: FakeStorage

  beforeEach(async () => {
    repo = new FakeRepo()
    storage = new FakeStorage()
    repo.seed({
      id: DOC_ID,
      owner: `device:${SECRET}`,
      version: 3,
      s3Key: SEED_KEY,
      name: 'demo',
      linkAccess: 'editor',
      sizeBytes: SEED_BYTES.byteLength,
      updatedAt: new Date(),
    })
    await storage.put(SEED_KEY, new Uint8Array(SEED_BYTES))

    app = await buildApp({ env: makeEnv(), repo, storage })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('matching If-Match writes the blob under a fresh key and bumps the version', async () => {
    const body = Buffer.from([9, 8, 7, 6])
    const res = await putReq(app, '3', body)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: 4 })

    // Row now points at a NEW object (not the fixed/previous key) holding our exact bytes.
    const doc = await repo.getDoc(DOC_ID)
    expect(doc?.version).toBe(4)
    expect(doc?.s3Key).not.toBe(SEED_KEY)
    const committed = await storage.get(doc!.s3Key!)
    expect(Buffer.from(committed!).equals(body)).toBe(true)

    // Previous version's object was GC'd — exactly the committed object remains.
    expect(await storage.get(SEED_KEY)).toBeNull()
    expect(storage.keys()).toEqual([doc!.s3Key])
  })

  it('stale If-Match returns 409 with the current version and blob, writing nothing', async () => {
    const res = await putReq(app, '1', Buffer.from([4, 2]))

    expect(res.statusCode).toBe(409)
    const payload = res.json() as { version: number; blob: string }
    expect(payload.version).toBe(3) // current server version, not the stale 1
    expect(Buffer.from(payload.blob, 'base64').equals(SEED_BYTES)).toBe(true)

    // A stale write must not have touched storage at all.
    expect(storage.keys()).toEqual([SEED_KEY])
    expect(Buffer.from((await storage.get(SEED_KEY))!).equals(SEED_BYTES)).toBe(true)
  })

  it('two concurrent PUTs at the same base version yield exactly one 200 and one 409', async () => {
    const bufWinnerCandidateA = Buffer.from([10, 20, 30])
    const bufWinnerCandidateB = Buffer.from([40, 50, 60])

    const [resA, resB] = await Promise.all([
      putReq(app, '3', bufWinnerCandidateA),
      putReq(app, '3', bufWinnerCandidateB),
    ])

    // Exactly one commit, one conflict — regardless of interleaving.
    expect([resA.statusCode, resB.statusCode].sort()).toEqual([200, 409])

    const winnerRes = resA.statusCode === 200 ? resA : resB
    const loserRes = resA.statusCode === 200 ? resB : resA
    const winnerBytes = resA.statusCode === 200 ? bufWinnerCandidateA : bufWinnerCandidateB

    expect(winnerRes.json()).toEqual({ version: 4 })

    // The 409 reports the winner's committed state (version 4 + winner's bytes),
    // so the client can applyUpdate the correct blob and retry.
    const loserPayload = loserRes.json() as { version: number; blob: string }
    expect(loserPayload.version).toBe(4)
    expect(Buffer.from(loserPayload.blob, 'base64').equals(winnerBytes)).toBe(true)

    // The committed object at rest holds the WINNER's exact bytes — never the loser's.
    const doc = await repo.getDoc(DOC_ID)
    expect(doc?.version).toBe(4)
    const committed = await storage.get(doc!.s3Key!)
    expect(Buffer.from(committed!).equals(winnerBytes)).toBe(true)

    // Previous version + loser's orphan were both GC'd: only the winner's object remains.
    expect(storage.keys()).toEqual([doc!.s3Key])
  })

  it('create-on-first-PUT: If-Match:0 to a brand-new id creates it at version 1', async () => {
    const NEW_ID = '01ARZ3NDEKTSV4RRFFQ69NEW01'
    const body = Buffer.from([7, 7, 7, 42])

    const res = await putReq(app, '0', body, NEW_ID)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: 1 })

    // GET returns the just-created state and exact bytes.
    const get = await app.inject({
      method: 'GET',
      url: `/v1/docs/${NEW_ID}`,
      headers: AUTH,
    })
    expect(get.statusCode).toBe(200)
    const payload = get.json() as { id: string; version: number; name: string | null; blob: string }
    expect(payload.id).toBe(NEW_ID)
    expect(payload.version).toBe(1)
    expect(payload.name).toBeNull() // canonical create carries no name
    expect(Buffer.from(payload.blob, 'base64').equals(body)).toBe(true)
  })

  it('create-on-first-PUT: If-Match > 0 to an unknown id is 404 (cannot fast-forward)', async () => {
    const res = await putReq(app, '5', Buffer.from([1]), '01ARZ3NDEKTSV4RRFFQ69NEW02')
    expect(res.statusCode).toBe(404)
  })

  it('create-on-first-PUT: two concurrent If-Match:0 PUTs to a new id yield one 200 and one 409', async () => {
    const NEW_ID = '01ARZ3NDEKTSV4RRFFQ69NEW03'
    const bufA = Buffer.from([100, 101])
    const bufB = Buffer.from([200, 201, 202])

    const [resA, resB] = await Promise.all([
      putReq(app, '0', bufA, NEW_ID),
      putReq(app, '0', bufB, NEW_ID),
    ])

    expect([resA.statusCode, resB.statusCode].sort()).toEqual([200, 409])

    const winnerRes = resA.statusCode === 200 ? resA : resB
    const loserRes = resA.statusCode === 200 ? resB : resA
    const winnerBytes = resA.statusCode === 200 ? bufA : bufB

    expect(winnerRes.json()).toEqual({ version: 1 })

    // Loser sees the winner's committed state (version 1 + winner's bytes) to merge+retry.
    const loserPayload = loserRes.json() as { version: number; blob: string }
    expect(loserPayload.version).toBe(1)
    expect(Buffer.from(loserPayload.blob, 'base64').equals(winnerBytes)).toBe(true)

    // The committed object holds the winner's exact bytes; loser's orphan was GC'd.
    const doc = await repo.getDoc(NEW_ID)
    expect(doc?.version).toBe(1)
    const committed = await storage.get(doc!.s3Key!)
    expect(Buffer.from(committed!).equals(winnerBytes)).toBe(true)
    expect(storage.keys().filter((k) => k.startsWith(`docs/${NEW_ID}/`))).toEqual([doc!.s3Key])
  })

  it('body over the 5 MB cap is rejected with 413', async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41)
    const res = await putReq(app, '3', tooBig)
    expect(res.statusCode).toBe(413)
  })

  it('missing auth is rejected with 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/docs/${DOC_ID}`,
      headers: { 'content-type': 'application/octet-stream', 'if-match': '3' },
      payload: Buffer.from([1]),
    })
    expect(res.statusCode).toBe(401)
  })

  it('a non-ULID :id is rejected with 400 (finding H7 — no key injection)', async () => {
    // Traversal / injection material and malformed ids never reach the S3 key.
    for (const bad of ['not-a-ulid', '../etc/passwd', '01ARZ3NDEKTSV4RRFFQ69SIGNL' /* has I,L */]) {
      const get = await app.inject({ method: 'GET', url: `/v1/docs/${encodeURIComponent(bad)}`, headers: AUTH })
      expect(get.statusCode).toBe(400)
      const put = await putReq(app, '0', Buffer.from([1]), encodeURIComponent(bad))
      expect(put.statusCode).toBe(400)
    }
    // Auth still comes first: a bad id with no bearer is 401, not 400.
    const noAuth = await app.inject({ method: 'GET', url: '/v1/docs/not-a-ulid' })
    expect(noAuth.statusCode).toBe(401)
  })
})
