import { bigint, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * One row per Yjs project document. The server is a dumb blob store: it never
 * runs Yjs and never merges. `version` is a server-owned monotonic integer used
 * for compare-and-swap on PUT. The snapshot bytes live in S3 at `s3_key`.
 */
export const docs = pgTable(
  'docs',
  {
    /** ULID. Also the WebRTC room name and the S3 key prefix. */
    id: text('id').primaryKey(),
    /** Owning principal: `device:<token>` or `user:<id>`. Null only on legacy rows. */
    owner: text('owner'),
    /** Server-owned monotonic version. CAS target on PUT. */
    version: integer('version').notNull().default(0),
    /** S3 object key of the current snapshot; null until the first PUT. */
    s3Key: text('s3_key'),
    name: text('name'),
    /** Anyone presenting the doc id gets this role: 'editor' | 'viewer' | 'none'. */
    linkAccess: text('link_access').notNull().default('editor'),
    /** Byte size of the committed snapshot. Summed per owner for quota enforcement. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [index('docs_owner_idx').on(t.owner)],
)

/** A device: an anonymous first-class principal. The opaque token is its id. */
export const devices = pgTable('devices', {
  token: text('token').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

/** An email+password account. Emails are stored lowercased/trimmed, unique. */
export const users = pgTable('users', {
  /** ULID. */
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  /** argon2id PHC string. */
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

/**
 * A login session. The bearer token itself is never stored — only its sha256
 * hex — so a DB leak does not leak usable tokens. Sliding 90-day expiry.
 */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

/** Google-Docs-style per-email share: (doc, email) → 'editor' | 'viewer'. */
export const docAcl = pgTable(
  'doc_acl',
  {
    docId: text('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.docId, t.email] }), index('doc_acl_email_idx').on(t.email)],
)

export type DocRecord = typeof docs.$inferSelect
export type DeviceRecord = typeof devices.$inferSelect
export type UserRecord = typeof users.$inferSelect
export type SessionRecord = typeof sessions.$inferSelect
export type DocAclRecord = typeof docAcl.$inferSelect
