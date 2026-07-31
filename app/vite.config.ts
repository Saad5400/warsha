import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwind()],
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
