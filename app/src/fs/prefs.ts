/** Small UI state that isn't project content. localStorage is plenty. */
import type { Locale } from '../i18n/locale'

const KEY = 'warsha.prefs.v1'

export interface Prefs {
  fontSize: number
  /** `null` follows the browser locale; a stored value is an explicit choice and always wins, even if it matches. */
  locale: Locale | null
  /** Whole-UI zoom, 0.7–1.3 step 0.05, 1 = untouched; CSS `zoom` on #root — separate from `fontSize` (editor type only). */
  uiScale: number
  consoleHeight: number
  consoleCollapsed: boolean
  openTabs: string[]
  activePath: string | null
  entryPath: string | null
  /** Which edge Run/Stop sits on — see DESIGN-SPEC §5.3 handedness. */
  hand: 'right' | 'left'
  /** Project to reopen next visit. Tab/entry prefs stay global by design — filtered against whichever project loads. */
  currentProjectId: string | null
  /** Projects pinned to the top of Home. A per-device preference like `recent`, so it lives here, not in the manifest. */
  pinnedProjectIds: string[]
  /** Enabled/disabled editor extensions, by id (see extensions/registry.ts). Sparse — holds only explicit choices, so a descriptor's own default answers for the rest. */
  extensions: Record<string, boolean>
  /** Which local project a live-collab room materialises into, by room id. Lets a
   *  reload (host or guest) rejoin the same project instead of spawning duplicates. */
  roomProjects: Record<string, string>
  /** The reverse mapping: project id → its room id. Re-starting collaboration on a
   *  project reuses its room, so previously shared links keep working. */
  projectRooms: Record<string, string>
  /** Room ids THIS device started (via `start()`), i.e. the ones it owns. Written
   *  only on host-start — a guest join never adds here — so a reload can tell "I
   *  started this" apart from "I joined this" and restore owner UI (share controls +
   *  live-meta authorship) even though the rejoin uses join semantics (M2). The
   *  room↔project maps can't answer this: a guest writes those too, to rejoin its
   *  materialised project. */
  ownedRooms: string[]
  /** Phase-2 account session token (`sess_…`). Null when signed out — the app then
   *  falls back to the device/dev bearer. Sent as `Authorization: Bearer` for sync
   *  and sharing. See collab/auth.ts. */
  sessionToken: string | null
  /** The signed-in account, cached so the account UI paints before /v1/me answers.
   *  Cleared with the token on sign-out or a 401 on boot validation. */
  sessionUser: { id: string; email: string } | null
  /** The anonymous device token (`POST /v1/devices`), minted once per device and
   *  persisted (contract §7). It is the no-account principal's bearer — the
   *  fallback when there is no session token. Null until first minted. */
  deviceToken: string | null
}

/** 14px (VS Code default), both densities — touch used to be 15. Function, not a constant, so it's read per-launch. */
const defaultFontSize = () => 14

const defaults: Omit<Prefs, 'fontSize'> = {
  locale: null,
  uiScale: 1,
  consoleHeight: 220,
  consoleCollapsed: false,
  openTabs: [],
  activePath: null,
  entryPath: null,
  hand: 'right',
  currentProjectId: null,
  pinnedProjectIds: [],
  extensions: {},
  roomProjects: {},
  projectRooms: {},
  ownedRooms: [],
  sessionToken: null,
  sessionUser: null,
  deviceToken: null,
}

let cache: Prefs | null = null

export function prefs(): Prefs {
  if (cache) return cache
  const fresh: Prefs = { ...defaults, fontSize: defaultFontSize() }
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? { ...fresh, ...(JSON.parse(raw) as Partial<Prefs>) } : fresh
  } catch {
    cache = fresh
  }
  return cache
}

export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...prefs(), ...patch }
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}

/** Parse the on-disk prefs fresh, bypassing this tab's module cache. Null when
 *  absent or unparseable. */
function parsedStoredPrefs(): Partial<Prefs> | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<Prefs>) : null
  } catch {
    return null
  }
}

/**
 * Cross-tab-safe write for keys a SIBLING tab may also be writing (the auth tokens
 * — sessionToken/sessionUser/deviceToken, contract §7). A plain `setPrefs`
 * serialises this tab's whole module cache, so it silently reverts any key another
 * tab changed since we loaded (the reported token/room-map clobber, M3). This
 * overlays a FRESH read of localStorage on our cache before applying the patch, so
 * a concurrent tab's write survives ours. The room-map writers below use the same
 * read-fresh-then-merge discipline.
 */
export function setPrefsFresh(patch: Partial<Prefs>): void {
  const next = { ...prefs(), ...(parsedStoredPrefs() ?? {}), ...patch }
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}

// ---- room↔project mappings (collab) ------------------------------------------
// These two maps are written from multiple tabs (a host tab and a guest tab share
// localStorage), so unlike ordinary prefs they merge against a FRESH read of
// localStorage rather than trusting this tab's module cache — otherwise tab B's
// whole-object write silently drops the entry tab A just recorded.

function storedRoomMaps(): { roomProjects: Record<string, string>; projectRooms: Record<string, string> } {
  let parsed: Partial<Prefs> | null = null
  try {
    const raw = localStorage.getItem(KEY)
    parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : null
  } catch {
    parsed = cache
  }
  return {
    roomProjects: { ...(parsed?.roomProjects ?? cache?.roomProjects ?? {}) },
    projectRooms: { ...(parsed?.projectRooms ?? cache?.projectRooms ?? {}) },
  }
}

/** Records both directions of a room↔project binding (fresh-merged, cross-tab safe). */
export function rememberRoomMapping(roomId: string, projectId: string): void {
  const maps = storedRoomMaps()
  maps.roomProjects[roomId] = projectId
  maps.projectRooms[projectId] = roomId
  setPrefs(maps)
}

/** Marks a room as owned by this device (host `start()` only). Fresh-merged so a
 *  sibling tab hosting a different room is not clobbered (M2/M3). */
export function rememberOwnedRoom(roomId: string): void {
  const owned = new Set(parsedStoredPrefs()?.ownedRooms ?? prefs().ownedRooms ?? [])
  owned.add(roomId)
  setPrefsFresh({ ownedRooms: [...owned] })
}

/** True when THIS device started `roomId` (so a reload's rejoin is really the owner
 *  returning). Reads localStorage fresh — the marker may have been written by the
 *  pre-reload session or another tab. */
export function isOwnedRoom(roomId: string): boolean {
  const owned = parsedStoredPrefs()?.ownedRooms ?? prefs().ownedRooms ?? []
  return owned.includes(roomId)
}

/** Deletes every mapping touching `projectId` (both directions) — called when the
 *  project is deleted. Returns the room ids that were bound to it, so the caller
 *  can also drop their y-indexeddb databases. */
export function forgetRoomsForProject(projectId: string): string[] {
  const maps = storedRoomMaps()
  const rooms: string[] = []
  for (const [room, pid] of Object.entries(maps.roomProjects)) {
    if (pid === projectId) {
      rooms.push(room)
      delete maps.roomProjects[room]
    }
  }
  delete maps.projectRooms[projectId]
  setPrefs(maps)
  // Drop any owned-room markers for the rooms we just forgot (their project is gone).
  if (rooms.length) {
    const owned = new Set(parsedStoredPrefs()?.ownedRooms ?? prefs().ownedRooms ?? [])
    let changed = false
    for (const room of rooms) if (owned.delete(room)) changed = true
    if (changed) setPrefsFresh({ ownedRooms: [...owned] })
  }
  return rooms
}
