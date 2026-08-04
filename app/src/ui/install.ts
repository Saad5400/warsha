/**
 * "Install Warsha" — the home-screen install affordance, and its one source of
 * truth.
 *
 * Why this file exists at all: a complete manifest makes a site *installable*,
 * not *prompted*. Chrome dropped the automatic mini-infobar in M76 and dropped
 * the service-worker requirement in M108/M112, so today the manifest alone gets
 * Warsha an install entry buried in the ⋮ menu and nothing else. The only way a
 * visible prompt ever appears is for the page to catch `beforeinstallprompt`,
 * hold it, and call `prompt()` from a real user gesture. That is what this does.
 *
 * Three states, because the platforms genuinely differ:
 *   'prompt' — we are holding a live event. Show a control; tapping it opens the
 *              browser's own install sheet.
 *   'manual' — iOS/iPadOS. WebKit never fires `beforeinstallprompt` and never
 *              will, so no control can work there; Share → Add to Home Screen is
 *              the only path and all we can do is say so.
 *   'none'   — already installed, running installed, or a browser that does not
 *              offer installation. Show nothing rather than a dead button.
 *
 * The listener is registered at MODULE scope, not in an effect. The event fires
 * once, early, and unprompted — miss it and there is no second chance for the
 * rest of the page's life. Module scope also survives StrictMode's double-mount,
 * which an effect-registered listener does not.
 */

/** Not in lib.dom: Chromium-only, and still not in any published spec. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent
  }
}

export type InstallState = 'none' | 'prompt' | 'manual'

let deferred: BeforeInstallPromptEvent | null = null
let installed = false

const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppresses whatever automatic UI the browser would have shown on its own.
    // On current Chrome there is none, but Samsung Internet and some OEM builds
    // still surface a banner, and two install invitations on one screen — ours
    // and the browser's — is worse than either alone.
    e.preventDefault()
    deferred = e
    emit()
  })
  // Fires however the student installed: our control, the omnibox icon, or the
  // browser menu. All three must take the control off the screen.
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

/** Already launched from the home screen — there is nothing left to install. */
function runningInstalled(): boolean {
  if (typeof window === 'undefined') return false
  // `navigator.standalone` is the iOS-only original; display-mode covers
  // everything else. Neither alone is enough.
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios || window.matchMedia?.('(display-mode: standalone)').matches === true
}

/**
 * iOS or iPadOS, in any browser — they are all WebKit underneath, and all of
 * them install through the Share sheet.
 *
 * iPadOS 13+ reports itself as "MacIntel" to be treated as a desktop, so the
 * touch-point count is what separates an iPad from a Mac (a Mac reports 0).
 */
function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

export function subscribeInstall(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function installState(): InstallState {
  if (installed || runningInstalled()) return 'none'
  if (deferred) return 'prompt'
  return isIos() ? 'manual' : 'none'
}

/**
 * Opens the browser's install sheet. MUST be called from a user gesture —
 * Chrome rejects a `prompt()` that is not.
 *
 * The event is single-use: a second `prompt()` on the same one throws. It is
 * therefore dropped before the await, not after, so a double tap cannot reach a
 * spent event — and the control disappears at the same moment, which is also
 * what we want while the browser's own sheet is up. Chrome re-fires a fresh
 * event later if the student dismisses the sheet, and the control comes back
 * with it.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  deferred = null
  emit()
  await event.prompt()
  const { outcome } = await event.userChoice
  return outcome
}
