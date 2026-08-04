/* End-to-end verification of the real .NET-wasm + Roslyn C# runtime in the built
 * Warsha app, plus a Python regression check in the SAME build (both engines
 * registered on one page).
 *
 * Drives LOCAL Google Chrome against a served build (see WARSHA_URL below).
 * C# is same-origin, so it needs no cross-origin isolation of its own — but its
 * blocking Console.ReadLine() does, exactly like Python: the worker parks on
 * Atomics.wait, which needs SharedArrayBuffer, which needs the coi-serviceworker.
 * So this suite asserts crossOriginIsolated and treats a non-isolated page as a
 * failure of the stdin path, not a soft note (Java's suite tolerates it; C# must
 * not).
 *
 * PREREQUISITE the other suites do not have: the served build must carry the
 * staged .NET bundle at public/warsha-dotnet/_framework (build.sh, wired into the
 * app's `assets` script). Without it C# never boots and every check here fails at
 * the first Run. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
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

const profile = mkdtempSync(join(tmpdir(), 'warsha-csharp-'))

const results = []
const timings = {}
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
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

const out = () => page.locator('[aria-label="Program output"]').innerText()
// C# cold boot fetches ~37 MB of runtime + Roslyn, so give the first prompt a
// generous ceiling — the same 240s the Java suite uses for CheerpJ.
const hasOut = (s) => page.waitForFunction(
  (needle) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(needle),
  s, { timeout: 240000 })
const runBtn = () => page.getByRole('button', { name: 'Run', exact: true })
const stopBtn = () => page.getByRole('button', { name: 'Stop', exact: true })

/** Replace the active editor's content. Single-line C# avoids CodeMirror
 *  auto-indent surprises; auto-closed brackets are overtyped by our own. */
async function setEditor(text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await page.waitForTimeout(700) // 350ms persistence debounce + slack
}

/** If the entry picker is on screen (multi-file project), select `value`. */
async function selectEntry(value) {
  const picker = page.locator('select[aria-label="File to run"]')
  if (await picker.count()) {
    await picker.selectOption(value)
    await page.waitForTimeout(400)
  }
}

/** Sample the progress block + run state every 100ms, in the page. */
async function startSampler() {
  await page.evaluate(() => {
    window.__s = []
    window.__t0 = performance.now()
    clearInterval(window.__timer)
    window.__timer = setInterval(() => {
      const el = document.querySelector('[data-phase]')
      const sect = document.querySelector('section[aria-label="Console"]')
      window.__s.push({
        t: Math.round(performance.now() - window.__t0),
        present: !!el,
        phase: el?.getAttribute('data-phase') ?? null,
        text: el ? el.innerText.replace(/\s+/g, ' ').trim() : '',
        state: sect?.getAttribute('data-state') ?? null,
      })
    }, 100)
  })
}
const stopSampler = () => page.evaluate(() => { clearInterval(window.__timer); return window.__s })

/** Longest stretch (ms) with no progress block on screen, and with static text,
 *  considered only while the run is still preparing (before output starts). */
function analyse(samples) {
  const prep = samples.filter((s) => s.state === 'preparing')
  let absent = 0, run = 0
  for (const s of prep) { run = s.present ? 0 : run + 100; absent = Math.max(absent, run) }
  let staticGap = 0, cur = 0, last = null
  for (const s of prep) {
    if (s.present && s.text === last) cur += 100
    else { cur = 0; last = s.present ? s.text : null }
    staticGap = Math.max(staticGap, cur)
  }
  const phases = [...new Set(prep.filter((s) => s.present).map((s) => s.phase))]
  return { prepMs: prep.length * 100, absent, staticGap, phases, distinct: new Set(prep.map((s) => s.text)).size }
}

// ============================================================ A. cold C# run
await page.goto(BASE, { waitUntil: 'load' })
const isolated = await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
  .then(() => true).catch(() => false)
if (isolated) pass('page is cross-origin isolated (C# stdin needs SharedArrayBuffer)')
else fail('page is cross-origin isolated (C# stdin needs SharedArrayBuffer)', 'Console.ReadLine() cannot block without it')

await seedStarter(page, { lang: 'C#', name: 'C# (OOP starter)' })
await page.waitForSelector('[role="tab"]', { timeout: 10000 })
const files = await page.locator('[role="treeitem"]').allInnerTexts()
info(`explorer: ${JSON.stringify(files.map((f) => f.trim()))}`)
if (files.some((f) => f.includes('Program.cs')) && files.some((f) => f.includes('Shapes.cs')))
  pass('C# template project created', 'Program.cs + Shapes.cs')
else fail('C# template project created', JSON.stringify(files))

await startSampler()
let t = Date.now()
await runBtn().click()
await hasOut('Your name:')
timings.coldRunToPrompt = Date.now() - t
const coldSamples = await stopSampler()
const cold = analyse(coldSamples)
pass('real .NET-wasm booted and the template ran', `Run click -> ReadLine prompt in ${(timings.coldRunToPrompt / 1000).toFixed(1)}s (COLD, ~37 MB)`)
info(`progress: ${cold.prepMs}ms preparing, phases=${JSON.stringify(cold.phases)}, ${cold.distinct} distinct texts`)
info(`longest stretch with NO progress block: ${cold.absent}ms; longest with STATIC text: ${cold.staticGap}ms`)
for (const s of [...new Map(coldSamples.filter((x) => x.present).map((x) => [x.text, x])).values()].slice(0, 8))
  info(`  @${s.t}ms [${s.phase}] ${s.text.slice(0, 110)}`)
if (cold.absent <= 2000) pass('progress UI never blank >2s during boot', `max blank ${cold.absent}ms`)
else fail('progress UI never blank >2s during boot', `blank for ${cold.absent}ms`)
if (cold.staticGap <= 2000) pass('progress UI never STATIC >2s during boot', `max static ${cold.staticGap}ms (elapsed counter ticking)`)
else fail('progress UI never STATIC >2s during boot', `text frozen for ${cold.staticGap}ms`)

const beforeIn = await out()
info(`--- output before typing ---\n${beforeIn}`)
for (const [label, needle] of [
  ['header', '=== Warsha starter ==='],
  ['Circle.Describe() (polymorphism, PI area)', 'Circle: area = 12.57'],
  ['Rectangle.Describe()', 'Rectangle: area = 12.00'],
  ['interpolated total ($"{total:F2}")', 'Total area = 24.57'],
]) {
  if (beforeIn.includes(needle)) pass(`template output: ${label}`, needle)
  else fail(`template output: ${label}`, `missing "${needle}"`)
}
const ph = await page.locator('[aria-label="Program input"]').getAttribute('placeholder')
if (beforeIn.trimEnd().endsWith('Your name:') && ph === 'Type your answer, then press Enter')
  pass('ReadLine prompt painted BEFORE the read blocked', 'partial line (Console.Write), stdin row waiting')
else fail('ReadLine prompt painted BEFORE the read blocked', `ends "${beforeIn.trimEnd().slice(-20)}" / placeholder "${ph}"`)

await page.locator('[aria-label="Program input"]').fill('Warsha')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')
const afterIn = await out()
info(`--- output after typing ---\n${afterIn}`)
if (afterIn.includes('Hello, Warsha! Now open Shapes.cs and add a Square.')) pass('ReadLine round-trip completed with correct output')
else fail('ReadLine round-trip completed with correct output', afterIn.slice(-160))
if (/Your name:\s*Warsha/.test(afterIn)) pass('typed answer echoed on the prompt line')
else fail('typed answer echoed on the prompt line')
if (afterIn.includes('Finished. (exit code 0)')) pass('clean exit reported')
else fail('clean exit reported', afterIn.slice(-80))

await page.screenshot({ path: `${SHOTS}/warsha-csharp-working.png` })
info(`screenshot -> ${SHOTS}/warsha-csharp-working.png`)

// ==================================================== B. second run, same session
// The Run/Stop control ignores taps for SWAP_GUARD_MS (250ms) after it swaps
// role; wait past that. And wait for the console to CLEAR before looking for the
// prompt, or the previous run's identical text matches instantly.
await page.waitForTimeout(600)
await startSampler()
t = Date.now()
await runBtn().click()
await page.waitForFunction(() => !document.querySelector('[aria-label="Program output"]')?.innerText.includes('Hello,'), null, { timeout: 30000 })
await hasOut('Your name:')
timings.secondRunToPrompt = Date.now() - t
const warmInSession = analyse(await stopSampler())
pass('second run in the same session (worker reused, Roslyn warm)', `Run -> prompt in ${(timings.secondRunToPrompt / 1000).toFixed(1)}s`)
info(`  progress: phases=${JSON.stringify(warmInSession.phases)}, max blank ${warmInSession.absent}ms, static ${warmInSession.staticGap}ms`)
if (timings.secondRunToPrompt < timings.coldRunToPrompt) pass('warm run is faster than cold (no re-download, warm compile)', `${(timings.secondRunToPrompt / 1000).toFixed(1)}s < ${(timings.coldRunToPrompt / 1000).toFixed(1)}s`)
else fail('warm run is faster than cold', `${(timings.secondRunToPrompt / 1000).toFixed(1)}s vs ${(timings.coldRunToPrompt / 1000).toFixed(1)}s`)
await page.locator('[aria-label="Program input"]').fill('again')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')

// ================================================= C. compile error names the file
// The only fault is a missing right-hand side after `int x =`, in Program.cs.
// Roslyn's diagnostic (d.ToString()) is "Program.cs(line,col): error CSxxxx: ...".
await page.locator('[role="tab"]', { hasText: 'Program.cs' }).first().click()
await page.waitForTimeout(300)
await setEditor('using System; class Program { static void Main() { int x = ; Console.WriteLine(x); } }')
await selectEntry('Program.cs')
t = Date.now()
await runBtn().click()
await page.waitForFunction(
  () => /error CS\d|problem|ERROR/i.test(document.querySelector('[aria-label="Program output"]')?.innerText || ''),
  null, { timeout: 240000 })
await page.waitForTimeout(1000)
timings.compileError = Date.now() - t
const errOut = await out()
info(`--- compile error output ---\n${errOut}`)
if (errOut.includes('Program.cs')) pass('compile error names the student file', 'Program.cs')
else fail('compile error names the student file', errOut.slice(0, 200))
const locM = errOut.match(/Program\.cs\((\d+),(\d+)\)/)
if (locM) pass('compile error carries a line:col', `Program.cs(${locM[1]},${locM[2]})`)
else fail('compile error carries a line:col', errOut.slice(0, 160))
if (/error CS\d{3,4}/.test(errOut)) pass('Roslyn diagnostic code is shown', errOut.match(/error CS\d{3,4}/)?.[0])
else fail('Roslyn diagnostic code is shown', errOut.slice(0, 160))
if (!/\/files\/|\/str\/|warsha-run-|_framework/.test(errOut)) pass('no internal FS paths leaked into diagnostics')
else fail('no internal FS paths leaked into diagnostics', errOut.match(/[^\n]*(\/files\/|\/str\/|warsha-run-|_framework)[^\n]*/)?.[0] ?? '')
if (!errOut.includes('=== Warsha starter ===')) pass('nothing ran after a compile error')
else fail('nothing ran after a compile error')
if (/exit code [1-9]|stopped early/i.test(errOut)) pass('compile failure surfaced as a non-zero exit')
else fail('compile failure surfaced as a non-zero exit', errOut.slice(-120))
await page.screenshot({ path: `${SHOTS}/warsha-csharp-compile-error.png` })

// ============================================ D. infinite loop -> Stop -> Run again
await page.locator('[role="tab"]', { hasText: 'Program.cs' }).first().click()
await page.waitForTimeout(300)
// A genuine infinite loop, CPU-bound in the worker, but with its print rate
// throttled by a counter. .NET's Console.WriteLine is ~1000× faster than
// CheerpJ's System.out; an unthrottled while(true) print floods the main thread
// with postMessages fast enough that Playwright's Stop click can never land
// (the button resolves stable, then the click dispatch starves). Java's suite
// prints every iteration only because CheerpJ is slow enough to get away with it.
await setEditor('using System; class Program { static void Main() { long i = 0; while (true) { if (i++ % 200000 == 0) Console.WriteLine("spin"); } } }')
await selectEntry('Program.cs')
await runBtn().click()
await page.waitForFunction(
  () => (document.querySelector('[aria-label="Program output"]')?.innerText.match(/spin/g) || []).length > 20,
  null, { timeout: 240000 })
pass('infinite loop is running', 'throttled "spin" lines streaming, loop never exits')
// The warm worker reaches 20 "spin" lines in well under SWAP_GUARD_MS (250ms),
// and stop() silently returns for a tap that lands inside that guard (the guard
// exists so the fast Run->Stop role-swap does not eat a double-click). Wait it
// out, or the click is dropped and "Stopped." never comes. Java's per-run boot
// pushes its first output past the guard, so its suite never had to.
await page.waitForTimeout(400)
await stopBtn().click()
await hasOut('Stopped.')
pass('Stop killed the infinite loop', 'Stopped. Your files are all saved.')
const n1 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
await page.waitForTimeout(2000)
const n2 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
if (n1 === n2) pass('output really ceased after Stop (worker terminated)', `${n1} lines, unchanged after 2s`)
else fail('output really ceased after Stop', `${n1} -> ${n2}`)

await setEditor('using System; class Program { static void Main() { Console.WriteLine("run again works"); } }')
await selectEntry('Program.cs')
await startSampler()
t = Date.now()
await runBtn().click()
await hasOut('run again works')
timings.runAfterKill = Date.now() - t
const afterKill = analyse(await stopSampler())
pass('Run works again after Stop (worker respawned)', `finished run ${(timings.runAfterKill / 1000).toFixed(1)}s after the click (pays a full re-warm)`)
info(`  progress during re-warm: phases=${JSON.stringify(afterKill.phases)}, max blank ${afterKill.absent}ms`)
if (afterKill.absent <= 2000) pass('progress UI never blank >2s during post-kill re-warm', `max blank ${afterKill.absent}ms`)
else fail('progress UI never blank >2s during post-kill re-warm', `blank ${afterKill.absent}ms`)

// ==================================================== E. warm reload (engine cached)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.waitForTimeout(1200)
const persisted = await page.locator('.cm-content').innerText()
if (persisted.includes('run again works')) pass('C# project persisted across reload (OPFS)')
else fail('C# project persisted across reload (OPFS)', persisted.slice(0, 100))
await selectEntry('Program.cs')
await startSampler()
t = Date.now()
await runBtn().click()
await hasOut('run again works')
timings.warmReloadRun = Date.now() - t
const warm = analyse(await stopSampler())
pass('warm reload run (engine in HTTP cache, fresh worker)', `Run -> output in ${(timings.warmReloadRun / 1000).toFixed(1)}s`)
info(`  progress: phases=${JSON.stringify(warm.phases)}, ${warm.distinct} distinct texts, max blank ${warm.absent}ms, static ${warm.staticGap}ms`)
if (warm.absent <= 2000) pass('progress UI never blank >2s on a warm reload', `max blank ${warm.absent}ms`)
else fail('progress UI never blank >2s on a warm reload', `blank ${warm.absent}ms`)

// ========================================== F. Python regression in the SAME build
// Both engines are registered on one page; prove the .NET worker did not disturb
// Python's. The explorer creates a file through an inline draft row, not a dialog.
await page.getByRole('button', { name: 'New file', exact: true }).first().click()
const draftName = page.locator('[aria-label="New file name"]')
await draftName.waitFor({ timeout: 10000 })
await draftName.fill('main.py')
await draftName.press('Enter')
await page.waitForTimeout(800)
await setEditor('import sys\nprint("python still works", sys.version.split()[0])\n')
const picker = page.locator('select[aria-label="File to run"]')
if (await picker.count()) {
  await picker.selectOption('main.py')
  pass('entry picker appeared with both languages', JSON.stringify(await picker.locator('option').allInnerTexts()))
} else fail('entry picker appeared with both languages', 'no picker')
t = Date.now()
await runBtn().click()
await hasOut('python still works')
timings.pythonAfterCsharp = Date.now() - t
const pyOut = await out()
info(`--- python run (same build, after C#) ---\n${pyOut}`)
const pv = pyOut.match(/python still works (\d+\.\d+\.\d+)/)
if (pv) pass('PYTHON REGRESSION: still works in the same build', `CPython ${pv[1]}, ${(timings.pythonAfterCsharp / 1000).toFixed(1)}s cold`)
else fail('PYTHON REGRESSION: still works in the same build', pyOut.slice(-200))
if (pyOut.includes('Finished. (exit code 0)')) pass('Python clean exit after C# ran in the same session')
else fail('Python clean exit after C# ran in the same session')

// C# again after Python, to prove the two workers do not interfere.
await page.locator('[role="tab"]', { hasText: 'Program.cs' }).first().click()
await page.waitForTimeout(300)
await selectEntry('Program.cs')
t = Date.now()
await runBtn().click()
await hasOut('run again works')
timings.csharpAfterPython = Date.now() - t
pass('C# still works after Python ran (no worker/config interference)', `${(timings.csharpAfterPython / 1000).toFixed(1)}s`)
await page.screenshot({ path: `${SHOTS}/warsha-both-engines-csharp.png` })

// ---------------------------------------------------------------- console errors
const notable = consoleErrors.filter((e) => !/favicon/i.test(e) && !/404/.test(e))
if (!notable.length) pass('no unexpected console errors', `${consoleErrors.length} total, all favicon/404`)
else { fail('no unexpected console errors', `${notable.length}`); for (const e of notable.slice(0, 8)) info(`  ! ${e.slice(0, 200)}`) }

console.log('\n==== TIMINGS (in-app, local Chrome) ====')
for (const [k, v] of Object.entries(timings)) console.log(`  ${k}: ${(v / 1000).toFixed(1)}s`)
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
for (const f of failed) console.log(`FAILED: ${f[1]} :: ${f[2]}`)
await ctx.close()
process.exit(failed.length ? 1 : 0)
