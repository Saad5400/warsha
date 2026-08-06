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
    // Suppresses the browser's own install banner (Samsung Internet, some OEM
    // builds) — two prompts on screen is worse than one.
    e.preventDefault()
    deferred = e
    emit()
  })
  // Fires regardless of install path (our control, omnibox icon, browser
  // menu) — all must clear the control.
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

/** iOS/iPadOS in any browser install via the Share sheet (all WebKit
 *  underneath). iPadOS 13+ reports UA as "MacIntel", so touch-point count
 *  (0 on a real Mac) is what tells them apart. */
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
 * Opens the browser's install sheet. MUST run from a user gesture (Chrome
 * rejects otherwise). The event is single-use, so it's cleared before the
 * await — a double tap can't reuse it, and the control also disappears while
 * the sheet is up. Chrome re-fires a fresh event if the student dismisses it.
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
