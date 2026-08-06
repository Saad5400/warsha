/* Checklist 20 (reduced motion), §9 (drawer transition), §4.3 (keyboard-open
 * compaction). data-kb is normally written by visualViewport, which a desktop
 * viewport never triggers, so we set it directly to exercise the CSS state. */
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const out = []
const pass = (n, d='') => { out.push(1); console.log(`PASS  ${n}${d?' :: '+d:''}`) }
const fail = (n, d='') => { out.push(0); console.log(`FAIL  ${n}${d?' :: '+d:''}`) }

for (const motion of ['no-preference', 'reduce']) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'w-m-')), {
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: motion })
  const p = ctx.pages()[0] ?? await ctx.newPage()
  await p.goto(process.env.WARSHA_URL ?? 'http://localhost:8087/', { waitUntil: 'load' })
  // Durable handle is the accessible name on the single "New from a starter" card.
  await p.getByRole('button', { name: /New from a starter/ }).waitFor({ timeout: 20000 })
  await seedStarter(p, { lang: 'Java', name: 'Java (OOP starter)' })
  await p.waitForSelector('[role="tab"]', { timeout: 15000 })
  await p.waitForTimeout(700)
  // Console starts collapsed — open it or geometry checks measure an
  // unmounted subtree. Wait on `.console-header`, since nothing runs here to
  // produce stdin.
  const show = p.getByRole('button', { name: 'Show output' })
  if (await show.count()) { await show.click(); await p.waitForTimeout(400) }
  await p.waitForSelector('.console-header', { timeout: 5000 })

  const drawer = await p.evaluate(() => {
    const el = document.querySelector('.drawer')
    if (!el) return null
    const c = getComputedStyle(el)
    return { dur: c.transitionDuration, prop: c.transitionProperty, state: el.dataset.state, tf: c.transform }
  })
  // Dot's animation moved to the `animate-dot-pulse` utility (with
  // `motion-reduce:animate-none`) — probe what the component actually wears.
  const dot = await p.evaluate(() => {
    const d = document.createElement('span')
    d.className = 'animate-dot-pulse motion-reduce:animate-none'
    document.body.append(d)
    const a = getComputedStyle(d).animationName, t = getComputedStyle(d).animationDuration
    d.remove(); return { name: a, dur: t }
  })
  console.log(`      [${motion}] drawer ${JSON.stringify(drawer)}  running dot ${JSON.stringify(dot)}`)

  if (motion === 'no-preference') {
    if (drawer && drawer.dur === '0.18s' && /transform/.test(drawer.prop))
      pass('§9 drawer animates transform over --dur (180ms)', drawer.dur)
    else fail('§9 drawer transition', JSON.stringify(drawer))
    if (dot.name === 'warsha-pulse' && dot.dur === '1.4s')
      pass('§9 running indicator is a 1.4s pulse — the app\'s one continuous animation')
    else fail('§9 running pulse', JSON.stringify(dot))
  } else {
    if (drawer && parseFloat(drawer.dur) <= 0.001)
      pass('20. reduced motion: drawer appears without animating', drawer.dur)
    else fail('20. reduced motion drawer', JSON.stringify(drawer))
    if (dot.name === 'none')
      pass('20. reduced motion: running dot goes static, pill relies on its word')
    else fail('20. reduced motion dot', JSON.stringify(dot))
  }

  // ---- §4.3 keyboard-open compaction
  // Drawer opens via the activity bar's Explorer item — same control as the
  // docked pane at desk.
  await p.locator('nav[aria-label="Activity bar"] button[aria-label="Explorer"]').click()
  await p.waitForTimeout(400)
  if (motion === 'no-preference') await p.screenshot({ path: `${SHOTS}/final-390-drawer-open.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  // Simulated at the source (visualViewport), not by writing CSS vars —
  // viewport.ts re-syncs and undoes them, and a full-window --app-h is a
  // geometry the app never has (visualViewport.height is already above the keyboard).
  await p.evaluate((KB) => {
    const vv = window.visualViewport
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - KB })
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 })
    vv.dispatchEvent(new Event('resize'))
  }, 336)
  await p.waitForTimeout(500)
  const kb = await p.evaluate(() => {
    const shell = getComputedStyle(document.querySelector('.app-shell'))
    const panel = document.querySelector('.console-panel')
    // Status bar carries run state normally; while the keyboard hides it, the
    // header's kb-open-only pill stands in.
    const pill = document.querySelector('.console-header .pill')
    const headBtn = document.querySelector('.console-header button')
    const vh = window.innerHeight
    const kbTop = vh - 336
    return {
      topBar: shell.gridTemplateRows.split(' ')[0],
      pad: getComputedStyle(document.documentElement).getPropertyValue('--pad-panel').trim(),
      panelMb: panel ? getComputedStyle(panel).marginBottom : null,
      panelMinH: panel ? getComputedStyle(panel).minHeight : null,
      panelBottom: panel ? Math.round(panel.getBoundingClientRect().bottom) : null,
      pillShown: pill ? pill.getBoundingClientRect().width > 0 : false,
      statusBarShown: !!document.querySelector('footer[aria-label="Status bar"]'),
      headBtnBottom: headBtn ? Math.round(headBtn.getBoundingClientRect().bottom) : null,
      keyboardTop: kbTop,
      clearLabels: [...document.querySelectorAll('.kb-hide')].filter((e) => e.getBoundingClientRect().width > 0).length,
    }
  })
  console.log(`      [${motion}] kb-open ${JSON.stringify(kb)}`)
  if (motion === 'no-preference') {
    if (kb.topBar === '40px') pass('§4.3 r3. top bar drops to 40px when the keyboard is up')
    else fail('§4.3 r3. top bar 40px', kb.topBar)
    if (kb.pad === '8px') pass('§4.3 r3. panel padding drops 12px → 8px')
    else fail('§4.3 r3. panel padding 8px', kb.pad)
    // No console-lift by design — --app-h is already visualViewport.height,
    // so a margin-bottom would subtract the inset twice.
    if (kb.panelMb === '0px') pass('§4.3 r1. no double keyboard inset — the shell is already sized above it', 'console margin-bottom 0')
    else fail('§4.3 r1. console-lift must stay removed', kb.panelMb)
    if (kb.clearLabels === 0) pass('§4.3 r3. decorative labels (Clear, wordmark, entry) are hidden, controls stay')
    else fail('§4.3 r3. kb-hide', String(kb.clearLabels))
    if (kb.panelBottom !== null && kb.panelBottom <= kb.keyboardTop)
      pass('9. the console panel ends ABOVE the keyboard, fully visible', `panel bottom ${kb.panelBottom} ≤ keyboard top ${kb.keyboardTop}`)
    else fail('9. console panel above the keyboard', JSON.stringify(kb))
    if (kb.headBtnBottom !== null && kb.headBtnBottom <= kb.keyboardTop)
      pass('12. the console header controls ride up with the console, never covered', `bottom ${kb.headBtnBottom} ≤ ${kb.keyboardTop}`)
    else fail('12. header controls above the keyboard', JSON.stringify(kb))
    if (!kb.statusBarShown && kb.pillShown)
      pass('kb-open: the status bar stands down and the header pill carries the run state')
    else fail('kb-open run-state handoff (bar down, pill up)', JSON.stringify({ statusBarShown: kb.statusBarShown, pillShown: kb.pillShown }))
    await p.screenshot({ path: `${SHOTS}/final-390-keyboard-open.png` })
    console.log('      shot -> final-390-keyboard-open.png')
  }
  await ctx.close()
}
console.log(`\n==== ${out.filter(Boolean).length}/${out.length} motion + keyboard checks passed ====`)
