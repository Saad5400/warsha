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

  const bump = useCallback(() => setRevision((r) => r + 1), [])

  useEffect(() => {
    const offStructure = project.onStructureChange(bump)
    const offDirty = project.onDirtyChange(bump)
    let cancelled = false

    void (async () => {
      const opened = await openProjects(prefs().currentProjectId)
      if (cancelled) return
      storeRef.current = opened.projects
      await project.switchStore(opened.projects.storeFor(opened.current.id))
      if (cancelled) return
      setPrefs({ currentProjectId: opened.current.id })
      setProjects(opened.list)
      setCurrent(opened.current)
      setMigration(opened.migration)
      setReady(true)
    })()

    return () => {
      cancelled = true
      offStructure()
      offDirty()
    }
  }, [project, bump])

  const refresh = useCallback(async () => {
    const store = storeRef.current
    if (store) setProjects(await store.list())
  }, [])

  /** Loads `meta` into the live Project and records it as the one to reopen. */
  const open = useCallback(
    async (meta: ProjectMeta) => {
      const store = storeRef.current
      if (!store) return
      await project.switchStore(store.storeFor(meta.id))
      await store.touch(meta.id)
      setPrefs({ currentProjectId: meta.id })
      setCurrent(meta)
      await refresh()
    },
    [project, refresh],
  )

  const createProject = useCallback(
    async (name?: string, snapshot?: FsSnapshot) => {
      const store = storeRef.current
      if (!store) return null
      // Flush the project being left before its store is swapped out from under
      // the debounce.
      await project.saveAll()
      const meta = await store.create(name?.trim() || nextProjectName(await store.list()), snapshot)
      await open(meta)
      return meta
    },
    [project, open],
  )

  const openProject = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store || id === current?.id) return
      const meta = (await store.list()).find((p) => p.id === id)
      if (meta) await open(meta)
    },
    [current, open],
  )

  const renameProject = useCallback(
    async (id: string, name: string) => {
      const store = storeRef.current
      const trimmed = name.trim()
      if (!store || !trimmed) return
      await store.rename(id, trimmed)
      if (current?.id === id) setCurrent({ ...current, name: trimmed })
      await refresh()
    },
    [current, refresh],
  )

  const deleteProject = useCallback(
    async (id: string) => {
      const store = storeRef.current
      if (!store) return
      await store.remove(id)
      const remaining = await store.list()
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
        const meta = await store.create('My project')
        await open(meta)
      }
    },
    [current, open],
  )

  // Recomputed only when something actually changed.
  const tree = useMemo(() => project.tree(), [project, revision])
  const paths = useMemo(() => project.paths(), [project, revision])

  return {
    project,
    ready,
    revision,
    tree,
    paths,
    projects,
    current,
    migration,
    createProject,
    openProject,
    renameProject,
    deleteProject,
  }
}
