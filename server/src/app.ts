import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import type { Env } from './env.js'
import type { DocRepo } from './db/types.js'
import type { BlobStorage } from './storage/types.js'
import { createDb } from './db/client.js'
import { createDrizzleRepo } from './db/repo.js'
import { createS3Storage, s3OptionsFromEnv } from './storage/s3.js'
import { makeBearerResolver } from './auth.js'
import { createSignalTicketStore } from './tickets.js'
import { registerHealth } from './routes/health.js'
import { registerDevices } from './routes/devices.js'
import { registerAuth } from './routes/auth.js'
import { registerDocs } from './routes/docs.js'
import { registerSync } from './routes/sync.js'

export interface BuildAppOptions {
  env: Env
  /** Inject a repo (tests). Falls back to a Drizzle/Postgres repo built from env. */
  repo?: DocRepo
  /** Inject storage (tests). Falls back to S3 built from env. */
  storage?: BlobStorage
  /** Enable Fastify's logger. Off by default (tests stay quiet). */
  logger?: boolean
}

/**
 * Assemble the Fastify app. Dependencies (repo, storage) are injectable so the
 * routes can be unit-tested with in-memory fakes and no Postgres/S3 running.
 * When not injected, real Drizzle/S3 implementations are built from env; those
 * are tracked on the instance and closed in `onClose`.
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { env } = opts

  const app = Fastify({
    logger: opts.logger ? { level: env.LOG_LEVEL } : false,
    // Global default cap; the PUT route raises its own to MAX_SNAPSHOT_BYTES.
    bodyLimit: 1 * 1024 * 1024,
    // Behind Traefik, request.ip must reflect the real client (X-Forwarded-For)
    // so per-IP rate-limit buckets don't collapse to the proxy (finding H3).
    // Defaults: dev=false, prod=1 hop. Traefik MUST *overwrite* X-Forwarded-For.
    trustProxy: env.TRUST_PROXY,
  })

  // Generic 500s in production (finding H8): never leak Postgres/S3 error text to
  // clients. Client errors (4xx that carry a statusCode — validation, 413, 429)
  // keep their message; 5xx are logged in full and returned as a generic body.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500
    if (status >= 500) {
      request.log.error({ err }, 'request failed')
      const body = env.IS_PRODUCTION
        ? { error: 'internal_error' }
        : { error: 'internal_error', message: err.message }
      void reply.code(status).send(body)
      return
    }
    void reply.code(status).send({ error: err.code ?? 'error', message: err.message })
  })

  // Raw-bytes parser for Yjs snapshots. `parseAs: 'buffer'` makes Fastify enforce
  // the route bodyLimit and throw 413 (FST_ERR_CTP_BODY_TOO_LARGE) before the handler.
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body)
    },
  )

  // CORS + CORP. The client runs cross-origin-isolated (COEP: require-corp), so
  // browser calls from the app origin to this API need CORS headers, and the
  // preflight (PUT carries Authorization/If-Match) must be answered. `*` reflects
  // any origin (dev convenience); otherwise only the configured origins are allowed.
  const allowAny = env.CORS_ORIGINS.includes('*')
  await app.register(cors, {
    origin: allowAny ? true : env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'If-Match', 'Content-Type'],
    maxAge: 86400,
  })
  // Belt-and-suspenders for the COEP page: allow cross-origin reads of any response.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin')
    return payload
  })

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  })

  // Cap the WS payload so a socket can't stream unbounded frames at us (finding
  // H4). The live sync layer must fit a full-state sync frame (a fresh joiner's
  // SyncStep2 can be the whole doc), so allow the durable per-snapshot cap plus a
  // protocol-overhead margin — but no more.
  await app.register(websocket, {
    options: { maxPayload: env.MAX_SNAPSHOT_BYTES + 64 * 1024 },
  })

  // Build or accept dependencies.
  let ownedRepo: DocRepo | null = null
  const repo = opts.repo ?? (ownedRepo = createDrizzleRepo(createDb(env.DATABASE_URL)))
  const storage = opts.storage ?? createS3Storage(s3OptionsFromEnv(env))

  // Close resources we created (not injected ones — the test owns those).
  app.addHook('onClose', async () => {
    if (ownedRepo) await ownedRepo.close()
  })

  // One auth resolver: every bearer (dev secret / session / device) becomes a
  // principal here, and every authenticated route + the signal WS share it.
  const resolveBearer = makeBearerResolver({
    repo,
    devSharedSecret: env.DEV_SHARED_SECRET,
    devBearerEnabled: env.DEV_BEARER_ENABLED,
  })

  // Single-use socket tickets (finding H9): minted by an authed HTTP call,
  // consumed by the WS. Shared between the auth route (issuer) and sync (consumer).
  const tickets = createSignalTicketStore()

  // Routes.
  registerHealth(app)
  registerDevices(app, env, repo)
  registerAuth(app, { env, repo, resolveBearer, tickets })
  registerDocs(app, { env, repo, storage, resolveBearer })
  registerSync(app, {
    repo,
    resolveBearer,
    tickets,
    emailSharingEnabled: env.ACCOUNT_EMAIL_SHARING_ENABLED,
    maxSnapshotBytes: env.MAX_SNAPSHOT_BYTES,
  })

  return app
}
