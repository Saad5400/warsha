/* Notebook visuals: every cell state, shot at device scale 2 (docs/design/NOTEBOOK.md).
 *
 *   cd app && npx vite --port 8120 --strictPort --host 127.0.0.1
 *   cd tools/qa && TAG=after CHROME=... node notebook-visuals.mjs
 *
 * Desktop and phone, English (LTR) and Arabic (RTL). One notebook per run,
 * built from the empty starter. Files:
 *   screenshots/nbvis/<TAG>/<surface>-<lang>-<state>.png
 * The geometry that keeps these right is asserted in notebook-check.mjs. */
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8120/'
const TAG = process.env.TAG ?? 'after'
const DIR = new URL(`./screenshots/nbvis/${TAG}/`, import.meta.url).pathname
mkdirSync(DIR, { recursive: true })

const CODE = {
  output: 'scores = [72, 88, 95]\nfor s in scores:\n    print(s, s >= 80)',
  long: 'for i in range(400):\n    print("line", i)',
  error: 'def ratio(a, b):\n    return a / b\n\nratio(1, 0)',
  table: 'import pandas as pd\npd.DataFrame({"name": ["Layla", "Omar", "Sara"], "score": [92, 68, 85]})',
  image: 'import matplotlib.pyplot as plt\nplt.figure(figsize=(4, 2.5))\nplt.plot([1, 3, 2, 4])\nplt.show()',
  sleep: 'import time\ntime.sleep(6)',
}

async function run(surface, lang) {
  const phone = surface === 'phone'
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'nbvis-')), {
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    headless: true,
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    ...(phone ? { isMobile: true, hasTouch: true } : {}),
  })
  const page = ctx.pages()[0]
  await page.routeWebSocket(/./, () => {})
  const name = (s) => join(DIR, `${surface}-${lang}-${s}.png`)
  const shot = (s, target = page) => target.screenshot({ path: name(s) })
  const idle = () =>
    page.waitForFunction(() => {
      const k = document.querySelector('[data-kernel]')
      return k?.getAttribute('data-kernel') === 'idle' && !k.hasAttribute('data-busy')
    }, null, { timeout: 180000 })

  await page.goto(`${URL_}?lang=${lang}`)
  const btn = page.locator('button', { hasText: lang === 'en' ? /^New project$/ : /مشروع جديد/ }).first()
  await btn.waitFor({ timeout: 60000 })
  await btn.click()
  await page.locator('dialog[open]').getByRole('button', { name: /^Python/ }).first().click()
  await page.locator('.template-card').filter({ hasText: lang === 'en' ? 'Empty notebook' : 'دفتر فارغ' }).first().click()
  await page.waitForSelector('.notebook-view [data-cell-id]')
  await page.waitForTimeout(1500)
  const cells = () => page.locator('.notebook-view [data-cell-id]')
  const cell = (i) => cells().nth(i)
  /** Put `code` in a new code cell after the last one (or the first, empty one) and leave the caret in it. */
  let used = 0
  const newCode = async (code) => {
    if (used++ > 0) {
      await page.keyboard.press('Escape')
      await cells().last().focus()
      await page.keyboard.press('b')
      await page.waitForTimeout(300)
    } else await cell(0).locator('.cm-content').click()
    if (code) await page.keyboard.insertText(code)
    // A fixed index, not .last(): Playwright locators are lazy, and more cells come after.
    return cell((await cells().count()) - 1)
  }

  await shot('toolbar', page.locator('.notebook-toolbar'))
  const empty = await newCode('')
  await page.waitForTimeout(300)
  await shot('code-empty', empty)

  await page.keyboard.insertText(CODE.output)
  await page.keyboard.press('Control+Enter')
  await idle()
  await page.waitForTimeout(400)
  await shot('code-output-editing', empty)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await shot('code-output-selected', empty)

  for (const [state, code] of [['long-output', CODE.long], ['error', CODE.error], ['dataframe', CODE.table], ['image', CODE.image]]) {
    const c = await newCode(code)
    await page.keyboard.press('Control+Enter')
    await idle()
    await page.waitForTimeout(700)
    await page.keyboard.press('Escape')
    await c.scrollIntoViewIfNeeded()
    await shot(state, c)
  }
  // Long output, collapsed.
  const longCell = cell(1)
  await longCell.scrollIntoViewIfNeeded()
  await longCell.focus()
  await page.keyboard.press('o')
  await page.waitForTimeout(300)
  await shot('long-output-collapsed', longCell)
  await page.keyboard.press('o')

  // Markdown: editing, then rendered.
  await page.keyboard.press('Escape')
  await cells().last().focus()
  await page.keyboard.press('b')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('m')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.keyboard.insertText(lang === 'en' ? '## Notes\n\nScores of **80** or more pass. Use `print()` to check.' : '## ملاحظات\n\nالدرجة **80** فما فوق ناجحة. استخدم `print()` للتحقق.')
  const md = cell((await cells().count()) - 1)
  await shot('markdown-editing', md)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await md.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(500)
  await md.scrollIntoViewIfNeeded()
  await shot('markdown-rendered', md)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(250)
  await shot('code-output-unselected', cell(0))

  // Running and queued: two sleeping cells, the first run, the second queued behind it.
  const r1 = await newCode(CODE.sleep)
  const r2 = await newCode(CODE.sleep)
  await page.keyboard.press('Escape')
  await r1.focus()
  await page.keyboard.press('Control+Enter')
  await r2.focus()
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(1200)
  await r1.scrollIntoViewIfNeeded()
  await shot('running', r1)
  await shot('queued', r2)
  await idle().catch(() => {})
  await page.waitForTimeout(300)

  // Completion popup and hover docs in a cell near the bottom of the screen.
  const comp = await newCode('')
  await comp.scrollIntoViewIfNeeded()
  await page.keyboard.type('prin', { delay: 60 })
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(300)
  await shot('completion')
  await page.keyboard.press('Escape')
  if (!phone) {
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText('print(len([1, 2]))')
    const line = await comp.locator('.cm-line').first().boundingBox()
    await page.mouse.move(line.x + 36, line.y + line.height / 2)
    await page.waitForSelector('.cm-tooltip-docs', { timeout: 3000 }).catch(() => {})
    await page.waitForTimeout(300)
    await shot('hover-docs')

    // Hover over the gap between the first two cells: the insert affordance.
    await page.keyboard.press('Escape')
    await cell(0).scrollIntoViewIfNeeded()
    const a = await cell(0).boundingBox()
    const b = await cell(1).boundingBox()
    await page.mouse.move(a.x + a.width / 2, (a.y + a.height + b.y) / 2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: name('hover-insert'), clip: { x: a.x - 40, y: a.y + a.height - 80, width: a.width + 60, height: b.y - (a.y + a.height) + 160 } })
    // Hover over a cell that is not selected.
    await page.mouse.move(a.x + a.width / 2, a.y + 14)
    await page.waitForTimeout(300)
    await shot('hover-cell', cell(0))
  }
  await cell(0).scrollIntoViewIfNeeded()
  await shot('full')
  await ctx.close()
}

// ONLY=desk-en (comma-separated) shoots a subset while iterating.
const only = process.env.ONLY?.split(',')
for (const surface of ['desk', 'phone']) for (const lang of ['en', 'ar']) if (!only || only.includes(`${surface}-${lang}`)) await run(surface, lang)
console.log('notebook visuals written to ' + DIR)
