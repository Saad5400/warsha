/* End-to-end verification of the real CheerpJ Java runtime in the built Warsha app,
 * plus a Python regression check in the SAME build (both engines registered).
 *
 * Drives LOCAL Google Chrome against a served build (see WARSHA_URL below) (secure context, so the
 * app's coi-serviceworker works for Python; Java needs no isolation of its own). */
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


const profile = mkdtempSync(join(tmpdir(), 'warsha-java-'))

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
const hasOut = (s) => page.waitForFunction(
  (needle) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(needle),
  s, { timeout: 240000 })
const runBtn = () => page.getByRole('button', { name: 'Run', exact: true })
const stopBtn = () => page.getByRole('button', { name: 'Stop', exact: true })

/** Replace the active editor's content. Single-line Java avoids CodeMirror
 *  auto-indent surprises; auto-closed brackets are overtyped by our own. */
async function setEditor(text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await page.waitForTimeout(700) // 350ms persistence debounce + slack
}

/** models/Person.java as the template ships it, plus the divide() section C2 crashes through. */
const PERSON_OK =
  'package models; public class Person { private String name; private int age; ' +
  'public Person(String n, int a) { name = n; age = a; } ' +
  'public String getName() { return name; } ' +
  'public int getAge() { return age; } ' +
  'public String describe() { return name + ", age " + age; } ' +
  'public static int divide(int a, int b) { return a / b; } }'

/**
 * The uncaught-exception report on its own: the "Exception in thread" line and
 * the frame / "Caused by:" / "... N more" lines under it, stopping at the first
 * line that is none of those (the console's own "stopped early" note).
 */
function traceBlock(text) {
  const at = text.indexOf('Exception in thread')
  if (at < 0) return ''
  const lines = text.slice(at).split('\n')
  const end = lines.findIndex((l, i) => i > 0 && !/^(\s+at |Caused by: |\s+\.\.\. \d+ more|\s+Suppressed: )/.test(l))
  return (end < 0 ? lines : lines.slice(0, end)).join('\n').trimEnd()
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

// ============================================================ A. cold Java run
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
  .then(() => info('page is cross-origin isolated (Python needs it; Java does not)'))
  .catch(() => info('NOT isolated — Java should still work'))

await page.getByRole('button', { name: /Java \(OOP starter\)/ }).click()
await page.waitForSelector('[role="tab"]', { timeout: 10000 })
const files = await page.locator('[role="treeitem"]').allInnerTexts()
info(`explorer: ${JSON.stringify(files.map((f) => f.trim()))}`)
if (files.some((f) => f.includes('Main.java'))) pass('Java template project created')
else fail('Java template project created', JSON.stringify(files))

await startSampler()
let t = Date.now()
await runBtn().click()
await hasOut('Your name:')
timings.coldRunToPrompt = Date.now() - t
const coldSamples = await stopSampler()
const cold = analyse(coldSamples)
pass('real CheerpJ booted and the template ran', `Run click -> Scanner prompt in ${(timings.coldRunToPrompt / 1000).toFixed(1)}s (COLD)`)
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
  ['Person.describe()', 'Layla, age 34'],
  ['Student override', 'Omar, age 20, studies Computer Science'],
]) {
  if (beforeIn.includes(needle)) pass(`template output: ${label}`, needle)
  else fail(`template output: ${label}`, `missing "${needle}"`)
}
const ph = await page.locator('[aria-label="Program input"]').getAttribute('placeholder')
if (beforeIn.trimEnd().endsWith('Your name:') && ph === 'Type your answer, then press Enter')
  pass('Scanner prompt painted BEFORE the read blocked', 'partial line, stdin row waiting')
else fail('Scanner prompt painted BEFORE the read blocked', `ends "${beforeIn.trimEnd().slice(-20)}" / placeholder "${ph}"`)

await page.locator('[aria-label="Program input"]').fill('Warsha')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')
const afterIn = await out()
info(`--- output after typing ---\n${afterIn}`)
if (afterIn.includes('Hello, Warsha! Now open models/Person.java.')) pass('Scanner round-trip completed with correct output')
else fail('Scanner round-trip completed with correct output', afterIn.slice(-160))
if (/Your name:\s*Warsha/.test(afterIn)) pass('typed answer echoed on the prompt line')
else fail('typed answer echoed on the prompt line')
if (afterIn.includes('Finished. (exit code 0)')) pass('clean exit reported')
else fail('clean exit reported', afterIn.slice(-80))

await page.screenshot({ path: `${SHOTS}/warsha-java-working.png` })
info(`screenshot -> ${SHOTS}/warsha-java-working.png`)

// ==================================================== B. second run, same session
// The Run/Stop control deliberately ignores taps for SWAP_GUARD_MS (250ms) after
// it swaps role, so wait past that or the click is silently dropped. And wait for
// the console to CLEAR before looking for the prompt, otherwise the previous
// run's identical text matches instantly and the timing is meaningless.
await page.waitForTimeout(600)
await startSampler()
t = Date.now()
await runBtn().click()
await page.waitForFunction(() => !document.querySelector('[aria-label="Program output"]')?.innerText.includes('Hello,'), null, { timeout: 30000 })
await hasOut('Your name:')
timings.secondRunToPrompt = Date.now() - t
const warmInSession = analyse(await stopSampler())
pass('second run in the same session', `Run -> prompt in ${(timings.secondRunToPrompt / 1000).toFixed(1)}s`)
info(`  progress: phases=${JSON.stringify(warmInSession.phases)}, max blank ${warmInSession.absent}ms, static ${warmInSession.staticGap}ms`)
await page.locator('[aria-label="Program input"]').fill('again')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')

// ================================================= C. compile error in a nested file
await page.locator('[role="treeitem"]', { hasText: 'Person.java' }).first().click()
await page.waitForTimeout(400)
// API preserved so Main/Student still compile; the ONLY fault is a missing
// semicolon after `return age`, in models/Person.java.
await setEditor(
  'package models; public class Person { private String name; private int age; ' +
    'public Person(String n, int a) { name = n; age = a; } ' +
    'public String getName() { return name; } ' +
    'public int getAge() { return age } ' +
    'public String describe() { return name + ", age " + age; } }',
)
t = Date.now()
await runBtn().click()
await page.waitForFunction(
  () => /problem|ERROR/i.test(document.querySelector('[aria-label="Program output"]')?.innerText || ''),
  null, { timeout: 240000 })
await page.waitForTimeout(1200)
timings.compileError = Date.now() - t
const errOut = await out()
info(`--- compile error output ---\n${errOut}`)
if (errOut.includes('models/Person.java')) pass('compile error names the student file', 'models/Person.java')
else fail('compile error names the student file', errOut.slice(0, 200))
const lineM = errOut.match(/at line (\d+)/)
if (lineM) pass('compile error carries a line number', `at line ${lineM[1]}`)
else fail('compile error carries a line number')
if (!/\/files\/|\/str\/|warsha-run-/.test(errOut)) pass('no internal FS paths leaked into diagnostics')
else fail('no internal FS paths leaked into diagnostics')
if (!errOut.includes('=== Warsha starter ===')) pass('nothing ran after a compile error')
else fail('nothing ran after a compile error')
if (/exit code [1-9]|stopped early/i.test(errOut)) pass('compile failure surfaced as a non-zero exit')
else fail('compile failure surfaced as a non-zero exit', errOut.slice(-120))

// Restore Person.java, plus the divide() that section C2's crashes go through:
// a throw two student frames deep, in a different file from the entry, is the
// only way to check that each frame is named against its OWN source file.
await setEditor(PERSON_OK)

// =============================== C2. uncaught exception: byte-for-byte real java
//
// THE CONTRACT for what a crash looks like, compared as ONE EXACT STRING.
// `java` prints exactly this for classes carrying a SourceFile attribute and no
// line table (javac -g:source) -- verified against a real JDK, and that is the
// most a CheerpJ frame can support: its stack walker returns getFileName()
// == null and getLineNumber() == 0 whatever the compiler is told, and implicit
// exceptions arrive with getMessage() == null. Both the file name and the
// "/ by zero" are therefore reconstructed by warsha.Traces in the bootstrap.
//
// Substring assertions are what let the old "(line unknown)" rendering survive:
// every individual includes() passed while the block as a whole looked like
// nothing any JVM has ever printed. Hence full-string equality.
for (const [label, main, expected] of [
  [
    'implicit divide by zero, two student frames',
    'package app; public class Main { public static void main(String[] a) { ' +
      'System.out.println("about to divide"); System.out.println(models.Person.divide(42, 0)); } }',
    'Exception in thread "main" java.lang.ArithmeticException: / by zero\n' +
      '\tat models.Person.divide(Person.java)\n' +
      '\tat app.Main.main(Main.java)',
  ],
  [
    'explicit throw keeps its own message',
    'package app; public class Main { public static void main(String[] a) { ' +
      'throw new IllegalStateException("boom"); } }',
    'Exception in thread "main" java.lang.IllegalStateException: boom\n' +
      '\tat app.Main.main(Main.java)',
  ],
  [
    'cause chain, with the shared tail collapsed',
    'package app; public class Main { public static void main(String[] a) { ' +
      'try { models.Person.divide(1, 0); } catch (RuntimeException e) { ' +
      'throw new IllegalStateException("could not divide", e); } } }',
    'Exception in thread "main" java.lang.IllegalStateException: could not divide\n' +
      '\tat app.Main.main(Main.java)\n' +
      'Caused by: java.lang.ArithmeticException: / by zero\n' +
      '\tat models.Person.divide(Person.java)\n' +
      '\t... 1 more',
  ],
]) {
  await page.locator('[role="tab"]', { hasText: 'Main.java' }).first().click()
  await page.waitForTimeout(300)
  await setEditor(main)
  await runBtn().click()
  await page.waitForFunction(
    () => /Exception in thread/.test(document.querySelector('[aria-label="Program output"]')?.innerText || ''),
    null, { timeout: 240000 })
  await page.waitForTimeout(1200)
  const crashOut = await out()
  const got = traceBlock(crashOut)
  if (got === expected) pass(`uncaught exception is byte-for-byte real java: ${label}`)
  else fail(`uncaught exception is byte-for-byte real java: ${label}`, `got ${JSON.stringify(got)}`)
  if (!/line unknown|Unknown Source/.test(crashOut)) pass(`no apology in place of a line number: ${label}`)
  else fail(`no apology in place of a line number: ${label}`, traceBlock(crashOut))
  if (!/warsha\.|sun\.reflect\.|java\.lang\.reflect\./.test(crashOut)) pass(`no Warsha or reflection frames: ${label}`)
  else fail(`no Warsha or reflection frames: ${label}`, crashOut.match(/[^\n]*(warsha|reflect)[^\n]*/)?.[0] ?? '')
  if (/exit code [1-9]|stopped early/i.test(crashOut)) pass(`crash reported as a non-zero exit: ${label}`)
  else fail(`crash reported as a non-zero exit: ${label}`, crashOut.slice(-140))
}
await page.screenshot({ path: `${SHOTS}/warsha-java-exception.png` })
info(`screenshot -> ${SHOTS}/warsha-java-exception.png`)

// ============================================ D. infinite loop -> Stop -> Run again
await page.locator('[role="tab"]', { hasText: 'Main.java' }).first().click()
await page.waitForTimeout(300)
await setEditor('package app; public class Main { public static void main(String[] a) { while (true) { System.out.println("spin"); } } }')
await runBtn().click()
await page.waitForFunction(
  () => (document.querySelector('[aria-label="Program output"]')?.innerText.match(/spin/g) || []).length > 20,
  null, { timeout: 240000 })
pass('infinite loop is running', 'many "spin" lines streaming')
await stopBtn().click()
await hasOut('Stopped.')
pass('Stop killed the infinite loop', 'Stopped. Your files are all saved.')
const n1 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
await page.waitForTimeout(2000)
const n2 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
if (n1 === n2) pass('output really ceased after Stop', `${n1} lines, unchanged after 2s`)
else fail('output really ceased after Stop', `${n1} -> ${n2}`)

await setEditor('package app; public class Main { public static void main(String[] a) { System.out.println("run again works"); } }')
await startSampler()
t = Date.now()
await runBtn().click()
await hasOut('run again works')
timings.runAfterKill = Date.now() - t
const afterKill = analyse(await stopSampler())
pass('Run works again after Stop', `finished run ${(timings.runAfterKill / 1000).toFixed(1)}s after the click (pays a full re-warm)`)
info(`  progress during re-warm: phases=${JSON.stringify(afterKill.phases)}, max blank ${afterKill.absent}ms`)
if (afterKill.absent <= 2000) pass('progress UI never blank >2s during post-kill re-warm', `max blank ${afterKill.absent}ms`)
else fail('progress UI never blank >2s during post-kill re-warm', `blank ${afterKill.absent}ms`)

// ==================================================== E. warm reload (engine cached)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.waitForTimeout(1200)
const persisted = await page.locator('.cm-content').innerText()
if (persisted.includes('run again works')) pass('Java project persisted across reload (OPFS)')
else fail('Java project persisted across reload (OPFS)', persisted.slice(0, 100))
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
if (warm.staticGap <= 2000) pass('progress UI never STATIC >2s on a warm reload', `max static ${warm.staticGap}ms`)
else fail('progress UI never STATIC >2s on a warm reload', `text frozen for ${warm.staticGap}ms`)

// ========================================== F. Python regression in the SAME build
// The explorer creates a file through an inline draft row, not a dialog: the
// "New file" button inserts a row with a name input that commits on Enter.
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
timings.pythonAfterJava = Date.now() - t
const pyOut = await out()
info(`--- python run (same build, after Java) ---\n${pyOut}`)
const pv = pyOut.match(/python still works (\d+\.\d+\.\d+)/)
if (pv) pass('PYTHON REGRESSION: still works in the same build', `CPython ${pv[1]}, ${(timings.pythonAfterJava / 1000).toFixed(1)}s cold`)
else fail('PYTHON REGRESSION: still works in the same build', pyOut.slice(-200))
if (pyOut.includes('Finished. (exit code 0)')) pass('Python clean exit after Java ran in the same session')
else fail('Python clean exit after Java ran in the same session')

// Java again after Python, to prove the two workers do not interfere.
await page.locator('[role="tab"]', { hasText: 'Main.java' }).first().click()
await page.waitForTimeout(300)
await picker.selectOption('app/Main.java')
await page.waitForTimeout(600)
t = Date.now()
await runBtn().click()
await hasOut('run again works')
timings.javaAfterPython = Date.now() - t
pass('Java still works after Python ran (no worker/config interference)', `${(timings.javaAfterPython / 1000).toFixed(1)}s`)
await page.screenshot({ path: `${SHOTS}/warsha-both-engines.png` })

// ---------------------------------------------------------------- console errors
const cheerpjProbe = (e) => /Network error for null|Failed to fetch/.test(e)
const notable = consoleErrors.filter((e) => !/favicon/i.test(e) && !/404/.test(e) && !cheerpjProbe(e))
if (!notable.length) pass('no unexpected console errors', `${consoleErrors.length} total; ${consoleErrors.filter(cheerpjProbe).length} are CheerpJ's optional-path probes, rest favicon`)
else { fail('no unexpected console errors', `${notable.length}`); for (const e of notable.slice(0, 8)) info(`  ! ${e.slice(0, 200)}`) }

console.log('\n==== TIMINGS (in-app, local Chrome) ====')
for (const [k, v] of Object.entries(timings)) console.log(`  ${k}: ${(v / 1000).toFixed(1)}s`)
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
for (const f of failed) console.log(`FAILED: ${f[1]} :: ${f[2]}`)
await ctx.close()
process.exit(failed.length ? 1 : 0)
