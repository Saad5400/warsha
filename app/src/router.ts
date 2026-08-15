/**
 * The URL ↔ screen router — small, hand-rolled, no dependency.
 *
 * Warsha is one page with a few screens (Home, the editor, the tutorials
 * library). Until now which screen showed was pure React state, so nothing was
 * addressable: you could not link a friend to a lesson, reload back into the
 * project you had open, or use the back button. This module makes the pathname
 * the source of truth for the screen, in the same `useSyncExternalStore` shape
 * as i18n/locale.ts (a module value + a listener set), so a component reads the
 * route with `useRoute()` and the propagation is one root subscription.
 *
 * ROUTES (each also valid under an `/en/` or `/ar/` locale prefix):
 *
 *   /                         home            the projects hub
 *   /p/<projectId>            editor          the workspace, that project open
 *   /tutorials/               tutorials       the lesson index
 *   /tutorials/<slug>/        lesson          one lesson
 *
 * The editor's id is device-local (projects live in OPFS), so /p/<id> is
 * bookmarkable and reload-stable on this device — it is NOT a cross-device
 * share. Sharing a whole project is still the `#share=` / `#room=` hash, which
 * this router deliberately leaves alone: those handlers (in App.tsx) touch only
 * `location.hash`, never the pathname, so the two systems never collide. The
 * one place they could is the back button crossing a hash-only history entry,
 * which fires `popstate` as well as `hashchange`; the guard below no-ops when
 * only the hash moved so the router never fights the share/room handlers.
 *
 * The locale prefix stays in the path (see i18n/locale.ts) — this router only
 * needs to know which prefix is present so `navigate` can preserve it, keeping
 * in-app navigation in the same language. The one exception is the language
 * toggle, which passes an explicit `locale` to rewrite the prefix.
 */
import { useSyncExternalStore } from 'react'
import { tutorialById } from './tutorials'
import type { Locale } from './i18n/locale'

export type Route =
  | { name: 'home' }
  | { name: 'editor'; projectId: string }
  | { name: 'tutorials' }
  | { name: 'lesson'; slug: string }

type Prefix = Locale | null

interface Parsed {
  prefix: Prefix
  route: Route
}

/** Peel an optional `en|ar` prefix, then match the remaining segments. An
 *  unknown lesson slug degrades to the index; any other unmatched path is home
 *  (a soft 404 — a dead link lands somewhere real rather than a blank screen). */
function parseLocation(): Parsed {
  let segs: string[]
  try {
    segs = location.pathname.split('/').filter(Boolean)
  } catch {
    return { prefix: null, route: { name: 'home' } }
  }
  let prefix: Prefix = null
  if (segs[0] === 'en' || segs[0] === 'ar') {
    prefix = segs[0]
    segs = segs.slice(1)
  }
  return { prefix, route: matchRoute(segs) }
}

function matchRoute(segs: string[]): Route {
  if (segs.length === 0) return { name: 'home' }
  if (segs[0] === 'tutorials') {
    const slug = segs[1]
    if (slug && tutorialById(slug)) return { name: 'lesson', slug }
    return { name: 'tutorials' }
  }
  if (segs[0] === 'p' && segs[1]) return { name: 'editor', projectId: segs[1] }
  return { name: 'home' }
}

/** The path a route lives at, under the given prefix. Trailing slashes on the
 *  crawlable tutorial URLs match the prerendered directories and their
 *  canonicals (see vite.config.ts); the editor id does not get one. */
export function routePath(route: Route, prefix: Prefix): string {
  const p = prefix ? `/${prefix}` : ''
  switch (route.name) {
    case 'home':
      return p ? `${p}/` : '/'
    case 'editor':
      return `${p}/p/${route.projectId}`
    case 'tutorials':
      return `${p}/tutorials/`
    case 'lesson':
      return `${p}/tutorials/${route.slug}/`
  }
}

let current = parseLocation()
let currentPath = safePathname()
const listeners = new Set<() => void>()

function safePathname(): string {
  try {
    return location.pathname
  } catch {
    return '/'
  }
}

function emit() {
  for (const fn of listeners) fn()
}

/**
 * Go to a route. Preserves the current locale prefix (so navigation stays
 * in-language) unless `locale` overrides it — the language toggle passes the new
 * locale to rewrite the prefix. `location.search` (e.g. `?lang=`) and
 * `location.hash` both ride along: the router is deliberately hash-agnostic, so a
 * `#room=` payload survives (a reload rejoins the room) and a `#share=` one is
 * cleared by its own subsystem (clearShareHash) once import lands, not here.
 */
export function navigate(route: Route, opts: { replace?: boolean; locale?: Locale } = {}) {
  const prefix: Prefix = opts.locale ?? current.prefix
  const url = routePath(route, prefix) + location.search + location.hash
  try {
    if (opts.replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
  } catch {
    // A blocked History API must not wedge navigation; fall through and still
    // update the in-memory route so the screen changes.
  }
  current = { prefix, route }
  currentPath = safePathname()
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    // Only the hash moved (a share/room history entry) → not ours; the pathname
    // route is unchanged and App's hashchange handler owns it. Guarding on the
    // pathname string is what keeps the two navigation systems from fighting.
    if (safePathname() === currentPath) return
    current = parseLocation()
    currentPath = safePathname()
    emit()
  })
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** The active route, outside React (a plain module value, kept current by
 *  `navigate` and `popstate`). */
export const currentRoute = (): Route => current.route

/** The locale prefix present in the current URL, or null at the unprefixed
 *  x-default root. */
export const currentPrefix = (): Prefix => current.prefix

/** Re-render on navigation. Mounted once at the App root, like `useLocale`. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, currentRoute, currentRoute)
}
