/**
 * The last step of every "Share as …" action.
 *
 * Where the file goes forks on what kind of device this is, because the OS
 * share dialog is only trustworthy where it is a real share sheet:
 *
 * - Handheld (no hover, or a coarse pointer — the iPad/phone path): the OS
 *   share sheet via `navigator.share`. That is the surface students expect
 *   there, and the only good route into WhatsApp/AirDrop.
 * - Desktop: NEVER the share dialog, even though Windows Chrome/Edge
 *   advertises `canShare()` for files. The Windows share dialog's own "Copy"
 *   button silently fails to put a shared file on the clipboard (observed on
 *   Windows 11, 2026-08), which reads as Warsha's bug and strands the export.
 *   Instead a PNG goes straight onto the clipboard ourselves — `image/png` is
 *   one of the three formats the async clipboard API is REQUIRED to support
 *   (with plain text and HTML; Baseline 2024) — and anything else becomes a
 *   plain download. A PDF is always a download on desktop: the clipboard has
 *   no PDF representation that other applications accept.
 *
 * Every path falls through toward download, so the action always ends with
 * the file somewhere real, and the return value says where for the caller's
 * toast. A cancelled share sheet is not a failure and does not throw
 * (`AbortError` is swallowed), so callers should not toast on every rejection
 * blindly.
 */
export type Delivered = 'shared' | 'copied' | 'downloaded'

/** True on devices whose OS share sheet is the right delivery surface. A
 *  Windows touchscreen laptop still reports hover+fine for its primary
 *  pointer, so it stays on the desktop path. */
export function prefersShareSheet(): boolean {
  return matchMedia('(hover: none), (pointer: coarse)').matches
}

export async function deliverFile(file: File): Promise<Delivered> {
  if (prefersShareSheet() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if (isCancelled(e)) return 'shared'
      // Fall through — some browsers advertise canShare() for files, then
      // reject the actual share() call.
    }
  }

  if (file.type === 'image/png' && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      // Promise form: Safari's user-gesture accounting requires it, Chromium
      // accepts either. A rejection here just falls through to download.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(file) })])
      return 'copied'
    } catch {
      /* download instead */
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
  return 'downloaded'
}

export function isCancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
