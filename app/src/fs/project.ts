import type { SourceFile } from '../runtime/types'
import type { FsSnapshot, ProjectStore } from './types'
import { MemoryStore } from './opfs'

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children: TreeNode[]
}

type Listener = () => void

const WRITE_DEBOUNCE_MS = 350

/**
 * The in-memory single source of truth for the open project. Every mutation
 * lands here first, then gets flushed to the ProjectStore (debounced for edits,
 * immediate for structural changes) so the UI never waits on disk.
 */
export class Project {
  private store: ProjectStore
  private files = new Map<string, string>()
  private dirs = new Set<string>()
  private dirty = new Set<string>()
  private timers = new Map<string, number>()
  private structureListeners: Listener[] = []
  private dirtyListeners: Listener[] = []

  /**
   * Starts on an empty in-memory store and is pointed at real storage by
   * `switchStore` once the project to open has been resolved. That indirection
   * is what keeps the constructor from touching OPFS: reaching for a directory
   * handle with `create: true` would recreate the pre-multi-project root before
   * the migration in fs/projects.ts had a chance to look for it.
   */
  constructor(store: ProjectStore = new MemoryStore()) {
    this.store = store
  }

  get storeKind() {
    return this.store.kind
  }

  /** Returns an unsubscribe function, so React effects can clean up. */
  onStructureChange(cb: Listener): () => void {
    this.structureListeners.push(cb)
    return () => {
      this.structureListeners = this.structureListeners.filter((l) => l !== cb)
    }
  }
  onDirtyChange(cb: Listener): () => void {
    this.dirtyListeners.push(cb)
    return () => {
      this.dirtyListeners = this.dirtyListeners.filter((l) => l !== cb)
    }
  }
  private emitStructure() {
    for (const cb of [...this.structureListeners]) cb()
  }
  private emitDirty() {
    for (const cb of [...this.dirtyListeners]) cb()
  }

  /**
   * Point this instance at another project's storage and load it.
   *
   * Pending edits are flushed to the *old* store first, so switching away from a
   * project mid-keystroke cannot drop the last 350 ms of typing — and cannot
   * write it into the project being switched to either. The instance identity is
   * kept deliberately: React holds this object, and replacing it would remount
   * the editor and the runner for what is, to them, the same open project.
   */
  async switchStore(store: ProjectStore): Promise<void> {
    await this.saveAll()
    this.store = store
    await this.load()
  }

  async load(): Promise<void> {
    const snap = await this.store.snapshot()
    this.files.clear()
    this.dirs.clear()
    this.dirty.clear()
    for (const f of snap.files) this.files.set(f.path, f.content)
    for (const d of snap.dirs) this.dirs.add(d)
    this.emitStructure()
  }

  isEmpty() {
    return this.files.size === 0 && this.dirs.size === 0
  }

  has(path: string) {
    return this.files.has(path)
  }
  hasDir(path: string) {
    return this.dirs.has(path)
  }
  read(path: string): string | undefined {
    return this.files.get(path)
  }
  isDirty(path: string) {
    return this.dirty.has(path)
  }
  anyDirty() {
    return this.dirty.size > 0
  }

  paths(): string[] {
    return [...this.files.keys()].sort()
  }

  sourceFiles(): SourceFile[] {
    return this.paths().map((path) => ({ path, content: this.files.get(path)! }))
  }

  snapshot(): FsSnapshot {
    return { files: this.sourceFiles(), dirs: [...this.dirs].sort() }
  }

  /** Editor keystrokes land here: instant in memory, flushed on a debounce. */
  setContent(path: string, content: string) {
    if (this.files.get(path) === content) return
    this.files.set(path, content)
    if (!this.dirty.has(path)) {
      this.dirty.add(path)
      this.emitDirty()
    }
    const existing = this.timers.get(path)
    if (existing) clearTimeout(existing)
    this.timers.set(
      path,
      window.setTimeout(() => {
        this.timers.delete(path)
        void this.flush(path)
      }, WRITE_DEBOUNCE_MS),
    )
  }

  private async flush(path: string) {
    const content = this.files.get(path)
    if (content === undefined) return
    await this.store.writeFile(path, content)
    if (this.dirty.delete(path)) this.emitDirty()
  }

  /** Run() calls this so the engine always sees what's on screen. */
  async saveAll(): Promise<void> {
    for (const [, t] of this.timers) clearTimeout(t)
    this.timers.clear()
    await Promise.all([...this.dirty].map((p) => this.flush(p)))
  }

  async createFile(path: string, content = ''): Promise<void> {
    if (this.files.has(path)) throw new Error(`"${path}" already exists`)
    this.files.set(path, content)
    for (const d of ancestors(path)) this.dirs.add(d)
    await this.store.writeFile(path, content)
    this.emitStructure()
  }

  async createFolder(path: string): Promise<void> {
    if (this.dirs.has(path)) throw new Error(`"${path}" already exists`)
    this.dirs.add(path)
    for (const d of ancestors(path)) this.dirs.add(d)
    await this.store.mkdir(path)
    this.emitStructure()
  }

  async remove(path: string): Promise<void> {
    for (const k of [...this.files.keys()]) if (k === path || k.startsWith(path + '/')) this.files.delete(k)
    for (const k of [...this.dirs]) if (k === path || k.startsWith(path + '/')) this.dirs.delete(k)
    for (const k of [...this.dirty]) if (k === path || k.startsWith(path + '/')) this.dirty.delete(k)
    await this.store.remove(path)
    this.emitStructure()
    this.emitDirty()
  }

  /** Renames a file or folder in place; returns the map of old→new file paths. */
  async move(from: string, to: string): Promise<Map<string, string>> {
    if (this.files.has(to) || this.dirs.has(to)) throw new Error(`"${to}" already exists`)
    const mapping = new Map<string, string>()
    const nextFiles = new Map<string, string>()
    for (const [k, v] of this.files) {
      const nk = remap(k, from, to)
      if (nk !== k) mapping.set(k, nk)
      nextFiles.set(nk, v)
    }
    const nextDirs = new Set<string>()
    for (const d of this.dirs) nextDirs.add(remap(d, from, to))
    for (const d of [...nextFiles.keys()].flatMap(ancestors)) nextDirs.add(d)
    this.files = nextFiles
    this.dirs = nextDirs
    const nextDirty = new Set<string>()
    for (const d of this.dirty) nextDirty.add(remap(d, from, to))
    this.dirty = nextDirty
    await this.store.move(from, to)
    this.emitStructure()
    return mapping
  }

  async replaceAll(snap: FsSnapshot): Promise<void> {
    for (const [, t] of this.timers) clearTimeout(t)
    this.timers.clear()
    this.dirty.clear()
    this.files.clear()
    this.dirs.clear()
    for (const d of snap.dirs) this.dirs.add(d)
    for (const f of snap.files) {
      this.files.set(f.path, f.content)
      for (const d of ancestors(f.path)) this.dirs.add(d)
    }
    await this.store.replaceAll(this.snapshot())
    this.emitStructure()
    this.emitDirty()
  }

  tree(): TreeNode {
    const root: TreeNode = { name: '', path: '', kind: 'dir', children: [] }
    const dirNode = (path: string): TreeNode => {
      if (!path) return root
      const parts = path.split('/')
      let node = root
      let acc = ''
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part
        let next = node.children.find((c) => c.kind === 'dir' && c.name === part)
        if (!next) {
          next = { name: part, path: acc, kind: 'dir', children: [] }
          node.children.push(next)
        }
        node = next
      }
      return node
    }
    for (const d of [...this.dirs].sort()) dirNode(d)
    for (const p of this.paths()) {
      const { dir, name } = splitPath(p)
      dirNode(dir).children.push({ name, path: p, kind: 'file', children: [] })
    }
    sortTree(root)
    return root
  }
}

function sortTree(node: TreeNode) {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
  for (const c of node.children) sortTree(c)
}

export function splitPath(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) }
}

export function ancestors(path: string): string[] {
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
