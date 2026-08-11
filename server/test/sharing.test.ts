import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

const DOC_ID = '01ARZ3NDEKTSV4RRFFQ69SHARE'

function makeEnv() {
  const env = loadEnv()
  env.RATE_LIMIT_MAX = 100000
  env.AUTH_RATE_LIMIT_MAX = 100000
  // This suite exercises the per-email ACL model, which is flag-gated (finding
  // H2). A separate test covers the flag-off behavior.
  env.ACCOUNT_EMAIL_SHARING_ENABLED = true
  return env
}

describe('sharing + quotas (§7.2, §7.3)', () => {
  let app: FastifyInstance
  let repo: FakeRepo
  let storage: FakeStorage
  /** Session tokens: doc owner, ACL editor, ACL viewer, unrelated account. */
  let owner: string
  let editor: string
  let viewer: string
  let stranger: string

  const auth = (token: string) => ({ authorization: `Bearer ${token}` })

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

  function getDoc(token: string | null, id = DOC_ID) {
    return app.inject({
      method: 'GET',
      url: `/v1/docs/${id}`,
      headers: token ? auth(token) : {},
    })
  }

  function putDoc(token: string, ifMatch: string, payload: Buffer, id = DOC_ID) {
    return app.inject({
      method: 'PUT',
      url: `/v1/docs/${id}`,
      headers: { ...auth(token), 'content-type': 'application/octet-stream', 'if-match': ifMatch },
      payload,
    })
  }

  function patchDoc(token: string, payload: object, id = DOC_ID) {
    return app.inject({
      method: 'PATCH',
      url: `/v1/docs/${id}`,
      headers: { ...auth(token), 'content-type': 'application/json' },
      payload,
    })
  }

  function setAcl(token: string, email: string, role: string, id = DOC_ID) {
    return app.inject({
      method: 'PUT',
      url: `/v1/docs/${id}/acl`,
      headers: { ...auth(token), 'content-type': 'application/json' },
      payload: { email, role },
    })
  }

  beforeEach(async () => {
    repo = new FakeRepo()
    storage = new FakeStorage()
    app = await buildApp({ env: makeEnv(), repo, storage })
    await app.ready()

    owner = await signup('owner@x.com')
    editor = await signup('editor@x.com')
    viewer = await signup('viewer@x.com')
    stranger = await signup('stranger@x.com')

    // Owner creates the doc via create-on-first-PUT, locks the link down, and
    // grants per-email roles — the Google-Docs setup the matrix tests against.
    expect((await putDoc(owner, '0', Buffer.from([1, 2, 3]))).statusCode).toBe(200)
    expect((await patchDoc(owner, { linkAccess: 'none' })).statusCode).toBe(200)
    expect((await setAcl(owner, 'editor@x.com', 'editor')).statusCode).toBe(204)
    expect((await setAcl(owner, 'viewer@x.com', 'viewer')).statusCode).toBe(204)
  })

  afterEach(async () => {
    await app.close()
  })

  it('enforcement matrix: owner / editor / viewer / no-role / anonymous', async () => {
    const body = Buffer.from([9, 9])

    // owner: everything
    expect((await getDoc(owner)).statusCode).toBe(200)
    expect((await putDoc(owner, '1', body)).statusCode).toBe(200) // now version 2

    // ACL editor: read + write, but no owner-only routes
    expect((await getDoc(editor)).statusCode).toBe(200)
    expect((await putDoc(editor, '2', body)).statusCode).toBe(200) // now version 3
    expect((await patchDoc(editor, { name: 'nope' })).statusCode).toBe(403)
    expect((await setAcl(editor, 'evil@x.com', 'editor')).statusCode).toBe(403)
    expect(
      (await app.inject({ method: 'DELETE', url: `/v1/docs/${DOC_ID}`, headers: auth(editor) }))
        .statusCode,
    ).toBe(403)

    // ACL viewer: read only
    expect((await getDoc(viewer)).statusCode).toBe(200)
    const viewerPut = await putDoc(viewer, '3', body)
    expect(viewerPut.statusCode).toBe(403)
    expect(viewerPut.json()).toEqual({ error: 'forbidden' })

    // account with no ACL entry and link_access none: nothing
    expect((await getDoc(stranger)).statusCode).toBe(403)
    expect((await putDoc(stranger, '3', body)).statusCode).toBe(403)

    // anonymous: 401 before any role logic
    expect((await getDoc(null)).statusCode).toBe(401)
  })

  it('link_access editor (the default) grants write to any principal with the id', async () => {
    expect((await patchDoc(owner, { linkAccess: 'editor' })).statusCode).toBe(200)
    expect((await getDoc(stranger)).statusCode).toBe(200)
    expect((await putDoc(stranger, '1', Buffer.from([5]))).statusCode).toBe(200)

    // viewer link: read yes, write no
    expect((await patchDoc(owner, { linkAccess: 'viewer' })).statusCode).toBe(200)
    expect((await getDoc(stranger)).statusCode).toBe(200)
    expect((await putDoc(stranger, '2', Buffer.from([6]))).statusCode).toBe(403)
  })

  it('ACL management: PUT upserts, GET lists (owner only), DELETE removes', async () => {
    expect((await setAcl(owner, 'Editor@X.com', 'viewer')).statusCode).toBe(204) // upsert + normalize

    const list = await app.inject({
      method: 'GET',
      url: `/v1/docs/${DOC_ID}/acl`,
      headers: auth(owner),
    })
    expect(list.statusCode).toBe(200)
    expect((list.json() as { entries: unknown[] }).entries).toEqual(
      expect.arrayContaining([
        { email: 'editor@x.com', role: 'viewer' },
        { email: 'viewer@x.com', role: 'viewer' },
      ]),
    )
    expect((await app.inject({ method: 'GET', url: `/v1/docs/${DOC_ID}/acl`, headers: auth(editor) })).statusCode).toBe(403)

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/docs/${DOC_ID}/acl/${encodeURIComponent('editor@x.com')}`,
      headers: auth(owner),
    })
    expect(del.statusCode).toBe(204)
    expect((await getDoc(editor)).statusCode).toBe(403) // access gone (link is none)

    const invalidRole = await setAcl(owner, 'a@b.com', 'owner')
    expect(invalidRole.statusCode).toBe(400)
  })

  it('PATCH validates linkAccess and renames; invalid values are 400', async () => {
    const renamed = await patchDoc(owner, { name: 'algebra-project' })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({ id: DOC_ID, name: 'algebra-project', linkAccess: 'none' })

    expect((await patchDoc(owner, { linkAccess: 'public' })).statusCode).toBe(400)
  })

  it('GET /v1/docs lists owned and shared docs with roles', async () => {
    const forOwner = await app.inject({ method: 'GET', url: '/v1/docs', headers: auth(owner) })
    expect(forOwner.statusCode).toBe(200)
    expect((forOwner.json() as { docs: unknown[] }).docs).toEqual([
      expect.objectContaining({ id: DOC_ID, role: 'owner', linkAccess: 'none' }),
    ])

    const forEditor = await app.inject({ method: 'GET', url: '/v1/docs', headers: auth(editor) })
    expect((forEditor.json() as { docs: unknown[] }).docs).toEqual([
      expect.objectContaining({ id: DOC_ID, role: 'editor' }),
    ])

    const forStranger = await app.inject({ method: 'GET', url: '/v1/docs', headers: auth(stranger) })
    expect((forStranger.json() as { docs: unknown[] }).docs).toEqual([])
  })

  it('owner DELETE removes the doc row, its ACL, and the S3 blob', async () => {
    const before = await repo.getDoc(DOC_ID)
    expect(before?.s3Key).toBeTruthy()
    expect(await storage.get(before!.s3Key!)).not.toBeNull()

    const del = await app.inject({ method: 'DELETE', url: `/v1/docs/${DOC_ID}`, headers: auth(owner) })
    expect(del.statusCode).toBe(204)

    expect(await repo.getDoc(DOC_ID)).toBeNull()
    expect(storage.keys()).toEqual([]) // blob gone
    expect(await repo.listAcl(DOC_ID)).toEqual([]) // ACL cascaded
    expect((await getDoc(owner)).statusCode).toBe(404)
  })

  it('doc-count quota: creating past the device limit is 403 quota_exceeded with usage', async () => {
    const env = makeEnv()
    env.QUOTA_DEVICE_DOCS = 1
    const quotaApp = await buildApp({ env, repo: new FakeRepo(), storage: new FakeStorage() })
    await quotaApp.ready()
    try {
      const device = (await quotaApp.inject({ method: 'POST', url: '/v1/devices' })).json() as {
        token: string
      }
      const put = (id: string) =>
        quotaApp.inject({
          method: 'PUT',
          url: `/v1/docs/${id}`,
          headers: {
            authorization: `Bearer ${device.token}`,
            'content-type': 'application/octet-stream',
            'if-match': '0',
          },
          payload: Buffer.from([1]),
        })

      expect((await put('01ARZ3NDEKTSV4RRFFQ69QVPT1')).statusCode).toBe(200)
      const second = await put('01ARZ3NDEKTSV4RRFFQ69QVPT2')
      expect(second.statusCode).toBe(403)
      expect(second.json()).toEqual({
        error: 'quota_exceeded',
        usage: { docs: 1, bytes: 1, limits: { docs: 1, bytes: env.QUOTA_DEVICE_BYTES } },
      })
    } finally {
      await quotaApp.close()
    }
  })

  it("bytes quota: a PUT that would exceed the owner's total bytes is 403; shrinking passes", async () => {
    const env = makeEnv()
    env.QUOTA_ACCOUNT_BYTES = 10
    const quotaApp = await buildApp({ env, repo: new FakeRepo(), storage: new FakeStorage() })
    await quotaApp.ready()
    try {
      const signupRes = await quotaApp.inject({
        method: 'POST',
        url: '/v1/auth/signup',
        headers: { 'content-type': 'application/json' },
        payload: { email: 'q@x.com', password: 'hunter2boat' },
      })
      const token = (signupRes.json() as { token: string }).token
      const put = (ifMatch: string, payload: Buffer) =>
        quotaApp.inject({
          method: 'PUT',
          url: '/v1/docs/01ARZ3NDEKTSV4RRFFQ69QVPT3',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/octet-stream',
            'if-match': ifMatch,
          },
          payload,
        })

      expect((await put('0', Buffer.alloc(8))).statusCode).toBe(200) // 8 of 10 bytes
      const over = await put('1', Buffer.alloc(11)) // delta +3 → 11 > 10
      expect(over.statusCode).toBe(403)
      expect((over.json() as { error: string }).error).toBe('quota_exceeded')
      expect((await put('1', Buffer.alloc(4))).statusCode).toBe(200) // shrink always ok
    } finally {
      await quotaApp.close()
    }
  })
})
