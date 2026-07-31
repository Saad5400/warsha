/* Verification for the explorer / tabs / editor-chrome pass.
 * Drives LOCAL Chrome against the built app on :8088. No engines needed —
 * every check here is files, tabs or editor chrome. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = 'http://localhost:8088/'
const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const profile = mkdtempSync(join(tmpdir(), 'warsha-files-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (ok, n, d = '') => (ok ? pass(n, d) : fail(n, d))
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: '/usr/bin/google-chrome',
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
const tabs = () => page.locator('[role="tab"]')

await page.goto(URL_, { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })

/* ---------------------------------------------------------------- 1. empty */
check(await page.locator('.empty__title', { hasText: 'No files yet' }).isVisible(), 'explorer empty-project state')
await shot('empty-1280')

/* ------------------------------------------------- 2. seed the Java starter */
await page.getByRole('button', { name: /Java \(OOP starter\)/ }).click()
await page.waitForSelector('[role="tab"]', { timeout: 10000 })
info(`tree seeded: ${await rows().count()} rows`)
check((await rows().count()) >= 3, 'template produced a nested tree')

/* ------------------------------------------------- 3. explorer visual state */
const guides = await page.locator('.tree-row__guide').count()
check(guides > 0, 'indent guides rendered', `${guides} hairlines`)

const chevron = page.locator('[role="treeitem"][aria-expanded="true"] .tree-row__chevron').first()
const rot = await chevron.evaluate((el) => getComputedStyle(el).transform)
check(rot.startsWith('matrix') && rot !== 'none', 'open folder chevron is rotated', rot)

const openRow = page.locator('[role="treeitem"][data-state="open"]')
check((await openRow.count()) === 1, 'exactly one row marked as the open file')
const railed = await openRow.first().evaluate((el) => {
  const s = getComputedStyle(el)
  return { border: s.borderLeftColor, width: s.borderLeftWidth, weight: getComputedStyle(el.querySelector('.tree-row__label')).fontWeight }
})
check(railed.width === '2px' && railed.border !== 'rgba(0, 0, 0, 0)', 'open row carries the 2px accent rail', JSON.stringify(railed))

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
check(states.selectedRail !== states.idleRail, 'selected row differs from idle by more than a fill')

await shot('explorer-nested-1280', page.locator('aside[aria-label="Files"]'))

/* -------------------------------------------------- 4. inline file creation */
const before = await rows().count()
await page.locator('aside[aria-label="Files"]').getByRole('button', { name: 'New file' }).click()
const draft = page.locator('[role="tree"] input')
check(await draft.isVisible(), 'New file opens an inline row, not a modal')
const draftFont = await draft.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
check(draftFont >= 16, 'inline field is ≥16px so iOS will not zoom', `${draftFont}px`)
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
check(ring.outlineStyle === 'solid' && parseFloat(ring.outlineWidth) >= 2, 'focused row shows the focus ring', JSON.stringify(ring))
await shot('explorer-focus-ring-1280', page.locator('aside[aria-label="Files"]'))

const collapseBtn = page.getByRole('button', { name: 'Collapse folders' })
check(await collapseBtn.isVisible(), 'Collapse folders control is present')
await collapseBtn.click()
await page.waitForTimeout(200)
check((await page.locator('[role="treeitem"][aria-expanded="true"]').count()) === 0, 'collapse folders closed everything')
await page.locator('[role="treeitem"][aria-expanded="false"]').first().click()
await page.waitForTimeout(200)

/* ---------------------------------------------------------------- 8. tabs */
// Fill the strip so it has to scroll.
for (const name of ['One.java', 'Two.java', 'Three.java', 'Four.java', 'Five.java', 'VeryLongTypeNameController.java']) {
  await page.locator('aside[aria-label="Files"]').getByRole('button', { name: 'New file' }).click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(250)
}
const tabCount = await tabs().count()
info(`${tabCount} tabs open`)
const strip = page.locator('[role="tablist"]')
const scrollState = await strip.evaluate((el) => ({
  w: el.clientWidth,
  sw: el.scrollWidth,
  outer: el.offsetHeight,
  // A horizontal scrollbar would eat a strip of pixels off the bottom, showing
  // up as clientHeight well below offsetHeight. Allow 1px for a border.
  gutter: el.offsetHeight - el.clientHeight,
}))
check(scrollState.sw > scrollState.w, 'tab strip overflows and scrolls', JSON.stringify(scrollState))
check(scrollState.outer === 44 && scrollState.gutter <= 1,
  'tab strip is 44px with no scrollbar gutter', JSON.stringify(scrollState))
const fades = await page.locator('[role="tablist"] ~ span[aria-hidden="true"]').count()
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

// Active tab: three signals.
const activeTab = page.locator('[role="tab"][data-state="active"]')
const sig = await activeTab.evaluate((el) => {
  const s = getComputedStyle(el)
  const l = getComputedStyle(el.querySelector('.tab__label'))
  return { rule: s.borderBottomColor, ruleW: s.borderBottomWidth, weight: l.fontWeight, color: l.color, bg: s.backgroundColor }
})
const inactive = await page.locator('[role="tab"][data-state="inactive"]').first().evaluate((el) => {
  const l = getComputedStyle(el.querySelector('.tab__label'))
  return { weight: l.fontWeight, color: l.color }
})
check(sig.ruleW === '2px' && sig.weight !== inactive.weight && sig.color !== inactive.color,
  'active tab carries rule + weight + colour', JSON.stringify({ sig, inactive }))

// Dirty dot, then the close × on hover. The dot only lives for the 350ms write
// debounce, so the mouse is parked on the tab *before* the keystroke and the
// styles are read in the same tick — no hover() round-trip inside the window.
await page.locator('.cm-content').click()
await page.keyboard.type('x = 1')
await page.waitForTimeout(60)
check((await activeTab.locator('.dot-dirty').count()) === 1, 'editing shows the dirty dot on the tab')
await shot('tabs-dirty-1280', page.locator('[role="tablist"]'))

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
await page.locator('[role="tab"]').first().click({ button: 'right' })
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
check(parseFloat(code.size) === 15, 'code renders at the specified 15px', code.size)
check(parseFloat(code.lineHeight) === 24, 'code leading is 24px (15 × 1.6)', code.lineHeight)
check(code.gutterLead === code.lineHeight, 'gutter leading matches code leading, so it cannot drift')
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
  const cur = document.querySelector('.cm-cursor')
  const root = getComputedStyle(document.documentElement)
  return {
    activeLine: al ? getComputedStyle(al).backgroundColor : null,
    token: root.getPropertyValue('--code-active-line').trim(),
    caretW: cur ? getComputedStyle(cur).borderLeftWidth : null,
    caretC: cur ? getComputedStyle(cur).borderLeftColor : null,
    accent: root.getPropertyValue('--accent').trim(),
  }
})
info('editor chrome: ' + JSON.stringify(chrome))
const rgb = (hex) => {
  const h = hex.replace('#', '')
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`
}
check(chrome.activeLine === rgb(chrome.token), 'active line uses --code-active-line, not oneDark', `${chrome.activeLine} vs ${chrome.token}`)
check(parseFloat(chrome.caretW) === 2, 'caret is 2px wide', chrome.caretW)
check(chrome.caretC === rgb(chrome.accent), 'caret is the amber accent, not oneDark blue', `${chrome.caretC} vs ${chrome.accent}`)
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

// Font-size preference: works and survives a reload.
const beforeSize = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).fontSize)
await page.getByRole('button', { name: 'More' }).click()
await page.waitForSelector('[role="menu"]')
await page.getByRole('menuitem', { name: /Bigger text/ }).click()
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
  await page.locator('[role="tab"]').first().click({ button: 'middle' })
  await page.waitForTimeout(150)
}
check(await page.locator('.empty--pane').isVisible(), 'closing every tab shows a designed placeholder, not a void')
check((await page.title()) === 'Warsha', 'document.title falls back with no file open', await page.title())
await shot('editor-placeholder-1280', page.locator('main'))

/* -------------------------------------------------------- 10. narrow sizes */
const filesBtn = () => page.locator('button[aria-label="Files"]')
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
check(drawerRow.height >= 44, 'rows are ≥44px on a phone', `${drawerRow?.height}px`)
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
