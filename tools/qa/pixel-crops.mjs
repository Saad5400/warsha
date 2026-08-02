/* Loupe-level crop harness: tight, high-DPI screenshots of every small region of
 * the UI, plus the geometry that produced them.
 *
 * The verify suites in this directory answer "is the app there and does it work".
 * They cannot answer "is the Run button 2px taller than the bar it sits in",
 * because at 1x, full-page, that defect is one grey pixel. This script is the
 * other half: it drives a SERVED BUILD to a realistic state, then captures each
 * region on its own at deviceScaleFactor 3 with a few px of padding, so the
 * junction between a control and its container is visible.
 *
 * It is not pass/fail. It produces evidence a reviewer looks at, and a
 * measurements.json holding the getBoundingClientRect and computed styles behind
 * every crop — so a finding is stated as a number rather than an impression, and
 * re-checked by diffing the file after the fix.
 *
 *   cd app && npm run build && npx vite preview --port 8099 --strictPort --host
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8099/ node pixel-crops.mjs
 *
 * TWO RULES THIS FILE LIVES BY
 *
 * 1. Padding is the point. A crop clipped exactly to an element's border box can
 *    never show that the element overflows its parent — the overflow is outside
 *    the clip. Every crop is expanded by PAD on all four sides.
 *
 * 2. Selectors are semantic first (role, aria-label, data-*), class second, and
 *    the class is only ever a fallback in a selector list. Presentational classes
 *    are migrating to Tailwind utilities file by file; a harness keyed to
 *    `.tab-strip` silently stops capturing the tab strip the day that class goes
 *    away, which is precisely the day you most want the crop. `[role="tablist"]`
 *    is a contract with assistive technology and does not move.
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* Overridable so this runs anywhere — the three conventions the verify suites
 * share (tools/qa/README.md), plus three this script adds.
 *
 *   WARSHA_URL     base URL of a SERVED BUILD   (default http://127.0.0.1:8086/)
 *   WARSHA_CROPS   where crops land             (default tools/qa/crops/)
 *   CHROME         Chrome binary                (default /usr/bin/google-chrome)
 *   WARSHA_DSF     deviceScaleFactor            (default 3)
 *   WARSHA_PAD     px of context around a crop  (default 10)
 *   WARSHA_ONLY    regex; capture matching crop names only (default: all)
 *
 * 127.0.0.1 rather than localhost deliberately — see README.md. */
const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const CROPS = process.env.WARSHA_CROPS ?? fileURLToPath(new URL('./crops', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const DSF = Number(process.env.WARSHA_DSF ?? 3)
const PAD = Number(process.env.WARSHA_PAD ?? 10)
const ONLY = process.env.WARSHA_ONLY ? new RegExp(process.env.WARSHA_ONLY) : null

/* Semantic first, class as fallback. See rule 2 above. */
const S = {
  /* The bar holds no mark and no wordmark any more (LAYOUT-VSCODE §1b), so the
     fallback is keyed to the one control that is in it at every width. */
  topbar: '.top-bar, header:has([aria-label="More"])',
  identity: '.top-bar__identity',
  sep: '.top-bar__sep',
  project: '[aria-label^="Project:"]',
  topRun: '.top-bar [aria-label^="Run "], .top-bar [aria-label^="Stop "]',
  more: '[aria-label="More"]',
  hamburger: '[aria-label="Files"]',

  activitybar: 'nav[aria-label="Activity bar"]',
  actExplorer: 'nav[aria-label="Activity bar"] [aria-label="Explorer"]',
  actSearch: 'nav[aria-label="Activity bar"] [aria-label^="Search"]',
  actSettings: 'nav[aria-label="Activity bar"] [aria-label^="Settings"]',

  panelLabel: '.panel-label',
  projectRow: '.sidebar-project-row',
  tree: '[role="tree"]',
  row: '[role="treeitem"]',
  rowMore: '[role="treeitem"] [aria-label*="ore"], .tree-row__more',
  guide: '.tree-row__guide',

  tablist: '[role="tablist"]',
  tab: '[role="tab"]',
  tabActive: '[role="tab"][data-state="active"]',
  tabInactive: '[role="tab"][data-state="inactive"]',
  tabClose: '[role="tab"][data-state="active"] button',
  tabBadge: '[role="tab"][data-state="active"] > span[aria-hidden="true"]',

  editorPane: '.editor-pane, .cm-editor',
  gutters: '.cm-gutters',
  gutterActive: '.cm-activeLineGutter',
  content: '.cm-content',

  /* The console header has no class of its own any more; the Run/Stop button
     inside it is `aria-label="Run"`/`"Stop"` exactly (the title-bar copy is
     "Run main.py"), so its parent IS the header. */
  consoleRun: '[aria-label="Run"], [aria-label="Stop"]',
  divider: '[aria-label="Resize output"]',
  transcript: '[aria-label="Program output"]',
  rowOut: '[data-kind="out"]',
  rowErr: '[data-kind="err"]',
  consoleStatus: '[role="status"][data-state]',
  consoleFoot: '.console-foot',
  stdinRow: '.stdin-row',
  stdinInput: '[aria-label="Program input"]',
  scrollPill: '.scroll-pill',
  progress: '[data-phase]',
  progressTrack: '.progress-track',

  statusbar: 'footer[aria-label="Status bar"]',
  statusGroup: '.status-bar__group',
  statusGroupEnd: '.status-bar__group--end',
  statusSep: '.status-sep',
  statusStepper: '.status-stepper',

  menu: '[role="menu"]',
  menuitem: '[role="menuitem"]',
  dialog: '[role="dialog"]',
  toast: '.toast',
  /* The welcome panel's brand block — the mark above the Latin wordmark. It is
     the ONLY place in the app the wordmark appears (LAYOUT-VSCODE §1b). The
     Arabic line that used to sit under it is gone: Warsha ships English-only,
     so there is no `[lang="ar"]` in the DOM to anchor a crop to. */
  lockup: '.lockup',
}

mkdirSync(CROPS, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'warsha-pixel-'))

const log = (m) => console.log(m)
const step = (m) => console.log(`\n=== ${m}`)

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: DSF,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

/* Every crop's geometry, keyed by crop name, written out at the end. */
const measurements = {}
const misses = []
let captured = 0
let skipped = 0

/* Read an element's box and the computed properties that decide geometry. Runs
 * in the page so it sees the real cascade rather than our guess at it. */
const PROBE = `(el) => {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const pr = el.parentElement?.getBoundingClientRect() ?? null
  const b = (q) => q && { x: +q.x.toFixed(2), y: +q.y.toFixed(2), w: +q.width.toFixed(2), h: +q.height.toFixed(2), top: +q.top.toFixed(2), right: +q.right.toFixed(2), bottom: +q.bottom.toFixed(2), left: +q.left.toFixed(2) }
  return {
    tag: el.tagName.toLowerCase(),
    cls: el.getAttribute('class') ?? '',
    rect: b(r),
    parent: { tag: el.parentElement?.tagName.toLowerCase() ?? null, cls: el.parentElement?.getAttribute('class') ?? '', rect: b(pr) },
    /* Positive on a side = the child sticks out past its parent there. The
       founder's Run-button defect is this number being > 0 on 'bottom'. */
    overflow: pr && {
      top: +(pr.top - r.top).toFixed(2),
      bottom: +(r.bottom - pr.bottom).toFixed(2),
      left: +(pr.left - r.left).toFixed(2),
      right: +(r.right - pr.right).toFixed(2),
    },
    style: {
      display: cs.display, position: cs.position, boxSizing: cs.boxSizing,
      width: cs.width, height: cs.height, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
      padding: cs.padding, margin: cs.margin, gap: cs.gap,
      border: cs.borderWidth + ' ' + cs.borderStyle + ' ' + cs.borderColor,
      borderRadius: cs.borderRadius, outline: cs.outline, overflow: cs.overflow,
      boxShadow: cs.boxShadow,
      font: cs.fontSize + '/' + cs.lineHeight + ' ' + cs.fontWeight,
      alignItems: cs.alignItems, justifyContent: cs.justifyContent,
      background: cs.backgroundColor, color: cs.color, transform: cs.transform,
    },
  }
}`

/* A selector that matches nothing is a logged miss, never a 30s hang. A harness
 * that aborts two thirds of the way through has captured nothing useful. */
async function box(sel, nth = 0) {
  if (typeof sel === 'function') return await sel()
  const loc = page.locator(sel).nth(nth)
  if ((await loc.count()) === 0) return null
  return await loc.boundingBox().catch(() => null)
}

/* Capture ONE region, padded, and record its geometry.
 *   sel   CSS selector (+ `nth`), or
 *   clip  an explicit {x,y,width,height} in CSS px, or
 *   rect  an async fn returning one (junctions, slices, hand-built regions).
 *   probe selector to measure, when it differs from what is being clipped. */
async function shot(name, opts = {}) {
  const { sel, nth = 0, clip, rect, pad = PAD, note = '', probe, optional = false } = opts
  if (ONLY && !ONLY.test(name)) { skipped++; return null }

  let target = clip ?? null
  if (!target && rect) target = await rect()
  if (!target && sel) target = await box(sel, nth)
  if (!target) {
    /* `optional` is for regions the layout deliberately does not render at this
       width — the status bar and the resize handle are ≥900px only. Logging them
       as misses would train the reader to ignore the miss list. */
    if (!optional) misses.push(name)
    log(`  ${optional ? 'n/a ' : 'MISS'} ${name} :: ${sel ?? 'computed rect'}`)
    return null
  }

  const vp = page.viewportSize()
  const x = Math.max(0, Math.round(target.x - pad))
  const y = Math.max(0, Math.round(target.y - pad))
  const width = Math.min(vp.width - x, Math.round(target.width + pad * 2))
  const height = Math.min(vp.height - y, Math.round(target.height + pad * 2))
  if (width <= 0 || height <= 0) { misses.push(name); log(`  MISS ${name} :: clip off-screen`); return null }

  await page.screenshot({ path: join(CROPS, `${name}.png`), clip: { x, y, width, height } })
  captured++

  const p = typeof probe === 'string' ? { sel: probe } : probe
  const probeSel = p?.sel ?? sel
  let geometry = null
  if (probeSel) {
    const loc = page.locator(probeSel).nth(p?.nth ?? (probe ? 0 : nth))
    if (await loc.count()) {
      geometry = await loc
        .evaluate((el, args) => {
          let t = el
          for (let i = 0; i < args.up; i++) t = t.parentElement ?? t
          return new Function('return ' + args.fn)()(t)
        }, { up: p?.up ?? 0, fn: PROBE })
        .catch(() => null)
    }
  }
  measurements[name] = { note, clip: { x, y, width, height }, geometry }
  log(`  ${name}.png${note ? '  — ' + note : ''}`)
}

/* The seam between two elements — where double borders, 1px gaps and overlaps
 * live. Union of both boxes. */
function junction(aSel, bSel, { aNth = 0, bNth = 0 } = {}) {
  return async () => {
    const a = await box(aSel, aNth)
    const b = await box(bSel, bNth)
    if (!a || !b) return null
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
  }
}

/* One end of a wide element. A 1280px title bar shot whole shows nothing; its
 * left 380px shows the logo lockup at a size you can judge. */
function slice(sel, side, extent, { nth = 0 } = {}) {
  return async () => {
    const b = await box(sel, nth)
    if (!b) return null
    if (side === 'left') return { ...b, width: Math.min(extent, b.width) }
    if (side === 'right') return { ...b, x: b.x + Math.max(0, b.width - extent), width: Math.min(extent, b.width) }
    if (side === 'top') return { ...b, height: Math.min(extent, b.height) }
    return { ...b, y: b.y + Math.max(0, b.height - extent), height: Math.min(extent, b.height) }
  }
}

/* The box of an ANCESTOR of a matched element.
 *
 * The escape hatch for containers that have no selector of their own. The
 * console header and the progress track are plain layout <div>s whose classes
 * are moving to utilities, but each reliably CONTAINS something semantic — the
 * Run button, the fill.
 * Walking up from the thing that has a contract is stabler than guessing at the
 * wrapper's current class. */
function parentRect(sel, up = 1, { nth = 0 } = {}) {
  return async () => {
    const loc = page.locator(sel).nth(nth)
    if ((await loc.count()) === 0) return null
    return await loc.evaluate((el, n) => {
      let e = el
      for (let i = 0; i < n; i++) e = e.parentElement ?? e
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }, up).catch(() => null)
  }
}

/* A fixed-size window anchored on an element — for corners and for regions with
 * no single element behind them. */
function around(sel, dx, dy, w, h, { nth = 0 } = {}) {
  return async () => {
    const b = await box(sel, nth)
    return b && { x: b.x + dx, y: b.y + dy, width: w, height: h }
  }
}

/* The console header, resolved through the one thing in it with a contract. */
const HEADER = parentRect(S.consoleRun, 1)

const hasOut = (t, timeout = 180000) =>
  page.waitForFunction(
    (s) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(s),
    t, { timeout },
  )

/* Replace the open file's source.
 *
 * keyboard.type() is wrong for anything with brackets in it: CodeMirror's
 * close-brackets extension answers each typed "(" with "()" and each quote with
 * a pair, and whether the following typed ")" is swallowed as an overtype or
 * inserted as a second one depends on timing. A run of this script died on
 * exactly that — the program raised a SyntaxError and every console crop after
 * it was of a failure state. insertText delivers the whole string as one input
 * event, which close-brackets treats as a paste and leaves alone.
 *
 * Verified rather than assumed: the console crops are only meaningful if the
 * source that produced them is the source we meant. */
async function setSource(text) {
  await page.locator(S.content).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText(text)
  await page.waitForTimeout(700) // let the 350ms debounce flush to OPFS
  const got = (await page.locator(S.content).innerText()).replace(/\s+/g, ' ').trim()
  const want = text.replace(/\s+/g, ' ').trim()
  if (got !== want) {
    log(`  ! editor content differs from what was requested`)
    log(`    want: ${want.slice(0, 120)}`)
    log(`    got : ${got.slice(0, 120)}`)
    return false
  }
  return true
}

/* Wait for a marker in the transcript; on timeout print what the console
 * actually says and carry on. A bare 180s TimeoutError kills the run and takes
 * the ninety crops that had nothing to do with the program with it. */
async function waitOut(marker, timeout = 180000) {
  try {
    await hasOut(marker, timeout)
    return true
  } catch {
    const text = await page.locator(S.transcript).innerText().catch(() => '(no transcript)')
    log(`  ! never saw ${JSON.stringify(marker)} in the transcript; it holds:`)
    for (const line of text.split('\n').slice(-8)) log(`      ${line}`)
    return false
  }
}

/* ------------------------------------------------------------------ 0. state
 * Crops of an empty app are crops of a screen no student ever sits in front of.
 * Everything below is shot against a real project: three open files (one nested,
 * one named long enough to ellipsize), a completed run whose transcript holds
 * stdout, stderr, a prompt and an echoed answer, and finally a Stop. */
step('boot + cross-origin isolation')
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
log('  crossOriginIsolated')

step('welcome / empty state (before any project exists)')
await page.waitForTimeout(500)
await shot('1280-welcome-full', { clip: { x: 0, y: 0, width: 1280, height: 900 }, pad: 0, note: 'start screen, whole viewport' })
await shot('1280-welcome-lockup', { sel: S.lockup, pad: 16, note: 'logo lockup: mark over wordmark — the only place the brand appears in the app' })
await shot('1280-welcome-card', { sel: 'button:has-text("Python starter")', pad: 12, note: 'starter card: badge, title, blurb insets' })
await shot('1280-welcome-cards-gap', { rect: junction('button:has-text("Python starter")', 'button:has-text("Java")'), pad: 12, note: 'the two cards side by side: equal boxes?' })

step('create the Python starter project')
await page.getByRole('button', { name: /Python starter/ }).click()
await page.waitForSelector(S.tab, { timeout: 15000 })
await page.waitForTimeout(600)

step('open the nested file (helpers/shapes.py)')
/* Click the folder only if its child is not already on screen — otherwise we
 * toggle it shut and the nested-row crops vanish. */
if ((await page.locator('[data-path="helpers/shapes.py"]').count()) === 0) {
  await page.locator('[data-path="helpers"]').click()
  await page.waitForSelector('[data-path="helpers/shapes.py"]', { timeout: 10000 })
}
await page.locator('[data-path="helpers/shapes.py"]').click()
await page.waitForTimeout(400)

step('create a long-named third file (the ellipsis case)')
await page.getByRole('button', { name: 'New file' }).first().click()
await page.waitForTimeout(250)
await page.getByRole('textbox', { name: 'New file name' }).fill('geometry_calculations_helper.py')
await page.getByRole('textbox', { name: 'New file name' }).press('Enter')
await page.waitForTimeout(700)

step('make main.py produce stdout + stderr + a prompt, then run it')
await page.locator('[data-path="main.py"]').click()
await page.waitForTimeout(400)
await setSource(
  'import sys\n' +
  'print("=== Warsha starter ===")\n' +
  'print("Circle: area = 12.57")\n' +
  'print("warning: shapes.py has no Square yet", file=sys.stderr)\n' +
  'name = input("Your name: ")\n' +
  'print("Hello,", name)\n',
)

/* The progress block exists only while an engine is downloading, so it has to be
 * caught mid-run rather than set up and shot afterwards — and caught FAST: on a
 * warm disk cache the whole download is over in well under a second. */
await page.getByRole('button', { name: 'Run', exact: true }).first().click()
const sawProgress = await page.waitForSelector(S.progress, { timeout: 30000 }).then(() => true).catch(() => false)
if (sawProgress) {
  await shot('1280-progress-block', { sel: S.progress, note: 'boot progress: title, track, %, meta lines' })
  await shot('1280-progress-track', { sel: S.progressTrack, pad: 16, note: 'track/fill ends and the % label baseline' })
  await shot('1280-progress-meta', { rect: slice(S.progress, 'bottom', 46), probe: S.progress, pad: 0, note: 'the two meta lines under the track' })
  await shot('1280-console-header-running', { rect: HEADER, probe: { sel: S.consoleRun, up: 1 }, pad: 6, note: 'console header in the Stop state' })
  await shot('1280-status-running', { sel: S.consoleStatus, pad: 12, note: 'status line, running' })
  await shot('1280-topbar-run-busy', { sel: S.topRun, pad: 14, note: 'title-bar control in its busy state — same box as Run?' })
}
const atPrompt = await waitOut('Your name:')
if (atPrompt) log('  reached the input() prompt')

step('the waiting-for-stdin state')
await shot('1280-stdin-waiting', { sel: S.stdinRow, pad: 12, note: 'live input row, waiting' })
await shot('1280-stdin-input', { sel: S.stdinInput, pad: 14, note: 'the input against the prompt marker' })
if (atPrompt) {
  await page.locator(S.stdinInput).fill('Warsha')
  await page.locator(S.stdinInput).press('Enter')
  await waitOut('Finished', 30000)
  log('  run finished')
}

/* --------------------------------------------------------------- 1. 1280 wide */
step('1280 — title bar')
await shot('1280-titlebar-full', { sel: S.topbar, pad: 6, note: 'whole bar' })
await shot('1280-titlebar-left', { rect: slice(S.topbar, 'left', 400), probe: S.identity, note: 'FOUNDER §1b: no mark, no wordmark — project, separator, file title' })
await shot('1280-titlebar-right', { rect: slice(S.topbar, 'right', 300), probe: S.topbar, note: 'Run + ⋯ and the bar edge past them' })
await shot('1280-titlebar-run', { sel: S.topRun, pad: 14, note: 'FOUNDER P0: does Run overflow the bar box?' })
await shot('1280-titlebar-more', { sel: S.more, pad: 14, note: 'overflow ⋯; compare its box with Run' })
await shot('1280-titlebar-project', { sel: S.project, pad: 12, note: 'project chip: padding symmetry, and its label on the EXPLORER grid line' })
await shot('1280-titlebar-sep', { sel: S.sep, pad: 18, note: 'separator height and vertical centring' })
await shot('1280-titlebar-tablist-seam', { rect: junction(S.topbar, S.tablist), pad: 0, note: 'SEAM: bottom of title bar into top of tab strip' })
await shot('1280-corner-topleft', { clip: { x: 0, y: 0, width: 110, height: 96 }, pad: 0, probe: S.topbar, note: 'FOUNDER: rail / project row / EXPLORER alignment in the corner' })
await shot('1280-corner-topright', { clip: { x: 1170, y: 0, width: 110, height: 96 }, pad: 0, probe: S.topbar, note: 'top-right corner' })
await shot('1280-corner-bottomleft', { rect: async () => {
  const b = await box(S.statusbar)
  return b && { x: 0, y: b.y - 40, width: 110, height: b.height + 40 }
}, probe: S.statusbar, pad: 0, note: 'bottom-left corner: rail bottom into status bar' })
await shot('1280-corner-bottomright', { rect: async () => {
  const b = await box(S.statusbar)
  return b && { x: 1170, y: b.y - 40, width: 110, height: b.height + 40 }
}, probe: S.statusbar, pad: 0, note: 'bottom-right corner' })

step('1280 — activity bar')
await shot('1280-activitybar-full', { sel: S.activitybar, pad: 6, note: 'whole rail' })
await shot('1280-activitybar-explorer', { sel: S.actExplorer, pad: 12, note: 'active icon: border / indicator treatment' })
await shot('1280-activitybar-search', { sel: S.actSearch, pad: 12, note: 'FOUNDER: bordered the same as the active one?' })
await shot('1280-activitybar-settings', { sel: S.actSettings, pad: 12, note: 'third icon; compare all three' })
await shot('1280-activitybar-stack', { rect: slice(S.activitybar, 'top', 190), probe: S.activitybar, note: 'the three buttons together: equal gaps?' })
await shot('1280-activitybar-topbar-seam', { rect: junction(S.topbar, S.activitybar), pad: 0, note: 'SEAM: title bar meets the rail' })
await shot('1280-activitybar-sidebar-seam', { rect: around(S.activitybar, 34, 0, 34, 300), probe: S.activitybar, pad: 0, note: 'SEAM: rail into sidebar — one divider or two?' })

step('1280 — sidebar header and project row')
await shot('1280-sidebar-header', { rect: async () => {
  const l = await box(S.panelLabel), a = await box(S.activitybar)
  return l && { x: a ? a.x + a.width : l.x - 14, y: 0, width: 300, height: l.y + l.height + 26 }
}, probe: S.panelLabel, pad: 0, note: 'FOUNDER: EXPLORER label baseline vs the logo, and its left inset' })
await shot('1280-sidebar-actions', { rect: async () => {
  const l = await box(S.panelLabel)
  const s = await box('.w-explorer, aside')
  return l && { x: (s ? s.x + s.width : l.x + 260) - 170, y: l.y - 15, width: 170, height: 60 }
}, probe: S.panelLabel, pad: 0, note: 'New file / New folder: equal gaps and right inset' })
await shot('1280-sidebar-project-row', { sel: S.projectRow, pad: 8, note: 'project row: padding vs the header above it' })
await shot('1280-sidebar-header-row-seam', { rect: junction(S.panelLabel, S.projectRow), pad: 8, note: 'SEAM: header rule into the project row' })

step('1280 — explorer rows')
await shot('1280-explorer-tree', { sel: S.tree, pad: 6, note: 'whole tree' })
await shot('1280-explorer-row-active', { sel: '[role="treeitem"][data-state="open"]', pad: 10, note: 'selected row: fill, inset, dirty dot' })
await shot('1280-explorer-row-nested', { sel: '[data-path="helpers/shapes.py"]', pad: 10, note: 'nested row: indent-guide alignment' })
await shot('1280-explorer-row-long', { sel: '[data-path="geometry_calculations_helper.py"]', pad: 10, note: 'long name: ellipsis, or a collision with the ⋯?' })
await shot('1280-explorer-row-dir', { sel: '[data-path="helpers"]', pad: 10, note: 'folder row: chevron and label baseline' })
await page.locator('[data-path="helpers/shapes.py"]').hover()
await page.waitForTimeout(180)
await shot('1280-explorer-row-hover', { sel: '[data-path="helpers/shapes.py"]', pad: 10, note: 'hover: fill and the ⋯ that appears' })
await page.locator('[data-path="main.py"]').focus().catch(() => {})
await page.waitForTimeout(180)
await shot('1280-explorer-row-focus', { sel: '[data-path="main.py"]', pad: 14, note: 'focus ring: clipped by the scroller?' })
await shot('1280-explorer-guides', { rect: around('[data-path="helpers/shapes.py"]', 0, -34, 100, 96), probe: S.guide, pad: 0, note: 'indent guide vs chevron centre' })
await shot('1280-explorer-row-gap', { rect: junction('[data-path="helpers"]', '[data-path="helpers/shapes.py"]'), pad: 8, note: 'JUNCTION: two adjacent rows — equal heights, no gap?' })

step('1280 — tabs')
await shot('1280-tablist-full', { sel: S.tablist, pad: 6, note: 'whole strip' })
await shot('1280-tab-active', { sel: S.tabActive, pad: 12, note: 'active tab: 2px accent rule, badge/label baseline' })
await shot('1280-tab-inactive', { sel: S.tabInactive, pad: 12, note: 'inactive tab: same paddings as the active one?' })
await shot('1280-tab-badge', { sel: S.tabBadge, pad: 14, note: 'language badge vs label baseline' })
await shot('1280-tab-close', { sel: S.tabClose, pad: 14, note: 'close slot: centred in its 44px?' })
await shot('1280-tab-tab-seam', { rect: junction(S.tab, S.tab, { bNth: 1 }), pad: 8, note: 'JUNCTION: two tabs — one divider or two?' })
await shot('1280-tab-editor-seam', { rect: junction(S.tablist, S.editorPane), pad: 0, note: 'SEAM: tab strip into editor' })
await shot('1280-tablist-left', { rect: slice(S.tablist, 'left', 34), probe: S.tablist, note: 'strip left inset: does the first tab touch the edge?' })

step('1280 — editor')
await shot('1280-editor-gutter', { rect: async () => {
  const g = await box(S.gutters)
  return g && { x: g.x, y: g.y, width: 230, height: Math.min(200, g.height) }
}, probe: S.gutters, note: 'line numbers: right-aligned, baseline-matched to the code' })
await shot('1280-editor-gutter-active', { rect: async () => {
  const g = await box(S.gutters), a = await box(S.gutterActive)
  return g && a && { x: g.x, y: a.y - 14, width: 270, height: 50 }
}, probe: S.gutterActive, pad: 0, note: 'active line: gutter highlight vs line highlight, same box?' })
await shot('1280-editor-first-line', { rect: async () => {
  const c = await box(S.content)
  return c && { x: c.x - 64, y: c.y - 10, width: 330, height: 44 }
}, probe: S.content, pad: 0, note: 'top inset of the first code line' })
await shot('1280-editor-sidebar-seam', { rect: async () => {
  const g = await box(S.gutters)
  return g && { x: g.x - 22, y: g.y + 4, width: 44, height: 180 }
}, probe: S.gutters, pad: 0, note: 'SEAM: sidebar divider into the gutter' })

step('1280 — console')
await shot('1280-console-header', { rect: HEADER, probe: { sel: S.consoleRun, up: 1 }, pad: 6, note: 'whole header' })
await shot('1280-console-header-left', { rect: slice(HEADER, 'left', 360), probe: { sel: S.consoleRun, up: 1 }, note: 'Run + the file-to-run field: accent rule and left inset' })
await shot('1280-console-header-right', { rect: slice(HEADER, 'right', 420), probe: { sel: S.consoleRun, up: 1 }, note: 'Clear / Copy: equal gaps and right inset' })
await shot('1280-console-divider', { sel: S.divider, pad: 12, note: 'resize handle: hairline centred in its box?' })
await shot('1280-console-divider-seam', { rect: junction(S.divider, HEADER), probe: S.divider, pad: 0, note: 'SEAM: handle into header — a double hairline?' })
await shot('1280-console-editor-seam', { rect: junction(S.editorPane, S.divider), pad: 0, note: 'SEAM: editor bottom into the handle' })
await shot('1280-console-transcript', { sel: S.transcript, pad: 6, note: 'whole transcript' })
await shot('1280-console-row-stdout', { sel: S.rowOut, pad: 10, note: 'stdout row: left inset' })
await shot('1280-console-row-stderr', { sel: S.rowErr, pad: 10, note: 'stderr row: tone and inset vs stdout' })
await shot('1280-console-out-err-seam', { rect: junction(S.rowOut, S.rowErr), pad: 8, note: 'JUNCTION: stdout row against stderr row' })
await shot('1280-console-echo', { rect: async () => {
  const rows = page.locator('.console-row, [data-kind]')
  const n = await rows.count()
  for (let i = 0; i < n; i++) {
    if ((await rows.nth(i).innerText()).includes('Your name:')) {
      const b = await rows.nth(i).boundingBox()
      return b && { ...b, height: b.height + 28 }
    }
  }
  return null
}, probe: S.rowOut, pad: 8, note: 'prompt and echoed answer share a line' })
await shot('1280-console-transcript-top', { rect: slice(S.transcript, 'top', 40), probe: S.transcript, note: 'first transcript line: top inset' })
await shot('1280-console-status', { sel: S.consoleStatus, pad: 12, note: 'status line: glyph vs text baseline' })
await shot('1280-console-foot', { sel: S.consoleFoot, pad: 6, note: 'foot: divider and status-line insets' })
await shot('1280-console-statusbar-seam', { rect: junction(S.consoleFoot, S.statusbar), pad: 0, note: 'SEAM: console foot into status bar' })

step('1280 — status bar')
await shot('1280-statusbar-full', { sel: S.statusbar, pad: 6, note: 'whole bar' })
await shot('1280-statusbar-left', { rect: slice(S.statusbar, 'left', 340), probe: S.statusGroup, note: 'left end: inset from the screen edge' })
await shot('1280-statusbar-right', { rect: slice(S.statusbar, 'right', 420), probe: S.statusGroupEnd, note: 'right end: separators, stepper, right inset' })
await shot('1280-statusbar-stepper', { sel: S.statusStepper, pad: 12, note: 'text-size stepper: equal button boxes?' })
await shot('1280-statusbar-sep', { sel: S.statusSep, pad: 15, note: 'separator height and centring in a 26px bar' })

step('1280 — overflow menu')
await page.locator(S.more).first().click()
await page.waitForTimeout(350)
await shot('1280-menu-full', { sel: S.menu, pad: 12, note: 'whole menu: corner radius vs first/last row' })
await shot('1280-menu-row', { sel: S.menuitem, pad: 10, note: 'a row: icon/label baseline, left inset' })
await shot('1280-menu-top', { rect: slice(S.menu, 'top', 62), probe: S.menu, pad: 0, note: 'first row against the rounded top edge' })
await shot('1280-menu-bottom', { rect: slice(S.menu, 'bottom', 62), probe: S.menu, pad: 0, note: 'last row against the rounded bottom edge' })
await shot('1280-menu-anchor', { rect: junction(S.more, S.menu), pad: 8, note: 'menu alignment against the button that opened it' })
await shot('1280-menu-separator', { sel: `${S.menu} hr, ${S.menu} [role="separator"]`, pad: 14, note: 'separator insets' })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

step('1280 — tab context menu (has a disabled row)')
await page.locator(S.tabActive).click({ button: 'right' })
await page.waitForTimeout(350)
await shot('1280-menu-tab', { sel: S.menu, pad: 12, note: 'tab menu' })
await shot('1280-menu-row-disabled', { sel: `${S.menuitem}[aria-disabled="true"], ${S.menuitem}:disabled`, pad: 10, optional: true, note: 'disabled row, when the menu has one' })
await shot('1280-menu-row-gap', { rect: junction(S.menuitem, S.menuitem, { bNth: 1 }), probe: S.menuitem, pad: 8, note: 'JUNCTION: two adjacent rows — equal heights and insets?' })
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

step('1280 — dialog (delete confirm, from a row menu)')
const gotDialog = await page.locator(S.rowMore).first().click({ timeout: 4000 }).then(async () => {
  await page.waitForTimeout(300)
  const del = page.getByRole('menuitem', { name: /Delete/ })
  if (await del.count()) { await del.first().click(); await page.waitForTimeout(400); return true }
  await page.keyboard.press('Escape')
  return false
}).catch(() => false)
if (gotDialog && (await page.locator(S.dialog).count())) {
  await shot('1280-dialog-full', { sel: S.dialog, pad: 14, note: 'whole dialog' })
  await shot('1280-dialog-header', { rect: slice(S.dialog, 'top', 80), probe: S.dialog, pad: 0, note: 'header: title inset and the rule under it' })
  await shot('1280-dialog-footer', { rect: slice(S.dialog, 'bottom', 88), probe: S.dialog, pad: 0, note: 'footer: button gaps and right inset' })
  await shot('1280-dialog-body', { sel: `${S.dialog} p`, pad: 12, note: 'body copy insets' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
} else {
  log('  (no dialog reachable from the row menu)')
}

step('1280 — import-zip dialog (input + drop zone)')
await page.locator(S.more).first().click()
await page.waitForTimeout(300)
const imp = page.getByRole('menuitem', { name: /Import/ })
if (await imp.count()) {
  await imp.first().click()
  await page.waitForTimeout(450)
  await shot('1280-dialog-import', { sel: S.dialog, pad: 14, note: 'import dialog' })
  await shot('1280-dialog-input', { sel: `${S.dialog} input[type="text"], ${S.dialog} .dlg-input`, pad: 14, note: 'text input: border, height, focus-ring room' })
  await shot('1280-dialog-dropzone', { sel: `${S.dialog} label`, pad: 12, note: 'drop zone: dashed border corners' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
} else {
  await page.keyboard.press('Escape')
  log('  (no Import item in the menu)')
}

step('1280 — toast')
await page.getByRole('button', { name: /Copy/i }).first().click().catch(() => {})
await page.waitForTimeout(600)
await shot('1280-toast', { sel: S.toast, pad: 16, note: 'toast: icon/text baseline, padding symmetry' })

step('1280 — stopped state')
await setSource('while True: print("spin")')
await page.getByRole('button', { name: 'Run', exact: true }).first().click()
await page.waitForFunction(
  () => (document.querySelector('[aria-label="Program output"]')?.innerText.match(/spin/g) || []).length > 12,
  null, { timeout: 60000 },
).catch(() => {})
await shot('1280-titlebar-stop', { sel: S.topRun, pad: 14, note: 'title bar in the Stop state — same box as Run?' })

/* The scroll pill exists only while output is STREAMING and the student has
 * scrolled away from the bottom. Scrolling a finished transcript does not
 * produce it, which is why this crop lives inside the spin and not with the
 * other console crops. */
await page.locator(S.transcript).evaluate((el) => { el.scrollTop = 0 }).catch(() => {})
await page.waitForTimeout(700)
await shot('1280-scroll-pill', { sel: S.scrollPill, pad: 16, note: 'jump-to-latest: icon/text baseline, corner radius, unseen count' })
await shot('1280-scroll-pill-context', { rect: around(S.scrollPill, -140, -34, 320, 92), probe: S.scrollPill, pad: 0, note: 'pill against the transcript it floats over' })
await page.locator(S.transcript).evaluate((el) => { el.scrollTop = el.scrollHeight }).catch(() => {})
await page.waitForTimeout(250)

await page.getByRole('button', { name: 'Stop', exact: true }).first().click()
await waitOut('Stopped', 20000)
await page.waitForTimeout(400)
await shot('1280-status-stopped', { sel: S.consoleStatus, pad: 12, note: 'stopped status line' })
await shot('1280-statusbar-stopped', { rect: slice(S.statusbar, 'left', 340), probe: S.statusGroup, note: 'status bar, stopped' })

/* -------------------------------------------------------------- 2. 390 narrow */
step('390 — reflow')
await page.setViewportSize({ width: 390, height: 780 })
await page.waitForTimeout(800)

await shot('390-full', { clip: { x: 0, y: 0, width: 390, height: 780 }, pad: 0, note: 'whole phone viewport' })
await shot('390-titlebar', { sel: S.topbar, pad: 6, note: 'compact bar: hamburger, file title, no Run' })
await shot('390-titlebar-left', { rect: slice(S.topbar, 'left', 220), probe: S.topbar, note: 'left end insets' })
await shot('390-titlebar-right', { rect: slice(S.topbar, 'right', 150), probe: S.topbar, note: 'right end insets' })
await shot('390-tablist', { sel: S.tablist, pad: 6, note: 'strip at 390: fade edges, no × on inactive tabs' })
await shot('390-tab-active', { sel: S.tabActive, pad: 12, note: 'active tab at 390' })
await shot('390-console-header', { rect: HEADER, probe: { sel: S.consoleRun, up: 1 }, pad: 6, note: 'header at 390: the select and Run must fit' })
await shot('390-console-header-right', { rect: slice(HEADER, 'right', 230), probe: { sel: S.consoleRun, up: 1 }, note: 'right cluster at 390' })
await shot('390-console-transcript', { sel: S.transcript, pad: 6, note: 'transcript at 390' })
await shot('390-console-status', { sel: S.consoleStatus, pad: 10, note: 'status line at 390' })
await shot('390-console-divider', { sel: S.divider, pad: 12, optional: true, note: 'resize handle — pointer layouts only' })
await shot('390-editor-gutter', { rect: async () => {
  const g = await box(S.gutters)
  return g && { x: g.x, y: g.y, width: 190, height: Math.min(160, g.height) }
}, probe: S.gutters, note: 'gutter at 390' })
await shot('390-statusbar', { sel: S.statusbar, pad: 6, optional: true, note: 'status bar — pointer layouts only' })

step('390 — explorer drawer')
await page.locator(S.hamburger).first().click().catch(() => {})
await page.waitForTimeout(500)
await shot('390-drawer', { clip: { x: 0, y: 0, width: 390, height: 780 }, pad: 0, note: 'drawer open over the scrim' })
await shot('390-drawer-header', { sel: S.panelLabel, pad: 18, note: 'EXPLORER label at 390' })
await shot('390-drawer-row', { sel: S.row, pad: 10, note: 'a row at 390' })
await shot('390-drawer-edge', { rect: around(S.row, 250, -44, 110, 170), probe: S.row, pad: 0, note: 'drawer right edge: shadow/seam against the scrim' })
await page.keyboard.press('Escape')
await page.waitForTimeout(450)

step('390 — keyboard open (simulated the way ui/viewport.ts publishes it)')
await setSource('name = input("Your name: ")\nprint("Hi", name)\n')
await page.getByRole('button', { name: 'Run', exact: true }).first().click()
await waitOut('Your name:', 90000)
/* Two passes: the console answers the shrink with a ResizeObserver scroll, which
 * cannot land inside the same evaluate() that forced it. See console-kb.mjs. */
const raiseKeyboard = () => {
  const KB = 340
  const root = document.documentElement
  root.style.setProperty('--kb-inset', `${KB}px`)
  root.style.setProperty('--app-h', `${window.innerHeight - KB}px`)
  root.dataset.kb = 'open'
}
await page.evaluate(raiseKeyboard)
await page.waitForTimeout(350)
await page.evaluate(raiseKeyboard)
await page.waitForTimeout(350)
await shot('390-kb-full', { clip: { x: 0, y: 0, width: 390, height: 440 }, pad: 0, note: 'everything above the simulated keyboard' })
await shot('390-kb-titlebar', { sel: S.topbar, pad: 6, note: 'bar compacts to 40px: do the icon buttons still fit?' })
await shot('390-kb-console-header', { rect: HEADER, probe: { sel: S.consoleRun, up: 1 }, pad: 6, note: 'header with the keyboard up' })
await shot('390-kb-stdin', { sel: S.stdinRow, pad: 12, note: 'the live row the student is typing on' })
await shot('390-kb-transcript', { sel: S.transcript, pad: 6, note: 'four output lines must survive here' })
await page.evaluate(() => {
  document.documentElement.dataset.kb = 'closed'
  document.documentElement.style.setProperty('--kb-inset', '0px')
})

/* ------------------------------------------------------------------- 3. output */
writeFileSync(join(CROPS, 'measurements.json'), JSON.stringify(measurements, null, 2))
log(`\n==== ${captured} crops -> ${CROPS}${skipped ? `  (${skipped} filtered out by WARSHA_ONLY)` : ''}`)
if (misses.length) log(`     ${misses.length} miss(es): ${misses.join(', ')}`)
log(`     geometry -> ${join(CROPS, 'measurements.json')}`)

await ctx.close()
