/**
 * CollabSession — one live room for one project. It owns the `Y.Doc`, wires the
 * provider stack (contract §5, all optional/additive), the Y.Doc↔Project bridge,
 * the per-file editor binding, and awareness/presence. Everything here is
 * browser-only (WebRTC, IndexedDB, WebSocket), so this module is never imported
 * by the pure, unit-tested collab modules.
 *
 * Construction is two-phase: the synchronous `create*` sets up the doc, bridge,
 * editor binding and local persistence immediately; `connect()` then does the
 * async part (fetch ICE, open WebRTC + the blob CAS provider). Connecting is
 * deliberately post-mount — no socket is opened during boot (contract edge #4).
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
import { WebrtcProvider } from 'y-webrtc'
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

/** A public STUN, the dev default when `/v1/ice` isn't reachable (contract §4). */
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

/** How long the mirror gate grants the LIVE layer to deliver the doc before
 *  reconciling. The blob store can honestly 404 (nothing persisted yet) while a
 *  peer's state is mid-flight over WebRTC/BroadcastChannel — reconciling a full
 *  local project against that not-yet-arrived doc would mint duplicate Y.Texts. */
const WEBRTC_SYNC_GRACE_MS = 3000

/** Upper bound on waiting for the blob layer before probing the caller's role
 *  (contract §7.4). Keeps a viewer's read-only flip prompt even if durable sync
 *  is slow or the doc isn't persisted yet. */
const ROLE_PROBE_GRACE_MS = 2500

export interface CollabSessionOptions {
  roomId: string
  project: Project
  /** Null when offline / no account — the session still runs (IndexedDB + cross-tab WebRTC). */
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
  private snapshot?: FsSnapshot
  private seedMeta?: { name?: string; entry?: string | null }
  private onPresence?: (peers: Peer[]) => void
  private onMeta?: (meta: DocMeta) => void
  private onStatus?: (status: SyncStatus) => void
  private onSynced?: () => void
  private onReadOnly?: (readOnly: boolean) => void
  private onFilesChanged?: () => void
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
  private webrtc: WebrtcProvider | null = null
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
    this.snapshot = opts.snapshot
    this.seedMeta = opts.meta
    this.onPresence = opts.onPresence
    this.onMeta = opts.onMeta
    this.onStatus = opts.onStatus
    this.onSynced = opts.onSynced
    this.onReadOnly = opts.onReadOnly
    this.onFilesChanged = opts.onFilesChanged
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
    this.binding = createEditorBinding(this.doc, this.awareness, () => this.roleReadOnly)

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
    // guest does once file content arrives (idb/blob/webrtc all funnel into the
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

  /** The async half: ICE + live WebRTC + the durable blob CAS provider. */
  async connect(): Promise<void> {
    if (this.destroyed) return

    // WebRTC (contract §5.2). Even with no signaling server (offline / no API),
    // y-webrtc still connects same-origin browser tabs over BroadcastChannel, so
    // this is an additive win rather than dead weight.
    const iceServers = (this.api ? await this.api.getIce() : null) ?? DEFAULT_ICE
    if (this.destroyed) return
    const signaling = this.api ? [this.api.signalingUrl()] : []
    try {
      this.webrtc = new WebrtcProvider(this.roomId, this.doc, {
        signaling,
        awareness: this.awareness,
        peerOpts: { config: { iceServers } },
      })
    } catch {
      this.webrtc = null
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
      // must not re-push them (that was the PUT storm / 409 ping-pong). y-webrtc
      // passes its inner Room as the applyUpdate origin; register both to be safe.
      if (this.idb) this.blob.remoteOrigins.add(this.idb)
      if (this.webrtc) {
        this.blob.remoteOrigins.add(this.webrtc)
        if (this.webrtc.room) this.blob.remoteOrigins.add(this.webrtc.room)
      }
      // A guest asks the server for its effective role — a link-access viewer stays
      // read-only, an editor flips writable (contract §7.4). An owner (host, or this
      // device rejoining a room it started) always edits, so skip the probe.
      if (!this.owner) void this.resolveRole()
    }

    // Open the Project→doc mirror once the doc's initial sync settled (guests and
    // reused-room hosts — a fresh-room host's mirror is on from construction).
    // "Settled" means all three layers: IndexedDB, the blob store, AND the live
    // layer (first webrtc 'synced', bounded by a grace window — it may never
    // fire when nobody else is around).
    if (!(this.host && this.freshRoom)) {
      const waits: Promise<unknown>[] = []
      if (this.idb) waits.push(this.idb.whenSynced)
      if (this.blob) waits.push(this.blob.whenSynced)
      if (this.webrtc) {
        const rtc = this.webrtc
        waits.push(
          new Promise<void>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | null = null
            const done = () => {
              if (timer) clearTimeout(timer)
              try {
                rtc.off('synced', done)
              } catch {
                /* provider already destroyed */
              }
              resolve()
            }
            timer = setTimeout(done, WEBRTC_SYNC_GRACE_MS)
            rtc.on('synced', done)
          }),
        )
      }
      void Promise.allSettled(waits).then(() => {
        if (this.destroyed) return
        // Re-hosting: reconcile the CURRENT project state into the loaded doc —
        // per-key minimal edits (snapshotToYdoc), never a duplicate blind seed.
        if (this.host && this.snapshot) {
          snapshotToYdoc(this.snapshot, this.doc, {
            name: this.seedMeta?.name,
            entry: this.seedMeta?.entry ?? null,
          })
        }
        this.bridge.enableMirror()
      })
    }
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
      // removeAwarenessStates via destroy tells peers we've left.
      this.webrtc?.destroy()
    } catch {
      /* provider already torn down */
    }
    this.idb?.destroy()
    this.bridge.destroy()
    this.awareness.destroy()
    this.doc.destroy()
  }
}
