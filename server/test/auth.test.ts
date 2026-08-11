import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

const SECRET = 'test-secret'

function makeEnv() {
  const env = loadEnv()
  env.DEV_SHARED_SECRET = SECRET
  env.RATE_LIMIT_MAX = 100000
  env.AUTH_RATE_LIMIT_MAX = 100000 // rate limiting is not under test here
  return env
}

function signup(app: FastifyInstance, email: string, password = 'hunter2boat') {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  })
}

function login(app: FastifyInstance, email: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'content-type': 'application/json' },
    payload: { email, password },
  })
}

describe('auth endpoints (§7.1)', () => {
  let app: FastifyInstance
  let repo: FakeRepo
  let storage: FakeStorage

  beforeEach(async () => {
    repo = new FakeRepo()
    storage = new FakeStorage()
    app = await buildApp({ env: makeEnv(), repo, storage })
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  it('signup returns 201 with a session token and the lowercased email', async () => {
    const res = await signup(app, '  Saad@Example.COM ')
    expect(res.statusCode).toBe(201)
    const body = res.json() as { token: string; user: { id: string; email: string } }
    expect(body.token).toMatch(/^sess_/)
    expect(body.user.email).toBe('saad@example.com')
    expect(body.user.id).toBeTruthy()
  })

  it('signup rejects passwords under 8 chars with 400', async () => {
    const res = await signup(app, 'a@b.com', 'short')
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'weak_password' })
  })

  it('signup rejects a taken email with 409 (case-insensitive)', async () => {
    expect((await signup(app, 'a@b.com')).statusCode).toBe(201)
    const res = await signup(app, 'A@B.com')
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'email_taken' })
  })

  it('login succeeds with correct credentials and is a uniform 401 otherwise', async () => {
    await signup(app, 'a@b.com', 'correct-horse')

    const ok = await login(app, 'a@b.com', 'correct-horse')
    expect(ok.statusCode).toBe(200)
    expect((ok.json() as { token: string }).token).toMatch(/^sess_/)

    const badPassword = await login(app, 'a@b.com', 'wrong-horse')
    const badEmail = await login(app, 'nobody@b.com', 'correct-horse')
    expect(badPassword.statusCode).toBe(401)
    expect(badEmail.statusCode).toBe(401)
    // Uniform body — must not reveal which of email/password was wrong.
    expect(badPassword.json()).toEqual(badEmail.json())
  })

  it('GET /v1/me returns the user + usage for a session, user:null for a device', async () => {
    const { token } = (await signup(app, 'a@b.com')).json() as { token: string }

    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(me.statusCode).toBe(200)
    const body = me.json() as {
      user: { email: string } | null
      usage: { docs: number; bytes: number; limits: { docs: number; bytes: number } }
    }
    expect(body.user?.email).toBe('a@b.com')
    expect(body.usage).toEqual({
      docs: 0,
      bytes: 0,
      limits: { docs: 200, bytes: 250 * 1024 * 1024 },
    })

    const device = (await app.inject({ method: 'POST', url: '/v1/devices' })).json() as {
      token: string
    }
    const meDevice = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${device.token}` },
    })
    expect(meDevice.statusCode).toBe(200)
    const deviceBody = meDevice.json() as { user: null; usage: { limits: { docs: number } } }
    expect(deviceBody.user).toBeNull()
    expect(deviceBody.usage.limits.docs).toBe(10)
  })

  it('logout revokes the session token (204, then 401)', async () => {
    const { token } = (await signup(app, 'a@b.com')).json() as { token: string }
    const auth = { authorization: `Bearer ${token}` }

    const out = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: auth })
    expect(out.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: '/v1/me', headers: auth })
    expect(after.statusCode).toBe(401)
  })

  it('claim-device re-owns the device docs to the account', async () => {
    // A device creates a doc via create-on-first-PUT.
    const device = (await app.inject({ method: 'POST', url: '/v1/devices' })).json() as {
      token: string
    }
    const DOC_ID = '01ARZ3NDEKTSV4RRFFQ69CKAJM'
    const put = await app.inject({
      method: 'PUT',
      url: `/v1/docs/${DOC_ID}`,
      headers: {
        authorization: `Bearer ${device.token}`,
        'content-type': 'application/octet-stream',
        'if-match': '0',
      },
      payload: Buffer.from([1, 2, 3]),
    })
    expect(put.statusCode).toBe(200)

    const { token } = (await signup(app, 'a@b.com')).json() as { token: string }
    const claim = await app.inject({
      method: 'POST',
      url: '/v1/auth/claim-device',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { deviceToken: device.token },
    })
    expect(claim.statusCode).toBe(200)
    expect(claim.json()).toEqual({ claimed: 1 })

    // The account now owns the doc.
    const doc = await repo.getDoc(DOC_ID)
    expect(doc?.owner).toMatch(/^user:/)
    const list = await app.inject({
      method: 'GET',
      url: '/v1/docs',
      headers: { authorization: `Bearer ${token}` },
    })
    const docs = (list.json() as { docs: Array<{ id: string; role: string }> }).docs
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ id: DOC_ID, role: 'owner' })
  })

  it('claim-device with a device principal is 403; unknown device token is 404', async () => {
    const device = (await app.inject({ method: 'POST', url: '/v1/devices' })).json() as {
      token: string
    }
    const asDevice = await app.inject({
      method: 'POST',
      url: '/v1/auth/claim-device',
      headers: { authorization: `Bearer ${device.token}`, 'content-type': 'application/json' },
      payload: { deviceToken: device.token },
    })
    expect(asDevice.statusCode).toBe(403)

    const { token } = (await signup(app, 'a@b.com')).json() as { token: string }
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/auth/claim-device',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { deviceToken: 'dev_does-not-exist' },
    })
    expect(unknown.statusCode).toBe(404)
  })

  it('the static dev bearer is rejected when DEV_BEARER_ENABLED=false (production)', async () => {
    const env = makeEnv()
    env.DEV_BEARER_ENABLED = false
    const prodApp = await buildApp({ env, repo: new FakeRepo(), storage: new FakeStorage() })
    await prodApp.ready()
    try {
      const res = await prodApp.inject({
        method: 'GET',
        url: '/v1/docs',
        headers: { authorization: `Bearer ${SECRET}` },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await prodApp.close()
    }
  })
})
