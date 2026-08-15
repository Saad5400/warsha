/**
 * useCloudSync — the Phase-C "accounts-as-cloud" manager, a hook parallel to
 * useCollab. Where useCollab is EXPLICIT ("Start collaboration" hosts one room),
 * this is AMBIENT: while signed in, every project auto-backs-up to the cloud and the
 * OPEN project keeps a live headless durable engine. It is gated entirely on
 * `signedIn` — an anonymous user keeps exactly today's explicit-only behavior (this
 * hook does nothing, mints no device token, makes no `/v1` calls).
 *
 * Two responsibilities:
 *
 *  1. BACKFILL. On the signed-out→signed-in transition (and on boot if already
 *     signed in), seed every UNMAPPED project into a fresh cloud doc. Projects that
 *     already have a `prefs.projectRooms[id]` mapping are SKIPPED — that mapping is
 *     the project↔docId map (the same one useCollab writes), so backfill composes
 *     with rooms already started and with a future claimDevice without double-creating.
 *     A mapping is written ONLY on a successful seed; a quota outcome ABORTS the
 *     remaining queue (mappings already written are kept) and surfaces `cloudOutOfSpace`
 *     once; a too-large project is skipped (stays local-only) and the queue continues.
 *
 *  2. OPEN-PROJECT ENGINE. Keep ONE `HeadlessSync` attached to the open project's
 *     doc, re-attaching across project switches.
 *
 * ★ SINGLE-ENGINE-PER-DOC INVARIANT. A HeadlessSync and a CollabSession must never
 * both attach to the same docId (both open IndexeddbPersistence+BlobSyncProvider on
 * it → double-push / 409 ping-pong). So the engine is suppressed whenever the open
 * project is live-collaborating: `collabActive` gates attachment, and the App calls
 * `suspendForCollab()` (flush+destroy) BEFORE `collab.start()` to close the window
 * before the session opens its providers, then `resumeAfterCollab()` when it stops.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import type { ProjectMeta } from '../fs/projects'
import type { FsSnapshot } from '../fs/types'
import { prefs, setPrefsFresh, forgetRoomsForProject, rememberRoomMapping, rememberOwnedRoom } from '../fs/prefs'
import { createApi } from './api'
import { currentToken, ensureDeviceToken } from './auth'
import { HeadlessSync, seedOnce, type SeedStatus } from './headlessSync'
import { newRoomId } from './room'
import type { SyncStatus } from './blobSync'

/** How many projects to seed at once during backfill — a small pool so a signed-in
 *  user with many projects backs up promptly without a request storm. */
const BACKFILL_CONCURRENCY = 3

/** Per-project durable-sync status for Home badges (chunk 4 consumes this). `seeding`
 *  is the transient backfill state; the rest are the durable provider's own statuses. */
export type CloudDocStatus = 'seeding' | SyncStatus

export interface UseCloudSyncOptions {
  /** The live, open `Project` — the headless engine binds to it. */
  project: Project
  /** The open project's id. Null before first load / on the empty Home. */
  currentProjectId: string | null
  /** Every project (most-recent-first) — the backfill target set. */
  projects: ProjectMeta[]
  /** Read a non-open project's files, for seeding it. (The OPEN project is snapshotted
   *  live so unsaved edits are captured.) */
  snapshotOf(id: string): Promise<FsSnapshot | null>
  /** Resolves once storage is attached (useProject.whenReady) — backfill waits on it. */
  whenReady(): Promise<void>
  /** True iff a real account session is active. The whole hook no-ops when false. */
  signedIn: boolean
  /** True while the OPEN project is live-collaborating (a CollabSession owns its doc).
   *  Gates the headless engine off — the single-engine invariant. */
  collabActive: boolean
  /** Surface the one-time `cloudOutOfSpace` notice when backfill hits the account quota. */
  onOutOfSpace?(): void
}

export interface CloudSyncState {
  /** Per-project durable-sync status, keyed by PROJECT id, for Home badges. */
  statuses: Record<string, CloudDocStatus>
  /** Flush + destroy the open project's headless engine so a live CollabSession can
   *  own its docId. The App awaits this BEFORE `collab.start()` (and it latches the
   *  engine suppressed until `resumeAfterCollab`). Idempotent. */
  suspendForCollab(): Promise<void>
  /** Clear the collab suspension and re-attach the open engine (call after a live
   *  session stops). Safe to call when not suspended. */
  resumeAfterCollab(): void
  /** Best-effort flush of the open engine (tab hide / before a project switch). */
  flushOpen(): Promise<void>
}

export function useCloudSync(opts: UseCloudSyncOptions): CloudSyncState {
  const { currentProjectId, snapshotOf, whenReady, signedIn, collabActive, onOutOfSpace } = opts

  // Same client shape as useCollab: null offline (no VITE_WARSHA_API); the bearer
  // resolves per-request through currentToken, so a sign-in takes effect with no rebuild.
  const apiRef = useRef(createApi(undefined, undefined, currentToken))

  const [statuses, setStatuses] = useState<Record<string, CloudDocStatus>>({})
  const setStatus = useCallback((projectId: string, status: CloudDocStatus) => {
    setStatuses((prev) => (prev[projectId] === status ? prev : { ...prev, [projectId]: status }))
  }, [])

  // Latest inputs behind refs so the reconcile/backfill callbacks stay stable and read
  // fresh values (they run across awaits, where a captured closure would go stale).
  const projectRef = useRef(opts.project)
  projectRef.current = opts.project
  const projectsRef = useRef(opts.projects)
  projectsRef.current = opts.projects
  const openIdRef = useRef(currentProjectId)
  openIdRef.current = currentProjectId
  const signedInRef = useRef(signedIn)
  signedInRef.current = signedIn
  const collabActiveRef = useRef(collabActive)
  collabActiveRef.current = collabActive
  const onOutOfSpaceRef = useRef(onOutOfSpace)
  onOutOfSpaceRef.current = onOutOfSpace

  const engineRef = useRef<HeadlessSync | null>(null)
  /** Latched by suspendForCollab so the reconcile keeps the engine off across the
   *  window between suspend and `collab.active` flipping true. */
  const suspendedRef = useRef(false)
  const destroyedRef = useRef(false)
  /** Bumped whenever the project↔doc map changes (a backfill seed lands), so the
   *  attach effect re-evaluates for a project that just became mapped. */
  const [mapVersion, setMapVersion] = useState(0)

  // ---- the open-project headless engine (serialized reconcile) --------------
  // Engine transitions (flush is async) must not overlap; a single-flight lock with a
  // "run again" flag collapses bursts of dep changes into one consistent settle.
  const reconcilingRef = useRef(false)
  const rerunRef = useRef(false)
  const reconcile = useCallback(async () => {
    if (reconcilingRef.current) {
      rerunRef.current = true
      return
    }
    reconcilingRef.current = true
    try {
      do {
        rerunRef.current = false
        const openId = openIdRef.current
        const docId = openId ? ((prefs().projectRooms ?? {})[openId] ?? null) : null
        const want =
          signedInRef.current &&
          !!apiRef.current &&
          !!openId &&
          !!docId &&
          !collabActiveRef.current &&
          !suspendedRef.current &&
          !destroyedRef.current
        const cur = engineRef.current

        // Already attached to exactly the right doc → nothing to do. Otherwise settle in
        // ONE pass: tear down a stale/unwanted engine (flushing its last window first),
        // then attach a fresh one if we still want one. Doing both here means a docId
        // change (a project switch) detaches AND re-attaches without depending on a re-run.
        if (!(want && cur && cur.docId === docId)) {
          if (cur) {
            engineRef.current = null
            try {
              await cur.flush()
            } catch {
              /* flushing is best-effort */
            }
            cur.destroy()
          }
          // Re-read the decision inputs — the `await` above may have let deps change.
          const openId2 = openIdRef.current
          const docId2 = openId2 ? ((prefs().projectRooms ?? {})[openId2] ?? null) : null
          const want2 =
            signedInRef.current &&
            !!apiRef.current &&
            !!openId2 &&
            !!docId2 &&
            !collabActiveRef.current &&
            !suspendedRef.current &&
            !destroyedRef.current
          if (want2 && !engineRef.current) {
            engineRef.current = new HeadlessSync(docId2!, projectRef.current, apiRef.current!, {
              fresh: false,
              onStatus: (s) => setStatus(openId2!, s),
            })
          }
        }
      } while (rerunRef.current)
    } finally {
      reconcilingRef.current = false
    }
  }, [setStatus])

  // Re-reconcile whenever an input that decides attach/detach changes.
  useEffect(() => {
    void reconcile()
  }, [signedIn, currentProjectId, collabActive, mapVersion, reconcile])

  // ---- backfill -------------------------------------------------------------
  // Runs once per signed-in "epoch". Reset when signed out so a later sign-in re-runs
  // (it SKIPS already-mapped projects, so re-running only backs up genuinely new ones —
  // cheap, and the desired behavior; it never re-creates an existing project's doc).
  const backfilledRef = useRef(false)

  const runBackfill = useCallback(async () => {
    await whenReady()
    const api = apiRef.current
    if (!api || !signedInRef.current || destroyedRef.current) return

    // Anonymous sync authenticates as the device principal; a signed-in backfill uses
    // the session token, but mint the device token defensively in case a race leaves us
    // pre-session (a no-op when the session token is present / already cached).
    await ensureDeviceToken(api)
    if (!signedInRef.current || destroyedRef.current) return

    // ---- chunk 5: different-account reconciliation (a single GET /v1/docs) ----
    // A sign-in as a DIFFERENT account must not inherit the previous account's
    // project↔doc mappings: those docs are owned by the OTHER account and are neither
    // visible nor writable here. We detect the switch by the persisted `syncAccountId`
    // (the account the current mappings belong to) and, on a genuine change, orphan
    // every mapping whose docId is absent from THIS account's doc list — ONE list call,
    // no per-doc probes. Same-account sign-in: ids match → skip entirely (no re-seed).
    // First-ever sign-in (`syncAccountId` null): the mappings are the device's own
    // anonymous docs, which claim-device carries over to this account — so we DON'T
    // orphan, we only record the account. (Orphaning here would race claim-device and
    // duplicate the just-claimed docs — the reason the null case is excluded.)
    const acct = prefs().sessionUser?.id ?? null
    const prevAcct = prefs().syncAccountId ?? null
    if (acct && acct !== prevAcct) {
      if (prevAcct) {
        const list = await api.listDocs()
        if (destroyedRef.current || !signedInRef.current) return
        // Only act on a SUCCESSFUL fetch — a null (offline/error) must not orphan
        // anything, or a network blip would wipe every mapping and re-seed the world.
        // Leave `prevAcct` in place so the reconcile retries on the next run.
        if (!list) return
        const visible = new Set(list.map((d) => d.id))
        const rooms = prefs().projectRooms ?? {}
        let orphaned = false
        for (const [pid, docId] of Object.entries(rooms)) {
          // A mapped doc the new account can neither see nor write belongs to a previous
          // account — drop the mapping (both directions + the owned-room marker) so the
          // backfill below re-seeds a FRESH doc for this account.
          if (!visible.has(docId)) {
            forgetRoomsForProject(pid)
            orphaned = true
          }
        }
        // If the OPEN project's mapping was orphaned, its engine now points at a doc this
        // account can't write — nudge the attach effect so it detaches promptly (the
        // fresh re-seed bumps this again when the new mapping lands).
        if (orphaned) setMapVersion((n) => n + 1)
      }
      // Record the account these mappings now belong to (first sign-in or post-switch).
      setPrefsFresh({ syncAccountId: acct })
    }

    const openId = openIdRef.current
    const mapped = prefs().projectRooms ?? {}
    // Targets = projects with NO mapping yet. Open project first so its engine can
    // attach as soon as it is mapped.
    const targets = projectsRef.current
      .map((p) => p.id)
      .filter((id) => !mapped[id])
      .sort((a, b) => (a === openId ? -1 : b === openId ? 1 : 0))
    if (targets.length === 0) return

    let aborted = false
    let notifiedOutOfSpace = false
    let next = 0
    const worker = async (): Promise<void> => {
      while (!aborted && !destroyedRef.current && signedInRef.current) {
        const i = next++
        if (i >= targets.length) return
        const pid = targets[i]
        // A concurrent useCollab.start() may have mapped it since we snapshotted; re-check.
        if ((prefs().projectRooms ?? {})[pid]) continue

        setStatus(pid, 'seeding')
        // The OPEN project is snapshotted LIVE (captures unsaved edits); others read
        // from their store. A missing snapshot (storage down) just skips the project.
        const snap = pid === openIdRef.current ? projectRef.current.snapshot() : await snapshotOf(pid)
        if (!snap) {
          setStatus(pid, 'offline')
          continue
        }
        const docId = newRoomId()
        const res: SeedStatus = (await seedOnce(docId, snap, api)).status
        if (res === 'ok') {
          // Success ONLY: record BOTH directions of the mapping and mark the doc owned by
          // this device (mirrors useCollab.start). This is what composes with claimDevice.
          rememberRoomMapping(docId, pid)
          rememberOwnedRoom(docId)
          setStatus(pid, 'saved')
          setMapVersion((n) => n + 1) // let the attach effect pick up the open project
        } else if (res === 'quota') {
          // Out of cloud space: abort the REST of the queue, keep what we've mapped, and
          // surface the notice once. The failed project stays unmapped (local-only).
          setStatus(pid, 'out-of-space')
          aborted = true
          if (!notifiedOutOfSpace) {
            notifiedOutOfSpace = true
            onOutOfSpaceRef.current?.()
          }
        } else if (res === 'too-large') {
          // Skip: stays unmapped / local-only; the queue continues with the next project.
          setStatus(pid, 'too-large')
        } else {
          // Transient (auth/network) — leave unmapped and retry on a later backfill.
          setStatus(pid, 'offline')
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(BACKFILL_CONCURRENCY, targets.length) }, () => worker()))
  }, [whenReady, snapshotOf, setStatus])

  useEffect(() => {
    if (!signedIn) {
      // Signed out: allow a future sign-in to backfill again. Mappings are KEPT (and
      // the engine detaches via the reconcile effect once `signedIn` is false) — a
      // same-account re-sign-in then finds everything mapped and re-creates nothing.
      // A sign-in as a DIFFERENT account is reconciled at the head of runBackfill
      // (chunk 5): it orphans this account's mappings against the new account's doc
      // list so they re-seed fresh, keyed off the persisted `syncAccountId`.
      backfilledRef.current = false
      return
    }
    if (backfilledRef.current) return
    backfilledRef.current = true
    void runBackfill()
  }, [signedIn, runBackfill])

  // ---- imperative coordination for the single-engine invariant --------------
  const suspendForCollab = useCallback(async () => {
    suspendedRef.current = true
    await reconcile() // detaches (flush+destroy) because `want` is now false
  }, [reconcile])

  const resumeAfterCollab = useCallback(() => {
    suspendedRef.current = false
    void reconcile()
  }, [reconcile])

  const flushOpen = useCallback(async () => {
    try {
      await engineRef.current?.flush()
    } catch {
      /* best-effort */
    }
  }, [])

  // Teardown on unmount: flush + destroy the open engine, stop further work.
  useEffect(
    () => () => {
      destroyedRef.current = true
      const e = engineRef.current
      engineRef.current = null
      if (e) {
        void e.flush().catch(() => {})
        e.destroy()
      }
    },
    [],
  )

  return { statuses, suspendForCollab, resumeAfterCollab, flushOpen }
}
