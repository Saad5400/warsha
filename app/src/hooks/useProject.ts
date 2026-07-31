import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Project, type TreeNode } from '../fs/project'

/**
 * Binds the plain-TS `Project` (the single source of truth for files) to React.
 * Project emits structure/dirty events; we bump a revision counter and let
 * components read straight off the instance. Cheaper and far less error-prone
 * than mirroring the whole file tree into component state.
 */
export interface ProjectView {
  project: Project
  ready: boolean
  /** Increments whenever files or dirty flags change. */
  revision: number
  tree: TreeNode
  paths: string[]
}

export function useProject(): ProjectView {
  const projectRef = useRef<Project | null>(null)
  if (!projectRef.current) projectRef.current = new Project()
  const project = projectRef.current

  const [revision, setRevision] = useState(0)
  const [ready, setReady] = useState(false)

  const bump = useCallback(() => setRevision((r) => r + 1), [])

  useEffect(() => {
    const offStructure = project.onStructureChange(bump)
    const offDirty = project.onDirtyChange(bump)
    let cancelled = false
    void project.load().then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
      offStructure()
      offDirty()
    }
  }, [project, bump])

  // Recomputed only when something actually changed.
  const tree = useMemo(() => project.tree(), [project, revision])
  const paths = useMemo(() => project.paths(), [project, revision])

  return { project, ready, revision, tree, paths }
}
