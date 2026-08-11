import { randomBytes } from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import type { FastifyInstance } from 'fastify'
import type { Env } from '../env.js'
import type { DocRepo } from '../db/types.js'
import {
  SESSION_TTL_MS,
  makeAuthPreHandler,
  sha256Hex,
  type BearerResolver,
} from '../auth.js'
import { usageReport } from '../quota.js'
import { ulid } from '../ulid.js'
import type { SignalTicketStore } from '../tickets.js'

/** Upper bound on password length: argon2 hashing cost is input-size sensitive. */
const MAX_PASSWORD_LEN = 128

export interface AuthRoutesDeps {
  env: Env
  repo: DocRepo
  resolveBearer: BearerResolver
  tickets: SignalTicketStore
}

/** Opaque, unguessable session token (32 random bytes). Only its sha256 is stored. */
function generateSessionToken(): string {
  return `sess_${randomBytes(32).toString('base64url')}`
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  // Deliberately loose: uniqueness + the verification-free Phase-2 model make
  // strict RFC parsing pointless. Just reject obvious garbage.
  if (email.length < 3 || email.length > 254 || !email.includes('@')) return null
  return email
}

/**
 * Constant-ish-time login: when the email is unknown we still verify against a
 * throwaway hash so response timing does not reveal which of email/password was
 * wrong. Computed once, lazily (argon2 hashing is async).
 */
let dummyHashPromise: Promise<string> | null = null
function dummyHash(): Promise<string> {
  dummyHashPromise ??= argonHash(randomBytes(16).toString('hex'))
  return dummyHashPromise
}

async function issueSession(repo: DocRepo, userId: string): Promise<string> {
  const token = generateSessionToken()
  await repo.createSession({
    tokenHash: sha256Hex(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return token
}

/**
 * §7.1 auth endpoints: signup / login / logout / me / claim-device.
 * Passwords are argon2id at rest; session tokens are stored hashed with a
 * sliding 90-day expiry. Signup/login sit behind a hard per-IP rate limit.
 */
export function registerAuth(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const { env, repo, resolveBearer, tickets } = deps
  const authenticate = makeAuthPreHandler(resolveBearer)
  const authRateLimit = {
    rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: env.AUTH_RATE_LIMIT_WINDOW },
  }

  app.post<{ Body?: { email?: unknown; password?: unknown } }>(
    '/v1/auth/signup',
    { config: authRateLimit },
    async (request, reply) => {
      const email = normalizeEmail(request.body?.email)
      if (!email) {
        await reply.code(400).send({ error: 'invalid_email' })
        return
      }
      const password = request.body?.password
      if (typeof password !== 'string' || password.length < 8 || password.length > MAX_PASSWORD_LEN) {
        await reply.code(400).send({ error: 'weak_password' })
        return
      }

      const passwordHash = await argonHash(password) // argon2id is the default algorithm
      const user = await repo.createUser({ id: ulid(), email, passwordHash })
      if (!user) {
        await reply.code(409).send({ error: 'email_taken' })
        return
      }

      const token = await issueSession(repo, user.id)
      await reply.code(201).send({ token, user: { id: user.id, email: user.email } })
    },
  )

  app.post<{ Body?: { email?: unknown; password?: unknown } }>(
    '/v1/auth/login',
    { config: authRateLimit },
    async (request, reply) => {
      const email = normalizeEmail(request.body?.email)
      const password = request.body?.password
      const user = email ? await repo.getUserByEmail(email) : null

      // Uniform 401 for bad email AND bad password — never reveal which. Reject
      // over-long passwords cheaply before spending argon2 (DoS guard); an
      // over-cap password can never be a valid credential anyway.
      const passwordOk = typeof password === 'string' && password.length <= MAX_PASSWORD_LEN
      const ok =
        passwordOk &&
        (await argonVerify(user?.passwordHash ?? (await dummyHash()), password as string)) &&
        user !== null
      if (!ok || !user) {
        await reply.code(401).send({ error: 'unauthorized' })
        return
      }

      const token = await issueSession(repo, user.id)
      await reply.code(200).send({ token, user: { id: user.id, email: user.email } })
    },
  )

  app.post('/v1/auth/logout', { preHandler: authenticate }, async (request, reply) => {
    // Revokes the presented token. Only session tokens are revocable; a device
    // token is an identity, not a session — logout is a no-op for it.
    if (request.principal!.kind === 'user') {
      await repo.deleteSession(sha256Hex(request.authToken!))
    }
    await reply.code(204).send()
  })

  app.get('/v1/me', { preHandler: authenticate }, async (request, reply) => {
    const principal = request.principal!
    const usage = await usageReport(repo, env, principal.key)
    const user =
      principal.kind === 'user' ? { id: principal.id, email: principal.email } : null
    await reply.code(200).send({ user, usage })
  })

  app.post<{ Body?: { deviceToken?: unknown } }>(
    '/v1/auth/claim-device',
    // Rate-limited (finding H9): re-owning docs is a sensitive mutation, so it
    // gets the same hard per-IP bucket as signup/login rather than the global one.
    { preHandler: authenticate, config: authRateLimit },
    async (request, reply) => {
      const principal = request.principal!
      if (principal.kind !== 'user') {
        await reply.code(403).send({ error: 'forbidden' })
        return
      }
      const deviceToken = request.body?.deviceToken
      if (typeof deviceToken !== 'string' || !deviceToken) {
        await reply.code(400).send({ error: 'bad_request', detail: 'deviceToken required' })
        return
      }
      if (!(await repo.deviceExists(deviceToken))) {
        await reply.code(404).send({ error: 'not_found' })
        return
      }
      const claimed = await repo.claimDocs(`device:${deviceToken}`, principal.key)
      // Audit log (finding H9): who claimed which device, and how many docs moved.
      request.log.info(
        { event: 'claim_device', account: principal.key, deviceToken: sha256Hex(deviceToken), claimed },
        'device claimed',
      )
      await reply.code(200).send({ claimed })
    },
  )

  // POST /v1/signal-ticket (auth) — mint a single-use, ~60s ticket so the
  // long-lived bearer need not travel in the signaling WS `?token=` query string
  // (finding H9). The socket presents it as `?ticket=`. `?token=` still works but
  // is deprecated (contract §4).
  app.post('/v1/signal-ticket', { preHandler: authenticate }, async (request, reply) => {
    const ticket = tickets.issue(request.principal!)
    await reply.code(201).send({ ticket, expiresIn: 60 })
  })
}
