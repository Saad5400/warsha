/**
 * Blob storage port. S3 (Hetzner S3-compatible; MinIO in dev) is the primary and
 * only implementation in Phase 1. The interface exists so routes stay decoupled
 * from the SDK and so tests can use an in-memory fake.
 */
export interface BlobStorage {
  /** Store the snapshot bytes at `key`, overwriting any existing object. */
  put(key: string, bytes: Uint8Array): Promise<void>
  /** Return the snapshot bytes at `key`, or null if the object does not exist. */
  get(key: string): Promise<Uint8Array | null>
  /** Delete the object at `key`. Idempotent — missing keys are not an error. */
  delete(key: string): Promise<void>
}

/**
 * Immutable, unique-per-write key for a snapshot that is *attempting* to become
 * `version`. The random suffix is load-bearing: two peers editing the same room
 * flush at the same base version and therefore target the same version number, so
 * a bare `docs/<id>/<version>.ydoc` would make them collide on one object — and
 * the CAS loser's orphan cleanup would then delete the winner's committed bytes.
 * A unique key per attempt makes each write its own object; the atomic CAS alone
 * decides which one the doc row points at (i.e. which is "committed").
 */
export function versionedKey(docId: string, version: number): string {
  return `docs/${docId}/${version}-${randomSuffix()}.ydoc`
}

function randomSuffix(): string {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}
