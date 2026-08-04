/* Static server for the C# spike harness, cross-origin ISOLATED by default.
 *
 * The .NET wasm runtime does not itself need SharedArrayBuffer for the M0 spike,
 * but the real app runs under coi-serviceworker's COOP/COEP (Python needs it),
 * so we reproduce that here: same-origin _framework assets pass require-corp
 * without extra headers, which is the whole point of self-hosting the bundle.
 *
 *   node serve.mjs [port]     default 8087, root = ./publish/wwwroot, COOP/COEP on
 */
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, 'publish', 'wwwroot')
const port = Number(process.argv[2] || 8087)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.dll': 'application/octet-stream',
  '.dat': 'application/octet-stream',
  '.blat': 'application/octet-stream',
  '.pdb': 'application/octet-stream',
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
    'cross-origin-embedder-policy': 'require-corp',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(target).pipe(res)
}).listen(port, () => {
  console.log(`C# spike: http://localhost:${port}/  (cross-origin isolated, root ${root})`)
})
