/* Snippets + completion verification, against the built app on :8088.
 * No engines involved — this is all editor behaviour. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const results = []
const pass = (n, d = '') => { results.push([1, n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push([0, n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (ok, n, d = '') => (ok ? pass(n, d) : fail(n, d))
const info = (m) => console.log('      ' + m)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-cmp-')), {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const popup = () => page.locator('.cm-tooltip-autocomplete')
const options = () => page.locator('.cm-tooltip-autocomplete li')
const doc = () => page.evaluate(() => document.querySelector('.cm-content').innerText)
const sel = () => page.evaluate(() => String(getSelection()))

/** Empty the editor and type fresh. Avoids closeBrackets surprises. */
async function fresh(text = '') {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.type(text)
}

await page.goto('http://localhost:8088/', { waitUntil: 'load' })
await page.waitForTimeout(2500)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })

/* ------------------------------------------------------------ Java snippets */
await page.getByRole('button', { name: /Java \(OOP starter\)/ }).click()
await page.waitForSelector('.cm-content', { timeout: 10000 })
await page.waitForTimeout(800)

await fresh('sout')
await page.waitForTimeout(400)
check(await popup().isVisible(), 'typing `sout` opens the completion popup')
const labels = await options().allInnerTexts()
info('offered: ' + JSON.stringify(labels.slice(0, 4)))
check(labels[0].startsWith('sout'), 'the snippet is the top suggestion', JSON.stringify(labels[0]))
const iconGlyph = await page.locator('.cm-tooltip-autocomplete li .cm-completionIcon').first().evaluate((el) => ({
  glyph: getComputedStyle(el, '::after').content,
  color: getComputedStyle(el).color,
  accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
}))
check(iconGlyph.glyph === '"{}"', 'snippets carry an ASCII {} icon, not an SMP glyph', JSON.stringify(iconGlyph))
const rowH = (await options().first().boundingBox()).height
check(rowH >= 44, 'completion rows are ≥44px so they can be tapped', `${rowH}px`)
const matched = await page.locator('.cm-completionMatchedText').first().evaluate((el) => getComputedStyle(el).color)
check(matched === 'rgb(242, 169, 75)', 'the matched prefix is highlighted in accent', matched)
await page.screenshot({ path: join(SHOTS, 'files-complete-sout-1280.png') })

await page.keyboard.press('Tab')
await page.waitForTimeout(300)
let text = await doc()
check(text.trim() === 'System.out.println();', 'Tab expands `sout` to System.out.println();', JSON.stringify(text.trim()))
// The caret must land inside the parens, not after the statement. Checked
// behaviourally — CodeMirror splits a line into several text nodes, so the DOM
// selection offset says nothing on its own.
await page.keyboard.type('"hi"')
await page.waitForTimeout(200)
text = await doc()
check(text.trim() === 'System.out.println("hi");', 'the caret lands between the parentheses', JSON.stringify(text.trim()))

// Enter also accepts (completionKeymap is Prec.highest, so it beats newline).
await fresh('psvm')
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
text = await doc()
check(/public static void main\(String\[\] args\) \{/.test(text), 'Enter accepts, and `psvm` writes a main method', JSON.stringify(text))
check(/\n {4}\n\}/.test(text) || /\{\n\s+\n\}/.test(text), 'the main body is indented one level', JSON.stringify(text))

await fresh('main')
await page.waitForTimeout(400)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
check(/public static void main/.test(await doc()), '`main` is an alias for the same method (VS Code muscle memory)')

/* ---------------------------------------------- tab-through placeholders */
await fresh('fori')
await page.waitForTimeout(400)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
text = await doc()
check(/for \(int i = 0; i < count; i\+\+\) \{/.test(text), '`fori` expands to a counted loop', JSON.stringify(text.split('\n')[0]))
check((await sel()) === 'count', 'the first placeholder is selected, ready to be typed over', JSON.stringify(await sel()))
await page.keyboard.type('10')
await page.keyboard.press('Tab')
await page.waitForTimeout(250)
const afterTab = await page.evaluate(() => {
  const s = getSelection()
  return { line: (s.anchorNode.textContent ?? '').trim(), collapsed: s.isCollapsed }
})
text = await doc()
check(/i < 10;/.test(text), 'typing over the placeholder rewrites it', JSON.stringify(text.split('\n')[0]))
check(afterTab.collapsed && !/for \(/.test(afterTab.line), 'Tab moves to the loop body', JSON.stringify(afterTab))
await page.screenshot({ path: join(SHOTS, 'files-complete-fori-1280.png') })

/* -------------------------------------------------------- Ctrl-Space + Esc */
await fresh('')
await page.keyboard.press('Control+Space')
await page.waitForTimeout(400)
check(await popup().isVisible(), 'Ctrl+Space opens completions with nothing typed')
const explicitCount = await options().count()
info(`${explicitCount} options on an explicit request`)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
check(!(await popup().isVisible()), 'Escape dismisses the popup')

/* ----------------------------------------------- keywords + API dictionary */
await fresh('Scan')
await page.waitForTimeout(400)
const scanLabels = await options().allInnerTexts()
check(scanLabels.some((l) => l.startsWith('Scanner')), 'the API dictionary offers Scanner', JSON.stringify(scanLabels.slice(0, 3)))
check(scanLabels.some((l) => /reads what the user types/.test(l)), 'API entries carry a plain-English detail')

await fresh('impl')
await page.waitForTimeout(400)
check((await options().allInnerTexts()).some((l) => l.startsWith('implements')), 'keywords complete')

/* ------------------------------------------ identifiers from OTHER files */
// `describe()` is defined in models/Person.java, never typed in this buffer.
await fresh('descr')
await page.waitForTimeout(500)
const cross = await options().allInnerTexts()
check(cross.some((l) => l.startsWith('describe')), 'identifiers from other project files complete', JSON.stringify(cross.slice(0, 3)))

/* ------------------------------------------------ quiet inside strings */
await fresh('String s = "hello wor')
await page.waitForTimeout(500)
check(!(await popup().isVisible()), 'no popup inside a string literal')
await fresh('// this is a comm')
await page.waitForTimeout(500)
check(!(await popup().isVisible()), 'no popup inside a comment')

/* ------------------------------------------------------- Python snippets */
await page.getByRole('button', { name: 'More' }).click()
await page.waitForSelector('[role="menu"]')
const menu = await page.locator('[role="menuitem"]').allInnerTexts()
info('overflow menu: ' + JSON.stringify(menu))
await page.keyboard.press('Escape')

// Make a .py file so the Python sources load.
await page.locator('aside[aria-label="Files"]').getByRole('button', { name: 'New file' }).click()
const nameField = page.locator('[role="tree"] input')
await nameField.fill('snips.py')
await nameField.press('Enter')
await page.waitForTimeout(900)

await fresh('main')
await page.waitForTimeout(500)
const pyLabels = await options().allInnerTexts()
info('python `main`: ' + JSON.stringify(pyLabels.slice(0, 3)))
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
text = await doc()
check(/if __name__ == "__main__":/.test(text), 'Python `main` writes the __main__ guard', JSON.stringify(text))

await fresh('fori')
await page.waitForTimeout(400)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
text = await doc()
check(/for i in range\(n\):/.test(text), 'Python `fori` expands', JSON.stringify(text.split('\n')[0]))
check((await sel()) === 'n', 'its placeholder is selected')

await fresh('class')
await page.waitForTimeout(400)
await page.keyboard.press('Tab')
await page.waitForTimeout(300)
text = await doc()
check(/class Name:/.test(text) && /def __init__\(self/.test(text), 'Python `class` writes a class with __init__', JSON.stringify(text))
await page.screenshot({ path: join(SHOTS, 'files-complete-python-1280.png') })

await fresh('pri')
await page.waitForTimeout(400)
const pyApi = await options().allInnerTexts()
check(pyApi.some((l) => l.startsWith('print')), 'Python API dictionary offers print', JSON.stringify(pyApi.slice(0, 3)))
check(!pyApi.some((l) => l.startsWith('psvm')), 'Java snippets do not leak into a .py file', JSON.stringify(pyApi.slice(0, 6)))

/* ------------------------------------------------------------- 390px popup */
await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(500)
await fresh('for')
await page.waitForTimeout(500)
check(await popup().isVisible(), 'the popup opens at 390px')
const fit = await popup().evaluate((el) => {
  const r = el.getBoundingClientRect()
  return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), vw: innerWidth }
})
check(fit.left >= 0 && fit.right <= fit.vw, 'the popup stays inside the viewport at 390px', JSON.stringify(fit))
// The detail gloss stays at 390px — measured to fit beside the label — but it
// must not push the row past the popup's own box.
const detailFits = await page.evaluate(() => {
  const li = [...document.querySelectorAll('.cm-tooltip-autocomplete li')].find((x) => x.querySelector('.cm-completionDetail'))
  if (!li) return null
  const row = li.getBoundingClientRect()
  const d = li.querySelector('.cm-completionDetail').getBoundingClientRect()
  const label = li.querySelector('.cm-completionLabel')
  return { rowRight: Math.round(row.right), detailRight: Math.round(d.right), ellipsis: getComputedStyle(label).textOverflow }
})
check(detailFits && detailFits.detailRight <= detailFits.rowRight && detailFits.ellipsis === 'ellipsis',
  'the detail gloss fits inside the row at 390px, label ellipsizes first', JSON.stringify(detailFits))
const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
check(noHScroll, 'the page still does not scroll horizontally')
await page.screenshot({ path: join(SHOTS, 'files-complete-390.png') })

console.log('\nconsole errors: ' + (errors.length ? JSON.stringify(errors.slice(0, 5)) : 'none'))
const failed = results.filter((r) => !r[0])
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) console.log(failed.map((f) => '  FAIL ' + f[1] + (f[2] ? ' :: ' + f[2] : '')).join('\n'))
await ctx.close()
