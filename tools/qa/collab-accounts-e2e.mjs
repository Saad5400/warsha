/* Phase-2 accounts + link-access sharing, end to end in the running app
 * (COLLAB-SYNC-CONTRACT §7). Sibling to collab-e2e.mjs; that one covers the
 * anonymous live-sync path, this one covers what accounts + sharing add:
 *
 *   1. Sign up -> the account menu shows the signed-in email + /v1/me usage.
 *   2. The session persists across a full reload (token in localStorage, /v1/me
 *      re-validates it on boot).
 *   3. Link-access = Viewer -> a second (anonymous) context joins and its editor
 *      is truly READ-ONLY: typing changes nothing and nothing reaches the host.
 *   4. Link-access = Off -> a fresh context is denied (never materialises the
 *      shared project).
 *
 * The owner SIGNS IN before hosting on purpose: in dev every anonymous browser
 * shares one device principal (VITE_WARSHA_TOKEN), so only an account owner makes
 * an anonymous guest a genuine link-viewer rather than a co-owner.
 *
 * Needs the app served with VITE_WARSHA_API set and the backend up. Run:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node collab-accounts-e2e.mjs
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
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-acct-${tag}-`)), {
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
const seesText = (page, needle, t = 20000) =>
  page.waitForFunction((n) => (document.querySelector('.cm-content')?.textContent ?? '').includes(n), needle, { timeout: t })
    .then(() => true).catch(() => false)
const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
const inEditor = (page, t = 40000) =>
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
/** Open Manage (rail gear) -> the account row, whatever its current label. */
const openAccount = async (page, rowName) => {
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page.getByRole('menuitem', { name: rowName }).click()
}
/** Create an account through the sign-in dialog. Returns the email used. */
const signUp = async (page) => {
  const email = `qa_${Date.now()}_${Math.floor(Math.random() * 1e6)}@warsha.test`
  await openAccount(page, 'Sign in…')
  const dlg = page.locator('dialog[open]')
  await dlg.waitFor({ timeout: 10000 })
  await dlg.getByRole('button', { name: 'New here? Create an account' }).click()
  await dlg.locator('input[type="email"]').fill(email)
  await dlg.locator('input[type="password"]').fill('collab-pass-123')
  await dlg.getByRole('button', { name: 'Create account' }).click()
  // The dialog closes on success.
  await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  return email
}
/** As the owner, open File > Share room… and set link access by its option text. */
const setLinkAccess = async (page, optionText) => {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Share room…' }).click()
  const dlg = page.locator('dialog[open]')
  await dlg.waitFor({ timeout: 10000 })
  await dlg.getByRole('radio').filter({ hasText: optionText }).click()
  // Give the PATCH a beat to land, then close.
  await page.waitForTimeout(1200)
  await dlg.getByRole('button', { name: 'Done' }).click()
  await dlg.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
}

const createdRooms = []
const contexts = []
try {
  // ================= 1) Sign up -> account + usage; 2) persist across reload ==========
  // The account UI lives behind the editor's Manage gear (no gear on Home), so we
  // seed a project to enter the editor first.
  {
    const ctx = await newContext('signup'); contexts.push(ctx)
    const P = wire(ctx.pages()[0] ?? (await ctx.newPage()), 'signup')
    await P.goto(BASE)
    await P.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
    await seed(P, { lang: 'Python', name: 'Python basics' })
    await P.waitForSelector('.cm-content', { timeout: 30000 })
    const email = await signUp(P)

    // Re-open the account panel: the row now carries the email, and the panel
    // shows "Signed in as <email>" + usage from /v1/me.
    await openAccount(P, email)
    const panel = P.locator('dialog[open]')
    await panel.waitFor({ timeout: 10000 })
    ;(await panel.getByText('Signed in as').count()) > 0
      ? pass('signup: account panel shows signed-in state')
      : fail('signup: no signed-in state after signup')
    ;(await panel.getByText('Usage').count()) > 0
      ? pass('signup: /v1/me usage is shown in the account panel')
      : fail('signup: usage missing from account panel')
    await panel.getByRole('button', { name: 'Close' }).click()
    await panel.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})

    // Full reload — the session must survive (localStorage token + /v1/me revalidate).
    // Cold start lands on Home; reopen the project to reach the editor + its gear.
    await P.reload()
    await P.getByText('Continue where you left off').first().waitFor({ timeout: 60000 })
    await P.locator('button', { hasText: 'Continue where you left off' }).first().click()
    await P.waitForSelector('.cm-content', { timeout: 30000 })
    await P.getByRole('button', { name: 'Manage', exact: true }).click()
    const stillIn = (await P.getByRole('menuitem', { name: email }).count()) > 0
    stillIn ? pass('reload: the session persisted (account still shown after reload)')
            : fail('reload: session lost after reload')
    await P.keyboard.press('Escape')
  }

  // ================= 3) Viewer read-only  4) link Off denied ==========================
  const ctxOwner = await newContext('owner'); contexts.push(ctxOwner)
  const O = wire(ctxOwner.pages()[0] ?? (await ctxOwner.newPage()), 'owner')
  await O.goto(BASE)
  await O.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })

  // Seed a project to reach the editor (the account gear lives there), then sign
  // in BEFORE starting the room — so the hosted doc is owned by the account, which
  // makes an anonymous guest a genuine link-viewer rather than a co-owner.
  await seed(O, { lang: 'Python', name: 'Python basics' })
  await O.waitForSelector('.cm-content', { timeout: 30000 })
  await seesText(O, 'first Python program', 30000)
  await signUp(O)
  await O.getByRole('menuitem', { name: 'File', exact: true }).click()
  await O.getByRole('menuitem', { name: 'Start collaboration' }).click()
  await O.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
  const roomUrl = await O.evaluate(() => location.href)
  createdRooms.push(roomUrl)
  const roomOk = /#room=[0-9A-HJKMNP-TV-Z]{26}$/.test(roomUrl)
  roomOk
    ? pass('owner: signed-in host started a room', '#' + roomUrl.split('#')[1])
    : fail('owner: no #room= after start', roomUrl)

  const OWNERMARK = 'OWNER_SEED_1'
  await typeAtTop(O, `# ${OWNERMARK}\n`)
  await O.waitForTimeout(1500) // flush to the blob store

  // Owner shares the link as VIEWER.
  await setLinkAccess(O, 'can view')
  pass('owner: set link access = Viewer via the share dialog')

  // ---- Guest joins the viewer link: editor must be READ-ONLY ----
  const ctxGuest = await newContext('viewer'); contexts.push(ctxGuest)
  const G = wire(ctxGuest.pages()[0] ?? (await ctxGuest.newPage()), 'viewer')
  await G.goto(roomUrl)
  if (await inEditor(G, 45000)) {
    ;(await seesText(G, 'first Python program', 25000))
      ? pass('viewer: joined and materialised the shared project (viewer can read)')
      : fail('viewer: shared project never materialised for the viewer')
    // The read-only role is resolved from the server after join — wait for the badge.
    const sawBadge = await G.getByText('View only', { exact: true }).first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false)
    sawBadge ? pass('viewer: the "View only" indicator is shown')
             : fail('viewer: no "View only" indicator (role not resolved to viewer)')

    // Typing must do NOTHING: neither the viewer's own doc nor the host changes.
    const before = await editorText(G)
    const VMARK = 'VIEWER_TRIED_TO_TYPE'
    await typeAtTop(G, `# ${VMARK}\n`)
    await G.waitForTimeout(1500)
    const after = await editorText(G)
    after === before
      ? pass('viewer: editor is read-only — local typing changed nothing')
      : fail('viewer: read-only editor still accepted a local edit')
    // And nothing the viewer typed reached the host.
    const hostGotIt = await seesText(O, VMARK, 4000)
    !hostGotIt ? pass('viewer: no viewer edit reached the host')
               : fail('viewer: a viewer edit propagated to the host')
  } else {
    fail('viewer: never reached the editor')
  }

  // ---- H1 regression: a viewer that types the INSTANT the shared file binds ----
  // The bug: a joining guest started writable and only flipped to read-only once
  // probeRole resolved (~up to 2.5s), so a viewer could type into the collab file
  // during that window and the edit propagated over WebRTC into the host. Fail-closed
  // (a guest joins read-only, flips writable ONLY on role=editor) closes it. Here a
  // fresh viewer types the moment the shared content materialises — i.e. the file is
  // Y.Text-bound — WITHOUT waiting for the "View only" badge (that badge is the role
  // probe landing, the very thing we must not depend on). Nothing may reach the host.
  // A dedicated context with the service worker BLOCKED, so page/context routing can
  // actually intercept the API calls (the SW otherwise proxies them out of reach).
  const ctxRace = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-acct-h1-race-')), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream'],
    serviceWorkers: 'block',
  })
  contexts.push(ctxRace)
  await ctxRace.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  // Hang the role probe (the stale-version PUT, If-Match: INT_MAX) so it NEVER
  // resolves. That holds open the exact window H1 is about: pre-fix the guest stayed
  // writable until probeRole answered, so with the probe hung the editor would accept
  // edits the whole time; fail-closed keeps it read-only regardless of the probe.
  // Deterministic — no dependence on how fast the probe would otherwise land. Only
  // the INT_MAX PUT is held; the blob GET (the viewer's read) and signaling proceed.
  await ctxRace.route('**/v1/docs/**', async (route) => {
    const req = route.request()
    if (req.method() === 'PUT' && req.headers()['if-match'] === '2147483647') {
      await new Promise(() => {}) // hang forever; the request stays pending
      return
    }
    return route.continue()
  })
  const H = wire(ctxRace.pages()[0] ?? (await ctxRace.newPage()), 'h1-race')
  await H.goto(roomUrl)
  if (await inEditor(H, 45000)) {
    // The guest's "Shared session" project is created EMPTY, so the editor renders
    // only once the shared file materialises bound to its Y.Text.
    ;(await seesText(H, 'first Python program', 25000))
      ? pass('H1: race viewer materialised the shared file')
      : fail('H1: race viewer never materialised the shared file')
    // With the probe hung, a pre-fix guest is writable the whole time. Type and prove
    // the editor rejected it (read-only) AND nothing reached the host — either would
    // mean the guest could write before its role was ever confirmed. (Pre-fix this
    // failed both ways: localChanged=true, reachedHost=true.)
    const before = await editorText(H)
    const HRACE = 'H1_RACE_BEFORE_PROBE'
    await typeAtTop(H, `# ${HRACE}\n`)
    await H.waitForTimeout(1500)
    const after = await editorText(H)
    const hostRaced = await seesText(O, HRACE, 4000)
    after === before && !hostRaced
      ? pass('H1: a guest stays read-only until role-resolve — no edit, locally or to the host')
      : fail(`H1: guest wrote before role-resolve (localChanged=${after !== before}, reachedHost=${hostRaced})`)
  } else {
    fail('H1: race viewer never reached the editor')
  }

  // ---- Owner turns the link OFF: a fresh context must be denied ----
  await setLinkAccess(O, 'Link off')
  pass('owner: set link access = Off via the share dialog')

  const ctxDenied = await newContext('denied'); contexts.push(ctxDenied)
  const D = wire(ctxDenied.pages()[0] ?? (await ctxDenied.newPage()), 'denied')
  await D.goto(roomUrl)
  await inEditor(D, 30000) // it may land in an (empty) editor; it must NOT get the content
  const gotContent = await seesText(D, 'first Python program', 8000)
  !gotContent ? pass('link off: a fresh context is denied the shared project')
              : fail('link off: a denied context still received the shared project')

  // ================= H2: mid-session revocation of an ALREADY-CONNECTED peer ==========
  // The bug: link-access was probed ONCE at connect, so an owner downgrading Editor ->
  // Viewer mid-session left a connected guest with a writable editor whose edits still
  // reached the host. Fix (honest clients): the owner's PATCH also writes linkAccess
  // into the Y.Doc meta; a connected guest observes it, re-resolves its role, and flips
  // read-only. Here the guest joins as an EDITOR (default link access), proves it can
  // write to the host, THEN the owner downgrades to Viewer while it stays connected —
  // the guest must go read-only and its next edit must NOT reach the host.
  {
    const ctxH2O = await newContext('h2-owner'); contexts.push(ctxH2O)
    const H2O = wire(ctxH2O.pages()[0] ?? (await ctxH2O.newPage()), 'h2-owner')
    await H2O.goto(BASE)
    await H2O.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
    await seed(H2O, { lang: 'Python', name: 'Python basics' })
    await H2O.waitForSelector('.cm-content', { timeout: 30000 })
    await seesText(H2O, 'first Python program', 30000)
    await signUp(H2O) // owner signs in so the anonymous guest is a genuine link-peer
    await H2O.getByRole('menuitem', { name: 'File', exact: true }).click()
    await H2O.getByRole('menuitem', { name: 'Start collaboration' }).click()
    await H2O.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
    const h2url = await H2O.evaluate(() => location.href)
    createdRooms.push(h2url)
    await typeAtTop(H2O, `# H2_OWNER_SEED\n`)
    await H2O.waitForTimeout(1500)

    // Guest joins while link access is still the default (Editor).
    const ctxH2G = await newContext('h2-guest'); contexts.push(ctxH2G)
    const H2G = wire(ctxH2G.pages()[0] ?? (await ctxH2G.newPage()), 'h2-guest')
    await H2G.goto(h2url)
    if (await inEditor(H2G, 45000)) {
      ;(await seesText(H2G, 'first Python program', 25000))
        ? pass('H2: editor-guest joined and materialised the shared project')
        : fail('H2: editor-guest never materialised the shared project')
      // Baseline: as an editor, the connected guest's edit DOES reach the host.
      await typeAtTop(H2G, `# H2_EDITOR_EDIT\n`)
      ;(await seesText(H2O, 'H2_EDITOR_EDIT', 10000))
        ? pass('H2: connected editor-guest edit reaches the host (writable baseline)')
        : fail('H2: editor-guest edit never reached the host (baseline broken)')

      // Owner downgrades to Viewer WHILE the guest stays connected.
      await setLinkAccess(H2O, 'can view')
      // The already-connected guest must flip read-only off the propagated meta.
      const wentRO = await H2G.getByText('View only', { exact: true }).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false)
      wentRO ? pass('H2: connected guest flipped to "View only" on the mid-session downgrade')
             : fail('H2: connected guest never went read-only after the owner downgraded access')

      // A post-downgrade edit must change nothing locally and never reach the host.
      const before = await editorText(H2G)
      await typeAtTop(H2G, `# H2_AFTER_REVOKE\n`)
      await H2G.waitForTimeout(1500)
      const after = await editorText(H2G)
      const reachedHost = await seesText(H2O, 'H2_AFTER_REVOKE', 4000)
      after === before && !reachedHost
        ? pass('H2: after revocation the guest edit is blocked and never reaches the host')
        : fail(`H2: revoked guest still wrote (localChanged=${after !== before}, reachedHost=${reachedHost})`)
    } else {
      fail('H2: editor-guest never reached the editor')
    }
  }
} catch (e) {
  fail('harness threw', e.stack || e.message)
} finally {
  if (errors.length) {
    console.log('\n--- page errors/console.error ---')
    for (const e of [...new Set(errors)].slice(0, 20)) console.log('  ' + e)
  }
  for (const ctx of contexts) await ctx.close().catch(() => {})
  // Best-effort: delete the rooms this run minted so repeated runs don't pile up.
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
