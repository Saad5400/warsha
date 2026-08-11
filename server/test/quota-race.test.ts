import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

/**
 * Quota TOCTOU (finding H6): N parallel create-on-first-PUTs to DISTINCT ids must
 * not all read "under limit" and all insert. With the count check + insert in one
 * transaction (per-owner serialized), exactly one create wins a single-doc quota.
 */

function makeEnv() {
  const env = loadEnv()
  env.DEV_SHARED_SECRET = 'test-secret'
  env.RATE_LIMIT_MAX = 100000
  env.QUOTA_DEVICE_DOCS = 1 // one doc allowed for the device principal
  return env
}

// Five distinct, valid canonical ULIDs.
const IDS = [
  '01ARZ3NDEKTSV4RRFFQ69RACE1',
  '01ARZ3NDEKTSV4RRFFQ69RACE2',
  '01ARZ3NDEKTSV4RRFFQ69RACE3',
  '01ARZ3NDEKTSV4RRFFQ69RACE4',
  '01ARZ3NDEKTSV4RRFFQ69RACE5',
]

describe('concurrent create-on-first-PUT quota', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = await buildApp({ env: makeEnv(), repo: new FakeRepo(), storage: new FakeStorage() })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('races to distinct ids under a 1-doc cap yield exactly one 200, the rest 403 quota', async () => {
    const device = (await app.inject({ method: 'POST', url: '/v1/devices' })).json() as {
      token: string
    }
    const put = (id: string) =>
      app.inject({
        method: 'PUT',
        url: `/v1/docs/${id}`,
        headers: {
          authorization: `Bearer ${device.token}`,
          'content-type': 'application/octet-stream',
          'if-match': '0',
        },
        payload: Buffer.from([1, 2, 3]),
      })

    const results = await Promise.all(IDS.map((id) => put(id)))
    const codes = results.map((r) => r.statusCode)
    const created = codes.filter((c) => c === 200)
    const rejected = codes.filter((c) => c === 403)

    expect(created).toHaveLength(1)
    expect(rejected).toHaveLength(IDS.length - 1)
    for (const r of results) {
      if (r.statusCode === 403) expect((r.json() as { error: string }).error).toBe('quota_exceeded')
    }
  })
})
