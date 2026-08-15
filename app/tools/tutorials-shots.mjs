/**
 * Tutorials screenshot harness.
 *
 * Drives the REAL running app into each surface a tutorial teaches, applies a
 * plain CSS highlight to the control the step points at, and captures a full
 * screenshot — once per language, so the Arabic shots show the real RTL UI.
 * Output: app/public/tutorials/<shot>.<lang>.png  (served as a static asset).
 *
 *   cd app && VITE_WARSHA_API=http://127.0.0.1:9/ npx vite --port 5199 --strictPort
 *   node tools/tutorials-shots.mjs
 *
 * A dummy VITE_WARSHA_API makes the account/sign-in UI render (the calls fail
 * harmlessly — we only screenshot the forms). Language engines (Python, Java)
 * download from a CDN on first run; where that CDN is unreachable, the run
 * group falls back to a Web project, which executes entirely in the browser.
 *
 * Env: WARSHA_URL, WARSHA_LANGS (default "en,ar"), WARSHA_ONLY (regex subset).
 * Every shot is wrapped: a miss is logged and skipped, never fatal.
 */
import pw from '../../tools/qa/node_modules/playwright-core/index.js'
const { chromium } = pw
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'public', 'tutorials')
const EXE = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:5199/'
const LANGS = (process.env.WARSHA_LANGS ?? 'en,ar').split(',').filter(Boolean)
const ONLY = process.env.WARSHA_ONLY ? new RegExp(process.env.WARSHA_ONLY) : null
const DSF = Number(process.env.WARSHA_DSF ?? 1.5)

mkdirSync(OUT, { recursive: true })

const HL_CSS = `.tut-hl { position: relative !important; z-index: 40 !important;
  outline: 3px solid var(--accent) !important; outline-offset: 3px !important;
  border-radius: 10px !important;
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 26%, transparent),
              0 0 26px 6px color-mix(in srgb, var(--accent) 45%, transparent) !important; }`

const log = (m) => console.log(m)
const misses = []
let captured = 0
let page

const RUN_RE = /^(Run|تشغيل)/
const NEWPROJ_RE = /(New project|مشروع جديد)/
const NEWFILE_RE = /(New file|ملف جديد)/
const MORE_RE = /^(More|المزيد)$/
const CREATE_RE = /(Create|إنشاء)/

async function ready() {
  await page.waitForFunction(() => {
    const s = document.getElementById('warsha-splash')
    return !s || s.classList.contains('warsha-splash--done') || getComputedStyle(s).display === 'none'
  }, { timeout: 25000 })
}

async function style() { await page.addStyleTag({ content: HL_CSS }) }
async function clearHl() { await page.evaluate(() => document.querySelectorAll('.tut-hl').forEach((el) => el.classList.remove('tut-hl'))) }

/** Highlight a Locator (its `up`-th ancestor). Returns false if not found. */
async function hl(locator, up = 0) {
  await clearHl()
  const loc = locator.first()
  if ((await loc.count()) === 0) return false
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.evaluate((el, n) => { let t = el; for (let i = 0; i < n; i++) t = t.parentElement ?? t; t.classList.add('tut-hl') }, up)
  return true
}

async function snap(name, lang) {
  await page.waitForTimeout(180)
  await page.screenshot({ path: join(OUT, `${name}.${lang}.png`) })
  captured++
  log(`  ${name}.${lang}.png`)
}

async function shot(name, lang, fn) {
  if (ONLY && !ONLY.test(name)) return
  try {
    const ok = await fn()
    if (ok === false) { misses.push(`${name}.${lang}`); log(`  MISS ${name}.${lang}`); return }
    await snap(name, lang)
  } catch (e) {
    misses.push(`${name}.${lang}`); log(`  MISS ${name}.${lang} :: ${String(e).split('\n')[0]}`)
  }
  await clearHl().catch(() => {})
}

const rail = () => page.locator('nav').first().locator('button')
const inEditor = async () => (await page.locator('.cm-editor').count()) > 0
async function gotoHome() {
  if (!(await inEditor())) return
  await rail().nth(0).click()
  await page.waitForSelector('.home-view', { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(400)
}
async function ensureEditor() {
  if (await inEditor()) return
  const card = page.locator('.home-view button').filter({ hasText: /(Continue|تابِع|Open|فتح)/ }).first()
  if (await card.count()) await card.click().catch(() => {})
  await page.waitForSelector('.cm-content', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(600)
}

/** New project from Home: New project → language tile → first starter, confirming
 *  the "New project from…" name prompt when one appears (a project already open). */
async function newProject(langTile) {
  await page.getByRole('button', { name: NEWPROJ_RE }).first().click()
  const dialog = page.locator('[role="dialog"]')
  await dialog.waitFor({ timeout: 8000 })
  await dialog.getByRole('button', { name: new RegExp('^' + langTile) }).first().click()
  await page.waitForTimeout(300)
  await dialog.locator('.template-card').first().click()
  await page.waitForTimeout(500)
  const create = page.getByRole('button', { name: CREATE_RE }).first()
  if (await create.count()) { await create.click().catch(() => {}) }
  await page.waitForSelector('.cm-content', { timeout: 15000 })
  await page.waitForTimeout(700)
}

async function newFile(name) {
  // The sidebar may be on Search/Extensions from earlier shots — show Explorer first.
  if ((await page.locator('[role="tree"]').count()) === 0) {
    await rail().nth(1).click()
    await page.waitForSelector('[role="tree"]', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(250)
  }
  await page.getByRole('button', { name: NEWFILE_RE }).first().click()
  await page.waitForTimeout(300)
  const input = page.locator('[role="tree"] input, aside input').first()
  await input.fill(name)
  await input.press('Enter')
  await page.waitForTimeout(500)
}

async function setSource(text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.waitForTimeout(700)
}

/** Open a top menu-bar menu ("File", etc.) by bilingual name. */
async function openMenuBar(re) {
  const item = page.locator('[role="menubar"]').getByRole('menuitem', { name: re }).first()
  if ((await item.count()) === 0) return false
  await item.click()
  await page.waitForTimeout(350)
  return true
}
async function esc() {
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(150)
  // Some menus don't close on Escape unless focused; if an overlay lingers,
  // click a neutral spot to dismiss it so the next click isn't intercepted.
  if (await page.locator('[role="menu"], [role="dialog"]').count()) {
    await page.mouse.click(1274, 320).catch(() => {})
    await page.waitForTimeout(150)
  }
}

async function capture(lang) {
  const profile = mkdtempSync(join(tmpdir(), `warsha-shots-${lang}-`))
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: EXE, headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: DSF,
  })
  page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.addInitScript(() => { try { localStorage.setItem('warsha:splash-seen', '1') } catch {} })
  await page.goto(`${BASE}?lang=${lang}`, { waitUntil: 'load' })
  await ready()
  await style()

  // ---- Project 1: Python (editor / files / search / settings) ----
  log(`\n=== ${lang} :: seed Python ===`)
  await newProject('Python')

  log(`=== ${lang} :: home ===`)
  await gotoHome(); await style()
  await shot('home', lang, () => hl(page.getByRole('button', { name: NEWPROJ_RE })))
  await shot('home-continue', lang, () => hl(page.locator('.home-view button').filter({ hasText: /(Continue|تابِع)/ }).first()))
  await shot('home-language', lang, () => hl(page.getByRole('button', { name: /(Language|اللغة)/ }).first()))

  log(`=== ${lang} :: create-project ===`)
  await shot('picker-langs', lang, async () => {
    await page.getByRole('button', { name: NEWPROJ_RE }).first().click()
    await page.locator('[role="dialog"]').waitFor({ timeout: 8000 })
    await page.waitForTimeout(400)
    return hl(page.locator('[role="dialog"]'))
  })
  await shot('picker-templates', lang, async () => {
    const dialog = page.locator('[role="dialog"]')
    if ((await dialog.count()) === 0) return false
    await dialog.getByRole('button', { name: /^Python/ }).first().click()
    await page.waitForTimeout(400)
    return hl(dialog.locator('.template-card').first())
  })
  await esc()
  await ensureEditor(); await style()

  log(`=== ${lang} :: editor ===`)
  await shot('editor', lang, () => hl(page.locator('.cm-content')))
  await shot('editor-tabs', lang, () => hl(page.locator('[role="tab"]').first()))
  await shot('editor-autocomplete', lang, async () => {
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('pr', { delay: 70 })
    await page.waitForTimeout(700)
    return hl(page.locator('.cm-tooltip-autocomplete'))
  })
  await esc()

  log(`=== ${lang} :: files ===`)
  await shot('explorer', lang, () => hl(page.locator('[role="tree"]')))
  await shot('explorer-newfile', lang, async () => {
    const btn = page.getByRole('button', { name: NEWFILE_RE }).first()
    if ((await btn.count()) === 0) return false
    await btn.click()
    await page.waitForTimeout(300)
    const input = page.locator('[role="tree"] input, aside input').first()
    return (await input.count()) ? hl(input) : hl(btn)
  })
  await esc()
  await shot('explorer-rowmenu', lang, async () => {
    const row = page.locator('[role="treeitem"]').first()
    await row.click({ button: 'right' })
    await page.waitForTimeout(350)
    return hl(page.locator('[role="menu"]'))
  })
  await esc()

  log(`=== ${lang} :: search ===`)
  await shot('search', lang, async () => {
    await rail().nth(2).click()
    await page.waitForTimeout(400)
    const field = page.locator('aside input, [role="textbox"]').first()
    await field.fill('print').catch(() => {})
    await page.waitForTimeout(600)
    return hl(page.locator('aside').first())
  })
  await shot('quick-open', lang, async () => {
    await page.keyboard.press('Control+p'); await page.waitForTimeout(450)
    return hl(page.locator('section:has([role="combobox"])'))
  })
  await esc()
  await shot('command-palette', lang, async () => {
    await page.keyboard.press('Control+Shift+p'); await page.waitForTimeout(450)
    return hl(page.locator('section:has([role="combobox"])'))
  })
  await esc()

  log(`=== ${lang} :: settings + account ===`)
  await shot('settings-menu', lang, async () => {
    await rail().last().click(); await page.waitForTimeout(350)
    return hl(page.locator('[role="menu"]'))
  })
  await shot('settings-zoom', lang, async () => {
    if ((await page.locator('[role="menu"]').count()) === 0) { await rail().last().click(); await page.waitForTimeout(350) }
    return hl(page.locator('[role="menu"] input[type="range"]'))
  })
  await esc()
  await shot('settings-extensions', lang, async () => {
    await rail().nth(3).click(); await page.waitForTimeout(450)
    return hl(page.locator('aside').first())
  })
  // account (needs VITE_WARSHA_API for the Sign in row)
  await shot('account-menu', lang, async () => {
    await rail().last().click(); await page.waitForTimeout(350)
    return hl(page.getByRole('menuitem', { name: /(Sign in|تسجيل الدخول)/ }).first())
  })
  await shot('account-dialog', lang, async () => {
    const row = page.getByRole('menuitem', { name: /(Sign in|تسجيل الدخول)/ }).first()
    if ((await row.count()) === 0) return false
    await row.click(); await page.waitForTimeout(400)
    return hl(page.locator('[role="dialog"]'))
  })
  await esc()

  log(`=== ${lang} :: import + share ===`)
  await shot('import-menu', lang, async () => {
    if (!(await openMenuBar(/(File|ملف)/))) return false
    return hl(page.getByRole('menuitem', { name: /(Import|استيراد)/ }).first())
  })
  await shot('import-dialog', lang, async () => {
    const row = page.getByRole('menuitem', { name: /(Import|استيراد)/ }).first()
    if ((await row.count()) === 0) { if (!(await openMenuBar(/(File|ملف)/))) return false }
    await page.getByRole('menuitem', { name: /(Import|استيراد)/ }).first().click()
    await page.waitForTimeout(450)
    return hl(page.locator('[role="dialog"]'))
  })
  await esc()
  await shot('export-zip', lang, async () => {
    if (!(await openMenuBar(/(File|ملف)/))) return false
    return hl(page.getByRole('menuitem', { name: /(Export|تصدير)/ }).first())
  })
  await esc()
  const openMore = async () => {
    const more = page.getByRole('button', { name: MORE_RE }).first()
    if ((await more.count()) === 0) return false
    await more.click(); await page.waitForTimeout(400)
    return true
  }
  await shot('share-link', lang, async () => {
    if (!(await openMore())) return false
    return hl(page.getByRole('menuitem', { name: /(link|رابط)/i }).first())
  })
  await esc()
  await shot('share-image', lang, async () => {
    if (!(await openMore())) return false
    return hl(page.getByRole('menuitem', { name: /(image|صورة|PDF)/i }).first())
  })
  await esc()

  // ---- Project 2: Web (run / console / preview — runs offline, no CDN) ----
  log(`=== ${lang} :: seed Web ===`)
  try {
    await esc(); await esc() // clear any menu/dialog left open by the prior section
    await ensureEditor()
    await gotoHome()
    await newProject('Web')
    // Reset the sidebar to Explorer (earlier shots left it on Search/Extensions).
    if ((await page.locator('[role="tree"]').count()) === 0) { await rail().nth(1).click(); await page.waitForTimeout(300) }
    // A page with an inline <script> gives BOTH a live preview and real console
    // output (console.log/error forward to the Console tab) with no engine download.
    await setSource(
      '<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8" />\n    <title>My page</title>\n' +
      '    <link rel="stylesheet" href="styles.css" />\n  </head>\n  <body>\n' +
      '    <h1>Hello from Warsha</h1>\n    <p>This page is written in HTML. Press Run to see it.</p>\n' +
      '    <script>\n      console.log("Warsha is running")\n      console.log("2 + 3 =", 2 + 3)\n' +
      '      console.error("heads up: check the total on line 3")\n    </script>\n  </body>\n</html>\n',
    )
    await shot('run', lang, () => hl(page.getByRole('button', { name: RUN_RE })))
    await page.getByRole('button', { name: RUN_RE }).first().click()
    await page.waitForSelector('iframe', { timeout: 20000 })
    await page.waitForTimeout(1500)
    await shot('preview', lang, () => hl(page.locator('iframe')))
    await shot('preview-toggle', lang, () => hl(page.getByRole('tab', { name: /(Preview|المعاينة)/ }).first()))
    // Switch to the Console tab to show the program's output.
    await page.getByRole('tab', { name: /(Console|وحدة التحكم)/ }).first().click().catch(() => {})
    await page.waitForFunction(() => /Warsha is running/.test(document.body.innerText), null, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(400)
    await shot('console-output', lang, () => hl(page.locator('.console-row').first(), 1))
    await shot('console-clear', lang, () => hl(page.getByRole('button', { name: /(Clear|مسح|Console actions|إجراءات وحدة التحكم)/ }).first()))
  } catch (e) {
    log(`  MISS web-group.${lang} ::\n${String(e).split('\n').slice(0, 6).join('\n')}`)
    for (const n of ['run', 'console-output', 'console-clear', 'preview', 'preview-toggle']) misses.push(`${n}.${lang}`)
  }

  await ctx.close()
  rmSync(profile, { recursive: true, force: true })
}

for (const lang of LANGS) await capture(lang)

log(`\nCaptured ${captured} shots. Misses: ${misses.length}`)
if (misses.length) log('  ' + [...new Set(misses)].join('\n  '))
process.exit(0)
