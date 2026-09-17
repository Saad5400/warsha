/* QA for action placement: WHERE each action lives, and that one action is
 * never two labels. It is a fast, engine-free suite — it opens every menu
 * surface and reads it, so it catches the drift that put "Share as link…" in
 * File and "Share project as link…" in the tab strip's ⋯ at the same time.
 *
 * The contract it pins (docs/design/LAYOUT-VSCODE.md, "Action placement"):
 *   - scope decides the home: the ⋯ is the OPEN FILE's actions and nothing else
 *   - the share family has one home (the Share menu) and one set of words
 *   - the rail's gear is settings, not the app's spare drawer
 *
 * Drives local Chrome against a served build (any port):
 *
 *   cd app && npx vite build && npx vite preview --port 8083 --strictPort
 *   cd tools/qa && node menus-check.mjs
 *
 * Overridable: WARSHA_URL (default http://127.0.0.1:8083/), CHROME.
 */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

// 1280px keeps the menu bar expanded (it collapses to ☰ below 1150px) — the
// titles are what this suite reads.
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-menus-')), {
  executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errs.push(m.text()) })
// ?lang=en pins English: every label below is a contract in that bundle.
await page.goto(URL_.replace(/\/$/, '') + '/?lang=en')
await page.getByRole('button', { name: 'New project', exact: true }).first().waitFor({ timeout: 60000 })
await page.getByRole('button', { name: 'New project', exact: true }).first().click()
await page.locator('dialog[open]').getByRole('button', { name: /Python/ }).first().click()
await page.locator('.template-card').first().click()
await page.waitForSelector('.cm-content', { timeout: 30000 })
await page.waitForTimeout(600)

let pass = 0, fail = 0
const check = async (label, fn) => {
  try { const ok = await fn(); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); ok ? pass++ : fail++ }
  catch (e) { console.log(`FAIL  ${label} :: ${e.message.split('\n')[0]}`); fail++ }
}
const esc = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(200) }
const row = (name) => page.getByRole('menuitem', { name })
const openTitle = async (t) => { await page.getByRole('menuitem', { name: t, exact: true }).click(); await page.waitForTimeout(300) }

// ---------------------------------------------------------- the menu bar
await check('menu bar shows six titles', async () => {
  const names = await page.locator('[role="menubar"] [role="menuitem"]').allInnerTexts()
  return names.join(',') === 'File,Edit,View,Run,Share,Help'
})
// -------------------------------------------- File: lifecycle rows only
await openTitle('File')
for (const n of ['New File…', 'New Project…', 'Open Recent', 'All Projects', 'Import…', 'Export as .zip', 'Save All', 'Rename Project…', 'Empty Project…', 'Delete Project…'])
  await check(`File > ${n}`, async () => (await row(n).count()) === 1)
await check('File no longer carries share rows', async () => (await page.getByRole('menuitem', { name: /Share as|live session/i }).count()) === 0)
await esc()
// ------------------------------- Share: the whole family, under headings
await openTitle('Share')
for (const n of ['Share as image…', 'Download file', 'Share as link…', 'Share as PDF…', 'Export as .zip', 'Start live session', 'Live session link…'])
  await check(`Share > ${n}`, async () => (await row(n).count()) === 1)
await check('Share headings render', async () => {
  const t = await page.locator('[role="menu"]').last().innerText()
  return /THIS FILE/i.test(t) && /THIS PROJECT/i.test(t) && /LIVE SESSION/i.test(t)
})
await check('Live session link… is disabled until a session is up', async () => (await row('Live session link…').getAttribute('disabled')) !== null)
await esc()
// ------------------------------------------------------ View, Run, Help
await openTitle('View')
await check('View > Bigger Text (QA contract)', async () => (await row('Bigger Text').count()) === 1)
await check('View sheds the two stranded prefs', async () => (await page.getByRole('menuitem', { name: /Language|Run Button/ }).count()) === 0)
await esc()
await openTitle('Help')
for (const n of ['Tutorials', 'About Warsha']) await check(`Help > ${n}`, async () => (await row(n).count()) === 1)
await esc()
// --------------------------------------------- the ⋯: the open file only
await page.locator('button[aria-label="More"]').click(); await page.waitForTimeout(300)
for (const n of ['Format File', 'Generate…', 'Share as image…', 'Download file'])
  await check(`⋯ > ${n}`, async () => (await row(n).count()) === 1)
await check('⋯ carries nothing project-scoped', async () => (await page.getByRole('menuitem', { name: /as link|as PDF|\.zip|live session/i }).count()) === 0)
await check('⋯ Share as image… enabled with a file open', async () => (await row('Share as image…').getAttribute('disabled')) === null)
await esc()
// ------------------------------------------- the rail gear: settings only
await page.getByRole('button', { name: 'Manage', exact: true }).click(); await page.waitForTimeout(300)
for (const n of ['Command Palette…', 'Language']) await check(`gear > ${n}`, async () => (await row(n).count()) === 1)
await check('gear keeps the scale slider', async () => (await page.locator('[role="menu"] input[type="range"]').count()) === 1)
await check('gear steppers the editor text size', async () => (await page.locator('[role="menu"]').getByRole('button', { name: 'Smaller Text' }).count()) === 1)
await check('gear is settings, not a drawer (no Tutorials/About)', async () => (await page.getByRole('menuitem', { name: /Tutorials|About/ }).count()) === 0)
await check('text size stepper works and keeps the menu open', async () => {
  const before = await page.locator('[role="menu"]').innerText()
  await page.locator('[role="menu"]').getByRole('button', { name: 'Bigger Text' }).click()
  await page.waitForTimeout(250)
  const after = await page.locator('[role="menu"]').innerText()
  return before !== after
})
await esc()
// --------------------------------------------------- the Explorer's rows
await page.locator('[role="treeitem"]').first().click({ button: 'right' })
await page.waitForTimeout(300)
await check('explorer row > Download file (same words as the ⋯)', async () => (await row('Download file').count()) === 1)
await esc()
console.log(`\n${pass} passed, ${fail} failed`)
if (errs.length) console.log('page errors:', errs.slice(0, 5))
await ctx.close()
process.exit(fail ? 1 : 0)
