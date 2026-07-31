import type { FsSnapshot, ProjectStore } from './types'

const ROOT = 'warsha-project'

/** Origin Private File System store. Chrome/Edge/Safari 16.4+, secure contexts only. */
export class OpfsStore implements ProjectStore {
  readonly kind = 'opfs'

  static available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
  }

  private async root(): Promise<FileSystemDirectoryHandle> {
    const base = await navigator.storage.getDirectory()
    return base.getDirectoryHandle(ROOT, { create: true })
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
    const base = await navigator.storage.getDirectory()
    try {
      await base.removeEntry(ROOT, { recursive: true })
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

export function createStore(): ProjectStore {
  return OpfsStore.available() ? new OpfsStore() : new MemoryStore()
}

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
