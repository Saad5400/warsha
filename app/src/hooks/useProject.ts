import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Project, type TreeNode } from '../fs/project'
import { prefs, setPrefs } from '../fs/prefs'
import {
  nextProjectName,
  openProjects,
  type MigrationOutcome,
  type ProjectMeta,
  type ProjectsStore,
} from '../fs/projects'
import type { FsSnapshot } from '../fs/types'
import { QUOTA_WARN_RATIO, readQuota, requestPersistence, type StorageProblem } from '../fs/health'
import { watchPrimaryTab } from '../fs/tabs'

/**
 * Binds the plain-TS `Project` (the single source of truth for files) to React,
 * and owns which project is open.
 *
 * Project emits structure/dirty events; we bump a revision counter and let
 * components read straight off the instance. Cheaper and far less error-prone
 * than mirroring the whole file tree into component state.
 *
 * The `Project` instance itself never changes identity — switching projects
 * re-points its store (see `Project.switchStore`) rather than constructing a new
 * one, so the editor and the runner are not remounted by a switch.
 */
export interface ProjectView {
  project: Project
  ready: boolean
  /**
   * Resolves once the real store is attached.
   *
   * `Project` starts on an empty in-memory store and is re-pointed at OPFS when
   * startup finishes (see the constructor comment). Anything that writes files
   * before that lands in the throwaway store and is then overwritten by
   * `switchStore`'s load — which is how tapping a starter card during the first
   * few hundred milliseconds produced an open tab for a file that did not
   * exist, and a Run button disabled with "could not find a place to start".
   * The window is short on a laptop and not short on a school iPad.
   */
  whenReady(): Promise<void>
  /** Increments whenever files or dirty flags change. */
  revision: number
  tree: TreeNode
  paths: string[]
  /** Every project, most recently opened first. */
  projects: ProjectMeta[]
  /** The open one. Null only before the first load resolves. */
  current: ProjectMeta | null
  /** What happened to storage on the way in — a migration worth reporting. */
  migration: MigrationOutcome | null
  /** Set while writes are failing. Drives the persistent save-failure banner. */
  storageProblem: StorageProblem | null
  /** True when the browser is nearly out of room for this origin. */
  quotaTight: boolean
  /**
   * False when another tab holds the primary lock — the advisory, not a lock-out.
   * Both tabs stay fully usable; the later one is told who wins a conflict.
   */
  isPrimaryTab: boolean
  /**
   * Whether the browser promised not to evict this origin. `false` is the normal
   * answer on iOS Safari and is exactly the documented eviction risk.
   */
  storagePersisted: boolean
  /** Creates a project and opens it. Returns its meta. */
  createProject(name?: string, snapshot?: FsSnapshot): Promise<ProjectMeta | null>
  openProject(id: string): Promise<void>
  renameProject(id: string, name: string): Promise<void>
  /** Deletes a project; if it was open, the next most recent one opens. */
  deleteProject(id: string): Promise<void>
}

export function useProject(): ProjectView {
  const projectRef = useRef<Project | null>(null)
  if (!projectRef.current) projectRef.current = new Project()
  const project = projectRef.current

  const storeRef = useRef<ProjectsStore | null>(null)

  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)
  const [projects, setProjects] = useState<ProjectMeta[]>([])
  const [current, setCurrent] = useState<ProjectMeta | null>(null)
  const [migration, setMigration] = useState<MigrationOutcome | null>(null)
  const [storageProblem, setStorageProblem] = useState<StorageProblem | null>(null)
  const [quotaTight, setQuotaTight] = useState(false)
  const [isPrimaryTab, setIsPrimaryTab] = useState(true)
  const [storagePersisted, setStoragePersisted] = useState(true)

  const bump = useCallback(() => setRevision((r) => r + 1), [])

  // A promise rather than a poll, and created eagerly so a caller that arrives
  // before the effect runs still gets the same one.
  const readyGate = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null)
  if (!readyGate.current) {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    readyGate.current = { promise, resolve }
  }
  const whenReady = useCallback(() => readyGate.current!.promise, [])

  useEffect(() => {
    const offStructure = project.onStructureChange(bump)
    const offDirty = project.onDirtyChange(bump)
    const offStorage = project.onStorageProblem(() => setStorageProblem(project.storageProblem))
    let cancelled = false

    void (async () => {
      try {
        const opened = await openProjects(prefs().currentProjectId)
        if (cancelled) return
        storeRef.current = opened.projects
        await project.switchStore(opened.projects.storeFor(opened.current.id))
        if (cancelled) return
        setPrefs({ currentProjectId: opened.current.id })
        setProjects(opened.list)
        setCurrent(opened.current)
        setMigration(opened.migration)
      } catch (error) {
        // openProjects already falls back to memory internally, so reaching
        // here means something outside storage broke. The IDE still has a live
        // in-memory Project, so mark it ready and say what happened — a student
        // typing into an editor that never saves beats a shell that never loads.
        if (cancelled) return
        setMigration({ kind: 'storage-unavailable', detail: String(error) })
      } finally {
        if (!cancelled) {
          setReady(true)
          readyGate.current?.resolve()
        }
      }
    })()

    return () => {
      cancelled = true
      offStructure()
      offDirty()
      offStorage()
    }
  }, [project, bump])

  // Ask to be exempt from eviction, and find out how close to the wall we are.
  // Both are advisory: a `false` from persist() is the normal iOS answer and the
  // reason the export-a-zip nudge exists at all.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const persisted = await requestPersistence()
      if (!cancelled) setStoragePersisted(persisted)
    })()
    const check = async () => {
      const reading = await readQuota()
      if (!cancelled && reading) setQuotaTight(reading.ratio >= QUOTA_WARN_RATIO)
    }
    void check()
    // Re-read occasionally rather than per write: `estimate()` is not free and a
    // student fills storage over minutes, not milliseconds.
    const timer = window.setInterval(() => void check(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => watchPrimaryTab(setIsPrimaryTab), [])

  /**
   * Project-level storage calls funnel through here. `Project` guards its own
   * file writes, but the manifest layer above it does not, and every one of
   * these is reached from a `void …()` in App — so a rejection was an unhandled
   * one that left the UI mid-operation with nothing said.
   */
  const guard = useCallback(async <T,>(op: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await op()
    } catch (error) {
      setStorageProblem(project.storageProblem ?? { fault: 'unknown', detail: String(error) })
      return fallback
    }
  }, [project])

  const refresh = useCallback(async () => {
    const store = storeRef.current
    if (store) setProjects(await guard(() => store.list(), []))
  }, [guard])

  /** Loads `meta` into the live Project and records it as the one to reopen. */
  const open = useCallback(
    async (meta: ProjectMeta) => {
      const store = storeRef.current
      if (!store) return
      await guard(async () => {
        await project.switchStore(store.storeFor(meta.id))
        await store.touch(meta.id)
      }, undefined)
      setPrefs({ currentProjectId: meta.id })
      setCurrent(meta)
      await refresh()
    },
    [project, refresh, guard],
  )

  const createProject = useCallback(
    async (name?: string, snapshot?: FsSnapshot) => {
      const store = storeRef.current
      if (!store) return null
      // Flush the project being left before its store is swapped out from under
      // the debounce.
      await project.saveAll()
      const meta = await guard(
        async () => store.create(name?.trim() || nextProjectName(await store.list()), snapshot),
        null,
      )
      if (!meta) return null
      await open(meta)
      return meta
    },
    [project, open, guard],
  )

  const openProject = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store || id === current?.id) return
      const meta = (await guard(() => store.list(), [])).find((p) => p.id === id)
      if (meta) await open(meta)
    },
    [current, open, guard],
  )

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const store = storeRef.current
      const trimmed = name.trim()
      if (!store || !trimmed) return
      await guard(() => store.rename(id, trimmed), undefined)
      if (current?.id === id) setCurrent({ ...current, name: trimmed })
      await refresh()
    },
    [current, refresh, guard],
  )

  const deleteProject = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store) return
      await guard(() => store.remove(id), undefined)
      const remaining = await guard(() => store.list(), [])
      if (id !== current?.id) {
        setProjects(remaining)
        return
      }
      // The open project just went away, so something has to be open next: the
      // most recent survivor, or a fresh empty project if that was the last one.
      // The app is never in a "no project" state.
      if (remaining.length > 0) {
        await open(remaining[0])
      } else {
        const meta = await guard(() => store.create('My project'), null)
        if (meta) await open(meta)
      }
    },
    [current, open, guard],
  )

  // Recomputed only when something actually changed.
  const tree = useMemo(() => project.tree(), [project, revision])
  const paths = useMemo(() => project.paths(), [project, revision])

  return {
    project,
    ready,
    whenReady,
    revision,
    tree,
    paths,
    projects,
    current,
    migration,
    storageProblem,
    quotaTight,
    isPrimaryTab,
    storagePersisted,
    createProject,
    openProject,
    renameProject,
    deleteProject,
  }
}
