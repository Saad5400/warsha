import type { SourceFile } from '../runtime/types'
import type { FsSnapshot, ProjectStore } from './types'
import { MemoryStore } from './opfs'
import { toStorageProblem, type StorageProblem } from './health'

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'dir'
  children: TreeNode[]
}

type Listener = () => void

const WRITE_DEBOUNCE_MS = 350

/** Single source of truth for the open project; mutations land here then flush to ProjectStore — debounced for edits, immediate for structural changes. */
export class Project {
  private store: ProjectStore
  private files = new Map<string, string>()
  private dirs = new Set<string>()
  private dirty = new Set<string>()
  private timers = new Map<string, number>()
  private structureListeners: Listener[] = []
  private dirtyListeners: Listener[] = []
  private storageListeners: Listener[] = []
  private problem: StorageProblem | null = null
  /** Bumped on every `switchStore`. Collab's ProjectBridge captures it at
   *  construction and hard-gates on it, so a project switch can never diff the
   *  NEW project's files against an old room's doc (which wiped the room). */
  private storeEpoch = 0

  /** Starts on an in-memory store; `switchStore` points it at real storage later — touching OPFS here could recreate the legacy root before migration runs. */
  constructor(store: ProjectStore = new MemoryStore()) {
    this.store = store
  }

  get storeKind() {
    return this.store.kind
  }

  /** Identity of the attached store over time — changes iff `switchStore` ran. */
  get epoch() {
    return this.storeEpoch
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
  /** Fires on write failure, and again on recovery. Drives the persistent banner — told now, while a .zip export is still possible, not tomorrow. */
  onStorageProblem(cb: Listener): () => void {
    this.storageListeners.push(cb)
    return () => {
      this.storageListeners = this.storageListeners.filter((l) => l !== cb)
    }
  }
  private emitStructure() {
    for (const cb of [...this.structureListeners]) cb()
  }
  private emitDirty() {
    for (const cb of [...this.dirtyListeners]) cb()
  }
  private emitStorage() {
    for (const cb of [...this.storageListeners]) cb()
  }

  /** Null while storage is healthy. */
  get storageProblem(): StorageProblem | null {
    return this.problem
  }

  private setProblem(next: StorageProblem | null) {
    const before = this.problem?.fault ?? null
    this.problem = next
    if (before !== (next?.fault ?? null)) this.emitStorage()
  }

  /** Every store write funnels through here — used to fail as an invisible unhandled rejection in a `setTimeout`; now it's UI-renderable state. */
  private async attempt(op: () => Promise<void>, path?: string): Promise<boolean> {
    try {
      await op()
      this.setProblem(null)
      return true
    } catch (error) {
      this.setProblem(toStorageProblem(error, path))
      return false
    }
  }

  /** Switches storage after flushing pending edits to the old store (no dropped keystrokes or cross-writes); keeps this instance's identity so React doesn't remount. */
  async switchStore(store: ProjectStore): Promise<void> {
    await this.saveAll()
    this.store = store
    // Bumped BEFORE load()'s emitStructure, so a still-attached collab bridge is
    // already gated out when the new project's structure event fires.
    this.storeEpoch++
    await this.load()
  }

  async load(): Promise<void> {
    // Unreadable store is reported, not thrown — an exception here leaves boot
    // with no project and no explanation.
    let snap: FsSnapshot = { files: [], dirs: [] }
    await this.attempt(async () => {
      snap = await this.store.snapshot()
    })
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

  /** A failed write stays dirty on purpose — the amber dot is the only honest signal, and the next flush retries free. */
  private async flush(path: string): Promise<boolean> {
    const content = this.files.get(path)
    if (content === undefined) return true
    const ok = await this.attempt(() => this.store.writeFile(path, content), path)
    if (ok && this.dirty.delete(path)) this.emitDirty()
    return ok
  }

  /** Called before Run so the engine sees what's on screen; returns false so the caller doesn't blame stale bytes on the student's code. */
  async saveAll(): Promise<boolean> {
    for (const [, t] of this.timers) clearTimeout(t)
    this.timers.clear()
    const results = await Promise.all([...this.dirty].map((p) => this.flush(p)))
    return results.every(Boolean)
  }

  async createFile(path: string, content = ''): Promise<void> {
    if (this.files.has(path)) throw new Error(`"${path}" already exists`)
    this.files.set(path, content)
    for (const d of ancestors(path)) this.dirs.add(d)
    // Memory first, then storage — a failed disk write still gives the student their file, just marked dirty.
    if (!(await this.attempt(() => this.store.writeFile(path, content), path))) this.markDirty(path)
    this.emitStructure()
  }

  async createFolder(path: string): Promise<void> {
    if (this.dirs.has(path)) throw new Error(`"${path}" already exists`)
    this.dirs.add(path)
    for (const d of ancestors(path)) this.dirs.add(d)
    await this.attempt(() => this.store.mkdir(path), path)
    this.emitStructure()
  }

  private markDirty(path: string) {
    if (!this.dirty.has(path)) {
      this.dirty.add(path)
      this.emitDirty()
    }
  }

  async remove(path: string): Promise<void> {
    for (const k of [...this.files.keys()]) if (k === path || k.startsWith(path + '/')) this.files.delete(k)
    for (const k of [...this.dirs]) if (k === path || k.startsWith(path + '/')) this.dirs.delete(k)
    for (const k of [...this.dirty]) if (k === path || k.startsWith(path + '/')) this.dirty.delete(k)
    await this.attempt(() => this.store.remove(path), path)
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
    await this.attempt(() => this.store.move(from, to), to)
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
    const snapshot = this.snapshot()
    if (!(await this.attempt(() => this.store.replaceAll(snapshot)))) {
      // Still on screen and runnable even if the write failed — mark everything dirty so the next save retries.
      for (const f of snapshot.files) this.dirty.add(f.path)
    }
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
