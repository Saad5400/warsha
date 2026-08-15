/* Phase-C "accounts-as-cloud" auto-sync — CROSS-DEVICE open + durable round-trip
 * (COLLAB-SYNC-CONTRACT §7 + the Phase-C plan). This proves the headless durable
 * path carries a project between two devices with NO live session:
 *
 *   A) Profile A signs up, creates + edits a project (a typed MARK), and the open
 *      project's HeadlessSync pushes it to S3.
 *   B) Profile B (a FRESH browser context) signs in as the SAME account on Home,
 *      sees the project as a CLOUD-ONLY card, opens it, and the files materialize
 *      verbatim (materializeCloudDoc: getDoc -> applyUpdate -> snapshot).
 *   C) B edits (a second MARK); A reloads, reopens, and sees B's edit — a durable
 *      merge over CAS, round-tripped through the blob store, no websocket involved.
 *
 * Assertions are TYPED-MARK (`text.includes(MARK)`), never a raw textContent diff:
 * a remote peer's cursor/name label can stream into .cm-content and would be a false
 * positive. Here there is no live peer at all, but the discipline stays.
 *
 * Needs the app served with VITE_WARSHA_API set and the backend up. Run:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node autosync-crossdevice-e2e.mjs
 */
import { chromium } from 'playwright-core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const PASSWORD = 'collab-pass-123'

const results = []
const pass = (n, d = '') => { results.push(true); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(false); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const errors = []

const env = (() => { try { return readFileSync(new URL('../../app/.env.local', import.meta.url), 'utf8') } catch { return '' } })()
const API = (process.env.WARSHA_API ?? env.match(/VITE_WARSHA_API=(.*)/)?.[1]?.trim() ?? '').replace(/\/+$/, '')

const newContext = async (tag) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-xdev-${tag}-`)), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  return ctx
}
const wire = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`) })
  return page
}
const inEditor = (page, t = 45000) =>
  page.waitForSelector('.cm-content', { timeout: t }).then(() => true).catch(() => false)
const seesText = (page, needle, t = 25000) =>
  page.waitForFunction((n) => (document.querySelector('.cm-content')?.textContent ?? '').includes(n), needle, { timeout: t })
    .then(() => true).catch(() => false)
const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
const typeAtTop = async (page, text) => {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}
const readPrefs = (page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem('warsha.prefs.v1') || '{}') } catch { return {} } })

/** Seed one project from a starter (fresh device -> no name prompt). */
const seed = async (page, { lang, name }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).first().click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + lang) }).click()
  await page.locator('.template-card').filter({ hasText: name }).first().click()
  await page.waitForSelector('.cm-content', { timeout: 30000 })
}
/** Sign up via the in-editor gear. Returns the email. */
const signUp = async (page) => {
  const email = `qa_${Date.now()}_${Math.floor(Math.random() * 1e6)}@warsha.test`
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign in…' }).click()
  const dlg = page.locator('dialog[open]')
  await dlg.waitFor({ timeout: 10000 })
  await dlg.getByRole('button', { name: 'New here? Create an account' }).click()
  await dlg.locator('input[type="email"]').fill(email)
  await dlg.locator('input[type="password"]').fill(PASSWORD)
  await dlg.getByRole('button', { name: 'Create account' }).click()
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  return email
}
/** Sign in from HOME's header account button (the Chunk-2 affordance). */
const signInOnHome = async (page, email) => {
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click()
  const dlg = page.locator('dialog[open]')
  await dlg.waitFor({ timeout: 10000 })
  await dlg.locator('input[type="email"]').fill(email)
  await dlg.locator('input[type="password"]').fill(PASSWORD)
  await dlg.getByRole('button', { name: 'Sign in', exact: true }).click()
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
}

const contexts = []
let sessionToken = null
const MARK_A = 'CROSSDEV_A_SEED'
const MARK_B = 'CROSSDEV_B_EDIT'
try {
  // ================= A) sign up, create + edit, push durably =================
  const ctxA = await newContext('a'); contexts.push(ctxA)
  const A = wire(ctxA.pages()[0] ?? (await ctxA.newPage()), 'A')
  await A.goto(BASE)
  await A.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
  await seed(A, { lang: 'Python', name: 'Python basics' })
  await seesText(A, 'first Python program', 30000)
  const email = await signUp(A)
  // The open project's HeadlessSync carries this edit into the durable doc (debounced),
  // then CASes it to S3. Type the mark and give the push a generous window.
  await typeAtTop(A, `# ${MARK_A}\n`)
  await A.waitForTimeout(3500)
  const prefsA = await readPrefs(A)
  sessionToken = prefsA.sessionToken || null
  Object.keys(prefsA.projectRooms || {}).length >= 1
    ? pass('A: project mapped to a durable cloud doc after sign-in')
    : fail('A: project never mapped to a cloud doc')

  // ================= B) fresh device, same account: cloud-only open =================
  const ctxB = await newContext('b'); contexts.push(ctxB)
  const B = wire(ctxB.pages()[0] ?? (await ctxB.newPage()), 'B')
  // Record websockets — the cross-device open is durable-only, no live relay.
  const syncSockets = []
  B.on('websocket', (ws) => { if (ws.url().includes('/v1/sync')) syncSockets.push(ws.url()) })
  await B.goto(BASE)
  await B.getByRole('button', { name: 'Sign in', exact: true }).first().waitFor({ timeout: 60000 })
  await signInOnHome(B, email)

  // Home fetches listDocs on sign-in; A's project has no local mapping on B, so it must
  // appear as a cloud-only card ("In your account"). Wait for that glyph/label.
  const sawCloudCard = await B.getByText('In your account', { exact: true }).first()
    .waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
  sawCloudCard
    ? pass('B: the cross-device project shows as a cloud-only card on Home')
    : fail('B: no cloud-only card appeared after signing in as the same account')

  // Open the cloud-only card -> materializeCloudDoc builds a fresh local project.
  await B.getByRole('button', { name: /^Open — / }).first().click().catch(async () => {
    // Fallback: click the card body (the full-bleed open button carries the aria-label).
    await B.getByText('In your account', { exact: true }).first().click().catch(() => {})
  })
  if (await inEditor(B, 45000)) {
    ;(await seesText(B, MARK_A, 25000))
      ? pass('B: opened the cloud-only project and A’s files materialized verbatim')
      : fail('B: the cloud-only project did not materialize A’s content')

    // ================= C) B edits, A reloads, A sees B's edit (durable merge) ========
    await typeAtTop(B, `# ${MARK_B}\n`)
    await B.waitForTimeout(3500) // let B's HeadlessSync CAS the merge to S3

    await A.reload()
    // Cold start lands on Home; reopen the project to reach the editor + its engine.
    await A.getByText('Continue where you left off').first().waitFor({ timeout: 60000 }).catch(() => {})
    await A.locator('button', { hasText: 'Continue where you left off' }).first().click().catch(() => {})
    if (await inEditor(A, 45000)) {
      // A's engine GETs the doc on attach (fresh:false) and merges B's update in.
      const merged = await seesText(A, MARK_B, 30000)
      // TYPED-MARK check, never a textContent diff.
      merged && (await editorText(A)).includes(MARK_B)
        ? pass('C: A reloaded and sees B’s edit — durable cross-device merge over CAS')
        : fail('C: B’s edit never round-tripped back to A')
    } else {
      fail('C: A never re-entered the editor after reload')
    }
  } else {
    fail('B: never reached the editor after opening the cloud-only card')
  }

  await B.waitForTimeout(500)
  syncSockets.length === 0
    ? pass('cross-device open used ZERO /v1/sync websockets (durable-only)')
    : fail('cross-device open opened a live-sync socket', syncSockets.join(', '))
} catch (e) {
  fail('harness threw', e.stack || e.message)
} finally {
  if (errors.length) {
    console.log('\n--- page errors/console.error ---')
    for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e)
  }
  for (const ctx of contexts) await ctx.close().catch(() => {})
  try {
    if (API && sessionToken) {
      const res = await fetch(`${API}/v1/docs`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      const body = await res.json().catch(() => ({}))
      for (const d of body.docs || []) {
        await fetch(`${API}/v1/docs/${d.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` } }).catch(() => {})
      }
    }
  } catch { /* cleanup is best-effort */ }
}

const passed = results.filter(Boolean).length
console.log(`\n== ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
