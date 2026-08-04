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
/* Verbatim from app/src/copy.ts — asserted whole, the same way verify.mjs pins
 * stdinWaitingPlaceholder, so a reworded string fails here instead of silently
 * shipping. */
const IOS_COPY =
  'On iPhone and iPad: tap Share, then Add to Home Screen. Warsha then opens like any other app.'

const errors = []
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(m.text())
  })
}

/**
 * Suppresses the browser's OWN offer, so the suite owns the timeline.
 *
 * This is not a workaround, it is the point: Chrome — headless included — fires
 * a real `beforeinstallprompt` at a moment of its own choosing, which makes
 * "the control is absent until offered" untestable and makes the iOS case, whose
 * whole premise is an event that never arrives, impossible to reach. A
 * capture-phase listener installed before any page script runs first and stops
 * the real one dead; the events this suite injects carry a marker and pass.
 */
const OWN_OFFER_OFF = () => {
  window.addEventListener(
    'beforeinstallprompt',
    (e) => {
      if (!e.__injected) e.stopImmediatePropagation()
    },
    true,
  )
}

/**
 * Fires a `beforeinstallprompt` that behaves the way Chrome's does, and records
 * every `prompt()` on `window.__installPrompts` so the count can be asserted.
 * `outcome` is what the fake sheet reports back.
 */
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
// The app's one automatic coi-serviceworker reload lands somewhere in here; the
// title bar is only meaningful once it has settled.
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

// It sits between the identity run and Run/⋯ — leftmost of the trailing group,
// so the control that comes and goes never displaces the two that do not.
const order = await page.$$eval('.top-bar button', (bs) => bs.map((b) => b.getAttribute('aria-label')))
check(
  'it takes the leading slot of the trailing group, ahead of Run and ⋯',
  order.indexOf('Install Warsha') < order.indexOf('More') &&
    order.indexOf('Install Warsha') < order.findIndex((l) => /^Run/.test(l ?? '')),
  order.join(' | '),
)

const box = await page.locator(INSTALL).boundingBox()
check('40px box, per the icon-only founder ruling', box.width === 40 && box.height === 40, `${box.width}x${box.height}`)

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
// However it happened — our control, the omnibox icon, the browser menu — the
// offer is over for good.
await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
await offerInstall(page)
await page.waitForTimeout(200)
check(
  'after appinstalled nothing offers again, not even a stray event',
  (await page.locator(INSTALL).count()) === 0,
)

// ---------------------------------------------------------------- iOS
// WebKit fires no install event ever, so the welcome panel carries the sentence
// and the title bar carries nothing. A separate context because the user agent
// is fixed when the context is made — and OWN_OFFER_OFF is what makes the UA
// override mean anything, since Chromium keeps offering whatever UA it claims.
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
