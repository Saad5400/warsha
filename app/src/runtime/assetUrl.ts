/**
 * The absolute URL of a `public/` asset that bypasses Vite's pipeline — the
 * engine workers, the bundler wasm, the framework JSON blobs, the on-device
 * Tailwind build, the tree-sitter grammar. These are staged into `public/` by
 * `npm run assets` and loaded by URL rather than imported, so Vite never
 * rewrites them and they have to name their own location.
 *
 * WHY A LEADING SLASH. The app is served at the origin root (see
 * `vite.config.ts` `base: '/'`), and these assets sit at the root too. Building
 * the URL as `new URL('/' + name, document.baseURI)` makes the path
 * root-absolute: `document.baseURI` supplies only the scheme + host, and the
 * leading `/` discards its path segment entirely. So the result is the same —
 * `https://host/<name>` — no matter what route the app is currently showing
 * (`/`, `/en/`, `/tutorials/<slug>`, …).
 *
 * This is the whole reason deep, shareable URLs are safe: a relative
 * `new URL(name, document.baseURI)` resolves against the current path, so on
 * `/tutorials/share` it would ask for `/tutorials/warsha-jvm.worker.js` and
 * 404. That baked-at-import assumption is what the old `/en//ar/` prefix-strip
 * hack existed to paper over; a root-absolute URL removes the need for it.
 */
export const assetUrl = (name: string): string => new URL('/' + name, document.baseURI).href
