/* End-to-end verification of the real Pyodide runtime inside the built Warsha app.
 *
 * Drives LOCAL Google Chrome against a served build (see WARSHA_URL below) (a secure context, so
 * coi-serviceworker can register and SharedArrayBuffer becomes available).
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* Overridable so this runs anywhere:
 *   WARSHA_URL    base URL of a SERVED BUILD  (default http://127.0.0.1:8086/)
 *   WARSHA_SHOTS  where screenshots land      (default tools/qa/screenshots/)
 *   CHROME        Chrome binary               (default /usr/bin/google-chrome)
 *
 * 127.0.0.1 rather than localhost deliberately: a preview server bound to IPv4
 * only is unreachable via "localhost" when Chrome resolves it to ::1 first. */
const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
mkdirSync(SHOTS, { recursive: true })


const profile = mkdtempSync(join(tmpdir(), 'warsha-verify-'))

const results = []
const pass = (name, detail = '') => { results.push(['PASS', name, detail]); console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`) }
const fail = (name, detail = '') => { results.push(['FAIL', name, detail]); console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})

const page = ctx.pages()[0] ?? (await ctx.newPage())

const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))

let navigations = 0
page.on('framenavigated', (f) => { if (f === page.mainFrame() && f.url().startsWith(BASE)) navigations++ })

const outputText = () => page.locator('[aria-label="Program output"]').innerText()

// ---------------------------------------------------------------- 1. first visit
await page.goto(BASE, { waitUntil: 'load' })
// coi-serviceworker registers then reloads to obtain the isolation headers.
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
  .then(() => pass('cross-origin isolation achieved', 'crossOriginIsolated === true'))
  .catch(() => fail('cross-origin isolation achieved', 'still false after 30s'))

const env = await page.evaluate(() => ({
  coi: self.crossOriginIsolated,
  sab: typeof SharedArrayBuffer === 'function',
  sw: navigator.serviceWorker?.controller?.scriptURL ?? null,
  opfs: typeof navigator.storage?.getDirectory === 'function',
}))
info(`env: ${JSON.stringify(env)}`)
if (env.sab) pass('SharedArrayBuffer available'); else fail('SharedArrayBuffer available')
if (env.sw && env.sw.includes('coi-serviceworker')) pass('coi-serviceworker is controlling', env.sw)
else fail('coi-serviceworker is controlling', String(env.sw))
info(`main-frame navigations so far: ${navigations} (1 goto + 1 coi reload expected)`)
if (navigations === 2) pass('exactly ONE automatic reload on first visit', `${navigations} navigations total`)
else fail('exactly ONE automatic reload on first visit', `${navigations} navigations total`)

// ------------------------------------------------------- 2. create Python project
await page.getByRole('button', { name: /Python starter/ }).click()
await page.waitForSelector('[role="tab"]', { timeout: 10000 })
const tabs = await page.locator('[role="tab"]').allInnerTexts()
info(`open tabs: ${JSON.stringify(tabs)}`)
if (tabs.some((t) => t.includes('main.py'))) pass('Python template project created', `tabs: ${tabs.join(', ')}`)
else fail('Python template project created', `tabs: ${tabs.join(', ')}`)

// Record structured-progress samples straight off the ProgressBlock DOM.
await page.evaluate(() => {
  window.__progress = []
  const grab = () => {
    const el = document.querySelector('[data-phase]')
    if (!el) return
    const sample = { phase: el.getAttribute('data-phase'), text: el.innerText.replace(/\n/g, ' | ') }
    const last = window.__progress[window.__progress.length - 1]
    if (!last || last.text !== sample.text) window.__progress.push(sample)
  }
  window.__progressTimer = setInterval(grab, 100)
})

// ------------------------------------------------------------------- 3. first Run
await page.getByRole('button', { name: 'Run', exact: true }).click()

// The template's input() prompt must be painted BEFORE input is requested.
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Your name:'),
  null,
  { timeout: 180000 },
)
const promptSeenAt = Date.now()
pass('real Pyodide booted and program ran', 'prompt "Your name:" reached the console')

const samples = await page.evaluate(() => { clearInterval(window.__progressTimer); return window.__progress })
info(`progress samples (${samples.length}):`)
for (const s of samples.slice(0, 12)) info(`  [${s.phase}] ${s.text}`)
if (samples.length) pass('progress block rendered during boot', `${samples.length} distinct samples`)
else fail('progress block rendered during boot', 'no [data-phase] element ever appeared')
const downloadSamples = samples.filter((s) => s.phase === 'download')
const withBytes = downloadSamples.filter((s) => /\d+\.\d MB/.test(s.text))
if (withBytes.length) pass('determinate byte counter worked', `${withBytes.length} download samples carried MB figures; e.g. ${withBytes[withBytes.length - 1].text}`)
else fail('determinate byte counter worked', `download samples: ${downloadSamples.length}`)

const beforeInput = await outputText()
info(`--- output before typing ---\n${beforeInput}`)

// Program output correctness (computed by real CPython, not a fake).
const expectBefore = ['=== Warsha starter ===', 'Circle: area = 12.57', 'Rectangle: area = 12.00', 'Total area = 24.57']
const missing = expectBefore.filter((s) => !beforeInput.includes(s))
if (!missing.length) pass('template output is correct', expectBefore.join(' / '))
else fail('template output is correct', `missing: ${JSON.stringify(missing)}`)

// The stdin row must be in its waiting state, and the prompt must already be visible.
const waiting = await page.locator('[aria-label="Program input"]').getAttribute('placeholder')
if (waiting === 'Type your answer, then press Enter') pass('stdin row switched to waiting state', `placeholder: "${waiting}"`)
else fail('stdin row switched to waiting state', `placeholder: "${waiting}"`)
if (beforeInput.includes('Your name:') && !beforeInput.includes('Hello,'))
  pass('input() prompt appeared BEFORE input was requested', 'partial line painted with no trailing newline')
else fail('input() prompt appeared BEFORE input was requested')

// --------------------------------------------------------------- 4. type a line
await page.locator('[aria-label="Program input"]').fill('Warsha')
await page.locator('[aria-label="Program input"]').press('Enter')
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Finished'),
  null,
  { timeout: 30000 },
)
const afterInput = await outputText()
info(`--- output after typing ---\n${afterInput}`)
if (afterInput.includes('Hello, Warsha! Now open helpers/shapes.py and add a Square.'))
  pass('stdin delivered; program completed with correct output')
else fail('stdin delivered; program completed with correct output')
if (afterInput.includes('Finished. (exit code 0)')) pass('clean exit reported', 'Finished. (exit code 0)')
else fail('clean exit reported')
// The echoed answer must sit on the prompt's own line.
if (/Your name:\s*Warsha/.test(afterInput)) pass('answer echoed on the prompt line', 'Your name: Warsha')
else fail('answer echoed on the prompt line', 'prompt/answer did not share a line')

await page.screenshot({ path: `${SHOTS}/warsha-python-working.png` })
info(`screenshot -> ${SHOTS}/warsha-python-working.png`)

// ------------------------------------------- 5. infinite loop -> Stop -> Run again
// Single-line body so CodeMirror's auto-indent cannot mangle it.
await page.locator('.cm-content').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('while True: print("spin")')
await page.waitForTimeout(600) // let the 350ms debounce flush to OPFS

await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.waitForFunction(
  () => (document.querySelector('[aria-label="Program output"]')?.innerText.match(/spin/g) || []).length > 20,
  null,
  { timeout: 60000 },
)
pass('infinite loop is running', 'many "spin" lines streaming')

await page.getByRole('button', { name: 'Stop', exact: true }).click()
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Stopped.'),
  null,
  { timeout: 20000 },
)
pass('Stop killed the infinite loop', 'Stopped. Your files are all saved.')

// Confirm it really stopped: line count must be stable a moment later.
const n1 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
await page.waitForTimeout(1500)
const n2 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
if (n1 === n2) pass('output really ceased after Stop', `${n1} lines, unchanged after 1.5s`)
else fail('output really ceased after Stop', `${n1} -> ${n2}`)

// Run again (this pays the worker re-warm).
await page.locator('.cm-content').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('print("run again works")')
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('run again works'),
  null,
  { timeout: 60000 },
)
const afterRerun = await outputText()
if (afterRerun.includes('run again works') && afterRerun.includes('Finished. (exit code 0)'))
  pass('Run works again after Stop', 'fresh worker executed a new program to exit 0')
else fail('Run works again after Stop', afterRerun.slice(-200))

// ------------------------------------------------------------- 6. reload -> OPFS
navigations = 0
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.waitForTimeout(1000)
const persisted = await page.locator('.cm-content').innerText()
const persistedTabs = await page.locator('[role="tab"]').allInnerTexts()
info(`after reload, editor content: ${JSON.stringify(persisted.slice(0, 80))}`)
info(`after reload, tabs: ${JSON.stringify(persistedTabs)}`)
if (persisted.includes('run again works')) pass('project persisted across reload (OPFS)', 'edited main.py came back')
else fail('project persisted across reload (OPFS)', `editor held: ${persisted.slice(0, 120)}`)
if (persistedTabs.some((t) => t.includes('main.py'))) pass('open tabs restored (localStorage)', persistedTabs.join(', '))
else fail('open tabs restored (localStorage)', persistedTabs.join(', '))
if (navigations <= 1) pass('no extra coi reload on a return visit', `${navigations} navigation(s)`)
else fail('no extra coi reload on a return visit', `${navigations} navigations`)

// Prove the runtime still works after a reload, and grab the final screenshot with
// the template restored so the shot shows real, meaningful Python output.
await page.locator('.cm-content').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('import sys\nprint("Python", sys.version.split()[0], "in the browser")\nfor i in range(3): print("  line", i)\n')
await page.waitForTimeout(600)
await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('in the browser'),
  null,
  { timeout: 90000 },
)
const versionOut = await outputText()
info(`--- version run ---\n${versionOut}`)
const m = versionOut.match(/Python (\d+\.\d+\.\d+) in the browser/)
if (m) pass('real CPython version reported by the engine', `CPython ${m[1]}`)
else fail('real CPython version reported by the engine')
await page.screenshot({ path: `${SHOTS}/warsha-python-version.png` })

// ------------------------------------------------------------------ console errors
const notable = consoleErrors.filter((e) => !/favicon/i.test(e))
if (notable.length === 0) pass('no console errors')
else { fail('no console errors', `${notable.length} error(s)`); for (const e of notable.slice(0, 10)) info(`  ! ${e}`) }

// ------------------------------------------------------------------------ summary
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
for (const f of failed) console.log(`FAILED: ${f[1]} :: ${f[2]}`)

await ctx.close()
process.exit(failed.length ? 1 : 0)
