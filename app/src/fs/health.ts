/**
 * Storage health: why a write failed, and whether the browser is likely to
 * throw the student's work away.
 *
 * Two facts drive this file, both from the spikes:
 *
 *  - **iOS evicts.** Safari deletes OPFS/IndexedDB for sites that are not
 *    installed to the home screen after ~7 days of no use. `navigator.storage.
 *    persist()` is the only lever we have, and Safari grants it only for
 *    installed sites — so we ask, record the answer, and never pretend.
 *  - **A failed write must be loud.** `Project` used to `await store.writeFile()`
 *    with no catch inside a `setTimeout`, so a full disk produced an unhandled
 *    rejection in the devtools console and absolutely nothing on screen. A
 *    student would keep typing into a file that had stopped being saved.
 */

/** What went wrong, in the only three flavours the UI treats differently. */
export type StorageFault = 'quota' | 'unavailable' | 'unknown'

export interface StorageProblem {
  fault: StorageFault
  /** The path that could not be written, when the failure was about one file. */
  path?: string
  /** Raw message, for the QA suites and the console note — never the banner. */
  detail: string
}

/** DOMException `name` is the reliable signal; message text differs by browser. */
export function classifyStorageError(error: unknown): StorageFault {
  const name = (error as { name?: string } | null)?.name ?? ''
  const message = String((error as { message?: string } | null)?.message ?? error ?? '')
  if (name === 'QuotaExceededError' || /quota/i.test(message)) return 'quota'
  if (
    name === 'NotAllowedError' ||
    name === 'SecurityError' ||
    name === 'InvalidStateError' ||
    name === 'NotFoundError' ||
    /storage|not supported|undefined is not an object/i.test(message)
  ) {
    return 'unavailable'
  }
  return 'unknown'
}

export function toStorageProblem(error: unknown, path?: string): StorageProblem {
  return {
    fault: classifyStorageError(error),
    ...(path ? { path } : {}),
    detail: String((error as { message?: string } | null)?.message ?? error ?? 'unknown'),
  }
}

/**
 * Best-effort: Chrome grants silently, Safari only for installed PWAs; `false`
 * is expected, not an error. Never throws.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    const storage = navigator.storage
    if (!storage) return false
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true
    if (typeof storage.persist !== 'function') return false
    return await storage.persist()
  } catch {
    return false
  }
}

export interface QuotaReading {
  usage: number
  quota: number
  /** 0…1. Not available everywhere; -1 means "the browser would not say". */
  ratio: number
}

/** The point at which a student is close enough to the wall to be told. */
export const QUOTA_WARN_RATIO = 0.9

export async function readQuota(): Promise<QuotaReading | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate) return null
    const usage = estimate.usage ?? 0
    const quota = estimate.quota ?? 0
    return { usage, quota, ratio: quota > 0 ? usage / quota : -1 }
  } catch {
    return null
  }
}
