import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type { FsSnapshot } from './fs/types'

const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX)(\/|$)/

/**
 * Import limits.
 *
 * Every one of these exists because the unguarded version has a way to take the
 * tab down, and a student who has just been handed a .zip by a teacher has no
 * idea which kind they have. `unzipSync` runs on the main thread and allocates
 * everything at once, so "reject with a sentence" and "freeze, then crash" are
 * the only two options — there is no partial success to fall back to.
 *
 *  - `MAX_ARCHIVE_BYTES` is checked on the `File` before a single byte is read,
 *    because `file.arrayBuffer()` on a multi-gigabyte file is itself the crash.
 *  - `MAX_TOTAL_BYTES` is checked against the central directory's declared
 *    sizes *during* the filter callback, before anything is inflated. This is
 *    the zip-bomb guard: 42.zip is 42 kB and declares 4.5 PB, and it is
 *    rejected here having allocated nothing.
 *  - `MAX_ENTRIES` bounds the explorer and the tab strip as much as memory.
 *
 * The numbers are generous for the real thing — a Warsha project is a few
 * kilobytes of text — and small enough that hitting one means something is
 * wrong with the file rather than with the student.
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
  /**
   * Entries that were left out and why, so the dialog can say "3 files were
   * skipped" instead of silently importing something different from what the
   * student handed over. Silent partial imports are how a project arrives
   * missing the one file the exercise needed.
   */
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
 * A path from a .zip, made safe or refused.
 *
 * Zip entries are attacker-controlled strings, not paths: `../../etc/passwd`
 * and `C:\evil` are both legal entry names. OPFS would not let us out of the
 * origin, but a `..` segment still lands the file somewhere the student did not
 * ask for and cannot see, and a `\` produces a file whose name contains a
 * separator the explorer will render as one level and the store as another.
 * Refuse rather than sanitise: a renamed file is a silent surprise, and there is
 * no legitimate .zip that needs this.
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

  // Counted inside the filter, i.e. from the central directory, before anything
  // is inflated. Throwing from the filter aborts the whole unzip.
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
    // A .zip of a built project carries images and .class files. Decoding them
    // as UTF-8 produces a wall of replacement characters in the editor, which
    // looks to a student like their file was corrupted rather than skipped.
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
