/* Keyboard-open console layout at 390px, plus the two-candidate entry picker.
 * The software keyboard cannot be raised in headless Chrome, so this drives the
 * state ui/viewport.ts publishes (html[data-kb], --kb-inset) directly — the same
 * inputs the layout reads on a real iPad. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = 'http://localhost:8091/'
const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-kb-')), {
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 390, height: 780 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})
const page = ctx.pages()[0]
const out = () => page.locator('[aria-label="Program output"]').innerText()
const hasOut = (s, t = 120000) => page.waitForFunction(
  (n) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(n), s, { timeout: t })

await page.goto(URL_, { waitUntil: 'load' })
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /Python starter/ }).click()
await page.waitForTimeout(1500)
for (const n of ['Create', 'Replace']) {
  const b = page.getByRole('button', { name: n, exact: true })
  if (await b.count()) { await b.first().click(); await page.waitForTimeout(1300); break }
}

// The console starts collapsed on an empty project (App collapses it so the start
// panel gets the room), and that choice persists — open it before inspecting it.
async function ensureConsoleOpen(page) {
  if (await page.locator('[aria-label="Program output"]').count()) return
  await page.getByRole('button', { name: 'Show output' }).click()
  await page.waitForTimeout(400)
}
await ensureConsoleOpen(page)

// The Python starter is two files, so the entry picker is on screen: it must fit
// the header with everything else and still name the file that Run will start.
const picker = page.locator('select[aria-label="File to run"]')
if (await picker.count()) {
  const box = await picker.boundingBox()
  const value = await picker.inputValue()
  pass('entry picker present with 2+ candidates', `${value}, ${Math.round(box.width)}x${Math.round(box.height)}`)
  const rule = await picker.evaluate((el) => getComputedStyle(el).borderLeftColor + ' ' + getComputedStyle(el).borderLeftWidth)
  info(`picker leading rule: ${rule}`)
} else info('only one runnable file — picker correctly absent')

const overflow = await page.evaluate(() => {
  const h = document.querySelector('.console-header')
  return { scrollW: h.scrollWidth, clientW: h.clientWidth, docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }
})
if (overflow.scrollW <= overflow.clientW + 1) pass('console header fits 390px without horizontal overflow', JSON.stringify(overflow))
else fail('console header overflows at 390px', JSON.stringify(overflow))

// ------------------------------------------------------------- run to the prompt
await page.getByRole('button', { name: 'Run', exact: true }).click()
await hasOut('name')
await page.screenshot({ path: `${SHOTS}/con-390-waiting.png` })

// ------------------------------------------- simulate the software keyboard
// ui/viewport.ts owns --kb-inset and html[data-kb] and re-syncs them from
// visualViewport (including on a 300ms focusout timer), so a simulated keyboard
// set in one tick and measured in the next gets wiped. Set and measure together.
const kb = await page.evaluate(() => {
  const KB = 340
  const root = document.documentElement
  root.style.setProperty('--kb-inset', `${KB}px`)
  // What ui/viewport.ts really publishes: --app-h = visualViewport.height, i.e.
  // the height ABOVE the keyboard, on iPad AND Android. Simulating the spec's
  // §4.2 narrative (--app-h = innerHeight) instead would test a shell geometry
  // the app never actually has.
  root.style.setProperty('--app-h', `${window.innerHeight - KB}px`)
  root.dataset.kb = 'open'
  const r = (s) => { const e = document.querySelector(s)
    if (!e) return null
    const q = e.getBoundingClientRect()
    return { x: q.x, y: q.y, width: q.width, height: q.height, h: Math.round(q.height), b: Math.round(q.bottom), bottom: q.bottom, top: q.top }
  }
  const rows = [...document.querySelectorAll('.console-row')].map((e) => e.getBoundingClientRect().toJSON())
  const keyboardTop = window.innerHeight - KB
  return {
    keyboardTop,
    input: r('[aria-label="Program input"]'),
    status: r('p[role="status"][data-state]'),
    header: r('.console-header'),
    visibleRows: rows.filter((b) => b.bottom <= keyboardTop + 1 && b.height > 0).length,
    totalRows: rows.length,
    clearLabelShown: [...document.querySelectorAll('.kb-hide')].some((e) => getComputedStyle(e).display !== 'none'),
    consoleH: r('section[aria-label="Console"]')?.height,
    // Dead space between the bottom of the console and the top of the keyboard:
    // must be 0. Anything else means the keyboard inset is being applied twice.
    deadSpace: keyboardTop - (r('section[aria-label="Console"]')?.b ?? keyboardTop),
    transcriptH: r('.console-transcript')?.h,
  }
})
info(JSON.stringify(kb))
if (kb.input && kb.input.bottom <= kb.keyboardTop + 1) pass('stdin row stays above the keyboard', `input bottom ${Math.round(kb.input.bottom)} ≤ keyboard top ${kb.keyboardTop}`)
else fail('stdin row stays above the keyboard', JSON.stringify(kb.input))
if (kb.status && kb.status.bottom <= kb.keyboardTop + 1) pass('status line stays above the keyboard')
else fail('status line stays above the keyboard', JSON.stringify(kb.status))
if (kb.header && kb.header.bottom <= kb.keyboardTop + 1) pass('Run/Stop stays above the keyboard')
else fail('Run/Stop stays above the keyboard', JSON.stringify(kb.header))
if (kb.visibleRows >= 3) pass('the question is still readable while typing the answer', `${kb.visibleRows} output rows visible above the keyboard`)
else fail('output rows visible with the keyboard up', `${kb.visibleRows} of ${kb.totalRows}`)
if (!kb.clearLabelShown) pass('kb-hide decoration collapses with the keyboard up')
else fail('kb-hide decoration collapses with the keyboard up')
if (kb.deadSpace <= 1) pass('no dead space between the console and the keyboard', `${Math.round(kb.deadSpace)}px`)
else fail('keyboard inset applied twice — dead space below the console', `${Math.round(kb.deadSpace)}px of empty shell, transcript squeezed to ${kb.transcriptH}px`)
if (kb.transcriptH >= 84) pass('four output lines fit above the input row (§4.3 rule 4)', `${kb.transcriptH}px`)
else fail('four output lines above the input row (§4.3 rule 4)', `transcript is ${kb.transcriptH}px, needs ~84px`)
await page.evaluate(() => {
  document.documentElement.style.setProperty('--kb-inset', '340px')
  document.documentElement.dataset.kb = 'open'
})
await page.screenshot({ path: `${SHOTS}/con-390-keyboard.png`, clip: { x: 0, y: 0, width: 390, height: 440 } })

await page.evaluate(() => { document.documentElement.dataset.kb = 'closed'; document.documentElement.style.setProperty('--kb-inset', '0px') })
await page.waitForTimeout(300)
await page.locator('[aria-label="Program input"]').fill('Warsha')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')
await page.screenshot({ path: `${SHOTS}/con-390-done.png` })
pass('run completes on the phone layout')

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== 390/keyboard: ${results.length - failed.length}/${results.length} passed ====`)
failed.forEach((f) => console.log(`FAILED: ${f[1]} :: ${f[2]}`))
await ctx.close()
process.exit(failed.length ? 1 : 0)
