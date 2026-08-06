/* Multi-project support, end to end in the built app.
 *
 * Flow the feature has to survive: create a python project, run it, create a java
 * project, run it, switch back, find the python files intact, delete a project.
 * Plus the two things that are easy to get wrong: migrating the old single
 * hardwired workspace, and reopening the last project on the next visit. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WARSHA_URL / WARSHA_SHOTS / CHROME override the defaults below.
// 127.0.0.1, not localhost — a preview bound to IPv4 only breaks once Chrome resolves "localhost" to ::1.
const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
mkdirSync(SHOTS, { recursive: true })



const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-proj-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const out = () => page.locator('[aria-label="Program output"]').innerText()
const hasOut = (s, t = 240000) => page.waitForFunction(
  (needle) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(needle), s, { timeout: t })
// Run's label includes the filename ("Run main.py") — hence the prefix match.
const runBtn = () => page.getByRole('button', { name: /^Run\b/ })

// Project list is File > Open Recent everywhere (behind ☰ below 1050px); this
// harness runs lifecycle actions via the palette, not the menu rows.
const isDesk = () => page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)

/** Open the File menu, wherever this width puts it, leaving it open. */
async function openFileMenu() {
  const wide = await page.evaluate(() => matchMedia('(min-width: 1050px)').matches)
  if (wide) {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.waitForSelector('[role="menu"]', { timeout: 5000 })
    return
  }
  await page.getByRole('button', { name: 'Application Menu' }).click()
  await page.waitForSelector('[role="menu"]', { timeout: 5000 })
  // Radix opens a submenu on pointer hover of its trigger row.
  await page.getByRole('menuitem', { name: 'File', exact: true }).hover()
  await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length >= 2, null, { timeout: 5000 })
}
/** Open the project list (File > Open Recent) and return its rows' normalised
 *  texts, leaving it open. */
async function openMenu() {
  await openFileMenu()
  const menus = await page.locator('[role="menu"]').count()
  await page.getByRole('menuitem', { name: 'Open Recent' }).hover()
  await page.waitForFunction((n) => document.querySelectorAll('[role="menu"]').length > n, menus, { timeout: 5000 })
  return page.locator('[role="menu"]').last().getByRole('menuitem').allInnerTexts()
}
async function menuRows() {
  const rows = await openMenu()
  // Escape once per open menu level, including the ☰ menu below 1050px.
  for (let i = 0; i < 4 && (await page.locator('[role="menu"]').count()); i++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(250)
  return rows.map((r) => r.replace(/\s+/g, ' ').trim())
}
/** Click a PROJECT row in the Open Recent submenu. */
async function clickMenu(nameRe) {
  await openMenu()
  await page.locator('[role="menu"]').last().getByRole('menuitem').filter({ hasText: nameRe }).first().click()
  await page.waitForTimeout(400)
}
/** Runs a lifecycle command via the palette (or its File-menu row via `fileRowRe`
 *  on touch, where the palette shortcut isn't natural). */
async function runProjectCommand(paletteTitle, fileRowRe) {
  if (await isDesk()) {
    await page.keyboard.press('Control+Shift+P')
    await page.waitForSelector('section[aria-label="Quick open"]', { timeout: 5000 })
    await page.locator('input[aria-label="Search files by name"]').fill('>' + paletteTitle.replace(/^Projects: /, '').replace(/…$/, ''))
    await page.waitForTimeout(300)
    await page.locator('[role="option"]').filter({ hasText: paletteTitle }).first().click()
    await page.waitForTimeout(400)
  } else {
    await openFileMenu()
    await page.getByRole('menuitem', { name: fileRowRe }).first().click()
    await page.waitForTimeout(400)
  }
}
/** The prompt/confirm dialogs are native <dialog>. */
async function dialogFill(value) {
  await page.waitForSelector('dialog input', { timeout: 5000 })
  await page.locator('dialog input').first().fill(value)
}
async function dialogConfirm(label) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(700)
}
async function setEditor(text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await page.waitForTimeout(700)
}
const explorerFiles = async () =>
  (await page.locator('[role="treeitem"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())

// ============================================ 1. first visit: one empty project
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 }).catch(() => {})
await page.waitForSelector('[aria-label="Start a project"], .cm-content', { timeout: 20000 })
await page.waitForTimeout(800)

let rows = await menuRows()
info(`project list on first visit: ${JSON.stringify(rows)}`)
if (rows.some((r) => /^My project/.test(r))) pass('first visit has exactly one project, listed in the menu', rows.find((r) => /^My project/.test(r)))
else fail('first visit has exactly one project, listed in the menu', JSON.stringify(rows))
// One File menu holds creation, transfer, and lifecycle rows (lifecycle also
// exists as palette commands, exercised in sections 6-7).
{
  await openFileMenu()
  const fileRows = (await page.locator('[role="menu"]').last().getByRole('menuitem').allInnerTexts()).map((r) => r.replace(/\s+/g, ' ').trim())
  info(`File menu: ${JSON.stringify(fileRows)}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape') // below 1050px the ☰ menu is still behind
  await page.waitForTimeout(150)
  if (fileRows.some((r) => /New Project…/i.test(r)) && fileRows.some((r) => /Export as \.zip/.test(r)) &&
      fileRows.some((r) => /Rename Project…/.test(r)) && fileRows.some((r) => /Delete Project…/.test(r)))
    pass('project actions present in the File menu (New / Export / Rename / Delete)')
  else fail('project actions present in the File menu', JSON.stringify(fileRows))
}

// ============================== 2. python project from the start panel, then Run
// New from a starter → language → starter is the only entry point; the advanced
// starter fills the empty first project in place.
await seedStarter(page, { name: 'Python (OOP starter)' })
await page.waitForTimeout(1200)
info(`explorer after python starter: ${JSON.stringify(await explorerFiles())}`)
rows = await menuRows()
info(`menu after python starter: ${JSON.stringify(rows)}`)
if (rows.filter((r) => /Open$/.test(r)).length === 1) pass('exactly one project is marked Open')
else fail('exactly one project is marked Open', JSON.stringify(rows))
if (rows.some((r) => /^Python \(OOP starter\)/.test(r)) && !rows.some((r) => /^My project/.test(r)))
  pass('the empty first project became the Python project (no orphan left behind)', 'Python (OOP starter)')
else fail('the empty first project became the Python project', JSON.stringify(rows))

await runBtn().click()
await hasOut('Your name:')
await page.locator('[aria-label="Program input"]').fill('Warsha')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')
const pyOut = await out()
info(`--- python run ---\n${pyOut}`)
if (pyOut.includes('Total area = 24.57') && pyOut.includes('Hello, Warsha!')) pass('python project runs for real')
else fail('python project runs for real', pyOut.slice(-160))

// Leave a fingerprint so "files intact" later means something specific.
await page.locator('[role="treeitem"]', { hasText: 'main.py' }).first().click()
await page.waitForTimeout(400)
await setEditor('print("python project fingerprint")\n')
await page.waitForTimeout(600)

// ================================================= 3. new java project from menu
// "New Project…" opens the picker from the one File menu; if the project already
// has files it prompts for a name instead of replacing it.
await openFileMenu()
await page.getByRole('menuitem', { name: /New Project…/i }).click()
await page.waitForTimeout(400)
const picker = page.locator('dialog[open]')
await picker.getByRole('button', { name: /^Java/ }).click()
await picker.locator('.template-card').filter({ hasText: 'Java (OOP starter)' }).first().click()
await dialogFill('Java work')
await dialogConfirm('Create')
await page.waitForTimeout(1200)
const javaFiles = await explorerFiles()
info(`explorer in java project: ${JSON.stringify(javaFiles)}`)
if (javaFiles.some((f) => f.includes('Main.java')) && !javaFiles.some((f) => f.includes('main.py')))
  pass('new java project opened with only its own files', javaFiles.join(', '))
else fail('new java project opened with only its own files', javaFiles.join(', '))

rows = await menuRows()
info(`menu with two projects: ${JSON.stringify(rows)}`)
if (rows.some((r) => /^Java work.*Open$/.test(r)) && rows.some((r) => /^Python \(OOP starter\)$/.test(r)))
  pass('both projects listed, java marked Open')
else fail('both projects listed, java marked Open', JSON.stringify(rows))

await page.waitForTimeout(400)
await runBtn().click()
await hasOut('Your name:')
await page.locator('[aria-label="Program input"]').fill('Java')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')
const javaOut = await out()
info(`--- java run ---\n${javaOut}`)
if (javaOut.includes('Omar, age 20, studies Computer Science') && javaOut.includes('Hello, Java!'))
  pass('java project runs for real in the same session')
else fail('java project runs for real in the same session', javaOut.slice(-160))
await page.screenshot({ path: `${SHOTS}/warsha-projects-java.png` })

// ==================================== 4. switch back: python files must be intact
await page.waitForTimeout(600)
await clickMenu(/^Python \(OOP starter\)$/)
await page.waitForTimeout(1400)
const backFiles = await explorerFiles()
info(`explorer back in python: ${JSON.stringify(backFiles)}`)
if (backFiles.some((f) => f.includes('main.py')) && backFiles.some((f) => f.includes('shapes.py')) && !backFiles.some((f) => f.includes('Main.java')))
  pass('switching back shows the python files and none of the java ones', backFiles.join(', '))
else fail('switching back shows the python files', backFiles.join(', '))

const editorText = await page.locator('.cm-content').innerText()
if (editorText.includes('python project fingerprint'))
  pass('the edit made before switching away survived', 'fingerprint found in main.py')
else fail('the edit made before switching away survived', editorText.slice(0, 120))

await page.waitForTimeout(400)
await runBtn().click()
await hasOut('python project fingerprint')
pass('the switched-back project still runs')
await page.screenshot({ path: `${SHOTS}/warsha-projects-python.png` })

// ============================= 5. last-opened project reopens on the next visit
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.waitForTimeout(1500)
const afterReload = await explorerFiles()
rows = await menuRows()
if (afterReload.some((f) => f.includes('main.py')) && rows.some((r) => /^Python \(OOP starter\).*Open$/.test(r)))
  pass('last-opened project auto-opens on the next visit', 'Python (OOP starter) reopened')
else fail('last-opened project auto-opens on the next visit', `${afterReload.join(', ')} | ${JSON.stringify(rows)}`)
if ((await page.locator('.cm-content').innerText()).includes('python project fingerprint'))
  pass('project content persisted across reload (OPFS)')
else fail('project content persisted across reload (OPFS)')

// ================================================== 6. delete the open project
await runProjectCommand('Projects: Delete Project…', /^Delete Project…/)
await dialogConfirm('Delete')
await page.waitForTimeout(1600)
rows = await menuRows()
info(`menu after delete: ${JSON.stringify(rows)}`)
if (!rows.some((r) => /^Python \(OOP starter\)/.test(r))) pass('deleted project is gone from the list')
else fail('deleted project is gone from the list', JSON.stringify(rows))
if (rows.some((r) => /^Java work.*Open$/.test(r))) pass('deleting the open project opens the next one', 'Java work')
else fail('deleting the open project opens the next one', JSON.stringify(rows))
const afterDelete = await explorerFiles()
if (afterDelete.some((f) => f.includes('Main.java')) && !afterDelete.some((f) => f.includes('main.py')))
  pass('the surviving project loaded its own files', afterDelete.join(', '))
else fail('the surviving project loaded its own files', afterDelete.join(', '))

// Deleted for real, not just hidden: a reload must not bring it back.
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1800)
rows = await menuRows()
if (!rows.some((r) => /^Python \(OOP starter\)/.test(r))) pass('deletion survived a reload (really removed from OPFS)')
else fail('deletion survived a reload', JSON.stringify(rows))

// ===================================== 7. rename, so the name is really stored
await runProjectCommand('Projects: Rename Project…', /^Rename Project…/)
await dialogFill('Renamed project')
await dialogConfirm('Rename')
await page.waitForTimeout(800)
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1800)
rows = await menuRows()
if (rows.some((r) => /^Renamed project.*Open$/.test(r))) pass('rename persisted across a reload', 'Renamed project')
else fail('rename persisted across a reload', JSON.stringify(rows))

const notable = errors.filter((e) => !/favicon/i.test(e) && !/404/.test(e) && !/Network error for null|Failed to fetch/.test(e))
if (!notable.length) pass('no unexpected console errors', `${errors.length} total (favicon + CheerpJ probes ignored)`)
else { fail('no unexpected console errors', `${notable.length}`); notable.slice(0, 6).forEach((e) => info(`  ! ${e.slice(0, 160)}`)) }

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
failed.forEach((f) => console.log(`FAILED: ${f[1]} :: ${f[2]}`))
await ctx.close()
process.exit(failed.length ? 1 : 0)
