/* QA for the debugger UI (app/src/components/DebugView.tsx, DebugToolbar.tsx,
 * editor/debugExt.ts) driven end-to-end through a real Python run: set a
 * breakpoint by clicking the gutter, Start Debugging from the Run and Debug
 * view, stop on the line, read VARIABLES / CALL STACK / inline values, step
 * with the toolbar and F10/F11, add a watch, continue to the end, and check the
 * breakpoint persisted across a reload. Engine-level stepping per language has
 * its own suite (debug-<lang>.mjs); this one is about what the student sees.
 *
 *   WARSHA_URL (default http://127.0.0.1:8083/) · CHROME · WARSHA_SHOTS
 */
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8083/').replace(/\/$/, '')
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const SHOTS = process.env.WARSHA_SHOTS ?? join(import.meta.dirname, 'screenshots')
mkdirSync(SHOTS, { recursive: true })

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-debug-ui-')), {
  executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

let pass = 0, fail = 0
const check = async (label, fn) => {
  try { const ok = await fn(); console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); ok ? pass++ : fail++ }
  catch (e) { console.log(`FAIL  ${label} :: ${e.message.split('\n')[0]}`); fail++ }
}
const until = async (fn, ms = 60000) => {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await page.waitForTimeout(150) }
  return false
}

const SRC = [
  'def square(n):',          // 1
  '    result = n * n',      // 2
  '    return result',       // 3
  '',                        // 4
  'nums = [3, 1, 2]',        // 5
  'total = 0',               // 6
  'for x in nums:',          // 7
  '    total += square(x)',  // 8
  'print("total", total)',   // 9
].join('\n')

await page.goto(URL_ + '/?lang=en')
await page.getByRole('button', { name: 'New project', exact: true }).first().click({ timeout: 60000 })
await page.locator('dialog[open]').getByRole('button', { name: /Python/ }).first().click()
await page.locator('.template-card').first().click()
await page.waitForSelector('.cm-content', { timeout: 30000 })
await until(() => page.evaluate(() => self.crossOriginIsolated), 20000)
// Replace the starter with our program.
await page.locator('.cm-content').click()
await page.keyboard.press('Control+A')
await page.keyboard.press('Delete')
await page.locator('.cm-content').evaluate((el, src) => {
  const view = el.closest('.cm-editor').cmView?.view
  if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } })
}, SRC)
if ((await page.locator('.cm-line').count()) < 9) await page.keyboard.insertText(SRC)
await page.waitForTimeout(300)

const gutterLine = (n) => page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: new RegExp(`^${n}$`) })

await check('clicking a line number sets a breakpoint (red dot)', async () => {
  await gutterLine(8).click()
  return until(async () => (await page.locator('[data-bp="main.py:8"]').count()) === 1 || (await page.locator('.cm-debug-gutter .cm-bp:not(.cm-bp--off)').count()) >= 1, 3000)
})

await page.getByRole('button', { name: 'Run and Debug' }).first().click()
await check('Breakpoints section lists main.py:8', async () => until(async () => (await page.locator('[data-bp="main.py:8"]').count()) === 1, 3000))

await page.locator('[data-debug-phase] button', { hasText: 'Run and Debug' }).click()
await check('stops on the breakpoint (yellow stop line on 8)', async () =>
  until(async () => {
    const lines = page.locator('.cm-debug-stop-line')
    return (await lines.count()) === 1 && (await lines.first().innerText()).includes('total += square(x)')
  }, 120000))
await page.screenshot({ path: join(SHOTS, 'debug-ui-stopped.png') })

await check('toolbar shows Continue + steps', async () =>
  (await page.getByRole('toolbar', { name: 'Debug toolbar' }).count()) === 1 &&
  (await page.getByRole('button', { name: 'Continue' }).count()) === 1)
await check('CALL STACK names <module> and badge says breakpoint', async () => {
  const sec = page.locator('section[data-section="stack"]')
  return /<module>/.test(await sec.innerText()) && /PAUSED ON BREAKPOINT/i.test(await sec.innerText())
})
await check('VARIABLES shows x = 3 and total = 0', async () => {
  const t = await page.locator('section[data-section="variables"]').innerText()
  return /x: 3/.test(t) && /total: 0/.test(t)
})
await check('inline values render after the line', async () => (await page.locator('.cm-inline-value').count()) > 0)
await check('expanding nums lists its 3 elements', async () => {
  await page.locator('section[data-section="variables"] [role="treeitem"]', { hasText: /^nums: / }).first().locator('> div').click()
  return until(async () => /0: 3[\s\S]*1: 1[\s\S]*2: 2/.test(await page.locator('section[data-section="variables"]').innerText()), 5000)
})

await check('Step Into (F11) enters square() at line 2', async () => {
  await page.keyboard.press('F11')
  return until(async () => (await page.locator('.cm-debug-stop-line').innerText().catch(() => '')).includes('result = n * n'), 10000)
})
await check('CALL STACK now has square above <module>', async () => {
  const t = await page.locator('section[data-section="stack"]').innerText()
  return t.indexOf('square') !== -1 && t.indexOf('square') < t.indexOf('<module>')
})
await check('Step Over (toolbar) moves to line 3 with result = 9', async () => {
  await page.getByRole('button', { name: 'Step Over' }).click()
  return until(async () =>
    (await page.locator('.cm-debug-stop-line').innerText().catch(() => '')).includes('return result') &&
    /result: 9/.test(await page.locator('section[data-section="variables"]').innerText()), 10000)
})
await check('selecting the caller frame shows its line (green band)', async () => {
  await page.locator('section[data-section="stack"] [role="button"]', { hasText: '<module>' }).click()
  return until(async () => (await page.locator('.cm-debug-frame-line').count()) === 1, 3000)
})
await check('watch expression evaluates (total + 100)', async () => {
  await page.locator('section[data-section="watch"]').hover()
  await page.getByRole('button', { name: 'Add Expression' }).click()
  await page.keyboard.insertText('total + 100')
  await page.keyboard.press('Enter')
  return until(async () => /total \+ 100: 100/.test(await page.locator('section[data-section="watch"]').innerText()), 5000)
})
await check('Continue (F5) runs to the next hit of the breakpoint', async () => {
  await page.keyboard.press('F5')
  return until(async () => /x: 1/.test(await page.locator('section[data-section="variables"]').innerText()), 10000)
})
await check('removing the breakpoint then Continue finishes the run', async () => {
  await page.locator('[data-bp="main.py:8"]').hover()
  const n = await page.getByRole('button', { name: 'Remove Breakpoint' }).count()
  if (n !== 1) console.log('   remove buttons:', n, await page.getByRole('button', { name: 'Remove Breakpoint' }).evaluateAll((els) => els.map((e) => e.closest('[data-bp]')?.getAttribute('data-bp') ?? e.outerHTML.slice(0, 120))))
  await page.locator('[data-bp="main.py:8"]').getByRole('button', { name: 'Remove Breakpoint' }).click()
  await page.keyboard.press('F5')
  return until(async () => (await page.getByRole('toolbar', { name: 'Debug toolbar' }).count()) === 0 &&
    /total 14/.test(await page.locator('section[aria-label]').filter({ hasText: 'total 14' }).first().innerText().catch(() => '')), 20000)
})
// Stop while paused (QA M10): a calm, neutral stop — never "stopped responding"
// or a red "Stopped early" — and the engine answers the very next Run and Debug.
// Shift+F5 is pressed straight after the stop lands, inside the Run control's
// 250 ms double-tap guard on a warm engine: a key is not that tap, and a guarded
// key left the session parked with Run and F5 dead until a reload.
const consoleState = () => page.locator('section[aria-label="Console"]').getAttribute('data-state')
const transcript = () => page.locator('[aria-label="Program output"]').innerText().catch(() => '')
const pausedOnce = () => until(async () => (await page.locator('.cm-debug-stop-line').count()) === 1, 60000)
await gutterLine(8).click()
for (const [how, stopIt] of [
  ['toolbar Stop', () => page.getByRole('toolbar', { name: 'Debug toolbar' }).getByRole('button', { name: /^Stop/ }).click()],
  ['Shift+F5 at once', () => page.keyboard.press('Shift+F5')],
]) {
  await check(`stop while paused (${how}) is calm and neutral`, async () => {
    await page.waitForTimeout(400) // Run itself ignores a start inside 250 ms of the last exit
    await page.keyboard.press('F5')
    if (!(await pausedOnce())) throw new Error('never paused')
    await stopIt()
    if (!(await until(async () => (await consoleState()) === 'stopped', 5000))) throw new Error('state ' + (await consoleState()))
    await page.waitForTimeout(2500) // the old false alarm arrived ~2 s later
    const t = await transcript()
    const status = await page.locator('footer').innerText()
    const ok = (await consoleState()) === 'stopped' && !/stopped responding/i.test(t) && /Stopped by you/.test(status) && !/Stopped early/.test(status)
    if (!ok) console.log('   transcript:', JSON.stringify(t.slice(-160)), 'status:', JSON.stringify(status.slice(0, 60)))
    return ok
  })
}
await check('after a stop, Ctrl+F5 runs to the end', async () => {
  await page.waitForTimeout(400)
  await page.keyboard.press('Control+F5')
  return until(async () => (await consoleState()) === 'ok' && /total 14/.test(await transcript()), 20000)
})
await gutterLine(8).click()

await check('breakpoints persist across a reload', async () => {
  await gutterLine(6).click()
  await page.waitForTimeout(300)
  await page.reload()
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  return until(async () => (await page.locator('.cm-debug-gutter .cm-gutterElement .cm-bp').count()) >= 2, 8000)
})

console.log(errs.length ? `page errors:\n${errs.join('\n')}` : 'no page errors')
console.log(`\n${pass} passed, ${fail} failed`)
await ctx.close()
process.exit(fail ? 1 : 0)
