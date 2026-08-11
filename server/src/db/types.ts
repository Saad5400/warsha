/**
 * Persistence port. The HTTP routes depend only on this interface, so the
 * Drizzle/Postgres implementation can be swapped for an in-memory fake in tests.
 * Phase 2 extends the same port with users, sessions, ACLs and usage.
 */

/** Who can do what with a doc when they merely present its id. */
export type LinkAccess = 'editor' | 'viewer' | 'none'

/** Role grantable through the per-email ACL (owner is not an ACL role). */
export type AclRole = 'editor' | 'viewer'

export interface DocRow {
  id: string
  /** Owning principal key: `device:<token>` | `user:<id>`. Null only on legacy rows. */
  owner: string | null
  version: number
  s3Key: string | null
  name: string | null
  linkAccess: LinkAccess
  /** Byte size of the committed snapshot (quota accounting). */
  sizeBytes: number
  updatedAt: Date | null
}

export interface UserRow {
  id: string
  email: string
  passwordHash: string
  createdAt: Date | null
}

export interface SessionRow {
  tokenHash: string
  userId: string
  expiresAt: Date
}

export interface AclEntry {
  email: string
  role: AclRole
}

export interface Usage {
  docs: number
  bytes: number
}

/** Quota ceilings applied atomically inside a write, keyed off the owner. */
export interface QuotaGuard {
  maxDocs: number
  maxBytes: number
}

/** Result of a quota-guarded explicit create (`POST /v1/docs`). */
export type CreateDocResult =
  | { status: 'created'; row: DocRow }
  | { status: 'quota'; usage: Usage }

/** Result of the quota-guarded create-on-first-PUT. */
export type CreateFirstVersionResult =
  | { status: 'created'; version: number }
  | { status: 'conflict' }
  | { status: 'quota'; usage: Usage }

/** Result of a quota-guarded compare-and-swap update. */
export type CasResult =
  | { status: 'ok'; version: number }
  | { status: 'stale' }
  | { status: 'quota'; usage: Usage }

export interface CreateDocInput {
  id: string
  owner: string | null
  name: string | null
}

export interface DocRepo {
  /**
   * Explicit create (`POST /v1/docs`) at version 0. When `quota` is supplied the
   * doc-count ceiling is enforced atomically (same transaction, per-owner lock)
   * so N concurrent creates cannot all read "under limit" and all insert.
   */
  createDoc(input: CreateDocInput, quota?: QuotaGuard): Promise<CreateDocResult>
  getDoc(id: string): Promise<DocRow | null>
  /**
   * Atomic, quota-guarded create-on-first-PUT. INSERTs the doc at version 1
   * pointing at `s3Key`, iff no row with this id exists yet AND the owner is
   * within `quota` (doc count + bytes). The quota check + insert run in one
   * transaction under a per-owner advisory lock, so concurrent creates cannot
   * race past the cap. `name` is null on this path (canonical create carries none).
   * Returns `{status:'created',version:1}`, `{status:'conflict'}` (id already
   * existed), or `{status:'quota',usage}`.
   */
  createFirstVersion(
    input: { id: string; owner: string; s3Key: string; sizeBytes: number },
    quota: QuotaGuard,
  ): Promise<CreateFirstVersionResult>
  /**
   * Atomic, quota-guarded compare-and-swap: iff the row's current version equals
   * `expected`, set version = expected + 1, store `s3Key` + `sizeBytes`, bump
   * `updatedAt`. When `quota` is supplied and the write grows the doc, the owner's
   * total-bytes ceiling is enforced in the same transaction (per-owner lock).
   * Returns `{status:'ok',version}`, `{status:'stale'}` (version mismatch / lost
   * race), or `{status:'quota',usage}`. Shrinking writes always pass the byte check.
   */
  casBumpVersion(
    id: string,
    expected: number,
    s3Key: string,
    sizeBytes: number,
    quota?: QuotaGuard,
  ): Promise<CasResult>
  /** Patch name and/or link access. Returns the updated row, or null when the id is unknown. */
  updateDocMeta(id: string, patch: { name?: string | null; linkAccess?: LinkAccess }): Promise<DocRow | null>
  /** Delete the doc row (ACL rows cascade). The caller deletes the S3 object. */
  deleteDoc(id: string): Promise<void>
  /**
   * Docs owned by `owner` plus, when `email` is set, docs shared with that email
   * through the ACL. Each row carries the caller's role on it.
   */
  listDocsForPrincipal(owner: string, email: string | null): Promise<Array<DocRow & { role: 'owner' | AclRole }>>
  /** Doc count + total committed snapshot bytes for one owning principal. */
  getUsage(owner: string): Promise<Usage>

  createDevice(token: string): Promise<void>
  deviceExists(token: string): Promise<boolean>

  /** Insert a user. Returns null when the email is already taken. */
  createUser(input: { id: string; email: string; passwordHash: string }): Promise<UserRow | null>
  getUserByEmail(email: string): Promise<UserRow | null>

  createSession(input: { tokenHash: string; userId: string; expiresAt: Date }): Promise<void>
  /** Resolve an unexpired session (expiresAt > now) together with its user. */
  getSessionUser(tokenHash: string, now: Date): Promise<{ session: SessionRow; user: UserRow } | null>
  /** Slide a session's expiry forward. */
  touchSession(tokenHash: string, expiresAt: Date): Promise<void>
  deleteSession(tokenHash: string): Promise<void>

  /** Re-own every doc of `fromOwner` to `toOwner`. Returns how many moved. */
  claimDocs(fromOwner: string, toOwner: string): Promise<number>

  getAclRole(docId: string, email: string): Promise<AclRole | null>
  /** Upsert one (doc, email) → role entry. */
  setAclEntry(docId: string, email: string, role: AclRole): Promise<void>
  /** Remove one ACL entry. Idempotent. */
  deleteAclEntry(docId: string, email: string): Promise<void>
  listAcl(docId: string): Promise<AclEntry[]>

  /** Release underlying connections (Postgres pool). No-op for fakes. */
  close(): Promise<void>
}
