/* Restart / H1 stress test — kills the flaky race in the collab restart flow.
 *
 * Repeats the exact scenario collab-e2e's H1 guards, N times in a row, ALL of
 * which must pass:
 *   Start collaboration → type PRE → Stop → Start again (REUSES the room id) →
 *   type POST → a FRESH guest joining after the restart must see POST.
 *
 * The prod failure was a race the localhost happy-path usually won, so this
 * induces ~150ms of network latency on the HOST via CDP
 * (Network.emulateNetworkConditions). That delays the blob-store-gated "initial
 * sync settled" reconcile until AFTER the host has typed POST — the exact
 * ordering under which the stale-snapshot reconcile used to clobber POST — so a
 * green run here is real, not a localhost artifact.
 *
 * Usage:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node restart-stress.mjs [runs]
 */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const RUNS = Number(process.argv[2] ?? 8)
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 150)

const createdRooms = []
const newContext = async (tag) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-stress-${tag}-`)), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  return ctx
}
/** Add ~LATENCY_MS of round-trip latency to every request this page makes. */
const throttle = async (ctx, page) => {
  try {
    const client = await ctx.newCDPSession(page)
    await client.send('Network.enable')
    await client.send('Network.emulateNetworkConditions', {
      offline: false, latency: LATENCY_MS, downloadThroughput: -1, uploadThroughput: -1,
    })
  } catch { /* latency emulation is best-effort */ }
}
const seesText = (page, needle, t = 25000) =>
  page.waitForFunction((n) => (document.querySelector('.cm-content')?.textContent ?? '').includes(n), needle, { timeout: t })
    .then(() => true).catch(() => false)
const inEditor = (page, t = 45000) => page.waitForSelector('.cm-content', { timeout: t }).then(() => true).catch(() => false)
const typeAtTop = async (page, text) => {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}
const seed = async (page, { lang, name }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).first().click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + lang) }).click()
  await page.locator('.template-card').filter({ hasText: name }).first().click()
}

let passes = 0
const fails = []

for (let i = 1; i <= RUNS; i++) {
  const PRE = `RESTART_PRE_${i}_${Date.now()}`
  const POST = `RESTART_POST_${i}_${Date.now()}`
  const ctxRH = await newContext(`h${i}`)
  const ctxRG = await newContext(`g${i}`)
  let ok = false
  let detail = ''
  try {
    const RH = ctxRH.pages()[0] ?? (await ctxRH.newPage())
    await throttle(ctxRH, RH)
    await RH.goto(BASE)
    await RH.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
    await seed(RH, { lang: 'Python', name: 'Python basics' })
    await RH.waitForSelector('.cm-content', { timeout: 30000 })
    await seesText(RH, 'first Python program', 30000)

    const startCollab = async () => {
      await RH.getByRole('menuitem', { name: 'File', exact: true }).click()
      await RH.getByRole('menuitem', { name: 'Start collaboration' }).click()
      await RH.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
      return RH.evaluate(() => location.href)
    }
    const url1 = await startCollab()
    createdRooms.push(url1)
    await typeAtTop(RH, `# ${PRE}\n`)
    await RH.waitForTimeout(1500)
    // Stop.
    await RH.getByRole('menuitem', { name: 'File', exact: true }).click()
    await RH.getByRole('menuitem', { name: 'Stop collaboration' }).click()
    await RH.waitForFunction(() => !location.hash.startsWith('#room='), null, { timeout: 8000 }).catch(() => {})
    await RH.waitForTimeout(500)
    // Start again — reuses the same room id.
    const url2 = await startCollab()
    const reused = url2.split('#room=')[1] === url1.split('#room=')[1]
    // Post-restart edit typed BEFORE the (latency-delayed) settle — the crux.
    await typeAtTop(RH, `# ${POST}\n`)
    await RH.waitForTimeout(2500)
    const live = (await RH.getByText('Live', { exact: true }).count()) > 0

    const RG = ctxRG.pages()[0] ?? (await ctxRG.newPage())
    await throttle(ctxRG, RG)
    await RG.goto(url2)
    const reached = await inEditor(RG, 45000)
    const sawPost = reached && (await seesText(RG, POST, 25000))
    ok = reused && live && reached && sawPost
    if (!ok) detail = `reused=${reused} live=${live} reached=${reached} sawPost=${sawPost}`
  } catch (e) {
    detail = 'threw: ' + e.message
  } finally {
    await ctxRH.close().catch(() => {})
    await ctxRG.close().catch(() => {})
  }
  if (ok) { passes++; console.log(`PASS  run ${i}/${RUNS}`) }
  else { fails.push(i); console.log(`FAIL  run ${i}/${RUNS}  ${detail}`) }
}

// Best-effort cleanup so repeated stress runs don't exhaust the dev device quota.
try {
  const { readFileSync } = await import('node:fs')
  const env = (() => { try { return readFileSync(new URL('../../app/.env.local', import.meta.url), 'utf8') } catch { return '' } })()
  const api = process.env.WARSHA_API ?? env.match(/VITE_WARSHA_API=(.*)/)?.[1]?.trim()
  const token = process.env.WARSHA_TOKEN ?? env.match(/VITE_WARSHA_TOKEN=(.*)/)?.[1]?.trim()
  if (api && token) {
    for (const url of createdRooms) {
      const id = url.split('#room=')[1]
      if (!id) continue
      await fetch(`${api.replace(/\/+$/, '')}/v1/docs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
    }
  }
} catch { /* cleanup is best-effort */ }

console.log(`\n== restart/H1 stress: ${passes}/${RUNS} passed (latency ${LATENCY_MS}ms) ==`)
process.exit(passes === RUNS ? 0 : 1)
