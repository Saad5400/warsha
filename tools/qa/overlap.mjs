/* Warsha OVERLAP SWEEP — P0.
 *
 * The founder reports overlapping elements. Screenshots are a bad way to find
 * these (a 2px overlap is invisible at a glance and obvious on a real phone), so
 * this measures geometry in the built app instead.
 *
 * Four classes of collision, each a separate check, because generic pairwise
 * overlap detection drowns in false positives from intentional overlays:
 *
 *  1. SPILL      — a child's box extends past a fixed-size parent (a 48px button
 *                  in a 44px bar). This is the "overlapping elements" the founder
 *                  most likely saw.
 *  2. SIBLING    — two in-flow elements sharing a stacking root overlap each
 *                  other. Overlays (dialog/menu/toast/scrim) live in their own
 *                  stacking root and are excluded automatically, so what's left
 *                  is real layout breakage.
 *  3. CLIP       — an element is cut off by a non-scrollable `overflow: hidden`
 *                  ancestor, i.e. content is silently invisible.
 *  4. INVARIANT  — named pairs from the brief's (a)-(g) list that must never
 *                  overlap whatever else is true: the console header vs the
 *                  drag handle, tabs vs top bar, and everything vs the
 *                  keyboard inset.
 *
 * Usage: node overlap.mjs
 */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://localhost:8087/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const findings = []
let checks = 0

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-ovl-')), {
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

/* ---------------------------------------------------------------- probe ---- */
/** Injected once per scenario. Returns every collision it can see. */
const PROBE = () => {
  const R = (el) => el.getBoundingClientRect()
  const vis = (el) => {
    const c = getComputedStyle(el)
    if (c.display === 'none' || c.visibility === 'hidden' || parseFloat(c.opacity) === 0) return false
    const r = R(el)
    return r.width > 0.5 && r.height > 0.5
  }
  const name = (el) => {
    const id = el.id ? '#' + el.id : ''
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    const role = el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''
    const al = el.getAttribute('aria-label') ? `[${el.getAttribute('aria-label')}]` : ''
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 22)
    return `${el.tagName.toLowerCase()}${id}${cls}${role}${al}${txt ? ` "${txt}"` : ''}`
  }
  /** Elements that put their own ink on screen. */
  const isAtom = (el) => {
    if (!vis(el)) return false
    const t = el.tagName
    if (t === 'BUTTON' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || t === 'SVG' || t === 'svg') return true
    if (el.getAttribute('role') === 'treeitem' || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'menuitem') return true
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
  }
  /** Nearest ancestor establishing a positioning/stacking context. */
  const root = (el) => {
    let p = el.parentElement
    while (p) {
      const c = getComputedStyle(p)
      if (c.position !== 'static' || c.zIndex !== 'auto' || c.transform !== 'none') return p
      p = p.parentElement
    }
    return document.body
  }
  const hit = (a, b, tol = 1) =>
    a.left < b.right - tol && b.left < a.right - tol && a.top < b.bottom - tol && b.top < a.bottom - tol
  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height)

  const out = { spill: [], sibling: [], clip: [], wide: [] }
  const all = [...document.querySelectorAll('body *')].filter((el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE')

  /* 1. SPILL — a child overflows a parent that has a fixed height and is not
        a scroll container. */
  for (const el of all) {
    if (!vis(el)) continue
    const c = getComputedStyle(el)
    const fixedH = c.height !== 'auto' && c.flexShrink !== undefined
    if (!fixedH) continue
    if (/auto|scroll/.test(c.overflowY) || /auto|scroll/.test(c.overflowX)) continue
    if (c.overflow === 'hidden' || c.overflowY === 'hidden') continue // clipped, not spilling
    const pr = R(el)
    if (pr.height < 8) continue
    for (const kid of el.children) {
      if (!vis(kid)) continue
      const kc = getComputedStyle(kid)
      if (kc.position === 'absolute' || kc.position === 'fixed') continue
      const kr = R(kid)
      const dTop = pr.top - kr.top
      const dBot = kr.bottom - pr.bottom
      if (dTop > 1.5 || dBot > 1.5) {
        out.spill.push({ parent: name(el), child: name(kid), top: Math.round(dTop * 10) / 10, bottom: Math.round(dBot * 10) / 10,
          parentH: Math.round(pr.height), childH: Math.round(kr.height) })
      }
    }
  }

  /* 2. SIBLING — in-flow atoms in the same stacking root overlapping. */
  const atoms = all.filter(isAtom).map((el) => ({ el, r: R(el), root: root(el), c: getComputedStyle(el) }))
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const A = atoms[i], B = atoms[j]
      if (A.root !== B.root) continue
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue
      // Deliberate stacking: either is out of flow relative to the shared root.
      if (A.c.position === 'absolute' || A.c.position === 'fixed') continue
      if (B.c.position === 'absolute' || B.c.position === 'fixed') continue
      // Inline spans lie: a wrapped span's getBoundingClientRect() unions all its
      // line boxes, making different visual lines look like overlaps. Real collisions are block-level only.
      if (A.c.display === 'inline' || B.c.display === 'inline') continue
      if (!hit(A.r, B.r, 1.5)) continue
      const ov = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left)
      const oh = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top)
      out.sibling.push({ a: name(A.el), b: name(B.el), w: Math.round(ov), h: Math.round(oh),
        frac: Math.round((100 * (ov * oh)) / Math.max(1, Math.min(area(A.r), area(B.r)))) })
    }
  }

  /* 3. CLIP — cut off by overflow:hidden with no scroller in between. Closed
        drawers and scroll containers are excluded; both are legitimate clipping. */
  for (const { el, r } of atoms) {
    if (el.closest('[data-state="closed"]')) continue
    let p = el.parentElement
    while (p && p !== document.body) {
      const c = getComputedStyle(p)
      if (/auto|scroll/.test(c.overflowY) || /auto|scroll/.test(c.overflowX)) break
      const hiddenX = c.overflowX === 'hidden', hiddenY = c.overflowY === 'hidden'
      if (hiddenX || hiddenY) {
        const pr = R(p)
        const cutR = hiddenX ? r.right - pr.right : 0
        const cutB = hiddenY ? r.bottom - pr.bottom : 0
        const cutL = hiddenX ? pr.left - r.left : 0
        const cutT = hiddenY ? pr.top - r.top : 0
        const worst = Math.max(cutR, cutB, cutL, cutT)
        if (worst > 2) {
          out.clip.push({ el: name(el), by: name(p), cut: Math.round(worst),
            side: cutR === worst ? 'right' : cutB === worst ? 'bottom' : cutL === worst ? 'left' : 'top' })
        }
        break
      }
      p = p.parentElement
    }
  }

  /* 4. Wider than the viewport — excluding closed off-canvas drawers and
        horizontal scroll containers (the tab strip scrolls on purpose). */
  const offCanvas = (el) => !!el.closest('[data-state="closed"]')
  const inHScroller = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true
      p = p.parentElement
    }
    return false
  }
  const vw = document.documentElement.clientWidth
  for (const { el, r } of atoms) {
    if (r.right <= vw + 1 && r.left >= -1) continue
    if (offCanvas(el) || inHScroller(el)) continue
    out.wide.push({ el: name(el), left: Math.round(r.left), right: Math.round(r.right), vw })
  }

  /* named invariants */
  const q = (s) => document.querySelector(s)
  const box = (s) => { const e = q(s); return e && vis(e) ? R(e) : null }
  const inv = {
    // .stdin-input exists only while blocked on read (usually null here,
    // correctly). Console foot is gone — the status bar is now the console's bottom edge.
    stdin: box('.stdin-input'),
    transcript: box('.console-transcript'),
    header: box('.console-header'),
    headerBtn: (() => { const b = document.querySelector('.console-header button'); return b && vis(b) ? R(b) : null })(),
    statusBar: box('footer[aria-label="Status bar"]'),
    divider: box('[role="separator"]'),
    tabStrip: box('.tab-strip'),
    topBar: box('.top-bar'),
    editorPane: box('.editor-pane'),
    drawer: box('aside[data-state="open"]'),
    progress: box('.progress-block'),
    banner: box('[role="status"]'),
    kbInset: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kb-inset')) || 0,
    innerH: window.innerHeight,
    docScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
  return { out, inv }
}

/* -------------------------------------------------------------- driver ---- */
function report(scenario, { out, inv }) {
  const add = (kind, msg) => findings.push({ scenario, kind, msg })
  checks++

  for (const s of out.spill) add('SPILL', `${s.child} overflows ${s.parent} by ${Math.max(s.top, s.bottom)}px (child ${s.childH}px in ${s.parentH}px)`)
  // Only report substantial sibling overlaps; sub-pixel text-box kissing is noise.
  for (const s of out.sibling) if (s.w > 2 && s.h > 2 && s.frac > 4) add('SIBLING', `${s.a}  ×  ${s.b}  (${s.w}×${s.h}px, ${s.frac}% of the smaller)`)
  for (const c of out.clip) add('CLIP', `${c.el} cut off ${c.cut}px at the ${c.side} by ${c.by}`)
  for (const w of out.wide) add('WIDE', `${w.el} extends to ${w.right}px past a ${w.vw}px viewport`)
  if (inv.docScrollX > 0) add('WIDE', `document scrolls horizontally by ${inv.docScrollX}px`)

  const gap = (a, b) => Math.round(b - a)
  // Input now lives inside the transcript, and the old status line is gone
  // (status bar carries run state); what must not overlap is transcript vs. status bar.
  if (inv.transcript && inv.statusBar && inv.transcript.bottom > inv.statusBar.top + 1)
    add('INVARIANT-a', `transcript bottom (${Math.round(inv.transcript.bottom)}) is below the status bar's top (${Math.round(inv.statusBar.top)}) — output can run under the run state`)
  if (inv.divider && inv.headerBtn && inv.divider.bottom > inv.headerBtn.top + 1)
    add('INVARIANT-b', `drag handle bottom (${Math.round(inv.divider.bottom)}) overlaps a console-header control's top (${Math.round(inv.headerBtn.top)}) by ${gap(inv.headerBtn.top, inv.divider.bottom)}px`)
  if (inv.tabStrip && inv.topBar && inv.tabStrip.top < inv.topBar.bottom - 1)
    add('INVARIANT-c', `tab strip top (${Math.round(inv.tabStrip.top)}) is above top bar bottom (${Math.round(inv.topBar.bottom)})`)
  if (inv.drawer && inv.editorPane && inv.drawer.right > inv.editorPane.left + 1)
    findings.push({ scenario, kind: 'INFO-d', msg: `drawer overlays editor by ${gap(inv.editorPane.left, inv.drawer.right)}px (expected below 900px: it is an overlay drawer)` })
  if (inv.kbInset > 100) {
    const kbTop = inv.innerH - inv.kbInset
    for (const [label, r] of [['stdin input', inv.stdin], ['console header control', inv.headerBtn], ['transcript', inv.transcript]])
      if (r && r.bottom > kbTop + 1) add('INVARIANT-f', `${label} bottom (${Math.round(r.bottom)}) is under the keyboard (top ${Math.round(kbTop)})`)
  }
  return findings.filter((f) => f.scenario === scenario)
}

async function scenario(label, setup) {
  await setup()
  await page.waitForTimeout(450)
  const data = await page.evaluate(PROBE)
  const got = report(label, data)
  const bad = got.filter((f) => !f.kind.startsWith('INFO'))
  console.log(`\n### ${label}`)
  if (bad.length === 0) console.log('    clean')
  for (const f of got) console.log(`    ${f.kind.padEnd(12)} ${f.msg}`)
  return got
}

/* Seed a real project + open the console, then walk the widths. */
async function seed() {
  await page.goto(URL_, { waitUntil: 'load' })
  await page.getByRole('button', { name: /New from a starter/ }).waitFor({ timeout: 20000 })
  await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
  await page.waitForSelector('[role="tab"]', { timeout: 15000 })
  await page.waitForTimeout(700)
  const show = page.getByRole('button', { name: 'Show output' })
  if (await show.count()) { await show.click(); await page.waitForTimeout(400) }
  // Open several tabs so the strip has to scroll, and a long name to test ellipsis.
  for (const f of ['Person.java', 'Student.java']) {
    const r = page.locator('[role="treeitem"]', { hasText: f }).first()
    if (await r.count()) { await r.click(); await page.waitForTimeout(200) }
  }
}
await seed()

const widths = [1280, 1024, 768, 430, 390]
for (const w of widths) {
  await scenario(`${w}px · default console`, async () => {
    await page.setViewportSize({ width: w, height: w === 1024 ? 768 : 860 })
  })
}

/* Console dragged to min/max via localStorage — the same seam the drag writes, and it survives reload. */
for (const [label, h] of [['min', 100], ['max', 4000]]) {
  await scenario(`1280px · console dragged to ${label}`, async () => {
    await page.setViewportSize({ width: 1280, height: 860 })
    await page.evaluate((px) => {
      const k = 'warsha.prefs.v1'
      const p = JSON.parse(localStorage.getItem(k) || '{}')
      localStorage.setItem(k, JSON.stringify({ ...p, consoleHeight: px, consoleCollapsed: false }))
    }, h)
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('.console-header, section[aria-label="Console"] > div:first-of-type', { timeout: 15000 })
    await page.waitForTimeout(600)
  })
}
// Actually drag the handle too, so we test the live path and not just the pref.
await scenario('1280px · handle dragged up hard (live drag)', async () => {
  const sep = page.locator('[role="separator"]').first()
  if (await sep.count()) {
    const b = await sep.boundingBox()
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, 60, { steps: 12 })
      await page.mouse.up()
    }
  }
})
await scenario('1280px · handle dragged down hard (live drag)', async () => {
  const sep = page.locator('[role="separator"]').first()
  if (await sep.count()) {
    const b = await sep.boundingBox()
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, 830, { steps: 12 })
      await page.mouse.up()
    }
  }
})

/* Collapsed console */
await scenario('390px · console collapsed', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  const hide = page.getByRole('button', { name: 'Hide output' })
  if (await hide.count()) await hide.click()
})
await scenario('390px · console open again', async () => {
  const show = page.getByRole('button', { name: 'Show output' })
  if (await show.count()) await show.click()
})

/* Simulates the keyboard at its real source (visualViewport.height), not by
   writing --kb-inset/--app-h directly — ui/viewport.ts's sync() would undo that,
   and the old approach caused false INVARIANT-f hits. */
const KB_PX = 336
const raiseKeyboard = () => page.evaluate((KB) => {
  const vv = window.visualViewport
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - KB })
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
  vv.dispatchEvent(new Event('resize'))
}, KB_PX)
const lowerKeyboard = () => page.evaluate(() => {
  delete window.visualViewport.height
  delete window.visualViewport.offsetTop
  window.visualViewport.dispatchEvent(new Event('resize'))
})

/* Keyboard open, both phone widths — the highest-risk state. */
for (const w of [430, 390]) {
  await scenario(`${w}px · keyboard open (visualViewport, ${KB_PX}px inset)`, async () => {
    await page.setViewportSize({ width: w, height: 844 })
    await raiseKeyboard()
    await page.waitForTimeout(400)
  })
}
await lowerKeyboard()

/* Explorer toggle: docked pane ≥900px, overlay drawer below. It TOGGLES — only open it when closed. */
const ensureExplorerOpen = async () => {
  if (await page.locator('aside[aria-label="Files"][data-state="open"]').count()) return
  await page.locator('nav[aria-label="Activity bar"] button[aria-label="Explorer"]').click()
  await page.waitForTimeout(450)
}

/* Long file name — ellipsis, not spill (brief item g). */
await scenario('390px · very long file name', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  // Below 900px the explorer is an off-canvas drawer, so its rows are not
  // clickable until it is open.
  await ensureExplorerOpen()
  const menu = page.locator('[role="treeitem"]', { hasText: 'Person.java' }).first()
  if (await menu.count()) {
    await menu.click({ button: 'right' })
    await page.waitForTimeout(350)
    const ren = page.getByRole('menuitem', { name: /Rename/ })
    if (await ren.count()) {
      await ren.click()
      await page.waitForTimeout(350)
      const field = page.locator('input:visible').first()
      if (await field.count()) {
        await field.fill('StudentEnrollmentControllerFactoryDelegate.java')
        await field.press('Enter')
        await page.waitForTimeout(700)
      }
    }
  }
})
await page.screenshot({ path: `${SHOTS}/ovl-390-longname.png` })

/* Mid-width drawer, around the 900px breakpoint (brief item d). */
for (const w of [880, 899, 900, 920]) {
  await scenario(`${w}px · explorer open across the 900px breakpoint`, async () => {
    await page.setViewportSize({ width: w, height: 800 })
    await page.waitForTimeout(250)
    await ensureExplorerOpen()
  })
  await page.keyboard.press('Escape').catch(() => {})
}

/* Progress block live, over real console content (brief item e). */
await scenario('1280px · progress block during real cold boot', async () => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await page.waitForTimeout(300)
  // Run's label includes the filename ("Run Main.java") — hence the prefix match.
  const run = page.getByRole('button', { name: /^Run\b/ })
  // Must check isEnabled(), not just present — clicking a disabled Run hangs the whole sweep for 30s instead of failing cleanly.
  if ((await run.count()) && (await run.isEnabled())) {
    await run.click()
    await page.waitForTimeout(2500)
  } else {
    const paths = await page.evaluate(() =>
      [...document.querySelectorAll('[role="treeitem"]')].map((e) => e.getAttribute('data-path')))
    console.log(`    SKIPPED  Run is disabled — no entry candidate. tree: ${JSON.stringify(paths)}`)
  }
})
await page.screenshot({ path: `${SHOTS}/ovl-1280-progress.png` })

/* Ctrl+S is now a silent save (dirty-dot only, no toast) — this checks the
 * keystroke disturbs nothing, not that a toast clears. */
await scenario('390px · keyboard open + Ctrl+S (silent save)', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await raiseKeyboard()
  await page.waitForTimeout(400)
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(500)
})
await page.screenshot({ path: `${SHOTS}/ovl-390-toast-kb.png` })

/* ------------------------------------------------------------- summary ---- */
const real = findings.filter((f) => !f.kind.startsWith('INFO'))
const byKind = {}
for (const f of real) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
console.log(`\n\n======== OVERLAP SWEEP: ${checks} scenarios, ${real.length} findings ========`)
console.log(Object.keys(byKind).length ? JSON.stringify(byKind, null, 0) : 'NO COLLISIONS FOUND')
const seen = new Set()
for (const f of real) {
  const key = f.kind + '|' + f.msg.replace(/\d+/g, 'N')
  if (seen.has(key)) continue
  seen.add(key)
  console.log(`  [${f.kind}] ${f.msg}\n      first seen: ${f.scenario}`)
}
await ctx.close()
