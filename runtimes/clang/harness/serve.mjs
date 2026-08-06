/* Static server for the clang-wasm M0 spike, cross-origin ISOLATED.
 *
 * The Wasmer SDK spins up worker threads and (for threaded packages) wants
 * SharedArrayBuffer, so the page must be crossOriginIsolated — the same state
 * coi-serviceworker gives the real app. We set COOP: same-origin and
 * COEP: credentialless: credentialless (not require-corp) lets the SPIKE pull
 * @wasmer/sdk and the clang package cross-origin (unpkg / Wasmer CDN) WITHOUT
 * those hosts sending CORP headers, while keeping crossOriginIsolated === true.
 * The real engine self-hosts the toolchain same-origin, so it will pass under
 * require-corp too — but M0 only needs to answer "does the toolchain work".
 *
 *   node serve.mjs [port]     default 8090, root = ./  (this dir)
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
// Root at the package dir so the engine harness can load the real worker from
// /src/clang.worker.js (the spike pages live under /harness/).
const root = join(here, '..')
const port = Number(process.argv[2] || 8090)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webc': 'application/octet-stream',
  '.css': 'text/css; charset=utf-8',
}

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/') path = '/index.html'
  const full = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''))
  let target = full
  let size
  try {
    if (statSync(full).isDirectory()) target = join(full, 'index.html')
    size = statSync(target).size
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found: ' + path)
    return
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(target)] || 'application/octet-stream',
    'content-length': String(size),
    'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'credentialless',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(target).pipe(res)
}).listen(port, () => {
  console.log(`clang spike: http://localhost:${port}/  (crossOriginIsolated, root ${root})`)
})
