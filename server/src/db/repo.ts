import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { DbHandle, Database } from './client.js'
import { devices, docAcl, docs, sessions, users } from './schema.js'
import type {
  AclEntry,
  AclRole,
  CasResult,
  CreateDocInput,
  CreateDocResult,
  CreateFirstVersionResult,
  DocRepo,
  DocRow,
  LinkAccess,
  QuotaGuard,
  Usage,
  UserRow,
} from './types.js'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Serialize every quota decision for one owner. Concurrent transactions holding
 * this lock block each other, so a count/sum read taken *after* the lock sees
 * committed inserts from the transaction that just released — closing the
 * check-then-insert race that a bare `WHERE count < max` subquery leaves open
 * under READ COMMITTED.
 */
async function lockOwner(tx: Tx, owner: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner}))`)
}

async function usageForOwner(tx: Tx, owner: string): Promise<Usage> {
  const [row] = await tx
    .select({
      docs: sql<number>`count(*)`,
      bytes: sql<string>`coalesce(sum(${docs.sizeBytes}), 0)`,
    })
    .from(docs)
    .where(eq(docs.owner, owner))
  return { docs: Number(row?.docs ?? 0), bytes: Number(row?.bytes ?? 0) }
}

function toRow(r: typeof docs.$inferSelect): DocRow {
  return {
    id: r.id,
    owner: r.owner,
    version: r.version,
    s3Key: r.s3Key,
    name: r.name,
    linkAccess: r.linkAccess as LinkAccess,
    sizeBytes: r.sizeBytes,
    updatedAt: r.updatedAt,
  }
}

function toUser(r: typeof users.$inferSelect): UserRow {
  return { id: r.id, email: r.email, passwordHash: r.passwordHash, createdAt: r.createdAt }
}

/** Drizzle/Postgres implementation of the DocRepo port. */
export function createDrizzleRepo(handle: DbHandle): DocRepo {
  const { db, sql: pg } = handle

  return {
    async createDoc(input: CreateDocInput, quota?: QuotaGuard): Promise<CreateDocResult> {
      if (!quota || input.owner === null) {
        const [row] = await db
          .insert(docs)
          .values({ id: input.id, owner: input.owner, name: input.name, version: 0 })
          .returning()
        return { status: 'created', row: toRow(row!) }
      }
      const owner = input.owner
      return await db.transaction(async (tx) => {
        await lockOwner(tx, owner)
        const usage = await usageForOwner(tx, owner)
        if (usage.docs + 1 > quota.maxDocs) return { status: 'quota', usage }
        const [row] = await tx
          .insert(docs)
          .values({ id: input.id, owner, name: input.name, version: 0 })
          .returning()
        return { status: 'created', row: toRow(row!) }
      })
    },

    async getDoc(id: string): Promise<DocRow | null> {
      const [row] = await db.select().from(docs).where(eq(docs.id, id)).limit(1)
      return row ? toRow(row) : null
    },

    async createFirstVersion(
      input: { id: string; owner: string; s3Key: string; sizeBytes: number },
      quota: QuotaGuard,
    ): Promise<CreateFirstVersionResult> {
      // Quota check + insert in one transaction, serialized per owner, so N
      // concurrent create-on-first-PUTs to distinct ids cannot all read
      // "under limit" and all insert (finding H6).
      return await db.transaction(async (tx) => {
        await lockOwner(tx, input.owner)
        const [existing] = await tx
          .select({ id: docs.id })
          .from(docs)
          .where(eq(docs.id, input.id))
          .limit(1)
        if (existing) return { status: 'conflict' }

        const usage = await usageForOwner(tx, input.owner)
        const overDocs = usage.docs + 1 > quota.maxDocs
        const overBytes = input.sizeBytes > 0 && usage.bytes + input.sizeBytes > quota.maxBytes
        if (overDocs || overBytes) return { status: 'quota', usage }

        const rows = await tx
          .insert(docs)
          .values({
            id: input.id,
            owner: input.owner,
            version: 1,
            s3Key: input.s3Key,
            sizeBytes: input.sizeBytes,
            name: null,
          })
          .onConflictDoNothing({ target: docs.id })
          .returning({ version: docs.version })
        return rows.length > 0 ? { status: 'created', version: rows[0]!.version } : { status: 'conflict' }
      })
    },

    async casBumpVersion(
      id: string,
      expected: number,
      s3Key: string,
      sizeBytes: number,
      quota?: QuotaGuard,
    ): Promise<CasResult> {
      return await db.transaction(async (tx) => {
        const [current] = await tx.select().from(docs).where(eq(docs.id, id)).limit(1)
        if (!current || current.version !== expected) return { status: 'stale' }

        // Bytes quota is charged to the doc's owner and only when the write grows
        // the doc. Serialized per owner so concurrent growth cannot race the cap.
        if (quota && current.owner && sizeBytes > current.sizeBytes) {
          await lockOwner(tx, current.owner)
          const usage = await usageForOwner(tx, current.owner)
          const projected = usage.bytes - current.sizeBytes + sizeBytes
          if (projected > quota.maxBytes) return { status: 'quota', usage }
        }

        const rows = await tx
          .update(docs)
          .set({ version: sql`${docs.version} + 1`, s3Key, sizeBytes, updatedAt: new Date() })
          .where(and(eq(docs.id, id), eq(docs.version, expected)))
          .returning({ version: docs.version })
        return rows.length > 0 ? { status: 'ok', version: rows[0]!.version } : { status: 'stale' }
      })
    },

    async updateDocMeta(
      id: string,
      patch: { name?: string | null; linkAccess?: LinkAccess },
    ): Promise<DocRow | null> {
      const set: Partial<typeof docs.$inferInsert> = { updatedAt: new Date() }
      if (patch.name !== undefined) set.name = patch.name
      if (patch.linkAccess !== undefined) set.linkAccess = patch.linkAccess
      const [row] = await db.update(docs).set(set).where(eq(docs.id, id)).returning()
      return row ? toRow(row) : null
    },

    async deleteDoc(id: string): Promise<void> {
      await db.delete(docs).where(eq(docs.id, id)) // doc_acl rows cascade
    },

    async listDocsForPrincipal(
      owner: string,
      email: string | null,
    ): Promise<Array<DocRow & { role: 'owner' | AclRole }>> {
      const owned = await db
        .select()
        .from(docs)
        .where(eq(docs.owner, owner))
        .orderBy(desc(docs.updatedAt))
      const out = new Map<string, DocRow & { role: 'owner' | AclRole }>()
      for (const r of owned) out.set(r.id, { ...toRow(r), role: 'owner' })

      if (email) {
        const shared = await db
          .select({ doc: docs, role: docAcl.role })
          .from(docAcl)
          .innerJoin(docs, eq(docAcl.docId, docs.id))
          .where(eq(docAcl.email, email))
        for (const { doc, role } of shared) {
          if (!out.has(doc.id)) out.set(doc.id, { ...toRow(doc), role: role as AclRole })
        }
      }
      return [...out.values()]
    },

    async getUsage(owner: string): Promise<Usage> {
      const [row] = await db
        .select({
          docs: sql<number>`count(*)`,
          bytes: sql<string>`coalesce(sum(${docs.sizeBytes}), 0)`,
        })
        .from(docs)
        .where(eq(docs.owner, owner))
      return { docs: Number(row?.docs ?? 0), bytes: Number(row?.bytes ?? 0) }
    },

    async createDevice(token: string): Promise<void> {
      await db.insert(devices).values({ token }).onConflictDoNothing()
    },

    async deviceExists(token: string): Promise<boolean> {
      const [row] = await db
        .select({ token: devices.token })
        .from(devices)
        .where(eq(devices.token, token))
        .limit(1)
      return row !== undefined
    },

    async createUser(input: {
      id: string
      email: string
      passwordHash: string
    }): Promise<UserRow | null> {
      // Race-safe uniqueness: the conflict target is the email unique index.
      const rows = await db
        .insert(users)
        .values(input)
        .onConflictDoNothing({ target: users.email })
        .returning()
      return rows.length > 0 ? toUser(rows[0]!) : null
    },

    async getUserByEmail(email: string): Promise<UserRow | null> {
      const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
      return row ? toUser(row) : null
    },

    async createSession(input: {
      tokenHash: string
      userId: string
      expiresAt: Date
    }): Promise<void> {
      await db.insert(sessions).values(input)
    },

    async getSessionUser(tokenHash: string, now: Date) {
      const [row] = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
        .limit(1)
      if (!row) return null
      return {
        session: {
          tokenHash: row.session.tokenHash,
          userId: row.session.userId,
          expiresAt: row.session.expiresAt,
        },
        user: toUser(row.user),
      }
    },

    async touchSession(tokenHash: string, expiresAt: Date): Promise<void> {
      await db.update(sessions).set({ expiresAt }).where(eq(sessions.tokenHash, tokenHash))
    },

    async deleteSession(tokenHash: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
    },

    async claimDocs(fromOwner: string, toOwner: string): Promise<number> {
      const rows = await db
        .update(docs)
        .set({ owner: toOwner })
        .where(eq(docs.owner, fromOwner))
        .returning({ id: docs.id })
      return rows.length
    },

    async getAclRole(docId: string, email: string): Promise<AclRole | null> {
      const [row] = await db
        .select({ role: docAcl.role })
        .from(docAcl)
        .where(and(eq(docAcl.docId, docId), eq(docAcl.email, email)))
        .limit(1)
      return row ? (row.role as AclRole) : null
    },

    async setAclEntry(docId: string, email: string, role: AclRole): Promise<void> {
      await db
        .insert(docAcl)
        .values({ docId, email, role })
        .onConflictDoUpdate({ target: [docAcl.docId, docAcl.email], set: { role } })
    },

    async deleteAclEntry(docId: string, email: string): Promise<void> {
      await db.delete(docAcl).where(and(eq(docAcl.docId, docId), eq(docAcl.email, email)))
    },

    async listAcl(docId: string): Promise<AclEntry[]> {
      const rows = await db
        .select({ email: docAcl.email, role: docAcl.role })
        .from(docAcl)
        .where(eq(docAcl.docId, docId))
      return rows.map((r) => ({ email: r.email, role: r.role as AclRole }))
    },

    async close(): Promise<void> {
      await pg.end({ timeout: 5 })
    },
  }
}
