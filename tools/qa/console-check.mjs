/* Console/RunBar verification against the real Python engine on localhost:8089.
 * Python boots in ~3s, so every console behaviour (streaming, stdin, exit codes,
 * autoscroll pause, 6000-line burst + Stop) is testable end to end. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = 'http://localhost:8091/'
const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const W = Number(process.argv[2] ?? 1280)
const H = Number(process.argv[3] ?? 900)
const TAG = process.argv[4] ?? String(W)
const profile = mkdtempSync(join(tmpdir(), 'warsha-console-'))

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: '/usr/bin/google-chrome',
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
const runBtn = () => page.getByRole('button', { name: 'Run', exact: true })
const stopBtn = () => page.getByRole('button', { name: 'Stop', exact: true })
const input = () => page.locator('[aria-label="Program input"]')
const statusLine = () => page.locator('p[role="status"][data-state]')
const shot = (n) => page.screenshot({ path: `${SHOTS}/con-${TAG}-${n}.png` })

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
  await page.getByRole('button', { name: /Python starter/ }).click()
  await page.waitForTimeout(1200)
  // Templates now open a "New project from …" dialog (name + Create).
  for (const name of ['Create', 'Replace']) {
    const b = page.getByRole('button', { name, exact: true })
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(1200); break }
  }
}
if (await page.locator('.cm-content').count()) pass('project seeded with main.py')
else { fail('project seeded with main.py'); await shot('seed-fail'); process.exit(1) }

// The console starts collapsed on an empty project (App collapses it so the start
// panel gets the room), and that choice persists — open it before inspecting it.
async function ensureConsoleOpen(page) {
  if (await page.locator('[aria-label="Program output"]').count()) return
  await page.getByRole('button', { name: 'Show output' }).click()
  await page.waitForTimeout(400)
}
await ensureConsoleOpen(page)

// ------------------------------------------------------- A. idle / empty state
const idleStatus = await statusLine().innerText().catch(() => '')
const idleState = await statusLine().getAttribute('data-state').catch(() => null)
if (idleState === 'idle' && /Ready/i.test(idleStatus)) pass('status line: idle', JSON.stringify(idleStatus))
else fail('status line: idle', `${idleState} / ${idleStatus}`)
const emptyText = await out()
if (/Output will appear here/.test(emptyText))
  pass('empty console is a designed hint, not a void', JSON.stringify(emptyText.replace(/\s+/g, ' ').trim()))
else fail('empty console hint', JSON.stringify(emptyText))
const inputDisabled = await input().isDisabled()
if (inputDisabled) pass('stdin row disabled while nothing runs')
else fail('stdin row disabled while nothing runs')
const idlePh = await input().getAttribute('placeholder')
info(`idle placeholder: ${JSON.stringify(idlePh)}`)
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
const waitState = await statusLine().getAttribute('data-state')
const waitText = await statusLine().innerText()
const waitPh = await input().getAttribute('placeholder')
const rowWaiting = await page.locator('.stdin-row').getAttribute('data-waiting')
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
if (waitState === 'waiting' && /waiting|Waiting/.test(waitText)) pass('status line: waiting for input', JSON.stringify(waitText))
else fail('status line: waiting for input', `${waitState} / ${waitText}`)
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
await shot('c-waiting')

await input().fill('Saad')
await input().press('Enter')
await hasOut('exit code 3')
const after = await out()
if (/Your name:\s*Saad/.test(after)) pass('typed answer echoed onto the prompt line')
else fail('typed answer echoed onto the prompt line', after.slice(-120))
const failState = await statusLine().getAttribute('data-state')
const failText = await statusLine().innerText()
if (failState === 'failed' && /exit code 3|red lines/.test(failText)) pass('status line: non-zero exit', JSON.stringify(failText))
else fail('status line: non-zero exit', `${failState} / ${failText}`)
// Below 900px with the console open the pill stands down: the status line right
// above the input row carries the same state, and five controls do not fit 390px.
// Collapse the console and it must be back, exit code and all.
if (W >= 900) {
  const pill = await page.locator('.pill').innerText()
  if (/exit 3|Stopped early/.test(pill)) pass('header pill reports the failure + exit code', JSON.stringify(pill))
  else fail('header pill reports the failure', JSON.stringify(pill))
} else {
  if (!(await page.locator('.pill').count())) pass('phone + console open: the pill stands down for the status line')
  else fail('phone + console open: pill should stand down', await page.locator('.pill').innerText())
  await page.getByRole('button', { name: 'Hide output' }).click()
  await page.waitForTimeout(300)
  const collapsed = await page.locator('.pill').innerText().catch(() => '')
  if (/Stopped early/.test(collapsed)) pass('collapsed console: the pill carries the state in the header', JSON.stringify(collapsed))
  else fail('collapsed console: pill in the header', JSON.stringify(collapsed))
  await page.getByRole('button', { name: 'Show output' }).click()
  await page.waitForTimeout(300)
}
// Row treatment must differ per kind, and survive greyscale (rule + tint).
const kinds = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.console-row')]
  const pick = (k) => {
    const r = rows.find((x) => x.dataset.kind === k)
    if (!r) return null
    const cs = getComputedStyle(r)
    const txt = getComputedStyle(r.querySelector('.console-row__text'))
    return { rule: cs.borderLeftColor, bg: cs.backgroundColor, color: txt.color, size: txt.fontSize, style: txt.fontStyle }
  }
  const seg = document.querySelector('[data-seg="echo"]')
  const segOut = document.querySelector('[data-seg="out"]')
  const segCs = (e) => e ? (({ color, fontStyle }) => ({ color, fontStyle }))(getComputedStyle(e)) : null
  return { out: pick('out'), err: pick('err'), meta: pick('meta'), echoSeg: segCs(seg), outSeg: segCs(segOut) }
})
info(`row styles: ${JSON.stringify(kinds)}`)
const rowKinds = [kinds.out, kinds.err, kinds.meta].filter(Boolean)
const distinct = new Set(rowKinds.map((k) => `${k.rule}|${k.bg}|${k.color}|${k.size}`))
if (distinct.size === rowKinds.length) pass('stdout / stderr / meta rows are visually distinct', `${distinct.size} distinct row treatments`)
else fail('row kinds are visually distinct', JSON.stringify([...distinct]))
if (kinds.echoSeg && kinds.outSeg && kinds.echoSeg.color !== kinds.outSeg.color && kinds.echoSeg.fontStyle !== kinds.outSeg.fontStyle)
  pass('stdin echo differs from stdout in hue AND style on a shared line', JSON.stringify(kinds.echoSeg))
else fail('stdin echo differs from stdout on a shared line', JSON.stringify({ echo: kinds.echoSeg, out: kinds.outSeg }))
if (kinds.err && kinds.err.rule !== kinds.out.rule && kinds.err.bg !== kinds.out.bg)
  pass('stderr carries a rule AND a tint (survives greyscale)')
else fail('stderr carries a rule AND a tint')
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

// --------------------------------- D. 6000-line burst: autoscroll pill + Stop
await setEditor('for i in range(6000): print("line", i, "of six thousand")\n')
await runBtn().click()
await hasOut('line 5999')
await page.waitForTimeout(400)
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

// The pill must COUNT what arrived while the reader was away. Driven by a
// pending prompt rather than a flood, because the Python engine stops emitting
// after its own 2 MiB per-run output cap and a capped flood adds nothing new.
await page.waitForTimeout(700)
await setEditor('for i in range(30): print("first pass", i)\nname = input("Ready? ")\nfor i in range(500): print("second pass", i)\n')
await runBtn().click()
await hasOut('Ready?')
await page.locator('[aria-label="Program output"]').evaluate((el) => { el.scrollTop = 0 })
await page.waitForTimeout(300)
await input().fill('yes')
await input().press('Enter')
await page.waitForTimeout(1800)
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
const stopState = await statusLine().getAttribute('data-state')
const stopText = await statusLine().innerText()
if (stopState === 'stopped') pass('status line: stopped by you (neutral)', JSON.stringify(stopText))
else fail('status line: stopped', `${stopState} / ${stopText}`)
await shot('g-stopped')

// ------------------------------------------------- E. clean exit + shortcut run
await page.waitForTimeout(700)
await setEditor('print("all good")\n')
await page.locator('.cm-content').press('Control+Enter')
await hasOut('all good')
const okState = await statusLine().getAttribute('data-state')
const okText = await statusLine().innerText()
if (okState === 'ok' && /exit code 0/.test(okText)) pass('Ctrl+Enter runs, status line: exit 0', JSON.stringify(okText))
else fail('Ctrl+Enter runs / exit-0 status', `${okState} / ${okText}`)
await shot('h-exit-ok')

// --------------------------------------------------- F. geometry + overlap check
const geo = await page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().toJSON() : null }
  const header = r('.console-header')
  const runB = [...document.querySelectorAll('.console-header button')].map((b) => ({
    name: b.getAttribute('aria-label') ?? b.innerText.trim(), ...b.getBoundingClientRect().toJSON(),
  }))
  return { header, runB, divider: r('[role="separator"][aria-label="Resize output"]'), input: r('[aria-label="Program input"]') }
})
info(`header: ${JSON.stringify(geo.header)}`)
for (const b of geo.runB) info(`  btn ${b.name}: ${Math.round(b.width)}x${Math.round(b.height)} @ y=${Math.round(b.y)}`)
const tooSmall = geo.runB.filter((b) => b.height < 43.5 || b.width < 43.5)
if (!tooSmall.length) pass('every console-header button is ≥44px')
else fail('console-header buttons ≥44px', JSON.stringify(tooSmall.map((b) => `${b.name} ${Math.round(b.width)}x${Math.round(b.height)}`)))
const spill = geo.runB.filter((b) => b.y < geo.header.y - 0.5 || b.y + b.height > geo.header.y + geo.header.height + 0.5)
if (!spill.length) pass('no header button overflows the header bar')
else fail('header buttons overflow the header', JSON.stringify(spill.map((b) => b.name)))
if (geo.divider) {
  const overlaps = geo.divider.y + geo.divider.height > geo.header.y + 0.5
  if (!overlaps) pass('resize handle does not overlap the header', `handle bottom ${Math.round(geo.divider.y + geo.divider.height)} ≤ header top ${Math.round(geo.header.y)}`)
  else fail('resize handle overlaps the header')
} else info('no resize handle at this width (phone layout, by design)')
if (geo.input && geo.input.height >= 43.5) pass('stdin input is ≥44px tall')
else fail('stdin input ≥44px', JSON.stringify(geo.input))
const fs = await page.evaluate(() => getComputedStyle(document.querySelector('[aria-label="Program input"]')).fontSize)
if (parseFloat(fs) >= 16) pass('stdin font-size ≥16px (no iOS zoom on focus)', fs)
else fail('stdin font-size ≥16px', fs)

const notable = errors.filter((e) => !/favicon|404/i.test(e))
if (!notable.length) pass('no unexpected console errors')
else { fail('no unexpected console errors', String(notable.length)); notable.slice(0, 5).forEach((e) => info('  ! ' + e.slice(0, 160))) }

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${TAG}: ${results.length - failed.length}/${results.length} passed ====`)
failed.forEach((f) => console.log(`FAILED: ${f[1]} :: ${f[2]}`))
await ctx.close()
process.exit(failed.length ? 1 : 0)
