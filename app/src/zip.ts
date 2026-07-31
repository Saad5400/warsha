import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type { FsSnapshot } from './fs/types'

const SKIP = /(^|\/)(\.DS_Store|Thumbs\.db|__MACOSX)(\/|$)/

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

export async function importZip(file: File): Promise<FsSnapshot> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const unzipped = unzipSync(buf)
  const files: FsSnapshot['files'] = []
  const dirs = new Set<string>()
  for (const [rawPath, data] of Object.entries(unzipped)) {
    if (SKIP.test(rawPath)) continue
    const path = rawPath.replace(/^\.?\//, '')
    if (!path) continue
    if (path.endsWith('/')) {
      dirs.add(path.slice(0, -1))
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
  return { files, dirs: [...dirs] }
}
