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
  await p.goto('http://localhost:8087/', { waitUntil: 'load' })
  await p.waitForSelector('.template-card', { timeout: 20000 })
  await p.getByRole('button', { name: /Java \(OOP starter\)/ }).click()
  await p.waitForSelector('[role="tab"]', { timeout: 15000 })
  await p.waitForTimeout(700)
  // The console starts collapsed on a fresh project, so the stdin row does not
  // exist yet — open it, or the "is the input above the keyboard" check measures
  // an unmounted subtree and reports null.
  const show = p.getByRole('button', { name: 'Show output' })
  if (await show.count()) { await show.click(); await p.waitForTimeout(400) }
  await p.waitForSelector('.stdin-input', { timeout: 5000 })

  const drawer = await p.evaluate(() => {
    const el = document.querySelector('.drawer')
    if (!el) return null
    const c = getComputedStyle(el)
    return { dur: c.transitionDuration, prop: c.transitionProperty, state: el.dataset.state, tf: c.transform }
  })
  const dot = await p.evaluate(() => {
    const d = document.createElement('span'); d.className = 'dot'
    const w = document.createElement('span'); w.className = 'pill'; w.append(d); document.body.append(w)
    const a = getComputedStyle(d).animationName, t = getComputedStyle(d).animationDuration
    w.remove(); return { name: a, dur: t }
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
  await p.getByRole('button', { name: 'Files' }).click()
  await p.waitForTimeout(400)
  if (motion === 'no-preference') await p.screenshot({ path: `${SHOTS}/final-390-drawer-open.png` })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)

  await p.evaluate(() => {
    document.documentElement.dataset.kb = 'open'
    document.documentElement.style.setProperty('--kb-inset', '336px')
    document.documentElement.style.setProperty('--app-h', '844px')
  })
  await p.waitForTimeout(400)
  const kb = await p.evaluate(() => {
    const shell = getComputedStyle(document.querySelector('.app-shell'))
    const panel = document.querySelector('.console-panel')
    const stdin = document.querySelector('.stdin-input')
    const runBtn = [...document.querySelectorAll('.console-header button')][0]
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
    if (kb.panelMb === '336px') pass('§4.3 r1. console is lifted by the full --kb-inset', kb.panelMb)
    else fail('§4.3 r1. console-lift', kb.panelMb)
    if (kb.clearLabels === 0) pass('§4.3 r3. decorative labels (Clear, wordmark, entry) are hidden, controls stay')
    else fail('§4.3 r3. kb-hide', String(kb.clearLabels))
    if (kb.stdinBottom !== null && kb.stdinBottom <= kb.keyboardTop)
      pass('9. stdin row sits ABOVE the keyboard, fully visible', `input bottom ${kb.stdinBottom} ≤ keyboard top ${kb.keyboardTop}`)
    else fail('9. stdin row above the keyboard', JSON.stringify(kb))
    if (kb.runBottom !== null && kb.runBottom <= kb.keyboardTop)
      pass('12. Run/Stop rides up with the console and is never covered', `Run bottom ${kb.runBottom} ≤ ${kb.keyboardTop}`)
    else fail('12. Run above the keyboard', JSON.stringify(kb))
    await p.screenshot({ path: `${SHOTS}/final-390-keyboard-open.png` })
    console.log('      shot -> final-390-keyboard-open.png')
  }
  await ctx.close()
}
console.log(`\n==== ${out.filter(Boolean).length}/${out.length} motion + keyboard checks passed ====`)
