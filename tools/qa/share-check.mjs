/* Share-as-link and share-as-PDF, end to end in the built app.
 *
 * The link contract under test (App.tsx `applyShared` + sharelink.ts):
 *   1. Sharing puts a #share= URL on the clipboard (no share sheet headless).
 *   2. Opening your own link back does NOT duplicate: the untouched copy is
 *      found by content and simply opened.
 *   3. After the project is edited, the same link makes a NEW project, with
 *      the taken name deduped ("Python basics 2").
 *   4. Re-opening the link once more finds THAT untouched copy — still no
 *      third project.
 *   5. A fresh profile (someone else's device) opening the link cold gets the
 *      project created, entry file open, correct name.
 *   6. Both arrival paths work: a full load with the hash present (boot) and
 *      a bare hashchange in an already-open tab (pasting into the URL bar).
 *   7. A damaged payload says so and changes nothing.
 * Plus the PDF: the ⋯ row produces a real .pdf download (magic bytes, not a
 * stub) that covers every file, and says what it is doing meanwhile.
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
mkdirSync(SHOTS, { recursive: true })

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }

const launch = async (tag) => {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `warsha-share-${tag}-`)), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
  })
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('pageerror', (e) => errors.push(`${tag}: pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`) })
  return { ctx, page }
}
const errors = []

/** The newest toast containing `needle` (plain substring, [role=status] rows). */
const hasToast = (page, needle, t = 30000) => page.waitForFunction(
  (n) => [...document.querySelectorAll('[role="status"]')].some((el) => el.innerText.includes(n)),
  needle, { timeout: t })

/** File > Open Recent row count = how many projects this device holds. */
async function projectCount(page) {
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Open Recent' }).hover()
  await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length >= 2, null, { timeout: 5000 })
  const rows = await page.locator('[role="menu"]').last().locator('[role="menuitem"]').allInnerTexts()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[role="menu"]', { state: 'detached', timeout: 5000 }).catch(() => {})
  return rows.filter((r) => r.trim()).length
}

async function shareRow(page, label) {
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.waitForSelector('[role="menu"]', { timeout: 5000 })
  await page.getByRole('menuitem', { name: label }).click()
}

// ---------- device A: seed, share, self-reopen, edit, reopen, reopen ----------
const a = await launch('a')
try {
  await a.page.goto(BASE)
  await a.page.waitForSelector('button:has-text("New from a starter")', { timeout: 60000 })
  await seedStarter(a.page, { lang: 'Python', name: 'Python basics' })
  await a.page.waitForSelector('.cm-content', { timeout: 30000 })

  // 1 — the link lands on the clipboard
  await shareRow(a.page, /Share project as link/)
  await hasToast(a.page, 'Link copied')
  const link = await a.page.evaluate(() => navigator.clipboard.readText())
  if (link.includes('#share=') && link.startsWith('http')) pass('link: copied a #share= URL', `${link.length} chars`)
  else fail('link: copied a #share= URL', link.slice(0, 80))

  // 2 — own link back, unchanged: opened, not duplicated (hashchange path)
  await a.page.evaluate((url) => { location.href = url }, link)
  await hasToast(a.page, 'You already have this project')
  const afterSelf = await projectCount(a.page)
  if (afterSelf === 1) pass('link: unchanged self-reopen deduped', '1 project')
  else fail('link: unchanged self-reopen deduped', `${afterSelf} projects`)

  // 3 — edit, then the same link creates a second, name-deduped project
  await a.page.locator('.cm-content').click()
  await a.page.keyboard.type('# edited on device A\n')
  await a.page.evaluate((url) => { location.href = url }, link)
  await hasToast(a.page, 'ready — 1 file')
  const afterEdit = await projectCount(a.page)
  if (afterEdit === 2) pass('link: reopen after edit created a copy', '2 projects')
  else fail('link: reopen after edit created a copy', `${afterEdit} projects`)
  // The project name renders inside the top bar's window title.
  const barText = await a.page.locator('.top-bar').innerText()
  if (barText.includes('Python basics 2')) pass('link: duplicate name deduped', barText.trim().replace(/\s+/g, ' '))
  else fail('link: duplicate name deduped', barText.trim().replace(/\s+/g, ' '))

  // 4 — once more: the untouched copy is found, still 2 projects
  await a.page.evaluate((url) => { location.href = url }, link)
  await hasToast(a.page, 'You already have this project')
  const afterThird = await projectCount(a.page)
  if (afterThird === 2) pass('link: third open still deduped', '2 projects')
  else fail('link: third open still deduped', `${afterThird} projects`)

  // 5 — a damaged payload says so
  await a.page.evaluate(() => { location.href = location.pathname + '#share=not-a-real-payload' })
  await hasToast(a.page, 'damaged or cut short')
  pass('link: damaged payload refused with a sentence')

  // 6 — the PDF is real and covers the project
  const dl = a.page.waitForEvent('download', { timeout: 120000 })
  await shareRow(a.page, /Share project as PDF/)
  await hasToast(a.page, 'Making the PDF')
  const download = await dl
  const name = download.suggestedFilename()
  const file = join(mkdtempSync(join(tmpdir(), 'warsha-pdf-')), name)
  await download.saveAs(file)
  const bytes = readFileSync(file)
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-'
  if (name.endsWith('.pdf') && isPdf && bytes.length > 10000) pass('pdf: real file downloaded', `${name}, ${bytes.length} bytes`)
  else fail('pdf: real file downloaded', `${name}, magic=${isPdf}, ${bytes.length} bytes`)
  await hasToast(a.page, 'PDF downloaded')
  await a.page.screenshot({ path: join(SHOTS, 'share-check-a.png') })

  // ---------- device B: someone else opens the link cold (boot path) ----------
  const b = await launch('b')
  try {
    await b.page.goto(link)
    await hasToast(b.page, 'ready — 1 file', 60000)
    const tabText = await b.page.locator('[role="tablist"][aria-label="Open files"]').innerText()
    if (tabText.includes('main.py')) pass('link: cold open lands with entry file open', tabText.trim())
    else fail('link: cold open lands with entry file open', tabText.trim())
    const bBar = await b.page.locator('.top-bar').innerText()
    if (bBar.includes('Python basics')) pass('link: cold open kept the project name', bBar.trim().replace(/\s+/g, ' '))
    else fail('link: cold open kept the project name', bBar.trim().replace(/\s+/g, ' '))
    const src = await b.page.locator('.cm-content').innerText()
    if (src.includes('print')) pass('link: file content arrived', `${src.length} chars on screen`)
    else fail('link: file content arrived', src.slice(0, 60))
    await b.page.screenshot({ path: join(SHOTS, 'share-check-b.png') })
  } finally {
    await b.ctx.close()
  }
} finally {
  await a.ctx.close()
}

if (errors.length) { fail('zero console errors', errors.slice(0, 3).join(' | ')) }
else pass('zero console errors')

const failed = results.filter(([s]) => s === 'FAIL').length
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} (${results.length} checks)`)
process.exit(failed === 0 ? 0 : 1)
