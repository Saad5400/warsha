/* P0 repro: does Python code get syntax colours?
 * Walks the exact user path (New file → main.py → type), then the paths that
 * involve switching away and back, which is where a lazily-loaded grammar can
 * be lost. Reports the number of coloured spans and the distinct colours. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-syn-')), {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1100, height: 820 },
})
const page = ctx.pages()[0]
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

/** Distinct text colours among .cm-line spans — the signature of highlighting. */
const tokens = () =>
  page.evaluate(() => {
    const spans = [...document.querySelectorAll('.cm-content .cm-line span')]
    const colours = new Map()
    for (const s of spans) {
      if (!s.textContent.trim()) continue
      const c = getComputedStyle(s).color
      colours.set(c, (colours.get(c) ?? 0) + 1)
    }
    return { spans: spans.length, colours: [...colours.entries()].sort((a, b) => b[1] - a[1]) }
  })

const report = async (label) => {
  const t = await tokens()
  const distinct = t.colours.length
  console.log(`${distinct >= 3 ? 'COLOURED' : 'FLAT    '}  ${label} :: ${t.spans} spans, ${distinct} colours ${JSON.stringify(t.colours.slice(0, 4))}`)
  return distinct
}

const newFile = async (name) => {
  // The header icon button, not the empty state's ghost button of the same name.
  await page.locator('aside[aria-label="Files"] button[aria-label="New file"]').click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(900)
}
const openRow = async (name) => {
  await page.locator('[role="treeitem"]').filter({ hasText: name }).first().click()
  await page.waitForTimeout(700)
}
const typeCode = async (lines) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  for (const l of lines) {
    await page.keyboard.type(l)
    await page.keyboard.press('Enter')
    // closeBrackets/auto-indent make multi-line typing lossy; one line is enough
    // for a colour check, so keep each line self-contained.
    await page.keyboard.press('Home')
  }
  await page.waitForTimeout(600)
}

await page.goto('http://localhost:8088/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })

/* ---- 1. the founder's path: brand-new project, create main.py by hand ---- */
await newFile('main.py')
await typeCode(['def hello(name): return f"hi {name}"'])
console.log('\n--- 1. first file of a fresh session, created by hand')
const a = await report('main.py, just typed')
await page.screenshot({ path: join(SHOTS, 'syntax-1-first-py.png') })

/* ---- 2. a second Python file in the same session ------------------------- */
await newFile('other.py')
// Long enough that a highlighted line really does show 3+ colours; the earlier
// `class Shape: pass` was coloured but only had two, which read as a failure.
await typeCode(['def area(self, w): return w * 2  # comment'])
console.log('\n--- 2. second .py in the same session (grammar already cached)')
const b = await report('other.py')

/* ---- 3. switch away and back — the cached-state path -------------------- */
await openRow('main.py')
console.log('\n--- 3. back to main.py from the tab/explorer (restored state)')
const c = await report('main.py after switching away and back')
await page.screenshot({ path: join(SHOTS, 'syntax-3-return.png') })

/* ---- 4. Java, same three paths ------------------------------------------ */
await newFile('Demo.java')
await typeCode(['public class Demo { void go() { String s = "x"; } }'])
console.log('\n--- 4. Java')
const d = await report('Demo.java, just typed')
await openRow('main.py')
await page.waitForTimeout(400)
await openRow('Demo.java')
const e = await report('Demo.java after switching away and back')

/* ---- 5. reload with tabs restored from prefs ---------------------------- */
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(3000)
await page.waitForSelector('.cm-content', { timeout: 20000 })
console.log('\n--- 5. after a reload, whichever file prefs restores')
const f = await report('restored file')
await page.screenshot({ path: join(SHOTS, 'syntax-5-reload.png') })

console.log('\nconsole errors: ' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none'))
console.log(`\nSUMMARY  fresh=${a} second=${b} returned=${c} java=${d} javaReturned=${e} reloaded=${f}`)
await ctx.close()
