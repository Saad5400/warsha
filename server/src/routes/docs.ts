import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Env } from '../env.js'
import type { AclRole, DocRepo, DocRow, LinkAccess } from '../db/types.js'
import type { BlobStorage } from '../storage/types.js'
import { versionedKey } from '../storage/types.js'
import { makeAuthPreHandler, type BearerResolver, type Principal } from '../auth.js'
import { atLeast, effectiveRole, type Role } from '../access.js'
import { checkQuota, limitsFor } from '../quota.js'
import { isValidUlid, ulid } from '../ulid.js'

export interface DocsDeps {
  env: Env
  repo: DocRepo
  storage: BlobStorage
  resolveBearer: BearerResolver
}

const LINK_ACCESS_VALUES: readonly LinkAccess[] = ['editor', 'viewer', 'none']
const ACL_ROLE_VALUES: readonly AclRole[] = ['editor', 'viewer']

function toBase64(bytes: Uint8Array | null): string {
  if (!bytes || bytes.byteLength === 0) return ''
  return Buffer.from(bytes).toString('base64')
}

/** Parse an `If-Match` header into a version integer. Tolerates ETag quoting. */
function parseIfMatch(header: string | string[] | undefined): number | null {
  if (typeof header !== 'string') return null
  const cleaned = header.trim().replace(/^W\//, '').replace(/^"|"$/g, '')
  if (!/^\d+$/.test(cleaned)) return null
  return Number.parseInt(cleaned, 10)
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.length < 3 || email.length > 254 || !email.includes('@')) return null
  return email
}

/** Delete an orphaned blob without ever failing the request on cleanup. */
async function safeDelete(
  storage: BlobStorage,
  key: string,
  request: FastifyRequest,
): Promise<void> {
  try {
    await storage.delete(key)
  } catch (err) {
    request.log.warn({ err, key }, 'orphan blob cleanup failed')
  }
}

export function registerDocs(app: FastifyInstance, deps: DocsDeps): void {
  const { env, repo, storage, resolveBearer } = deps
  const authenticate = makeAuthPreHandler(resolveBearer)
  const emailSharingEnabled = env.ACCOUNT_EMAIL_SHARING_ENABLED

  /**
   * Reject any `:id` that is not a canonical ULID before it can flow into an S3
   * key (finding H7). Runs after `authenticate` so a missing bearer is still 401.
   */
  async function validateDocId(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    if (!isValidUlid(request.params.id)) {
      await reply.code(400).send({ error: 'bad_request', detail: 'invalid document id' })
    }
  }
  const idGuarded = [authenticate, validateDocId]

  /** Effective role (§7.2): max(owner, ACL by account email, link_access). */
  async function roleFor(doc: DocRow, principal: Principal): Promise<Role> {
    const acl =
      emailSharingEnabled && principal.email ? await repo.getAclRole(doc.id, principal.email) : null
    return effectiveRole(doc, principal, acl, emailSharingEnabled)
  }

  /**
   * Owner-only route guard shared by PATCH/DELETE/ACL endpoints: 404 when the
   * doc is unknown, 403 for everyone but the owner, else the doc row.
   */
  async function requireOwner(
    id: string,
    principal: Principal,
    reply: FastifyReply,
  ): Promise<DocRow | null> {
    const doc = await repo.getDoc(id)
    if (!doc) {
      await reply.code(404).send({ error: 'not_found' })
      return null
    }
    if ((await roleFor(doc, principal)) !== 'owner') {
      await reply.code(403).send({ error: 'forbidden' })
      return null
    }
    return doc
  }

  // GET /v1/docs — docs owned by + shared with (ACL by email) the principal.
  app.get('/v1/docs', { preHandler: authenticate }, async (request, reply) => {
    const principal = request.principal!
    const rows = await repo.listDocsForPrincipal(principal.key, principal.email)
    await reply.code(200).send({
      docs: rows.map((d) => ({
        id: d.id,
        name: d.name,
        version: d.version,
        role: d.role,
        linkAccess: d.linkAccess,
        sizeBytes: d.sizeBytes,
        updatedAt: d.updatedAt ? d.updatedAt.toISOString() : null,
      })),
    })
  })

  // POST /v1/docs — explicit pre-creation of an empty doc at version 0.
  app.post<{ Body?: { name?: string } }>(
    '/v1/docs',
    { preHandler: authenticate },
    async (request, reply) => {
      const principal = request.principal!
      const name = request.body?.name ?? null
      const id = ulid()
      const limits = limitsFor(env, principal.key)
      // Doc-count quota enforced atomically inside the insert (finding H6).
      const result = await repo.createDoc(
        { id, owner: principal.key, name },
        { maxDocs: limits.docs, maxBytes: limits.bytes },
      )
      if (result.status === 'quota') {
        await reply.code(403).send({ error: 'quota_exceeded', usage: { ...result.usage, limits } })
        return
      }
      await reply.code(201).send({ id: result.row.id, version: result.row.version })
    },
  )

  // GET /v1/docs/:id — current state, blob base64. Requires viewer+.
  app.get<{ Params: { id: string } }>(
    '/v1/docs/:id',
    { preHandler: idGuarded },
    async (request, reply) => {
      const doc = await repo.getDoc(request.params.id)
      if (!doc) {
        await reply.code(404).send({ error: 'not_found' })
        return
      }
      if (!atLeast(await roleFor(doc, request.principal!), 'viewer')) {
        await reply.code(403).send({ error: 'forbidden' })
        return
      }
      const bytes = doc.s3Key ? await storage.get(doc.s3Key) : null
      await reply.code(200).send({
        id: doc.id,
        version: doc.version,
        name: doc.name,
        updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
        blob: toBase64(bytes),
      })
    },
  )

  // PUT /v1/docs/:id — compare-and-swap write of a full Yjs snapshot. Editor+.
  app.put<{ Params: { id: string } }>(
    '/v1/docs/:id',
    {
      preHandler: idGuarded,
      // Route-level cap. Bodies over MAX_SNAPSHOT_BYTES are rejected with 413
      // by Fastify before the handler runs (see the octet-stream parser in app.ts).
      bodyLimit: env.MAX_SNAPSHOT_BYTES,
    },
    async (request, reply) => {
      const ifMatch = parseIfMatch(request.headers['if-match'])
      if (ifMatch === null) {
        // Missing/malformed precondition. 428 is the correct HTTP semantic for
        // "you must send If-Match". Clients per the contract always send it.
        await reply.code(428).send({ error: 'precondition_required', detail: 'If-Match header required' })
        return
      }

      const body = request.body
      if (!Buffer.isBuffer(body)) {
        await reply.code(400).send({ error: 'bad_request', detail: 'body must be application/octet-stream' })
        return
      }

      const principal = request.principal!
      const id = request.params.id
      const doc = await repo.getDoc(id)

      // Create-on-first-PUT (client-canonical ids). Room ids are minted client-side,
      // so a fresh room's first BlobSync push lands here before the doc exists.
      // The creator becomes the doc's owner principal.
      if (!doc) {
        // Can't fast-forward a doc that never existed.
        if (ifMatch !== 0) {
          await reply.code(404).send({ error: 'not_found' })
          return
        }

        const limits = limitsFor(env, principal.key)

        // Cheap pre-check to reject the common over-quota case before writing any
        // blob. Not race-safe on its own — the authoritative gate is the atomic
        // quota check inside createFirstVersion below (finding H6).
        const pre = await checkQuota(repo, env, principal.key, {
          newDocs: 1,
          deltaBytes: body.byteLength,
        })
        if (pre) {
          await reply.code(403).send(pre)
          return
        }

        // Same nonce-keyed scheme as updates: write a unique object first, then
        // atomically claim the id at version 1. Concurrent creators race on the
        // INSERT (with quota enforced in the same transaction), not on the blob —
        // the loser's object is GC'd below.
        const createKey = versionedKey(id, 1)
        await storage.put(createKey, new Uint8Array(body))

        const result = await repo.createFirstVersion(
          { id, owner: principal.key, s3Key: createKey, sizeBytes: body.byteLength },
          { maxDocs: limits.docs, maxBytes: limits.bytes },
        )
        if (result.status === 'created') {
          await reply.code(200).send({ version: result.version })
          return
        }
        // Did not commit — our object is an orphan either way.
        await safeDelete(storage, createKey, request)
        if (result.status === 'quota') {
          // Lost the create race to the owner's quota (a concurrent create won a slot).
          await reply.code(403).send({ error: 'quota_exceeded', usage: { ...result.usage, limits } })
          return
        }
        // Conflict: another If-Match:0 PUT already created this id.
        const fresh = await repo.getDoc(id)
        const bytes = fresh?.s3Key ? await storage.get(fresh.s3Key) : null
        await reply.code(409).send({ version: fresh?.version ?? 1, blob: toBase64(bytes) })
        return
      }

      if (!atLeast(await roleFor(doc, principal), 'editor')) {
        await reply.code(403).send({ error: 'forbidden' })
        return
      }

      // Stale version → return current state so the client can applyUpdate + retry.
      if (ifMatch !== doc.version) {
        const bytes = doc.s3Key ? await storage.get(doc.s3Key) : null
        await reply.code(409).send({ version: doc.version, blob: toBase64(bytes) })
        return
      }

      // Bytes quota is charged to the doc's OWNER (their storage grows), not the
      // editor doing the write. Legacy ownerless rows skip the check. This cheap
      // pre-check rejects the common over-quota case before an S3 write; the
      // authoritative, race-safe gate is inside casBumpVersion below (finding H6).
      const ownerLimits = doc.owner ? limitsFor(env, doc.owner) : null
      if (doc.owner && ownerLimits) {
        const overQuota = await checkQuota(repo, env, doc.owner, {
          newDocs: 0,
          deltaBytes: body.byteLength - doc.sizeBytes,
        })
        if (overQuota) {
          await reply.code(403).send(overQuota)
          return
        }
      }

      // Write to a fresh, unique object (never the fixed/shared key), THEN CAS-bump
      // the row to point at it. Because the key is unique per attempt, concurrent
      // writers at the same base version never touch each other's bytes — the atomic
      // CAS is the only thing that promotes one object to "committed". So a 200 always
      // means: the object the row now points at holds exactly this request's bytes.
      const previousKey = doc.s3Key // committed object being superseded (null on first write)
      const newKey = versionedKey(doc.id, ifMatch + 1)
      await storage.put(newKey, new Uint8Array(body))

      const result = await repo.casBumpVersion(
        doc.id,
        ifMatch,
        newKey,
        body.byteLength,
        ownerLimits ? { maxDocs: ownerLimits.docs, maxBytes: ownerLimits.bytes } : undefined,
      )
      if (result.status === 'ok') {
        // Won: the previous committed object is now an orphan — best-effort GC it so
        // storage does not grow unbounded. Never fail the request on cleanup.
        if (previousKey) await safeDelete(storage, previousKey, request)
        await reply.code(200).send({ version: result.version })
        return
      }
      // Did not commit — our object is orphaned; best-effort delete it.
      await safeDelete(storage, newKey, request)
      if (result.status === 'quota' && doc.owner) {
        const limits = limitsFor(env, doc.owner)
        await reply.code(403).send({ error: 'quota_exceeded', usage: { ...result.usage, limits } })
        return
      }
      // Stale / lost race: return the winner's current state to merge+retry.
      const fresh = await repo.getDoc(doc.id)
      const bytes = fresh?.s3Key ? await storage.get(fresh.s3Key) : null
      await reply.code(409).send({ version: fresh?.version ?? doc.version, blob: toBase64(bytes) })
    },
  )

  // PATCH /v1/docs/:id {name?, linkAccess?} — owner only.
  app.patch<{ Params: { id: string }; Body?: { name?: unknown; linkAccess?: unknown } }>(
    '/v1/docs/:id',
    { preHandler: idGuarded },
    async (request, reply) => {
      const doc = await requireOwner(request.params.id, request.principal!, reply)
      if (!doc) return

      const patch: { name?: string | null; linkAccess?: LinkAccess } = {}
      const { name, linkAccess } = request.body ?? {}
      if (name !== undefined) {
        if (name !== null && typeof name !== 'string') {
          await reply.code(400).send({ error: 'bad_request', detail: 'name must be a string or null' })
          return
        }
        patch.name = name
      }
      if (linkAccess !== undefined) {
        if (!LINK_ACCESS_VALUES.includes(linkAccess as LinkAccess)) {
          await reply.code(400).send({ error: 'bad_request', detail: 'linkAccess must be editor|viewer|none' })
          return
        }
        patch.linkAccess = linkAccess as LinkAccess
      }

      const updated = (await repo.updateDocMeta(doc.id, patch))!
      await reply.code(200).send({
        id: updated.id,
        name: updated.name,
        linkAccess: updated.linkAccess,
        version: updated.version,
        updatedAt: updated.updatedAt ? updated.updatedAt.toISOString() : null,
      })
    },
  )

  // DELETE /v1/docs/:id — owner only. Deletes the S3 blob + all rows.
  app.delete<{ Params: { id: string } }>(
    '/v1/docs/:id',
    { preHandler: idGuarded },
    async (request, reply) => {
      const doc = await requireOwner(request.params.id, request.principal!, reply)
      if (!doc) return
      if (doc.s3Key) await safeDelete(storage, doc.s3Key, request)
      await repo.deleteDoc(doc.id)
      await reply.code(204).send()
    },
  )

  // GET /v1/docs/:id/acl — owner only. Still readable when email sharing is off
  // (returns the — possibly empty — entry list).
  app.get<{ Params: { id: string } }>(
    '/v1/docs/:id/acl',
    { preHandler: idGuarded },
    async (request, reply) => {
      const doc = await requireOwner(request.params.id, request.principal!, reply)
      if (!doc) return
      await reply.code(200).send({ entries: await repo.listAcl(doc.id) })
    },
  )

  // PUT /v1/docs/:id/acl {email, role} — owner only. Upserts one entry.
  // SECURITY(H2): unverified-email squatting — per-email sharing is gated behind
  // ACCOUNT_EMAIL_SHARING_ENABLED (default off, off in prod) until email
  // verification lands. See contract §7 / §7.2. When off, no grant is created.
  app.put<{ Params: { id: string }; Body?: { email?: unknown; role?: unknown } }>(
    '/v1/docs/:id/acl',
    { preHandler: idGuarded },
    async (request, reply) => {
      const doc = await requireOwner(request.params.id, request.principal!, reply)
      if (!doc) return
      if (!emailSharingEnabled) {
        await reply.code(403).send({ error: 'email_sharing_disabled' })
        return
      }
      const email = normalizeEmail(request.body?.email)
      const role = request.body?.role
      if (!email || !ACL_ROLE_VALUES.includes(role as AclRole)) {
        await reply.code(400).send({ error: 'bad_request', detail: 'email and role (editor|viewer) required' })
        return
      }
      await repo.setAclEntry(doc.id, email, role as AclRole)
      await reply.code(204).send()
    },
  )

  // DELETE /v1/docs/:id/acl/:email — owner only. Idempotent.
  // SECURITY(H2): gated behind ACCOUNT_EMAIL_SHARING_ENABLED (see PUT above).
  app.delete<{ Params: { id: string; email: string } }>(
    '/v1/docs/:id/acl/:email',
    { preHandler: idGuarded },
    async (request, reply) => {
      const doc = await requireOwner(request.params.id, request.principal!, reply)
      if (!doc) return
      if (!emailSharingEnabled) {
        await reply.code(403).send({ error: 'email_sharing_disabled' })
        return
      }
      const email = normalizeEmail(decodeURIComponent(request.params.email))
      if (!email) {
        await reply.code(400).send({ error: 'bad_request', detail: 'invalid email' })
        return
      }
      await repo.deleteAclEntry(doc.id, email)
      await reply.code(204).send()
    },
  )
}
