/* Screenshots + computed-style spot-asserts for the Tailwind migration, taken
 * from the REAL app rather than a harness: welcome panel, tab strip, editor
 * empty state, console header and the run-state pill, at 1280 and 390.
 *
 *   WARSHA_URL=http://127.0.0.1:8098/ node shots-migration.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const APP_URL = process.env.WARSHA_URL ?? 'http://127.0.0.1:8098/'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const SHOTS = process.env.WARSHA_SHOTS ?? new URL('./screenshots', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

/* The properties that would actually show up as a pixel change, per component,
 * with the values the bespoke CSS produced before the migration. */
const ASSERTS = [
  ['.tab-strip', { height: '44px', 'background-color': 'rgb(31, 35, 42)', 'overflow-x': 'auto' }],
  [
    '[role="tab"][data-state="active"]',
    {
      'background-color': 'rgb(26, 29, 35)',
      'border-bottom-width': '2px',
      'border-bottom-color': 'rgb(242, 169, 75)',
      'padding-left': '12px',
      'min-width': '96px',
    },
  ],
  [
    '[role="tab"][data-state="active"] .tab__label',
    { 'font-size': '13px', 'font-weight': '600', color: 'rgb(232, 235, 240)', 'text-overflow': 'ellipsis' },
  ],
  ['.tab__close', { width: '44px', height: '44px', 'border-radius': '6px', 'margin-right': '-8px' }],
  [
    '.console-header',
    { height: '44px', 'background-color': 'rgb(31, 35, 42)', display: 'flex', 'align-items': 'center' },
  ],
  [
    '.pill',
    {
      // Declared `inline-flex`, as it always was — but the pill is a flex item
      // of the console header, and a flex item is blockified, so the COMPUTED
      // value is `flex`. It read the same before the migration.
      display: 'flex',
      height: '24px',
      'border-radius': '999px',
      'font-size': '12px',
      'font-weight': '600',
      'padding-left': '8px',
    },
  ],
  ['.editor-pane', { position: 'relative', 'min-height': '96px', 'background-color': 'rgb(26, 29, 35)' }],
]

const WELCOME_ASSERTS = [
  ['.lockup', { display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'row-gap': '8px' }],
  ['.lockup__word', { 'font-size': '28px', 'font-weight': '600', color: 'rgb(232, 235, 240)' }],
  [
    '.template-card',
    {
      display: 'grid',
      'min-height': '88px',
      'padding-top': '16px',
      'border-radius': '14px',
      'border-top-width': '1px',
      'border-top-color': 'rgb(107, 119, 137)',
      'background-color': 'rgb(38, 43, 51)',
      'grid-template-rows': (v) => v.split(' ').length === 3,
    },
  ],
]

const fails = []
async function assertStyles(page, list, where) {
  for (const [sel, props] of list) {
    const got = await page.evaluate(
      ({ sel, keys }) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        return Object.fromEntries(keys.map((k) => [k, cs.getPropertyValue(k)]))
      },
      { sel, keys: Object.keys(props) },
    )
    if (!got) {
      fails.push(`${where}  ${sel}  NOT FOUND`)
      continue
    }
    for (const [k, want] of Object.entries(props)) {
      const ok = typeof want === 'function' ? want(got[k]) : got[k] === want
      if (!ok) fails.push(`${where}  ${sel}  ${k}: got "${got[k]}", want "${want}"`)
    }
  }
}

const browser = await chromium.launch({ executablePath: CHROME })

for (const width of [1280, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } })
  const page = await ctx.newPage()
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.template-card', { timeout: 20000 })
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${SHOTS}/mig-${width}-welcome.png` })
  await assertStyles(page, WELCOME_ASSERTS, `${width} welcome`)

  // Hover a start card so the border/fill/arrow-accent transition is on record.
  await page.hover('.template-card')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${SHOTS}/mig-${width}-card-hover.png` })

  // Take a template so tabs, the editor and the console header are all real.
  await page.click('.template-card:nth-of-type(2)')
  await page.waitForSelector('[role="tab"]', { timeout: 20000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOTS}/mig-${width}-ide.png` })
  await assertStyles(page, ASSERTS, `${width} ide`)

  // The tab strip and console header on their own, at 2x, for eyeballing.
  for (const [name, sel] of [
    ['tabs', '[role="tablist"]'],
    ['console-header', '.console-header'],
    ['pill', '.pill'],
  ]) {
    const el = page.locator(sel).first()
    if (await el.count()) {
      const box = await el.boundingBox()
      if (box) {
        await page.screenshot({
          path: `${SHOTS}/mig-${width}-${name}.png`,
          clip: {
            x: Math.max(0, box.x - 6),
            y: Math.max(0, box.y - 6),
            width: Math.min(width, box.width + 12),
            height: box.height + 12,
          },
        })
      }
    }
  }

  await ctx.close()
}

await browser.close()

if (fails.length) {
  console.log(`FAIL — ${fails.length} computed-style mismatches`)
  for (const f of fails) console.log('  ' + f)
  process.exit(1)
}
console.log(`PASS — computed styles match the pre-migration values; shots in ${SHOTS}`)
