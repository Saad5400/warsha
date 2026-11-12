/**
 * Recovering a page that outlived its deploy.
 *
 * A tab can be older than the server it talks to: left open across a deploy, or
 * booted from a cached document. Its bundle then asks for things the new build
 * no longer has — a hashed chunk the deploy deleted, a worker whose protocol
 * moved on — and the student sees Warsha's own error ("Warsha could not start
 * Java", a dead Run). Nothing they can do fixes it except a reload, and nothing
 * tells them so. This is the one seam that notices and does that reload for
 * them.
 *
 * It is deliberately narrow: it only acts AFTER something already failed, and
 * only when the server provably serves a different build than this page booted
 * — so an ordinary failure (no network, a CDN outage, a real engine bug) still
 * reaches the student as the honest error it is, and a reload never interrupts
 * a page that was working.
 *
 * Every caller goes through `reloadIfStale()`: the run path (useRunner, when an
 * engine fails to start), Vite's failed-chunk event, and the crash screen.
 */

/** The page's build fingerprint: the hashed entry script its document boots.
 *  Its name changes whenever any bundled code does (Vite hashes it), and both
 *  this page and the deployed index.html carry it, so comparing the two needs
 *  no version plumbing at build time. */
const ENTRY_RE = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/

function bootedEntry(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return el ? new URL(el.src, location.href).pathname : null
}

/** The entry the server would hand a fresh visit right now, or null when that
 *  cannot be learned (offline, a non-200) — which reads as "not stale". */
async function deployedEntry(): Promise<string | null> {
  try {
    // Straight to the server: `no-store` keeps the HTTP cache out of it, and the
    // service worker never caches a page fetched as data (only navigations, in
    // its per-build shell). Offline this throws, and offline we cannot know.
    const res = await fetch('/', { cache: 'no-store' })
    if (!res.ok) return null
    const src = ENTRY_RE.exec(await res.text())?.[1]
    return src ? new URL(src, location.href).pathname : null
  } catch {
    return null
  }
}

/**
 * The loop guard. Every build this tab has auto-reloaded onto, with when, in
 * sessionStorage (it survives the reload; it dies with the tab). A build already
 * in the set is never reloaded onto again within GUARD_WINDOW_MS — not only the
 * last one: during a rollout two builds can be served at once (old and new
 * containers behind the proxy), and a guard that remembered one entry would let
 * the tab ping-pong A → B → A for as long as the overlap lasts. Past the window
 * a build may be tried again, so a tab left open for days still heals on a
 * later deploy of the same build name.
 */
const GUARD_KEY = 'warsha.staleReload'
const GUARD_WINDOW_MS = 10 * 60_000

function tried(): Record<string, number> {
  const raw = JSON.parse(sessionStorage.getItem(GUARD_KEY) ?? '{}') as unknown
  const now = Date.now()
  const out: Record<string, number> = {}
  if (raw && typeof raw === 'object') {
    for (const [build, at] of Object.entries(raw)) {
      if (typeof at === 'number' && now - at < GUARD_WINDOW_MS) out[build] = at
    }
  }
  return out
}

/** Flushes whatever the student has not saved yet; registered by the app shell
 *  (App), which owns the project and the live session. One hook for every
 *  caller — the run path, a failed chunk, the crash screen — so no caller can
 *  forget it. */
let saveBeforeReload: (() => Promise<unknown>) | null = null
export function setStaleBuildSaver(save: (() => Promise<unknown>) | null): void {
  saveBeforeReload = save
}

let checking: Promise<boolean> | null = null

/**
 * If the server now serves a different build than this page booted, reload
 * onto it and resolve true (the caller should then show nothing — the page is
 * going away). Otherwise resolve false and let the caller report the failure.
 * Concurrent failures share one check, so a burst of failed chunks is one
 * request and at most one reload.
 */
export function reloadIfStale(): Promise<boolean> {
  checking ??= (async () => {
    const mine = bootedEntry()
    const deployed = await deployedEntry()
    if (!mine || !deployed || mine === deployed) return false
    try {
      const seen = tried()
      if (deployed in seen) return false
      seen[deployed] = Date.now()
      sessionStorage.setItem(GUARD_KEY, JSON.stringify(seen))
    } catch {
      // No sessionStorage (a locked-down browser) means no loop guard, so no
      // automatic reload either: the error the caller shows still says to reload.
      return false
    }
    // Pending edits first: a reload the student did not ask for must not cost
    // them the keystrokes still inside the save debounce.
    await saveBeforeReload?.().catch(() => {})
    location.reload()
    return true
  })().finally(() => {
    checking = null
  })
  return checking
}

/**
 * Hand Vite's failed-chunk event to `reloadIfStale`. Vite fires
 * `vite:preloadError` when a dynamic import's chunk cannot be fetched — the
 * signature failure of a stale page, whose chunks the deploy deleted (and the
 * service worker, pruning the old build's /assets/, no longer holds). Call
 * once, at startup.
 */
export function watchForStaleBuild(): void {
  window.addEventListener('vite:preloadError', () => {
    void reloadIfStale()
  })
}
