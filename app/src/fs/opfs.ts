import type { FsSnapshot, ProjectStore } from './types'

/**
 * The pre-multi-project root: one hardwired workspace, files at its top level.
 * Still read (and then retired) by the migration in ./projects.ts.
 */
export const LEGACY_ROOT = 'warsha-project'

/** Origin Private File System store. Chrome/Edge/Safari 16.4+, secure contexts only. */
export class OpfsStore implements ProjectStore {
  readonly kind = 'opfs'

  /**
   * Directory segments this store is rooted at, e.g.
   * `['warsha', 'projects', '<id>', 'files']`. Everything below is the student's
   * own tree, which is why a project's manifest.json lives one level *above*
   * `files/` — inside it, it would show up in the explorer as a project file.
   */
  private readonly segments: readonly string[]

  constructor(segments: readonly string[] = [LEGACY_ROOT]) {
    if (segments.length === 0) throw new Error('OpfsStore needs at least one path segment')
    this.segments = segments
  }

  static available(): boolean {
    return !opfsDisabled && typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
  }

  private async root(): Promise<FileSystemDirectoryHandle> {
    let dir = await navigator.storage.getDirectory()
    for (const segment of this.segments) dir = await dir.getDirectoryHandle(segment, { create: true })
    return dir
  }

  private async dirFor(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let dir = await this.root()
    if (!path) return dir
    for (const part of path.split('/')) {
      if (!part) continue
      try {
        dir = await dir.getDirectoryHandle(part, { create })
      } catch {
        return null
      }
    }
    return dir
  }

  async snapshot(): Promise<FsSnapshot> {
    const files: FsSnapshot['files'] = []
    const dirs: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
      const entries: Array<[string, FileSystemHandle]> = []
      for await (const entry of dir.values()) entries.push([entry.name, entry])
      for (const [name, handle] of entries) {
        const path = prefix ? `${prefix}/${name}` : name
        if (handle.kind === 'directory') {
          dirs.push(path)
          await walk(handle as FileSystemDirectoryHandle, path)
        } else {
          const file = await (handle as FileSystemFileHandle).getFile()
          files.push({ path, content: await file.text() })
        }
      }
    }
    await walk(await this.root(), '')
    return { files, dirs }
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { dir, name } = splitPath(path)
    const handle = await this.dirFor(dir, true)
    if (!handle) throw new Error(`cannot create ${dir}`)
    const fh = await handle.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(content)
    await w.close()
  }

  async mkdir(path: string): Promise<void> {
    await this.dirFor(path, true)
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = splitPath(path)
    const handle = await this.dirFor(dir, false)
    if (!handle) return
    try {
      await handle.removeEntry(name, { recursive: true })
    } catch {
      /* already gone */
    }
  }

  async move(from: string, to: string): Promise<void> {
    const snap = await this.snapshot()
    const moved: FsSnapshot = { files: [], dirs: [] }
    for (const f of snap.files) moved.files.push({ path: remap(f.path, from, to), content: f.content })
    for (const d of snap.dirs) moved.dirs.push(remap(d, from, to))
    await this.replaceAll(moved)
  }

  async replaceAll(snap: FsSnapshot): Promise<void> {
    // Only this store's own leaf is wiped, never an ancestor: a project's
    // manifest.json is a sibling of `files/`, and other projects live alongside.
    let parent = await navigator.storage.getDirectory()
    for (const segment of this.segments.slice(0, -1)) {
      parent = await parent.getDirectoryHandle(segment, { create: true })
    }
    const leaf = this.segments[this.segments.length - 1]
    try {
      await parent.removeEntry(leaf, { recursive: true })
    } catch {
      /* first run */
    }
    for (const d of snap.dirs) await this.mkdir(d)
    for (const f of snap.files) await this.writeFile(f.path, f.content)
  }
}

/** In-memory fallback so the IDE still runs where OPFS is unavailable. */
export class MemoryStore implements ProjectStore {
  readonly kind = 'memory'
  private files = new Map<string, string>()
  private dirs = new Set<string>()

  async snapshot(): Promise<FsSnapshot> {
    return {
      files: [...this.files].map(([path, content]) => ({ path, content })),
      dirs: [...this.dirs],
    }
  }
  async writeFile(path: string, content: string) {
    this.files.set(path, content)
    for (const d of ancestors(path)) this.dirs.add(d)
  }
  async mkdir(path: string) {
    this.dirs.add(path)
    for (const d of ancestors(path)) this.dirs.add(d)
  }
  async remove(path: string) {
    for (const k of [...this.files.keys()]) if (k === path || k.startsWith(path + '/')) this.files.delete(k)
    for (const k of [...this.dirs]) if (k === path || k.startsWith(path + '/')) this.dirs.delete(k)
  }
  async move(from: string, to: string) {
    const snap = await this.snapshot()
    this.files.clear()
    this.dirs.clear()
    for (const f of snap.files) await this.writeFile(remap(f.path, from, to), f.content)
    for (const d of snap.dirs) await this.mkdir(remap(d, from, to))
  }
  async replaceAll(snap: FsSnapshot) {
    this.files.clear()
    this.dirs.clear()
    for (const d of snap.dirs) await this.mkdir(d)
    for (const f of snap.files) await this.writeFile(f.path, f.content)
  }
}

/**
 * A store for one project's files. `segments` addresses it inside OPFS; the
 * memory fallback keeps one store per distinct address for the session, so
 * switching projects and switching back does not lose what was typed.
 */
/**
 * Set by `probeOpfs()` when the API is present but does not actually work —
 * Safari private browsing being the case that matters, where
 * `navigator.storage.getDirectory` exists and every call to it rejects. Feature
 * *detection* says yes and the feature says no, so the only honest test is to
 * use it once. Everything downstream then routes to `MemoryStore` instead of
 * failing one write at a time forever.
 */
let opfsDisabled = false

/** The one in-flight (or settled) probe — see probeOpfs. */
let probing: Promise<boolean> | null = null

/** True once OPFS has been proven usable (or proven not to be). */
export function probeOpfs(): Promise<boolean> {
  // Single-flight, because two probes at once race each other on the SAME
  // probe dir: one's removeEntry lands while the other's writable is still
  // open, the loser sees NoModificationAllowedError, and a perfectly working
  // OPFS gets condemned to the memory fallback for the whole session
  // (StrictMode's dev double-mount reproduces this on every reload). One
  // probe, one verdict, shared by every caller.
  return (probing ??= probeOnce())
}

async function probeOnce(): Promise<boolean> {
  if (opfsDisabled) return false
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    opfsDisabled = true
    return false
  }
  try {
    const root = await navigator.storage.getDirectory()
    // A directory handle alone proves little; Safari hands one out and then
    // refuses the write. Round-trip a probe file and delete it.
    const dir = await root.getDirectoryHandle('.warsha-probe', { create: true })
    const handle = await dir.getFileHandle('w', { create: true })
    const writable = await handle.createWritable()
    await writable.write('ok')
    await writable.close()
    await root.removeEntry('.warsha-probe', { recursive: true })
    return true
  } catch {
    opfsDisabled = true
    return false
  }
}

export function createStore(segments?: readonly string[]): ProjectStore {
  if (OpfsStore.available()) return new OpfsStore(segments)
  const key = (segments ?? [LEGACY_ROOT]).join('/')
  let store = memoryStores.get(key)
  if (!store) {
    store = new MemoryStore()
    memoryStores.set(key, store)
  }
  return store
}

const memoryStores = new Map<string, MemoryStore>()

function splitPath(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) }
}

function ancestors(path: string): string[] {
  const parts = path.split('/')
  parts.pop()
  const out: string[] = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    out.push(acc)
  }
  return out
}

function remap(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(from + '/')) return to + path.slice(from.length)
  return path
}
