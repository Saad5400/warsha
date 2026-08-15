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
import { prefs, projectOwner, rememberRoomMapping, rememberOwnedRoom } from '../fs/prefs'
import { createApi } from './api'
import { currentToken } from './auth'
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
  /** Re-run the owner-scoped backfill now and re-evaluate the open-project engine — the
   *  App calls this after tagging projects account-owned (the sign-in "Add all" claim, a
   *  project created/opened while signed in) so the newly-owned ones back up immediately
   *  instead of waiting for the next sign-in epoch. Idempotent (skips already-mapped). */
  syncNow(): void
}

/** True when `projectId` is owned by the currently signed-in account (`account:<id>`).
 *  The gate for auto-backup and the open-project sync engine (local-first ownership):
 *  a project owned by device (anonymous) or by a DIFFERENT account is never auto-synced
 *  by this session, so switching accounts never pushes one account's work to another. */
function ownedByCurrentAccount(projectId: string | null): boolean {
  if (!projectId) return false
  const acct = prefs().sessionUser?.id
  return !!acct && projectOwner(projectId) === `account:${acct}`
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
          ownedByCurrentAccount(openId) &&
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
            ownedByCurrentAccount(openId2) &&
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

  const runBackfillOnce = useCallback(async () => {
    await whenReady()
    const api = apiRef.current
    if (!api || !signedInRef.current || destroyedRef.current) return

    // Local-first ownership: back up ONLY the projects THIS account owns
    // (`prefs.projectOwners[id] === account:<id>`). A project becomes account-owned by an
    // explicit claim (the sign-in "Add all" prompt) or by being created / opened-from-cloud
    // while signed in — NEVER by sign-in alone. So signing in uploads nothing on its own, a
    // different account is simply not the owner (no cross-account re-upload, no shared-device
    // absorption), and there is no mapping to orphan — a foreign account's projects are never
    // in this target set, and their docs, mappings and local files are left untouched.
    const acct = prefs().sessionUser?.id ?? null
    if (!acct) return
    const myOwner = `account:${acct}`

    const openId = openIdRef.current
    const mapped = prefs().projectRooms ?? {}
    const owners = prefs().projectOwners ?? {}
    // Targets = this account's not-yet-mapped projects. Open project first so its engine
    // attaches as soon as it is mapped.
    const targets = projectsRef.current
      .map((p) => p.id)
      .filter((id) => !mapped[id] && owners[id] === myOwner)
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
          // Stamp the server-side doc name so ANOTHER device's cloud-only card shows the
          // real title, not "Untitled project": the seed's If-Match:0 PUT creates the doc
          // with a null name (the Yjs blob carries files, not the name), and GET /v1/docs
          // reads only this column. Best-effort — patchDoc never throws; a miss just leaves
          // the older "Untitled" label until a rename or the Home self-heal patches it.
          const name = projectsRef.current.find((p) => p.id === pid)?.name
          if (name) void api.patchDoc(docId, { name })
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

  // Serialize backfill runs so overlapping triggers — the sign-in epoch run plus a syncNow,
  // or two syncNows from rapid project creation — can't both seed the SAME unmapped project
  // and mint duplicate cloud docs. Each call queues behind the previous; a redundant run
  // returns fast (nothing left to seed). The chain never stays rejected.
  const backfillChainRef = useRef<Promise<void>>(Promise.resolve())
  const runBackfill = useCallback((): Promise<void> => {
    const next = backfillChainRef.current.then(() => runBackfillOnce())
    backfillChainRef.current = next.catch(() => {})
    return next
  }, [runBackfillOnce])

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

  // Explicit "back up my newly-owned projects now" — bump the map version so the reconcile
  // re-evaluates the open project's ownership (a just-claimed OPEN project attaches even if
  // it was already mapped), then re-run the owner-scoped backfill for the unmapped ones.
  const syncNow = useCallback(() => {
    setMapVersion((n) => n + 1)
    void runBackfill()
  }, [runBackfill])

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

  return { statuses, suspendForCollab, resumeAfterCollab, flushOpen, syncNow }
}
