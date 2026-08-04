import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

/**
 * Feeds the offline service worker its precache list at build time.
 *
 * public/coi-serviceworker.js reads `self.__WARSHA_PRECACHE__` (the hashed
 * JS/CSS this build emitted) and `self.__WARSHA_VERSION__` (a content hash that
 * names its caches, so a new deploy evicts the old ones). Those globals cannot
 * be known until the bundle exists, so rather than tokenise the vendored SW we
 * PREPEND a two-line header to the copy Vite has already placed in dist/. The
 * source file in public/ is never touched; in dev the globals are simply
 * undefined and the SW falls back to runtime caching only. Build-only.
 */
function warshaServiceWorkerPrecache(): Plugin {
  let assets: string[] = []
  return {
    name: 'warsha:sw-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle)
        .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
        .map((name) => `./${name}`)
        .sort()
    },
    closeBundle() {
      const swPath = resolve(__dirname, 'dist/coi-serviceworker.js')
      let source: string
      try {
        source = readFileSync(swPath, 'utf8')
      } catch {
        // No SW in the output (e.g. a library build) — nothing to inject.
        return
      }
      const version = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 8)
      const header =
        `self.__WARSHA_VERSION__=${JSON.stringify(version)};` +
        `self.__WARSHA_PRECACHE__=${JSON.stringify(assets)};\n`
      writeFileSync(swPath, header + source)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwind(), warshaServiceWorkerPrecache()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  // Required, not a preference (runtimes/python/INTEGRATION.md §2a). The engines
  // resolve their worker with `new Worker(new URL('./worker.js', import.meta.url),
  // { type: 'module' })`. Vite's default 'iife' wraps the emitted worker chunk and
  // rewrites import.meta.url inside it, which lands you on the classic-worker
  // failure mode: importScripts fetches no-cors, coi-serviceworker passes the
  // opaque response through, and COEP: require-corp then blocks the loader.
  worker: { format: 'es' },
  server: {
    port: 8083,
    // Two reasons, both real: docs/design/tokens.css is imported in place from
    // outside app/, and `vite dev` otherwise 403s the engines' worker.js under
    // runtimes/ — which surfaces as a misleading "worker failed to start".
    fs: { allow: ['..'] },
  },
  preview: { port: 8083 },
})
