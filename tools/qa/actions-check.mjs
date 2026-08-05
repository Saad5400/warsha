/* QA for tasks #24/#25 (top-right ⋯ menu): "Format file" (Java via prettier,
 * Python via black-in-Pyodide) and "Share as image…" (offscreen PNG export).
 *
 * Drives LOCAL Chrome against a live `vite` dev server (not a production
 * build — matches the pattern of the other recent per-feature suites, e.g.
 * completions-check.mjs, rather than the full build+preview cycle verify.mjs
 * uses). Start it first:
 *
 *   cd app && npx vite --port 8103
 *   cd tools/qa && node actions-check.mjs
 *
 * Overridable:
 *   WARSHA_URL    default http://127.0.0.1:8103/
 *   WARSHA_SHOTS  default tools/qa/screenshots/
 *   CHROME        default /usr/bin/google-chrome
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8103/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
mkdirSync(SHOTS, { recursive: true })

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`)
  ok ? pass++ : fail++
}

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-actions-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text())
})

// ---- shared helpers, matching the conventions in completions-check.mjs ----

const newFile = async (name) => {
  await page.locator('aside[aria-label="Files"] button[aria-label="New file"]').click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(500)
}

/** Replaces the whole document with EXACTLY `code`. `insertText` (one bulk,
 *  paste-like insertion) rather than `keyboard.type` (one keydown per
 *  character) deliberately: this file's content is brace-heavy and
 *  pre-indented, and typing it key-by-key runs straight into
 *  `closeBrackets()`'s auto-inserted `}` and `indentOnInput()`'s
 *  auto-indent-on-newline, both of which assume a human is composing the
 *  code live and compound with the literal braces/indentation already in the
 *  string — the doc this suite needs has to be exact, not "what a human
 *  typing this same text would have produced". */
const setContent = async (code) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(code)
  // Past CodeMirror's `history()` `newGroupDelay` (500ms default): an action
  // that follows within that window merges into the SAME undo group as this
  // insert, and a later "one undo step" check then undoes both together —
  // which looks exactly like an extra-large undo bug and is actually this
  // helper being called too fast. Real students do not format a file 300ms
  // after their last keystroke.
  await page.waitForTimeout(700)
}

const docText = () =>
  page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\n'))

/** Polls for exact document content, the same way `docText()` reads it — by
 *  joining `.cm-line` textContent, NOT `.cm-content.innerText`. Chrome's
 *  `innerText` inserts an extra blank line around an empty `<div class=
 *  "cm-line"><br></div>` that `.textContent` does not, so a predicate built
 *  on `innerText` never matches a formatted file with a blank line in it and
 *  looks exactly like a slow/hung format — cost real debugging time to find. */
const waitForDoc = (expected, timeout) =>
  page.waitForFunction(
    (want) => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\n').trim() === want,
    expected,
    { timeout },
  )

const lastToast = () => page.locator('[role="status"] p').last().innerText().catch(() => '')

const formatShortcut = () => page.keyboard.press('Shift+Alt+F')
const info = (m) => console.log('      ' + m)

// ---------------------------------------------------------------- 0. boot
await page.goto(URL_, { waitUntil: 'load' })
// coi-serviceworker registers then reloads the page once to obtain the
// isolation headers (documented in verify.mjs and ARCHITECTURE §2.5) — wait
// for that reload to land before doing anything else. Skipping this is not
// cosmetic: a dynamic import() started while the reload is in flight (Format
// loading prettier, Share loading html-to-image) is torn down mid-fetch and
// fails with "Failed to fetch dynamically imported module", which looked at
// first like a real bug in Format/Share instead of a test harness race.
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
// A brand-new profile lands on the welcome screen (region "Start a project").
// Its "New file" start card opens the same prompt dialog as the Explorer's —
// `dialog input` + the "Create" button — to get the very first file down and
// a real project underway; every file after this one goes through the
// Explorer's own "New file" (see `newFile()` above).
const welcome = page.locator('[role="region"][aria-label="Start a project"]')
await welcome.waitFor({ timeout: 20000 })
// Scoped to the welcome region, not page-wide: the Explorer sidebar's own
// "New file" icon button (aria-label="New file", no visible text) sits
// earlier in the DOM and also matches an unscoped `getByRole(name: /New
// file/)`, silently clicking the wrong control (it does nothing useful
// against an as-yet-empty project).
await welcome.getByRole('button', { name: /New file/ }).click()
await page.locator('dialog input').fill('Boot.java')
await page.getByRole('button', { name: 'Create' }).click()
await page.waitForSelector('aside[aria-label="Files"]', { timeout: 20000 })
await page.waitForSelector('.cm-content', { timeout: 20000 })

// -------------------------------------------------- 1. menu wiring, both items
await page.locator('button[aria-label="More"]').click()
const formatItem = page.getByRole('menuitem', { name: 'Format file' })
const shareItem = page.getByRole('menuitem', { name: 'Share as image…' })
check('Format file item is in the ⋯ menu', await formatItem.count() === 1)
check('Share as image… item is in the ⋯ menu', await shareItem.count() === 1)
// Boot.java is open (a real, formattable file), so both should be live.
check('Format file is enabled with a .java file open', await formatItem.getAttribute('disabled') === null)
check('Share as image… is enabled with a file open', await shareItem.getAttribute('disabled') === null)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

// ---------------------------------------------------- 2. Java: format exactly
const JAVA_MESSY =
  'public class Fmt{\npublic static void main(String[] args){\nint x=1;\nif(x==1){\nSystem.out.println("hi");\n}else{\nSystem.out.println("bye");\n}\n}\n}\n'
// Computed once, offline, by running the exact same prettier + prettier-plugin-java
// call this app makes (see actions/format.ts) against JAVA_MESSY in plain Node —
// not hand-guessed, so this is a real regression check, not a tautology.
const JAVA_EXPECTED =
  'public class Fmt {\n\n' +
  '    public static void main(String[] args) {\n' +
  '        int x = 1;\n' +
  '        if (x == 1) {\n' +
  '            System.out.println("hi");\n' +
  '        } else {\n' +
  '            System.out.println("bye");\n' +
  '        }\n' +
  '    }\n' +
  '}'

await newFile('Fmt.java')
await setContent(JAVA_MESSY)
const beforeJava = await docText()
await formatShortcut()
await waitForDoc(JAVA_EXPECTED, 30000) // first format pays for prettier + prettier-plugin-java + its tree-sitter wasm, all lazy
  .then(() => check('Java format produces the exact expected output', true))
  .catch(async () => check('Java format produces the exact expected output', false, await docText()))
await page.screenshot({ path: `${SHOTS}/actions-java-formatted.png` })

// One undo step: Ctrl+Z once must return the exact messy original.
await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
const undoneJava = await docText()
check(
  'Java format is exactly one undo step',
  undoneJava.trim() === beforeJava.trim(),
  undoneJava === beforeJava.trim() ? '' : `got: ${JSON.stringify(undoneJava.slice(0, 60))}`,
)
// Redo, so the rest of the suite (and the screenshot above) reflects the
// formatted file, not the undo probe.
await page.keyboard.press('Control+y')
await page.waitForTimeout(300)

// ------------------------------------------------- 3. Python: not loaded yet
await newFile('fmt_check.py')
const PY_MESSY = 'def add(a,b):\n    x=a+b\n    if x>0:\n        print( "positive" )\n    else:\n      print("non-positive")\n    return x\n'
const PY_EXPECTED =
  'def add(a, b):\n' +
  '    x = a + b\n' +
  '    if x > 0:\n' +
  '        print("positive")\n' +
  '    else:\n' +
  '        print("non-positive")\n' +
  '    return x'

await setContent(PY_MESSY)
const beforePy = await docText()
await formatShortcut()
await page.waitForTimeout(1000)
const toastText = await lastToast()
check(
  'Formatting .py before Python has ever run explains itself, does not hang',
  /run this file once/i.test(toastText),
  `toast: ${JSON.stringify(toastText)}`,
)
check('…and the file is untouched while Python is not loaded', (await docText()).trim() === beforePy.trim())

// ------------------------------------------------ 4. Python: run once, then format
// A separate, trivial file to run — PY_MESSY defines `add()` but never calls
// it, deliberately (it is the format target, not a program), so warming the
// runtime is done against its own throwaway file instead.
await newFile('warmup.py')
await setContent('print("ready for black")\n')
await page.getByRole('button', { name: /^Run\b/ }).click()
await page.waitForFunction(
  () => /ready for black/.test(document.querySelector('[aria-label="Program output"]')?.innerText ?? ''),
  null,
  { timeout: 90000 },
).then(() => check('Python ran once (booted the real Pyodide, black\'s target)', true))
  .catch(() => check('Python ran once (booted the real Pyodide, black\'s target)', false))

await page.getByRole('tab', { name: /fmt_check\.py/ }).click()
await page.waitForTimeout(300)
check('back on the format target file', (await docText()).trim() === beforePy.trim())

await formatShortcut()
await waitForDoc(PY_EXPECTED, 30000) // first format also pays micropip.install("black"), ~500 KB
  .then(() => check('Python format (black) produces the exact expected output', true))
  .catch(async () => check('Python format (black) produces the exact expected output', false, await docText()))
await page.screenshot({ path: `${SHOTS}/actions-python-formatted.png` })

await page.keyboard.press('Control+z')
await page.waitForTimeout(300)
const undonePy = await docText()
check(
  'Python format is exactly one undo step',
  undonePy.trim() === beforePy.trim(),
  undonePy === beforePy.trim() ? '' : `got: ${JSON.stringify(undonePy.slice(0, 60))}`,
)

// ------------------------------------ 4b. formatting must not corrupt tracebacks
// Regression (caught by eng-editor, fixed in worker.js, commit 6940bdd): the
// Python-side formatter function was originally named `_warsha_format`, the
// SAME name as the pre-existing traceback renderer in the same
// `pyodide.globals` namespace — the first Format click silently replaced the
// renderer, and every uncaught exception afterward crashed with a TypeError
// about argument counts ("_warsha_format() takes 1 positional argument but 2
// were given") instead of a normal traceback, until the worker respawned.
// Format has already run twice by this point in the suite (Java and Python);
// this proves an uncaught exception still renders correctly afterward.
await newFile('throws.py')
await setContent('raise ValueError("boom")\n')
await page.getByRole('button', { name: /^Run\b/ }).click()
await page.waitForFunction(
  () => /ValueError|Traceback|positional argument/.test(document.querySelector('[aria-label="Program output"]')?.innerText ?? ''),
  null,
  { timeout: 30000 },
).catch(() => {})
const tracebackOutput = await page.locator('[aria-label="Program output"]').innerText()
const corruptedRenderer = /positional argument/.test(tracebackOutput)
check(
  'formatting did not corrupt the traceback renderer (regression)',
  !corruptedRenderer && /Traceback/.test(tracebackOutput) && /ValueError: boom/.test(tracebackOutput),
  corruptedRenderer ? `BUG: renderer crashed :: ${tracebackOutput.slice(-200)}` : tracebackOutput.slice(-200),
)

// ---------------------------- 5. Share as image: desktop scale from a phone
// A deliberately long line: if the card ever wrapped to the viewport instead
// of rendering at full desktop scale, the resulting PNG would top out near
// the 390px (×2 = 780 device px) viewport width instead of far past it.
const LONG_LINE = 'x' + '_very_long_identifier_name_that_forces_a_wide_line'.repeat(4) + ' = 1  # ' + 'a'.repeat(40)
await newFile('wide_check.py')
await setContent(`${LONG_LINE}\nprint(${JSON.stringify('done')})\n`)
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(200)

// navigator.share/canShare are unavailable in headless Linux Chrome (no OS
// share-sheet integration), so shareFileAsImage() takes its documented
// fallback path — a real browser download — which is also the only path a
// script can observe without a live share-sheet to click through.
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.locator('button[aria-label="More"]').click().then(() => page.getByRole('menuitem', { name: 'Share as image…' }).click()),
])
const pngPath = await download.path()
check('Share as image triggered a real download (fallback path)', !!pngPath, download.suggestedFilename())

const pngBytes = pngPath ? readFileSync(pngPath) : Buffer.alloc(0)
const pngBase64 = pngBytes.toString('base64')
const image = await page.evaluate(async (base64) => {
  const img = new Image()
  img.src = `data:image/png;base64,${base64}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const g = canvas.getContext('2d')
  g.drawImage(img, 0, 0)
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height)
  const first = [data[0], data[1], data[2], data[3]]
  let differing = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2] || data[i + 3] !== first[3]) differing++
  }
  return { width: canvas.width, height: canvas.height, differingPixels: differing }
}, pngBase64)

info(`share-as-image PNG: ${JSON.stringify(image)}`)
// The founder rule: full desktop scale, never phone-shrunk, regardless of the
// viewport it was made on. Captured at a 390px (×2 = 780 device px) viewport;
// a wrapped/shrunk render would top out near there. The long line above is
// ~260 characters, so an unwrapped render at editor-scale monospace is
// comfortably north of 1500 device px.
check('PNG rendered at full desktop scale, not the 390px phone viewport', image.width > 1200, `width=${image.width}px`)
check('PNG is a real card, not a blank canvas', image.differingPixels > 1000, `${image.differingPixels} differing pixels`)
await page.setViewportSize({ width: 1280, height: 900 })

// ------------------------------------------------------------------ console
if (errors.length === 0) check('no console errors', true)
else check('no console errors', false, `${errors.length}: ${errors.slice(0, 3).join(' | ')}`)

// ------------------------------------------------------------------ summary
console.log(`\n==== ${pass}/${pass + fail} checks passed ====`)
await ctx.close()
process.exit(fail ? 1 : 0)
