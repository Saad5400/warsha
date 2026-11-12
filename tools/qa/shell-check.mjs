/* QA for the shell findings of the student-eye pass (QA-REPORT, non-notebook):
 * geometry and behaviour a screenshot shows but no other suite asserts.
 *
 *   - the cold-load splash ends when the app is ready (it used to hold 6-10 s)
 *   - phone: the template picker's cards stay inside the dialog (M7), en + ar
 *   - the hover docs card has its 8/12px padding and a 420px cap (M9)
 *   - Explorer ▸ Add files…: picker into the root, a clash (keep both / replace /
 *     skip), a folder's own menu, a desktop drop, a binary left out and named,
 *     and the phone's picker path (M11); File ▸ Import Project… says it replaces
 *   - a starter from Home never asks for a name, and Import from Home keeps Home
 *     behind its dialog (#24, #25)
 *   - the status bar names C# like the picker (#22)
 *   - phone, Arabic: the console tab label never truncates; the file name may (owner)
 *   - phone menus: group rules are visible, no keyboard shortcuts (#19)
 *   - Arabic Home and title bar: Latin names keep their own direction (#20)
 *
 * Engine-free: nothing here runs a program. Drives local Chrome against a dev
 * server or a served build:
 *
 *   cd app && npx vite --port 8190 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8190/ CHROME=... node shell-check.mjs
 *
 * WARSHA_PROFILES: where Chrome profiles go (default: the OS temp dir).
 */
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '')
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const SHOTS = process.env.WARSHA_SHOTS ?? join(import.meta.dirname, 'screenshots')
const PROFILES = process.env.WARSHA_PROFILES ?? tmpdir()
mkdirSync(SHOTS, { recursive: true })

let pass = 0, fail = 0
const check = async (label, fn) => {
  try {
    const ok = await fn()
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
    ok ? pass++ : fail++
  } catch (e) {
    console.log(`FAIL  ${label} :: ${e.message.split('\n')[0]}`)
    fail++
  }
}
const errs = []

async function open({ phone = false, lang = 'en', width = 1366, height = 768 } = {}) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(PROFILES, 'warsha-shell-')), {
    executablePath: CHROME,
    headless: true,
    ...(phone
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
      : { viewport: { width, height } }),
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('pageerror', (e) => errs.push(e.message))
  // A dev server's HMR socket must not reload the page mid-scenario.
  await page.routeWebSocket(/./, () => {})
  return { ctx, page, url: `${URL_}/?lang=${lang}` }
}
const until = async (page, fn, ms = 20000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (await fn().catch(() => false)) return true
    await page.waitForTimeout(100)
  }
  return false
}
const NEW_PROJECT = /^(New project|مشروع جديد)$/
async function fromStarter(page, lang = /Python|بايثون/, card = 1) {
  await page.getByRole('button', { name: NEW_PROJECT }).first().click({ timeout: 60000 })
  await page.locator('dialog[open]').getByRole('button', { name: lang }).first().click()
  await page.locator('dialog[open] .template-card').nth(card).click()
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  await page.waitForTimeout(500)
}
const toast = (page) => page.locator('[role="status"], [role="alert"]').allInnerTexts().then((t) => t.join(' | '))
/** Nothing but the activity bar may occupy its column (QA follow-up: a capture showed
 *  editor code and picker cards painted there in Arabic). Two readings: what is hit at
 *  points down the column, and every rendered element whose box enters it. The modal
 *  scrim, portalled dialogs/menus/toasts and the layout's own ancestors are allowed. */
/** Every file row's icon is a drawn glyph, never a bare letter or "·" (QA: a .csv
 *  showed an empty dark square on touch). Reads the VISIBLE badge, chip or icon. */
const fileIconsDrawn = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="treeitem"]:not([aria-expanded])')]
    return rows.length > 0 && rows.every((row) => [...row.querySelectorAll('svg')].some((svg) => svg.getBoundingClientRect().width >= 14))
  })
const railClean = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('nav')
    const r = nav.getBoundingClientRect()
    const allowed = (el) =>
      nav.contains(el) || el.contains(nav) || el.closest('[role="dialog"], [role="menu"], [role="status"], [data-radix-portal], [data-radix-popper-content-wrapper]') ||
      getComputedStyle(el).position === 'fixed'
    const bad = []
    for (let y = r.top + 4; y < r.bottom - 4; y += 24) {
      const hit = document.elementsFromPoint(r.left + r.width / 2, y).find((e) => !allowed(e) && e !== document.documentElement && e !== document.body)
      if (hit) bad.push('hit ' + hit.tagName + '.' + String(hit.className).slice(0, 40) + ' @' + Math.round(y))
    }
    for (const el of document.querySelectorAll('body *')) {
      if (allowed(el)) continue
      const b = el.getBoundingClientRect()
      if (!b.width || !b.height || getComputedStyle(el).visibility === 'hidden') continue
      if (b.left < r.right - 1 && b.right > r.left + 1 && b.top < r.bottom - 1 && b.bottom > r.top + 1) bad.push('box ' + el.tagName + '.' + String(el.className).slice(0, 40))
      if (bad.length > 5) break
    }
    return bad
  })

// ------------------------------------------------------------ splash (first visit)
{
  const { ctx, page, url } = await open()
  const t0 = Date.now()
  await page.goto(url)
  await page.getByRole('button', { name: NEW_PROJECT }).first().waitFor({ timeout: 60000 })
  const ready = Date.now() - t0
  const gone = await until(page, async () => (await page.locator('#warsha-splash').count()) === 0, 3000)
  const total = Date.now() - t0
  await check(`splash is gone within 0.8 s of the app being ready (ready ${ready} ms, gone ${total} ms)`, async () => gone && total - ready < 800)
  await ctx.close()
}

// ---------------------------------------------------- phone: picker fits (M7)
for (const lang of ['en', 'ar']) {
  const { ctx, page, url } = await open({ phone: true, lang })
  await page.goto(url)
  await page.getByRole('button', { name: NEW_PROJECT }).first().click({ timeout: 60000 })
  await check(`phone ${lang}: the language step does not scroll sideways`, async () =>
    page.evaluate(() => { const d = document.querySelector('dialog[open]'); return d.scrollWidth <= d.clientWidth + 1 }))
  await page.locator('dialog[open]').getByRole('button', { name: /Python|بايثون/ }).first().click()
  await page.waitForTimeout(300)
  await check(`phone ${lang}: every starter card (files + notebooks) sits inside the dialog`, async () =>
    page.evaluate(() => {
      const d = document.querySelector('dialog[open]')
      const box = d.getBoundingClientRect()
      const cards = [...d.querySelectorAll('.template-card')].map((c) => c.getBoundingClientRect())
      // Only real scroll containers: a truncated label is overflow:hidden by design.
      const scrollers = [d, ...d.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX))
      return cards.length >= 5 && cards.every((r) => r.left >= box.left && r.right <= box.right) && scrollers.length === 0
    }))
  await page.screenshot({ path: join(SHOTS, `shell-phone-picker-${lang}.png`) })
  await ctx.close()
}

// ------------------------------------------------ desktop editor + explorer
{
  const { ctx, page, url } = await open({ width: 1366, height: 768 })
  await page.goto(url)
  await fromStarter(page)

  // ---- M9: the hover card
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('print("hello")\n')
  const box = await page.locator('.cm-line').first().boundingBox()
  await page.mouse.move(box.x + 12, box.y + box.height / 2)
  await until(page, async () => (await page.locator('.cm-tooltip-hover .cm-tooltip-docs').count()) === 1, 5000)
  await check('hover card: 8px/12px padding, a widget border, ≤ 420px wide', async () =>
    page.evaluate(() => {
      const card = document.querySelector('.cm-tooltip-hover .cm-tooltip-docs')
      const host = card.closest('.cm-tooltip-hover')
      const cs = getComputedStyle(card)
      return cs.paddingTop === '8px' && cs.paddingLeft === '12px' && host.getBoundingClientRect().width <= 421 && getComputedStyle(host).borderTopWidth === '1px'
    }))
  await page.mouse.move(5, 300)

  // ---- M11: Add files
  const header = page.locator('.sidebar-project-row')
  const addBtn = header.getByRole('button', { name: /^Add files/ })
  await check('the Explorer pane header has an Add files button', async () => (await addBtn.count()) === 1)
  const csv = (name, body) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(body) })
  const pick = async (trigger, files) => {
    const chooser = page.waitForEvent('filechooser')
    await trigger()
    await (await chooser).setFiles(files)
    await page.waitForTimeout(500)
  }
  const exists = (path) => page.locator(`[role="treeitem"][data-path="${path}"]`).count().then((n) => n === 1)

  await pick(() => addBtn.click(), [csv('scores.csv', 'name,score\nali,90\n')])
  await check('Add files puts a CSV in the project, beside the starter', async () =>
    (await exists('scores.csv')) && (await exists('main.py')))
  await check('…and says so', async () => /Added 1 file/.test(await toast(page)))

  await pick(() => addBtn.click(), [csv('scores.csv', 'name,score\nsara,95\n')])
  const dlg = page.locator('dialog[open]')
  await check('a clash asks once: Keep both / Replace / Skip', async () =>
    /already exists/.test(await dlg.innerText()) &&
    (await dlg.getByRole('button', { name: 'Keep both' }).count()) === 1 &&
    (await dlg.getByRole('button', { name: 'Replace' }).count()) === 1 &&
    (await dlg.getByRole('button', { name: /^Skip/ }).count()) === 1)
  await check('the dialog is one footer row: Cancel, Skip, Replace, then Keep both (primary) at the end', async () =>
    page.evaluate(() => {
      const btns = [...document.querySelectorAll('dialog[open] button')].filter((b) => b.offsetParent)
      const ys = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)))
      const ok = ys.size === 1 && btns.map((b) => b.textContent.trim()).join('|') === 'Cancel|Skip|Replace|Keep both' && btns.at(-1).dataset.variant === 'primary'
      if (!ok) console.log(JSON.stringify(btns.map((b) => [b.textContent.trim(), Math.round(b.getBoundingClientRect().top), b.dataset.variant])))
      return ok
    }))
  await check('ltr: with a dialog open, nothing but the activity bar is in its column', async () => {
    const bad = await railClean(page)
    if (bad.length) console.log('   ' + bad.join('\n   '))
    return bad.length === 0
  })
  await page.screenshot({ path: join(SHOTS, 'shell-add-conflict-1366.png') })
  await dlg.getByRole('button', { name: 'Keep both' }).click()
  await page.waitForTimeout(500)
  await check('Keep both adds "scores (2).csv" and keeps the original', async () =>
    (await exists('scores (2).csv')) && (await exists('scores.csv')))

  await pick(() => addBtn.click(), [csv('scores.csv', 'name,score\nomar,70\n')])
  await dlg.getByRole('button', { name: 'Replace' }).click()
  await page.waitForTimeout(500)
  await check('Replace overwrites the file in place (the open tab shows the new text)', async () =>
    (await page.locator('.cm-content').first().innerText()).includes('omar') && !(await exists('scores (3).csv')))

  await pick(() => addBtn.click(), [csv('scores.csv', 'x\n')])
  await dlg.getByRole('button', { name: /^Skip/ }).click()
  await page.waitForTimeout(400)
  await check('Skip leaves everything as it was', async () => !(await exists('scores (3).csv')) && /Nothing was added/.test(await toast(page)))

  // A folder's own menu adds into that folder.
  await header.getByRole('button', { name: 'New folder' }).click()
  await page.keyboard.insertText('data')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await page.locator('[role="treeitem"][data-path="data"]').click({ button: 'right' })
  await pick(() => page.getByRole('menuitem', { name: 'Add files…' }).click(), [
    csv('passed.csv', 'name\nali\n'),
    { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d, 0, 0]) },
  ])
  await check('a folder\'s menu adds into that folder', async () => exists('data/passed.csv'))
  await check('a binary is left out and named, not silently dropped', async () =>
    !(await exists('data/logo.png')) && /left out/.test(await toast(page)))

  // The header button follows the folder last worked in.
  await check('the header button now targets that folder', async () =>
    (await header.getByRole('button', { name: 'Add files to data' }).count()) === 1)

  // A drop from the desktop onto a folder row.
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(new File(['a,b\n1,2\n'], 'dropped.csv', { type: 'text/csv' }))
    const row = document.querySelector('[role="treeitem"][data-path="data"]')
    const r = row.getBoundingClientRect()
    window.__drop = { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2, dataTransfer: dt }
    row.dispatchEvent(new DragEvent('dragenter', window.__drop))
    row.dispatchEvent(new DragEvent('dragover', window.__drop))
  })
  await page.waitForTimeout(200)
  const dropped = await page.evaluate(() => {
    const row = document.querySelector('[role="treeitem"][data-path="data"]')
    const lit = row.getAttribute('data-drop') === 'true'
    const hint = document.body.innerText.includes('Drop to add to data')
    return { lit, hint }
  })
  await page.screenshot({ path: join(SHOTS, 'shell-add-drop-hover-1366.png') })
  await page.evaluate(() => document.querySelector('[role="treeitem"][data-path="data"]').dispatchEvent(new DragEvent('drop', window.__drop)))
  await page.waitForTimeout(600)
  await check('desk: every file row has a drawn icon (csv included)', () => fileIconsDrawn(page))
  await check('a desktop drag lights the folder and says where the drop lands', async () => dropped.lit && dropped.hint)
  await check('dropping files on a folder adds them there', async () => exists('data/dropped.csv'))
  await page.screenshot({ path: join(SHOTS, 'shell-add-files-tree-1366.png') })

  // File ▸ Import Project… names what it does.
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Import Project…' }).click()
  await page.waitForTimeout(300)
  await check('File ▸ Import Project… says it swaps the project out, and where Add files lives', async () => {
    const t = await page.locator('dialog[open]').innerText()
    return /Import a project/.test(t) && /Add Files…|Add files…/.test(t) && /replaces the \d+ files?/.test(t)
  })
  await page.screenshot({ path: join(SHOTS, 'shell-import-project-dialog-1366.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ---- #25: a second project from a starter never asks for a name; #24 Import from Home.
  await page.locator('[aria-label="Manage"]').first().waitFor()
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New Project…' }).click()
  await page.locator('dialog[open]').getByRole('button', { name: /^C#/ }).first().click()
  await page.locator('dialog[open] .template-card').first().click()
  await page.waitForTimeout(1200)
  await check('a second project from a starter opens straight away, no name prompt', async () =>
    (await page.locator('dialog[open]').count()) === 0 && (await page.locator('[role="tab"]', { hasText: '.cs' }).count()) >= 1)
  await check('the status bar names C# like the picker ("C# · .NET 9", not "CS")', async () =>
    /C# · \.NET 9/.test(await page.locator('.status-bar').innerText()))

  await page.goto(url) // Home
  await page.getByRole('button', { name: NEW_PROJECT }).first().click({ timeout: 60000 })
  await page.locator('dialog[open]').getByRole('button', { name: /Import files or a \.zip/ }).click()
  await page.waitForTimeout(400)
  await check('Import from Home keeps Home behind its dialog (not the last project)', async () =>
    (await page.locator('dialog[open]').count()) === 1 && (await page.locator('.cm-editor').count()) === 0)
  await page.screenshot({ path: join(SHOTS, 'shell-home-import-1366.png') })
  await ctx.close()
}

// ------------------------------------------- desktop, Arabic: the rail column
{
  const { ctx, page, url } = await open({ lang: 'ar', width: 1366, height: 768 })
  await page.goto(url)
  await fromStarter(page)
  await check('rtl: nothing but the activity bar is in its column', async () => {
    const bad = await railClean(page)
    if (bad.length) console.log('   ' + bad.join('\n   '))
    return bad.length === 0
  })
  const btn = page.locator('.sidebar-project-row').getByRole('button', { name: /^إضافة ملفات/ })
  for (let i = 0; i < 2; i++) {
    const chooser = page.waitForEvent('filechooser')
    await btn.click()
    await (await chooser).setFiles([{ name: 'scores.csv', mimeType: 'text/csv', buffer: Buffer.from('a\n' + i + '\n') }])
    await page.waitForTimeout(500)
  }
  await check('rtl: with the clash dialog open, still nothing but the activity bar in its column', async () => {
    const bad = await railClean(page)
    if (bad.length) console.log('   ' + bad.join('\n   '))
    return bad.length === 0
  })
  await check('rtl: the clash dialog is one footer row, Keep both at the trailing (left) edge', async () =>
    page.evaluate(() => {
      const btns = [...document.querySelectorAll('dialog[open] button')].filter((b) => b.offsetParent)
      const ys = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)))
      const primary = btns.find((b) => b.dataset.variant === 'primary')
      return ys.size === 1 && btns.length === 4 && Math.min(...btns.map((b) => b.getBoundingClientRect().left)) === primary.getBoundingClientRect().left
    }))
  await page.waitForTimeout(4500) // toasts gone: a clean frame for the eye
  await page.screenshot({ path: join(SHOTS, 'shell-add-conflict-ar-1366.png') })
  await ctx.close()
}

// ------------------------------------------------- phone, Arabic: chrome
{
  const { ctx, page, url } = await open({ phone: true, lang: 'ar' })
  await page.goto(url)
  await fromStarter(page, /C#/, 0)
  await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')) // settle
  await check('phone ar: the console tab label is whole, the file name may ellipsize', async () =>
    page.evaluate(() => {
      const panel = document.querySelector('section[aria-label]:has([role="tablist"])') ?? document
      const tab = panel.querySelector('[role="tablist"] [role="tab"]')
      const label = tab.querySelector('span')
      const hdr = tab.closest('[role="tablist"]').parentElement.getBoundingClientRect()
      const t = tab.getBoundingClientRect()
      return label.scrollWidth <= label.clientWidth + 1 && t.left >= hdr.left - 1 && t.right <= hdr.right + 1
    }))
  await page.screenshot({ path: join(SHOTS, 'shell-phone-ar-console-header.png') })

  // Explorer ▸ Add files on a phone is the OS picker.
  await page.locator('[aria-label="Explorer"], [aria-label="المستكشف"]').first().click()
  await page.waitForTimeout(500)
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 })
  await page.locator('.sidebar-project-row').getByRole('button', { name: /^إضافة ملفات/ }).tap()
  await check('phone: Add files opens the device picker', async () => !!(await chooser))
  await (await chooser).setFiles([{ name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('a\n1\n') }])
  await page.waitForTimeout(600)
  await check('phone: every file row has a drawn icon (csv included), not a dot', () => fileIconsDrawn(page))
  await check('phone: the picked file lands in the project', async () =>
    (await page.locator('[role="treeitem"][data-path="data.csv"]').count()) === 1)

  // A clash on a phone: the four answers stack full width, Keep both on top.
  // (One added file opens in the editor, which closes the drawer: reopen it.)
  if ((await page.locator('aside[data-state="open"]').count()) === 0) {
    await page.locator('[aria-label="Explorer"], [aria-label="المستكشف"]').first().click()
    await page.waitForTimeout(600)
  }
  await page.screenshot({ path: join(SHOTS, 'shell-phone-ar-before-reclash.png') })
  const again = page.waitForEvent('filechooser', { timeout: 5000 })
  await page.locator('.sidebar-project-row').getByRole('button', { name: /^إضافة ملفات/ }).tap()
  await (await again).setFiles([{ name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('a\n2\n') }])
  await page.waitForTimeout(600)
  await check('phone: the clash answers stack full width, Keep both on top, Cancel last', async () =>
    page.evaluate(() => {
      const d = document.querySelector('dialog[open]').getBoundingClientRect()
      const btns = [...document.querySelectorAll('dialog[open] button')].filter((b) => b.offsetParent).map((b) => [b.getBoundingClientRect(), b])
      btns.sort((a, b) => a[0].top - b[0].top)
      const widths = new Set(btns.map(([r]) => Math.round(r.width)))
      return btns.length === 4 && widths.size === 1 && btns[0][1].dataset.variant === 'primary' && /إلغاء/.test(btns[3][1].textContent) && btns.every(([r]) => r.left >= d.left && r.right <= d.right)
    }))
  await page.screenshot({ path: join(SHOTS, 'shell-phone-ar-add-conflict.png') })
  await page.getByRole('button', { name: 'الاحتفاظ بالاثنين' }).tap()
  await page.waitForTimeout(500)

  // A row menu on touch: visible group rules, no shortcut hints.
  await page.locator('[role="treeitem"][data-path="data.csv"]').dispatchEvent('contextmenu')
  await page.waitForTimeout(400)
  await check('phone menus: group separators are visible and no shortcut is shown', async () =>
    page.evaluate(() => {
      const menu = [...document.querySelectorAll('[role="menu"]')].pop()
      const seps = [...menu.querySelectorAll('[role="separator"]')]
      const sepOk = seps.length > 0 && seps.every((s) => getComputedStyle(s).borderTopColor === 'rgb(69, 69, 78)')
      const hints = [...menu.querySelectorAll('[role="menuitem"] span')].filter((s) => /F2/.test(s.textContent) && s.offsetParent)
      return sepOk && hints.length === 0
    }))
  await page.screenshot({ path: join(SHOTS, 'shell-phone-ar-row-menu.png') })
  await page.keyboard.press('Escape')

  // #20: Latin names keep their own direction in the Arabic title.
  await check('ar: the window title carries dir="auto"', async () =>
    (await page.locator('.top-bar__title[dir="auto"]').count()) === 1)
  await ctx.close()
}

// ------------------------------- tree direction, chevrons, non-text files
// The tree stays LTR in both languages ("files stay LTR", index.css): icon and
// twistie at the left, ⋯ at the right, the active rail on the left. Its twisties
// follow the TREE's direction, not the page's: right when closed, DOWN when open,
// in Arabic too (a mirrored-then-rotated glyph pointed UP). A file that is not
// text gets a read-only face, never CodeMirror.
for (const [lang, phone] of [['en', false], ['ar', false], ['ar', true]]) {
  const tag = `${lang}${phone ? ' phone' : ''}`
  const rtl = lang === 'ar'
  const { ctx, page, url } = await open({ lang, phone, width: 1366, height: 768 })
  await page.goto(url)
  await fromStarter(page)
  const showTree = async () => {
    if ((await page.locator('aside[data-state="open"]').count()) === 0 && phone) {
      await page.locator('[aria-label="Explorer"], [aria-label="المستكشف"]').first().click()
      await page.waitForTimeout(600)
    }
  }
  await showTree()
  await page.locator('.sidebar-project-row').getByRole('button', { name: /^(New folder|مجلّد جديد)$/ }).click()
  await page.keyboard.insertText('data')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  // Where a right-pointing chevron ends up after the row's scale + rotate.
  const chevronPoints = () =>
    page.evaluate(() => {
      const el = document.querySelector('[role="treeitem"][data-path="data"] .tree-row__chevron')
      const cs = getComputedStyle(el)
      const sx = cs.scale && cs.scale !== 'none' ? parseFloat(cs.scale.split(' ')[0]) : 1
      const deg = cs.rotate && cs.rotate !== 'none' ? parseFloat(cs.rotate) : 0
      const m = cs.transform && cs.transform !== 'none' ? new DOMMatrix(cs.transform) : new DOMMatrix()
      const a = (deg * Math.PI) / 180
      let x = sx * Math.cos(a), y = sx * Math.sin(a)
      const p = m.transformPoint({ x, y }), o = m.transformPoint({ x: 0, y: 0 })
      x = p.x - o.x; y = p.y - o.y
      return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up'
    })
  await page.waitForTimeout(300)
  await check(`${tag}: an open folder's twistie points down`, async () => (await chevronPoints()) === 'down')
  await page.locator('[role="treeitem"][data-path="data"]').click()
  await page.waitForTimeout(300)
  await check(`${tag}: a closed folder's twistie points right (the tree's direction)`, async () => (await chevronPoints()) === 'right')
  await check(`${tag}: rows run left to right (icon left, ⋯ right, rail left) in both languages`, async () =>
    page.evaluate(() => {
      const rtl = false
      const row = document.querySelector('[role="treeitem"][data-path="main.py"]')
      const label = row.querySelector('.tree-row__label').getBoundingClientRect()
      const icon = [...row.querySelectorAll('svg')].find((s) => s.getBoundingClientRect().width >= 14).getBoundingClientRect()
      const more = row.querySelector('button')?.getBoundingClientRect()
      const c = (r) => r.left + r.width / 2
      const order = rtl ? c(icon) > c(label) && (!more || !more.width || c(more) < c(label)) : c(icon) < c(label) && (!more || !more.width || c(more) > c(label))
      const rail = getComputedStyle(row).borderLeftWidth !== '0px'
      return order && rail && getComputedStyle(row.closest('[role="tree"]')).direction === 'ltr'
    }))
  if (rtl) {
    // An Arabic name inside the LTR column still shapes and orders as Arabic.
    await page.locator('.sidebar-project-row').getByRole('button', { name: /^(New file|ملف جديد)/ }).first().click()
    await page.keyboard.insertText('تمرين.py')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    await showTree()
    await check(`${tag}: an Arabic file name sits in the tree as typed`, async () =>
      (await page.locator('[role="treeitem"][data-path="تمرين.py"] .tree-row__label').innerText()) === 'تمرين.py')
  }
  // A non-text file: photo.png (made as a file) and a real SVG.
  await page.locator('.sidebar-project-row').getByRole('button', { name: /^(New file|ملف جديد)/ }).first().click()
  await page.keyboard.insertText('photo.png')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  await check(`${tag}: a .png opens a read-only note, not an editor with line 1`, async () =>
    (await page.locator('.file-not-text[data-view="image"]').isVisible()) && !(await page.locator('.cm-content').first().isVisible()))
  await check(`${tag}: the status bar says ${rtl ? 'صورة' : 'Image'}, not PNG`, async () => {
    const t = await page.locator('.status-bar').innerText()
    return (rtl ? /صورة/ : /\bImage\b/).test(t) && !/\bPNG\b/.test(t)
  })
  await page.screenshot({ path: join(SHOTS, `shell-nontext-png-${lang}-${phone ? 'phone' : '1366'}.png`) })
  await showTree()
  const chooser = page.waitForEvent('filechooser')
  await page.locator('.sidebar-project-row').getByRole('button', { name: /^(Add files|إضافة ملفات)/ }).click()
  await (await chooser).setFiles([{ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#519aba"/></svg>') }])
  await page.waitForTimeout(800)
  await check(`${tag}: an SVG shows as a picture`, async () =>
    page.evaluate(() => { const i = document.querySelector('.file-not-text img'); return !!i && i.complete && i.naturalWidth > 0 }))
  await check(`${tag}: breadcrumb separators point along the path (right)`, async () =>
    page.evaluate(() => {
      const sep = document.querySelector('.breadcrumbs svg')
      if (!sep) return false
      const cs = getComputedStyle(sep)
      return !(cs.scale && cs.scale !== 'none' && parseFloat(cs.scale) < 0)
    }))
  await page.screenshot({ path: join(SHOTS, `shell-nontext-svg-${lang}-${phone ? 'phone' : '1366'}.png`) })
  await showTree()
  await page.screenshot({ path: join(SHOTS, `shell-tree-${lang}-${phone ? 'phone' : '1366'}.png`) })
  await ctx.close()
}

console.log(errs.length ? `page errors:\n${errs.join('\n')}` : 'no page errors')
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
