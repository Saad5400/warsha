/**
 * The Yjs document model — the canonical data model for a collaborative project
 * (COLLAB-SYNC-CONTRACT §1). One `Y.Doc` per project:
 *
 *   files : Y.Map<path, Y.Text>   file contents; path is POSIX, root-relative, no leading slash
 *   dirs  : Y.Map<path, true>     empty directories (set semantics — CRDT-safe, no dup-append)
 *   meta  : Y.Map                 { name, entry, schema }
 *
 * This module is deliberately dependency-light: it imports only `yjs`, no DOM,
 * no React, no `import.meta.env`. That keeps the round-trip and the mutators
 * unit-testable in plain Node, and keeps the CRDT rules in one place both the
 * bridge and the editor binding build on.
 */
import * as Y from 'yjs'
import type { FsSnapshot } from '../fs/types'

/** Bumped only on an incompatible change to the shape above (contract §1). */
export const SCHEMA_VERSION = 1

/** Owner-authored link access, propagated through the doc so already-connected
 *  honest guests react to a mid-session change (contract §7.2/§7.4). Absent until
 *  the owner touches the share picker; a guest then re-resolves its effective role. */
export type MetaLinkAccess = 'editor' | 'viewer' | 'none'

export interface DocMeta {
  /** Project name (mirrors the manifest — informational; the manifest still owns it locally). */
  name: string
  /** The file Run should start from, when the sharer had one chosen. */
  entry: string | null
  /** Schema version, for forward-compat gating. */
  schema: number
  /** Owner-authored link access, or null until the owner has published one (§7.4). */
  linkAccess: MetaLinkAccess | null
}

/** A valid owner-authored link-access value, else null (defensive against a peer
 *  writing garbage into meta — an honest-client convenience, not a security gate). */
export function readLinkAccess(doc: Y.Doc): MetaLinkAccess | null {
  const la = metaMap(doc).get('linkAccess')
  return la === 'editor' || la === 'viewer' || la === 'none' ? la : null
}

export function filesMap(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>('files')
}
export function dirsMap(doc: Y.Doc): Y.Map<true> {
  return doc.getMap<true>('dirs')
}
export function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta')
}

/** POSIX ancestor directories of a path, shallowest first ("a/b/c.txt" → ["a","a/b"]). */
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

/**
 * Populate `doc` from a flat `FsSnapshot` — used to seed a fresh room from the
 * project the host already has open. Idempotent per key: re-seeding a file that
 * already exists rewrites its `Y.Text` to match (kept minimal via `replaceYText`).
 * Runs inside one transaction so peers/persistence see a single atomic update.
 */
export function snapshotToYdoc(snap: FsSnapshot, doc: Y.Doc, meta?: Partial<DocMeta>): void {
  const files = filesMap(doc)
  const dirs = dirsMap(doc)
  const m = metaMap(doc)
  doc.transact(() => {
    for (const d of snap.dirs) dirs.set(d, true)
    for (const f of snap.files) {
      for (const d of ancestors(f.path)) dirs.set(d, true)
      let text = files.get(f.path)
      if (!text) {
        text = new Y.Text()
        files.set(f.path, text)
        if (f.content) text.insert(0, f.content)
      } else {
        replaceYText(text, f.content)
      }
    }
    if (meta) {
      if (meta.name !== undefined) m.set('name', meta.name)
      if (meta.entry !== undefined) m.set('entry', meta.entry)
    }
    if (m.get('schema') === undefined) m.set('schema', SCHEMA_VERSION)
  }, 'seed')
}

/** Read the whole doc back out as a flat `FsSnapshot` (files sorted for stable output). */
export function ydocToSnapshot(doc: Y.Doc): FsSnapshot {
  const files = filesMap(doc)
  const dirs = dirsMap(doc)
  const out: FsSnapshot = { files: [], dirs: [] }
  for (const [path, text] of files) out.files.push({ path, content: text.toString() })
  out.files.sort((a, b) => a.path.localeCompare(b.path))
  for (const [path] of dirs) out.dirs.push(path)
  out.dirs.sort()
  return out
}

export function readMeta(doc: Y.Doc): DocMeta {
  const m = metaMap(doc)
  return {
    name: typeof m.get('name') === 'string' ? (m.get('name') as string) : '',
    entry: typeof m.get('entry') === 'string' ? (m.get('entry') as string) : null,
    schema: typeof m.get('schema') === 'number' ? (m.get('schema') as number) : SCHEMA_VERSION,
    linkAccess: readLinkAccess(doc),
  }
}

/**
 * Rewrite `ytext` to `next` with the smallest edit that gets there — a common
 * prefix/suffix diff, not a delete-all-then-reinsert. This matters for CRDT
 * merge: a whole-`Y.Text` wipe (what a naive Format would do) discards every
 * concurrent remote insertion; a minimal splice touches only the region that
 * actually changed, so a peer typing elsewhere is preserved (contract edge #2).
 */
export function replaceYText(ytext: Y.Text, next: string): void {
  const prev = ytext.toString()
  if (prev === next) return
  const minLen = Math.min(prev.length, next.length)
  let start = 0
  while (start < minLen && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  const apply = () => {
    if (endPrev > start) ytext.delete(start, endPrev - start)
    if (endNext > start) ytext.insert(start, next.slice(start, endNext))
  }
  if (ytext.doc) ytext.doc.transact(apply)
  else apply()
}

// ---- Structural mutators (contract §1): every fs mutation on a collab-enabled
// project must go through the Y.Doc, not ProjectStore directly. The bridge
// (materialize.ts) calls these when it detects a local structural change so it
// propagates to peers; the materializer's echo-guard keeps the reverse write
// from bouncing back. Each is idempotent so a re-run (or a seed racing a
// provider) never throws.

export function ydCreateFile(doc: Y.Doc, path: string, content = ''): void {
  const files = filesMap(doc)
  const dirs = dirsMap(doc)
  doc.transact(() => {
    for (const d of ancestors(path)) dirs.set(d, true)
    let text = files.get(path)
    if (!text) {
      text = new Y.Text()
      files.set(path, text)
      if (content) text.insert(0, content)
    } else {
      replaceYText(text, content)
    }
  })
}

export function ydCreateFolder(doc: Y.Doc, path: string): void {
  const dirs = dirsMap(doc)
  doc.transact(() => {
    dirs.set(path, true)
    for (const d of ancestors(path)) dirs.set(d, true)
  })
}

/** Removes a file/folder and everything under it (path or `path/` prefix). */
export function ydRemove(doc: Y.Doc, path: string): void {
  const files = filesMap(doc)
  const dirs = dirsMap(doc)
  const prefix = path + '/'
  doc.transact(() => {
    for (const k of [...files.keys()]) if (k === path || k.startsWith(prefix)) files.delete(k)
    for (const k of [...dirs.keys()]) if (k === path || k.startsWith(prefix)) dirs.delete(k)
  })
}

/**
 * Rename/move a file or folder. Per contract §1 a `Y.Text` cannot be re-keyed
 * in place, so this creates a fresh `Y.Text` from the old content under the new
 * key and deletes the old — losing that file's edit history, which is the
 * accepted Phase-1 trade. Returns the old→new file-path map (like Project.move).
 */
export function ydMove(doc: Y.Doc, from: string, to: string): Map<string, string> {
  const files = filesMap(doc)
  const dirs = dirsMap(doc)
  const mapping = new Map<string, string>()
  const remap = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  doc.transact(() => {
    for (const k of [...files.keys()]) {
      const nk = remap(k)
      if (nk === k) continue
      const content = files.get(k)!.toString()
      const text = new Y.Text()
      files.set(nk, text)
      if (content) text.insert(0, content)
      files.delete(k)
      mapping.set(k, nk)
      for (const d of ancestors(nk)) dirs.set(d, true)
    }
    for (const k of [...dirs.keys()]) {
      const nk = remap(k)
      if (nk === k) continue
      dirs.delete(k)
      dirs.set(nk, true)
    }
  })
  return mapping
}
