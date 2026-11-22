import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { TrustProxy } from '../src/env.js'
import { buildApp } from '../src/app.js'
import { DEFAULT_TRUSTED_PROXIES, loadEnv } from '../src/env.js'
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

  it('prod default: a direct client cannot pick its own bucket by sending X-Forwarded-For (CVE-2026-16732)', async () => {
    app = await build(DEFAULT_TRUSTED_PROXIES)
    // inject() connects from 127.0.0.1 (trusted, like Traefik): the forwarded client is honoured.
    expect((await get(app, '9.9.9.9')).statusCode).toBe(200)
    expect((await get(app, '9.9.9.9')).statusCode).toBe(429)
    // A spoofed hop in front of the real one doesn't mint a new bucket: the right-most untrusted
    // address (the one Traefik saw) is the key.
    expect((await get(app, '7.7.7.7, 9.9.9.9')).statusCode).toBe(429)
  })

  it('a direct, untrusted peer is keyed by its socket address whatever it forwards', async () => {
    app = await build(['10.0.0.0/8'])
    // inject() peers from 127.0.0.1, which this list does not trust → XFF ignored.
    expect((await get(app, '1.1.1.1')).statusCode).toBe(200)
    expect((await get(app, '2.2.2.2')).statusCode).toBe(429)
  })
})
