/* Checklist 20 (reduced motion), §9 (drawer transition), §4.3 (keyboard-open
 * compaction). data-kb is normally written by visualViewport, which a desktop
 * viewport never triggers, so we set it directly to exercise the CSS state. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const SHOTS = '/tmp/claude-1000/-home-saad-phpstorm-projects/bbe7e559-3593-441c-9d09-b825a1ae50ea/scratchpad'
const out = []
const pass = (n, d='') => { out.push(1); console.log(`PASS  ${n}${d?' :: '+d:''}`) }
const fail = (n, d='') => { out.push(0); console.log(`FAIL  ${n}${d?' :: '+d:''}`) }

for (const motion of ['no-preference', 'reduce']) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'w-m-')), {
    executablePath: '/usr/bin/google-chrome', headless: true,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: motion })
  const p = ctx.pages()[0] ?? await ctx.newPage()
  await p.goto(process.env.WARSHA_URL ?? 'http://localhost:8087/', { waitUntil: 'load' })
  // WelcomePanel's cards lost their `template-card` class in a concurrent
  // refactor; the accessible name is the durable handle.
  await p.getByRole('button', { name: /starter/i }).first().waitFor({ timeout: 20000 })
  await p.getByRole('button', { name: /Java \(OOP starter\)/ }).click()
  await p.waitForSelector('[role="tab"]', { timeout: 15000 })
  await p.waitForTimeout(700)
  // The console starts collapsed on a fresh project, so none of its internals
  // exist yet — open it, or the keyboard-geometry checks measure an unmounted
  // subtree and report null. Nothing is running here, so there is deliberately no
  // stdin input to wait for: `.console-foot` (the status line) is the bottom-most
  // thing the console always has.
  const show = p.getByRole('button', { name: 'Show output' })
  if (await show.count()) { await show.click(); await p.waitForTimeout(400) }
  await p.waitForSelector('.console-foot', { timeout: 5000 })

  const drawer = await p.evaluate(() => {
    const el = document.querySelector('.drawer')
    if (!el) return null
    const c = getComputedStyle(el)
    return { dur: c.transitionDuration, prop: c.transitionProperty, state: el.dataset.state, tf: c.transform }
  })
  // The running dot moved from a `.pill .dot` rule to the `animate-dot-pulse`
  // utility on StatusPill (with `motion-reduce:animate-none` beside it), so probe
  // what the component actually wears.
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
  await p.getByRole('button', { name: 'Files', exact: true }).click()
  await p.waitForTimeout(400)
  if (motion === 'no-preference') await p.screenshot({ path: `${SHOTS}/final-390-drawer-open.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  // Simulate the keyboard at its source, not by writing the CSS variables.
  // Writing them by hand was doubly wrong: ui/viewport.ts re-syncs from
  // visualViewport and undoes them, and `--app-h: 844px` (the full window) is a
  // shell geometry the app never has — visualViewport.height is ALREADY the
  // height above the keyboard on both platforms, which is why nothing subtracts
  // --kb-inset a second time. With the old values the console legitimately sat
  // below the simulated keyboard line and three checks failed on the simulation
  // rather than on the app.
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
    const stdin = document.querySelector('.console-foot')
    // RunBar's root lost its `console-header` class in a concurrent refactor.
    const runBtn = document.querySelector('.console-header button, section[aria-label="Console"] > div:first-of-type button')
    const vh = window.innerHeight
    const kbTop = vh - 336
    return {
      topBar: shell.gridTemplateRows.split(' ')[0],
      pad: getComputedStyle(document.documentElement).getPropertyValue('--pad-panel').trim(),
      panelMb: panel ? getComputedStyle(panel).marginBottom : null,
      panelMinH: panel ? getComputedStyle(panel).minHeight : null,
      stdinBottom: stdin ? Math.round(stdin.getBoundingClientRect().bottom) : null,
      runBottom: runBtn ? Math.round(runBtn.getBoundingClientRect().bottom) : null,
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
    // There is deliberately NO console-lift: --app-h is visualViewport.height, so
    // .app-shell already ends at the keyboard and a margin-bottom would subtract
    // it twice (index.css says this at length, with the measurements). The check
    // is therefore that the lift is ABSENT and the shell ends where it should.
    if (kb.panelMb === '0px') pass('§4.3 r1. no double keyboard inset — the shell is already sized above it', 'console margin-bottom 0')
    else fail('§4.3 r1. console-lift must stay removed', kb.panelMb)
    if (kb.clearLabels === 0) pass('§4.3 r3. decorative labels (Clear, wordmark, entry) are hidden, controls stay')
    else fail('§4.3 r3. kb-hide', String(kb.clearLabels))
    if (kb.stdinBottom !== null && kb.stdinBottom <= kb.keyboardTop)
      pass('9. the console foot (status line) sits ABOVE the keyboard, fully visible', `foot bottom ${kb.stdinBottom} ≤ keyboard top ${kb.keyboardTop}`)
    else fail('9. console foot above the keyboard', JSON.stringify(kb))
    if (kb.runBottom !== null && kb.runBottom <= kb.keyboardTop)
      pass('12. Run/Stop rides up with the console and is never covered', `Run bottom ${kb.runBottom} ≤ ${kb.keyboardTop}`)
    else fail('12. Run above the keyboard', JSON.stringify(kb))
    await p.screenshot({ path: `${SHOTS}/final-390-keyboard-open.png` })
    console.log('      shot -> final-390-keyboard-open.png')
  }
  await ctx.close()
}
console.log(`\n==== ${out.filter(Boolean).length}/${out.length} motion + keyboard checks passed ====`)
