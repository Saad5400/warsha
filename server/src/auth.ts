import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { DocRepo } from './db/types.js'

/**
 * The authenticated caller. Every bearer token resolves to exactly one of:
 * - a device (`POST /v1/devices` token, or the dev shared secret in dev mode) —
 *   principal key `device:<token>`;
 * - a user account (session token from signup/login) — principal key `user:<id>`.
 */
export interface Principal {
  kind: 'device' | 'user'
  id: string
  /** Account email (ACL matching). Null for devices. */
  email: string | null
  /** Canonical principal string stored in `docs.owner`. */
  key: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The raw Bearer token that authenticated this request. */
    authToken?: string
    /** The resolved principal for this request. */
    principal?: Principal
  }
}

/** Sliding session lifetime: 90 days. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000
/** Only rewrite `expires_at` when it would advance by more than this (write damping). */
const SESSION_TOUCH_SLACK_MS = 60 * 60 * 1000

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Constant-time string compare (length-independent via sha256 pre-hash). */
function safeEqual(a: string, b: string): boolean {
  // Hash both to a fixed 32-byte digest so timingSafeEqual never sees unequal
  // lengths (which would itself throw / leak length) — the digests are compared.
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  )
}

export function devicePrincipal(token: string): Principal {
  return { kind: 'device', id: token, email: null, key: `device:${token}` }
}

export interface AuthDeps {
  repo: DocRepo
  devSharedSecret: string
  /** Static dev bearer accepted only when true (never in production). */
  devBearerEnabled: boolean
}

export type BearerResolver = (token: string) => Promise<Principal | null>

function extractBearer(header: string | undefined): string | null {
  if (!header) return null
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null
  return token.trim() || null
}

/**
 * The single auth resolver: one bearer token in, one principal out (or null).
 * Order: dev shared secret (dev mode only) → session token → device token.
 * Session hits slide the 90-day expiry forward.
 */
export function makeBearerResolver(deps: AuthDeps): BearerResolver {
  return async function resolveBearer(token: string): Promise<Principal | null> {
    if (
      deps.devBearerEnabled &&
      deps.devSharedSecret.length > 0 &&
      safeEqual(token, deps.devSharedSecret)
    ) {
      // The dev secret behaves like a well-known device so ownership/quota
      // logic stays uniform. Disabled entirely in production; compared in
      // constant time so it is not a timing oracle.
      return devicePrincipal(token)
    }

    const now = new Date()
    const hit = await deps.repo.getSessionUser(sha256Hex(token), now)
    if (hit) {
      const target = new Date(now.getTime() + SESSION_TTL_MS)
      if (target.getTime() - hit.session.expiresAt.getTime() > SESSION_TOUCH_SLACK_MS) {
        await deps.repo.touchSession(hit.session.tokenHash, target)
      }
      const u = hit.user
      return { kind: 'user', id: u.id, email: u.email, key: `user:${u.id}` }
    }

    if (await deps.repo.deviceExists(token)) return devicePrincipal(token)
    return null
  }
}

/**
 * Fastify preHandler wrapping the resolver: 401 without a valid bearer,
 * otherwise sets `request.principal` (and `request.authToken` for logout).
 */
export function makeAuthPreHandler(resolve: BearerResolver) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractBearer(request.headers.authorization)
    const principal = token ? await resolve(token) : null
    if (!token || !principal) {
      await reply.code(401).send({ error: 'unauthorized' })
      return
    }
    request.authToken = token
    request.principal = principal
  }
}
