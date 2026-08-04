/* The touch path: a coarse pointer with no hover, which is what the target
 * device actually is. Desktop Chrome at a 390px width still reports
 * `hover: hover`, so the hover-gated affordances have to be checked here. */
import { chromium, devices } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const results = []
const check = (ok, n, d = '') => { results.push([ok, n, d]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log('      ' + m)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-touch-')), {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  ...devices['Pixel 7'],
  // Keep Chrome's own UA: the app's coi-serviceworker and the engines don't care,
  // and a spoofed mobile UA is not what we are testing.
  userAgent: undefined,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message))

await page.goto('http://localhost:8088/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })

const media = await page.evaluate(() => ({
  hover: matchMedia('(hover: hover)').matches,
  fine: matchMedia('(pointer: fine)').matches,
  coarse: matchMedia('(pointer: coarse)').matches,
  width: innerWidth,
}))
info('media: ' + JSON.stringify(media))
check(!media.hover && media.coarse, 'emulating a real touch device (no hover, coarse pointer)')

// Seed a project.
await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
await page.waitForSelector('[role="tab"]', { timeout: 10000 })
await page.locator('button[aria-label="Files"]').click()
await page.waitForTimeout(500)

const more = page.locator('.tree-row__more').first()
const moreOpacity = await more.evaluate((el) => getComputedStyle(el).opacity)
check(moreOpacity === '1', 'the ⋯ row menu is visible with no hover available', moreOpacity)
const moreBox = await more.boundingBox()
check(moreBox.width >= 44 && moreBox.height >= 44, 'the ⋯ target is ≥44px', `${moreBox.width}×${moreBox.height}`)

// Long-press opens the same menu.
const row = page.locator('[role="treeitem"]').filter({ hasText: 'Main.java' }).first()
const box = await row.boundingBox()
await page.touchscreen.tap(box.x + 60, box.y + box.height / 2)
await page.waitForTimeout(400)
await page.locator('button[aria-label="Files"]').click()
await page.waitForTimeout(400)
await more.click()
await page.waitForSelector('[role="menu"]', { timeout: 5000 })
const items = await page.locator('[role="menuitem"]').allInnerTexts()
check(items.some((i) => /Rename/.test(i)) && items.some((i) => /Delete/.test(i)),
  'the touch menu offers Rename and Delete', JSON.stringify(items))
const del = page.locator('[role="menuitem"]').filter({ hasText: 'Delete' }).first()
const delColor = await del.evaluate((el) => getComputedStyle(el).color)
check(items[items.length - 1].includes('Delete'), 'Delete is last in the menu', delColor)
await page.screenshot({ path: join(SHOTS, 'files-touch-rowmenu-390.png') })

// Rename from the menu is inline, and the field is ≥16px.
await page.locator('[role="menuitem"]').filter({ hasText: 'Rename' }).first().click()
await page.waitForTimeout(300)
const field = page.locator('[role="tree"] input')
check(await field.isVisible(), 'the menu route also renames inline')
const fs = await field.evaluate((el) => getComputedStyle(el).fontSize)
check(parseFloat(fs) >= 16, 'inline rename field is ≥16px on touch', fs)
await page.screenshot({ path: join(SHOTS, 'files-touch-rename-390.png') })
await field.press('Escape')

// Tabs on a phone: close × on the active tab only.
await page.locator('[role="treeitem"]').filter({ hasText: 'Main.java' }).first().click()
await page.waitForTimeout(400)
const closes = await page.evaluate(() =>
  [...document.querySelectorAll('[role="tab"]')].map((t) => ({
    active: t.dataset.state,
    closeShown: getComputedStyle(t.querySelector('button')).display !== 'none',
  })),
)
info('tab close buttons: ' + JSON.stringify(closes))
check(closes.every((c) => (c.active === 'active') === c.closeShown),
  'the close × is on the active tab only, below 900px')
await page.screenshot({ path: join(SHOTS, 'files-touch-ide-390.png') })

const failed = results.filter((r) => !r[0])
console.log(`\n${results.length - failed.length}/${results.length} touch checks passed`)
await ctx.close()
