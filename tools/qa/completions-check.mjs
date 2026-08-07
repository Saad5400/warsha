/* QA for the three IntelliSense gaps (task #23): auto-import, import-statement
 * completion, and member/method completion after `variable.` — Java and
 * Python. Drives the real completion popup, not the completion sources
 * directly, so it proves what a student would actually see. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8102/'
import { fileURLToPath } from 'node:url'
import { mkdirSync as __mkdirSync } from 'node:fs'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
__mkdirSync(SHOTS, { recursive: true })
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-completions-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1100, height: 820 },
})
const page = ctx.pages()[0]
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`)
  ok ? pass++ : fail++
}

const newFile = async (name) => {
  await page.locator('aside[aria-label="Files"] button[aria-label="New file"]').click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(900)
}
/** Forces the popup via Ctrl+Space (not activateOnTyping's heuristics) so every scenario is explicit. */
const type = async (code) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type(code)
  await page.keyboard.press('Control+Space')
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(150)
}
const popupLabels = () => page.locator('.cm-tooltip-autocomplete .cm-completionLabel').allTextContents()
const docLines = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent))
/** Exact match, not fuzzy — `Scanner` (class) and `scanner` (snippet) share
 *  letters; only the exact label distinguishes them. */
const accept = async (label) => {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await page
    .locator('.cm-tooltip-autocomplete .cm-completionLabel')
    .filter({ hasText: new RegExp(`^${esc}$`) })
    .first()
    .click()
  await page.waitForTimeout(250)
}

await page.goto(URL_, { waitUntil: 'load' })
await page.waitForTimeout(2000)
await page.waitForSelector('[role="tree"]', { timeout: 20000 })

/* ================================================================== Java ================================================================== */

await newFile('Demo.java')

console.log('\n--- Java: member completion after `sc.`')
await type('public class Demo {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    sc.')
let labels = await popupLabels()
check('sc. offers Scanner’s methods', labels.includes('nextInt') && labels.includes('nextLine'), JSON.stringify(labels.slice(0, 8)))
await page.screenshot({ path: join(SHOTS, 'completions-java-member.png') })
await page.keyboard.press('Escape')

console.log('\n--- Java: auto-import on accepting a class completion')
await type('public class Demo {\n  public static void main(String[] args) {\n    Scan')
labels = await popupLabels()
check('"Scan" offers Scanner', labels.includes('Scanner'), JSON.stringify(labels.slice(0, 8)))
await accept('Scanner')
let lines = await docLines()
check('accepting Scanner inserts import java.util.Scanner; at the top', lines[0] === 'import java.util.Scanner;', JSON.stringify(lines.slice(0, 3)))
check('the completion itself still landed as "Scanner"', lines.some((l) => l.trim().endsWith('Scanner')), JSON.stringify(lines.slice(0, 6)))
await page.screenshot({ path: join(SHOTS, 'completions-java-autoimport.png') })

console.log('\n--- Java: import-statement completion, segment then class')
await type('import java.uti')
labels = await popupLabels()
check('"import java.uti" offers util', labels.includes('util'), JSON.stringify(labels))
await page.screenshot({ path: join(SHOTS, 'completions-java-import.png') })
await accept('util')
await page.keyboard.type('Arr')
await page.keyboard.press('Control+Space')
await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 })
labels = await popupLabels()
check('"import java.util.Arr" offers ArrayList', labels.includes('ArrayList'), JSON.stringify(labels))
await accept('ArrayList')
lines = await docLines()
check('import statement completes to "import java.util.ArrayList;"', lines[0] === 'import java.util.ArrayList;', lines[0])

console.log('\n--- Java: modern Java 17 completions (var, streams, Optional)')
await type('public class Demo {\n  public static void main(String[] args) {\n    va')
labels = await popupLabels()
check('"va" offers the var keyword', labels.includes('var'), JSON.stringify(labels.slice(0, 8)))
await page.keyboard.press('Escape')

await type('public class Demo {\n  void go() {\n    Optional.')
labels = await popupLabels()
check('Optional. offers of / ofNullable', labels.includes('of') && labels.includes('ofNullable'), JSON.stringify(labels.slice(0, 8)))
await page.keyboard.press('Escape')

await type('public class Demo {\n  void go() {\n    String w = "hi";\n    w.')
labels = await popupLabels()
check('a String var offers the modern methods (strip, repeat, isBlank)', labels.includes('strip') && labels.includes('repeat') && labels.includes('isBlank'), JSON.stringify(labels.slice(0, 10)))
await page.keyboard.press('Escape')

await type('import java.util.stream.Collec')
labels = await popupLabels()
check('"import java.util.stream.Collec" offers Collectors', labels.includes('Collectors'), JSON.stringify(labels))
await page.keyboard.press('Escape')

await type('public class Demo {\n  void go() {\n    Collec')
labels = await popupLabels()
check('"Collec" offers Collectors', labels.includes('Collectors'), JSON.stringify(labels.slice(0, 8)))
await accept('Collectors')
lines = await docLines()
check('accepting Collectors auto-imports java.util.stream.Collectors', lines[0] === 'import java.util.stream.Collectors;', JSON.stringify(lines.slice(0, 3)))
await page.screenshot({ path: join(SHOTS, 'completions-java-modern.png') })

/* ================================================================ Python ================================================================ */

await newFile('demo.py')

console.log('\n--- Python: member completion after `s.`')
await type('s = "hello"\ns.')
labels = await popupLabels()
check('s. offers str’s methods', labels.includes('upper') && labels.includes('strip'), JSON.stringify(labels.slice(0, 8)))
await page.screenshot({ path: join(SHOTS, 'completions-python-member.png') })
await page.keyboard.press('Escape')

console.log('\n--- Python: dictionary word offers an auto-import variant')
await type('x = sqrt')
labels = await popupLabels()
check('"sqrt" offers the math.sqrt variant', labels.includes('math.sqrt'), JSON.stringify(labels))
await accept('math.sqrt')
lines = await docLines()
check('accepting math.sqrt inserts import math at the top', lines[0] === 'import math', lines[0])
check('accepting math.sqrt writes the qualified call', lines.some((l) => l.includes('x = math.sqrt')), JSON.stringify(lines))
await page.screenshot({ path: join(SHOTS, 'completions-python-autoimport.png') })

console.log('\n--- Python: `import ` completes stdlib module names')
await type('import ra')
labels = await popupLabels()
check('"import ra" offers random', labels.includes('random'), JSON.stringify(labels))
await page.screenshot({ path: join(SHOTS, 'completions-python-import.png') })
await accept('random')
lines = await docLines()
check('import statement completes to "import random"', lines[0] === 'import random', lines[0])

console.log('\n--- Python: member completion resolves a module import, not just a variable')
await type('import math\nmath.')
labels = await popupLabels()
check('math. (module) offers math’s functions', labels.includes('sqrt') && labels.includes('factorial'), JSON.stringify(labels.slice(0, 8)))

console.log('\nerrors: ' + (errors.length ? JSON.stringify(errors) : 'none'))
console.log(`\n==== completions: ${pass}/${pass + fail} passed ====`)
await ctx.close()
process.exit(fail ? 1 : 0)
