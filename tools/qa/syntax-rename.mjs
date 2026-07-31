/* Deterministic candidate: a file renamed *into* a code extension. `renamePath`
 * only remaps the cached EditorState; nothing re-reads the language for it. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-ren-')), {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1100, height: 820 },
})
const page = ctx.pages()[0]
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const colours = () =>
  page.evaluate(() => {
    const spans = [...document.querySelectorAll('.cm-content .cm-line span')].filter((s) => s.textContent.trim())
    return { spans: spans.length, colours: new Set(spans.map((s) => getComputedStyle(s).color)).size }
  })
const row = (name) => page.locator('[role="treeitem"]').filter({ hasText: name }).first()
const newFile = async (name) => {
  await page.locator('aside[aria-label="Files"] button[aria-label="New file"]').click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(900)
}
const type = async (code) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type(code)
  await page.waitForTimeout(900)
}

await page.goto('http://localhost:8088/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })

const PY = 'def hello(name): return f"hi {name}"'

/* A: a plain .txt file, typed with Python, then renamed to .py -------------- */
await newFile('notes.txt')
await type(PY)
console.log('A1 notes.txt (no grammar expected):', JSON.stringify(await colours()))
await row('notes.txt').press('F2')
const field = page.locator('[role="tree"] input')
await field.fill('notes.py')
await field.press('Enter')
await page.waitForTimeout(1800)
const a = await colours()
console.log('A2 after renaming notes.txt → notes.py:', JSON.stringify(a), a.colours >= 3 ? 'COLOURED' : '← FLAT, no colours')
await page.screenshot({ path: join(SHOTS, 'syntax-rename-before.png') })

/* B: the same file after closing and reopening the tab --------------------- */
await page.locator('[role="tab"]').first().locator('button').click()
await page.waitForTimeout(500)
await row('notes.py').click()
await page.waitForTimeout(1200)
const b = await colours()
console.log('B  after closing the tab and reopening:', JSON.stringify(b), b.colours >= 3 ? 'COLOURED' : '← FLAT')

/* C: a fresh .py in the same session, as a control ------------------------- */
await newFile('control.py')
await type(PY)
const c = await colours()
console.log('C  control.py (fresh file, grammar cached):', JSON.stringify(c), c.colours >= 3 ? 'COLOURED' : '← FLAT')

console.log('\nerrors: ' + (errors.length ? JSON.stringify(errors) : 'none'))
await ctx.close()
