/* Console/RunBar verification against the real Python engine on localhost:8089.
 * Python boots in ~3s, so every console behaviour (streaming, stdin, exit codes,
 * autoscroll pause, 6000-line burst + Stop) is testable end to end. */
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
const W = Number(process.argv[2] ?? 1280)
const H = Number(process.argv[3] ?? 900)
const TAG = process.argv[4] ?? String(W)
const profile = mkdtempSync(join(tmpdir(), 'warsha-console-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

const out = () => page.locator('[aria-label="Program output"]').innerText()
const hasOut = (s, t = 120000) => page.waitForFunction(
  (n) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(n), s, { timeout: t })
// Prefix match: the accessible name includes the file, e.g. "Run main.py".
const runBtn = () => page.getByRole('button', { name: /^Run\b/ })
const stopBtn = () => page.getByRole('button', { name: /^Stop\b/ })
const input = () => page.locator('[aria-label="Program input"]')
// Run state lives in one place: the status bar's `.status-remote` block
// (header pill only shows under a software keyboard — see console-kb.mjs).
const runState = async () => {
  const el = page.locator('footer[aria-label="Status bar"] .status-remote')
  return { state: await el.getAttribute('data-state'), text: (await el.innerText()).trim(), where: 'status bar' }
}
const shot = (n) => page.screenshot({ path: `${SHOTS}/con-${TAG}-${n}.png` })
// `console-header` is a styling-free contract class on RunBar's root.
const HEADER_SEL = '.console-header'

async function setEditor(text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(text)
  await page.waitForTimeout(700)
}

// ---------------------------------------------------------------- seed a file
await page.goto(URL_, { waitUntil: 'load' })
await page.waitForTimeout(1500)
if (!(await page.locator('.cm-content').count())) {
  // Seeding an empty project fills it in place — no name prompt to confirm.
  await seedStarter(page, { name: 'Python (OOP starter)' })
  await page.waitForTimeout(1200)
}
if (await page.locator('.cm-content').count()) pass('project seeded with main.py')
else { fail('project seeded with main.py'); await shot('seed-fail'); process.exit(1) }

// Console starts collapsed on an empty project (room for the start panel) —
// open it before inspecting.
async function ensureConsoleOpen(page) {
  if (await page.locator('[aria-label="Program output"]').count()) return
  await page.getByRole('button', { name: 'Show output' }).click()
  await page.waitForTimeout(400)
}
await ensureConsoleOpen(page)

// ------------------------------------------------------- A. idle / empty state
const idle = await runState().catch(() => ({ state: null, text: '' }))
if (idle.state === 'idle' && /Ready/i.test(idle.text)) pass(`run state: idle (${idle.where})`, JSON.stringify(idle.text))
else fail('run state: idle', `${idle.state} / ${idle.text}`)
const emptyText = await out()
if (/Output will appear here/.test(emptyText))
  pass('empty console is a designed hint, not a void', JSON.stringify(emptyText.replace(/\s+/g, ' ').trim()))
else fail('empty console hint', JSON.stringify(emptyText))
// One-surface model: nothing reads stdin, so no input exists in the DOM at
// all (not disabled, not greyed).
const idleInputs = await input().count()
if (idleInputs === 0) pass('no input UI whatsoever while nothing is reading stdin')
else fail('no input UI while idle', `${idleInputs} stdin input(s) on screen`)
await shot('a-idle')

// ------------------------------------- B. mixed stdout/stderr/echo + exit code
await setEditor(
  'import sys\n' +
  'print("Warsha console check")\n' +
  'sys.stderr.write("Traceback (most recent call last):\\n")\n' +
  'sys.stderr.write("  File \\"main.py\\", line 9, in <module>\\n")\n' +
  'sys.stderr.write("ValueError: this is what stderr looks like\\n")\n' +
  'name = input("Your name: ")\n' +
  'print("Hi", name)\n' +
  'sys.exit(3)\n',
)
await runBtn().click()
// The progress block must be on screen while the engine boots.
const sawProgress = await page.waitForSelector('[data-phase]', { timeout: 8000 }).then(() => true).catch(() => false)
if (sawProgress) {
  const ptext = await page.locator('[data-phase]').innerText()
  pass('progress block appears while the engine boots', JSON.stringify(ptext.replace(/\s+/g, ' ').trim()))
  await shot('b-progress')
} else info('engine was already warm — no progress block (cache hit path)')

await hasOut('Your name:')
const waitRs = await runState()
const waitPh = await input().getAttribute('placeholder')
const rowWaiting = await page.locator('.stdin-row').getAttribute('data-waiting')
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
if (waitRs.state === 'waiting' && /waiting|Waiting/.test(waitRs.text)) pass(`run state: waiting for input (${waitRs.where})`, JSON.stringify(waitRs.text))
else fail('run state: waiting for input', `${waitRs.state} / ${waitRs.text}`)
if (rowWaiting === 'true') pass('stdin row marked waiting (highlight)')
else fail('stdin row marked waiting', String(rowWaiting))
if (focused === 'Program input') pass('stdin input focused when the program asks')
else fail('stdin input focused when the program asks', String(focused))
if (waitPh === 'Type your answer, then press Enter') pass('waiting placeholder is the spec string')
else fail('waiting placeholder', String(waitPh))
if (!(await input().isDisabled())) pass('stdin row enabled while the program reads')
else fail('stdin row enabled while the program reads')
const beforeAnswer = await out()
if (beforeAnswer.trimEnd().endsWith('Your name:')) pass('prompt printed before the read blocked')
else fail('prompt printed before the read blocked', beforeAnswer.slice(-40))

// Input lives IN the transcript, on the prompt's own line — not in a bar underneath it.
const inline = await page.evaluate(() => {
  const inp = document.querySelector('[aria-label="Program input"]')
  const scroller = document.querySelector('[aria-label="Program output"]')
  const row = inp?.closest('.console-row')
  const seg = row?.querySelector('[data-seg]')
  if (!inp || !scroller || !row) return null
  const i = inp.getBoundingClientRect()
  const s = seg?.getBoundingClientRect() ?? null
  const cs = getComputedStyle(inp)
  return {
    insideTranscript: scroller.contains(inp),
    prompt: seg?.textContent ?? null,
    sharesTheLine: s ? i.top < s.bottom && s.top < i.bottom : false,
    gapAfterPrompt: s ? Math.round(i.left - s.right) : null,
    height: Math.round(i.height),
    fontSize: cs.fontSize,
    border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
    background: cs.backgroundColor,
    rowRule: getComputedStyle(row).borderLeftColor,
    rowRuleW: getComputedStyle(row).borderLeftWidth,
  }
})
info(`inline input: ${JSON.stringify(inline)}`)
if (inline?.insideTranscript) pass('the input lives INSIDE the transcript, not in a bar below it')
else fail('input inside the transcript', JSON.stringify(inline))
if (inline?.sharesTheLine && /Your name:/.test(inline.prompt ?? '') && inline.gapAfterPrompt >= -1 && inline.gapAfterPrompt <= 4)
  pass('a partial-line prompt and the input are ONE visual line', `"${inline.prompt}" then the caret ${inline.gapAfterPrompt}px later`)
else fail('prompt and input share a line', JSON.stringify(inline))
if (inline && /^0px/.test(inline.border) && /rgba\(0, 0, 0, 0\)|transparent/.test(inline.background))
  pass('the input has no box of its own — the caret is the affordance', `${inline.border}, ${inline.background}`)
else fail('input is chromeless', JSON.stringify({ border: inline?.border, bg: inline?.background }))
// One shell: rows are flat at every width; the --info caret + status bar name
// the waiting state, `[data-seg]` hues carry the rest.
const inlineDesk = await page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)
if (inline?.rowRuleW === '0px')
  pass('the live line is flat — the caret and status bar name the waiting state', `${inline?.rowRule} ${inline?.rowRuleW}`)
else fail('live line flat-row treatment', JSON.stringify({ rule: inline?.rowRule, w: inline?.rowRuleW }))
// DENSITY: 44px/16px is touch-only; this desk harness runs the live line at
// 28px/14px (touch asserted in console-kb.mjs).
if (inline && inline.height >= (inlineDesk ? 24 : 43.5)) pass(`the live input is a ≥${inlineDesk ? 24 : 44}px target at this density`, `${inline.height}px`)
else fail('live input height floor', JSON.stringify(inline))
if (inline && parseFloat(inline.fontSize) >= (inlineDesk ? 14 : 16)) pass(`stdin font-size ≥${inlineDesk ? 14 : 16}px at this density`, inline.fontSize)
else fail('stdin font-size floor', String(inline?.fontSize))
await shot('c-waiting')

await input().fill('Saad')
await input().press('Enter')
await hasOut('exit code 3')
const after = await out()
if (/Your name:\s*Saad/.test(after)) pass('typed answer echoed onto the prompt line')
else fail('typed answer echoed onto the prompt line', after.slice(-120))
const failRs = await runState()
if (failRs.state === 'failed' && /exit code 3|exit 3|red lines/.test(failRs.text)) pass(`run state: non-zero exit (${failRs.where})`, JSON.stringify(failRs.text))
else fail('run state: non-zero exit', `${failRs.state} / ${failRs.text}`)
// One shell: status bar carries run state everywhere; header pill only
// exists in the kb-open window (console-kb.mjs) to avoid a duplicate.
// Pill is always in the DOM; visibility is CSS-owned via an ancestor's
// display:none, so check client rects, not the pill's own computed display.
const pillShown = await page.locator('.console-header .pill')
  .evaluate((el) => el.getClientRects().length > 0)
  .catch(() => false)
if (!pillShown) pass('the header pill stands down for the status bar')
else fail('header pill should stand down', await page.locator('.console-header .pill').innerText())
const barState = await page.locator('footer[aria-label="Status bar"]').innerText()
if (/exit 3|Stopped early/.test(barState)) pass('status bar reports the failure + exit code', JSON.stringify(barState.slice(0, 60)))
else fail('status bar reports the failure', JSON.stringify(barState))
// Collapsing the console must not lose the state — the bar keeps carrying it.
await page.getByRole('button', { name: 'Hide output' }).click()
await page.waitForTimeout(300)
const collapsed = await page.locator('footer[aria-label="Status bar"] .status-remote').innerText().catch(() => '')
if (/Stopped early/.test(collapsed)) pass('collapsed console: the status bar still carries the state', JSON.stringify(collapsed))
else fail('collapsed console: state stays in the status bar', JSON.stringify(collapsed))
await page.getByRole('button', { name: 'Show output' }).click()
await page.waitForTimeout(300)
// Row treatment must differ per kind, and survive greyscale (rule + tint).
const kinds = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.console-row')]
  const pick = (k) => {
    const r = rows.find((x) => x.dataset.kind === k)
    if (!r) return null
    const cs = getComputedStyle(r)
    const txt = getComputedStyle(r.querySelector('.console-row__text'))
    return { rule: cs.borderLeftColor, ruleW: cs.borderLeftWidth, bg: cs.backgroundColor, color: txt.color, size: txt.fontSize, style: txt.fontStyle }
  }
  const segCs = (sel) => {
    const e = document.querySelector(sel)
    return e ? (({ color, fontStyle }) => ({ color, fontStyle }))(getComputedStyle(e)) : null
  }
  return { out: pick('out'), err: pick('err'), meta: pick('meta'),
    echoSeg: segCs('[data-seg="echo"]'), outSeg: segCs('[data-seg="out"]'), errSeg: segCs('[data-seg="err"]') }
})
info(`row styles: ${JSON.stringify(kinds)}`)
// One shell: rows are flat at every width; kinds separate by ink (stderr red, meta dim italic).
const inks = [kinds.outSeg, kinds.errSeg, kinds.meta && { color: kinds.meta.color, fontStyle: kinds.meta.style }]
  .filter(Boolean)
  .map((k) => `${k.color}|${k.fontStyle}`)
if (new Set(inks).size === inks.length) pass('stdout / stderr / meta separate by ink', JSON.stringify(inks))
else fail('kinds separate by ink', JSON.stringify(inks))
if (kinds.echoSeg && kinds.outSeg && kinds.echoSeg.color !== kinds.outSeg.color && kinds.echoSeg.fontStyle !== kinds.outSeg.fontStyle)
  pass('stdin echo differs from stdout in hue AND style on a shared line', JSON.stringify(kinds.echoSeg))
else fail('stdin echo differs from stdout on a shared line', JSON.stringify({ echo: kinds.echoSeg, out: kinds.outSeg }))
if (kinds.err && kinds.err.ruleW === '0px' && kinds.err.bg === kinds.out.bg && kinds.errSeg?.color === 'rgb(255, 138, 143)')
  pass('stderr rows are flat with --danger ink (no rule, no tint, any width)')
else fail('stderr flat-row treatment', JSON.stringify({ err: kinds.err, errSeg: kinds.errSeg }))
await shot('d-exit-error')

// ------------------------------------------- C. copy output (ACCEPTANCE 10.10)
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL_ })
const copyBtn = page.getByRole('button', { name: /Copy output|Copied/ })
if (await copyBtn.count()) {
  await copyBtn.click()
  await page.waitForTimeout(300)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  const label = await copyBtn.getAttribute('aria-label')
  if (clip.includes('Warsha console check') && clip.includes('ValueError') && clip.includes('\n'))
    pass('Copy output puts the whole transcript on the clipboard', `${clip.split('\n').length} lines, plain text`)
  else fail('Copy output', JSON.stringify(clip.slice(0, 120)))
  if (/Copied/.test(label ?? '')) pass('copy button confirms on itself', String(label))
  else fail('copy button confirms on itself', String(label))
} else fail('copy-all-output button exists in the console header')

// Right-click opens the transcript's context menu — coherent with the rest of the
// app (tree, tabs, editor). Its Copy row copies just the selection; Copy output
// (checked above) is for the whole transcript.
const selRow = page.locator('.console-row__text', { hasText: 'Warsha console check' }).first()
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.console-row__text')].find((e) => /Warsha console check/.test(e.textContent))
  const r = document.createRange()
  r.selectNodeContents(el)
  const s = window.getSelection()
  s.removeAllRanges()
  s.addRange(r)
})
await page.evaluate(() => navigator.clipboard.writeText('(nothing copied)'))
await selRow.click({ button: 'right' })
const transcriptMenu = page.getByRole('menu')
if (await transcriptMenu.isVisible().catch(() => false)) {
  pass('right-click opens the transcript menu')
  await transcriptMenu.getByRole('menuitem', { name: 'Copy', exact: true }).click()
  await page.waitForTimeout(300)
  const selClip = await page.evaluate(() => navigator.clipboard.readText())
  if (/Warsha console check/.test(selClip) && !/ValueError/.test(selClip))
    pass('the menu’s Copy copies just the selection', JSON.stringify(selClip.trim()))
  else fail('menu Copy copies the selection', JSON.stringify(selClip.slice(0, 80)))
} else fail('right-click opens the transcript menu', '(no menu appeared)')
// Selection must be visibly styled (not the browser default). Dev (`vite
// --port`) serves the source's nested CSS as-is, so Chrome's selectorText
// keeps the literal `&` — needs ancestry tracking. Prod (`vite build`)
// flattens it into a plain literal rule via Tailwind. Check both forms so
// this works either way.
const selStyle = await page.evaluate(() => {
  const walk = (rules, insideTranscript) => {
    for (const r of rules) {
      const here = insideTranscript || r.selectorText === '.console-transcript'
      const looksRight = r.selectorText && /::selection/.test(r.selectorText) && (here || /console-transcript/.test(r.selectorText))
      // cssText, not style.backgroundColor — the shorthand var() can't decompose
      // into a longhand and would read as empty.
      if (looksRight && r.style.cssText) return r.style.cssText
      if (r.cssRules) {
        const hit = walk(r.cssRules, here)
        if (hit) return hit
      }
    }
    return null
  }
  for (const sheet of document.styleSheets) {
    try { const hit = walk(sheet.cssRules, false); if (hit) return hit } catch { /* cross-origin */ }
  }
  return null
})
if (selStyle) pass('the transcript styles its own selection', selStyle)
else fail('transcript ::selection styling is missing')

// --------------------------------- D. 6000-line burst: autoscroll pill + Stop
await setEditor('for i in range(6000): print("line", i, "of six thousand")\n')
await runBtn().click()
// Mid-flight: program only writes, reads nothing, so the console must be pure
// transcript (sampled before the run finishes).
const duringRun = await input().count()
await hasOut('line 5999')
if (duringRun === 0) pass('no input UI while the program is only printing')
else fail('no input UI while streaming', `${duringRun} input(s) on screen`)
await page.waitForTimeout(400)
await shot('e-streaming-no-input')
const afterExit = await input().count()
if (afterExit === 0) pass('the input is gone again once the program exits')
else fail('input removed after exit', `${afterExit} input(s) still on screen`)
const stuck = await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Program output"]')
  return el.scrollHeight - el.scrollTop - el.clientHeight
})
if (stuck < 40) pass('console stuck to the bottom while streaming', `${Math.round(stuck)}px from bottom`)
else fail('console stuck to the bottom while streaming', `${Math.round(stuck)}px from bottom`)
const windowed = await page.locator('.console-row').count()
info(`rows in the DOM after 6000 lines: ${windowed}`)
if (windowed <= 1300) pass('long output is windowed, not 6000 live rows', `${windowed} rows`)
else fail('long output is windowed', `${windowed} rows`)
if (await page.getByRole('button', { name: /earlier lines/ }).count()) pass('earlier output is one click away')
else fail('earlier output is one click away')
await shot('e-longoutput')

// scroll up: sticking must pause and the pill must appear
await page.locator('[aria-label="Program output"]').evaluate((el) => { el.scrollTop = el.scrollHeight / 2 })
await page.waitForTimeout(200)
const pillBtn = page.getByRole('button', { name: /new line|Jump to latest/ })
if (await pillBtn.count()) pass('scroll-up raises the resume pill', await pillBtn.innerText())
else fail('scroll-up raises the resume pill')

// Uses a pending prompt, not a flood — the engine's 2 MiB output cap makes a
// capped flood pointless. Scroll up happens AFTER typing: focusing the input
// scrolls it into view (correct terminal behavior), so scrolling up first
// would be undone. Invariant under test: arriving output must not yank the
// reader back to the bottom.
await page.waitForTimeout(700)
await setEditor(
  'import time\n' +
  'for i in range(30): print("first pass", i)\n' +
  'name = input("Ready? ")\n' +
  'time.sleep(0.8)\n' +
  'for i in range(500): print("second pass", i)\n',
)
await runBtn().click()
await hasOut('Ready?')
await input().fill('yes')
await input().press('Enter')
await page.locator('[aria-label="Program output"]').evaluate((el) => { el.scrollTop = 0 })
await page.waitForTimeout(2600)
const pillState = await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Program output"]')
  const btn = [...document.querySelectorAll('button')].find((b) => /new line|Jump to latest/.test(b.innerText))
  return { pill: btn?.innerText ?? null, top: Math.round(el.scrollTop) }
})
if (/new line/.test(pillState.pill ?? '')) pass('resume pill counts unseen lines', JSON.stringify(pillState.pill))
else fail('resume pill counts unseen lines', JSON.stringify(pillState))
if (pillState.top === 0) pass('the reader was NOT yanked to the bottom by 500 new lines', 'scrollTop still 0')
else fail('the reader was not yanked to the bottom', `scrollTop ${pillState.top}`)
await shot('f-scroll-pill')
await pillBtn.click()
await page.waitForTimeout(400)
const resumed = await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Program output"]')
  return { gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
           pill: [...document.querySelectorAll('button')].some((b) => /new line|Jump to latest/.test(b.innerText)) }
})
if (resumed.gap < 40 && !resumed.pill) pass('tapping the pill resumes sticking and dismisses it', JSON.stringify(resumed))
else fail('tapping the pill resumes sticking', JSON.stringify(resumed))

// now an infinite printer: sticking must pause under a flood, and Stop must work
await page.waitForTimeout(700)
await setEditor('import itertools\nfor i in itertools.count(): print("spin", i)\n')
await runBtn().click()
await page.waitForFunction(
  () => ((document.querySelector('[aria-label="Program output"]')?.innerText || '').match(/spin/g) || []).length > 30,
  null, { timeout: 120000 })
await page.locator('[aria-label="Program output"]').evaluate((el) => { el.scrollTop = 0 })
await page.waitForTimeout(1200)
const paused = await page.evaluate(() => ({ top: document.querySelector('[aria-label="Program output"]').scrollTop }))
if (paused.top < 200) pass('sticking PAUSES while the reader is scrolled up', `scrollTop stayed at ${Math.round(paused.top)} under a print flood`)
else fail('sticking pauses while scrolled up', `scrollTop ran to ${Math.round(paused.top)}`)

// Stop must respond while the flood is running
const t = Date.now()
await stopBtn().click()
await hasOut('Stopped.')
const killMs = Date.now() - t
pass('Stop responds during an infinite print', `${killMs}ms`)
const n1 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
await page.waitForTimeout(1500)
const n2 = await page.evaluate(() => (document.querySelector('[aria-label="Program output"]').innerText.match(/spin/g) || []).length)
if (n1 === n2) pass('output ceased after Stop')
else fail('output ceased after Stop', `${n1} -> ${n2}`)
const stopRs = await runState()
if (stopRs.state === 'stopped') pass(`run state: stopped by you (neutral, ${stopRs.where})`, JSON.stringify(stopRs.text))
else fail('run state: stopped', `${stopRs.state} / ${stopRs.text}`)
await shot('g-stopped')

// ------------------------------------------------- E. clean exit + shortcut run
await page.waitForTimeout(700)
await setEditor('print("all good")\n')
await page.locator('.cm-content').press('Control+Enter')
await hasOut('all good')
// Status bar just says "Finished" — the transcript's meta row states the exit code in full.
const okRs = await runState()
if (okRs.state === 'ok' && /Finished|exit code 0/.test(okRs.text)) pass(`Ctrl+Enter runs, run state: ok (${okRs.where})`, JSON.stringify(okRs.text))
else fail('Ctrl+Enter runs / exit-0 status', `${okRs.state} / ${okRs.text}`)
await shot('h-exit-ok')

// --------------------------------------------------- F. geometry + overlap check
// Founder ruling (P1): header icon-only controls are 40px visual boxes on
// touch; the 44px hit area comes from Button.tsx's `after:` pseudo, read off
// its own computed inset.
const geo = await page.evaluate((sel) => {
  const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().toJSON() : null }
  const header = r(sel)
  const runB = [...document.querySelectorAll(`${sel} button`)].map((b) => {
    const rect = b.getBoundingClientRect().toJSON()
    const after = getComputedStyle(b, '::after')
    const expand = after.content === '""' ? Math.abs(parseFloat(after.top) || 0) + Math.abs(parseFloat(after.bottom) || 0) : 0
    return {
      name: b.getAttribute('aria-label') ?? b.innerText.trim(),
      ...rect,
      effectiveWidth: rect.width + expand,
      effectiveHeight: rect.height + expand,
    }
  })
  return { header, runB, divider: r('[role="separator"][aria-label="Resize output"]') }
}, HEADER_SEL)
info(`header: ${JSON.stringify(geo.header)}`)
for (const b of geo.runB) info(`  btn ${b.name}: ${Math.round(b.width)}x${Math.round(b.height)} (effective ${Math.round(b.effectiveWidth)}x${Math.round(b.effectiveHeight)}) @ y=${Math.round(b.y)}`)
// DENSITY: 44px effective is touch-only; desk runs these at 28px visual (WCAG 2.2 AA floor is 24).
const geoDesk = await page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)
const hitFloor = geoDesk ? 24 : 43.5
const tooSmall = geo.runB.filter((b) => b.effectiveHeight < hitFloor || b.effectiveWidth < hitFloor)
if (!tooSmall.length) pass(`every console-header button is ≥${Math.ceil(hitFloor)}px effective at this density`)
else fail(`console-header buttons ≥${Math.ceil(hitFloor)}px effective`, JSON.stringify(tooSmall.map((b) => `${b.name} ${Math.round(b.effectiveWidth)}x${Math.round(b.effectiveHeight)}`)))
const spill = geo.runB.filter((b) => b.y < geo.header.y - 0.5 || b.y + b.height > geo.header.y + geo.header.height + 0.5)
if (!spill.length) pass('no header button overflows the header bar')
else fail('header buttons overflow the header', JSON.stringify(spill.map((b) => b.name)))
// One shell: resize handle renders at every width (touch handle carries the coarse-pointer grab area).
if (geo.divider) {
  const overlaps = geo.divider.y + geo.divider.height > geo.header.y + 0.5
  if (!overlaps) pass('resize handle does not overlap the header', `handle bottom ${Math.round(geo.divider.y + geo.divider.height)} ≤ header top ${Math.round(geo.header.y)}`)
  else fail('resize handle overlaps the header')
} else fail('resize handle missing — it renders at every width now')
// Input geometry (44px/16px) is asserted in section B while it exists — nothing to measure here.

// Ctrl+L clears, the way it does in a shell.
await page.locator('[aria-label="Program output"]').click()
await page.keyboard.press('Control+l')
await page.waitForTimeout(300)
const clearedText = await out()
if (/Cleared\./.test(clearedText)) pass('Ctrl+L clears the console like a shell', JSON.stringify(clearedText.trim()))
else fail('Ctrl+L clears the console', JSON.stringify(clearedText.slice(0, 80)))

const notable = errors.filter((e) => !/favicon|404/i.test(e))
if (!notable.length) pass('no unexpected console errors')
else { fail('no unexpected console errors', String(notable.length)); notable.slice(0, 5).forEach((e) => info('  ! ' + e.slice(0, 160))) }

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${TAG}: ${results.length - failed.length}/${results.length} passed ====`)
failed.forEach((f) => console.log(`FAILED: ${f[1]} :: ${f[2]}`))
await ctx.close()
process.exit(failed.length ? 1 : 0)
