/* The two cases the founder called unacceptable:
 *   1. a cold first Run sitting on "Output will appear here…" with no progress
 *   2. reloading the page and paying the whole engine warm-up again
 * Persistent Chrome profile, so IndexedDB and the HTTP cache survive the
 * reload exactly like a student's would. */
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedStarter } from './lib/seed.mjs'

const URL = process.env.APP_URL || 'http://localhost:8086/'
const profile = process.env.PROFILE || mkdtempSync(join(tmpdir(), 'warsha-refresh-'))

const ctx = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROME,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

const out = () => page.locator('[aria-label="Program output"]').innerText().catch(() => '')
const runBtn = () => page.getByRole('button', { name: /^Run\b/ })

/** Waits for `text`, sampling the console so we can prove what was on screen. */
async function waitFor(text, ms) {
  const end = Date.now() + ms
  const seen = new Set()
  let placeholderMs = 0
  let last = Date.now()
  while (Date.now() < end) {
    const t = await out()
    const now = Date.now()
    if (t.includes('Output will appear here')) placeholderMs += now - last
    last = now
    for (const line of t.split('\n')) {
      const s = line.trim()
      if (s && s.length < 80) seen.add(s)
    }
    if (t.includes(text)) return { ok: true, seen, placeholderMs }
    await page.waitForTimeout(100)
  }
  return { ok: false, seen, placeholderMs }
}

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
if (await page.getByRole('button', { name: /New from a starter/ }).count()) {
  await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
  await page.waitForTimeout(2500)
}

let t = Date.now()
await runBtn().click()
const r1 = await waitFor('Your name', 180000)
console.log(`COLD  first run         : ${((Date.now() - t) / 1000).toFixed(1)}s ${r1.ok ? '' : '(NO OUTPUT)'}`)
console.log(`      placeholder shown : ${(r1.placeholderMs / 1000).toFixed(1)}s   <- must be ~0`)
console.log(`      on screen meanwhile: ${[...r1.seen].slice(0, 8).join(' | ')}`)

await page.keyboard.press('Escape')
await page.waitForTimeout(1500)

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
t = Date.now()
await runBtn().click()
const r2 = await waitFor('Your name', 180000)
console.log(`RELOAD -> Run, no edits : ${((Date.now() - t) / 1000).toFixed(1)}s ${r2.ok ? '' : '(NO OUTPUT)'}`)

await ctx.close()
