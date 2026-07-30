/* Static file server for the harness. Deliberately sends NO COOP/COEP headers:
 * cross-origin isolation must come from coi-serviceworker alone, which is what
 * proves the module works on a plain static host (GitHub Pages, S3, ...).
 *
 *   node serve.mjs [port]        default 8084 -> http://localhost:8084/harness/
 */

import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2] || 8084)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
}

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path === '/') path = '/harness/index.html'
  const full = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''))
  let target = full
  try {
    if (statSync(full).isDirectory()) target = join(full, 'index.html')
    statSync(target)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found: ' + path)
    return
  }
  // no-store so an edit + reload is always the file on disk
  res.writeHead(200, {
    'content-type': TYPES[extname(target)] || 'application/octet-stream',
    'cache-control': 'no-store',
  })
  createReadStream(target).pipe(res)
}).listen(port, () => {
  console.log(`harness: http://localhost:${port}/harness/  (no COOP/COEP headers sent)`)
})
