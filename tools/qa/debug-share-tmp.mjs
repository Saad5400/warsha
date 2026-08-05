import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:8093/'
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-dbg-')), {
  executablePath: process.env.CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/$/, '') })
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })

const opfsDump = () => page.evaluate(async () => {
  const out = {}
  const root = await navigator.storage.getDirectory()
  const projects = await (await root.getDirectoryHandle('warsha')).getDirectoryHandle('projects')
  for await (const entry of projects.values()) {
    if (entry.kind !== 'directory') continue
    const manifest = await (await (await entry.getFileHandle('manifest.json')).getFile()).text()
    const files = {}
    const filesDir = await entry.getDirectoryHandle('files').catch(() => null)
    if (filesDir) {
      for await (const f of filesDir.values()) {
        if (f.kind === 'file') files[f.name] = (await (await f.getFile()).text()).slice(0, 40)
      }
    }
    out[entry.name.slice(0, 8)] = { name: JSON.parse(manifest).name, files }
  }
  return out
})

await page.goto(BASE)
await page.waitForSelector('button:has-text("New from a starter")', { timeout: 60000 })
await seedStarter(page, { lang: 'Python', name: 'Python basics' })
await page.waitForSelector('.cm-content', { timeout: 30000 })

await page.getByRole('button', { name: 'More', exact: true }).click()
await page.getByRole('menuitem', { name: /Share project as link/ }).click()
await page.waitForTimeout(1500)
const link = await page.evaluate(() => navigator.clipboard.readText())
console.log('LINK len', link.length)

await page.evaluate((url) => { location.href = url }, link)
await page.waitForTimeout(2500)

await page.locator('.cm-content').click()
await page.keyboard.type('# edited\n')
await page.waitForTimeout(1200)
console.log('OPFS after edit:', JSON.stringify(await opfsDump(), null, 1))

await page.evaluate((url) => { location.href = url }, link)
await page.waitForTimeout(3500)
console.log('OPFS after reopen:', JSON.stringify(await opfsDump(), null, 1))
console.log('top bar:', (await page.locator('.top-bar').innerText()).replace(/\s+/g, ' '))
await ctx.close()
