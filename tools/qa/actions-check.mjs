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
// Desktop share path copies the PNG to the clipboard (deliver.ts); read back here to verify pixels.
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL_.replace(/\/$/, '') })
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

/** Replaces the whole doc with EXACTLY `code`, via `insertText` (bulk paste)
 *  not `keyboard.type` — typing key-by-key would trigger closeBrackets/
 *  auto-indent and corrupt this brace-heavy, pre-indented content. */
const setContent = async (code) => {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(code)
  // Past CodeMirror's 500ms newGroupDelay — otherwise a later action merges
  // into this insert's undo group and "one undo step" checks fail.
  await page.waitForTimeout(700)
}

const docText = () =>
  page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent).join('\n'))

/** Polls via `.cm-line` textContent, matching `docText()` — NOT innerText,
 *  which inserts an extra blank line around an empty cm-line and never
 *  matches a formatted file that has one. */
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
// coi-serviceworker reloads once for isolation headers — a dynamic import()
// started mid-reload gets torn down and fails to fetch, which looks like a
// real Format/Share bug but is a harness race.
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
// Welcome screen's own "New file" card opens the same dialog as the
// Explorer's, to get the first file down; every file after uses newFile().
const welcome = page.locator('[role="region"][aria-label="Start a project"]')
await welcome.waitFor({ timeout: 20000 })
// Scoped to the welcome region — an unscoped query would also match the
// Explorer's own "New file" button earlier in the DOM.
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
// Computed offline via the same prettier + prettier-plugin-java call as
// actions/format.ts — not hand-guessed.
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
// Redo so the rest of the suite reflects the formatted file, not the undo probe.
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
// Separate throwaway file to warm the runtime — PY_MESSY is the format
// target, not something meant to run.
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
// Regression (commit 6940bdd): the formatter and traceback renderer shared
// the name `_warsha_format` in pyodide.globals, so formatting silently
// clobbered the renderer. Confirms exceptions still render correctly after
// two formats.
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
// Deliberately long line — a viewport-wrapped render would top out near 780
// device px instead of far past it.
const LONG_LINE = 'x' + '_very_long_identifier_name_that_forces_a_wide_line'.repeat(4) + ' = 1  # ' + 'a'.repeat(40)
await newFile('wide_check.py')
await setContent(`${LONG_LINE}\nprint(${JSON.stringify('done')})\n`)
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(200)

// hover+fine context takes deliver.ts's desktop path (clipboard first,
// download fallback) — either yields PNG bytes for the checks below.
const downloadP = page.waitForEvent('download', { timeout: 20000 }).then((d) => ({ kind: 'downloaded', d })).catch(() => null)
const copiedP = page
  .waitForFunction(
    () => [...document.querySelectorAll('[role="status"]')].some((el) => el.innerText.includes('Image copied')),
    null,
    { timeout: 20000 },
  )
  .then(() => ({ kind: 'copied' }))
  .catch(() => null)
await page.locator('button[aria-label="More"]').click()
await page.getByRole('menuitem', { name: 'Share as image…' }).click()
const delivered = await Promise.race([downloadP, copiedP])
check('Share as image delivered (clipboard copy or download)', !!delivered, delivered?.kind ?? 'neither within 20s')

let pngBase64 = ''
if (delivered?.kind === 'downloaded') {
  const pngPath = await delivered.d.path()
  pngBase64 = pngPath ? readFileSync(pngPath).toString('base64') : ''
} else if (delivered?.kind === 'copied') {
  pngBase64 = await page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (!item.types.includes('image/png')) continue
      const bytes = new Uint8Array(await (await item.getType('image/png')).arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768))
      return btoa(bin)
    }
    return ''
  })
  check('copied image is really on the clipboard as image/png', pngBase64.length > 0, `${pngBase64.length} b64 chars`)
}
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
// Founder rule: always full desktop scale, never phone-shrunk. A wrapped
// render would top out near 780 device px; unwrapped comfortably exceeds 1500.
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
