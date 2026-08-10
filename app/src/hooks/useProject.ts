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
import { sameFiles } from '../sharelink'
import { QUOTA_WARN_RATIO, readQuota, requestPersistence, type StorageProblem } from '../fs/health'
import { watchPrimaryTab } from '../fs/tabs'

/**
 * Binds `Project` to React via a revision counter, not mirrored state. Identity
 * stays stable across project switches so editor/runner aren't remounted.
 */
export interface ProjectView {
  project: Project
  ready: boolean
  /**
   * Resolves once real storage is attached — writes before then land in a
   * throwaway store and get silently overwritten by `switchStore`'s load (caused
   * ghost tabs from early starter-card taps).
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
  /** False when another tab holds the primary lock (advisory only — both tabs stay usable; the later one is told who wins). */
  isPrimaryTab: boolean
  /** Whether the browser promised not to evict this origin; `false` is the normal (and expected) answer on iOS Safari. */
  storagePersisted: boolean
  /** Creates a project and opens it. Returns its meta. */
  createProject(name?: string, snapshot?: FsSnapshot): Promise<ProjectMeta | null>
  /** `#share=` link landing (sharelink.ts). Reuses an existing project with matching files, else creates a deduped-name one; `created` says which happened. */
  adoptShared(name: string, snapshot: FsSnapshot): Promise<{ meta: ProjectMeta; created: boolean } | null>
  openProject(id: string): Promise<void>
  renameProject(id: string, name: string): Promise<void>
  /** Deletes a project; if it was open, the next most recent one opens. */
  deleteProject(id: string): Promise<void>
  /** Read-only snapshot of any project's files — the Home cards' previews. Null if storage is down. */
  snapshotOf(id: string): Promise<FsSnapshot | null>
  /** Copies a project into a new one without opening it — the Home "Duplicate". */
  duplicateProject(id: string, name: string): Promise<ProjectMeta | null>
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

  // Eager promise, not a poll, so a caller arriving before the effect runs still gets the same one.
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
        // Fresh device: nothing to open, so no store to attach — Home shows its empty state.
        if (opened.current) {
          await project.switchStore(opened.projects.storeFor(opened.current.id))
          if (cancelled) return
          setPrefs({ currentProjectId: opened.current.id })
        }
        setProjects(opened.list)
        setCurrent(opened.current)
        setMigration(opened.migration)
      } catch (error) {
        // Reaching here means something outside storage broke (openProjects already
        // handles that) — mark ready anyway; a non-saving editor beats a dead shell.
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

  // Ask for eviction exemption and check quota — both advisory; a `false` from
  // persist() is the normal iOS answer (why the export-zip nudge exists).
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
    // Poll occasionally, not per write — `estimate()` isn't free and storage fills up over minutes, not milliseconds.
    const timer = window.setInterval(() => void check(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => watchPrimaryTab(setIsPrimaryTab), [])

  /** Manifest-layer storage calls funnel through here — unlike `Project`'s file writes, they weren't guarded, so `void …()` callers in App swallowed rejections silently. */
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

  const adoptShared = useCallback(
    async (name: string, snapshot: FsSnapshot) => {
      const store = storeRef.current
      if (!store) return null
      // Flush pending writes first, so comparison uses current file contents, not what they held 350ms ago.
      await project.saveAll()
      const list = await guard(() => store.list(), [])
      // Most-recent-first, so if several projects hold identical files, the one the student actually uses is the one that opens.
      for (const meta of list) {
        const existing = await store
          .storeFor(meta.id)
          .snapshot()
          .catch(() => null)
        if (existing && sameFiles(existing, snapshot)) {
          await open(meta)
          return { meta, created: false }
        }
      }
      let unique = name
      for (let n = 2; list.some((p) => p.name.trim() === unique.trim()); n++) unique = `${name} ${n}`
      const meta = await guard(() => store.create(unique, snapshot), null)
      if (!meta) return null
      await open(meta)
      return { meta, created: true }
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
      // Deleted project was open — fall back to the next survivor, else leave the app
      // project-less (current = null) so the shell can return to Home's empty state.
      if (remaining.length > 0) {
        await open(remaining[0])
      } else {
        setCurrent(null)
        setProjects([])
        setPrefs({ currentProjectId: null })
      }
    },
    [current, open, guard],
  )

  const snapshotOf = useCallback(
    async (id: string): Promise<FsSnapshot | null> => {
      const store = storeRef.current
      if (!store) return null
      return guard(() => store.storeFor(id).snapshot(), null)
    },
    [guard],
  )

  const duplicateProject = useCallback(
    async (id: string, name: string): Promise<ProjectMeta | null> => {
      const store = storeRef.current
      if (!store) return null
      // Duplicating the open one: flush first, or the copy is 350ms of edits behind.
      if (id === current?.id) await project.saveAll()
      const snap = await guard(() => store.storeFor(id).snapshot(), null)
      if (!snap) return null
      const meta = await guard(() => store.create(name, snap), null)
      await refresh()
      return meta
    },
    [current, project, refresh, guard],
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
    adoptShared,
    openProject,
    renameProject,
    deleteProject,
    snapshotOf,
    duplicateProject,
  }
}
