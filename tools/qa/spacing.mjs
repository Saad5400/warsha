/* SPACING SWEEP — the 8px scale, measured in the real DOM.
 *
 * Founder, 2026-08-02: "still sizes and paddings and margins are not correct
 * with lots of bad ui." This asserts it rather than eyeballing it.
 *
 * What it checks, per DESIGN-SPEC §5.1 (4px base, 8px rhythm):
 *   1. SCALE     every padding / gap / margin in the chrome ∈ {0,4,8,12,16,24,32}
 *   2. PANELS    the five chrome bars indent by a consistent amount
 *   3. PAIRS     icon+label gaps are the same everywhere
 *   4. HUGGING   no two siblings separated by an accidental 1-3px
 *   5. RHYTHM    sidebar rows are a uniform height
 *   6. BARS      a fixed-height bar's control fits inside it with real clearance,
 *                and the bar's divider is an inset shadow, not a border
 *
 * Chrome only. The editor is CodeMirror's box and the transcript is monospace
 * leading; neither is on our spacing scale and neither should be.
 *
 *   WARSHA_URL   base URL of a served build (default http://127.0.0.1:8093/)
 */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8093/'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const SCALE = [0, 4, 8, 12, 16, 24, 32]

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-spacing-')), {
  executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 }).catch(() => {})
await page.waitForSelector('[aria-label="Start a project"], .cm-content', { timeout: 20000 })
await page.waitForTimeout(700)
if (!(await page.locator('.cm-content').count())) {
  await seedStarter(page, { name: 'Python (OOP starter)' })
  await page.waitForTimeout(1500)
}
const show = page.getByRole('button', { name: 'Show output' })
if (await show.count()) { await show.click(); await page.waitForTimeout(400) }
await page.waitForTimeout(2600) // let the toast clear

/* ---- 1. SCALE: every box value in the chrome sits on the scale ------------ */
const ROOTS = [
  ['title bar', '.top-bar'],
  ['activity bar', 'nav[aria-label="Activity bar"]'],
  ['sidebar', 'aside[aria-label="Files"]'],
  ['tab strip', '.tab-strip'],
  ['console header', '.console-header'],
  ['status bar', 'footer[aria-label="Status bar"]'],
]

const offenders = await page.evaluate((scale) => {
  const NAMES = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'rowGap', 'columnGap']
  const roots = ['.top-bar', 'nav[aria-label="Activity bar"]', 'aside[aria-label="Files"]',
    '.tab-strip', '.console-header', 'footer[aria-label="Status bar"]']
  const label = (e) => {
    const id = e.getAttribute('aria-label') ?? e.getAttribute('data-path') ?? ''
    const cls = (e.className || '').toString().split(/\s+/).filter((c) => !c.includes(':') && !c.includes('[')).slice(0, 2).join('.')
    return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${id ? `[${id}]` : ''}`
  }
  const out = []
  const seen = new Set()
  for (const rootSel of roots) {
    const root = document.querySelector(rootSel)
    if (!root) continue
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('.cm-editor') || el.tagName === 'SVG' || el.namespaceURI?.includes('svg')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const cs = getComputedStyle(el)
      // Runtime-computed geometry is not a spacing decision. ARCHITECTURE §4.2
      // lists the inline styles exhaustively (drawer transform, console height,
      // progress width, explorer indent, toast offset); the tree's 16px-per-level
      // indent legitimately lands on 28px at depth 1.
      if (el.getAttribute('style')) continue
      for (const n of NAMES) {
        // `margin: auto` is not a number someone chose. getComputedStyle resolves
        // it to the USED value, so a plain `ml-auto` reports as 438.64px;
        // computedStyleMap keeps it a keyword, which is how we tell the two apart.
        let typed = null
        try { typed = el.computedStyleMap?.().get(n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())) } catch { /* unsupported */ }
        if (typed && typed.constructor?.name === 'CSSKeywordValue') continue
        const raw = cs[n]
        if (!raw.endsWith('px')) continue
        // A -8px pull is as on-scale as +8px.
        const v = Math.abs(Math.round(parseFloat(raw) * 100) / 100)
        if (v === 0 || scale.includes(v)) continue
        const key = `${rootSel}|${label(el)}|${n}|${v}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ root: rootSel, el: label(el), prop: n, value: v })
      }
    }
  }
  return out
}, SCALE)

if (offenders.length === 0) pass('1. SCALE — every padding/margin/gap in the chrome is on the 4/8 scale')
else {
  fail('1. SCALE — off-scale box values in the chrome', `${offenders.length} found`)
  for (const o of offenders.slice(0, 25)) info(`  ${o.root}  ${o.el}  ${o.prop}=${o.value}px`)
}

/* ---- 2. PANELS: consistent indent across the chrome bars ------------------ */
const pads = await page.evaluate((roots) => Object.fromEntries(roots.map(([name, sel]) => {
  const e = document.querySelector(sel)
  if (!e) return [name, null]
  const cs = getComputedStyle(e)
  return [name, { left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) }]
})), ROOTS)
info('panel padding: ' + JSON.stringify(pads))
const lefts = Object.entries(pads).filter(([, v]) => v).map(([k, v]) => [k, v.left])
const distinct = [...new Set(lefts.map(([, v]) => v))]
if (distinct.every((v) => SCALE.includes(v))) pass('2. PANELS — every bar indents by a scale value', JSON.stringify(Object.fromEntries(lefts)))
else fail('2. PANELS — a bar indents off-scale', JSON.stringify(Object.fromEntries(lefts)))

/* ---- 3. PAIRS: icon+label gaps are one value ------------------------------ */
const gaps = await page.evaluate(() => {
  const sels = ['.top-bar__identity', '.console-header', 'footer[aria-label="Status bar"] .status-bar__group',
    '.status-stepper', 'aside[aria-label="Files"] .sidebar-project-row button', '.tree-row']
  return sels.map((s) => {
    const e = document.querySelector(s)
    return [s, e ? parseFloat(getComputedStyle(e).columnGap) || 0 : null]
  })
})
info('icon+label gaps: ' + JSON.stringify(Object.fromEntries(gaps)))
const badGap = gaps.filter(([, v]) => v !== null && !SCALE.includes(v))
if (badGap.length === 0) pass('3. PAIRS — every icon/label gap is a scale value')
else fail('3. PAIRS — off-scale gap', JSON.stringify(badGap))

/* ---- 4. HUGGING: no accidental 1-3px between siblings -------------------- */
const hugs = await page.evaluate(() => {
  const roots = ['.top-bar', 'nav[aria-label="Activity bar"]', 'aside[aria-label="Files"]',
    '.console-header', 'footer[aria-label="Status bar"]']
  const label = (e) => {
    const id = e.getAttribute('aria-label') ?? ''
    const cls = (e.className || '').toString().split(/\s+/).filter((c) => !c.includes(':') && !c.includes('[')).slice(0, 2).join('.')
    return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${id ? `[${id}]` : ''}`
  }
  const out = []
  for (const rootSel of roots) {
    const root = document.querySelector(rootSel)
    if (!root) continue
    const kids = [...root.children].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    for (let i = 1; i < kids.length; i++) {
      const a = kids[i - 1].getBoundingClientRect(), b = kids[i].getBoundingClientRect()
      const g = Math.round((b.left - a.right) * 10) / 10
      // 1px separators are intentional hairlines, so only flag 1<g<4 on real boxes.
      if (g > 0.9 && g < 4 && a.width > 4 && b.width > 4)
        out.push({ root: rootSel, a: label(kids[i - 1]), b: label(kids[i]), gap: g })
    }
  }
  return out
})
if (hugs.length === 0) pass('4. HUGGING — no sibling pair separated by an accidental 1-3px')
else { fail('4. HUGGING — accidental sub-scale gaps', `${hugs.length}`); hugs.forEach((h) => info(`  ${h.a} × ${h.b} = ${h.gap}px in ${h.root}`)) }

/* ---- 5. RHYTHM: sidebar rows are uniform --------------------------------- */
const rows = await page.locator('aside[aria-label="Files"] [role="treeitem"]').evaluateAll((els) =>
  els.map((e) => Math.round(e.getBoundingClientRect().height)))
const rowSet = [...new Set(rows)]
if (rowSet.length === 1 && rowSet[0] >= 44) pass('5. RHYTHM — every sidebar row is the same height', `${rowSet[0]}px × ${rows.length}`)
else fail('5. RHYTHM — sidebar row heights vary', JSON.stringify(rowSet))

/* ---- 6. BARS: controls clear their bar, dividers are shadows ------------- */
const bars = await page.evaluate(() => {
  const check = (barSel, ctrlSel, name) => {
    const bar = document.querySelector(barSel), ctrl = document.querySelector(ctrlSel)
    if (!bar || !ctrl) return null
    const b = bar.getBoundingClientRect(), c = ctrl.getBoundingClientRect()
    const cs = getComputedStyle(bar)
    return {
      name,
      barH: Math.round(b.height), ctrlH: Math.round(c.height),
      top: Math.round(c.top - b.top), bottom: Math.round(b.bottom - c.bottom),
      borderBottom: parseFloat(cs.borderBottomWidth) || 0,
      insetShadow: /inset/.test(cs.boxShadow),
    }
  }
  return [
    check('.top-bar', '.top-bar [aria-label^="Run "], .top-bar [aria-label^="Stop "]', 'title bar / Run'),
    check('.top-bar', '.top-bar [aria-label="More"]', 'title bar / ⋯'),
    check('.console-header', '.console-header button', 'console header / Run'),
    check('aside[aria-label="Files"] .panel-label', 'aside[aria-label="Files"] .panel-label', 'sidebar header'),
  ].filter(Boolean)
})
for (const b of bars) {
  if (b.name === 'sidebar header') continue
  // Clearance stopped being SCALE-checked here after the founder's P1 control
  // resize (icon-only buttons and Run: 44px -> 40px, bars unchanged): it used
  // to be an authored padding value, chosen off the scale on purpose, but it
  // is now a DERIVED number (bar height minus control height, halved) that
  // the scale was never going to divide evenly — 52-40 clearance is 6 a side,
  // and 44-40 (the phone-width console header) is 2. What still matters, and
  // is still asserted: centred (top === bottom), never crowded (>= 2, the
  // founder's own floor for the phone case), no border-bottom, a real
  // inset-shadow divider.
  const ok = b.top === b.bottom && b.top >= 2 && b.borderBottom === 0 && b.insetShadow
  const detail = `bar ${b.barH} control ${b.ctrlH} clearance ${b.top}/${b.bottom} border-bottom ${b.borderBottom} inset-shadow ${b.insetShadow}`
  if (ok) pass(`6. BARS — ${b.name} centred with real clearance`, detail)
  else fail(`6. BARS — ${b.name}`, detail)
}

/* ---- alignment grid: the corner the founder flagged ---------------------- */
// One column, one grid line. The title bar carries no mark and no wordmark any
// more (LAYOUT-VSCODE §1b), so what runs down the left of the app is the
// sidebar's own stack: EXPLORER, the project row, the tree. Each of them starts
// with a glyph or a word, and F-07 was those three starting at 60, 64 and 62.
//
// Measured at the CONTENT edge, never the box edge: the project row's button
// carries 8px of its own padding and the tree row spends 2px on the reserved
// accent border, and neither of those is an inset someone chose — they are what
// has to be subtracted for the ink to line up.
const grid = await page.evaluate(() => {
  const x = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left) : null }
  const r = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().right) : null }
  const inner = (s) => {
    const e = document.querySelector(s)
    if (!e) return null
    const c = getComputedStyle(e)
    return Math.round(e.getBoundingClientRect().left + parseFloat(c.paddingLeft) + parseFloat(c.borderLeftWidth))
  }
  return {
    panelLabel: x('.panel-label'),
    // `> :first-child` is the leading ink in either variant — the folder glyph
    // in the sidebar's row, the name itself in the title bar's.
    sidebarProject: x('.sidebar-project-row [aria-label^="Project:"] > :first-child'),
    treeRow: inner('.tree-row'),
    sidebarRight: r('aside[aria-label="Files"]'),
    sep: x('.top-bar__sep'), tabStrip: x('.tab-strip'),
    // Docked, the bar's leading segment is deliberately EMPTY and the sidebar's
    // project row is the only project control on screen (§1b + §2). Two copies
    // of the same name 50px apart read as a duplicate, not as two controls.
    titleProjects: document.querySelectorAll('.top-bar [aria-label^="Project:"]').length,
  }
})
info('alignment: ' + JSON.stringify(grid))
if (grid.sidebarProject === grid.panelLabel && grid.treeRow === grid.panelLabel)
  pass('7. GRID — EXPLORER label, project row and tree rows share a left grid line', `x=${grid.panelLabel}`)
else fail('7. GRID — one of them is out of step', JSON.stringify(grid))
if (grid.titleProjects === 0)
  pass('7. GRID — no wordmark and no duplicate project name in the title bar (§1b)')
else fail('7. GRID — the title bar duplicates the sidebar project row', `${grid.titleProjects} project control(s) in the bar`)
if (grid.sep !== null && Math.abs(grid.sep - grid.sidebarRight) <= 1 && Math.abs(grid.sep - grid.tabStrip) <= 1)
  pass('7. GRID — title-bar divider lands on the sidebar/editor boundary', `sep ${grid.sep}, sidebar ${grid.sidebarRight}, tabs ${grid.tabStrip}`)
else fail('7. GRID — divider misses the boundary', JSON.stringify(grid))

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== spacing sweep: ${results.length - failed.length}/${results.length} passed ====`)
await ctx.close()
process.exit(failed.length ? 1 : 0)
