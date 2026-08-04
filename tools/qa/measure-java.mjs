import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'

/* Overridable so this runs anywhere:
 *   WARSHA_URL    base URL of a SERVED BUILD  (default http://127.0.0.1:8086/)
 *   WARSHA_SHOTS  where screenshots land      (default tools/qa/screenshots/)
 *   CHROME        Chrome binary               (default /usr/bin/google-chrome)
 *
 * 127.0.0.1 rather than localhost deliberately: a preview server bound to IPv4
 * only is unreachable via "localhost" when Chrome resolves it to ::1 first. */
const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
mkdirSync(SHOTS, { recursive: true })

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'jmeas-')), {
  executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 } })
const page = ctx.pages()[0]
const out = () => page.locator('[aria-label="Program output"]').innerText()
const runBtn = () => page.getByRole('button', { name: 'Run', exact: true })

async function sampler() {
  await page.evaluate(() => {
    window.__s = []; window.__t0 = performance.now(); clearInterval(window.__timer)
    window.__timer = setInterval(() => {
      const el = document.querySelector('[data-phase]')
      const sect = document.querySelector('section[aria-label="Console"]')
      window.__s.push({ t: Math.round(performance.now()-window.__t0), present: !!el,
        phase: el?.getAttribute('data-phase') ?? null,
        text: el ? el.innerText.replace(/\s+/g,' ').trim() : '',
        state: sect?.getAttribute('data-state') ?? null })
    }, 100)
  })
}
const stop = () => page.evaluate(() => { clearInterval(window.__timer); return window.__s })
function analyse(s) {
  const prep = s.filter(x => x.state === 'preparing')
  let absent=0, run=0; for (const x of prep) { run = x.present?0:run+100; absent=Math.max(absent,run) }
  let st=0, cur=0, last=null
  for (const x of prep) { if (x.present && x.text===last) cur+=100; else { cur=0; last=x.present?x.text:null } st=Math.max(st,cur) }
  return { prepMs: prep.length*100, absent, staticGap: st,
    phases: [...new Set(prep.filter(x=>x.present).map(x=>x.phase))],
    texts: [...new Set(prep.filter(x=>x.present).map(x=>x.text))] }
}

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 })
await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
await page.waitForSelector('[role="tab"]')

// --- COLD
await sampler()
let t = Date.now()
await runBtn().click()
await page.waitForFunction(() => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Your name:'), null, { timeout: 240000 })
const coldMs = Date.now()-t
const cold = analyse(await stop())
console.log(`COLD  Run->prompt ${(coldMs/1000).toFixed(1)}s | preparing ${cold.prepMs}ms | blank ${cold.absent}ms | STATIC ${cold.staticGap}ms | phases ${JSON.stringify(cold.phases)}`)
cold.texts.forEach(x => console.log('   text:', x.slice(0,120)))
await page.locator('[aria-label="Program input"]').fill('x')
await page.locator('[aria-label="Program input"]').press('Enter')
await page.waitForFunction(() => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Finished'), null, { timeout: 60000 })

// --- SECOND RUN in the same session. The Run/Stop control ignores taps for
// SWAP_GUARD_MS (250ms) after it swaps role, so wait past that first.
await page.waitForTimeout(600)
await sampler()
t = Date.now()
await runBtn().click()
await page.waitForFunction(() => !document.querySelector('[aria-label="Program output"]')?.innerText.includes('Hello,'), null, { timeout: 30000 })
const clearedMs = Date.now()-t
await page.waitForFunction(() => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Your name:'), null, { timeout: 240000 })
const secondMs = Date.now()-t
const second = analyse(await stop())
console.log(`SECOND Run->prompt ${(secondMs/1000).toFixed(1)}s (buffer cleared after ${clearedMs}ms) | preparing ${second.prepMs}ms | blank ${second.absent}ms | STATIC ${second.staticGap}ms | phases ${JSON.stringify(second.phases)}`)
second.texts.forEach(x => console.log('   text:', x.slice(0,120)))
await ctx.close()
