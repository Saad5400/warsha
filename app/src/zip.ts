import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type { FsSnapshot } from './fs/types'

const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX)(\/|$)/

/**
 * Import limits — `unzipSync` runs on the main thread and allocates everything at once, so
 * refusing early is the only alternative to freezing the tab.
 *
 *  - `MAX_ARCHIVE_BYTES`: checked on the `File` itself — even reading a multi-gigabyte file crashes.
 *  - `MAX_TOTAL_BYTES`: checked against declared sizes during unzip's filter, before inflating —
 *    the zip-bomb guard (42.zip declares 4.5PB from 42kB).
 *  - `MAX_ENTRIES`: bounds the explorer/tab strip as much as memory.
 *
 * Generous for a real project (a few KB); hitting one means the file, not the student, is the problem.
 */
export const ZIP_LIMITS = {
  MAX_ARCHIVE_BYTES: 50 * 1024 * 1024,
  MAX_TOTAL_BYTES: 64 * 1024 * 1024,
  MAX_FILE_BYTES: 8 * 1024 * 1024,
  MAX_ENTRIES: 2000,
  MAX_PATH_LENGTH: 240,
} as const

/** Why an import was refused. The dialog maps these to a sentence. */
export type ZipRejection = 'too-big' | 'too-many' | 'bomb' | 'unreadable' | 'empty'

export class ZipImportError extends Error {
  constructor(
    readonly rejection: ZipRejection,
    message: string,
  ) {
    super(message)
    this.name = 'ZipImportError'
  }
}

export interface ZipImportResult {
  snapshot: FsSnapshot
  /** Left-out entries and why, so the dialog says "3 files skipped" instead of silently importing
   *  something different — that's how a project arrives missing the one file an exercise needed. */
  skipped: Array<{ path: string; reason: 'binary' | 'unsafe-path' | 'too-large' }>
}

export function exportZip(snap: FsSnapshot, name = 'warsha-project.zip') {
  const entries: Record<string, Uint8Array> = {}
  for (const f of snap.files) entries[f.path] = strToU8(f.content)
  // Empty folders survive the round-trip as bare directory entries.
  for (const d of snap.dirs) {
    if (!snap.files.some((f) => f.path.startsWith(d + '/'))) entries[d + '/'] = new Uint8Array(0)
  }
  const zipped = zipSync(entries, { level: 6 })
  const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Zip entries are attacker-controlled strings, not paths (`../../etc/passwd`, `C:\evil` are legal
 * entry names). OPFS keeps us in-origin, but a `..` can still land a file somewhere unexpected, and
 * `\` produces a name the explorer and the store would split differently. Refused, not sanitised —
 * a renamed file is a silent surprise, and no legitimate .zip needs this.
 */
export function safePath(raw: string): string | null {
  const path = raw.replace(/^\.?\//, '')
  if (!path) return null
  if (path.length > ZIP_LIMITS.MAX_PATH_LENGTH) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\:*?"<>|]/.test(path)) return null
  if (path.startsWith('/')) return null
  const parts = path.split('/')
  if (parts.some((p) => p === '..' || p === '.')) return null
  // A drive letter or a UNC name from a Windows-made archive.
  if (/^[A-Za-z]:/.test(path)) return null
  return path
}

/** A NUL in the first few KB is the same heuristic `git` and `grep` use. */
function looksBinary(data: Uint8Array): boolean {
  const end = Math.min(data.length, 8192)
  for (let i = 0; i < end; i++) if (data[i] === 0) return true
  return false
}

export async function importZip(file: File): Promise<ZipImportResult> {
  if (file.size > ZIP_LIMITS.MAX_ARCHIVE_BYTES) {
    throw new ZipImportError(
      'too-big',
      `That .zip is ${Math.round(file.size / 1024 / 1024)} MB. Warsha can open up to ${
        ZIP_LIMITS.MAX_ARCHIVE_BYTES / 1024 / 1024
      } MB.`,
    )
  }

  let buf: Uint8Array
  try {
    buf = new Uint8Array(await file.arrayBuffer())
  } catch (error) {
    throw new ZipImportError('unreadable', String((error as Error).message ?? error))
  }

  // Counted from the central directory, before inflation; throwing here aborts the whole unzip.
  let declaredTotal = 0
  let entryCount = 0
  const oversize = new Set<string>()

  let unzipped: Record<string, Uint8Array>
  try {
    unzipped = unzipSync(buf, {
      filter: (entry) => {
        if (entry.name.endsWith('/')) return true
        if (++entryCount > ZIP_LIMITS.MAX_ENTRIES) {
          throw new ZipImportError(
            'too-many',
            `That .zip holds more than ${ZIP_LIMITS.MAX_ENTRIES} files. Warsha is for projects, not archives.`,
          )
        }
        if (entry.originalSize > ZIP_LIMITS.MAX_FILE_BYTES) {
          // One huge file does not condemn the archive; it is left out and named.
          oversize.add(entry.name)
          return false
        }
        declaredTotal += entry.originalSize
        if (declaredTotal > ZIP_LIMITS.MAX_TOTAL_BYTES) {
          throw new ZipImportError(
            'bomb',
            'That .zip unpacks to far more than it looks like. Warsha will not open it.',
          )
        }
        return true
      },
    })
  } catch (error) {
    if (error instanceof ZipImportError) throw error
    throw new ZipImportError('unreadable', String((error as Error).message ?? error))
  }

  const files: FsSnapshot['files'] = []
  const dirs = new Set<string>()
  const skipped: ZipImportResult['skipped'] = []

  for (const name of oversize) skipped.push({ path: name, reason: 'too-large' })

  for (const [rawPath, data] of Object.entries(unzipped)) {
    if (SKIP.test(rawPath)) continue

    const isDir = rawPath.endsWith('/')
    const path = safePath(isDir ? rawPath.slice(0, -1) : rawPath)
    if (path === null) {
      skipped.push({ path: rawPath, reason: 'unsafe-path' })
      continue
    }
    if (isDir) {
      dirs.add(path)
      continue
    }
    // Built-project zips carry images/.class files; decoding as UTF-8 would fill the editor
    // with replacement chars, looking like corruption instead of a skip.
    if (looksBinary(data)) {
      skipped.push({ path, reason: 'binary' })
      continue
    }
    files.push({ path, content: strFromU8(data) })
    const parts = path.split('/')
    parts.pop()
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p
      dirs.add(acc)
    }
  }

  return { snapshot: { files, dirs: [...dirs] }, skipped }
}
