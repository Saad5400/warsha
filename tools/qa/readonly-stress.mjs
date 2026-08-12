/* Latency-stress reproduction for the guest read-only race (COLLAB-SYNC-CONTRACT
 * §7.4, H1). Models the `viewer` + `H1: guest wrote before role-resolve` blocks of
 * collab-accounts-e2e.mjs, but injects real network latency on the guest page via
 * CDP `Network.emulateNetworkConditions`. That latency is what reproduces the
 * PRODUCTION failure a plain localhost run never sees: it widens the window between
 * a guest's collab file opening and read-only actually engaging (probeRole is a
 * round-trip; blob/webrtc settle is delayed), so a keystroke typed the instant the
 * file materialises can land LOCALLY before the read-only facet is applied.
 *
 * The owner is set up ONCE (sign up, host, link=Viewer). Then a fresh unresolved
 * guest joins under latency and types IMMEDIATELY on open — repeated RUNS times.
 * Every run must show localChanged===false AND reachedHost===false: the editor must
 * never accept a local keystroke for a guest whose role isn't confirmed editor, and
 * (the security property) nothing may ever reach the host.
 *
 * Needs the app served with VITE_WARSHA_API set and the backend up. Run:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node readonly-stress.mjs
 *   RUNS=10 LATENCY_MS=180 ... node readonly-stress.mjs
 */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const RUNS = Number(process.env.RUNS ?? 8)
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 180)

const errors = []
const wire = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`) })
  return page
}
const seesText = (page, needle, t = 20000) =>
  page.waitForFunction((n) => (document.querySelector('.cm-content')?.textContent ?? '').includes(n), needle, { timeout: t })
    .then(() => true).catch(() => false)
const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
const inEditor = (page, t = 45000) =>
  page.waitForSelector('.cm-content', { timeout: t }).then(() => true).catch(() => false)
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
const openAccount = async (page, rowName) => {
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page.getByRole('menuitem', { name: rowName }).click()
}
const signUp = async (page) => {
  const email = `qa_${Date.now()}_${Math.floor(Math.random() * 1e6)}@warsha.test`
  await openAccount(page, 'Sign in…')
  const dlg = page.locator('dialog[open]')
  await dlg.waitFor({ timeout: 10000 })
  await dlg.getByRole('button', { name: 'New here? Create an account' }).click()
  await dlg.locator('input[type="email"]').fill(email)
  await dlg.locator('input[type="password"]').fill('collab-pass-123')
  await dlg.getByRole('button', { name: 'Create account' }).click()
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  return email
}
const setLinkAccess = async (page, optionText) => {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Share room…' }).click()
  const dlg = page.locator('dialog[open]')
  await dlg.waitFor({ timeout: 10000 })
  await dlg.getByRole('radio').filter({ hasText: optionText }).click()
  await page.waitForTimeout(1200)
  await dlg.getByRole('button', { name: 'Done' }).click()
  await dlg.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
}

const contexts = []
let passed = 0
let failed = 0
const note = (ok, msg) => { if (ok) { passed++; console.log(`  PASS  ${msg}`) } else { failed++; console.log(`  FAIL  ${msg}`) } }

try {
  // ---- Owner: sign in, host the room, share as Viewer (set up once) ----
  const ctxOwner = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-stress-owner-')), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
  })
  contexts.push(ctxOwner)
  await ctxOwner.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  const O = wire(ctxOwner.pages()[0] ?? (await ctxOwner.newPage()), 'owner')
  await O.goto(BASE)
  await O.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
  await seed(O, { lang: 'Python', name: 'Python basics' })
  await O.waitForSelector('.cm-content', { timeout: 30000 })
  await seesText(O, 'first Python program', 30000)
  await signUp(O)
  await O.getByRole('menuitem', { name: 'File', exact: true }).click()
  await O.getByRole('menuitem', { name: 'Start collaboration' }).click()
  await O.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
  const roomUrl = await O.evaluate(() => location.href)
  if (!/#room=[0-9A-HJKMNP-TV-Z]{26}$/.test(roomUrl)) throw new Error('owner never started a room: ' + roomUrl)
  await typeAtTop(O, `# OWNER_SEED_1\n`)
  await O.waitForTimeout(1500)
  await setLinkAccess(O, 'can view')
  console.log(`owner ready, room ${roomUrl.split('#')[1]}; latency=${LATENCY_MS}ms; runs=${RUNS}\n`)

  // ---- Repeated unresolved-guest joins under latency, typing IMMEDIATELY on open ----
  for (let i = 1; i <= RUNS; i++) {
    const MARK = `STRESS_GUEST_${i}_${Date.now()}`
    // Fresh context each run: empty prefs => this device is NOT an owner of the room
    // (owner=false), so the guest starts fail-closed read-only until probeRole. SW
    // blocked so page-level latency reliably hits the /v1 API + blob calls (the SW
    // otherwise proxies them out of the emulated network's reach).
    const ctxGuest = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-stress-guest-${i}-`)), {
      executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
      serviceWorkers: 'block',
    })
    await ctxGuest.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
    const G = wire(ctxGuest.pages()[0] ?? (await ctxGuest.newPage()), `guest-${i}`)
    // Inject latency on every request the guest page makes: probeRole (the role
    // round-trip), the blob GET/PUT, and the signaling websocket all pay it, so the
    // window between the file materialising and read-only engaging is wide — exactly
    // the production condition.
    const cdp = await ctxGuest.newCDPSession(G)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: LATENCY_MS, downloadThroughput: -1, uploadThroughput: -1,
    })

    await G.goto(roomUrl)
    let localChanged = null
    let reachedHost = null
    if (await inEditor(G, 45000)) {
      // The guest's "Shared session" project is created EMPTY; the editor renders
      // real content only once the shared file materialises bound to its Y.Text.
      const materialised = await seesText(G, 'first Python program', 30000)
      if (!materialised) {
        note(false, `run ${i}: shared file never materialised`)
      } else {
        // Type the INSTANT content is on screen — WITHOUT waiting for the "View only"
        // badge (that badge is the role probe landing, the very thing we must not
        // depend on). A correct fail-closed guest is read-only from the first paint.
        await typeAtTop(G, `# ${MARK}\n`)
        await G.waitForTimeout(1500)
        const after = await editorText(G)
        // `localChanged` = did the guest's OWN keystroke land in the editor? Measured
        // by the typed mark's presence, NOT a byte-diff of `.cm-content`: under latency
        // a remote peer's yCollab cursor/name label streams into the content DOM during
        // the type window, so textContent legitimately changes with no local edit. The
        // mark landing is the true tell that a read-only editor wrongly accepted input.
        localChanged = after.includes(MARK)
        reachedHost = await seesText(O, MARK, 4000)
        // Belt-and-braces: the editor must be non-editable (contenteditable=false) too.
        const editable = await G.evaluate(() => document.querySelector('.cm-content')?.getAttribute('contenteditable'))
        note(
          localChanged === false && reachedHost === false && editable === 'false',
          `run ${i}: localChanged=${localChanged} reachedHost=${reachedHost} editable=${editable}`,
        )
      }
    } else {
      note(false, `run ${i}: never reached the editor`)
    }
    await cdp.detach().catch(() => {})
    await ctxGuest.close().catch(() => {})
  }
} catch (e) {
  console.error('stress harness error:', e && e.stack ? e.stack : e)
  failed++
} finally {
  for (const c of contexts) await c.close().catch(() => {})
}

console.log(`\nread-only latency stress: ${passed}/${passed + failed} passed (latency=${LATENCY_MS}ms)`)
if (errors.length) {
  console.log(`\n(${errors.length} console/page errors captured — first few:)`)
  for (const e of errors.slice(0, 8)) console.log('  ' + e)
}
process.exit(failed === 0 ? 0 : 1)
