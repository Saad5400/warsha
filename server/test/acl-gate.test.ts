import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

/**
 * H2: per-email ACL sharing is flag-gated (ACCOUNT_EMAIL_SHARING_ENABLED, default
 * off). With the flag off, even a PRE-EXISTING ACL row must grant nothing — the
 * exact unverified-email-squatting repro must fail — while owner + link access
 * keep working. This suite runs with the DEFAULT (flag off).
 */

const DOC_ID = '01ARZ3NDEKTSV4RRFFQ69ACGT5'

function makeEnv() {
  const env = loadEnv()
  env.RATE_LIMIT_MAX = 100000
  env.AUTH_RATE_LIMIT_MAX = 100000
  // Intentionally NOT enabling ACCOUNT_EMAIL_SHARING_ENABLED (defaults false).
  return env
}

describe('email-sharing flag OFF (finding H2 closed)', () => {
  let app: FastifyInstance
  let repo: FakeRepo
  const auth = (t: string) => ({ authorization: `Bearer ${t}` })

  async function signup(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      headers: { 'content-type': 'application/json' },
      payload: { email, password: 'hunter2boat' },
    })
    expect(res.statusCode).toBe(201)
    return (res.json() as { token: string }).token
  }

  beforeEach(async () => {
    repo = new FakeRepo()
    app = await buildApp({ env: makeEnv(), repo, storage: new FakeStorage() })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('a pre-existing ACL row does NOT grant access when the flag is off', async () => {
    const owner = await signup('owner@x.com')
    const victimEmail = 'victim@x.com'
    const victim = await signup(victimEmail)

    // Owner creates the doc and locks the link down to nothing.
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/v1/docs/${DOC_ID}`,
          headers: { ...auth(owner), 'content-type': 'application/octet-stream', 'if-match': '0' },
          payload: Buffer.from([1, 2, 3]),
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/v1/docs/${DOC_ID}`,
          headers: { ...auth(owner), 'content-type': 'application/json' },
          payload: { linkAccess: 'none' },
        })
      ).statusCode,
    ).toBe(200)

    // Simulate a grant that already exists in the DB (e.g. created before the flag
    // was turned off, or via a squatted email). Seed it directly, bypassing the
    // now-disabled endpoint.
    await repo.setAclEntry(DOC_ID, victimEmail, 'editor')

    // The exact H2 repro: the victim holds an ACL editor row but must get nothing.
    const victimGet = await app.inject({ method: 'GET', url: `/v1/docs/${DOC_ID}`, headers: auth(victim) })
    expect(victimGet.statusCode).toBe(403)

    // The owner still has full access (owner role is unaffected by the flag).
    expect((await app.inject({ method: 'GET', url: `/v1/docs/${DOC_ID}`, headers: auth(owner) })).statusCode).toBe(200)
  })

  it('the ACL mutation endpoints are disabled (403 email_sharing_disabled)', async () => {
    const owner = await signup('owner2@x.com')
    await app.inject({
      method: 'PUT',
      url: `/v1/docs/${DOC_ID}`,
      headers: { ...auth(owner), 'content-type': 'application/octet-stream', 'if-match': '0' },
      payload: Buffer.from([1]),
    })

    const put = await app.inject({
      method: 'PUT',
      url: `/v1/docs/${DOC_ID}/acl`,
      headers: { ...auth(owner), 'content-type': 'application/json' },
      payload: { email: 'someone@x.com', role: 'editor' },
    })
    expect(put.statusCode).toBe(403)
    expect(put.json()).toEqual({ error: 'email_sharing_disabled' })

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/docs/${DOC_ID}/acl/${encodeURIComponent('someone@x.com')}`,
      headers: auth(owner),
    })
    expect(del.statusCode).toBe(403)

    // GET /acl still works (returns the empty list).
    const list = await app.inject({ method: 'GET', url: `/v1/docs/${DOC_ID}/acl`, headers: auth(owner) })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { entries: unknown[] }).entries).toEqual([])
  })
})
