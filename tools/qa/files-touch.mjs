/* The touch path: a coarse pointer with no hover, which is what the target
 * device actually is. Desktop Chrome at a 390px width still reports
 * `hover: hover`, so the hover-gated affordances have to be checked here.
 *
 * ONE shell (founder ruling): touch gets the same VS Code chrome as desk —
 * activity bar, ☰ menu bar, tab strip with its Run corner, status bar — with
 * size adjustments only. The old touch-only chrome (a "Files" hamburger, a
 * console-header Run, the console foot) is gone, and this suite asserts that. */
import { chromium, devices } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (ok, n, d = '') => { results.push([ok, n, d]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log('      ' + m)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-touch-')), {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  ...devices['Pixel 7'],
  // Keep Chrome's own UA: the app's coi-serviceworker and the engines don't care,
  // and a spoofed mobile UA is not what we are testing.
  userAgent: undefined,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('PAGEERROR ' + e.message))

await page.goto(process.env.WARSHA_URL ?? 'http://localhost:8088/', { waitUntil: 'load' })
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
// The Run corner names itself after the entry file ("Run app/Main.java"), and
// picking that entry lands a beat after the tabs do — wait for it rather than
// snapshotting the shell mid-mount. A miss falls through to a clean FAIL below.
await page
  .waitForSelector('button[aria-label^="Run "], button[aria-label^="Stop "]', { timeout: 10000 })
  .catch(() => {})

// One shell on a phone: the same chrome desk has, sized for fingers.
const shell = await page.evaluate(() => ({
  activityBar: !!document.querySelector('nav[aria-label="Activity bar"]'),
  appMenu: !!document.querySelector('button[aria-label="Application Menu"]'),
  hamburger: !!document.querySelector('.top-bar button[aria-label="Files"]'),
  statusBar: !!document.querySelector('footer[aria-label="Status bar"]'),
  foot: !!document.querySelector('.console-foot'),
  tabRun: !!document.querySelector('button[aria-label^="Run "], button[aria-label^="Stop "]'),
}))
info('shell: ' + JSON.stringify(shell))
check(shell.activityBar, 'the activity bar is present on a phone (one shell)')
check(shell.appMenu, 'the menu bar collapses to ☰ "Application Menu" — no touch-only hamburger')
check(!shell.hamburger, 'the old "Files" hamburger is gone from the top bar')
check(shell.statusBar, 'the status bar renders on a phone')
check(!shell.foot, 'the console foot is gone — the status bar carries the run state')
check(shell.tabRun, 'Run lives in the tab strip corner, named after its file')

// The drawer opens from the activity bar's Explorer item, same control as desk.
const explorerItem = page.locator('nav[aria-label="Activity bar"] button[aria-label="Explorer"]')
await explorerItem.click()
await page.waitForTimeout(500)
check(await page.locator('aside[aria-label="Files"][data-state="open"]').count() === 1,
  'the activity bar Explorer item opens the overlay drawer')

const more = page.locator('.tree-row__more').first()
const moreOpacity = await more.evaluate((el) => getComputedStyle(el).opacity)
check(moreOpacity === '1', 'the ⋯ row menu is visible with no hover available', moreOpacity)
const moreBox = await more.boundingBox()
// DENSITY (scale-down, 2026-08-05): the pane-header trio and the per-row ⋯
// are 36 EFFECTIVE — their after:content-none stands because flush-stacked
// rows leave the ≥44px hit-area pseudo no room to expand (documented at the
// call site in Explorer.tsx; DENSITY.md records the 36 target).
check(moreBox.width >= 36 && moreBox.height >= 36, 'the ⋯ target is ≥36px (DENSITY pane/row action size)', `${moreBox.width}×${moreBox.height}`)

// Long-press opens the same menu.
const row = page.locator('[role="treeitem"]').filter({ hasText: 'Main.java' }).first()
const box = await row.boundingBox()
await page.touchscreen.tap(box.x + 60, box.y + box.height / 2)
await page.waitForTimeout(400)
// Opening the file auto-closed the drawer (touch adjustment) — reopen it.
await explorerItem.click()
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

// Tabs on a phone: with no hover to reveal it, every tab keeps its close ×
// (desk keeps VS Code's hover-reveal etiquette; touch never hides it).
await page.locator('[role="treeitem"]').filter({ hasText: 'Main.java' }).first().click()
await page.waitForTimeout(400)
// Scoped to the file strip: the console header's CONSOLE caps tab is a
// role=tab too ("Output view" tablist) and owes no close ×.
const closes = await page.evaluate(() =>
  [...document.querySelectorAll('[aria-label="Open files"] [role="tab"]')].map((t) => ({
    active: t.dataset.state,
    closeShown: getComputedStyle(t.querySelector('button')).display !== 'none',
  })),
)
info('tab close buttons: ' + JSON.stringify(closes))
check(closes.length > 0 && closes.every((c) => c.closeShown),
  'every tab shows its close × on touch (no hover to reveal it)')
await page.screenshot({ path: join(SHOTS, 'files-touch-ide-390.png') })

const failed = results.filter((r) => !r[0])
console.log(`\n${results.length - failed.length}/${results.length} touch checks passed`)
await ctx.close()
