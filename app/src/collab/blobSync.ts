/**
 * BlobSyncProvider — the custom, this-repo provider from COLLAB-SYNC-CONTRACT §5.
 *
 * The server is a dumb blob store: it never runs Yjs and never merges. Durable
 * persistence is therefore a compare-and-swap over the *whole* encoded doc:
 *
 *   - on start:        GET /v1/docs/:id → applyUpdate(blob), remember `version`.
 *                      Skipped when the caller KNOWS the doc is fresh (a host that
 *                      just minted the room id) — no 404 noise, contract §5.
 *   - on doc change:   only *local-origin* changes schedule a push (a remote
 *                      update arriving over y-webrtc / y-indexeddb is that peer's
 *                      to persist — pushing it back caused a PUT storm and 409
 *                      ping-pong between peers). Debounce ~800ms, then PUT the
 *                      full snapshot with `If-Match: version`.
 *   - on 409:          the server's version moved under us. applyUpdate(returned
 *                      blob) to merge, adopt the returned version — and if the
 *                      server already holds everything we have (the conflict was
 *                      a no-op: another peer pushed a superset), go clean instead
 *                      of burning another version bump. Otherwise retry with the
 *                      merged state — never overwrite blind.
 *   - failures:        401 is terminal auth-death (the token won't heal mid-session):
 *                      stop and surface. 403 is the viewer/authorization boundary —
 *                      stop durable pushing QUIETLY (no error toast, no retry), the
 *                      live + local layers carry on. 413/over-cap parks the push until
 *                      the doc shrinks. Network/5xx retry with capped backoff + jitter.
 *
 * Awareness/presence is NOT persisted here (WebRTC only, contract §5).
 *
 * Injected `api` (WarshaApi) rather than constructed, so the CAS/409 path is
 * unit-testable against a mock store with no network.
 */
import * as Y from 'yjs'
import type { WarshaApi } from './api'

/** Marks updates this provider applies to the doc, so our own `update` handler ignores them. */
const ORIGIN = Symbol('blobSync')

const DEFAULT_DEBOUNCE_MS = 800
/** A 409 can immediately 409 again if a third writer is racing; cap the retry loop. */
const MAX_RETRIES = 5
/** Client-side twin of the server's per-PUT cap (contract §3) — checked BEFORE the
 *  request, so an oversized project never enters a 413 loop. */
const DEFAULT_MAX_PUT_BYTES = 5 * 1024 * 1024
/** Backoff ceiling for retriable failures. */
const MAX_BACKOFF_MS = 30_000
const BACKOFF_JITTER_MS = 250

export type SyncStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  /** Retriable: network down / server erroring. Pending changes are kept. */
  | 'offline'
  /** Terminal: the token was rejected (401) — durable sync is off for this session. */
  | 'auth'
  /** Not authorized to write (403): this principal may read but not push durably (a
   *  viewer). Quiet — no error toast — while live (WebRTC) + local (IndexedDB) work. */
  | 'read-only'
  /** The encoded doc exceeds the per-PUT cap; pushes park until it shrinks. */
  | 'too-large'

export interface BlobSyncOptions {
  debounceMs?: number
  /** Injectable for tests; defaults to the contract's 5 MB. */
  maxBytes?: number
  /** True for a freshly minted room: the doc cannot exist server-side yet, so the
   *  initial GET is skipped (the first PUT with If-Match:0 creates it). */
  skipInitialFetch?: boolean
  /** Surfaced to the UI status pill; never throws out of the provider. */
  onStatus?(status: SyncStatus): void
}

export class BlobSyncProvider {
  readonly docId: string
  /** Origins whose updates are REMOTE (other providers on the same doc): they do
   *  not schedule a push here — the peer that authored them persists them. The
   *  session registers its y-webrtc / y-indexeddb instances (and y-webrtc's inner
   *  Room, which is what it passes as the applyUpdate origin). */
  readonly remoteOrigins = new Set<unknown>()
  private doc: Y.Doc
  private api: WarshaApi
  private debounceMs: number
  private maxBytes: number
  private onStatus?: (status: SyncStatus) => void

  private version = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private flushing = false
  private destroyed = false
  /** Stop latch: no further requests this session. Set on terminal 401 (auth-death)
   *  and on 403 (viewer — read but not write); the live/local layers are unaffected. */
  private stopped = false
  /** Consecutive retriable failures, for exponential backoff. Reset on success. */
  private failures = 0
  /** Resolves once the initial GET has been applied — handy for tests and for gating a first save. */
  readonly whenSynced: Promise<void>
  private resolveSynced!: () => void

  constructor(docId: string, doc: Y.Doc, api: WarshaApi, opts: BlobSyncOptions = {}) {
    this.docId = docId
    this.doc = doc
    this.api = api
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_PUT_BYTES
    this.onStatus = opts.onStatus
    this.whenSynced = new Promise((r) => (this.resolveSynced = r))
    this.doc.on('update', this.onUpdate)
    // A doc that already has content when the provider attaches (a host's seeded
    // snapshot, or state y-indexeddb loaded first) must reach the store even if
    // nobody ever types — without this, a host who started collab and walked away
    // left an empty blob store and guests with nothing to materialize.
    if (this.doc.store.clients.size > 0) {
      this.dirty = true
      this.schedule()
    }
    void this.start(opts.skipInitialFetch === true)
  }

  private async start(skipFetch: boolean): Promise<void> {
    if (skipFetch) {
      // Freshly minted room: nothing to GET (and a GET would just 404).
      this.resolveSynced()
      this.onStatus?.('idle')
      return
    }
    const got = await this.api.getDoc(this.docId)
    if (this.destroyed) return
    if ('error' in got) {
      if (got.error === 'auth') {
        // The PUTs would 401 too — stop before the retry loop ever starts.
        this.stopped = true
        this.onStatus?.('auth')
      } else if (got.error === 'forbidden') {
        // 403: not authorized to READ the durable snapshot (a viewer with link=none,
        // or a revoked share). NOT auth-death — the live (WebRTC) and local (IndexedDB)
        // layers keep working. Stop durable sync quietly and surface a gentle status,
        // never a scary "auth failed" (M4). probeRole owns the read-only role signal.
        this.stopped = true
        this.onStatus?.('read-only')
      } else {
        // 'not-found' = fresh room (normal for the first guest); 'network' = the
        // store is unreachable — the doc still works over IndexedDB/WebRTC.
        this.onStatus?.(got.error === 'network' ? 'offline' : 'idle')
      }
      this.resolveSynced()
      return
    }
    this.version = got.version
    if (got.blob && got.blob.length) {
      Y.applyUpdate(this.doc, got.blob, ORIGIN)
      // If the store already holds everything we have (e.g. y-indexeddb loaded the
      // same state before we attached), the construction-time dirty flag is stale.
      if (this.dirty && this.serverHasOurState(got.blob)) this.dirty = false
    }
    this.resolveSynced()
    this.onStatus?.('idle')
  }

  /**
   * Push only what WE authored: our own applied server blobs carry ORIGIN, and
   * updates from the registered sibling providers (webrtc/indexeddb) are remote —
   * their author persists them; every peer echoing every remote update was the
   * PUT storm.
   */
  private onUpdate = (_update: Uint8Array, origin: unknown) => {
    if (origin === ORIGIN || this.destroyed || this.stopped) return
    if (this.remoteOrigins.has(origin)) return
    this.dirty = true
    this.schedule()
  }

  private schedule(): void {
    if (this.timer || this.destroyed || this.stopped) return
    const delay =
      this.failures === 0
        ? this.debounceMs
        : Math.min(this.debounceMs * 2 ** this.failures, MAX_BACKOFF_MS) + Math.random() * BACKOFF_JITTER_MS
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  /** True when `serverBlob` already contains our doc's whole state (a no-op 409). */
  private serverHasOurState(serverBlob: Uint8Array): boolean {
    try {
      const tmp = new Y.Doc()
      Y.applyUpdate(tmp, serverBlob)
      const before = Y.encodeStateAsUpdate(tmp)
      Y.applyUpdate(tmp, Y.encodeStateAsUpdate(this.doc))
      const after = Y.encodeStateAsUpdate(tmp)
      tmp.destroy()
      return before.length === after.length && before.every((b, i) => b === after[i])
    } catch {
      return false
    }
  }

  /**
   * Push the current full snapshot with CAS. Public so a "save now" (e.g. on
   * tab hide, or session teardown) can force it. Idempotent when clean.
   */
  async flush(): Promise<void> {
    if (this.destroyed || this.stopped) return
    // Never race the initial GET — it resolves in every path (incl. errors).
    await this.whenSynced
    if (this.flushing || !this.dirty || this.destroyed || this.stopped) return
    this.flushing = true
    this.onStatus?.('saving')
    let settled = false
    try {
      for (let attempt = 0; attempt < MAX_RETRIES && !settled; attempt++) {
        // Snapshot inside the loop: a 409 merge (applyUpdate) changes the doc, so
        // the retry must PUT the *merged* bytes, not the ones we started with.
        this.dirty = false
        const bytes = Y.encodeStateAsUpdate(this.doc)
        if (bytes.length > this.maxBytes) {
          // Over the cap: parking beats an infinite 413 loop. dirty stays false so
          // nothing reschedules; the NEXT local change re-checks (the doc may have
          // shrunk below the cap). Local + live layers keep working regardless.
          this.onStatus?.('too-large')
          settled = true
          break
        }
        const res = await this.api.putDoc(this.docId, this.version, bytes)
        if (this.destroyed) return
        if (res.ok) {
          this.version = res.version
          this.failures = 0
          this.onStatus?.('saved')
          settled = true
          break
        }
        if (res.conflict) {
          this.version = res.version
          if (res.blob && res.blob.length) {
            Y.applyUpdate(this.doc, res.blob, ORIGIN)
            // No-op conflict: the server already holds a superset of our state
            // (another peer pushed the same merged doc). Adopting the version and
            // going clean here is what breaks the 409 ping-pong — retrying would
            // burn a version bump that makes the OTHER peer 409 in turn.
            if (this.serverHasOurState(res.blob)) {
              this.failures = 0
              this.onStatus?.('saved')
              settled = true
              break
            }
          }
          this.dirty = true
          continue
        }
        // Terminal auth-death: the token is bad — every further request would 401 too.
        if (res.status === 401) {
          this.stopped = true
          this.onStatus?.('auth')
          settled = true
          break
        }
        // 403 is the EXPECTED viewer/authorization signal (probeRole leans on it):
        // this principal may read but not write. Stop durable PUSHING quietly — no
        // error toast, no retry thrash — consistent with read-only mode; live + IDB
        // keep working. A viewer session therefore never spams PUTs or alarms (M4).
        if (res.status === 403) {
          this.stopped = true
          this.onStatus?.('read-only')
          settled = true
          break
        }
        // Server-side 413 (belt to the client cap's braces): park like over-cap.
        if (res.status === 413) {
          this.onStatus?.('too-large')
          settled = true
          break
        }
        // Doc vanished server-side (If-Match > 0 on an unknown id): re-create it
        // via the contract's create-on-first-PUT path instead of 404ing forever.
        if (res.status === 404 && this.version > 0) {
          this.version = 0
          this.dirty = true
          continue
        }
        // Network/5xx: keep the change pending and back off — a dead server was
        // being hammered every 800ms with no ceiling.
        this.dirty = true
        this.failures++
        this.onStatus?.('offline')
        settled = true
        break
      }
      // MAX_RETRIES conflict rounds without landing: a hot room — back off too.
      if (!settled && this.dirty) this.failures++
    } finally {
      this.flushing = false
      // A change that landed while we were flushing (or a still-pending one)
      // schedules the next attempt (with backoff if we're failing).
      if (this.dirty && !this.destroyed && !this.stopped) this.schedule()
    }
  }

  destroy(): void {
    this.destroyed = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.doc.off('update', this.onUpdate)
  }
}
