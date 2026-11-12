/**
 * What a tab can show for a file: the code editor, or a read-only view.
 *
 * A project holds text, but a file that is not text can still be in one — a
 * .zip from elsewhere, a program that wrote one, a student who named a file
 * photo.png. CodeMirror must never be handed it: an empty "line 1" read as
 * broken, and bytes decoded as text are not something to edit. This decides,
 * from the ending first and then the content, and builds an image source when
 * the text really is one (an SVG, or a data: URL).
 */
import { extOf } from './components/FileBadge'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const BINARY = new Set([
  'pdf', 'zip', 'gz', 'tar', '7z', 'rar', 'jar', 'class', 'exe', 'dll', 'so', 'o', 'wasm',
  'mp3', 'wav', 'ogg', 'mp4', 'mov', 'webm', 'woff', 'woff2', 'ttf', 'otf', 'docx', 'xlsx', 'pptx',
])

export type FileView = 'text' | 'image' | 'binary'

/** By ending alone (the status bar has no content to look at). */
export function fileViewByName(path: string): FileView {
  const ext = extOf(path)
  return IMAGE.has(ext) ? 'image' : BINARY.has(ext) ? 'binary' : 'text'
}

/** By ending, then content: a NUL in the first 8 KB is git's and grep's own test. */
export function fileViewOf(path: string, content: string): FileView {
  const byName = fileViewByName(path)
  if (byName !== 'text') return byName
  return content.slice(0, 8192).includes('\u0000') ? 'binary' : 'text'
}

/** A safe `<img>` source when the text is an image, else null. An <img> never runs
 *  an SVG's scripts, so an SVG's own markup is fine to show this way. */
export function imageSourceOf(path: string, content: string): string | null {
  const text = content.trim()
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml|bmp|x-icon|avif)[;,]/i.test(text)) return text
  if (extOf(path) === 'svg' && /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)
  }
  return null
}

/** "312 B", "4.1 KB", "2.3 MB" — Western digits in both languages, like the rest of the UI. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
