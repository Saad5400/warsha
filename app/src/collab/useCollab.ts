/**
 * useCollab — the collaboration hook, parallel to useProject/useRunner. Keyed to
 * the open project's id (a room belongs to the project it was started in), it
 * owns the CollabSession lifecycle and exposes room state + presence.
 *
 * Nothing here connects during boot: the hook lives inside `Ide`, which only
 * renders once capabilities clear the fatal check, and the session's socket work
 * happens in `connect()` after the session object exists (contract edge #4). The
 * `#room=` link is auto-joined once the workspace is ready, mirroring how
 * App.tsx consumes `#share=`.
 *
 * Lifecycle rules that guard the room's data:
 *  - `stop()` is async and FLUSHES the durable store before destroying the
 *    session (bounded — a dead server can't wedge teardown). App awaits it
 *    before any project switch, so the bridge is gone before the Project moves.
 *  - `start()` REUSES the project's previous room id (prefs.projectRooms) when
 *    one exists — re-collaborating does not orphan the old blob/IndexedDB state,
 *    and previously shared links keep pointing at the live room.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { prefs, rememberRoomMapping, rememberOwnedRoom, isOwnedRoom } from '../fs/prefs'
import type { DocMeta, MetaLinkAccess } from './doc'
import { createApi } from './api'
import { authState, currentToken, ensureDeviceToken } from './auth'
import { CollabSession, type SyncStatus } from './session'
import type { CollabBinding } from './editorBridge'
import type { Peer } from './presence'
import { buildRoomUrl, clearRoomHash, newRoomId, setRoomHash } from './room'

/** How long a teardown flush may hold things up before we destroy anyway. */
const STOP_FLUSH_TIMEOUT_MS = 2000

export interface UseCollabOptions {
  project: Project
  /** The open project's id — switching it ends any live room. Null before first load. */
  currentProjectId: string | null
  /** Seeds a hosted room's meta. */
  currentProjectName?: string
  entryPath: string | null
  /** Resolves once storage is attached (useProject.whenReady). */
  whenReady(): Promise<void>
  /** Push the per-file editor binding into the singleton editor SYNCHRONOUSLY, the
   *  instant a session is created (and null on teardown) — not a render later. The
   *  binding carries the guest's fail-closed read-only role through `readOnly()`, and
   *  the editor reads it when it first constructs a file's state. Routing the binding
   *  only through the React `binding` state let the auto-opened entry file build (and
   *  briefly accept edits) BEFORE the read-only facet was applied, a window prod
   *  latency widened enough for a keystroke to land locally (H1). Called before
   *  `connect()` materialises anything, so the first paint of any collab file is
   *  already read-only for an unresolved guest. The `binding` state stays a backstop
   *  (editor mounting after the session; the writable flip when role=editor resolves). */
  onBinding?(binding: CollabBinding | null): void
}

export interface CollabState {
  active: boolean
  roomId: string | null
  /** True for the tab that started the room; false for a joined guest. */
  isHost: boolean
  /** False until the session has real data (host: immediately; guest: first
   *  content or peer). The pill shows "Connecting…" while false. */
  synced: boolean
  /** Durable-store status, for surfacing 401/413/offline. Null before known. */
  status: SyncStatus | null
  /** Everyone else currently in the room (never includes self). */
  peers: Peer[]
  /** The per-file editor binding, or null when no room is live. App pushes this into the editor. */
  binding: CollabBinding | null
  /** The joined doc's name/entry once known — a guest adopts these. Null when no room is live. */
  roomMeta: DocMeta | null
  /** True when the local participant is a viewer (link-access=viewer): the editor
   *  is read-only (contract §7.4). Always false for a host. */
  readOnly: boolean
  /** Bumps on every structural change to the room doc's `files` map. The App keys
   *  the open-file editor re-bind off this so a restarted (reused-room) session
   *  re-attaches the open file to its new Y.Text even when the reconciled content
   *  matches Project verbatim and `revision` never bumps (H1). */
  filesRev: number
  /** Bumps once per session when its initial local+durable sync has settled (the
   *  doc's files are loaded and the mirror is open). The App keys the open-file
   *  editor rebind off this so a restarted (reused-room) session DETERMINISTICALLY
   *  re-attaches the open file to its new Y.Text — no dependence on a files-map
   *  change event that never fires when the reconciled content matches Project (H1). */
  readyRev: number
  /** Host a new room from the current project; returns the shareable join URL (or null).
   *  Reuses the project's previous room id when it had one. */
  start(): Promise<string | null>
  /** Join an existing room as a guest, materialising its doc into the open project.
   *  App calls this once the room's project is the current one (contract §5). */
  join(roomId: string): Promise<void>
  /** Leave the room and drop the `#room=` link. Flushes the durable store first —
   *  App MUST await this before switching/deleting projects. */
  stop(): Promise<void>
  /** Best-effort durable flush (tab hide / pagehide), alongside project.saveAll(). */
  flush(): Promise<void>
  /** Write name/entry into the live doc's meta (host rename / entry change). */
  setMeta(patch: { name?: string; entry?: string | null }): void
  /** Owner: publish a link-access change into the live doc meta so already-connected
   *  honest guests re-resolve their role and flip read-only (H2, contract §7.4). */
  setLinkAccess(access: MetaLinkAccess): void
}

export function useCollab(opts: UseCollabOptions): CollabState {
  const { project, currentProjectId, currentProjectName, entryPath, whenReady } = opts
  // Behind a ref so the stable `begin`/`teardown` callbacks push the binding without
  // taking `onBinding` as a dependency (which would rebuild them on every render).
  const onBindingRef = useRef(opts.onBinding)
  onBindingRef.current = opts.onBinding
  // Null when VITE_WARSHA_API is unset — the session still runs locally
  // (IndexedDB + same-origin cross-tab WebRTC), just without the backend.
  // `currentToken` resolves per request: the account session token when signed
  // in, else the anonymous device/dev token, so a sign-in mid-session takes
  // effect without rebuilding the client (contract §7.4).
  const api = useMemo(() => createApi(undefined, undefined, currentToken), [])

  const sessionRef = useRef<CollabSession | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [isHost, setIsHost] = useState(false)
  const [synced, setSynced] = useState(false)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [binding, setBinding] = useState<CollabBinding | null>(null)
  const [roomMeta, setRoomMeta] = useState<DocMeta | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [filesRev, setFilesRev] = useState(0)
  const [readyRev, setReadyRev] = useState(0)

  // Read inside stable callbacks (start) without re-creating them per render.
  const currentProjectIdRef = useRef(currentProjectId)
  currentProjectIdRef.current = currentProjectId

  const teardown = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    setRoomId(null)
    setIsHost(false)
    setSynced(false)
    setStatus(null)
    setPeers([])
    setBinding(null)
    setRoomMeta(null)
    setReadOnly(false)
    // Drop the binding from the editor synchronously too, so a stopped session's
    // read-only facet can't linger on the next state build (symmetric with begin).
    onBindingRef.current?.(null)
    if (!session) return
    // Best-effort final flush BEFORE destroy — BlobSyncProvider.destroy() drops
    // pending state, so without this the last debounce-window of edits was lost.
    // Bounded: a dead server must not wedge a project switch.
    try {
      await Promise.race([session.flush(), new Promise((r) => setTimeout(r, STOP_FLUSH_TIMEOUT_MS))])
    } catch {
      /* flushing is best-effort */
    }
    session.destroy()
  }, [])

  const begin = useCallback(
    async (id: string, host: boolean, freshRoom: boolean, owner: boolean = host) => {
      if (sessionRef.current) return
      await whenReady()
      if (sessionRef.current) return
      const session = new CollabSession({
        roomId: id,
        project,
        api,
        host,
        freshRoom,
        owner,
        snapshot: host ? project.snapshot() : undefined,
        meta: host ? { name: currentProjectName, entry: entryPath } : undefined,
        onPresence: setPeers,
        onMeta: setRoomMeta,
        onStatus: setStatus,
        onSynced: () => setSynced(true),
        onReadOnly: setReadOnly,
        // A structural change to the doc's files map — a backstop editor-rebind
        // trigger for late-arriving files (a guest materialising in) (H1).
        onFilesChanged: () => setFilesRev((n) => n + 1),
        // The PRIMARY, deterministic editor-rebind trigger (H1): fires once this
        // session's initial sync has settled with the mirror open, so the open
        // file is guaranteed bindable — the reused-room restart fix that no longer
        // races a files-map change event.
        onSessionReady: () => setReadyRev((n) => n + 1),
      })
      sessionRef.current = session
      setRoomId(id)
      // Owner UI capability (share controls, live-meta authorship) is granted to a
      // host AND to an owner rejoining a room it started (M2), even though the latter
      // joins with host=false so it never re-seeds.
      setIsHost(host || owner)
      setSynced(host) // a host is live from the first frame; a guest is connecting
      // Fail-closed (H1): a non-owner guest starts read-only until the server
      // resolves its role. A host/owner edits from the first frame. This initial
      // value must be an explicit state so the later writable flip is a real change
      // that re-binds the open editor (see App's setCollab effect on collab.readOnly).
      setReadOnly(!(host || owner))
      setBinding(session.binding)
      // Push the binding into the editor NOW, synchronously — before connect()
      // materialises the doc and the auto-open effect opens the entry file. The React
      // `binding` state lands a render later (a parent effect that a fresh guest's
      // child editor-open effect can beat), so without this the entry file's first
      // EditorState was built with `collab == null` — writable — and a keystroke in
      // that window landed locally before the read-only rebuild (H1). The editor reads
      // `binding.readOnly()` (fail-closed true for an unresolved guest) at state build,
      // so this guarantees the very first paint is read-only. Idempotent with the
      // `binding`-state effect that re-pushes it (and covers an editor mounting later).
      onBindingRef.current?.(session.binding)
      // Anonymous sync authenticates as the device principal — make sure its token
      // is minted before connect() opens the blob store (else its first GET/PUT
      // would 401 and terminate durable sync). Skipped when signed in (the session
      // token carries the request); a no-op when the token is already cached.
      if (!authState().token) await ensureDeviceToken(api)
      await session.connect()
    },
    [project, api, whenReady, currentProjectName, entryPath],
  )

  // Latest `begin` behind a ref so the auto-join effect need not depend on it
  // (it captures entryPath/name, which change on every file switch).
  const beginRef = useRef(begin)
  beginRef.current = begin

  const start = useCallback(async (): Promise<string | null> => {
    if (sessionRef.current) return buildRoomUrl(sessionRef.current.roomId)
    const projectId = currentProjectIdRef.current
    // Re-collaborating on a project reuses its room id: the old blob/IndexedDB
    // state stays the room's history and previously shared links keep working —
    // minting a fresh id every time orphaned both and left two rooms mapped to
    // one project, fighting through the bridge.
    const existing = projectId ? ((prefs().projectRooms ?? {})[projectId] ?? null) : null
    const id = existing ?? newRoomId()
    await beginRef.current(id, true, !existing, true)
    if (projectId) rememberRoomMapping(id, projectId)
    // Mark the room as owned by THIS device, so a later reload's rejoin (join, not
    // start) restores owner UI + live-meta authorship (M2).
    rememberOwnedRoom(id)
    setRoomHash(id)
    return buildRoomUrl(id)
  }, [])

  // Guest join. App calls this only once the room's project is the open one, so
  // the session's bridge materialises into the right project (contract §5). The
  // `sessionRef` guard inside `begin` makes a repeat call a no-op.
  const join = useCallback(async (id: string): Promise<void> => {
    // M2: if THIS device started the room (prefs.ownedRooms, written only by
    // start()), a reload's rejoin is really the owner returning — restore its owner
    // UI (share controls + live-meta authorship) and skip the fail-closed read-only
    // default, while KEEPING join semantics (host=false, so no re-seed). The
    // room↔project maps can't answer this — a guest writes those too.
    const owner = isOwnedRoom(id)
    await beginRef.current(id, false, false, owner)
  }, [])

  const stop = useCallback(async () => {
    clearRoomHash()
    await teardown()
  }, [teardown])

  const flush = useCallback(async () => {
    await sessionRef.current?.flush()
  }, [])

  const setMeta = useCallback((patch: { name?: string; entry?: string | null }) => {
    sessionRef.current?.setMeta(patch)
  }, [])

  const setLinkAccess = useCallback((access: MetaLinkAccess) => {
    sessionRef.current?.setLinkAccess(access)
  }, [])

  // A room belongs to its project — switching projects (or unmounting) ends it.
  // App awaits stop() BEFORE switching (the safe path); this cleanup is the
  // backstop for unmounts and any switch path that slipped through, where the
  // bridge's project-epoch gate has already made the session inert.
  useEffect(() => () => void teardown(), [currentProjectId, teardown])

  return { active: roomId !== null, roomId, isHost, synced, status, peers, binding, roomMeta, readOnly, filesRev, readyRev, start, join, stop, flush, setMeta, setLinkAccess }
}
