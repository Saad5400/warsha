/* QA for the home-screen install affordance (app/src/ui/install.ts).
 *
 * Why this suite exists in a project whose other suites all drive real engines:
 * `beforeinstallprompt` is the one user-visible path that CANNOT be reached by
 * driving the app. Headless Chrome never fires it, and a headed Chrome that does
 * fire it answers `prompt()` with a native dialog that would install Warsha onto
 * the machine running the tests. So the event is injected instead — a real
 * `Event` carrying the two members the spec gives it — and everything downstream
 * of the injection is the actual production code path: our module-scope listener,
 * the store, the control, and the single-use discipline around `prompt()`.
 *
 * What is genuinely covered: the control is absent until the browser offers,
 * present the moment it does, calls `prompt()` exactly once per offer, leaves at
 * once (a second tap cannot reach a spent event, which throws), returns when
 * Chrome re-offers after a dismissal, and never comes back after `appinstalled`.
 * Plus the iOS branch, which no button can serve: a WebKit user agent gets the
 * Share-sheet sentence on the welcome panel and no control at all.
 *
 * Drives LOCAL Chrome against a live server — a `vite` dev server or a built
 * `vite preview`, either works, this suite touches no engine. Start one first:
 *
 *   cd app && npx vite --port 8104
 *   cd tools/qa && node install-check.mjs
 *
 * Overridable:
 *   WARSHA_URL    default http://127.0.0.1:8104/
 *   CHROME        default /usr/bin/google-chrome
 */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8104/'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

let pass = 0
let fail = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`)
  ok ? pass++ : fail++
}

const INSTALL = '.top-bar button[aria-label="Install Warsha"]'
// Verbatim from app/src/copy.ts — asserted whole so a reworded string fails here, not silently.
const IOS_COPY =
  'On iPhone and iPad: tap Share, then Add to Home Screen. Warsha then opens like any other app.'

const errors = []
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text())
  })
}

/** Blocks Chrome's real beforeinstallprompt (timing is unpredictable) so only
 *  this suite's marked, injected events get through. */
const OWN_OFFER_OFF = () => {
  window.addEventListener(
    'beforeinstallprompt',
    (e) => {
      if (!e.__injected) e.stopImmediatePropagation()
    },
    true,
  )
}

/** Fires a fake beforeinstallprompt; records each prompt() call on
 *  window.__installPrompts for assertion. `outcome` is what the fake sheet reports. */
const offerInstall = (page, outcome = 'accepted') =>
  page.evaluate((choice) => {
    window.__installPrompts ??= []
    const e = new Event('beforeinstallprompt', { cancelable: true })
    e.__injected = true
    e.prompt = () => {
      window.__installPrompts.push(Date.now())
      return Promise.resolve()
    }
    e.userChoice = Promise.resolve({ outcome: choice, platform: 'web' })
    window.dispatchEvent(e)
  }, outcome)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-install-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
watch(page)
await ctx.addInitScript(OWN_OFFER_OFF)
await page.goto(URL_, { waitUntil: 'load' })
// The one automatic coi-serviceworker reload happens somewhere in here; wait for the title bar to settle.
await page.waitForTimeout(1500)
await page.locator('.top-bar').first().waitFor()

// ---------------------------------------------------------------- no offer
check(
  'no install control until the browser offers one',
  (await page.locator(INSTALL).count()) === 0,
  'nothing has been offered yet, so there is nothing to tap',
)

// ---------------------------------------------------------------- offered
await offerInstall(page)
await page.waitForTimeout(200)
check('the control appears the moment the browser offers', (await page.locator(INSTALL).count()) === 1)

// Install takes the leading slot of the trailing group so it never displaces the
// fixed sidebar/panel toggles (Run and ⋯ live in the tab strip).
const order = await page.$$eval('.top-bar button', (bs) => bs.map((b) => b.getAttribute('aria-label')))
const deskIC = await page.evaluate(() => matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches)
check(
  'it takes the leading slot of the trailing group',
  order.indexOf('Install Warsha') < order.indexOf('Toggle Primary Side Bar') &&
    order.indexOf('Install Warsha') < order.indexOf('Toggle Panel'),
  order.join(' | '),
)

// 40px on touch; DENSITY media compacts icon buttons to 28px at a fine pointer (this window).
const box = await page.locator(INSTALL).boundingBox()
const wantBox = deskIC ? 28 : 40
check(`${wantBox}px box at this density`, box.width === wantBox && box.height === wantBox, `${box.width}x${box.height}`)

// ---------------------------------------------------------------- one tap
await page.locator(INSTALL).click()
await page.waitForTimeout(200)
check(
  'tapping it opens the browser sheet exactly once',
  (await page.evaluate(() => window.__installPrompts.length)) === 1,
)
check(
  'the control leaves with the event it spent',
  (await page.locator(INSTALL).count()) === 0,
  'a second prompt() on the same event throws — it must be unreachable',
)

// ---------------------------------------------------------------- re-offer
// Chrome re-fires after a dismissal. The student gets the control back.
await offerInstall(page, 'dismissed')
await page.waitForTimeout(200)
check('a re-offer after a dismissal brings the control back', (await page.locator(INSTALL).count()) === 1)
await page.locator(INSTALL).click()
await page.waitForTimeout(200)
check(
  'the second offer prompts on its own event',
  (await page.evaluate(() => window.__installPrompts.length)) === 2,
)

// ---------------------------------------------------------------- installed
// However install happened — our control, omnibox, or browser menu — the offer is over for good.
await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
await offerInstall(page)
await page.waitForTimeout(200)
check(
  'after appinstalled nothing offers again, not even a stray event',
  (await page.locator(INSTALL).count()) === 0,
)

// ---------------------------------------------------------------- iOS
// WebKit fires no install event; iOS gets the sentence instead. Separate context
// (UA fixed at creation) plus OWN_OFFER_OFF, or Chromium would offer anyway.
const iosCtx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-install-ios-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
})
const ios = iosCtx.pages()[0] ?? (await iosCtx.newPage())
watch(ios)
await iosCtx.addInitScript(OWN_OFFER_OFF)
await ios.goto(URL_, { waitUntil: 'load' })
await ios.waitForTimeout(1500)
await ios.locator('.editor-pane').first().waitFor()

check(
  'iOS: the welcome panel says how, since no control can do it',
  (await ios.locator(`text=${IOS_COPY}`).count()) === 1,
)
check('iOS: and the title bar offers no install control', (await ios.locator(INSTALL).count()) === 0)

// Desktop is the control-only case — the sentence would be wrong there.
check(
  'the Share-sheet sentence is iOS-only, absent on desktop',
  (await page.locator(`text=${IOS_COPY}`).count()) === 0,
)

// ---------------------------------------------------------------- console
if (errors.length === 0) check('no console errors', true)
else check('no console errors', false, `${errors.length}: ${errors.slice(0, 3).join(' | ')}`)

console.log(`\n==== ${pass}/${pass + fail} checks passed ====`)
await iosCtx.close()
await ctx.close()
process.exit(fail ? 1 : 0)
