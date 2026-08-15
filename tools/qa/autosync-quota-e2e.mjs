/* Phase-C "accounts-as-cloud" auto-sync — the QUOTA path + the 403-split guard
 * (COLLAB-SYNC-CONTRACT §7.3 + the Phase-C plan).
 *
 * ⚠ BACKEND REQUIREMENT: run this against a backend with a LOW per-account doc quota,
 * `QUOTA_ACCOUNT_DOCS` (default assumed 2 here; override with the env of the same name
 * to match the server). A signed-in account with N+1 local projects must:
 *
 *   1. Backfill up to the limit, then STOP: exactly `LIMIT` projects get mapped, the
 *      over-limit project stays local-only (unmapped), and the "cloud storage is full"
 *      toast is shown ONCE (not once per remaining project).
 *   2. REGRESSION GUARD for the api.ts/blobSync 403 split: a genuine PERMISSION 403 —
 *      a link=none guest denied a private room — must show the quiet read-only / denied
 *      state, NEVER the out-of-space notice. Quota-403 and permission-403 are two
 *      different failures behind the same status code; conflating them is the bug this
 *      guards.
 *
 * Run:
 *   QUOTA_ACCOUNT_DOCS=2 WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> \
 *     node autosync-quota-e2e.mjs
 */
import { chromium } from 'playwright-core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const LIMIT = Number(process.env.QUOTA_ACCOUNT_DOCS || 2)

const results = []
const pass = (n, d = '') => { results.push(true); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(false); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const errors = []

const env = (() => { try { return readFileSync(new URL('../../app/.env.local', import.meta.url), 'utf8') } catch { return '' } })()
const API = (process.env.WARSHA_API ?? env.match(/VITE_WARSHA_API=(.*)/)?.[1]?.trim() ?? '').replace(/\/+$/, '')
const DEV_TOKEN = process.env.WARSHA_TOKEN ?? env.match(/VITE_WARSHA_TOKEN=(.*)/)?.[1]?.trim()

const newContext = async (tag) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-quota-${tag}-`)), {
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
const typeAtTop = async (page, text) => {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}
const readPrefs = (page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem('warsha.prefs.v1') || '{}') } catch { return {} } })
const mappingCount = async (page) => Object.keys((await readPrefs(page)).projectRooms || {}).length
/** Count visible toasts whose text mentions cloud storage being full (the §7.3 notice). */
const outOfSpaceToasts = (page) =>
  page.locator('text=/cloud storage is full/i').count().catch(() => 0)

const openPicker = async (page) => {
  const homeNew = page.getByRole('button', { name: 'New project', exact: true }).first()
  if (!(await homeNew.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Home', exact: true }).click().catch(() => {})
    await page.getByText('All projects').first().waitFor({ timeout: 10000 }).catch(() => {})
  }
  await page.getByRole('button', { name: 'New project', exact: true }).first().click()
}
const createLocalProject = async (page, { lang, name }) => {
  await openPicker(page)
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + lang) }).click()
  await page.locator('.template-card').filter({ hasText: name }).first().click()
  const prompt = page.locator('dialog[open]')
  if (await prompt.locator('input').first().isVisible({ timeout: 1500 }).catch(() => false)) {
    await prompt.getByRole('button', { name: 'Create' }).click().catch(() => {})
  }
  await page.waitForSelector('.cm-content', { timeout: 30000 })
}
const signUp = async (page) => {
  const email = `qa_${Date.now()}_${Math.floor(Math.random() * 1e6)}@warsha.test`
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Sign in…' }).click()
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
const createdRooms = []
let sessionToken = null
try {
  // ================= 1) quota stops backfill at the limit, toast ONCE =================
  const ctx = await newContext('main'); contexts.push(ctx)
  const P = wire(ctx.pages()[0] ?? (await ctx.newPage()), 'main')
  await P.goto(BASE)
  await P.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })

  // One MORE project than the account can hold.
  const total = LIMIT + 1
  for (let i = 0; i < total; i++) await createLocalProject(P, { lang: 'Python', name: 'Python basics' })

  await signUp(P)
  // Backfill seeds up to LIMIT, then aborts on the quota 403. Wait until the mapping
  // count reaches LIMIT and then holds (the over-limit seed must NOT map).
  await P.waitForFunction((n) => {
    try { const p = JSON.parse(localStorage.getItem('warsha.prefs.v1') || '{}'); return Object.keys(p.projectRooms || {}).length >= n }
    catch { return false }
  }, LIMIT, { timeout: 60000 }).catch(() => {})
  await P.waitForTimeout(3000) // give the (aborted) over-limit attempt time to have run

  const mapped = await mappingCount(P)
  sessionToken = (await readPrefs(P)).sessionToken || null
  mapped === LIMIT
    ? pass(`quota: backfill stopped at the limit — exactly ${LIMIT} projects mapped`, `${mapped}/${total}`)
    : fail('quota: mapping count is not the quota limit', `${mapped} mapped, limit ${LIMIT}, total ${total}`)

  const toasts = await outOfSpaceToasts(P)
  toasts === 1
    ? pass('quota: the "cloud storage is full" toast is shown exactly once')
    : fail('quota: out-of-space toast count is not 1', String(toasts))

  // The over-limit project must remain local-only (its id has no room mapping).
  total - mapped === 1
    ? pass('quota: the over-limit project stays local-only (unmapped)')
    : fail('quota: wrong number of unmapped projects', String(total - mapped))

  // ================= 2) regression guard: permission-403 != out-of-space =================
  // A link=none guest is DENIED a private room (a permission 403). The split in
  // api.ts/blobSync.ts must keep this the quiet read-only/denied state — it must NEVER
  // surface the out-of-space notice (that is only for a quota 403, §7.3).
  const ctxOwner = await newContext('owner'); contexts.push(ctxOwner)
  const O = wire(ctxOwner.pages()[0] ?? (await ctxOwner.newPage()), 'owner')
  await O.goto(BASE)
  await O.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
  await createLocalProject(O, { lang: 'Python', name: 'Python basics' })
  await seesText(O, 'first Python program', 30000)
  await signUp(O) // owner account, so an anonymous guest is a genuine link-peer
  await O.getByRole('menuitem', { name: 'File', exact: true }).click()
  await O.getByRole('menuitem', { name: 'Start collaboration' }).click()
  await O.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
  const roomUrl = await O.evaluate(() => location.href)
  createdRooms.push(roomUrl)
  await typeAtTop(O, `# QUOTA_GUARD_SEED\n`)
  await O.waitForTimeout(1500)
  await setLinkAccess(O, 'Link off') // private: a fresh context is denied

  const ctxGuest = await newContext('denied'); contexts.push(ctxGuest)
  const G = wire(ctxGuest.pages()[0] ?? (await ctxGuest.newPage()), 'denied')
  await G.goto(roomUrl)
  await inEditor(G, 30000) // it may land in an EMPTY editor; it must NOT get the content
  const gotContent = await seesText(G, 'first Python program', 8000)
  !gotContent
    ? pass('guard: the link=none guest is denied the private room (quiet read-only)')
    : fail('guard: a denied guest still received the private content')
  // The critical assertion: a permission-403 must NOT masquerade as out-of-space.
  const guestToasts = await outOfSpaceToasts(G)
  guestToasts === 0
    ? pass('guard: a permission-403 shows NO out-of-space notice (403-split intact)')
    : fail('guard: a denied guest wrongly saw the out-of-space notice', String(guestToasts))
} catch (e) {
  fail('harness threw', e.stack || e.message)
} finally {
  if (errors.length) {
    console.log('\n--- page errors/console.error ---')
    for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e)
  }
  for (const ctx of contexts) await ctx.close().catch(() => {})
  try {
    // Account-owned docs: the session token removes them. Room docs from part 2 may be
    // device-owned; the dev token is the fallback for those.
    if (API && sessionToken) {
      const res = await fetch(`${API}/v1/docs`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      const body = await res.json().catch(() => ({}))
      for (const d of body.docs || []) {
        await fetch(`${API}/v1/docs/${d.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sessionToken}` } }).catch(() => {})
      }
    }
    if (API && DEV_TOKEN) {
      for (const url of createdRooms) {
        const id = url.split('#room=')[1]
        if (id) await fetch(`${API}/v1/docs/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${DEV_TOKEN}` } }).catch(() => {})
      }
    }
  } catch { /* cleanup is best-effort */ }
}

const passed = results.filter(Boolean).length
console.log(`\n== ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
