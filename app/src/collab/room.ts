/**
 * The `#room=` URL contract — the live-collaboration twin of sharelink.ts's
 * `#share=`. A room id is a ULID (contract §1): it is at once the WebRTC room
 * name and the blob-store key.
 *
 * It rides in the hash for the same reason the share payload does: a fragment
 * never reaches the server, and — crucially here — it survives the first-visit
 * COOP/COEP service-worker reload (public/coi-serviceworker.js force-reloads
 * once when `!crossOriginIsolated`). So a guest who opens a `#room=` link boots,
 * reloads once, and still has the room id to join afterwards (contract edge #4).
 * Unlike `#share=`, we do NOT clear it after joining — a page reload should
 * rejoin the same room.
 */

const PARAM = '#room='
/** Crockford base32, 26 chars — the ULID alphabet. */
const ROOM_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A fresh room id / doc id. Time-ordered (ULID) so ids sort by creation. */
export function newRoomId(): string {
  let ts = Date.now()
  const time: string[] = []
  for (let i = 9; i >= 0; i--) {
    time[i] = CROCKFORD[ts % 32]
    ts = Math.floor(ts / 32)
  }
  const rand: string[] = []
  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0
  for (let i = 0; i < 16; i++) rand.push(CROCKFORD[bytes[i] % 32])
  return time.join('') + rand.join('')
}

/** Reads `#room=` off the URL without touching it. null = no room / malformed. */
export function peekRoomFromUrl(): string | null {
  if (typeof location === 'undefined') return null
  const hash = location.hash
  if (!hash.startsWith(PARAM)) return null
  const id = hash.slice(PARAM.length)
  return ROOM_RE.test(id) ? id : null
}

/** The joinable link handed to a guest — anchored at the origin root, never the
 *  host's `/p/<id>` (that project id is the host's device-local id and resolves
 *  to nothing on the guest's device; the room join opens/creates the guest's own
 *  project). The room id rides the fragment, so only that reaches the guest. */
export function buildRoomUrl(roomId: string): string {
  return `${location.origin}/${PARAM}${roomId}`
}

/** Writes `#room=<id>` onto the HOST's *current* URL without a navigation, so a
 *  reload rejoins — preserving `/p/<id>` (not buildRoomUrl, which is the clean
 *  guest link) so the host stays on the project it is collaborating on. */
export function setRoomHash(roomId: string): void {
  if (typeof history === 'undefined') return
  history.replaceState(history.state, '', location.pathname + location.search + PARAM + roomId)
}

/** Drops the `#room=` payload — used when the student ends collaboration. */
export function clearRoomHash(): void {
  if (typeof location === 'undefined' || typeof history === 'undefined') return
  if (location.hash.startsWith(PARAM)) history.replaceState(history.state, '', location.pathname + location.search)
}

export function isRoomId(value: string): boolean {
  return ROOM_RE.test(value)
}
