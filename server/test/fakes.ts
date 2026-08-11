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
  SessionRow,
  Usage,
  UserRow,
} from '../src/db/types.js'
import type { BlobStorage } from '../src/storage/types.js'

/** In-memory DocRepo with the same semantics as the Drizzle implementation. */
export class FakeRepo implements DocRepo {
  private docs = new Map<string, DocRow>()
  private devices = new Set<string>()
  private users = new Map<string, UserRow>() // by id
  private sessions = new Map<string, SessionRow>() // by tokenHash
  private acl = new Map<string, Map<string, AclRole>>() // docId -> email -> role

  seed(row: DocRow): void {
    this.docs.set(row.id, { ...row })
  }

  /** Synchronous usage sum — mirrors getUsage without an await. */
  private usageSync(owner: string): Usage {
    let docs = 0
    let bytes = 0
    for (const row of this.docs.values()) {
      if (row.owner === owner) {
        docs += 1
        bytes += row.sizeBytes
      }
    }
    return { docs, bytes }
  }

  async createDoc(input: CreateDocInput, quota?: QuotaGuard): Promise<CreateDocResult> {
    // Atomic (no await before the decisive check + set), mirroring the Drizzle
    // per-owner-locked transaction.
    if (quota && input.owner !== null) {
      const usage = this.usageSync(input.owner)
      if (usage.docs + 1 > quota.maxDocs) return { status: 'quota', usage }
    }
    const row: DocRow = {
      id: input.id,
      owner: input.owner,
      version: 0,
      s3Key: null,
      name: input.name,
      linkAccess: 'editor',
      sizeBytes: 0,
      updatedAt: new Date(),
    }
    this.docs.set(row.id, row)
    return { status: 'created', row: { ...row } }
  }

  async getDoc(id: string): Promise<DocRow | null> {
    const row = this.docs.get(id)
    return row ? { ...row } : null
  }

  async createFirstVersion(
    input: { id: string; owner: string; s3Key: string; sizeBytes: number },
    quota: QuotaGuard,
  ): Promise<CreateFirstVersionResult> {
    // Atomic check-and-set (no await between reads and the set), mirroring the
    // per-owner-locked transaction: exactly one concurrent creator wins, and
    // quota is decided against a consistent view.
    if (this.docs.has(input.id)) return { status: 'conflict' }
    const usage = this.usageSync(input.owner)
    const overDocs = usage.docs + 1 > quota.maxDocs
    const overBytes = input.sizeBytes > 0 && usage.bytes + input.sizeBytes > quota.maxBytes
    if (overDocs || overBytes) return { status: 'quota', usage }
    this.docs.set(input.id, {
      id: input.id,
      owner: input.owner,
      version: 1,
      s3Key: input.s3Key,
      name: null,
      linkAccess: 'editor',
      sizeBytes: input.sizeBytes,
      updatedAt: new Date(),
    })
    return { status: 'created', version: 1 }
  }

  async casBumpVersion(
    id: string,
    expected: number,
    s3Key: string,
    sizeBytes: number,
    quota?: QuotaGuard,
  ): Promise<CasResult> {
    const row = this.docs.get(id)
    if (!row || row.version !== expected) return { status: 'stale' }
    if (quota && row.owner && sizeBytes > row.sizeBytes) {
      const usage = this.usageSync(row.owner)
      const projected = usage.bytes - row.sizeBytes + sizeBytes
      if (projected > quota.maxBytes) return { status: 'quota', usage }
    }
    row.version = expected + 1
    row.s3Key = s3Key
    row.sizeBytes = sizeBytes
    row.updatedAt = new Date()
    return { status: 'ok', version: row.version }
  }

  async updateDocMeta(
    id: string,
    patch: { name?: string | null; linkAccess?: LinkAccess },
  ): Promise<DocRow | null> {
    const row = this.docs.get(id)
    if (!row) return null
    if (patch.name !== undefined) row.name = patch.name
    if (patch.linkAccess !== undefined) row.linkAccess = patch.linkAccess
    row.updatedAt = new Date()
    return { ...row }
  }

  async deleteDoc(id: string): Promise<void> {
    this.docs.delete(id)
    this.acl.delete(id) // cascade
  }

  async listDocsForPrincipal(
    owner: string,
    email: string | null,
  ): Promise<Array<DocRow & { role: 'owner' | AclRole }>> {
    const out = new Map<string, DocRow & { role: 'owner' | AclRole }>()
    for (const row of this.docs.values()) {
      if (row.owner === owner) out.set(row.id, { ...row, role: 'owner' })
    }
    if (email) {
      for (const [docId, entries] of this.acl) {
        const role = entries.get(email)
        const row = this.docs.get(docId)
        if (role && row && !out.has(docId)) out.set(docId, { ...row, role })
      }
    }
    return [...out.values()]
  }

  async getUsage(owner: string): Promise<Usage> {
    let docs = 0
    let bytes = 0
    for (const row of this.docs.values()) {
      if (row.owner === owner) {
        docs += 1
        bytes += row.sizeBytes
      }
    }
    return { docs, bytes }
  }

  async createDevice(token: string): Promise<void> {
    this.devices.add(token)
  }

  async deviceExists(token: string): Promise<boolean> {
    return this.devices.has(token)
  }

  async createUser(input: {
    id: string
    email: string
    passwordHash: string
  }): Promise<UserRow | null> {
    for (const u of this.users.values()) {
      if (u.email === input.email) return null
    }
    const row: UserRow = { ...input, createdAt: new Date() }
    this.users.set(row.id, row)
    return { ...row }
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return { ...u }
    }
    return null
  }

  async createSession(input: {
    tokenHash: string
    userId: string
    expiresAt: Date
  }): Promise<void> {
    this.sessions.set(input.tokenHash, { ...input })
  }

  async getSessionUser(
    tokenHash: string,
    now: Date,
  ): Promise<{ session: SessionRow; user: UserRow } | null> {
    const session = this.sessions.get(tokenHash)
    if (!session || session.expiresAt.getTime() <= now.getTime()) return null
    const user = this.users.get(session.userId)
    return user ? { session: { ...session }, user: { ...user } } : null
  }

  async touchSession(tokenHash: string, expiresAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash)
    if (session) session.expiresAt = expiresAt
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash)
  }

  async claimDocs(fromOwner: string, toOwner: string): Promise<number> {
    let moved = 0
    for (const row of this.docs.values()) {
      if (row.owner === fromOwner) {
        row.owner = toOwner
        moved += 1
      }
    }
    return moved
  }

  async getAclRole(docId: string, email: string): Promise<AclRole | null> {
    return this.acl.get(docId)?.get(email) ?? null
  }

  async setAclEntry(docId: string, email: string, role: AclRole): Promise<void> {
    let entries = this.acl.get(docId)
    if (!entries) {
      entries = new Map()
      this.acl.set(docId, entries)
    }
    entries.set(email, role)
  }

  async deleteAclEntry(docId: string, email: string): Promise<void> {
    this.acl.get(docId)?.delete(email)
  }

  async listAcl(docId: string): Promise<AclEntry[]> {
    const entries = this.acl.get(docId)
    if (!entries) return []
    return [...entries.entries()].map(([email, role]) => ({ email, role }))
  }

  async close(): Promise<void> {
    // no-op
  }
}

/** In-memory BlobStorage. */
export class FakeStorage implements BlobStorage {
  private objects = new Map<string, Uint8Array>()

  async put(key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, new Uint8Array(bytes))
  }

  async get(key: string): Promise<Uint8Array | null> {
    const v = this.objects.get(key)
    return v ? new Uint8Array(v) : null
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  /** Test-only: current object keys. */
  keys(): string[] {
    return [...this.objects.keys()]
  }
}
