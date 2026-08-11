/**
 * Minimal ULID generator (Crockford base32, 48-bit timestamp + 80-bit randomness).
 * Kept dependency-free on purpose. A doc id is simultaneously the WebRTC room name
 * and the S3 blob-store key, so it must be URL/path-safe — Crockford base32 is.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford: no I, L, O, U
const ENCODING_LEN = ENCODING.length // 32
const TIME_LEN = 10
const RANDOM_LEN = 16

function encodeTime(now: number): string {
  let out = ''
  let t = now
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = t % ENCODING_LEN
    out = ENCODING[mod] + out
    t = (t - mod) / ENCODING_LEN
  }
  return out
}

function encodeRandom(): string {
  // 256 is an exact multiple of 32, so (byte % 32) is uniform — no modulo bias.
  const bytes = new Uint8Array(RANDOM_LEN)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[bytes[i]! % ENCODING_LEN]
  }
  return out
}

export function ulid(seedTime: number = Date.now()): string {
  return encodeTime(seedTime) + encodeRandom()
}

/**
 * Canonical-ULID guard for values that flow into an S3 key / WebRTC room name.
 * 26 chars, uppercase Crockford base32 (no I/L/O/U), first char in `[0-7]`
 * (48-bit timestamp fits 10 base32 chars). Rejecting anything else at the route
 * boundary prevents `/`, `.`, `..`, control chars and other key-injection /
 * traversal material from ever reaching `docs/<id>/...`.
 */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/
export function isValidUlid(id: string): boolean {
  return typeof id === 'string' && ULID_RE.test(id)
}
