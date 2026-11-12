/**
 * Stamps every file in a built dist/ with an mtime derived from its CONTENT.
 *
 * Why: nginx's ETag and Last-Modified are the file's mtime (+ size). A Docker
 * build writes every file fresh, so each deploy gave every file a new ETag —
 * unchanged bytes included — and any conditional request a browser or the
 * service worker made after a deploy came back 200 with the whole file instead
 * of 304. Derived from the bytes, the mtime (and so the ETag) changes exactly
 * when the file does. The service worker no longer depends on this (it checks
 * content hashes from the build's manifest, see public/coi-serviceworker.js);
 * this is the second layer, for every client and every request that does reach
 * the server.
 *
 * The date is a stable point between 2000 and 2020: never in the future, and
 * meaningless on purpose — it identifies content, not a moment.
 *
 * Usage: node tools/stable-mtimes.mjs [dist]   (run by /Dockerfile after the build)
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'

const EPOCH_2000 = 946684800
const SPAN = 20 * 365 * 86400

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))

const root = process.argv[2] ?? 'dist'
let n = 0
for (const file of walk(root)) {
  const h = Number.parseInt(createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8), 16)
  const t = EPOCH_2000 + (h % SPAN)
  utimesSync(file, t, t)
  n++
}
console.log(`stable-mtimes: ${n} files in ${root} stamped from their content`)
