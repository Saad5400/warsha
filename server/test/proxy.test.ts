import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { TrustProxy } from '../src/env.js'
import { buildApp } from '../src/app.js'
import { loadEnv } from '../src/env.js'
import { FakeRepo, FakeStorage } from './fakes.js'

/**
 * Behind Traefik, per-IP rate-limit buckets must key off the real client
 * (X-Forwarded-For), not the proxy. That only happens when trustProxy is set —
 * otherwise every request shares one bucket for the whole internet (finding H3).
 */

function makeEnv(trustProxy: TrustProxy) {
  const env = loadEnv()
  env.DEV_SHARED_SECRET = 'test-secret'
  env.RATE_LIMIT_MAX = 1 // one request per window per bucket, so the 2nd trips it
  env.TRUST_PROXY = trustProxy
  return env
}

async function build(trustProxy: TrustProxy): Promise<FastifyInstance> {
  const app = await buildApp({ env: makeEnv(trustProxy), repo: new FakeRepo(), storage: new FakeStorage() })
  await app.ready()
  return app
}

const get = (app: FastifyInstance, xff: string) =>
  app.inject({ method: 'GET', url: '/v1/health', headers: { 'x-forwarded-for': xff } })

describe('rate-limit keying behind a proxy (§H3)', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app.close()
  })

  it('with TRUST_PROXY set, buckets key off X-Forwarded-For (per real client)', async () => {
    app = await build(true)
    // Same client IP → second request is limited.
    expect((await get(app, '9.9.9.9')).statusCode).toBe(200)
    expect((await get(app, '9.9.9.9')).statusCode).toBe(429)
    // A different client IP is a different bucket → not limited.
    expect((await get(app, '8.8.8.8')).statusCode).toBe(200)
  })

  it('with TRUST_PROXY off, X-Forwarded-For is ignored (all share the socket bucket)', async () => {
    app = await build(false)
    // Distinct XFF values, but the socket peer is the key → the 2nd is limited.
    expect((await get(app, '1.1.1.1')).statusCode).toBe(200)
    expect((await get(app, '2.2.2.2')).statusCode).toBe(429)
  })
})
