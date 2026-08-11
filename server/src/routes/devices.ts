import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../env.js'
import type { DocRepo } from '../db/types.js'

/** Opaque, unguessable device token. */
function generateDeviceToken(): string {
  return `dev_${randomBytes(32).toString('base64url')}`
}

// SECURITY(TODO): device tokens are stored in plaintext (`devices.token` PK) and
// embedded in ownership keys (`docs.owner = 'device:<token>'`). Session tokens are
// stored sha256-hashed; device tokens are not, because the raw token is the
// principal identity used across ownership, quota and claim-device. Hashing at
// rest would require re-keying `docs.owner` and the claim flow — a data migration,
// not a local change. Deliberately deferred (unguessable 256-bit tokens; DB access
// is already privileged) rather than half-migrated. Revisit with a token-id scheme
// (store id + hash; owner key = 'device:<id>') if device tokens ever need rotation.

/**
 * POST /v1/devices — mint an opaque device token. Rate-limited hard (separate,
 * stricter bucket than the global limiter) because it is unauthenticated.
 */
export function registerDevices(app: FastifyInstance, env: Env, repo: DocRepo): void {
  app.post(
    '/v1/devices',
    {
      config: {
        rateLimit: {
          max: env.DEVICE_RATE_LIMIT_MAX,
          timeWindow: env.DEVICE_RATE_LIMIT_WINDOW,
        },
      },
    },
    async (_request, reply) => {
      const token = generateDeviceToken()
      await repo.createDevice(token)
      await reply.code(201).send({ token })
    },
  )
}
