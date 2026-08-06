import type { SourceFile } from '../runtime/types'

/** A flat snapshot of the project. `dirs` keeps empty folders alive. */
export interface FsSnapshot {
  files: SourceFile[]
  dirs: string[]
}

/** Storage the IDE needs. Paths are POSIX-ish, relative to root, never leading-slashed. Implemented by OpfsStore and MemoryStore. */
export interface ProjectStore {
  readonly kind: string
  snapshot(): Promise<FsSnapshot>
  writeFile(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  /** Moves a file or a whole folder. */
  move(from: string, to: string): Promise<void>
  /** Wipes the project and writes the given snapshot. Used by templates + zip import. */
  replaceAll(snap: FsSnapshot): Promise<void>
}
