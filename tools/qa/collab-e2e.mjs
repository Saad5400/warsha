/* Live collaboration, end to end in the running app (COLLAB-SYNC-CONTRACT §5).
 *
 * What the join flow must do — the bug this guards against was a guest opening a
 * #room= link landing on the Projects Home and never joining:
 *   1. Host: File > Start collaboration writes #room=<ULID> and shows "Live".
 *   2. A guest opening that link lands IN the editor (never stranded on Home).
 *   3. Same-browser second tab: live two-way sync over BroadcastChannel + presence.
 *   4. A fresh profile (a real remote device) opening the link cold joins the room
 *      and materialises the shared files from the blob store (backend GET on join).
 *
 * Needs the app served with VITE_WARSHA_API set (so BlobSync is live) and the
 * backend + its Postgres/MinIO up. Run:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node collab-e2e.mjs
 */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

const results = []
const pass = (n, d = '') => { results.push(true); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(false); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const errors = []

const newContext = async (tag) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-collab-${tag}-`)), {
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
/** Wait until the editor's text contains `needle`. Returns true/false, never throws. */
const seesText = (page, needle, t = 20000) =>
  page.waitForFunction((n) => (document.querySelector('.cm-content')?.textContent ?? '').includes(n), needle, { timeout: t })
    .then(() => true).catch(() => false)
const inEditor = (page, t = 40000) =>
  page.waitForSelector('.cm-content', { timeout: t }).then(() => true).catch(() => false)
const typeAtTop = async (page, text) => {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}
/** Seed a starter through the projects-Home New-project picker (New project → language → card). */
const seed = async (page, { lang, name }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).first().click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + lang) }).click()
  await page.locator('.template-card').filter({ hasText: name }).first().click()
}

const ctxA = await newContext('host')
const ctxB = await newContext('guest2')
let roomUrl = ''
const createdRooms = []
try {
  // ---------- Host: seed Python basics, start collaboration ----------
  const A = wire(ctxA.pages()[0] ?? (await ctxA.newPage()), 'A')
  await A.goto(BASE)
  await A.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
  await seed(A, { lang: 'Python', name: 'Python basics' })
  await A.waitForSelector('.cm-content', { timeout: 30000 })
  await seesText(A, 'first Python program', 30000) // the seeded main.py is really open

  await A.getByRole('menuitem', { name: 'File', exact: true }).click()
  await A.getByRole('menuitem', { name: 'Start collaboration' }).click()
  await A.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
  roomUrl = await A.evaluate(() => location.href)
  createdRooms.push(roomUrl)
  const roomOk = /#room=[0-9A-HJKMNP-TV-Z]{26}$/.test(roomUrl)
  roomOk
    ? pass('host: Start collaboration writes #room=', '#' + roomUrl.split('#')[1])
    : fail('host: no #room= in URL', roomUrl)
  ;(await A.getByText('Live', { exact: true }).count()) > 0
    ? pass('host: "Live" pill shows while hosting')
    : fail('host: no "Live" pill')

  const MARK = 'HOSTMARK_A1'
  await typeAtTop(A, `# ${MARK}\n`)
  await A.waitForTimeout(1500) // let BlobSync flush this to the backend

  // ---------- Guest 1: same browser, second tab (BroadcastChannel) ----------
  const G1 = wire(await ctxA.newPage(), 'G1')
  await G1.goto(roomUrl)
  const g1In = await inEditor(G1, 30000)
  g1In ? pass('guest (same browser): the #room= link opens INTO the editor, not Home')
       : fail('guest (same browser): stranded — no editor appeared')
  if (g1In) {
    (await seesText(G1, MARK)) ? pass('guest (same browser): sees the host\'s content')
                               : fail('guest (same browser): host content never arrived')
    const MARK2 = 'HOSTLIVE_A2'
    await typeAtTop(A, `# ${MARK2}\n`)
    ;(await seesText(G1, MARK2)) ? pass('live sync host -> guest') : fail('live sync host -> guest failed')
    const MARK3 = 'GUESTLIVE_G3'
    await typeAtTop(G1, `# ${MARK3}\n`)
    ;(await seesText(A, MARK3)) ? pass('live sync guest -> host') : fail('live sync guest -> host failed')
    ;(await A.getByText('Live', { exact: true }).count()) > 0
      ? pass('presence: host still live with a peer joined') : fail('presence: host lost Live state')
  }

  // ---------- Guest 2: a fresh profile — a real remote device ----------
  const G2 = wire(ctxB.pages()[0] ?? (await ctxB.newPage()), 'G2')
  await G2.goto(roomUrl)
  const g2In = await inEditor(G2, 45000)
  g2In ? pass('guest (fresh device): the #room= link opens INTO the editor, not Home')
       : fail('guest (fresh device): stranded — no editor appeared')
  if (g2In) {
    // Deterministic: BlobSync GETs the persisted doc on join, so the seeded
    // starter text is present regardless of live WebRTC.
    (await seesText(G2, 'first Python program', 25000))
      ? pass('guest (fresh device): materialised the shared project from the blob store')
      : fail('guest (fresh device): shared files never materialised')
  }

  // ---------- Host switches project while live (the P0 room-wipe bug) ----------
  // The switch must end the session cleanly; the room's content must survive in
  // the blob store and in every guest, never diffed against the new project.
  // File > New Project… → template picker → name prompt (needs a unique name) → Create.
  await A.getByRole('menuitem', { name: 'File', exact: true }).click()
  await A.getByRole('menuitem', { name: 'New Project…' }).click()
  await A.locator('dialog[open]').getByRole('button', { name: /^Python/ }).click()
  await A.locator('.template-card').filter({ hasText: 'Python basics' }).first().click()
  const nameInput = A.locator('dialog[open] input').first()
  await nameInput.waitFor({ timeout: 10000 })
  await nameInput.fill('Switch Target')
  await A.locator('dialog[open]').getByRole('button', { name: 'Create', exact: true }).click()
  await A.waitForTimeout(2500) // let the stop-flush land and any (buggy) wipe propagate
  ;(await A.getByText('Live', { exact: true }).count()) === 0
    ? pass('switch-while-live: the switch ended the session (no Live pill on the new project)')
    : fail('switch-while-live: session survived a project switch')
  ;(await seesText(G1, 'HOSTMARK_A1', 5000))
    ? pass('switch-while-live: guest content survived the host\'s project switch')
    : fail('switch-while-live: guest content was wiped by the switch')
  // Strongest check: a brand-new device can still materialise the room afterwards.
  const ctxE = await newContext('late-join')
  try {
    const E = wire(ctxE.pages()[0] ?? (await ctxE.newPage()), 'E')
    await E.goto(roomUrl)
    if (await inEditor(E, 45000)) {
      (await seesText(E, 'HOSTMARK_A1', 25000))
        ? pass('switch-while-live: room still materialises for a fresh guest (blob intact)')
        : fail('switch-while-live: blob store lost the room content')
    } else fail('switch-while-live: late guest never reached the editor')
  } finally {
    await ctxE.close().catch(() => {})
  }

  // ---------- Silent host: starts collab, types NOTHING ----------
  // The seed must reach the blob store without a keystroke (dirty-at-construction).
  const ctxC = await newContext('silent-host')
  const ctxD = await newContext('silent-guest')
  try {
    const C = wire(ctxC.pages()[0] ?? (await ctxC.newPage()), 'C')
    await C.goto(BASE)
    await C.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
    await seed(C, { lang: 'Python', name: 'Python basics' })
    await C.waitForSelector('.cm-content', { timeout: 30000 })
    await seesText(C, 'first Python program', 30000)
    await C.getByRole('menuitem', { name: 'File', exact: true }).click()
    await C.getByRole('menuitem', { name: 'Start collaboration' }).click()
    await C.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
    const silentUrl = await C.evaluate(() => location.href)
    createdRooms.push(silentUrl)
    await C.waitForTimeout(2500) // flush window — and NOT A SINGLE KEYSTROKE
    const D = wire(ctxD.pages()[0] ?? (await ctxD.newPage()), 'D')
    await D.goto(silentUrl)
    if (await inEditor(D, 45000)) {
      (await seesText(D, 'first Python program', 25000))
        ? pass('silent host: fresh guest materialised the untouched seed from the blob store')
        : fail('silent host: seed never persisted — guest got an empty room')
    } else fail('silent host: guest never reached the editor')
  } finally {
    await ctxC.close().catch(() => {})
    await ctxD.close().catch(() => {})
  }

  // ---------- H1: Stop -> Start reuses the room; post-restart edits must resync ----------
  // The bug: after Stop then Start again on the same project (which REUSES the room
  // id), the open file was never re-bound to the new session's Y.Text, so the host's
  // new edits went only to OPFS — never into the shared doc. "Live" stayed up while
  // nothing propagated. Repro: start, type PRE, stop, start again, type POST — a
  // fresh guest joining after the restart must see POST (not just the pre-stop PRE).
  const ctxRH = await newContext('restart-host')
  const ctxRG = await newContext('restart-guest')
  try {
    const RH = wire(ctxRH.pages()[0] ?? (await ctxRH.newPage()), 'RH')
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
    // First session: type PRE, let it flush.
    const url1 = await startCollab()
    createdRooms.push(url1)
    await typeAtTop(RH, `# RESTART_PRE_1\n`)
    await RH.waitForTimeout(1500)
    // Stop.
    await RH.getByRole('menuitem', { name: 'File', exact: true }).click()
    await RH.getByRole('menuitem', { name: 'Stop collaboration' }).click()
    await RH.waitForFunction(() => !location.hash.startsWith('#room='), null, { timeout: 8000 }).catch(() => {})
    await RH.waitForTimeout(500)
    // Start again — must reuse the same room id (contract §5 room-id reuse).
    const url2 = await startCollab()
    ;(url2.split('#room=')[1] === url1.split('#room=')[1])
      ? pass('restart: Start after Stop reuses the same room id')
      : fail('restart: Start after Stop minted a different room id', `${url1} -> ${url2}`)
    // Post-restart edit — this is the one that used to vanish.
    await typeAtTop(RH, `# RESTART_POST_2\n`)
    await RH.waitForTimeout(1800) // let the re-bound doc flush to the blob store
    ;(await RH.getByText('Live', { exact: true }).count()) > 0
      ? pass('restart: host still shows "Live" after the restart')
      : fail('restart: host lost the Live pill after restart')

    const RG = wire(ctxRG.pages()[0] ?? (await ctxRG.newPage()), 'RG')
    await RG.goto(url2)
    if (await inEditor(RG, 45000)) {
      ;(await seesText(RG, 'RESTART_POST_2', 25000))
        ? pass('H1: post-restart host edits reach a fresh guest (session re-bound the open file)')
        : fail('H1: post-restart host edits never synced — restart did not re-bind the open file')
    } else {
      fail('H1: restart guest never reached the editor')
    }
  } finally {
    await ctxRH.close().catch(() => {})
    await ctxRG.close().catch(() => {})
  }
} catch (e) {
  fail('harness threw', e.message)
} finally {
  if (errors.length) {
    console.log('\n--- page errors/console.error ---')
    for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e)
  }
  await ctxA.close().catch(() => {})
  await ctxB.close().catch(() => {})
  // Delete the rooms this run minted, or repeated runs exhaust the dev device
  // quota (10 docs) and every later run 403s on create-PUT. Best-effort: needs
  // WARSHA_API/WARSHA_TOKEN (falls back to the app's dev .env.local).
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
}

const passed = results.filter(Boolean).length
console.log(`\n== ${passed}/${results.length} passed ==`)
process.exit(passed === results.length ? 0 : 1)
