/* Verification for the explorer / tabs / editor-chrome pass.
 * Drives LOCAL Chrome against the built app on :8088. No engines needed —
 * every check here is files, tabs or editor chrome. */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
const URL_ = process.env.WARSHA_URL ?? 'http://localhost:8088/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'warsha-files-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (ok, n, d = '') => (ok ? pass(n, d) : fail(n, d))
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const shot = async (name, locator) => {
  const target = locator ?? page
  await target.screenshot({ path: join(SHOTS, `files-${name}.png`) })
  info(`shot → files-${name}.png`)
}
const rows = () => page.locator('[role="treeitem"]')
const rowByName = (name) => page.locator('[role="treeitem"]').filter({ hasText: name }).first()
// Scoped to the file strip: the console header is a role=tablist too ("Output
// view", its CONSOLE/PREVIEW caps tabs), so a bare [role=tab] sweep would
// count the panel tabs among the open files.
const fileStrip = () => page.getByRole('tablist', { name: 'Open files' })
const tabs = () => fileStrip().getByRole('tab')

await page.goto(URL_, { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })
// This harness is a 1280px fine-pointer window, so the DENSITY media holds and
// the desk (VS Code parity) treatments below are the ones in force. The forks
// keep the file honest if it is ever pointed at a touch profile.
const desk = await page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)

/* ---------------------------------------------------------------- 1. empty */
check(await page.locator('.empty__title', { hasText: 'No files yet' }).isVisible(), 'explorer empty-project state')
await shot('empty-1280')

/* ------------------------------------------------- 2. seed the Java starter */
await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
await page.waitForSelector('[role="tab"]', { timeout: 10000 })
// The tab can land a paint before the tree does; counting rows in that gap
// reported "0 rows" against a perfectly seeded project. Wait for the tree
// itself before reading it.
await page.waitForSelector('[role="treeitem"]', { timeout: 10000 })
info(`tree seeded: ${await rows().count()} rows`)
check((await rows().count()) >= 3, 'template produced a nested tree')

/* ------------------------------------------------- 3. explorer visual state */
const guides = await page.locator('.tree-row__guide').count()
check(guides > 0, 'indent guides rendered', `${guides} hairlines`)

const chevron = page.locator('[role="treeitem"][aria-expanded="true"] .tree-row__chevron').first()
// Tailwind v4's rotate-90 emits the `rotate` longhand; older builds carried a
// transform matrix. Either way, the open folder's twistie must be turned.
const rot = await chevron.evaluate((el) => {
  const s = getComputedStyle(el)
  return s.rotate !== 'none' && s.rotate !== '' ? s.rotate : s.transform
})
check(rot !== 'none' && rot !== '', 'open folder chevron is rotated', rot)

const openRow = page.locator('[role="treeitem"][data-state="open"]')
check((await openRow.count()) === 1, 'exactly one row marked as the open file')
const railed = await openRow.first().evaluate((el) => {
  const s = getComputedStyle(el)
  return {
    border: s.borderLeftColor,
    width: s.borderLeftWidth,
    bg: s.backgroundColor,
    weight: getComputedStyle(el.querySelector('.tree-row__label')).fontWeight,
    labelColor: getComputedStyle(el.querySelector('.tree-row__label')).color,
  }
})
if (desk) {
  // VS Code's list model (W1-C): selection is a full-row FILL — the reserved
  // 2px border stays transparent — grey #2B2B31 (v5 --list-inactive-sel-bg)
  // while the tree is unfocused, and weight stays 400 (VS Code weights
  // nothing in the tree).
  check(
    railed.border === 'rgba(0, 0, 0, 0)' && railed.bg === 'rgb(43, 43, 49)' && railed.weight === '400',
    'open row carries the inactive selection fill (no rail, weight 400)',
    JSON.stringify(railed),
  )
  // Focus the row: [data-tree-root]:focus-within promotes the fill to the
  // active-selection grey (#3A3A42) with a white label. `.tree-row` transitions
  // background-color over --dur-fast, so let the fill settle before reading —
  // sampling in the same tick catches the grey end of the tween, not the bug
  // it would look like.
  await openRow.first().evaluate((el) => el.focus())
  await page.waitForTimeout(400)
  const focusedFill = await openRow.first().evaluate((el) => ({
    bg: getComputedStyle(el).backgroundColor,
    labelColor: getComputedStyle(el.querySelector('.tree-row__label')).color,
  }))
  check(
    focusedFill.bg === 'rgb(58, 58, 66)' && focusedFill.labelColor === 'rgb(255, 255, 255)',
    'focused tree promotes the selection to the active fill + white label',
    JSON.stringify(focusedFill),
  )
  await page.evaluate(() => document.activeElement?.blur())
  // The per-row ⋯ is GONE at desk, not merely hover-hidden — the right-click
  // context menu covers it.
  const moreDisplay = await page.locator('.tree-row__more').first().evaluate((el) => getComputedStyle(el).display).catch(() => 'absent')
  check(moreDisplay === 'none' || moreDisplay === 'absent', 'the per-row ⋯ is display:none at desk (context menu covers it)', moreDisplay)
} else {
  check(railed.width === '2px' && railed.border !== 'rgba(0, 0, 0, 0)', 'open row carries the 2px accent rail', JSON.stringify(railed))
}

// Active file follows the active tab.
const activeTabName = await page.locator('[role="tab"][data-state="active"] .tab__label').innerText()
const openRowName = await openRow.first().locator('.tree-row__label').innerText()
check(activeTabName === openRowName, 'explorer selection is synced with the active tab', `${activeTabName} / ${openRowName}`)

// Hover / selected / focus are three different things.
const states = await page.evaluate(() => {
  const row = document.querySelector('[role="treeitem"]:not([data-state])')
  const sel = document.querySelector('[role="treeitem"][data-state="open"]')
  return {
    idle: getComputedStyle(row).backgroundColor,
    selected: getComputedStyle(sel).backgroundColor,
    selectedRail: getComputedStyle(sel).borderLeftColor,
    idleRail: getComputedStyle(row).borderLeftColor,
    cursor: getComputedStyle(row).cursor,
    userSelect: getComputedStyle(row).userSelect,
  }
})
info('row states: ' + JSON.stringify(states))
check(states.cursor === 'pointer', 'row cursor is pointer')
check(states.userSelect === 'none', 'explorer chrome is not text-selectable')
// Touch marks the open row with a rail; desk marks it with a full-row fill.
// Either way the selected row must not read identical to an idle one.
check(
  states.selected !== states.idle || states.selectedRail !== states.idleRail,
  'selected row differs from idle (fill at desk, rail on touch)',
  JSON.stringify(states),
)

await shot('explorer-nested-1280', page.locator('aside[aria-label="Files"]'))

/* -------------------------------------------------- 4. inline file creation */
const before = await rows().count()
await page.locator('aside[aria-label="Files"]').getByRole('button', { name: 'New file' }).click()
const draft = page.locator('[role="tree"] input')
check(await draft.isVisible(), 'New file opens an inline row, not a modal')
const draftFont = await draft.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
// DENSITY: 16px is the iOS zoom floor, a touch obligation; the fine-pointer
// desktop this harness runs as uses 14px (--fs-input under the DENSITY media).
const draftDesk = await page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)
check(draftFont >= (draftDesk ? 14 : 16), draftDesk ? 'inline field is ≥14px at desktop density' : 'inline field is ≥16px so iOS will not zoom', `${draftFont}px`)
await shot('explorer-inline-create-1280', page.locator('aside[aria-label="Files"]'))
await draft.fill('notes.txt')
await draft.press('Enter')
await page.waitForTimeout(400)
check((await rows().count()) === before + 1, 'inline create added the file')
check(await rowByName('notes.txt').isVisible(), 'new file appears in the tree')
const titleAfterCreate = await page.title()
check(titleAfterCreate === 'notes.txt — Warsha', 'document.title tracks the open file', titleAfterCreate)
const focused = await page.evaluate(() => document.activeElement?.className || '')
check(/cm-content/.test(focused), 'caret lands in the editor after creating a file', focused)

/* --------------------------------------------------- 5. inline rename (F2) */
await rowByName('notes.txt').click()
await rowByName('notes.txt').press('F2')
const renameField = page.locator('[role="tree"] input')
check(await renameField.isVisible(), 'F2 starts an inline rename')
const selected = await renameField.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))
check(selected === 'notes.txt', 'rename field is autofocused with the name selected', JSON.stringify(selected))
await renameField.fill('notes-renamed.txt')
await renameField.press('Enter')
await page.waitForTimeout(500)
check(await rowByName('notes-renamed.txt').isVisible(), 'inline rename applied')
check(
  (await page.locator('[role="tab"] .tab__label', { hasText: 'notes-renamed.txt' }).count()) === 1,
  'the tab followed the rename',
)

// Double-click renames too (desktop gesture).
await rowByName('notes-renamed.txt').dblclick()
check(await page.locator('[role="tree"] input').isVisible(), 'double-click starts an inline rename')
await page.locator('[role="tree"] input').press('Escape')
await page.waitForTimeout(200)
check((await page.locator('[role="tree"] input').count()) === 0, 'Escape abandons the rename')

/* ----------------------------------------------------- 6. inline new folder */
await page.locator('aside[aria-label="Files"]').getByRole('button', { name: 'New folder' }).click()
const folderDraft = page.locator('[role="tree"] input')
await folderDraft.fill('scratch')
await folderDraft.press('Enter')
await page.waitForTimeout(500)
check(await rowByName('scratch').isVisible(), 'inline create made a folder')
// The "This folder is empty." helper row is TOUCH-only now (`desk:hidden`,
// W1-C): VS Code renders nothing under an empty folder, and at desk the
// right-click menu already offers New file. files-touch.mjs owns the touch
// assertion.
if (desk)
  check(
    !(await page.locator('[role="tree"] :text("This folder is empty.")').first().isVisible().catch(() => false)),
    'the empty-folder helper row stays off the desk tree (touch-only)',
  )
else
  check(
    await page.locator('[role="tree"]', { hasText: 'This folder is empty.' }).isVisible(),
    'an empty folder explains itself',
  )
await shot('explorer-empty-folder-1280', page.locator('aside[aria-label="Files"]'))

/* --------------------------------------------- 7. keyboard walk + collapse */
await rows().first().focus()
await page.keyboard.press('ArrowDown')
const walked = await page.evaluate(() => document.activeElement?.getAttribute('data-path'))
check(!!walked, 'arrow keys walk the tree', String(walked))
const ring = await page.evaluate(() => {
  const el = document.activeElement
  const s = getComputedStyle(el)
  return { outlineWidth: s.outlineWidth, outlineColor: s.outlineColor, outlineStyle: s.outlineStyle }
})
// Founder ruling 2026-08-02: the ring is 1px/no-offset app-wide (was 2px/2px);
// audit.mjs asserts the same geometry.
check(ring.outlineStyle === 'solid' && parseFloat(ring.outlineWidth) >= 1, 'focused row shows the focus ring', JSON.stringify(ring))
await shot('explorer-focus-ring-1280', page.locator('aside[aria-label="Files"]'))

const collapseBtn = page.getByRole('button', { name: 'Collapse folders' })
check(await collapseBtn.isVisible(), 'Collapse folders control is present')
await collapseBtn.click()
await page.waitForTimeout(200)
check((await page.locator('[role="treeitem"][aria-expanded="true"]').count()) === 0, 'collapse folders closed everything')
await page.locator('[role="treeitem"][aria-expanded="false"]').first().click()
await page.waitForTimeout(200)

/* ---------------------------------------------------------------- 8. tabs */
// Fill the strip so it has to scroll. Desk tabs shrink to their content
// (desk:min-w-0, max 240px — W2-A), so it takes more of them than the touch
// strip's 96px-minimum tabs needed before the scroller genuinely overflows.
for (const name of ['One.java', 'Two.java', 'Three.java', 'Four.java', 'Five.java', 'VeryLongTypeNameController.java',
  'SixthProcessor.java', 'SeventhValidator.java', 'EighthRepository.java', 'NinthConfiguration.java']) {
  await page.locator('aside[aria-label="Files"]').getByRole('button', { name: 'New file' }).click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(250)
}
const tabCount = await tabs().count()
info(`${tabCount} tabs open`)
const strip = fileStrip()
const scrollState = await strip.evaluate((el) => ({
  w: el.clientWidth,
  sw: el.scrollWidth,
  outer: el.offsetHeight,
  // A horizontal scrollbar would eat a strip of pixels off the bottom, showing
  // up as clientHeight well below offsetHeight. Allow 1px for a border.
  gutter: el.offsetHeight - el.clientHeight,
}))
check(scrollState.sw > scrollState.w, 'tab strip overflows and scrolls', JSON.stringify(scrollState))
// DENSITY: the strip is --bar-tabs — 44px touch, 35px fine-pointer desktop.
const wantStrip = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-tabs')))
check(scrollState.outer === wantStrip && scrollState.gutter <= 1,
  `tab strip is the ${wantStrip}px --bar-tabs with no scrollbar gutter`, JSON.stringify(scrollState))
const fades = await page.locator('.tab-strip ~ span[aria-hidden="true"]').count()
check(fades > 0, 'an overflow fade marks the scrollable edge', `${fades} fade(s)`)
await shot('tabs-overflow-1280', page.locator('main'))

// Long names ellipsize rather than push the layout.
const longTab = page.locator('[role="tab"]').filter({ hasText: 'VeryLongTypeNameController' }).first()
const ell = await longTab.locator('.tab__label').evaluate((el) => ({
  overflow: getComputedStyle(el).textOverflow,
  clipped: el.scrollWidth > el.clientWidth,
  tabW: el.closest('[role="tab"]').getBoundingClientRect().width,
}))
check(ell.overflow === 'ellipsis', 'tab labels ellipsize', JSON.stringify(ell))

// Active tab signals. The accent rule rides in an inset box-shadow, not a
// border, so it cannot eat the tab's content box (PIXEL-FINDINGS F-03;
// audit.mjs reads the same shadow).
const activeTab = page.locator('[role="tab"][data-state="active"]')
const sig = await activeTab.evaluate((el) => {
  const s = getComputedStyle(el)
  const l = getComputedStyle(el.querySelector('.tab__label'))
  return { shadow: s.boxShadow, weight: l.fontWeight, color: l.color, bg: s.backgroundColor }
})
const inactive = await page.locator('[role="tab"][data-state="inactive"]').first().evaluate((el) => {
  const l = getComputedStyle(el.querySelector('.tab__label'))
  return { weight: l.fontWeight, color: l.color }
})
if (desk) {
  // VS Code's grammar (W2-A): a 1px --accent rule on the TOP edge (white in
  // v5), the editor-canvas fill (#0E0E11) running into the code below, a white
  // label — and weight 400 on BOTH states, so activating a tab cannot reflow
  // the strip.
  check(
    /rgb\(250, 250, 250\) 0px 1px 0px 0px inset/.test(sig.shadow) &&
      sig.bg === 'rgb(14, 14, 17)' &&
      sig.color === 'rgb(255, 255, 255)' &&
      sig.weight === '400' &&
      sig.weight === inactive.weight &&
      sig.color !== inactive.color,
    'active tab: 1px accent top rule + editor fill + white label at weight 400',
    JSON.stringify({ sig, inactive }),
  )
} else {
  check(/inset/.test(sig.shadow) && sig.weight !== inactive.weight && sig.color !== inactive.color,
    'active tab carries rule + weight + colour', JSON.stringify({ sig, inactive }))
}

// Breadcrumbs (W2-A, desk-only): the row under the strip mirrors the active
// tab's file, and follows it when the active tab changes.
if (desk) {
  const crumbs = page.locator('.breadcrumbs')
  check((await crumbs.count()) === 1 && (await crumbs.getAttribute('aria-label')) === 'Breadcrumbs',
    'the breadcrumbs row is mounted with its contract label')
  const activeName = await page.locator('[role="tab"][data-state="active"] .tab__label').innerText()
  check((await crumbs.innerText()).includes(activeName), 'breadcrumbs name the active file', activeName)
  await page.locator('[role="tab"]').filter({ hasText: 'Five.java' }).first().click()
  await page.waitForTimeout(300)
  check((await crumbs.innerText()).includes('Five.java'), 'breadcrumbs track a tab switch', await crumbs.innerText())
}

// Dirty dot, then the close × on hover. The dot only lives for the 350ms write
// debounce, so the mouse is parked on the tab *before* the keystroke and the
// styles are read in the same tick — no hover() round-trip inside the window.
await page.locator('.cm-content').click()
await page.keyboard.type('x = 1')
await page.waitForTimeout(60)
check((await activeTab.locator('.dot-dirty').count()) === 1, 'editing shows the dirty dot on the tab')
await shot('tabs-dirty-1280', fileStrip())

let swap = null
for (let attempt = 0; attempt < 6 && !swap; attempt++) {
  await page.waitForTimeout(600) // let the previous edit flush
  const box = await activeTab.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.evaluate(() => document.querySelector('.cm-content').focus())
  await page.keyboard.type('z')
  swap = await page.evaluate(() => {
    const tab = document.querySelector('[role="tab"][data-state="active"]')
    const d = tab?.querySelector('.dot-dirty')
    const x = tab?.querySelector('button svg')
    if (!d) return null
    return { dot: getComputedStyle(d).display, x: x ? getComputedStyle(x).display : 'missing' }
  })
}
check(swap && swap.dot === 'none' && swap.x !== 'none' && swap.x !== 'missing',
  'the dirty dot becomes the close × on hover', JSON.stringify(swap))
await page.mouse.move(0, 400)
await page.waitForTimeout(700)

// Middle-click closes.
const beforeClose = await tabs().count()
await page.locator('[role="tab"]').filter({ hasText: 'One.java' }).first().click({ button: 'middle' })
await page.waitForTimeout(250)
check((await tabs().count()) === beforeClose - 1, 'middle-click closes a tab')

// Cmd/Ctrl+W closes the active tab.
const beforeW = await tabs().count()
await page.locator('.cm-content').click()
await page.keyboard.press('Control+w')
await page.waitForTimeout(250)
check((await tabs().count()) === beforeW - 1, 'Ctrl+W closes the active file')

// Context menu: close others / close all.
await tabs().first().click({ button: 'right' })
await page.waitForSelector('[role="menu"]')
const menuLabels = await page.locator('[role="menuitem"]').allInnerTexts()
check(menuLabels.some((l) => /Close others/.test(l)) && menuLabels.some((l) => /Close all/.test(l)),
  'tab menu offers Close others / Close all', JSON.stringify(menuLabels))
await shot('tabs-menu-1280')
await page.keyboard.press('Escape')

/* -------------------------------------------------------------- 9. editor */
await rowByName('Main.java').click()
await page.waitForTimeout(400)
const code = await page.evaluate(() => {
  const content = document.querySelector('.cm-content')
  const line = document.querySelector('.cm-line')
  const gutter = document.querySelector('.cm-lineNumbers .cm-gutterElement')
  const cs = getComputedStyle(content)
  const ls = getComputedStyle(line)
  const gs = getComputedStyle(gutter)
  return {
    family: cs.fontFamily,
    resolved: cs.fontFamily.split(',')[0],
    size: cs.fontSize,
    lineHeight: ls.lineHeight,
    gutterSize: gs.fontSize,
    gutterLead: gs.lineHeight,
    padLeft: cs.paddingLeft,
    userSelect: cs.userSelect,
  }
})
info('code type: ' + JSON.stringify(code))
// DENSITY (W2-D): the desk default is VS Code's 14px with Math.round(14 × 1.35)
// = 19px leading, and the gutter follows the editor's own px; touch keeps
// 15px / 24px (1.6) with the 13px gutter.
const wantCodePx = desk ? 14 : 15
const wantLeadPx = desk ? 19 : 24
check(parseFloat(code.size) === wantCodePx, `code renders at the specified ${wantCodePx}px`, code.size)
check(parseFloat(code.lineHeight) === wantLeadPx, `code leading is ${wantLeadPx}px`, code.lineHeight)
check(code.gutterLead === code.lineHeight, 'gutter leading matches code leading, so it cannot drift')
if (desk) check(code.gutterSize === code.size, 'the gutter follows the editor size at desk', code.gutterSize)
check(code.userSelect !== 'none', 'editor text stays selectable')

// Monospace, measured rather than assumed: iiii and WWWW must be the same width.
const monoWidth = await page.evaluate(() => {
  const el = document.createElement('span')
  const cs = getComputedStyle(document.querySelector('.cm-content'))
  el.style.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`
  el.style.position = 'absolute'
  el.style.whiteSpace = 'pre'
  document.body.append(el)
  el.textContent = 'iiii'
  const i = el.getBoundingClientRect().width
  el.textContent = 'WWWW'
  const w = el.getBoundingClientRect().width
  el.remove()
  return { i, w }
})
check(Math.abs(monoWidth.i - monoWidth.w) < 0.5, 'code font is genuinely monospaced', JSON.stringify(monoWidth))

// Indent guides in the editor.
const cmGuides = await page.locator('.cm-line.cm-indentGuides').count()
const guideStyle = cmGuides
  ? await page.locator('.cm-line.cm-indentGuides').first().evaluate((el) => {
      const s = getComputedStyle(el)
      return { image: s.backgroundImage.slice(0, 70), size: s.backgroundSize, origin: s.backgroundOrigin, depth: el.style.getPropertyValue('--cm-guides') }
    })
  : null
check(cmGuides > 0, 'editor draws indent guides', `${cmGuides} lines, ${JSON.stringify(guideStyle)}`)

// Active line + selection + caret come from the tokens.
await page.locator('.cm-content').click()
const chrome = await page.evaluate(() => {
  const al = document.querySelector('.cm-activeLine')
  const alCs = al ? getComputedStyle(al) : null
  const cur = document.querySelector('.cm-cursor')
  const root = getComputedStyle(document.documentElement)
  return {
    activeLine: alCs ? alCs.backgroundColor : null,
    activeOutline: alCs ? `${alCs.outlineWidth} ${alCs.outlineStyle} ${alCs.outlineColor}` : null,
    token: root.getPropertyValue('--code-active-line').trim(),
    borderToken: root.getPropertyValue('--code-active-line-border').trim(),
    caretW: cur ? getComputedStyle(cur).borderLeftWidth : null,
    caretC: cur ? getComputedStyle(cur).borderLeftColor : null,
    caretToken: root.getPropertyValue('--code-caret').trim(),
  }
})
info('editor chrome: ' + JSON.stringify(chrome))
const rgb = (hex) => {
  const h = hex.replace('#', '')
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`
}
if (desk) {
  // W2-D: at desk the active line is VS Code's bordered treatment — a
  // transparent fill with a 1px --code-active-line-border outline.
  check(
    chrome.activeLine === 'rgba(0, 0, 0, 0)' && chrome.activeOutline === `1px solid ${rgb(chrome.borderToken)}`,
    'active line is the desk bordered treatment (transparent fill + 1px outline)',
    JSON.stringify({ line: chrome.activeLine, outline: chrome.activeOutline }),
  )
} else {
  check(chrome.activeLine === rgb(chrome.token), 'active line uses --code-active-line, not oneDark', `${chrome.activeLine} vs ${chrome.token}`)
}
check(parseFloat(chrome.caretW) === 2, 'caret is 2px wide', chrome.caretW)
// --code-caret is a LITERAL (#FAFAFA in v5 — white, equal to the accent by
// value but deliberately DECOUPLED, so retuning the accent never silently
// moves the caret).
check(chrome.caretC === rgb(chrome.caretToken), 'caret is --code-caret, decoupled from the accent', `${chrome.caretC} vs ${chrome.caretToken}`)
const canvas = await page.evaluate(() => ({
  editor: getComputedStyle(document.querySelector('.cm-editor')).backgroundColor,
  gutter: getComputedStyle(document.querySelector('.cm-gutters')).backgroundColor,
  panel: getComputedStyle(document.querySelector('aside[aria-label="Files"] > div')).backgroundColor,
  surface1: getComputedStyle(document.documentElement).getPropertyValue('--surface-1').trim(),
}))
check(canvas.editor === rgb(canvas.surface1) && canvas.gutter === rgb(canvas.surface1),
  'editor canvas and gutter are --surface-1, not oneDark #282c34', JSON.stringify(canvas))

// Wrapped continuation rows hang at the code's own indentation instead of
// jumping back to column 0 — and the caret still lands where it is clicked,
// which is the thing a negative text-indent could plausibly break.
await page.setViewportSize({ width: 460, height: 900 })
await page.waitForTimeout(500)
// A .cm-line is a block, so element rects say nothing about wrapping — the row
// boxes come from a Range over its text.
const rowRects = () => `(() => {
  for (const line of document.querySelectorAll('.cm-line.cm-indentGuides')) {
    const r = document.createRange()
    r.selectNodeContents(line)
    const rects = [...r.getClientRects()].filter((x) => x.width > 1)
    if (rects.length > 1) return { rects: rects.map((x) => ({ x: x.x, y: x.y, h: x.height })), text: line.textContent.slice(0, 30) }
  }
  return null
})()`
const hang = await page.evaluate(rowRects())
check(hang && hang.rects[1].x > hang.rects[0].x + 4,
  'wrapped rows hang at the line indent',
  hang ? `first ${Math.round(hang.rects[0].x)} → wrap ${Math.round(hang.rects[1].x)} :: ${hang.text}` : 'no wrapped line found')

const caret = { x: hang.rects[1].x + 3, y: hang.rects[1].y + hang.rects[1].h / 2 }
await page.mouse.click(caret.x, caret.y)
await page.waitForTimeout(150)
const landed = await page.evaluate(() => {
  const s = getSelection()
  const node = s.anchorNode
  const text = node?.textContent ?? ''
  return { offset: s.anchorOffset, around: text.slice(Math.max(0, s.anchorOffset - 4), s.anchorOffset + 4) }
})
check(landed.offset >= 0, 'caret lands inside the clicked continuation row', JSON.stringify(landed))
await shot('editor-wrap-460', page.locator('main'))
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(400)

await page.evaluate(() => document.querySelector('.cm-content').focus())
await page.keyboard.press('Control+Home')
await page.waitForTimeout(200)
await shot('editor-code-1280', page.locator('main'))

// Font-size preference: works and survives a reload. At desk "Bigger Text"
// lives in the menu bar's View menu (W1-B moved the app-scoped rows out of
// the tab-strip ⋯, which keeps only Format / Share as image…); touch keeps it
// under the title bar's More.
const beforeSize = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).fontSize)
if (desk) {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click()
  await page.waitForSelector('[role="menu"]')
  await page.getByRole('menuitem', { name: /Bigger Text/i }).click()
} else {
  await page.getByRole('button', { name: 'More' }).click()
  await page.waitForSelector('[role="menu"]')
  await page.getByRole('menuitem', { name: /Bigger text/i }).click()
}
await page.waitForTimeout(300)
const afterSize = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).fontSize)
check(parseFloat(afterSize) > parseFloat(beforeSize), 'Bigger text changes the code size', `${beforeSize} → ${afterSize}`)
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('.cm-content', { timeout: 20000 })
const persisted = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).fontSize)
check(persisted === afterSize, 'the code size persisted across a reload', persisted)

// Placeholder when nothing is open.
const openTabs = await tabs().count()
for (let i = 0; i < openTabs; i++) {
  await tabs().first().click({ button: 'middle' })
  await page.waitForTimeout(150)
}
check(await page.locator('.empty--pane').isVisible(), 'closing every tab shows a designed placeholder, not a void')
check((await page.title()) === 'Warsha', 'document.title falls back with no file open', await page.title())
await shot('editor-placeholder-1280', page.locator('main'))

/* ------------------------------------ 9b. workbench keybindings (W3-A, desk) */
if (desk) {
  const asideState = () => page.locator('aside[aria-label="Files"]').getAttribute('data-state')
  const b0 = await asideState()
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(300)
  const b1 = await asideState()
  await page.keyboard.press('Control+b')
  await page.waitForTimeout(300)
  check(b1 !== b0 && (await asideState()) === b0, 'Ctrl+B toggles the primary side bar', `${b0} → ${b1} → ${await asideState()}`)

  const consoleOpen = () => page.evaluate(() => document.querySelector('section[aria-label="Console"]')?.classList.contains('console-panel--open'))
  const c0 = await consoleOpen()
  await page.keyboard.press('Control+j')
  await page.waitForTimeout(300)
  const c1 = await consoleOpen()
  await page.keyboard.press('Control+j')
  await page.waitForTimeout(300)
  check(c1 !== c0 && (await consoleOpen()) === c0, 'Ctrl+J toggles the panel', `${c0} → ${c1} → ${await consoleOpen()}`)

  await page.keyboard.press('Control+p')
  await page.waitForTimeout(300)
  check((await page.locator('section[aria-label="Quick open"]').count()) === 1, 'Ctrl+P opens the quick-open widget')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check((await page.locator('section[aria-label="Quick open"]').count()) === 0, 'Escape closes it again')
}

/* -------------------------------------------------------- 10. narrow sizes */
// One shell: below 900px the activity bar's Explorer item opens the overlay
// drawer — the same control that toggles the docked pane at desk.
const filesBtn = () => page.locator('nav[aria-label="Activity bar"] button[aria-label="Explorer"]')
await page.setViewportSize({ width: 768, height: 1024 })
await page.waitForTimeout(400)
await filesBtn().click()
await page.waitForTimeout(400)
await shot('explorer-drawer-768')
await rowByName('Main.java').click()
await page.waitForTimeout(400)
await shot('editor-768')

await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(400)
await filesBtn().click()
await page.waitForTimeout(500)
await shot('explorer-drawer-390')
const drawerRow = await page.locator('[role="treeitem"]').first().boundingBox()
// DENSITY (scale-down, 2026-08-05): --row-tree is 36px VISUAL off the desk
// media — the tap target is the full-width row itself, so 36 is also the
// effective height. The old 44px floor predates the retune.
check(drawerRow.height >= 36, 'rows are ≥36px on a phone (--row-tree, full-width target)', `${drawerRow?.height}px`)
// The ⋯ is hover-gated behind `(hover: hover) and (pointer: fine)`, which a
// 390px *desktop* window still matches — so it is checked in files-touch.mjs
// under real coarse-pointer emulation instead, not here.
const moreVisible = await page.locator('.tree-row__more').first().evaluate((el) => getComputedStyle(el).opacity)
info(`⋯ opacity at a 390px desktop window: ${moreVisible} (touch path covered by files-touch.mjs)`)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await shot('editor-390')

/* --------------------------------------------------------------- verdict */
console.log('\nconsole errors: ' + (errors.length ? JSON.stringify(errors.slice(0, 6)) : 'none'))
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log(failed.map((f) => '  FAIL ' + f[1] + (f[2] ? ' :: ' + f[2] : '')).join('\n'))
await ctx.close()
