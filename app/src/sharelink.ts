import { deflateSync, inflateSync, strToU8, strFromU8 } from 'fflate'
import type { FsSnapshot } from './fs/types'
import { ZIP_LIMITS, safePath } from './zip'

/**
 * "Share as link" — the whole project folded into the URL itself.
 *
 * The payload rides in the hash fragment (`#share=…`), never the query string:
 * a fragment is not sent to the server, so no server, proxy or CDN limit
 * applies and the shared code never appears in an access log. What remains is
 * social limits — chat apps get unhappy somewhere past a few tens of KB of
 * URL — and those are what `MAX_ENCODED_CHARS` guards. A typical starter-sized
 * project (a few KB of source) deflates to a link of about a thousand
 * characters, which pastes anywhere and even fits a QR code.
 *
 * A decoded link is attacker-controlled input exactly like a .zip entry, so
 * every path goes through the same `safePath` refusal and the same size/count
 * ceilings as the zip importer. Reject-whole rather than skip-some: a link a
 * teacher actually made never contains a bad path, so a bad path means the
 * link is damaged or crafted, and a partial import would be a silent surprise.
 */

export interface SharedProject {
  name: string
  /** The file Run should start from, when the sharer had one chosen. */
  entry: string | null
  snapshot: FsSnapshot
}

export const LINK_LIMITS = {
  /** Cap on the encoded payload, not source — past this a .zip is the honest answer;
   *  also the pre-allocation guard on decode (see MAX_INFLATED_BYTES). */
  MAX_ENCODED_CHARS: 120_000,
  /** A 120K-char payload can legally inflate to ~90 MB of JSON; anything past
   *  this ceiling is rejected after inflation, having allocated only itself. */
  MAX_INFLATED_BYTES: 16 * 1024 * 1024,
  MAX_NAME_CHARS: 80,
} as const

const PARAM = '#share='

/** Bytes → URL-safe base64 (RFC 4648 §5, unpadded). Chunked: spreading a
 *  whole project into one `String.fromCharCode(...bytes)` call overflows the
 *  argument limit somewhere past ~100 KB. */
function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Wire shape, keys shortened because they repeat per file before compression
 *  helps. `v` gates future format changes. */
interface Payload {
  v: 1
  n: string
  e: string | null
  f: Array<[path: string, content: string]>
  d: string[]
}

/**
 * The full sharable URL for this project, or null when the project is too big
 * to be a link (the caller's cue to suggest the .zip instead).
 */
export function buildShareUrl(name: string, entry: string | null, snapshot: FsSnapshot): string | null {
  const payload: Payload = {
    v: 1,
    n: name.slice(0, LINK_LIMITS.MAX_NAME_CHARS),
    e: entry,
    f: snapshot.files.map((f) => [f.path, f.content]),
    d: snapshot.dirs,
  }
  const data = toBase64Url(deflateSync(strToU8(JSON.stringify(payload)), { level: 9 }))
  if (data.length > LINK_LIMITS.MAX_ENCODED_CHARS) return null
  return `${location.origin}${location.pathname}${PARAM}${data}`
}

/** Strict or nothing — see the module comment for why there is no skip-some. */
function decodePayload(data: string): SharedProject | null {
  if (data.length === 0 || data.length > LINK_LIMITS.MAX_ENCODED_CHARS) return null
  const bytes = fromBase64Url(data)
  if (!bytes) return null
  let raw: unknown
  try {
    const inflated = inflateSync(bytes)
    if (inflated.length > LINK_LIMITS.MAX_INFLATED_BYTES) return null
    raw = JSON.parse(strFromU8(inflated))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Partial<Payload>
  if (p.v !== 1 || typeof p.n !== 'string' || !Array.isArray(p.f) || !Array.isArray(p.d)) return null
  if (p.f.length > ZIP_LIMITS.MAX_ENTRIES) return null

  const seen = new Set<string>()
  const files: FsSnapshot['files'] = []
  for (const entry of p.f) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return null
    const path = safePath(entry[0])
    if (!path || seen.has(path) || entry[1].length > ZIP_LIMITS.MAX_FILE_BYTES) return null
    seen.add(path)
    files.push({ path, content: entry[1] })
  }
  const dirs: string[] = []
  for (const d of p.d) {
    if (typeof d !== 'string') return null
    const dir = safePath(d)
    if (!dir) return null
    dirs.push(dir)
  }

  const name = p.n.replace(/[\u0000-\u001f]/g, '').trim().slice(0, LINK_LIMITS.MAX_NAME_CHARS) || 'Shared project'
  const entryPath = typeof p.e === 'string' && seen.has(p.e) ? p.e : null
  return { name, entry: entryPath, snapshot: { files, dirs } }
}

/**
 * Reads `#share=` off the URL without touching it. null = no share; 'broken' = one that won't decode.
 *
 * `clearShareHash` runs only after import lands: the first visit force-reloads mid-boot to register
 * the COOP/COEP worker, and a hash cleared before that wouldn't survive the reload — left in place,
 * the reload just re-imports and dedup opens what the first pass created.
 */
export function peekSharedFromUrl(): SharedProject | 'broken' | null {
  const hash = location.hash
  if (!hash.startsWith(PARAM)) return null
  return decodePayload(hash.slice(PARAM.length)) ?? 'broken'
}

/** Drops the `#share=` payload from the URL, so a reload of the now-open
 *  project is a normal visit. */
export function clearShareHash(): void {
  if (location.hash.startsWith(PARAM)) history.replaceState(null, '', location.pathname + location.search)
}

/**
 * Whether two snapshots hold the same work. Files only, same as the migration
 * `verifyCopy`: dir bookkeeping (an added empty folder) is not "a change" in
 * the sense that matters — whether this device already has an untouched copy
 * of what the link carries.
 */
export function sameFiles(a: FsSnapshot, b: FsSnapshot): boolean {
  if (a.files.length !== b.files.length) return false
  const byPath = new Map(a.files.map((f) => [f.path, f.content]))
  return b.files.every((f) => byPath.get(f.path) === f.content)
}
