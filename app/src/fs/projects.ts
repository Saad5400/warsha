import type { FsSnapshot, ProjectStore } from './types'
import { LEGACY_ROOT, OpfsStore, createStore, probeOpfs } from './opfs'

/**
 * Multiple projects, minimally.
 *
 * OPFS layout:
 *
 *   warsha/projects/<id>/manifest.json    {id, name, createdAt, lastOpenedAt}
 *   warsha/projects/<id>/files/…          the student's own tree
 *
 * The manifest is a *sibling* of `files/`, not inside it: a ProjectStore reports
 * everything under its root as project content, so a manifest one level down
 * would appear in the explorer as a file the student could rename or delete.
 *
 * There is deliberately no central index file. The directory listing is the
 * index, so a half-finished write can lose at most the project it belongs to,
 * and deleting a project is one recursive `removeEntry`. With a handful of
 * projects the cost of reading N small manifests is irrelevant.
 */
export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  lastOpenedAt: number
}

const ROOT = 'warsha'
const PROJECTS = 'projects'
const FILES = 'files'
const MANIFEST = 'manifest.json'

/** Where one project's *files* live. The store is rooted here. */
export function projectSegments(id: string): string[] {
  return [ROOT, PROJECTS, id, FILES]
}

export interface ProjectsStore {
  readonly kind: string
  /** Most recently opened first — the order the switcher shows. */
  list(): Promise<ProjectMeta[]>
  create(name: string, snapshot?: FsSnapshot): Promise<ProjectMeta>
  rename(id: string, name: string): Promise<void>
  remove(id: string): Promise<void>
  /** Marks a project as the one just opened. */
  touch(id: string): Promise<void>
  /** The file store for one project. */
  storeFor(id: string): ProjectStore
}

function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function sortByRecent(metas: ProjectMeta[]): ProjectMeta[] {
  return [...metas].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name))
}

/** Tolerates anything: a manifest we cannot parse is treated as absent. */
function parseMeta(text: string, fallbackId: string): ProjectMeta | null {
  try {
    const raw = JSON.parse(text) as Partial<ProjectMeta>
    if (!raw || typeof raw.name !== 'string') return null
    return {
      id: typeof raw.id === 'string' ? raw.id : fallbackId,
      name: raw.name,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      lastOpenedAt: typeof raw.lastOpenedAt === 'number' ? raw.lastOpenedAt : 0,
    }
  } catch {
    return null
  }
}

class OpfsProjects implements ProjectsStore {
  readonly kind = 'opfs'

  private async projectsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      const base = await navigator.storage.getDirectory()
      const root = await base.getDirectoryHandle(ROOT, { create })
      return await root.getDirectoryHandle(PROJECTS, { create })
    } catch {
      return null
    }
  }

  private async readMeta(dir: FileSystemDirectoryHandle, id: string): Promise<ProjectMeta | null> {
    try {
      const handle = await dir.getFileHandle(MANIFEST)
      const file = await handle.getFile()
      return parseMeta(await file.text(), id)
    } catch {
      return null
    }
  }

  private async writeMeta(meta: ProjectMeta): Promise<void> {
    const dir = await this.projectsDir(true)
    if (!dir) throw new Error('storage is unavailable')
    const projectDir = await dir.getDirectoryHandle(meta.id, { create: true })
    const handle = await projectDir.getFileHandle(MANIFEST, { create: true })
    const writable = await handle.createWritable()
    await writable.write(JSON.stringify(meta))
    await writable.close()
  }

  async list(): Promise<ProjectMeta[]> {
    const dir = await this.projectsDir(false)
    if (!dir) return []
    const ids: string[] = []
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') ids.push(entry.name)
    }
    const metas: ProjectMeta[] = []
    for (const id of ids) {
      const projectDir = await dir.getDirectoryHandle(id).catch(() => null)
      if (!projectDir) continue
      const meta = await this.readMeta(projectDir, id)
      // No readable manifest doesn't mean no work — adopt under its own id, don't hide or delete it.
      metas.push(meta ?? { id, name: 'Untitled project', createdAt: Date.now(), lastOpenedAt: 0 })
    }
    return sortByRecent(metas)
  }

  async create(name: string, snapshot?: FsSnapshot): Promise<ProjectMeta> {
    const now = Date.now()
    const meta: ProjectMeta = { id: newId(), name, createdAt: now, lastOpenedAt: now }
    await this.writeMeta(meta)
    if (snapshot) await this.storeFor(meta.id).replaceAll(snapshot)
    else await this.storeFor(meta.id).mkdir('')
    return meta
  }

  async rename(id: string, name: string): Promise<void> {
    const dir = await this.projectsDir(false)
    if (!dir) return
    const projectDir = await dir.getDirectoryHandle(id).catch(() => null)
    if (!projectDir) return
    const existing = (await this.readMeta(projectDir, id)) ?? {
      id,
      name,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
    }
    await this.writeMeta({ ...existing, id, name })
  }

  async remove(id: string): Promise<void> {
    const dir = await this.projectsDir(false)
    if (!dir) return
    await dir.removeEntry(id, { recursive: true }).catch(() => {})
  }

  async touch(id: string): Promise<void> {
    const dir = await this.projectsDir(false)
    if (!dir) return
    const projectDir = await dir.getDirectoryHandle(id).catch(() => null)
    if (!projectDir) return
    const existing = await this.readMeta(projectDir, id)
    if (!existing) return
    await this.writeMeta({ ...existing, lastOpenedAt: Date.now() })
  }

  storeFor(id: string): ProjectStore {
    return createStore(projectSegments(id))
  }
}

/** Session-only fallback where OPFS is unavailable (see MemoryStore). */
class MemoryProjects implements ProjectsStore {
  readonly kind = 'memory'
  private metas = new Map<string, ProjectMeta>()

  async list(): Promise<ProjectMeta[]> {
    return sortByRecent([...this.metas.values()])
  }
  async create(name: string, snapshot?: FsSnapshot): Promise<ProjectMeta> {
    const now = Date.now()
    const meta: ProjectMeta = { id: newId(), name, createdAt: now, lastOpenedAt: now }
    this.metas.set(meta.id, meta)
    if (snapshot) await this.storeFor(meta.id).replaceAll(snapshot)
    return meta
  }
  async rename(id: string, name: string): Promise<void> {
    const meta = this.metas.get(id)
    if (meta) this.metas.set(id, { ...meta, name })
  }
  async remove(id: string): Promise<void> {
    this.metas.delete(id)
  }
  async touch(id: string): Promise<void> {
    const meta = this.metas.get(id)
    if (meta) this.metas.set(id, { ...meta, lastOpenedAt: Date.now() })
  }
  storeFor(id: string): ProjectStore {
    return createStore(projectSegments(id))
  }
}

export function createProjects(): ProjectsStore {
  return OpfsStore.available() ? new OpfsProjects() : new MemoryProjects()
}

/** What `openProjects` did, so the shell can tell the student if it matters. */
export type MigrationOutcome =
  | { kind: 'none' }
  | { kind: 'first-run' }
  | { kind: 'migrated'; files: number }
  | { kind: 'migration-kept-original'; files: number }
  /** Storage refused to work at all; this session is in memory only. */
  | { kind: 'storage-unavailable'; detail: string }
  /** Remembered project is gone (iOS eviction, or another tab deleted it) — opened something else instead. */
  | { kind: 'reopened-elsewhere'; wanted: string }

export interface OpenedProjects {
  projects: ProjectsStore
  list: ProjectMeta[]
  /** Null on a fresh device (nothing to open) — the shell lands on Home's empty state instead of auto-creating a project. */
  current: ProjectMeta | null
  migration: MigrationOutcome
}

/**
 * Resolves which project to open, migrating the old single-workspace layout on
 * the way; `preferredId` wins if still present, else the most recent.
 */
export async function openProjects(preferredId: string | null): Promise<OpenedProjects> {
  // Probed not feature-detected — Safari private browsing exposes the API but
  // rejects every call, which used to hang boot silently. See probeOpfs().
  const opfsWorks = await probeOpfs()
  try {
    const opened = await openWith(createProjects(), preferredId)
    // Must surface this fallback — capabilities.ts feature-detects the API, which
    // Safari private browsing offers then refuses; only here is the gap caught.
    if (!opfsWorks || opened.projects.kind === 'memory') {
      return { ...opened, migration: { kind: 'storage-unavailable', detail: 'OPFS is not usable in this browser' } }
    }
    return opened
  } catch (error) {
    // Any storage failure: memory + a banner is usable; a thrown promise here is a dead app.
    const fallback = await openWith(new MemoryProjects(), preferredId)
    return { ...fallback, migration: { kind: 'storage-unavailable', detail: String(error) } }
  }
}

async function openWith(projects: ProjectsStore, preferredId: string | null): Promise<OpenedProjects> {
  let list = await projects.list()
  let migration: MigrationOutcome = { kind: 'none' }

  // Only the legacy single-workspace layout is auto-adopted. A genuinely fresh
  // device creates nothing — Home shows its empty state, and the first project is
  // born when the student picks a starter. (The old eager "My project" create put
  // a phantom project on every clean install and, under React StrictMode's
  // double-mount in dev, raced two creates into two identical copies.)
  if (list.length === 0) {
    const legacy = await readLegacy()
    if (legacy && (legacy.files.length > 0 || legacy.dirs.length > 0)) {
      const meta = await projects.create(DEFAULT_FIRST_NAME, legacy)
      // Retire the old copy only once verified identical — losing a student's only copy is unrecoverable.
      const verified = await verifyCopy(projects.storeFor(meta.id), legacy)
      if (verified) {
        await retireLegacy()
        migration = { kind: 'migrated', files: legacy.files.length }
      } else {
        migration = { kind: 'migration-kept-original', files: legacy.files.length }
      }
      list = await projects.list()
    }
  }

  let current = list.find((p) => p.id === preferredId) ?? null
  if (!current) {
    // Missing preferred project is often iOS eviction, not a bug — fall back to the
    // next most recent; null only when there is genuinely nothing to open.
    if (preferredId && list.length > 0) migration = { kind: 'reopened-elsewhere', wanted: preferredId }
    current = list[0] ?? null
  }
  if (current) await projects.touch(current.id)
  return { projects, list, current, migration }
}

const DEFAULT_FIRST_NAME = 'My project'

/** A default that reads as a name, not a slot: "Project 2", "Project 3"… */
export function nextProjectName(list: ProjectMeta[]): string {
  const taken = new Set(list.map((p) => p.name))
  for (let n = list.length + 1; ; n++) {
    const name = `Project ${n}`
    if (!taken.has(name)) return name
  }
}

async function readLegacy(): Promise<FsSnapshot | null> {
  if (!OpfsStore.available()) return null
  try {
    const base = await navigator.storage.getDirectory()
    // Probed without `create`, so a first run does not resurrect the old layout.
    await base.getDirectoryHandle(LEGACY_ROOT)
  } catch {
    return null
  }
  try {
    return await new OpfsStore([LEGACY_ROOT]).snapshot()
  } catch {
    return null
  }
}

async function verifyCopy(store: ProjectStore, expected: FsSnapshot): Promise<boolean> {
  try {
    const actual = await store.snapshot()
    if (actual.files.length !== expected.files.length) return false
    const byPath = new Map(actual.files.map((f) => [f.path, f.content]))
    return expected.files.every((f) => byPath.get(f.path) === f.content)
  } catch {
    return false
  }
}

async function retireLegacy(): Promise<void> {
  try {
    const base = await navigator.storage.getDirectory()
    await base.removeEntry(LEGACY_ROOT, { recursive: true })
  } catch {
    /* nothing to retire */
  }
}
