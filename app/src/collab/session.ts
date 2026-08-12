/**
 * CollabSession — one live room for one project. It owns the `Y.Doc`, wires the
 * provider stack (contract §5, all optional/additive), the Y.Doc↔Project bridge,
 * the per-file editor binding, and awareness/presence. Everything here is
 * browser-only (WebRTC, IndexedDB, WebSocket), so this module is never imported
 * by the pure, unit-tested collab modules.
 *
 * Construction is two-phase: the synchronous `create*` sets up the doc, bridge,
 * editor binding and local persistence immediately; `connect()` then does the
 * async part (mint a ticket, open the live WebSocket relay + the blob CAS
 * provider). Connecting is deliberately post-mount — no socket is opened during
 * boot (contract edge #4).
 *
 * The live layer is a server-relayed WebSocket (y-websocket), NOT y-webrtc P2P:
 * STUN-only P2P dies behind symmetric NAT (school networks — the target users),
 * so a relay that always connects is both more reliable and lets the server drop
 * a read-only peer's writes. It stays LIGHT — only tiny Yjs deltas cross it; the
 * heavy durable snapshots go to S3 via BlobSyncProvider, never through the relay.
 *
 * Seeding rules (contract §5):
 *  - host + FRESH room: seed the doc from the snapshot synchronously; the mirror
 *    is on from the start and the blob provider skips its initial GET (the doc
 *    cannot exist server-side yet) and pushes the seed even if nobody types.
 *  - host + REUSED room (re-collaborating on a project that had a room before):
 *    do NOT blind-seed — a fresh Y.Doc seeded with the same text as the room's
 *    surviving history would DOUBLE every file on merge. Wait for the initial
 *    IndexedDB/blob sync, then reconcile the snapshot into the existing doc
 *    (snapshotToYdoc is per-key idempotent) and enable the mirror.
 *  - guest: never seeds; the mirror opens only after the initial sync, so a
 *    partially-arrived doc is never diffed against a full local project (which
 *    minted fresh Y.Texts that clobbered the real ones arriving later).
 */
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import type { Project } from '../fs/project'
import type { FsSnapshot } from '../fs/types'
import type { WarshaApi } from './api'
import { snapshotToYdoc, metaMap, filesMap, readMeta, readLinkAccess, type DocMeta, type MetaLinkAccess } from './doc'
import { ProjectBridge } from './materialize'
import { createEditorBinding, type CollabBinding } from './editorBridge'
import { makeUser, type CollabUser, type Peer } from './presence'
import { BlobSyncProvider, type SyncStatus } from './blobSync'

export type { SyncStatus }

/** How long the mirror gate grants the LIVE layer to deliver the doc before
 *  reconciling. The blob store can honestly 404 (nothing persisted yet) while a
 *  peer's state is mid-flight over the WebSocket relay — reconciling a full local
 *  project against that not-yet-arrived doc would mint duplicate Y.Texts. */
const WS_SYNC_GRACE_MS = 3000

/** Upper bound on waiting for the blob layer before probing the caller's role
 *  (contract §7.4). Keeps a viewer's read-only flip prompt even if durable sync
 *  is slow or the doc isn't persisted yet. */
const ROLE_PROBE_GRACE_MS = 2500

/** Upper bound on waiting for the provider stack's initial sync before firing the
 *  deterministic "session ready" rebind signal anyway (H1). The normal path fires
 *  it the instant IndexedDB+blob settle (the live socket is separately grace-bounded
 *  above); this only covers a provider whose `whenSynced` never resolves, so the open
 *  file still re-binds instead of silently syncing to OPFS alone. Comfortably above the
 *  live-sync grace so it never pre-empts a healthy sync — and harmless if it does,
 *  since it only triggers a rebind attempt, never the snapshot reconcile. */
const SESSION_READY_GRACE_MS = 6000

export interface CollabSessionOptions {
  roomId: string
  project: Project
  /** Null when offline / no account — the session still runs (IndexedDB only; the
   *  live WebSocket relay needs the server). */
  api: WarshaApi | null
  /** True for the host that seeds the room from its snapshot; false for a guest joining. */
  host: boolean
  /** Host only: false when the room id was reused from a previous session on this
   *  project (prefs.projectRooms) — changes the seeding rules above. Default true. */
  freshRoom?: boolean
  /** This DEVICE owns/started the room. True for a host; also true for a guest join
   *  that is really the owner rejoining after a reload (prefs.projectRooms maps this
   *  project → this room, M2). An owner is never fail-closed read-only and skips the
   *  role probe: it keeps full edit + share controls. Defaults to `host`. */
  owner?: boolean
  /** Present for the host: the project's current files, to seed the fresh doc. */
  snapshot?: FsSnapshot
  meta?: { name?: string; entry?: string | null }
  user?: CollabUser
  /** Fired whenever the set of other participants changes. */
  onPresence?(peers: Peer[]): void
  /** Fired when the doc's meta (name/entry) is first known and whenever it changes.
   *  A guest uses it to adopt the host's project name and open its entry file. */
  onMeta?(meta: DocMeta): void
  /** Durable-store status, for the UI pill/toasts (fix for silent 401/413 loops). */
  onStatus?(status: SyncStatus): void
  /** Fired once, when the session first has real data: a host immediately; a guest
   *  when content syncs in or a peer shows up. Drives the "Connecting…" state. */
  onSynced?(): void
  /** Fired when the local participant's viewer/read-only role is resolved from the
   *  server (contract §7.4). Guests only; a host always edits. */
  onReadOnly?(readOnly: boolean): void
  /** Fired whenever the doc's `files` map gains/loses a key (a structural doc
   *  change). Lets the app re-bind the open editor to a newly-arrived Y.Text even
   *  when the reconciled content matches the Project verbatim — a reused-room host
   *  restart otherwise never bumps `revision`, so the open file stayed unbound and
   *  post-restart edits never entered the shared doc (H1). */
  onFilesChanged?(): void
  /** Fired once the session's initial local(IndexedDB)+durable(blob) sync has
   *  settled and the doc's `files` are populated with the mirror open — a definite
   *  "ready to bind" signal. The app uses it to DETERMINISTICALLY rebind the open
   *  editor to THIS session's Y.Text, rather than waiting on a `files`-map change
   *  event that a reused-room restart (reconciled content identical to Project)
   *  never produces (H1). Fires uniformly for host and guest; bounded by a fallback
   *  timer so a stuck provider can't strand the rebind. */
  onSessionReady?(): void
}

export class CollabSession {
  readonly roomId: string
  readonly host: boolean
  readonly doc: Y.Doc
  readonly awareness: Awareness
  readonly binding: CollabBinding
  readonly user: CollabUser

  private api: WarshaApi | null
  private freshRoom: boolean
  private owner: boolean
  /** The live host project — snapshotted FRESH at reconcile time so a reused-room
   *  rehost captures edits the host made between Start and the initial sync
   *  settling, instead of a stale begin-time snapshot that would clobber them. */
  private project: Project
  private seedMeta?: { name?: string; entry?: string | null }
  private onPresence?: (peers: Peer[]) => void
  private onMeta?: (meta: DocMeta) => void
  private onStatus?: (status: SyncStatus) => void
  private onSynced?: () => void
  private onReadOnly?: (readOnly: boolean) => void
  private onFilesChanged?: () => void
  private onSessionReady?: () => void
  /** Latches the once-only "session ready" signal (H1) so neither the normal
   *  settle nor the bounded fallback can fire it twice. */
  private readyFired = false
  /** Viewer role, learned from the server after connect (guests only). The editor
   *  binding reads this through a getter, so flipping it makes the open file
   *  rebuild read-only. A non-owner guest starts read-only (fail-closed, H1) and
   *  flips writable only when the probe returns editor/owner. */
  private roleReadOnly = false
  private syncedFired = false
  /** Whether checkSynced is attached to the files map (guests only). */
  private observingFiles = false
  /** Whether the persistent files-structure observer (H1 rebind signal) is attached. */
  private filesObserved = false
  private meta: Y.Map<unknown>
  private bridge: ProjectBridge
  private idb: IndexeddbPersistence | null = null
  private ws: WebsocketProvider | null = null
  private blob: BlobSyncProvider | null = null
  private destroyed = false

  constructor(opts: CollabSessionOptions) {
    this.roomId = opts.roomId
    this.host = opts.host
    this.freshRoom = opts.freshRoom ?? true
    this.owner = opts.owner ?? opts.host
    // Fail closed (contract §7.4, H1): a joining guest is read-only until the server
    // resolves an editor/owner role — a viewer opening a #room= link must not be
    // able to type into a collab file before the probe returns. A host, and an owner
    // rejoining after a reload (M2), always edit.
    this.roleReadOnly = !this.owner && !opts.host
    this.api = opts.api
    this.project = opts.project
    this.seedMeta = opts.meta
    this.onPresence = opts.onPresence
    this.onMeta = opts.onMeta
    this.onStatus = opts.onStatus
    this.onSynced = opts.onSynced
    this.onReadOnly = opts.onReadOnly
    this.onFilesChanged = opts.onFilesChanged
    this.onSessionReady = opts.onSessionReady
    this.user = opts.user ?? makeUser()

    this.doc = new Y.Doc()
    // Only a FRESH room is seeded synchronously; a reused room's doc must load
    // its surviving history first (see header) — reconciled in connect().
    if (opts.host && opts.snapshot && this.freshRoom) {
      snapshotToYdoc(opts.snapshot, this.doc, { name: opts.meta?.name, entry: opts.meta?.entry ?? null })
    }

    this.awareness = new Awareness(this.doc)
    this.awareness.setLocalStateField('user', this.user)
    this.awareness.on('change', this.emitPresence)

    // Bridge first, so a joining doc's incoming state materializes into Project.
    // The Project→doc mirror starts open only for a fresh-room host; everyone
    // else gets it after the initial sync (enableMirror in connect()).
    this.bridge = new ProjectBridge(this.doc, opts.project, { mirror: opts.host && this.freshRoom })
    // The binding reads `roleReadOnly` live: a guest starts writable and flips to
    // read-only once the server resolves a viewer role (resolveRole in connect()).
    // It also reads `guarded` live: a GENUINE GUEST (`!this.owner` — a host and an
    // owner-rejoin both have owner=true) must never edit a file whose Y.Text has not
    // bound yet, or the keystrokes typed during the connect window are discarded at
    // bind (the data-loss bug). setup.ts keeps such a guest read-only until the open
    // file carries yCollab; the owner/host path is unaffected (it may edit unbound
    // files, its edits are seeded/reconciled into the doc).
    this.binding = createEditorBinding(
      this.doc,
      this.awareness,
      () => this.roleReadOnly,
      () => !this.owner,
    )

    // Surface the doc's meta (name/entry). Fires now for a host that seeded it,
    // and again for a guest once the name/entry sync in over a provider.
    this.meta = metaMap(this.doc)
    this.meta.observe(this.emitMeta)
    this.emitMeta()

    // Persistent files-structure signal (H1): fires when the files map gains or
    // loses a key — e.g. a reused-room host's persisted doc loading its files in,
    // where the materialised content matches Project verbatim so `revision` never
    // bumps and the open editor would otherwise never re-bind to the new Y.Text.
    filesMap(this.doc).observe(this.emitFilesChanged)
    this.filesObserved = true

    // "Synced" = this session has something real to show. A host always does; a
    // guest does once file content arrives (idb/blob/live-sync all funnel into the
    // files map) or another peer is present.
    if (this.host) {
      this.fireSynced()
    } else {
      this.observingFiles = true
      filesMap(this.doc).observe(this.checkSynced)
    }

    // Local durability / offline (contract §5.1) — best-effort; a browser that
    // refuses IndexedDB (Safari private) just runs without it.
    try {
      this.idb = new IndexeddbPersistence(this.roomId, this.doc)
    } catch {
      this.idb = null
    }
  }

  /** The async half: the live WebSocket relay + the durable blob CAS provider. */
  async connect(): Promise<void> {
    if (this.destroyed) return

    // Live layer (contract §5.2): a server-relayed WebSocket (y-websocket). Needs
    // the server, so it is skipped entirely when offline / no API — the editor
    // still works via y-indexeddb + local. (y-webrtc's free same-origin cross-tab
    // sync is intentionally dropped; a dedicated cross-tab layer is not worth a
    // dead socket retry loop against a server that isn't there.)
    if (this.api) {
      // A single-use ticket authenticates the socket without a bearer in the URL.
      // Null (mint failed) still connects: the server drops it only if the doc is
      // private, and the durable + local layers carry on regardless.
      const ticket = await this.api.mintSyncTicket()
      if (this.destroyed) return
      try {
        this.ws = new WebsocketProvider(this.api.syncUrl(), this.roomId, this.doc, {
          awareness: this.awareness,
          params: ticket ? { ticket } : {},
        })
        // Re-mint the single-use ticket before EVERY reconnect. y-websocket rebuilds
        // its connect URL from `params` on each (re)connect but never re-mints, so
        // after any drop it would reuse the now-consumed ticket → server sees us
        // anonymous → in a viewer/none-link room the owner is demoted and the live
        // write-block silently freezes their edits. `connection-close` fires before
        // every scheduled reconnect, so re-minting there refreshes the ticket the
        // next URL will carry. See remintTicket for the full why.
        this.ws.on('connection-close', this.remintTicket)
      } catch {
        this.ws = null
      }
    }

    // Durable snapshot store (contract §5.3) — only when there's an API. A host
    // with a freshly minted room skips the pointless initial GET (contract §5);
    // its constructor-time dirty flag pushes the seed without waiting for typing.
    if (this.api) {
      this.blob = new BlobSyncProvider(this.roomId, this.doc, this.api, {
        skipInitialFetch: this.host && this.freshRoom,
        onStatus: (s) => {
          if (!this.destroyed) this.onStatus?.(s)
        },
      })
      // Updates applied by the sibling providers are remote — the blob provider
      // must not re-push them (that was the PUT storm / 409 ping-pong). y-websocket
      // applies incoming sync updates with the WebsocketProvider instance as the
      // applyUpdate origin, so registering it is what suppresses the re-push.
      if (this.idb) this.blob.remoteOrigins.add(this.idb)
      if (this.ws) this.blob.remoteOrigins.add(this.ws)
      // A guest asks the server for its effective role — a link-access viewer stays
      // read-only, an editor flips writable (contract §7.4). An owner (host, or this
      // device rejoining a room it started) always edits, so skip the probe.
      if (!this.owner) void this.resolveRole()
    }

    // Open the Project→doc mirror once the doc's initial sync settled (guests and
    // reused-room hosts — a fresh-room host's mirror is on from construction).
    // "Settled" means all three layers: IndexedDB, the blob store, AND the live
    // layer (the WebsocketProvider's first `sync` with isSynced=true, bounded by a
    // grace window — it settles as soon as the server answers the initial sync).
    if (!(this.host && this.freshRoom)) {
      const waits: Promise<unknown>[] = []
      if (this.idb) waits.push(this.idb.whenSynced)
      if (this.blob) waits.push(this.blob.whenSynced)
      if (this.ws) {
        const ws = this.ws
        waits.push(
          new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | null = null
            const onSync = (isSynced: boolean) => {
              if (isSynced) done()
            }
            const done = () => {
              if (timer) clearTimeout(timer)
              try {
                ws.off('sync', onSync)
              } catch {
                /* provider already destroyed */
              }
              resolve()
            }
            timer = setTimeout(done, WS_SYNC_GRACE_MS)
            ws.on('sync', onSync)
          }),
        )
      }
      // Bounded fallback: fire the deterministic rebind signal even if a provider's
      // `whenSynced` never resolves. Never touches the reconcile (that stays gated
      // on the real settle below), so a premature fire only prompts a harmless
      // rebind attempt — the open file may not yet be a tracked doc, and the real
      // settle re-fires markReady once it is.
      const fallback = setTimeout(() => this.markReady(), SESSION_READY_GRACE_MS)
      void Promise.allSettled(waits).then(() => {
        clearTimeout(fallback)
        if (this.destroyed) return
        // Re-hosting: reconcile the CURRENT project state into the loaded doc —
        // per-key minimal edits (snapshotToYdoc), never a duplicate blind seed.
        // The snapshot is taken FRESH here, not at begin(): a reused-room restart
        // where the host typed between Start and this settle would otherwise be
        // reconciled against a stale begin-time snapshot, whose replaceYText forces
        // the open file's Y.Text back to the pre-edit text — silently DELETING the
        // post-restart edits the bound editor had already inserted (H1). The live
        // project (edits materialise into it) is the authoritative rehost state.
        if (this.host) {
          snapshotToYdoc(this.project.snapshot(), this.doc, {
            name: this.seedMeta?.name,
            entry: this.seedMeta?.entry ?? null,
          })
        }
        this.bridge.enableMirror()
        // Deterministic H1 rebind: the doc's `files` are now loaded and the mirror
        // is open, so the app can bind the open editor to THIS session's Y.Text
        // right now — no dependence on a `files`-map change event that a reused-room
        // restart (content identical to Project) never emits. Idempotent via the
        // readyFired latch, so the fallback above can't double-fire it.
        this.markReady()
      })
    } else {
      // Fresh-room host: the doc was seeded synchronously and the mirror is on from
      // construction, so the session is ready to bind the open file immediately.
      this.markReady()
    }
  }

  /** Fire the once-only "session ready" rebind signal (H1). Guarded so the normal
   *  settle and the bounded fallback are mutually idempotent, and so nothing fires
   *  after teardown. */
  private markReady(): void {
    if (this.readyFired || this.destroyed) return
    this.readyFired = true
    this.onSessionReady?.()
  }

  /**
   * Re-mint the single-use sync ticket ahead of y-websocket's next reconnect.
   *
   * WHY: the ticket minted at construction (and by every prior reconnect) is
   * consumed SERVER-SIDE the instant its socket connects. y-websocket derives the
   * connect URL from `this.params` on EVERY (re)connect — its `url` getter reads
   * `params` fresh — but it never re-mints on its own. So after any disconnect it
   * would reconnect carrying the already-consumed ticket, the server resolves
   * `principal=null` (anonymous), and in a room whose link access is `viewer` or
   * `none` the OWNER is demoted: the ★ write-block then silently drops the owner's
   * live edits (the durable S3 PUT still lands via bearer, so no data loss — but
   * live sync freezes), and a `none` room closes the socket outright. Minting a
   * fresh ticket and writing it back into `params.ticket` (the exact field we
   * passed at construction) makes the next reconnect URL carry a valid ticket, so
   * the owner reconnects as itself and live sync recovers.
   *
   * Hooked on `connection-close`, which fires before every scheduled reconnect
   * (network drop, idle watchdog, or a retriable server close). Best-effort: a
   * destroyed session, a null api, or a mint failure leaves the old (consumed)
   * ticket in place — the reconnect may then fail auth exactly as before, but this
   * never throws. A terminal 44xx close (permanent deny) also fires this; the fresh
   * ticket simply goes unused because y-websocket won't reconnect, which is
   * harmless. The initial connect already mints a fresh ticket above.
   */
  private remintTicket = async (): Promise<void> => {
    if (this.destroyed || !this.api || !this.ws) return
    const ws = this.ws
    let ticket: string | null
    try {
      ticket = await this.api.mintSyncTicket()
    } catch {
      return // leave the stale ticket; the reconnect may fail auth, never throw
    }
    // Re-check after the await: the session may have been torn down or the provider
    // swapped out while the mint was in flight.
    if (this.destroyed || !ticket || ws !== this.ws) return
    ws.params.ticket = ticket
  }

  /**
   * Resolve a guest's effective role from the server and flip the editor to
   * read-only for a viewer (contract §7.4). Waits for the blob layer first so the
   * doc is likely persisted — an unpersisted room probes as `unknown` (open to
   * anyone, per §7.2) and stays writable, which is correct. Best-effort: a dead
   * API leaves the guest writable, as Phase 1 always was.
   */
  private async resolveRole(): Promise<void> {
    if (this.owner || !this.api || this.destroyed) return
    // Prefer to wait for the blob layer (the doc is then persisted, so the probe
    // is authoritative), but never let a slow/stuck sync strand it — a bounded
    // race means a viewer still goes read-only within a couple seconds.
    try {
      if (this.blob) {
        await Promise.race([this.blob.whenSynced, new Promise((r) => setTimeout(r, ROLE_PROBE_GRACE_MS))])
      }
    } catch {
      /* the probe below still runs */
    }
    if (this.destroyed) return
    // If the owner has already published an explicit link access into the doc meta
    // (H2), that owner-authored value is authoritative and may be newer than what a
    // slow probe would report — don't let a late probe override it.
    if (readLinkAccess(this.doc) != null) return
    const role = await this.api.probeRole(this.roomId)
    if (this.destroyed) return
    // Fail-closed default is read-only (constructor). Only a definite non-viewer
    // answer opens the editor: `editor` (may write) and `unknown` (doc not
    // persisted / open to anyone, §7.2) flip writable; `viewer` stays read-only.
    const readOnly = role === 'viewer'
    if (readOnly !== this.roleReadOnly) {
      this.roleReadOnly = readOnly
      this.onReadOnly?.(readOnly)
    }
  }

  /** Force the durable store to persist now (e.g. before the tab hides). */
  async flush(): Promise<void> {
    await this.blob?.flush()
  }

  /** Write name/entry into the doc's meta map (host rename / entry change while
   *  live). No-ops for unchanged values, so effects can call it freely. */
  setMeta(patch: { name?: string; entry?: string | null }): void {
    if (this.destroyed) return
    this.doc.transact(() => {
      if (patch.name !== undefined && patch.name !== this.meta.get('name')) this.meta.set('name', patch.name)
      if (patch.entry !== undefined && (patch.entry ?? null) !== (this.meta.get('entry') ?? null)) {
        this.meta.set('entry', patch.entry)
      }
    })
  }

  /** Publish the owner's link-access choice into the doc meta (H2, contract §7.4),
   *  so already-connected honest guests re-resolve their role and flip read-only.
   *  Owner-authored only — a guest never writes this. The server PATCH remains the
   *  authoritative enforcement (blob store + signaling); this is the live channel. */
  setLinkAccess(access: MetaLinkAccess): void {
    if (this.destroyed || !this.owner) return
    this.doc.transact(() => {
      if (this.meta.get('linkAccess') !== access) this.meta.set('linkAccess', access)
    })
  }

  private fireSynced(): void {
    if (this.syncedFired || this.destroyed) return
    this.syncedFired = true
    if (this.observingFiles) {
      this.observingFiles = false
      filesMap(this.doc).unobserve(this.checkSynced)
    }
    this.onSynced?.()
  }

  private checkSynced = () => {
    if (filesMap(this.doc).size > 0) this.fireSynced()
  }

  private emitMeta = () => {
    if (this.destroyed) return
    // Honest-client mid-session revocation (H2, contract §7.4): an owner publishes
    // link access into the doc meta; a connected guest re-resolves its effective
    // role from it and flips the editor read-only, before surfacing the meta.
    this.applyLinkAccess()
    this.onMeta?.(readMeta(this.doc))
  }

  /**
   * Re-resolve a GUEST's read-only role from the owner-authored `meta.linkAccess`
   * (H2). Absent (owner never touched the picker) leaves the probe's answer intact;
   * `editor` opens the editor, `viewer`/`none` make it read-only. The owner is never
   * self-demoted. Honest-client only — a hostile peer is out of scope (§7.2 note).
   */
  private applyLinkAccess(): void {
    if (this.owner || this.destroyed) return
    const la = readLinkAccess(this.doc)
    if (la == null) return // owner hasn't published one — keep the probe's answer
    const readOnly = la !== 'editor'
    if (readOnly !== this.roleReadOnly) {
      this.roleReadOnly = readOnly
      this.onReadOnly?.(readOnly)
    }
  }

  private emitFilesChanged = () => {
    if (this.destroyed) return
    this.onFilesChanged?.()
  }

  private emitPresence = () => {
    if (this.destroyed) return
    const peers: Peer[] = []
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === this.awareness.clientID) continue
      const user = (state as { user?: CollabUser } | undefined)?.user
      if (user) peers.push({ clientId, user })
    }
    // A live peer counts as "synced" even before any bytes: the room is real.
    if (peers.length > 0) this.fireSynced()
    this.onPresence?.(peers)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.meta.unobserve(this.emitMeta)
    if (this.observingFiles) {
      this.observingFiles = false
      filesMap(this.doc).unobserve(this.checkSynced)
    }
    if (this.filesObserved) {
      this.filesObserved = false
      filesMap(this.doc).unobserve(this.emitFilesChanged)
    }
    this.awareness.off('change', this.emitPresence)
    this.blob?.destroy()
    try {
      // destroy() disconnects the socket and clears our awareness state, so peers
      // see us leave.
      this.ws?.destroy()
    } catch {
      /* provider already torn down */
    }
    this.idb?.destroy()
    this.bridge.destroy()
    this.awareness.destroy()
    this.doc.destroy()
  }
}
