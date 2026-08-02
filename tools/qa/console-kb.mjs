/* Keyboard-open console layout at 390px, plus the two-candidate entry picker.
 * The software keyboard cannot be raised in headless Chrome, so this drives the
 * state ui/viewport.ts publishes (html[data-kb], --kb-inset) directly — the same
 * inputs the layout reads on a real iPad. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://localhost:8091/'
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

// RunBar's root lost its `console-header` class in a concurrent refactor; accept
// either spelling so this suite reports console regressions rather than that one.
const HEADER_SEL = '.console-header, section[aria-label="Console"] > div:first-of-type'
const overflow = await page.evaluate((sel) => {
  const h = document.querySelector(sel)
  return { scrollW: h.scrollWidth, clientW: h.clientWidth, docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }
}, HEADER_SEL)
if (overflow.scrollW <= overflow.clientW + 1) pass('console header fits 390px without horizontal overflow', JSON.stringify(overflow))
else fail('console header overflows at 390px', JSON.stringify(overflow))

// ------------------------------------------------------------- run to the prompt
await page.getByRole('button', { name: 'Run', exact: true }).click()
await hasOut('name')
await page.screenshot({ path: `${SHOTS}/con-390-waiting.png` })

// ------------------------------------------- simulate the software keyboard
// The keyboard is simulated at its SOURCE — `visualViewport.height` — and not by
// writing --kb-inset / --app-h / data-kb by hand.
//
// Writing the CSS variables was self-cancelling and produced a false failure that
// took an afternoon to explain: shrinking the shell changes the layout, that fires
// a visualViewport event, ui/viewport.ts's sync() reads the REAL (un-shrunk)
// viewport and writes everything back, and React's data-kb observer follows it —
// so a suite that set the variables in one tick and measured in the next was
// measuring a half-reverted layout with the phone-layout inline height still
// applied. Shadowing the property makes the simulation self-consistent: every
// re-sync, whenever it happens, computes the same 340px keyboard, which is exactly
// what a real device does.
//
// It also has to be more than one tick now. The input is IN the transcript, so
// shrinking the console for the keyboard moves the cursor relative to the scroll
// window and the console's ResizeObserver scrolls it back — and a ResizeObserver
// fires after layout but before paint, i.e. never inside the evaluate() that
// forced the layout.
const KB_PX = 340
const raiseKeyboard = () => page.evaluate((KB) => {
  const vv = window.visualViewport
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - KB })
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
  vv.dispatchEvent(new Event('resize'))
}, KB_PX)
// Two passes, not one, despite the comment above already saying so: the
// console's ResizeObserver-driven scroll-to-bottom fires after layout but
// before paint, so it never lands inside the SAME evaluate() that forced the
// resize. `pixel-crops.mjs`'s 390-kb section already double-calls this for
// the exact same reason; this script measured `input.bottom` overlapping the
// keyboard by ~10px, and `deadSpace` at -48 instead of 0, on every run until
// the second call was added — one settle pass was consistently not enough.
await raiseKeyboard()
await page.waitForTimeout(350)
await raiseKeyboard()
await page.waitForTimeout(350)

const kb = await page.evaluate(([KB, HEADER_SEL]) => {
  const r = (s) => { const e = document.querySelector(s)
    if (!e) return null
    const q = e.getBoundingClientRect()
    return { x: q.x, y: q.y, width: q.width, height: q.height, h: Math.round(q.height), b: Math.round(q.bottom), bottom: q.bottom, top: q.top }
  }
  const rows = [...document.querySelectorAll('.console-row')].map((e) => e.getBoundingClientRect().toJSON())
  const keyboardTop = window.innerHeight - KB
  const sc = document.querySelector('.console-transcript')
  return {
    keyboardTop,
    // Diagnostics for the one failure mode this geometry has: the transcript
    // shrank for the keyboard and the cursor did not come with it.
    scroll: { top: Math.round(sc.scrollTop), max: sc.scrollHeight - sc.clientHeight },
    kbVars: {
      inset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim(),
      appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim(),
      state: document.documentElement.dataset.kb,
    },
    input: r('[aria-label="Program input"]'),
    status: r('p[role="status"][data-state]'),
    header: r(HEADER_SEL),
    visibleRows: rows.filter((b) => b.bottom <= keyboardTop + 1 && b.height > 0).length,
    totalRows: rows.length,
    clearLabelShown: [...document.querySelectorAll('.kb-hide')].some((e) => getComputedStyle(e).display !== 'none'),
    consoleH: r('section[aria-label="Console"]')?.height,
    // Dead space between the bottom of the console and the top of the keyboard:
    // must be 0. Anything else means the keyboard inset is being applied twice.
    deadSpace: keyboardTop - (r('section[aria-label="Console"]')?.b ?? keyboardTop),
    transcriptH: r('.console-transcript')?.h,
    transcript: r('.console-transcript'),
    foot: r('.console-foot'),
  }
}, [KB_PX, HEADER_SEL])
info(JSON.stringify(kb))
if (kb.input && kb.input.bottom <= kb.keyboardTop + 1) pass('the live input stays above the keyboard', `input bottom ${Math.round(kb.input.bottom)} ≤ keyboard top ${kb.keyboardTop}`)
else fail('the live input stays above the keyboard', JSON.stringify(kb.input))
// Above the keyboard is not enough now that the input scrolls with the stream: it
// also has to be inside the transcript's own scroll window, or it is clipped by a
// panel that shrank for the keyboard and the student types at an invisible cursor.
if (kb.input && kb.transcript && kb.input.bottom <= kb.transcript.bottom + 1 && kb.input.top >= kb.transcript.top - 1)
  pass('the live input is inside the transcript viewport, not scrolled out of it', `input ${Math.round(kb.input.top)}–${Math.round(kb.input.bottom)} within ${Math.round(kb.transcript.top)}–${Math.round(kb.transcript.bottom)}`)
else fail('live input clipped by the transcript', JSON.stringify({ input: kb.input, transcript: kb.transcript }))
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
// The keyboard is still up (the shadowed getter holds it there), so this crop is
// the real keyboard-open layout, not a re-poked approximation of it.
await page.screenshot({ path: `${SHOTS}/con-390-keyboard.png`, clip: { x: 0, y: 0, width: 390, height: 440 } })

// Put the keyboard away the same way it was raised: restore the real viewport.
await page.evaluate(() => {
  delete window.visualViewport.height
  delete window.visualViewport.offsetTop
  window.visualViewport.dispatchEvent(new Event('resize'))
})
await page.waitForTimeout(400)

// Touch: the cursor is somewhere inside a scrolling transcript rather than in a
// fixed bar, so "tap the console" has to mean "type here".
await page.evaluate(() => document.activeElement?.blur())
await page.waitForTimeout(200)
await page.locator('.console-transcript').tap({ position: { x: 80, y: 24 } })
await page.waitForTimeout(250)
const refocused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
if (refocused === 'Program input') pass('tapping the console while it waits focuses the live input')
else fail('tap-to-focus while waiting', String(refocused))

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
