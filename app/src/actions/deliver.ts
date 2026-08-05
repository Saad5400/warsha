/**
 * The last step of every "Share as …" action: hand a finished file to the OS
 * share sheet (`navigator.share` with a file — the iPad path) or, failing
 * that, trigger a download. Resolves either way; a cancelled share sheet is
 * not a failure and does not throw (`AbortError` is swallowed), so callers
 * should not toast on every rejection blindly.
 */
export async function deliverFile(file: File): Promise<'shared' | 'downloaded'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name })
      return 'shared'
    } catch (e) {
      if (isCancelled(e)) return 'shared'
      // Fall through to the download path — some browsers advertise
      // canShare() for files and then reject the actual share() call.
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
