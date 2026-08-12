/* Latency-stress reproduction for the GUEST-JOIN DATA-LOSS window (COLLAB-SYNC
 * -CONTRACT §5, §7.4). This guards the two founder-reported bugs:
 *
 *   1. DATA LOSS: when a second device JOINS a shared room, any edits the joiner
 *      types during the connect window were DISCARDED once sync kicked in. The
 *      open file was a plain (non-yCollab) buffer until its Y.Text bound, yet the
 *      editor was already writable — so keystrokes reached neither the Y.Text nor
 *      OPFS and were overwritten at bind. Fix: a genuine guest stays READ-ONLY
 *      UNTIL its open file is bound (editorBridge.guarded() + setup.ts), so it can
 *      only ever type straight into the Y.Text.
 *   2. DELAY: ~10s before edits synced, because the host's seed sat behind the
 *      blob provider's 800ms debounce and a guest's initial GET 404'd (host PUT
 *      not landed) and fell back to slow WebRTC P2P. Fix: host flushes its seed
 *      immediately; guest re-GETs on a short interval after a 404 (blobSync.ts).
 *
 * Both only bite under real network latency (a plain localhost run is too fast to
 * open the window), so — like readonly-stress.mjs — this injects latency on the
 * guest page via CDP Network.emulateNetworkConditions.
 *
 * A genuine guest already starts fail-closed READ-ONLY until the server resolves
 * its role (session.ts). The data-loss window is narrower: role resolves to EDITOR
 * (so the editor turns writable) while the open file's Y.Text has NOT bound yet. In
 * that window the old code let the guest type into a plain buffer whose keystrokes
 * reached neither the Y.Text nor OPFS and were overwritten at bind. The fix keeps a
 * guarded guest read-only until the file carries yCollab, regardless of role.
 *
 * The guest types a UNIQUE EARLY mark the instant content is on screen (the connect
 * window), then — once the editor turns writable (bind lifts read-only) — a LATE
 * mark. Assertions, per run:
 *   (a) NO WRITABLE-WHILE-UNBOUND (the data-loss invariant): ANY edit the guest was
 *       ALLOWED to make must propagate to the host. If the early mark landed locally
 *       it MUST reach the host; if it was correctly blocked (read-only) the invariant
 *       holds vacuously. The old bug: early mark lands locally, is discarded at bind,
 *       never reaches the host → this fails.
 *   (b) FUNCTIONAL: once the editor is writable/bound, a guest edit reaches the host
 *       — the fix must not just lock the guest out, it must let it collaborate.
 *   (c) FAST DELIVERY: the guest sees the host's seed within a few seconds (not
 *       ~10s), i.e. over the durable store, not slow WebRTC.
 * Detection uses TYPED-MARK presence (editorText(x).includes(MARK)), never a raw
 * textContent diff — remote yCollab cursor/name labels stream into .cm-content and
 * are a false positive (this bit collab-accounts-e2e).
 *
 * Needs the app served with VITE_WARSHA_API set and the backend up. Run:
 *   WARSHA_URL=http://127.0.0.1:8083/ CHROME=<chrome> node guest-join-stress.mjs
 *   RUNS=5 LATENCY_MS=180 FAST_MS=5000 ... node guest-join-stress.mjs
 */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '') + '/?lang=en'
const ORIGIN = new URL(BASE).origin
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const RUNS = Number(process.env.RUNS ?? 5)
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 180)
/** How fast the guest must see the host's seed for the delivery check to pass. The
 *  old bug delivered over WebRTC P2P in ~10s; the durable-store path lands in ~1-2s. */
const FAST_MS = Number(process.env.FAST_MS ?? 5000)

const errors = []
const wire = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`) })
  return page
}
const editorText = (page) => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
/** Wait until the editor's TYPED text contains `needle` (mark-based, not diff). */
const seesText = (page, needle, t = 20000) =>
  page.waitForFunction((n) => (document.querySelector('.cm-content')?.textContent ?? '').includes(n), needle, { timeout: t })
    .then(() => true).catch(() => false)
const inEditor = (page, t = 45000) =>
  page.waitForSelector('.cm-content', { timeout: t }).then(() => true).catch(() => false)
const typeAtTop = async (page, text) => {
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}
/** contenteditable flips 'true' once read-only lifts — i.e. the file has bound to
 *  its Y.Text (the fix) or the guest was writable all along. */
const isWritable = (page) =>
  page.evaluate(() => document.querySelector('.cm-content')?.getAttribute('contenteditable') === 'true')
const waitWritable = (page, t = 20000) =>
  page.waitForFunction(() => document.querySelector('.cm-content')?.getAttribute('contenteditable') === 'true', null, { timeout: t })
    .then(() => true).catch(() => false)
const seed = async (page, { lang, name }) => {
  await page.getByRole('button', { name: 'New project', exact: true }).first().click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + lang) }).click()
  await page.locator('.template-card').filter({ hasText: name }).first().click()
}

const contexts = []
const createdRooms = []
let passed = 0
let failed = 0
const note = (ok, msg) => { if (ok) { passed++; console.log(`  PASS  ${msg}`) } else { failed++; console.log(`  FAIL  ${msg}`) } }

const newContext = async (tag, opts = {}) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-gjoin-${tag}-`)), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream'], ...opts,
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
  contexts.push(ctx)
  return ctx
}

try {
  // ---- Host: seed a project, start collaboration (set up once) ----
  const ctxHost = await newContext('host')
  const H = wire(ctxHost.pages()[0] ?? (await ctxHost.newPage()), 'host')
  await H.goto(BASE)
  await H.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
  await seed(H, { lang: 'Python', name: 'Python basics' })
  await H.waitForSelector('.cm-content', { timeout: 30000 })
  await seesText(H, 'first Python program', 30000)
  await H.getByRole('menuitem', { name: 'File', exact: true }).click()
  await H.getByRole('menuitem', { name: 'Start collaboration' }).click()
  await H.waitForFunction(() => location.hash.startsWith('#room='), null, { timeout: 15000 }).catch(() => {})
  const roomUrl = await H.evaluate(() => location.href)
  createdRooms.push(roomUrl)
  if (!/#room=[0-9A-HJKMNP-TV-Z]{26}$/.test(roomUrl)) throw new Error('host never started a room: ' + roomUrl)
  const HOSTSEED = 'HOST_SEED_MARK_1'
  await typeAtTop(H, `# ${HOSTSEED}\n`)
  // Deliberately DO NOT wait out a long flush window here — Part B (immediate seed
  // flush) is exactly what must make this content available to a joiner promptly.
  await H.waitForTimeout(400)
  console.log(`host ready, room ${roomUrl.split('#')[1]}; latency=${LATENCY_MS}ms; runs=${RUNS}; fast<=${FAST_MS}ms\n`)

  // ---- Repeated fresh-guest joins under latency, typing IN the connect window ----
  for (let i = 1; i <= RUNS; i++) {
    const MARK = `GUEST_JOIN_MARK_${i}_${Date.now()}`
    // Fresh context => empty prefs => this device is a GENUINE GUEST (owner=false),
    // so guarded()===true and the read-only-until-bound rule applies. SW blocked so
    // page-level latency reliably reaches the /v1 API + blob calls.
    const ctxGuest = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-gjoin-guest-${i}-`)), {
      executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
      args: ['--no-sandbox', '--use-fake-ui-for-media-stream'], serviceWorkers: 'block',
    })
    await ctxGuest.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN })
    const G = wire(ctxGuest.pages()[0] ?? (await ctxGuest.newPage()), `guest-${i}`)
    const cdp = await ctxGuest.newCDPSession(G)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: LATENCY_MS, downloadThroughput: -1, uploadThroughput: -1,
    })

    await G.goto(roomUrl)
    if (!(await inEditor(G, 45000))) {
      note(false, `run ${i}: guest never reached the editor`)
      await cdp.detach().catch(() => {})
      await ctxGuest.close().catch(() => {})
      continue
    }
    // (c) FAST DELIVERY: the seed must materialise quickly (durable store, not P2P).
    // Timed from the moment the editor exists, so it isolates SYNC latency from app boot.
    const seedAt = Date.now()
    const sawSeed = await seesText(G, HOSTSEED, FAST_MS)
    note(sawSeed, `run ${i}: guest saw host seed within ${FAST_MS}ms (~${Date.now() - seedAt}ms)`)

    // Connect-window EARLY mark — typed the instant content is on screen. In the OLD
    // code, once role resolved to editor the editor turned writable while the file was
    // still unbound, so these keystrokes landed in a throwaway buffer discarded at bind.
    const EARLY = `EARLY_${MARK}`
    const writableEarly = await isWritable(G)
    await typeAtTop(G, `# ${EARLY}\n`)
    const earlyLandedLocal = (await editorText(G)).includes(EARLY)
    // (a) THE DATA-LOSS INVARIANT: any edit the guest was allowed to make must reach the
    //     host. If the early keystrokes landed locally (writable), they MUST propagate;
    //     if the editor correctly blocked them (read-only until bound), the invariant is
    //     vacuously satisfied and no work was silently lost.
    const earlyReachedHost = earlyLandedLocal ? await seesText(H, EARLY, 12000) : false
    note(!earlyLandedLocal || earlyReachedHost,
      `run ${i}: no writable-while-unbound loss (writableEarly=${writableEarly} earlyLandedLocal=${earlyLandedLocal} earlyReachedHost=${earlyReachedHost})`)

    // (b) FUNCTIONAL: once the editor is writable/bound, a guest edit must reach the host.
    const becameWritable = await waitWritable(G, 20000)
    const LATE = `LATE_${MARK}`
    let lateReachedHost = false
    if (becameWritable) {
      await typeAtTop(G, `# ${LATE}\n`)
      lateReachedHost = await seesText(H, LATE, 12000)
    }
    note(becameWritable && lateReachedHost,
      `run ${i}: post-bind guest edit reached host (becameWritable=${becameWritable} lateReachedHost=${lateReachedHost})`)

    await cdp.detach().catch(() => {})
    await ctxGuest.close().catch(() => {})
  }
} catch (e) {
  console.error('guest-join stress harness error:', e && e.stack ? e.stack : e)
  failed++
} finally {
  for (const c of contexts) await c.close().catch(() => {})
  // Delete the rooms this run minted (dev device quota is small); best-effort.
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

console.log(`\nguest-join stress: ${passed}/${passed + failed} passed (latency=${LATENCY_MS}ms)`)
if (errors.length) {
  console.log(`\n(${errors.length} console/page errors captured — first few:)`)
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('  ' + e)
}
process.exit(failed === 0 ? 0 : 1)
