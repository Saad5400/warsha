/* Proves Warsha is a real offline PWA: after one online visit the app shell
 * boots with no network, and a runtime a student has already used keeps working
 * offline instead of re-downloading.
 *
 * This is the suite that exercises the caching layer added to
 * app/public/coi-serviceworker.js. It MUST run against a SERVED BUILD, not the
 * dev server: the precache manifest (self.__WARSHA_PRECACHE__) is injected by
 * the vite plugin at build time, so `vite dev` has no shell to fall back to.
 *
 *   cd app && npm run build && npx vite preview --port 8086 --strictPort --host
 *   cd tools/qa && node offline-check.mjs
 *
 * What it guarantees: the shell (HTML/JS/CSS) and Python (Pyodide, from
 * jsdelivr) both survive going offline. Java/CheerpJ offline is a KNOWN
 * LIMITATION, not asserted here: CheerpJ loads via a no-cors `importScripts()`
 * (an opaque response the SW refuses to cache, to avoid quota-padding OPFS out
 * of existence) and lazily fetches runtime pieces a first run never touches, so
 * it cannot be relied on with no network. Its bulk assets still cache (they are
 * persisted, just not offline-complete).
 *
 * Overridable:
 *   WARSHA_URL   base URL of a served BUILD   (default http://127.0.0.1:8086/)
 *   CHROME       Chrome binary                (default /usr/bin/google-chrome)
 */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

const results = []
const pass = (name, detail = '') => { results.push(['PASS', name, detail]); console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`) }
const fail = (name, detail = '') => { results.push(['FAIL', name, detail]); console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`) }
const warn = (name, detail = '') => console.log(`WARN  ${name}${detail ? ' :: ' + detail : ''}`)
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-offline-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

const outputText = () => page.locator('[aria-label="Program output"]').innerText()

/* Replace the editor's whole content with `code`, then wait out the 350ms OPFS
 * debounce (same trick verify.mjs uses) so a reload can't race the write. */
async function setEditor(code) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(code)
  await page.waitForTimeout(600)
}

async function run() {
  await page.getByRole('button', { name: 'Run', exact: true }).click()
}

// ---------------------------------------------------------------- 1. online boot
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
  .then(() => pass('online: cross-origin isolation achieved'))
  .catch(() => fail('online: cross-origin isolation achieved', 'still false after 45s'))

const sw = await page.evaluate(() => navigator.serviceWorker?.controller?.scriptURL ?? null)
if (sw && sw.includes('coi-serviceworker')) pass('the caching service worker is controlling', sw)
else fail('the caching service worker is controlling', String(sw))

// ---------------------------------------------------- 2. use Python once, online
await seedStarter(page, { name: 'Python basics' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
await setEditor('print("cached while online")')
await run()
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('cached while online'),
  null,
  { timeout: 180000 },
)
const online = await outputText()
if (online.includes('cached while online') && online.includes('Finished. (exit code 0)'))
  pass('online: real Pyodide booted and ran')
else fail('online: real Pyodide booted and ran', online.slice(-160))

// ------------------------------------------------- 3. the downloads got cached
const caches_ = await page.evaluate(async () => {
  const names = await caches.keys()
  let pyodide = 0
  let sameOrigin = 0
  for (const n of names) {
    const c = await caches.open(n)
    for (const req of await c.keys()) {
      if (req.url.includes('jsdelivr.net/pyodide')) pyodide++
      else sameOrigin++
    }
  }
  return { names, pyodide, sameOrigin }
})
info(`cache names: ${JSON.stringify(caches_.names)}`)
info(`cached entries: ${caches_.pyodide} pyodide, ${caches_.sameOrigin} same-origin`)
if (caches_.names.some((n) => n.startsWith('warsha-shell-')) && caches_.sameOrigin > 0)
  pass('app shell cached in Cache Storage', `${caches_.sameOrigin} same-origin entries`)
else fail('app shell cached in Cache Storage', JSON.stringify(caches_.names))
if (caches_.pyodide > 0) pass('Pyodide runtime cached in Cache Storage', `${caches_.pyodide} entries`)
else fail('Pyodide runtime cached in Cache Storage', 'no jsdelivr/pyodide entries found')

// ------------------------------------------------------------- 4. go offline
await ctx.setOffline(true)
info('network is now OFFLINE')

let navigations = 0
page.on('framenavigated', (f) => { if (f === page.mainFrame() && f.url().startsWith(BASE)) navigations++ })
await page.reload({ waitUntil: 'load' })

// The app booted offline only if the shell chrome and the editor came back.
await page.locator('.top-bar').first().waitFor({ timeout: 20000 })
  .then(() => pass('offline: app shell booted (top bar rendered)'))
  .catch(() => fail('offline: app shell booted (top bar rendered)', 'no .top-bar after offline reload'))
await page.waitForSelector('.cm-content', { timeout: 20000 })
  .then(() => pass('offline: editor restored from OPFS'))
  .catch(() => fail('offline: editor restored from OPFS', 'no .cm-content after offline reload'))

const offlineIsolated = await page.evaluate(() => self.crossOriginIsolated === true)
if (offlineIsolated) pass('offline: cross-origin isolation held (SW re-served the headers)')
else fail('offline: cross-origin isolation held', 'crossOriginIsolated is false offline')

// -------------------------------------------------- 5. Python still runs offline
await setEditor('print("offline works")')
await run()
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('offline works'),
  null,
  { timeout: 90000 },
).catch(() => {})
const off = await outputText()
if (off.includes('offline works') && off.includes('Finished. (exit code 0)'))
  pass('offline: Python ran from the cached runtime')
else fail('offline: Python ran from the cached runtime', off.slice(-200))

// ------------------------------------------------------- Java (best-effort, warn)
// Java is not driven here: it was never downloaded in this session, so there is
// nothing cached to run offline, and CheerpJ's offline story depends on whether
// its CDN assets are CORS/CORP-cacheable (see the header of this file). Left as a
// manual check so a flaky third-party CDN can never fail this suite.
warn('Java offline not exercised by this suite', 'verify by hand: run Java online, go offline, run again')

// ---------------------------------------------------------------- console errors
const notable = consoleErrors.filter((e) => !/favicon/i.test(e) && !/Failed to fetch|net::ERR_INTERNET_DISCONNECTED/i.test(e))
if (notable.length === 0) pass('no unexpected console errors')
else { fail('no unexpected console errors', `${notable.length}`); for (const e of notable.slice(0, 8)) info(`  ! ${e}`) }

// ------------------------------------------------------------------------ summary
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
for (const f of failed) console.log(`FAILED: ${f[1]} :: ${f[2]}`)

await ctx.close()
process.exit(failed.length ? 1 : 0)
