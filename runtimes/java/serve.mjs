/* Static file server for the harness, WITH HTTP RANGE SUPPORT.
 *
 * Range is not optional. CheerpJ reads ecj.jar through its /app/ mount by
 * asking for byte ranges; against a server that ignores the header it logs
 *
 *   Network error for .../ecj.jar: HTTP server does not support the 'Range'
 *   header. CheerpJ cannot run.
 *
 * and then recovers by refetching the entire jar, which makes every compile look
 * seconds slower than it is. `python3 -m http.server` and most one-line static
 * servers have exactly this bug. Real static hosts (S3, Cloudflare Pages,
 * Netlify, GitHub Pages) all support ranges, so this only matches production.
 *
 * The document root is runtimes/java/, because CheerpJ's /app/ maps to the web
 * server ROOT -- that is where ecj.jar has to be, not next to the page.
 *
 *   node serve.mjs [port]        default 8085 -> http://localhost:8085/harness/
 */

import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] || 8085)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.java': 'text/plain; charset=utf-8',
  '.jar': 'application/java-archive',
  '.wasm': 'application/wasm',
}

createServer((request, response) => {
  let path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
  if (path === '/') path = '/harness/index.html'
  const full = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''))

  let target = full
  let size
  try {
    if (statSync(full).isDirectory()) target = join(full, 'index.html')
    size = statSync(target).size
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found: ' + path)
    return
  }

  const isJar = extname(target) === '.jar'
  const headers = {
    'content-type': TYPES[extname(target)] || 'application/octet-stream',
    'accept-ranges': 'bytes',
    // The jar is cacheable in production (a hashed, immutable static asset), so
    // caching it here keeps the harness's warm timings honest. Everything else
    // is no-store, so an edit plus reload is always the file on disk.
    'cache-control': isJar ? 'public, max-age=3600' : 'no-store',
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec((request.headers.range || '').trim())
  if (!range) {
    response.writeHead(200, { ...headers, 'content-length': String(size) })
    if (request.method === 'HEAD') return response.end()
    createReadStream(target).pipe(response)
    return
  }

  const [, startText, endText] = range
  let start
  let end
  if (startText === '') {
    // Suffix range: bytes=-500 means the last 500 bytes.
    const length = Math.min(Number(endText || 0), size)
    start = size - length
    end = size - 1
  } else {
    start = Number(startText)
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    response.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': '0' })
    response.end()
    return
  }

  response.writeHead(206, {
    ...headers,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': String(end - start + 1),
  })
  if (request.method === 'HEAD') return response.end()
  createReadStream(target, { start, end }).pipe(response)
}).listen(port, () => {
  console.log(`harness: http://localhost:${port}/harness/  (HTTP Range supported)`)
})
