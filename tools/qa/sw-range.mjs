/* Regression guard for the offline service worker vs. CheerpJ's HTTP Range reads.
 *
 * WHY THIS EXISTS
 * The offline caching layer in app/public/coi-serviceworker.js is cache-first for
 * same-origin GETs, and /app/ecj.jar (the ECJ compiler jar CheerpJ runs Java
 * through) is same-origin. CheerpJ reads that jar in MANY HTTP Range requests and
 * requires `206 Partial Content` + `Content-Range` on every one; if it ever sees a
 * `200` with the whole body it decides the host has no Range support and refuses to
 * run — which the student sees as "Warsha could not start Java" and a bootstrap
 * compile failure. The Cache API cannot satisfy a range (`caches.match()` ignores the
 * Range header and replays the full stored `200`), so a SINGLE full-body ecj.jar in
 * the cache — e.g. CheerpJ's own whole-jar refetch after one flaky range, see
 * runtimes/java/INTEGRATION.md — poisons every subsequent range read for the life of
 * that cache. That is exactly the production failure this guards against.
 *
 * The fix: range requests bypass the cache entirely (network only, never stored).
 * This suite POISONS the cache with a full-body ecj.jar on purpose, then proves both
 * halves: (1) a range request through the SW still comes back 206 + Content-Range,
 * and (2) real CheerpJ Java boots and runs to a clean exit despite the poison.
 *
 * Serve a built dist first (the SW needs its injected precache manifest):
 *   cd app && npm run build && npx vite preview --port 8086 --strictPort --host
 *   cd tools/qa && node sw-range.mjs
 */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

const results = []
const pass = (name, detail = '') => { results.push(true); console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`) }
const fail = (name, detail = '') => { results.push(false); console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-swrange-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

// -------------------------------------------------------------- 1. boot, SW controls
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
  .then(() => pass('cross-origin isolation achieved'))
  .catch(() => fail('cross-origin isolation achieved', 'still false after 45s'))

const sw = await page.evaluate(() => navigator.serviceWorker?.controller?.scriptURL ?? null)
if (sw && sw.includes('coi-serviceworker')) pass('the caching service worker is controlling', sw)
else fail('the caching service worker is controlling', String(sw))

// ----------------------------------------------------- 2. poison the cache on purpose
// A full-body GET of ecj.jar. On the OLD SW this lands a `200` in warsha-shell-*, which
// is the exact poison a whole-jar refetch causes in production.
const poisoned = await page.evaluate(async () => {
  const res = await fetch('/ecj.jar')
  const len = (await res.arrayBuffer()).byteLength
  let cached = null
  for (const n of await caches.keys()) {
    const c = await caches.open(n)
    const hit = await c.match('/ecj.jar')
    if (hit) cached = { cache: n, status: hit.status, cr: hit.headers.get('content-range') }
  }
  return { status: res.status, len, cached }
})
info(`full GET /ecj.jar -> ${poisoned.status}, ${poisoned.len} bytes; cache entry: ${JSON.stringify(poisoned.cached)}`)
// We WANT the poison present — a full-body 200 sitting in a warsha cache. If it is not
// even cacheable the test is not exercising the hazard, so treat that as a failure.
if (poisoned.cached && poisoned.cached.status === 200 && !poisoned.cached.cr)
  pass('poison staged: a full-body ecj.jar is sitting in the cache', poisoned.cached.cache)
else fail('poison staged: a full-body ecj.jar is sitting in the cache', JSON.stringify(poisoned.cached))

// ----------------------------------------------- 3. THE invariant: range survives poison
// A range request through the SW must still be answered by the range-supporting server
// (206 + Content-Range), NOT from the poisoned full-body cache entry. This is the whole
// fix in one assertion; on the unfixed SW it comes back 200 with no Content-Range.
const rng = await page.evaluate(async () => {
  const res = await fetch('/ecj.jar', { headers: { Range: 'bytes=100-199' } })
  const body = await res.arrayBuffer()
  return { status: res.status, cr: res.headers.get('content-range'), len: body.byteLength }
})
info(`range GET bytes=100-199 -> status ${rng.status}, content-range ${JSON.stringify(rng.cr)}, ${rng.len} bytes`)
if (rng.status === 206 && rng.cr && rng.len === 100)
  pass('range request bypasses the poisoned cache (206 + Content-Range from the server)')
else fail('range request bypasses the poisoned cache', `status ${rng.status}, cr ${rng.cr}, len ${rng.len} — the SW served a full-body response for a Range request, which breaks CheerpJ`)

// ------------------------------------------ 4. end-to-end: CheerpJ boots despite the poison
await seedStarter(page, { lang: 'Java', name: 'Java basics' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
// A no-input program so a clean exit ("Finished. (exit code 0)") is the success signal;
// the shipped Java starters block on Scanner and would never finish unattended.
await page.locator('.cm-content').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('public class Main { public static void main(String[] a) { System.out.println("WARSHA_RANGE_OK"); } }')
await page.waitForTimeout(700)
await page.getByRole('button', { name: /^Run\b/ }).click()

const out = await page
  .waitForFunction(
    () => {
      const t = document.querySelector('[aria-label="Program output"]')?.innerText || ''
      return /Finished\.|could not start|failed to compile/i.test(t) ? t : false
    },
    null,
    { timeout: 150000 },
  )
  .then((h) => h.jsonValue())
  .catch(() => '(timeout — no completion or failure string appeared)')

info(`--- java output ---\n${String(out).slice(0, 400)}`)
if (String(out).includes('WARSHA_RANGE_OK') && String(out).includes('Finished. (exit code 0)'))
  pass('real CheerpJ Java booted and ran to a clean exit despite the poisoned cache')
else fail('real CheerpJ Java booted and ran to a clean exit despite the poisoned cache', String(out).slice(-200))

await ctx.close()

const passed = results.filter(Boolean).length
console.log(`\n==== ${passed}/${results.length} checks passed ====`)
process.exit(passed === results.length ? 0 : 1)
