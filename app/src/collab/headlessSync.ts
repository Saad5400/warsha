/**
 * HeadlessSync — durable cloud sync for ONE project's docId WITHOUT a live socket
 * (Phase C, "accounts-as-cloud" auto-sync-all). It is the headless twin of
 * CollabSession: same durable + local layers on one `Y.Doc`, but deliberately
 * MISSING everything that makes a session "live" — no `WebsocketProvider`, no
 * `Awareness`, no per-file editor binding. A signed-in account's projects sync to
 * S3 in the background whether or not anyone is collaborating; that background
 * path is this module, and the live path stays CollabSession.
 *
 * Why a whole new engine and not "just reuse CollabSession"? Durable sync today
 * only exists INSIDE a CollabSession, which always also opens a socket and binds
 * the editor. Phase C needs the durable half alone. Reusing the session would open
 * a pointless relay socket per project and fight the editor binding.
 *
 * Two shapes, because a project's docId is either brand-new or already mapped:
 *
 *   - `seedOnce()`  — a TRANSIENT backfill for a FRESH docId (never seen server-side).
 *     It seeds the doc from a snapshot, pushes it once (the `If-Match:0` create path,
 *     mirroring a fresh-room host — session.ts:~280), persists it to IndexedDB under
 *     the docId so the doc's Yjs identity survives, then tears down the in-memory
 *     objects. It SURFACES a quota/too-large/error outcome so the backfill manager can
 *     stop (quota) or skip (too-large) without inventing its own error plumbing.
 *
 *   - `attach()`  — a PERSISTENT engine bound to the OPEN `Project`. It materializes
 *     the doc into the Project (a `ProjectBridge`) and drives content the other way
 *     (Project → Y.Doc) through a debounced `snapshotToYdoc`. There is no editor→Y.Text
 *     path without a CollabSession, and the bridge intentionally does NOT mirror
 *     active-file CONTENT, so this debounced snapshot IS the content bridge. Unlike a
 *     fresh seed it does the initial GET (`skipInitialFetch:false`) so a cross-device
 *     edit merges in over CAS.
 *
 * SINGLE-ENGINE-PER-DOC INVARIANT (enforced by the manager, not here): a HeadlessSync
 * and a CollabSession must never both attach to the same docId — both open
 * `IndexeddbPersistence(docId)` + `BlobSyncProvider(docId)`, which would double-push
 * and 409-ping-pong. The manager (`useCloudSync`) flush()+destroys the headless engine
 * before a live session starts on the open project, and re-attaches when it stops.
 *
 * Store-epoch safety: like the session's bridge, the content bridge captures
 * `Project.epoch` and goes inert if the app's `Project` is re-pointed at a different
 * project (a switch). `ProjectBridge` has its own epoch gate too; the manager
 * additionally flush()+destroys before any `switchStore`.
 */
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import type { Project } from '../fs/project'
import type { FsSnapshot } from '../fs/types'
import type { WarshaApi } from './api'
import { snapshotToYdoc, ydocToSnapshot } from './doc'
import { ProjectBridge } from './materialize'
import { BlobSyncProvider, type SyncStatus } from './blobSync'

/** Project → Y.Doc content push cadence — matches the BlobSyncProvider debounce and
 *  the session's feel. No editor binding exists here, so this is the ONLY path that
 *  carries a signed-in user's local edits into the durable doc. */
const CONTENT_DEBOUNCE_MS = 800

/** A large debounce for the seed provider: `seedOnce` flushes explicitly and awaits
 *  it, so the scheduled push must not race that awaited PUT (its `onStatus` is how we
 *  read the outcome). Destroy clears the timer well before this could fire. */
const SEED_IDLE_DEBOUNCE_MS = 60_000

/** IndexedDB is best-effort: a browser that refuses it (Safari private) just runs
 *  without local persistence, and durable S3 sync still works on its own. The
 *  `typeof` guard is load-bearing, not just defensive: where `indexedDB` is absent
 *  (node/tests, SSR) `IndexeddbPersistence`'s constructor opens the DB on an
 *  ASYNC promise that would reject UNCAUGHT (a try/catch here can't see it), so we
 *  must not even attempt it. */
function tryIdb(docId: string, doc: Y.Doc): IndexeddbPersistence | null {
  if (typeof indexedDB === 'undefined') return null
  try {
    return new IndexeddbPersistence(docId, doc)
  } catch {
    return null
  }
}

/** The outcome of a `seedOnce` backfill, for the manager to act on:
 *  - `ok`         → the doc reached the store; the manager records the mapping.
 *  - `quota`      → the account is out of cloud space (§7.3); STOP the backfill queue.
 *  - `too-large`  → this project exceeds the per-PUT cap; SKIP it (stays local-only).
 *  - `error`      → auth/network/other transient failure; skip, no mapping, retry later. */
export type SeedStatus = 'ok' | 'quota' | 'too-large' | 'error'
export interface SeedResult {
  status: SeedStatus
}

/** Map the durable provider's terminal status onto a backfill outcome. */
function seedOutcome(status: SyncStatus | null): SeedStatus {
  if (status === 'out-of-space') return 'quota'
  if (status === 'too-large') return 'too-large'
  if (status === 'saved' || status === 'idle') return 'ok'
  // 'auth' | 'offline' | 'read-only' | 'saving' | null → transient/other: not a success,
  // and NOT a quota stop. The manager leaves the project unmapped and retries next run.
  return 'error'
}

/**
 * Seed a FRESH docId from `snapshot`, push it once, persist it locally, then tear
 * down — a transient one-shot for the Phase-C backfill. The doc cannot exist
 * server-side yet, so the provider skips its initial GET and the first `If-Match:0`
 * PUT is the create (mirrors session.ts's fresh-room host). Returns the outcome so
 * the manager can stop the queue on quota / skip on too-large without any network
 * knowledge of its own. Never throws — a failure resolves to `{status:'error'}`.
 *
 * The IndexedDB DB is KEPT after teardown on purpose: destroying an
 * `IndexeddbPersistence` detaches it but does not delete the database, so the seeded
 * Yjs state (and thus the doc's identity) survives for a later `attach()` to load and
 * merge against, instead of a second independent seed that would double every file.
 */
export async function seedOnce(docId: string, snapshot: FsSnapshot, api: WarshaApi): Promise<SeedResult> {
  const doc = new Y.Doc()
  const idb = tryIdb(docId, doc)
  // Wait out IndexedDB's (empty, for a fresh id) initial load before seeding, so the
  // seed is the doc's first content and lands in the DB.
  if (idb) {
    try {
      await idb.whenSynced
    } catch {
      /* best-effort — proceed without local persistence */
    }
  }

  let last: SyncStatus | null = null
  // Construct the provider on the still-EMPTY doc (0 clients) so its constructor does
  // not auto-flush; we seed next and drive the single, awaited push ourselves. A long
  // debounce guarantees the scheduled timer can't fire before our explicit flush.
  const blob = new BlobSyncProvider(docId, doc, api, {
    skipInitialFetch: true,
    debounceMs: SEED_IDLE_DEBOUNCE_MS,
    onStatus: (s) => {
      last = s
    },
  })
  if (idb) blob.remoteOrigins.add(idb)

  try {
    await blob.whenSynced // resolves immediately for skipInitialFetch
    snapshotToYdoc(snapshot, doc) // dirty=true; schedules a (far-off) push
    await blob.flush() // the one PUT: If-Match:0 → create, or a merge/park/stop
  } catch {
    last = last ?? null
  }

  const status = seedOutcome(last)
  blob.destroy()
  idb?.destroy() // detaches only — the DB (and the doc's identity) is kept
  doc.destroy()
  return { status }
}

export interface HeadlessSyncOptions {
  /** True when the docId is brand-new (just minted, never pushed) — skips the initial
   *  GET. False (the default) for an already-mapped doc, which GETs so a cross-device
   *  edit merges in over CAS. `attach()` for the open project always passes false. */
  fresh?: boolean
  /** Durable-store status, surfaced for Home badges / the sync indicator. */
  onStatus?(status: SyncStatus): void
}

/**
 * A persistent headless engine for one OPEN project's docId. Owns the `Y.Doc` +
 * `IndexeddbPersistence` + `BlobSyncProvider` and a Project↔doc bridge, but no socket
 * and no editor binding. Content flows Project → Y.Doc through a debounced snapshot
 * (the binding-less content bridge); structure + the reverse direction (doc →
 * Project) flow through `ProjectBridge`.
 */
export class HeadlessSync {
  readonly docId: string
  private doc: Y.Doc
  private project: Project
  /** Project this engine was created for — the content bridge goes inert if the app's
   *  Project is re-pointed at another project (a switch), exactly like the session's. */
  private epoch: number
  private bridge: ProjectBridge
  private idb: IndexeddbPersistence | null = null
  private blob: BlobSyncProvider | null = null
  private onStatus?: (status: SyncStatus) => void
  private offDirty: (() => void) | null = null
  private offStructure: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false

  constructor(docId: string, project: Project, api: WarshaApi, opts: HeadlessSyncOptions = {}) {
    this.docId = docId
    this.doc = new Y.Doc()
    this.project = project
    this.epoch = project.epoch
    this.onStatus = opts.onStatus

    // doc → Project (materialize) + structure Project → doc (mirror). The mirror is ON:
    // a headless engine is the SOLE owner of this doc (no live session), so local
    // structural changes — file add/remove/dirs — must reach the doc. Deletions in
    // particular flow only through the bridge (snapshotToYdoc below never deletes).
    this.bridge = new ProjectBridge(this.doc, project, { mirror: true })

    this.idb = tryIdb(docId, this.doc)
    // Already-mapped doc → GET first so a cross-device edit merges (CAS). A caller that
    // KNOWS the doc is fresh may pass fresh:true to skip the 404-y GET.
    this.blob = new BlobSyncProvider(docId, this.doc, api, {
      skipInitialFetch: opts.fresh === true,
      onStatus: (s) => {
        if (!this.destroyed) this.onStatus?.(s)
      },
    })
    // The IndexedDB provider's updates are REMOTE — its author (the persisted state)
    // already owns them; re-pushing them was the PUT storm. Register it so the blob
    // provider ignores idb-origin updates (same rule the session applies).
    if (this.idb) this.blob.remoteOrigins.add(this.idb)

    // Content bridge (Project → Y.Doc): with no editor→Y.Text binding and the bridge
    // deliberately not mirroring active-file content, a signed-in user's edits reach
    // the doc ONLY here — a debounced full-snapshot reconcile (snapshotToYdoc is
    // per-key minimal via replaceYText, so it never clobbers concurrent remote text).
    this.offDirty = project.onDirtyChange(this.scheduleContent)
    this.offStructure = project.onStructureChange(this.scheduleContent)
    // Push the open project's CURRENT content once, so an already-populated project
    // reaches the doc even if the user never types after attach.
    this.scheduleContent()
  }

  private stale(): boolean {
    return this.destroyed || this.project.epoch !== this.epoch
  }

  private scheduleContent = (): void => {
    if (this.stale() || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.stale()) return
      // Minimal per-key edits into the doc; the blob provider's own debounce then CASes
      // the merged snapshot to S3. No meta here — the round-trip (ydocToSnapshot) reads
      // files/dirs only, and the manifest still owns the name locally.
      snapshotToYdoc(this.project.snapshot(), this.doc)
    }, CONTENT_DEBOUNCE_MS)
  }

  /** Land any pending content into the doc, then force the durable store to persist —
   *  used before a project switch / tab hide so the last debounce window isn't lost. */
  async flush(): Promise<void> {
    if (this.destroyed) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // Skip the snapshot if the Project moved under us (a switch) — the bridge's epoch
    // gate would drop it anyway, but we must not diff the WRONG project into this doc.
    if (!this.stale()) snapshotToYdoc(this.project.snapshot(), this.doc)
    await this.blob?.flush()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.offDirty?.()
    this.offDirty = null
    this.offStructure?.()
    this.offStructure = null
    this.blob?.destroy()
    this.idb?.destroy()
    this.bridge.destroy()
    this.doc.destroy()
  }
}

/**
 * Read a cloud doc back as an `FsSnapshot` with NO providers attached — a one-shot
 * `GET /v1/docs/:id` → `applyUpdate` → `ydocToSnapshot`. Used by cross-device open
 * (chunk 4) to materialize a project this device has never seen. Null on any GET
 * error (missing / forbidden / network) — the caller falls back to local-only.
 */
export async function materializeCloudDoc(docId: string, api: WarshaApi): Promise<FsSnapshot | null> {
  const got = await api.getDoc(docId)
  if ('error' in got) return null
  const doc = new Y.Doc()
  if (got.blob && got.blob.length) Y.applyUpdate(doc, got.blob)
  const snap = ydocToSnapshot(doc)
  doc.destroy()
  return snap
}
