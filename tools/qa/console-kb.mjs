/* Keyboard-open console layout at 390px, plus the two-candidate entry picker.
 * The software keyboard cannot be raised in headless Chrome, so this drives the
 * state ui/viewport.ts publishes (html[data-kb], --kb-inset) directly — the same
 * inputs the layout reads on a real iPad. */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
const URL_ = process.env.WARSHA_URL ?? 'http://localhost:8091/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-kb-')), {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
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
await seedStarter(page, { name: 'Python (OOP starter)' })
await page.waitForTimeout(1500)

// Console starts collapsed on an empty project (room for the start panel) —
// open it before inspecting.
async function ensureConsoleOpen(page) {
  if (await page.locator('[aria-label="Program output"]').count()) return
  await page.getByRole('button', { name: 'Show output' }).click()
  await page.waitForTimeout(400)
}
await ensureConsoleOpen(page)

// Two files means the entry picker is on screen; it must fit the header and
// still name the file Run will start.
const picker = page.locator('select[aria-label="File to run"]')
if (await picker.count()) {
  const box = await picker.boundingBox()
  const value = await picker.inputValue()
  pass('entry picker present with 2+ candidates', `${value}, ${Math.round(box.width)}x${Math.round(box.height)}`)
} else info('only one runnable file — picker correctly absent')

// `console-header` is a styling-free contract class on RunBar's root.
const HEADER_SEL = '.console-header'
const overflow = await page.evaluate((sel) => {
  const h = document.querySelector(sel)
  return { scrollW: h.scrollWidth, clientW: h.clientWidth, docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth }
}, HEADER_SEL)
if (overflow.scrollW <= overflow.clientW + 1) pass('console header fits 390px without horizontal overflow', JSON.stringify(overflow))
else fail('console header overflows at 390px', JSON.stringify(overflow))

// ------------------------------------------------------------- run to the prompt
// Prefix match: the accessible name includes the file, e.g. "Run main.py".
await page.getByRole('button', { name: /^Run\b/ }).click()
await hasOut('name')
await page.screenshot({ path: `${SHOTS}/con-390-waiting.png` })

// ------------------------------------------- simulate the software keyboard
// Simulated at the source (visualViewport.height), not by writing
// --kb-inset/--app-h/data-kb directly — those race with viewport.ts's own
// sync(), which recomputes from the real un-shrunk viewport on resize.
// Shadowing the getter keeps every re-sync self-consistent instead.
const KB_PX = 340
const raiseKeyboard = () => page.evaluate((KB) => {
  const vv = window.visualViewport
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - KB })
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
  vv.dispatchEvent(new Event('resize'))
}, KB_PX)
// Two passes, not one: the console's ResizeObserver-driven scroll fires after
// layout but before paint, so it never lands in the same evaluate() that
// forced the resize. Confirmed empirically — one pass left input.bottom
// overlapping the keyboard and deadSpace at -48 instead of 0.
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
    // Diagnostics for the one failure mode: transcript shrank but the cursor didn't follow.
    scroll: { top: Math.round(sc.scrollTop), max: sc.scrollHeight - sc.clientHeight },
    kbVars: {
      inset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset').trim(),
      appH: getComputedStyle(document.documentElement).getPropertyValue('--app-h').trim(),
      state: document.documentElement.dataset.kb,
    },
    input: r('[aria-label="Program input"]'),
    // Status bar is suppressed while the keyboard is up; the header's
    // kb-open-only pill carries run state instead.
    status: r('.console-header .pill'),
    statusBarShown: !!document.querySelector('footer[aria-label="Status bar"]'),
    header: r(HEADER_SEL),
    visibleRows: rows.filter((b) => b.bottom <= keyboardTop + 1 && b.height > 0).length,
    totalRows: rows.length,
    clearLabelShown: [...document.querySelectorAll('.kb-hide')].some((e) => getComputedStyle(e).display !== 'none'),
    consoleH: r('section[aria-label="Console"]')?.height,
    // Must be 0 — nonzero means the keyboard inset is applied twice.
    deadSpace: keyboardTop - (r('section[aria-label="Console"]')?.b ?? keyboardTop),
    transcriptH: r('.console-transcript')?.h,
    transcript: r('.console-transcript'),
  }
}, [KB_PX, HEADER_SEL])
info(JSON.stringify(kb))
if (kb.input && kb.input.bottom <= kb.keyboardTop + 1) pass('the live input stays above the keyboard', `input bottom ${Math.round(kb.input.bottom)} ≤ keyboard top ${kb.keyboardTop}`)
else fail('the live input stays above the keyboard', JSON.stringify(kb.input))
// Must also be inside the transcript's scroll window — a shrunk panel can
// clip it to an invisible cursor.
if (kb.input && kb.transcript && kb.input.bottom <= kb.transcript.bottom + 1 && kb.input.top >= kb.transcript.top - 1)
  pass('the live input is inside the transcript viewport, not scrolled out of it', `input ${Math.round(kb.input.top)}–${Math.round(kb.input.bottom)} within ${Math.round(kb.transcript.top)}–${Math.round(kb.transcript.bottom)}`)
else fail('live input clipped by the transcript', JSON.stringify({ input: kb.input, transcript: kb.transcript }))
if (kb.status && kb.status.bottom <= kb.keyboardTop + 1) pass('the kb-open header pill carries the run state, above the keyboard')
else fail('the kb-open header pill carries the run state', JSON.stringify(kb.status))
if (!kb.statusBarShown) pass('the status bar stands down while the keyboard is up (the pill covers for it)')
else fail('status bar should be suppressed while the keyboard is up')
if (kb.header && kb.header.bottom <= kb.keyboardTop + 1) pass('the console header and its controls stay above the keyboard')
else fail('console header stays above the keyboard', JSON.stringify(kb.header))
if (kb.visibleRows >= 3) pass('the question is still readable while typing the answer', `${kb.visibleRows} output rows visible above the keyboard`)
else fail('output rows visible with the keyboard up', `${kb.visibleRows} of ${kb.totalRows}`)
if (!kb.clearLabelShown) pass('kb-hide decoration collapses with the keyboard up')
else fail('kb-hide decoration collapses with the keyboard up')
if (kb.deadSpace <= 1) pass('no dead space between the console and the keyboard', `${Math.round(kb.deadSpace)}px`)
else fail('keyboard inset applied twice — dead space below the console', `${Math.round(kb.deadSpace)}px of empty shell, transcript squeezed to ${kb.transcriptH}px`)
if (kb.transcriptH >= 84) pass('four output lines fit above the input row (§4.3 rule 4)', `${kb.transcriptH}px`)
else fail('four output lines above the input row (§4.3 rule 4)', `transcript is ${kb.transcriptH}px, needs ~84px`)
// Keyboard is still up (shadowed getter holds it) — this is the real layout, not an approximation.
await page.screenshot({ path: `${SHOTS}/con-390-keyboard.png`, clip: { x: 0, y: 0, width: 390, height: 440 } })

// Put the keyboard away the same way it was raised: restore the real viewport.
await page.evaluate(() => {
  delete window.visualViewport.height
  delete window.visualViewport.offsetTop
  window.visualViewport.dispatchEvent(new Event('resize'))
})
await page.waitForTimeout(400)

// Touch: cursor is inside a scrolling transcript, not a fixed bar — tapping
// the console must focus it.
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
