/**
 * Environment configuration. Everything the service needs comes from process.env
 * (endpoint / region / credentials for S3, the Postgres URL, auth secret, ICE config).
 * Parsed once at boot; `loadEnv()` throws early on anything malformed OR on a
 * fail-open production misconfiguration (dev bearer on, dev creds, missing secrets).
 */

export interface IceServer {
  urls: string | string[]
  username?: string
  credential?: string
}

/**
 * Fastify `trustProxy` value. `false` (dev) = the socket peer is the client.
 * A number = trust that many proxy hops (prod default 1 = Traefik). A string[]
 * = explicit trusted proxy IPs/CIDRs. `true` = trust every hop (NOT a default —
 * lets any client spoof X-Forwarded-For and defeat per-IP rate limits).
 */
export type TrustProxy = boolean | number | string[]

export interface Env {
  /** True when NODE_ENV=production. Drives fail-closed checks + verbose errors. */
  IS_PRODUCTION: boolean

  HOST: string
  PORT: number
  LOG_LEVEL: string

  /**
   * Which proxy hop(s) to trust for `request.ip` / X-Forwarded-For. Behind
   * Traefik this MUST be set so rate-limit buckets key off the real client IP
   * and not collapse to the proxy. Traefik must *overwrite* X-Forwarded-For.
   */
  TRUST_PROXY: TrustProxy

  /** Empty unless the dev bearer is explicitly enabled. */
  DEV_SHARED_SECRET: string
  /**
   * Whether the static dev bearer is accepted at all. Defaults true except when
   * NODE_ENV=production (where it MUST be false — loadEnv refuses to boot otherwise).
   */
  DEV_BEARER_ENABLED: boolean

  /**
   * Per-email ACL sharing (§7.2). Default OFF: unverified emails let an attacker
   * squat another user's address and self-grant access (finding H2). Kept behind
   * this flag until email verification lands; link-access + owner are unaffected.
   */
  ACCOUNT_EMAIL_SHARING_ENABLED: boolean

  RATE_LIMIT_MAX: number
  RATE_LIMIT_WINDOW: string
  DEVICE_RATE_LIMIT_MAX: number
  DEVICE_RATE_LIMIT_WINDOW: string
  /** Hard limit for POST /v1/auth/signup and /v1/auth/login (per IP). */
  AUTH_RATE_LIMIT_MAX: number
  AUTH_RATE_LIMIT_WINDOW: string

  /** Quotas (§7.3): docs / total stored bytes per principal kind. */
  QUOTA_DEVICE_DOCS: number
  QUOTA_DEVICE_BYTES: number
  QUOTA_ACCOUNT_DOCS: number
  QUOTA_ACCOUNT_BYTES: number

  DATABASE_URL: string

  /** Allowed browser origins for CORS. `['*']` reflects any origin (dev only). */
  CORS_ORIGINS: string[]

  S3_ENDPOINT: string
  S3_REGION: string
  S3_BUCKET: string
  S3_ACCESS_KEY_ID: string
  S3_SECRET_ACCESS_KEY: string
  S3_FORCE_PATH_STYLE: boolean

  MAX_SNAPSHOT_BYTES: number

  ICE_SERVERS: IceServer[]
}

/** The well-known placeholder that must never reach production. */
export const KNOWN_DEV_SECRET_DEFAULT = 'dev-shared-secret-change-me'

function str(name: string, fallback?: string): string {
  const v = process.env[name]
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`Missing required env var: ${name}`)
  }
  return v
}

/**
 * A sensitive var that MUST be provided in production. In dev it falls back to a
 * local default; in production a missing value (or a value equal to a known
 * dev/default sentinel) refuses the boot — fail closed, never on dev creds.
 */
function prodRequiredStr(
  name: string,
  devFallback: string,
  isProd: boolean,
  rejectInProd: string[] = [],
): string {
  const v = process.env[name]
  if (v === undefined || v === '') {
    if (isProd) {
      throw new Error(`Refusing to boot: ${name} is required in production (NODE_ENV=production).`)
    }
    return devFallback
  }
  if (isProd && rejectInProd.includes(v)) {
    throw new Error(`Refusing to boot: ${name} must not use its dev/default value in production.`)
  }
  return v
}

function int(name: string, fallback: number): number {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be an integer, got: ${v}`)
  return n
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  return v === 'true' || v === '1'
}

/** Required-in-prod CORS list: reject the reflect-any `*` and dev localhost defaults. */
function prodRequiredCors(fallback: string[], isProd: boolean): string[] {
  const v = process.env['CORS_ORIGINS']
  if (v === undefined || v === '') {
    if (isProd) throw new Error('Refusing to boot: CORS_ORIGINS is required in production.')
    return fallback
  }
  const list = v.split(',').map((s) => s.trim()).filter(Boolean)
  if (isProd && list.includes('*')) {
    throw new Error("Refusing to boot: CORS_ORIGINS='*' (reflect-any) is not allowed in production.")
  }
  return list
}

function trustProxy(isProd: boolean): TrustProxy {
  const v = process.env['TRUST_PROXY']
  // Default: dev trusts nothing (socket peer is the client); prod trusts exactly
  // one hop (Traefik). One hop keeps clients from spoofing X-Forwarded-For.
  if (v === undefined || v === '') return isProd ? 1 : false
  if (v === 'true') return true
  if (v === 'false') return false
  const n = Number(v)
  if (Number.isInteger(n) && String(n) === v.trim()) return n
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

function iceServers(name: string, fallback: IceServer[]): IceServer[] {
  const v = process.env[name]
  if (v === undefined || v === '') return fallback
  try {
    const parsed = JSON.parse(v)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed as IceServer[]
  } catch (e) {
    throw new Error(`Env var ${name} must be a JSON array of ICE servers: ${(e as Error).message}`)
  }
}

export function loadEnv(): Env {
  const isProd = str('NODE_ENV', 'development') === 'production'

  // Fail-closed dev bearer: it is a static backdoor and must never be live in prod.
  const devBearerEnabled = bool('DEV_BEARER_ENABLED', !isProd)
  if (isProd && devBearerEnabled) {
    throw new Error(
      'Refusing to boot: the static dev bearer must be disabled in production. ' +
        'Leave DEV_BEARER_ENABLED unset (defaults off in prod) or set DEV_BEARER_ENABLED=false.',
    )
  }
  // The shared secret is only needed — and only validated — when the bearer is on.
  let devSharedSecret = ''
  if (devBearerEnabled) {
    devSharedSecret = str('DEV_SHARED_SECRET')
    if (devSharedSecret === KNOWN_DEV_SECRET_DEFAULT) {
      throw new Error(
        'Refusing to boot: DEV_SHARED_SECRET is still the well-known placeholder ' +
          `('${KNOWN_DEV_SECRET_DEFAULT}'). Set a real, unique secret.`,
      )
    }
  }

  return {
    IS_PRODUCTION: isProd,

    HOST: str('HOST', '0.0.0.0'),
    PORT: int('PORT', 8787),
    LOG_LEVEL: str('LOG_LEVEL', 'info'),

    TRUST_PROXY: trustProxy(isProd),

    DEV_SHARED_SECRET: devSharedSecret,
    DEV_BEARER_ENABLED: devBearerEnabled,

    // Off by default (finding H2). Prod deploy leaves it off until email verification.
    ACCOUNT_EMAIL_SHARING_ENABLED: bool('ACCOUNT_EMAIL_SHARING_ENABLED', false),

    RATE_LIMIT_MAX: int('RATE_LIMIT_MAX', 1000),
    RATE_LIMIT_WINDOW: str('RATE_LIMIT_WINDOW', '1 minute'),
    DEVICE_RATE_LIMIT_MAX: int('DEVICE_RATE_LIMIT_MAX', 5),
    DEVICE_RATE_LIMIT_WINDOW: str('DEVICE_RATE_LIMIT_WINDOW', '1 hour'),
    AUTH_RATE_LIMIT_MAX: int('AUTH_RATE_LIMIT_MAX', 10),
    AUTH_RATE_LIMIT_WINDOW: str('AUTH_RATE_LIMIT_WINDOW', '15 minutes'),

    QUOTA_DEVICE_DOCS: int('QUOTA_DEVICE_DOCS', 10),
    QUOTA_DEVICE_BYTES: int('QUOTA_DEVICE_BYTES', 25 * 1024 * 1024),
    QUOTA_ACCOUNT_DOCS: int('QUOTA_ACCOUNT_DOCS', 200),
    QUOTA_ACCOUNT_BYTES: int('QUOTA_ACCOUNT_BYTES', 250 * 1024 * 1024),

    // Sensitive: required in prod, and the dev localhost default is rejected there.
    DATABASE_URL: prodRequiredStr('DATABASE_URL', 'postgres://warsha:warsha@localhost:5432/warsha', isProd, [
      'postgres://warsha:warsha@localhost:5432/warsha',
    ]),

    CORS_ORIGINS: prodRequiredCors(['http://localhost:8083', 'http://127.0.0.1:8083'], isProd),

    S3_ENDPOINT: prodRequiredStr('S3_ENDPOINT', 'http://localhost:9000', isProd, ['http://localhost:9000']),
    S3_REGION: str('S3_REGION', 'us-east-1'),
    S3_BUCKET: prodRequiredStr('S3_BUCKET', 'warsha-docs', isProd),
    S3_ACCESS_KEY_ID: prodRequiredStr('S3_ACCESS_KEY_ID', 'minioadmin', isProd, ['minioadmin']),
    S3_SECRET_ACCESS_KEY: prodRequiredStr('S3_SECRET_ACCESS_KEY', 'minioadmin', isProd, ['minioadmin']),
    S3_FORCE_PATH_STYLE: bool('S3_FORCE_PATH_STYLE', true),

    MAX_SNAPSHOT_BYTES: int('MAX_SNAPSHOT_BYTES', 5 * 1024 * 1024),

    ICE_SERVERS: iceServers('ICE_SERVERS', [{ urls: 'stun:stun.l.google.com:19302' }]),
  }
}
