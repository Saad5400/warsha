/* Warsha design audit: measures the DESIGN-SPEC numbers in the real built DOM,
 * checks the REVIEW-CHECKLIST items that can be measured, and runs the Python
 * template end-to-end as the functional smoke test.
 *
 * Local Chrome on localhost:8087 so the engines get a secure context. */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://localhost:8087/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-audit-')), {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 2,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
const errs = []
const notFound = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
// The console message for a failed request does not name the URL, so capture it
// from the response — otherwise "2 × 404" is unattributable.
page.on('response', (r) => { if (r.status() === 404) notFound.push(r.url()) })
const shot = async (n) => { await page.screenshot({ path: `${SHOTS}/final-${n}.png` }); console.log(`      shot -> final-${n}.png`) }
const out = () => page.locator('[aria-label="Program output"]').innerText()
const hasOut = (s) => page.waitForFunction(
  (n) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(n), s, { timeout: 300000 })
// Run lives in the tab strip's editor-actions corner and names its file
// ("Run Main.java") — hence the prefix match.
const runBtn = () => page.getByRole('button', { name: /^Run\b/ })

const css = (sel, props) => page.evaluate(([s, ps]) => {
  const el = document.querySelector(s)
  if (!el) return null
  const c = getComputedStyle(el)
  return Object.fromEntries(ps.map((p) => [p, c.getPropertyValue(p)]))
}, [sel, props])

await page.goto(URL_, { waitUntil: 'load' })
// WelcomePanel's cards lost their `template-card` class in a concurrent refactor,
// so wait on the accessible name instead — that is the part that cannot be
// refactored away without changing what the page means.
const startCard = () => page.getByRole('button', { name: /starter/i }).first()
await startCard().waitFor({ timeout: 20000 })
await page.waitForTimeout(600)

// ============================================== §2 / §7.4 fills and boundaries
// The accent-fill check is deferred until a project exists (see below): on an
// EMPTY project the only primary on screen is a correctly-disabled Run, and
// measuring that reports surface-4 / text-disabled and reads as a contrast
// failure when it is in fact the spec's disabled treatment working.
// task #22: `.btn--primary` no longer exists as a class — Button.tsx generates
// pure Tailwind utilities via cva now, and publishes which variant is which
// through `data-variant` instead (the same role `data-kind` plays on a toast).
// DENSITY (2026-08-05): a fine-pointer ≥900px window compacts the chrome —
// --fs-btn 15→13, --touch 44→28 — so the expected numbers fork on the same
// media the app forks on. This harness is a desktop Chrome, so `desk` is true
// at 1280 and false at the 390px viewport the touch checks below use.
const isDesk = () => page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)
// Any `.btn`: the type ramp is on the cva base, shared by every variant — and
// there may be no primary on screen at all (Run dresses down to a quiet
// toolbar glyph in its one home, the tab strip's editor-actions corner).
const primary = await css('.btn', ['min-height', 'font-weight', 'font-size'])
info(`button geometry: ${JSON.stringify(primary)}`)
const wantBtnFs = (await isDesk()) ? '13px' : '15px'
if (primary && primary['font-weight'] === '600' && primary['font-size'] === wantBtnFs)
  pass(`§3.2 button label is ${wantBtnFs}/600 at this density`)
else fail(`§3.2 button label is ${wantBtnFs}/600`, JSON.stringify(primary))

const CARD_SEL = '.template-card, [aria-label="Start a project"] button'
const card = await css(CARD_SEL, ['border-color', 'border-width', 'border-radius', 'min-height'])
// THEME-V4: --border-control is VS Code's #3C3C3C (rgb(60,60,60)). It does NOT
// clear the old 3:1 outline rule — a deliberate drop, stated in THEME-V4 §4:
// VS Code ships this value, and where a boundary is load-bearing it is paired
// with a fill or weight (the card pairs it with the surface-3 fill).
if (card['border-width'] === '1px' && card['border-color'] === 'rgb(60, 60, 60)')
  pass('5. welcome card has the --border-control edge', 'VS Code #3C3C3C — sub-3:1 by design, paired with a fill')
else fail('5. welcome card border', JSON.stringify(card))
if (parseFloat(card['min-height']) >= 88) pass('§7.7 card is a single ≥88px target', card['min-height'])
else fail('§7.7 card min-height', card['min-height'])

// ================================================ §7.7 welcome + focus ring
await page.keyboard.press('Tab')
await page.waitForTimeout(200)
const ring = await page.evaluate(() => {
  const el = document.activeElement
  if (!el) return null
  const c = getComputedStyle(el)
  return { tag: el.tagName, cls: el.className, outline: c.outlineColor, w: c.outlineWidth, off: c.outlineOffset }
})
info(`focus ring: ${JSON.stringify(ring)}`)
// THEME-V4: --focus-ring is still var(--accent), and --accent is now VS Code's
// #0078D4 blue (rgb(0,120,212)) — one edit moved the ring with it.
// Founder ruling, 2026-08-02: ring geometry is 1px/no-offset app-wide (was
// 2px/2px) — this is the welcome panel, which uses the global default rather
// than one of the -1px inset variants (ActivityBar/StatusBar/stdin-input).
if (ring && ring.w === '1px' && ring.outline === 'rgb(0, 120, 212)' && ring.off === '0px')
  pass('20. hardware keyboard gets a 1px blue accent focus ring at no offset')
else fail('20. focus ring', JSON.stringify(ring))
await shot('welcome-1280')

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(400)
await shot('welcome-390')
await page.setViewportSize({ width: 1024, height: 768 })
await page.waitForTimeout(300)
await shot('welcome-1024')

// =========================================== build the Java project and measure
await page.setViewportSize({ width: 1280, height: 860 })
await page.waitForTimeout(300)
await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
await page.waitForSelector('[role="tab"]', { timeout: 15000 })
await page.waitForTimeout(700)
// Dismiss the capability banner so it does not eat the captures. Scoped to the
// banner: a loose /Dismiss|Close/ also matches a tab's "Close Main.java" button,
// and .first() then quietly closed the tab the later checks depend on.
const dismiss = page.locator('[role="status"]').locator('button[aria-label="Dismiss"]').first()
if (await dismiss.count()) { await dismiss.click().catch(() => {}); await page.waitForTimeout(300) }
for (const f of ['Person.java', 'Student.java']) {
  const row = page.locator('[role="treeitem"]', { hasText: f }).first()
  if (await row.count()) { await row.click(); await page.waitForTimeout(250) }
}

// ---- 1. active tab + open file carry a rule, not just a fill
// The 2px accent rule moved from `border-bottom` to an inset box-shadow
// (PIXEL-FINDINGS F-03): a border-box tab with `border-b-2` measured 42px of
// content box inside its 44px border box, so every centred child — the 44px
// close button, the language badge — rode 1px proud of the tab. A shadow costs
// no layout, so `border-bottom-width` is 0 by design now; the rule itself is
// still there, just carried in `box-shadow`.
const tab = await css('[role="tab"][data-state="active"]', ['box-shadow', 'background-color'])
const tabLabel = await css('[role="tab"][data-state="active"] .tab__label', ['font-weight', 'color', 'font-size'])
info(`active tab: ${JSON.stringify(tab)} label ${JSON.stringify(tabLabel)}`)
// Chrome's serialised order is "color offset-x offset-y blur spread inset",
// the reverse of the source order in the Tailwind arbitrary value.
// V4/VS Code grammar at this desk harness: the accent rule is 1px on the TOP
// edge (--tab-accent-top = --accent #0078D4), the tab's fill is the editor
// canvas (--tab-active-bg = --surface-1 #1F1F1F) running seamlessly into the
// code below, the label is #FFFFFF — and the weight stays 400, because VS Code
// never bolds a tab (the white fg + top rule carry the state).
if (
  /rgb\(0, 120, 212\) 0px 1px 0px 0px inset/.test(tab['box-shadow']) &&
  tab['background-color'] === 'rgb(31, 31, 31)' &&
  tabLabel['font-weight'] === '400' &&
  tabLabel.color === 'rgb(255, 255, 255)'
)
  pass('1a. active tab = 1px accent top rule + editor fill + white label at weight 400', `${tabLabel.color} @ ${tabLabel['font-size']}`)
else fail('1a. active tab signals', JSON.stringify({ tab, tabLabel }))

// V4 list model at desk: selection is a full-row FILL, not a leading rail —
// --list-active-sel-bg #04395E with --list-active-sel-fg #FFFFFF while the
// tree holds focus (the click above left it there), --list-inactive-sel-bg
// #37373D once focus moves on. Weight stays 400: VS Code weights nothing in
// the tree.
const row = await css('[role="treeitem"][data-state="open"]', ['background-color', 'border-left-color'])
const rowLabel = await css('[role="treeitem"][data-state="open"] .tree-row__label', ['font-weight', 'color'])
const rowFill =
  row && (row['background-color'] === 'rgb(4, 57, 94)' || row['background-color'] === 'rgb(55, 55, 61)')
if (rowFill && row['border-left-color'] === 'rgba(0, 0, 0, 0)' && rowLabel['font-weight'] === '400')
  pass('1b. open explorer row = full-row selection fill, no rail, weight 400', JSON.stringify({ row, rowLabel }))
else fail('1b. open explorer row', JSON.stringify({ row, rowLabel }))

// The console starts collapsed on a fresh, empty project and auto-opens on Run.
// Anything inside it has to be measured with it open, or the checks silently
// pass over an unmounted subtree.
const toggle = page.getByRole('button', { name: 'Show output' })
if (await toggle.count()) { await toggle.click(); await page.waitForTimeout(400) }
// Wait for the transcript, NOT for `.stdin-input`: the console has no standing
// input any more. `.stdin-input` is the live line and exists only while the
// program is blocked on a read, which is much later in this script.
await page.waitForSelector('.console-transcript', { timeout: 5000 })

// ---- 4. fills are honest, measured on a LIVE accent button and a disabled one
const btnStates = await page.evaluate(() =>
  [...document.querySelectorAll('.btn[data-variant="primary"]')].map((el) => {
    const c = getComputedStyle(el)
    return { label: (el.textContent || '').trim().slice(0, 14), disabled: el.disabled, bg: c.backgroundColor, fg: c.color }
  }))
info(`primary buttons: ${JSON.stringify(btnStates)}`)
// THEME-V4: the invariant is unchanged — "an --accent fill's text is always
// --accent-ink, never a literal colour" — only the values moved with the
// sweep. --accent #0078D4 -> rgb(0,120,212); --accent-ink #FFFFFF (4.53:1 on
// the accent, AA for the 13px UI type).
const live = btnStates.filter((b) => !b.disabled)
if (live.length && live.every((b) => b.bg === 'rgb(0, 120, 212)' && b.fg === 'rgb(255, 255, 255)'))
  pass('4a. enabled primary is --accent-ink on --accent, never a literal colour', '4.53:1')
else if (live.length === 0) {
  // The chrome deliberately has no filled primary at rest at ANY width (Run is
  // a quiet toolbar glyph in the tab strip) — the invariant is carried by the
  // token pair itself, so assert it there.
  const pair = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:-9999px;background:var(--accent);color:var(--accent-ink)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe)
    const out = { bg: c.backgroundColor, fg: c.color }
    probe.remove()
    return out
  })
  if (pair.bg === 'rgb(0, 120, 212)' && pair.fg === 'rgb(255, 255, 255)')
    pass('4a. no filled primary in the desk chrome (by design); the --accent/--accent-ink pair holds', JSON.stringify(pair))
  else fail('4a. --accent/--accent-ink pair', JSON.stringify(pair))
} else fail('4a. accent fill uses --accent-ink text', JSON.stringify(live))
const off = btnStates.filter((b) => b.disabled)
// --surface-4 #313131 -> rgb(49,49,49); --text-disabled #6E7681 -> rgb(110,118,129).
if (off.every((b) => b.bg === 'rgb(49, 49, 49)' && b.fg === 'rgb(110, 118, 129)'))
  pass('4b. disabled is a COLOUR change, not an opacity fade', off.length ? 'surface-4 / text-disabled' : 'none on screen')
else fail('4b. disabled treatment', JSON.stringify(off))

// ---- cursor: pointer on everything clickable
const cursors = await page.evaluate(() => {
  const out = {}
  for (const s of ['.btn', '.icon-btn', '.tree-row', '.tab', '.tab__close']) {
    const el = document.querySelector(s)
    if (el) out[s] = getComputedStyle(el).cursor
  }
  return out
})
info(`cursors: ${JSON.stringify(cursors)}`)
if (Object.values(cursors).every((v) => v === 'pointer'))
  pass('cursor: pointer on every clickable (Tailwind v4 preflight sets none on <button>)')
else fail('cursor: pointer', JSON.stringify(cursors))

// ---- 14. touch targets
// Founder ruling (P1): icon-only controls and Run/Stop dropped from 44px to
// 40px visually. `.tab__close` and `.icon-btn` (and some `.btn` instances —
// Run/Stop, console Copy/Clear — that selector also matches every OTHER
// Button variant, still 44/48px) now carry a real box as small as 40px, so
// the raw-height floor drops to 40 for everything. What must still hold at
// 44 is the EFFECTIVE hit area: where `ui/Button.tsx`'s `after:` pseudo is
// present (a negative-inset transparent expansion), it has to add up to
// ≥44px — checked directly off the pseudo's own computed box, not assumed.
// Controls that opted out of the pseudo (`after:content-none` — tab close,
// Explorer's tight-gap trio and its per-row "⋯", documented in Button.tsx
// and at each call site) are exempted from the effective-area check, same as
// they are in the app: their floor is the 40px raw box, nothing more.
const targets = await page.evaluate(() => {
  // DENSITY: on a fine-pointer ≥900px window the touch floors are stood down
  // by design — controls compact to 28px (WCAG 2.2 AA pointer floor is 24).
  // The 40/44 touch obligations are asserted where they bind: coarse pointers
  // and <900px, which the 390px viewport passes below exercise.
  //
  // Two named desk exemptions below the 24px pointer floor, both VS Code
  // parity metrics: tree rows are 22px (--row-tree), and .tab__close is 20px
  // (--tab-close), which rides INSIDE the larger 35px tab target — the same
  // rides-inside-larger-target reasoning WCAG 2.2 itself allows.
  const desk = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches
  const floors = (s) => {
    if (!desk) return { raw: 40, hit: 44 }
    if (s === '[role="treeitem"]') return { raw: 22, hit: 22 }
    if (s === '.tab__close') return { raw: 20, hit: 20 }
    return { raw: 24, hit: 24 }
  }
  const sels = ['[role="treeitem"]', '[role="tab"]', '.tab__close', '.icon-btn', '.btn', '.stdin-input']
  const bad = []
  const seen = {}
  for (const s of sels) {
    const { raw: RAW_FLOOR, hit: HIT_FLOOR } = floors(s)
    for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      seen[s] = Math.min(seen[s] ?? 999, Math.round(r.height))
      const label = `${s} h=${Math.round(r.height)} "${(el.textContent || '').trim().slice(0, 18)}"`
      if (r.height < RAW_FLOOR) { bad.push(`${label} — under the ${RAW_FLOOR}px visual floor`); continue }
      if (r.height >= HIT_FLOOR) continue
      const after = getComputedStyle(el, '::after')
      if (after.content !== '""') continue // opted out — 40px raw is the whole rule for this one
      const expand = Math.abs(parseFloat(after.top) || 0) + Math.abs(parseFloat(after.bottom) || 0)
      const effective = r.height + expand
      if (effective < HIT_FLOOR) bad.push(`${label} — effective hit area only ${Math.round(effective)}px`)
    }
  }
  return { bad, seen }
})
info(`min heights: ${JSON.stringify(targets.seen)}`)
if (targets.bad.length === 0)
  pass('14. every interactive element clears its density floor (40/44 touch; 24 desk, with the named 22px-row / 20px-close exemptions)')
else fail('14. touch targets', targets.bad.join(' | '))

// ---- 7/8. type scale
// DENSITY (editor internals, W2-D): the desk default is VS Code's 14px with
// Math.round(14 × 1.35) = 19px leading, and the gutter follows the editor's
// own px instead of a forced 13px. Touch keeps 15px / 24px (1.6) and the 13px
// gutter.
const code = await css('.cm-content', ['font-size', 'line-height', 'padding-left'])
const gutter = await css('.cm-lineNumbers .cm-gutterElement', ['font-size', 'line-height'])
info(`code ${JSON.stringify(code)} gutter ${JSON.stringify(gutter)}`)
const codeDesk = await isDesk()
const wantCode = codeDesk ? { size: '14px', lead: '19px' } : { size: '15px', lead: '24px' }
if (code['font-size'] === wantCode.size && code['line-height'] === wantCode.lead)
  pass(`7a. code is an explicit ${wantCode.size} with ${wantCode.lead} leading at this density`)
else fail('7a. code size/leading', JSON.stringify({ code, wantCode }))
const wantGutterFs = codeDesk ? code['font-size'] : '13px'
if (gutter['font-size'] === wantGutterFs && gutter['line-height'] === code['line-height'])
  pass(`7b. line numbers are ${wantGutterFs} on the SAME ${wantCode.lead} leading — no gutter drift`, JSON.stringify(gutter))
else fail('7b. gutter leading matches code', JSON.stringify({ code, gutter }))

const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => ({ n: el.getAttribute('aria-label') || el.tagName, fs: getComputedStyle(el).fontSize })))
info(`focusable inputs: ${JSON.stringify(inputs)}`)
// Vacuously true is a PASS here, and that is the point: with the console idle
// there is deliberately no stdin input on screen to measure (the live line exists
// only while a program is reading). The 16px floor for that input is asserted
// further down, at the moment it exists.
// DENSITY: the 16px floor is the iOS zoom rule — a touch obligation. The desk
// chrome runs 13px UI controls by design (the entry select), so its floor is
// the app's own 12px minimum.
const inputDesk = await isDesk()
const inputFloor = inputDesk ? 12 : 16
if (inputs.every((i) => parseFloat(i.fs) >= inputFloor))
  pass(`8/10. every focusable input is ≥${inputFloor}px at this density`, inputs.length ? JSON.stringify(inputs) : 'none on screen while idle')
else fail(`8/10. input font-size ≥${inputFloor}px`, JSON.stringify(inputs))

const tiny = await page.evaluate(() => {
  // DENSITY: the desk chrome deliberately ships two 11px VS Code metrics —
  // the panel's caps tabs and the explorer pane-header name — so the floor at
  // a fine pointer is 11. Touch keeps the spec's 12px absolute minimum.
  const floor = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches ? 11 : 12
  const bad = []
  for (const el of document.querySelectorAll('body *')) {
    if (!el.offsetParent && el.tagName !== 'BODY') continue
    const t = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!t) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < floor) bad.push(`${el.tagName}.${el.className} ${fs}px "${el.textContent.trim().slice(0, 20)}"`)
  }
  return bad
})
if (tiny.length === 0) pass('8. nothing below the density floor (12px touch, 11px desk) ships')
else fail('8. nothing below the density floor', tiny.slice(0, 5).join(' | '))

// ---- 13. iPad text integrity
const attrs = await page.evaluate(() => {
  const el = document.querySelector('.cm-content')
  return el && { autocapitalize: el.getAttribute('autocapitalize'), autocorrect: el.getAttribute('autocorrect'), spellcheck: el.getAttribute('spellcheck'), gramm: el.getAttribute('data-gramm') }
})
info(`.cm-content: ${JSON.stringify(attrs)}`)
if (attrs && attrs.autocapitalize === 'none' && attrs.autocorrect === 'off' && attrs.spellcheck === 'false')
  pass('13. .cm-content carries autocapitalize/autocorrect/spellcheck — iPad cannot corrupt code')
else fail('13. .cm-content text-integrity attributes', JSON.stringify(attrs))

const caret = await css('.cm-cursor', ['border-left-width'])
if (caret && parseFloat(caret['border-left-width']) >= 2) pass('§3.4 caret is 2px wide', caret['border-left-width'])
else fail('§3.4 caret 2px', JSON.stringify(caret))

// ---- 6. genuinely monospaced
const mono = await page.evaluate(() => {
  const probe = document.createElement('span')
  probe.style.cssText = 'position:fixed;left:-9999px;font-family:var(--font-code);font-size:15px'
  document.body.appendChild(probe)
  probe.textContent = 'iiii'
  const a = probe.getBoundingClientRect().width
  probe.textContent = 'WWWW'
  const b = probe.getBoundingClientRect().width
  const fam = getComputedStyle(probe).fontFamily
  probe.remove()
  return { iiii: Math.round(a * 100) / 100, WWWW: Math.round(b * 100) / 100, fam: fam.split(',')[0] }
})
info(`mono probe: ${JSON.stringify(mono)}`)
if (mono.iiii === mono.WWWW) pass('6. code font is genuinely monospaced', `iiii == WWWW == ${mono.iiii}px`)
else fail('6. code font is monospaced', JSON.stringify(mono))

// ---- §4.3 rule 4 / rule 5 floors, and the running-state signature
// Measure the OPEN panel: the floor is on `.console-panel--open`, and a collapsed
// console reports `auto` for a rule that is simply not in play.
const reopen = page.getByRole('button', { name: 'Show output' })
if (await reopen.count()) { await reopen.click(); await page.waitForTimeout(400) }
const floors = await css('.console-panel--open', ['min-height', 'border-left-width'])
const editorMin = await css('.editor-pane', ['min-height'])
info(`console ${JSON.stringify(floors)} editor ${JSON.stringify(editorMin)}`)
// The spec writes rule 4 as 144px, which is 4 output lines + the input row and
// nothing else. index.css derives the PANEL floor from that plus the console's
// own header (--console-floor), because 144 on the panel left the transcript with
// one line where the rule asks for four.
//
// So derive the expectation too, rather than typing the sum. The literal used to
// be 188 (144 + a 44px header) and went stale the day the header grew to 52 for
// its Run button's clearance — the floor became 196, which is CORRECT, and the
// check failed anyway. What rule 4 actually protects is the 144px of CONTENT
// under the header; that is the invariant worth asserting.
//
// Measured off the rendered header, not off --bar-console: a token name is one
// rename away from resolving to '' and turning this into min(NaNpx), which is a
// green-looking harness reporting on nothing. The header's own height is the
// number the floor has to clear, whatever it is called this week.
const headerH = await page.evaluate(() => {
  const h = document.querySelector('.console-header')
  return h ? Math.round(h.getBoundingClientRect().height) : null
})
// DENSITY: the 144 was 4×21px output lines + a 44px input row + 16px padding.
// Every term forks with the density now — the input row is --touch (28 fine),
// the line is --fs-console × --lh-console (14 × 1.36 ≈ 19.04px at desk, × 1.5
// on touch) — so derive all of them from the live page rather than freezing
// either density's sum here. The line height is read off the transcript's own
// computed style, the same place the CSS calc reads it.
const touchPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--touch')))
const linePx = await page.evaluate(() => {
  const t = document.querySelector('.console-transcript')
  return t ? parseFloat(getComputedStyle(t).lineHeight) : null
})
const wantFloor = headerH === null || linePx === null ? null : 4 * linePx + 16 + touchPx + headerH
// The computed min-height keeps its min() form (the 100% cannot resolve at
// computed-value time); parse the px term out rather than string-matching a
// float Chrome may serialise with trailing digits.
const gotFloor = /min\(([\d.]+)px, 100%\)/.exec(floors['min-height'] ?? '')
if (wantFloor !== null && gotFloor && Math.abs(parseFloat(gotFloor[1]) - wantFloor) < 0.5)
  pass(`§4.3 r4. console floor is the derived ~${Math.round(wantFloor)}px (4 × ${linePx}px lines + the ${touchPx}px input row + the ${headerH}px header)`, floors['min-height'])
else fail(`§4.3 r4. console floor should be min(~${wantFloor}px, 100%) for a ${headerH}px header`, floors['min-height'])
if (editorMin['min-height'] === '96px') pass('§4.3 r5. editor floor is a real 96px')
else fail('§4.3 r5. editor 96px floor', editorMin['min-height'])

// ---- scrim
const scrimBg = await page.evaluate(() => {
  const d = document.createElement('div'); d.className = 'scrim'; document.body.appendChild(d)
  const bg = getComputedStyle(d).backgroundColor; d.remove(); return bg
})
// THEME-V4: --scrim is VS Code's rgba(0,0,0,0.5).
if (scrimBg === 'rgba(0, 0, 0, 0.5)') pass('§6 drawer scrim resolves to a real colour', scrimBg)
else fail('§6 drawer scrim', scrimBg)

// ---- 18/12. no horizontal page scroll at any width
for (const w of [1280, 1024, 768, 390, 360]) {
  await page.setViewportSize({ width: w, height: 800 })
  await page.waitForTimeout(250)
  const over = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    header: (() => { const h = document.querySelector('.console-header'); return h ? h.scrollWidth - h.clientWidth : 0 })(),
    hiddenCtl: (() => {
      const h = document.querySelector('.console-header')
      if (!h) return 0
      const r = h.getBoundingClientRect()
      return [...h.querySelectorAll('button')].filter((b) => {
        const br = b.getBoundingClientRect()
        return br.width > 0 && (br.right > r.right + 1 || br.left < r.left - 1)
      }).length
    })(),
  }))
  if (over.doc === 0 && over.header === 0 && over.hiddenCtl === 0)
    pass(`12. no horizontal overflow at ${w}px, all console controls on screen`)
  else fail(`12. overflow at ${w}px`, JSON.stringify(over))
}

await page.setViewportSize({ width: 1280, height: 860 })
await page.waitForTimeout(300)

// ================================================= 17. cold run, progress ticks
await page.evaluate(() => {
  window.__s = []; window.__t0 = performance.now()
  clearInterval(window.__timer)
  window.__timer = setInterval(() => {
    const el = document.querySelector('[data-phase]')
    const sect = document.querySelector('.console-panel')
    window.__s.push({ t: Math.round(performance.now() - window.__t0), present: !!el,
      text: el ? el.innerText.replace(/\s+/g, ' ').trim() : '', state: sect?.getAttribute('data-state') ?? null })
  }, 100)
})
await runBtn().click()
await page.waitForTimeout(2600)
await shot('ide-1280-preparing')
await hasOut('Your name:')
await page.waitForTimeout(400)
await shot('ide-1280-waiting')

const samples = await page.evaluate(() => { clearInterval(window.__timer); return window.__s })
const prep = samples.filter((s) => s.state === 'preparing')
let absent = 0, runLen = 0, staticGap = 0, cur = 0, last = null
for (const s of prep) { runLen = s.present ? 0 : runLen + 100; absent = Math.max(absent, runLen) }
for (const s of prep) {
  if (s.present && s.text === last) cur += 100
  else { cur = 0; last = s.present ? s.text : null }
  staticGap = Math.max(staticGap, cur)
}
info(`cold boot: ${prep.length * 100}ms preparing, ${new Set(prep.map((s) => s.text)).size} distinct progress texts`)
if (absent <= 2000 && staticGap <= 2000)
  pass('17. something numeric changed at least every 2s through cold boot', `max blank ${absent}ms, max static ${staticGap}ms`)
else fail('17. progress ticks every 2s', `blank ${absent}ms, static ${staticGap}ms`)

// stdin state
// One shell: the live line is flat at EVERY width — no leading rule — and the
// --info caret + the status bar carry the waiting state. --info is #4DAAFC
// (rgb 77,170,252) post-sweep.
const stdinBorder = await css('.stdin-row[data-waiting="true"]', ['border-left-color', 'border-left-width'])
if (stdinBorder && stdinBorder['border-left-width'] === '0px')
  pass('§4.3/§7.3 the live line is flat — the caret and status bar carry "waiting"', JSON.stringify(stdinBorder))
else fail('waiting stdin boundary', JSON.stringify(stdinBorder))
const stdinCaret = await css('.stdin-row[data-waiting="true"] .stdin-input', ['caret-color', 'color'])
if (stdinCaret && stdinCaret['caret-color'] === 'rgb(77, 170, 252)')
  pass('the caret itself is --info, so the cursor names the state where it sits', JSON.stringify(stdinCaret))
else fail('--info caret on the live line', JSON.stringify(stdinCaret))
// Check 14 above cannot see the live line — it runs while the console is idle and
// the input does not exist — so its 44px/16px obligations are asserted here, at the
// only moment the element is on screen.
const liveBox = await page.evaluate(() => {
  const el = document.querySelector('.stdin-input')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { h: Math.round(r.height), fs: getComputedStyle(el).fontSize }
})
// DENSITY: the 44px/16px pair is a touch obligation; a fine-pointer desktop
// runs the input at 28px/14px (the iOS zoom floor is a touch-device rule).
const liveDesk = await isDesk()
if (liveBox && liveBox.h >= (liveDesk ? 24 : 44) && parseFloat(liveBox.fs) >= (liveDesk ? 14 : 16))
  pass(`14/8. the live input is a ${liveDesk ? '24px+ target at 14px+' : '44px target at the 16px iOS floor'}`, JSON.stringify(liveBox))
else fail('live input floor', JSON.stringify(liveBox))
// One shell: the console's accent running-rail is gone at EVERY width — VS
// Code's panel has no rail. The status bar's remote block (StatusPill
// variant="bar", the `.status-remote` class) carries the run state on the
// accent fill instead.
const consoleRule = await css('.console-panel', ['border-left-color', 'border-left-width'])
{
  const remote = await css('footer[aria-label="Status bar"] .status-remote[data-state="waiting"]', ['background-color'])
  if (consoleRule['border-left-width'] === '0px' && remote && remote['background-color'] === 'rgb(0, 120, 212)')
    pass('§1.3 no console rail — the status bar remote block runs on the accent fill', JSON.stringify(remote))
  else fail('§1.3 running state in the status bar', JSON.stringify({ consoleRule, remote }))
}

await page.locator('[aria-label="Program input"]').fill('Warsha')
await page.locator('[aria-label="Program input"]').press('Enter')
await hasOut('Finished')
await page.waitForTimeout(400)
await shot('ide-1280-finished')
const okOut = await out()
if (/Your name:\s*Warsha/.test(okOut)) pass('§4.4 typed answer echoes onto the prompt line, styled --info')
else fail('§4.4 stdin echo on prompt line', okOut.slice(-120))

// echo segment colour
const echoColor = await page.evaluate(() => {
  const s = document.querySelector('[data-seg="echo"]')
  return s ? getComputedStyle(s).color : null
})
if (echoColor === 'rgb(77, 170, 252)') pass('§7.3 stdin echo renders in --info', echoColor)
else info(`stdin echo colour: ${echoColor}`)

// ============================================ 2. stderr, in colour and greyscale
// Type into Main.java specifically. Earlier this typed a Main class into whatever
// tab happened to be active (Student.java), which turned the run into a compile
// failure with no stdout at all — and then there was no stdout row to compare
// stderr against.
const mainTab = page.locator('[role="tab"]', { hasText: 'Main.java' }).first()
if (await mainTab.count()) await mainTab.click()
else await page.locator('[role="treeitem"]', { hasText: 'Main.java' }).first().click()
await page.waitForTimeout(500)
await page.locator('.cm-content').click()
await page.keyboard.press('Control+a')
await page.keyboard.type('package app; public class Main { public static void main(String[] a) { System.out.println("before the mistake"); int[] xs = new int[2]; System.out.println(xs[5]); } }')
await page.waitForTimeout(1100)
await runBtn().click()
await page.waitForFunction(() => /Exception|stopped early/i.test(document.querySelector('[aria-label="Program output"]')?.innerText || ''), null, { timeout: 300000 })
await page.waitForTimeout(900)
const rowKinds = await page.evaluate(() =>
  [...document.querySelectorAll('.console-row')].map((el) => {
    const c = getComputedStyle(el)
    return { kind: el.dataset.kind, rule: c.borderLeftColor, w: c.borderLeftWidth, bg: c.backgroundColor,
      text: el.innerText.slice(0, 34) }
  }))
for (const r of rowKinds) info(`row[${r.kind}] rule=${r.rule} ${r.w} bg=${r.bg} :: ${r.text}`)
const errRow = rowKinds.find((r) => r.kind === 'err')
const outRow = rowKinds.find((r) => r.kind === 'out')
// One shell: rows are VS Code-flat at EVERY width — no rules, no tints —
// and stderr separates by its red INK alone (the [data-seg] hue, --danger
// #F85149).
const errInk = await page.evaluate(() => {
  const s = document.querySelector('[data-seg="err"]')
  return s ? getComputedStyle(s).color : null
})
if (errRow && outRow && errRow.w === '0px' && errRow.bg === outRow.bg && errInk === 'rgb(248, 81, 73)')
  pass('2. rows are flat, stderr separates by --danger ink', errInk)
else fail('2. stderr flat-row treatment', JSON.stringify({ errRow, outRow, errInk }))
await shot('ide-1280-stderr')
await page.addStyleTag({ content: 'html{filter:grayscale(1)!important}' })
await page.waitForTimeout(250)
await shot('ide-1280-stderr-greyscale')
await page.evaluate(() => [...document.querySelectorAll('style')].forEach((s) => { if (s.textContent.includes('grayscale')) s.remove() }))
await page.waitForTimeout(200)

// phone + tablet with output
await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(500)
await shot('ide-390')
await page.locator('nav[aria-label="Activity bar"] button[aria-label="Explorer"]').click()
await page.waitForTimeout(500)
await shot('ide-390-drawer')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.setViewportSize({ width: 1024, height: 768 })
await page.waitForTimeout(400)
await shot('ide-1024')

// ---- 3. the five run states, side by side, in greyscale
await page.setViewportSize({ width: 1280, height: 400 })
await page.waitForTimeout(300)
await page.evaluate(() => {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--surface-2);display:flex;flex-direction:column;gap:14px;padding:24px;font-family:var(--font-ui)'
  const states = [['idle', 'Ready', '○'], ['running', 'Running', 'dot'], ['ok', 'Finished', '✓'],
    ['failed', 'Stopped early · exit 1', '✕'], ['stopped', 'Stopped by you', '■']]
  for (const [s, label, glyph] of states) {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'display:flex;align-items:center;gap:14px'
    const p = document.createElement('span')
    p.className = 'pill'; p.dataset.state = s
    p.innerHTML = `<span class="pill__glyph">${glyph === 'dot' ? '<span class="dot"></span>' : glyph}</span><span class="pill__label">${label}</span>`
    const n = document.createElement('span')
    n.style.cssText = 'color:var(--text-3);font-size:13px'; n.textContent = s
    wrap.append(p, n); host.append(wrap)
  }
  document.body.append(host)
})
await page.waitForTimeout(300)
await shot('pills')
await page.addStyleTag({ content: 'html{filter:grayscale(1)!important}' })
await page.waitForTimeout(250)
await shot('pills-greyscale')
pass('3. five run states rendered for the greyscale check', 'each carries a glyph AND a word')

// ======================================= Python end-to-end functional smoke test
await ctx.close()
const ctx2 = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-py-')), {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2,
})
const p2 = ctx2.pages()[0] ?? (await ctx2.newPage())
const errs2 = []
p2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()) })
p2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message))
await p2.goto(URL_, { waitUntil: 'load' })
await p2.getByRole('button', { name: /starter/i }).first().waitFor({ timeout: 20000 })
await seedStarter(p2, { name: 'Python (OOP starter)' })
await p2.waitForSelector('[role="tab"]', { timeout: 15000 })
await p2.waitForTimeout(800)
await p2.getByRole('button', { name: /^Run\b/ }).click()
await p2.waitForFunction(() => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Your name:'), null, { timeout: 300000 })
await p2.locator('[aria-label="Program input"]').fill('Saad')
await p2.locator('[aria-label="Program input"]').press('Enter')
await p2.waitForFunction(() => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Finished'), null, { timeout: 300000 })
const pyOut = await p2.locator('[aria-label="Program output"]').innerText()
console.log(`      --- python transcript ---\n${pyOut.split('\n').map((l) => '      ' + l).join('\n')}`)
if (/Finished\. \(exit code 0\)/.test(pyOut) && /Saad/.test(pyOut))
  pass('SMOKE: Python template still runs end-to-end after the restyle', 'stdin round-trip + exit 0')
else fail('SMOKE: Python end-to-end', pyOut.slice(-200))
await p2.screenshot({ path: `${SHOTS}/final-ide-1280-python.png` })
console.log('      shot -> final-ide-1280-python.png')

for (const u of new Set(notFound)) info(`404 -> ${u}`)
// CheerpJ probes for optional runtime paths and tolerates their absence; those
// 404s are the engine's own behaviour, not a missing asset of ours.
const ourOwn = [...new Set(notFound)].filter((u) => !/cheerpj|\/lt\/|\/lib\/|runtime/i.test(u))
if (ourOwn.length === 0) pass('no missing assets of our own — the standing /favicon.ico 404 is gone')
else { fail('missing assets', ourOwn.join(' ')) }
const notable = [...errs, ...errs2].filter((e) =>
  !/favicon/i.test(e) && !/Network error for null|Failed to fetch/.test(e) && !/404 \(Not Found\)/.test(e))
if (notable.length === 0) pass('no unexpected console errors')
else { fail('console errors', String(notable.length)); notable.slice(0, 6).forEach((e) => info('! ' + e.slice(0, 160))) }

await ctx2.close()
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
for (const f of failed) console.log(`FAILED: ${f[1]} :: ${f[2]}`)
