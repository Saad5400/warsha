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
      // A directory with no readable manifest is still someone's work, so it is
      // adopted under its own id rather than hidden or deleted.
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
  /**
   * The project prefs pointed at is gone — the iOS eviction case, or a second
   * tab deleting it. We opened something else rather than showing nothing.
   */
  | { kind: 'reopened-elsewhere'; wanted: string }

export interface OpenedProjects {
  projects: ProjectsStore
  list: ProjectMeta[]
  current: ProjectMeta
  migration: MigrationOutcome
}

/**
 * Resolves which project to open, migrating the single hardwired workspace of
 * earlier builds into a real project on the way.
 *
 * `preferredId` is the last-opened project from prefs; it wins when it still
 * exists, otherwise the most recently opened one does.
 */
export async function openProjects(preferredId: string | null): Promise<OpenedProjects> {
  // OPFS is probed rather than feature-detected: Safari private browsing
  // exposes the whole API and rejects every call, and the old code turned that
  // into a rejected boot promise — the app rendered its shell with `ready`
  // stuck false and no message at all. See probeOpfs().
  const opfsWorks = await probeOpfs()
  try {
    const opened = await openWith(createProjects(), preferredId)
    // Falling back to memory must not be silent. `capabilities.ts` cannot catch
    // this case: it feature-detects `navigator.storage.getDirectory`, which
    // Safari private browsing provides and then refuses to honour — so the
    // capability warning stays quiet while every write goes to a Map that dies
    // with the tab. This is the only place that knows the difference.
    if (!opfsWorks || opened.projects.kind === 'memory') {
      return { ...opened, migration: { kind: 'storage-unavailable', detail: 'OPFS is not usable in this browser' } }
    }
    return opened
  } catch (error) {
    // Anything at all went wrong with real storage. A session in memory with a
    // banner is a usable IDE; a thrown promise here is a dead app.
    const fallback = await openWith(new MemoryProjects(), preferredId)
    return { ...fallback, migration: { kind: 'storage-unavailable', detail: String(error) } }
  }
}

async function openWith(projects: ProjectsStore, preferredId: string | null): Promise<OpenedProjects> {
  let list = await projects.list()
  let migration: MigrationOutcome = { kind: 'none' }

  if (list.length === 0) {
    const legacy = await readLegacy()
    if (legacy && (legacy.files.length > 0 || legacy.dirs.length > 0)) {
      const meta = await projects.create(DEFAULT_FIRST_NAME, legacy)
      // Only retire the old copy once the new one is provably identical. Losing
      // a student's only copy of their work is unrecoverable, so a failed check
      // leaves the original exactly where it was and says so.
      const verified = await verifyCopy(projects.storeFor(meta.id), legacy)
      if (verified) {
        await retireLegacy()
        migration = { kind: 'migrated', files: legacy.files.length }
      } else {
        migration = { kind: 'migration-kept-original', files: legacy.files.length }
      }
    } else {
      await projects.create(DEFAULT_FIRST_NAME)
      migration = { kind: 'first-run' }
    }
    list = await projects.list()
  }

  let current = list.find((p) => p.id === preferredId)
  if (!current) {
    // The remembered project is not there. On iOS that is eviction, not a bug:
    // Safari clears OPFS for sites that are not installed to the home screen.
    // Open the next most recent one and say so, rather than crash-looping on an
    // id that will never come back.
    if (preferredId && list.length > 0) migration = { kind: 'reopened-elsewhere', wanted: preferredId }
    current = list[0]
  }
  // `create` can itself fail on a store that lies about being writable, which
  // would otherwise leave `current` undefined and the next line throwing on
  // `.id`. One more create, then give up to the caller's fallback.
  if (!current) {
    current = await projects.create(DEFAULT_FIRST_NAME)
    list = await projects.list()
    if (list.length === 0) list = [current]
  }
  await projects.touch(current.id)
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
