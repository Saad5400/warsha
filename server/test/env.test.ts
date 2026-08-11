import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KNOWN_DEV_SECRET_DEFAULT, loadEnv } from '../src/env.js'

/**
 * loadEnv() must fail CLOSED: production refuses to boot on a dev-bearer backdoor,
 * on missing sensitive vars, or on dev/default credentials (findings H1, H2).
 */

/** A complete, valid production env (each test mutates one field to break it). */
const PROD: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://svc:s3cr3t@db.internal:5432/warsha',
  CORS_ORIGINS: 'https://app.warsha.example',
  S3_ENDPOINT: 'https://s3.hetzner.example',
  S3_BUCKET: 'warsha-prod',
  S3_ACCESS_KEY_ID: 'AKIAREALKEY',
  S3_SECRET_ACCESS_KEY: 'a-real-secret',
}

describe('loadEnv fail-closed', () => {
  let snapshot: NodeJS.ProcessEnv

  beforeEach(() => {
    snapshot = { ...process.env }
    // Start from a clean slate for the vars under test.
    for (const k of [
      'NODE_ENV',
      'DEV_BEARER_ENABLED',
      'DEV_SHARED_SECRET',
      'DATABASE_URL',
      'CORS_ORIGINS',
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
      'TRUST_PROXY',
    ]) {
      delete process.env[k]
    }
  })

  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k]
    Object.assign(process.env, snapshot)
  })

  function applyProd(): void {
    for (const [k, v] of Object.entries(PROD)) process.env[k] = v
  }

  it('boots in production with all sensitive vars set; dev bearer is off', () => {
    applyProd()
    const env = loadEnv()
    expect(env.IS_PRODUCTION).toBe(true)
    expect(env.DEV_BEARER_ENABLED).toBe(false)
    expect(env.DEV_SHARED_SECRET).toBe('')
    expect(env.TRUST_PROXY).toBe(1) // prod default: trust one proxy hop (Traefik)
  })

  it('refuses to boot if the dev bearer would be enabled in production', () => {
    applyProd()
    process.env['DEV_BEARER_ENABLED'] = 'true'
    process.env['DEV_SHARED_SECRET'] = 'something-real'
    expect(() => loadEnv()).toThrow(/dev bearer must be disabled in production/i)
  })

  it('refuses to boot in production when DATABASE_URL is missing', () => {
    applyProd()
    delete process.env['DATABASE_URL']
    expect(() => loadEnv()).toThrow(/DATABASE_URL is required in production/i)
  })

  it('refuses to boot in production on the dev localhost DATABASE_URL', () => {
    applyProd()
    process.env['DATABASE_URL'] = 'postgres://warsha:warsha@localhost:5432/warsha'
    expect(() => loadEnv()).toThrow(/DATABASE_URL must not use its dev\/default value/i)
  })

  it('refuses to boot in production on the minioadmin S3 credentials', () => {
    applyProd()
    process.env['S3_ACCESS_KEY_ID'] = 'minioadmin'
    expect(() => loadEnv()).toThrow(/S3_ACCESS_KEY_ID must not use its dev\/default value/i)
  })

  it('refuses to boot in production when S3_BUCKET is missing', () => {
    applyProd()
    delete process.env['S3_BUCKET']
    expect(() => loadEnv()).toThrow(/S3_BUCKET is required in production/i)
  })

  it("refuses to boot in production on CORS_ORIGINS='*'", () => {
    applyProd()
    process.env['CORS_ORIGINS'] = '*'
    expect(() => loadEnv()).toThrow(/CORS_ORIGINS.*not allowed in production/i)
  })

  it('refuses to boot when the dev bearer is enabled but DEV_SHARED_SECRET is unset', () => {
    process.env['NODE_ENV'] = 'development'
    process.env['DEV_BEARER_ENABLED'] = 'true'
    delete process.env['DEV_SHARED_SECRET']
    expect(() => loadEnv()).toThrow(/DEV_SHARED_SECRET/i)
  })

  it('refuses to boot when DEV_SHARED_SECRET is still the known placeholder', () => {
    process.env['NODE_ENV'] = 'development'
    process.env['DEV_SHARED_SECRET'] = KNOWN_DEV_SECRET_DEFAULT
    expect(() => loadEnv()).toThrow(/well-known placeholder/i)
  })

  it('development defaults: dev bearer on, TRUST_PROXY off, localhost creds allowed', () => {
    process.env['NODE_ENV'] = 'development'
    process.env['DEV_SHARED_SECRET'] = 'a-dev-secret'
    const env = loadEnv()
    expect(env.IS_PRODUCTION).toBe(false)
    expect(env.DEV_BEARER_ENABLED).toBe(true)
    expect(env.TRUST_PROXY).toBe(false)
    expect(env.DATABASE_URL).toContain('localhost')
  })
})
