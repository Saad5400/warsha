/* Phase-C "accounts-as-cloud" auto-sync — the BACKFILL invariant, end to end
 * (COLLAB-SYNC-CONTRACT §7 + the Phase-C plan). Sibling to collab-accounts-e2e.mjs;
 * that one covers accounts + sharing, this one covers what auto-sync-all adds:
 *
 *   1. Signed out, create 3 local projects — nothing is mapped to the cloud.
 *   2. Sign in -> the backfill seeds all 3 into fresh durable docs: prefs.projectRooms
 *      grows to 3 mappings, and GET /v1/docs lists 3 blobs owned by the account.
 *   3. THE VPS-LIGHT INVARIANT: backing 3 projects up opens ZERO /v1/sync websockets.
 *      Durable backup rides HeadlessSync (S3 PUT/GET over CAS), never the live relay —
 *      so a signed-in user with many projects costs the VPS nothing until they actually
 *      collaborate. A single stray background socket here is a regression.
 *
 * Needs the app served with VITE_WARSHA_API set and the backend up. Run:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node autosync-backfill-e2e.mjs
 */
import { chromium } from 'playwright-core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

const results = []
const pass = (n, d = '') => { results.push(true); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(false); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const errors = []

const env = (() => { try { return readFileSync(new URL('../../app/.env.local', import.meta.url), 'utf8') } catch { return '' } })()
const API = (process.env.WARSHA_API ?? env.match(/VITE_WARSHA_API=(.*)/)?.[1]?.trim() ?? '').replace(/\/+$/, '')

const newContext = async (tag) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-backfill-${tag}-`)), {
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
const readPrefs = (page) =>
  page.evaluate(() => { try { return JSON.parse(localStorage.getItem('warsha.prefs.v1') || '{}') } catch { return {} } })
/** Wait until prefs.projectRooms has at least `n` mappings (backfill lands them one by one). */
const waitForMappings = (page, n, t = 60000) =>
  page.waitForFunction((n) => {
    try { const p = JSON.parse(localStorage.getItem('warsha.prefs.v1') || '{}'); return Object.keys(p.projectRooms || {}).length >= n }
    catch { return false }
  }, n, { timeout: t }).then(() => true).catch(() => false)

/** Open the New-project template picker whether we're on Home or in the editor. */
const openPicker = async (page) => {
  const homeNew = page.getByRole('button', { name: 'New project', exact: true }).first()
  if (!(await homeNew.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Home', exact: true }).click().catch(() => {})
    await page.getByText('All projects').first().waitFor({ timeout: 10000 }).catch(() => {})
  }
  await page.getByRole('button', { name: 'New project', exact: true }).first().click()
}
/** Create ONE local project from a starter. Accepts the name prompt that appears when
 *  another project is already open (the non-destructive New-project path). */
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
/** Sign up through the in-editor gear (Manage) -> account row. Returns the email. */
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

const contexts = []
let sessionToken = null
try {
  const ctx = await newContext('main'); contexts.push(ctx)
  const P = wire(ctx.pages()[0] ?? (await ctx.newPage()), 'main')

  // Record EVERY websocket the page opens; the invariant is that none touch /v1/sync
  // during a background backfill (no live collaboration is ever started here).
  const syncSockets = []
  P.on('websocket', (ws) => { if (ws.url().includes('/v1/sync')) syncSockets.push(ws.url()) })

  await P.goto(BASE)
  await P.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })

  // ---- 1) Signed out: create 3 local projects, none mapped ----
  await createLocalProject(P, { lang: 'Python', name: 'Python basics' })
  await createLocalProject(P, { lang: 'Python', name: 'Python basics' })
  await createLocalProject(P, { lang: 'Python', name: 'Python basics' })
  const before = await readPrefs(P)
  const mappedBefore = Object.keys(before.projectRooms || {}).length
  mappedBefore === 0
    ? pass('signed out: 3 local projects created, none mapped to the cloud')
    : fail('signed out: projects were mapped before any sign-in', String(mappedBefore))

  // ---- 2) Sign in -> backfill seeds all 3 ----
  await signUp(P)
  const seeded = await waitForMappings(P, 3, 60000)
  const after = await readPrefs(P)
  const mappedAfter = Object.keys(after.projectRooms || {}).length
  sessionToken = after.sessionToken || null
  seeded && mappedAfter >= 3
    ? pass('sign in: backfill mapped all 3 projects (prefs.projectRooms has 3)', String(mappedAfter))
    : fail('sign in: backfill did not map 3 projects', String(mappedAfter))

  // The durable blobs must actually exist server-side — GET /v1/docs as the account.
  if (API && sessionToken) {
    let listed = 0
    try {
      const res = await fetch(`${API}/v1/docs`, { headers: { Authorization: `Bearer ${sessionToken}` } })
      const body = await res.json().catch(() => ({}))
      listed = Array.isArray(body.docs) ? body.docs.length : 0
    } catch (e) { errors.push('listDocs fetch: ' + e.message) }
    listed >= 3
      ? pass('sign in: GET /v1/docs lists the 3 durable blobs', String(listed))
      : fail('sign in: fewer than 3 durable docs on the server', String(listed))
  } else {
    fail('sign in: could not verify /v1/docs (missing API base or session token)')
  }

  // Give any (buggy) background socket a moment to have appeared, then assert none did.
  await P.waitForTimeout(2000)

  // ---- 3) THE VPS-LIGHT INVARIANT: no /v1/sync socket for background backfill ----
  syncSockets.length === 0
    ? pass('backfill opened ZERO /v1/sync websockets (durable-only, VPS-light)')
    : fail('backfill opened a live-sync socket for a background project', syncSockets.join(', '))
} catch (e) {
  fail('harness threw', e.stack || e.message)
} finally {
  if (errors.length) {
    console.log('\n--- page errors/console.error ---')
    for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e)
  }
  for (const ctx of contexts) await ctx.close().catch(() => {})
  // Best-effort: delete the account's docs this run created (account-owned, so the
  // session token — not the dev token — is what can remove them).
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
