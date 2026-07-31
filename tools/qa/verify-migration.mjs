/* Upgrade path: a student (or the founder) whose work lives in the pre-multi-project
 * flat OPFS root must find it intact, as a real project, with nothing lost.
 *
 * The legacy layout is seeded on a stub same-origin page so the app has never run
 * in this profile — otherwise it would create the new layout first and there would
 * be nothing to migrate. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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


const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-migrate-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

// A blank same-origin document: same OPFS, but none of the app's code.
await page.route('**/__seed', (route) =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>seed' }))
await page.goto(BASE + "__seed", { waitUntil: 'load' })

const LEGACY = {
  'main.py': 'print("work from the old single-workspace build")\n',
  'helpers/shapes.py': '# a helper the student wrote\nVALUE = 42\n',
  'notes.txt': 'not a source file, but still mine\n',
}

const seeded = await page.evaluate(async (files) => {
  const base = await navigator.storage.getDirectory()
  const root = await base.getDirectoryHandle('warsha-project', { create: true })
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/')
    const name = parts.pop()
    let dir = root
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true })
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write(content)
    await w.close()
  }
  // Prove the seed is really there before the app ever loads.
  const names = []
  for await (const e of root.values()) names.push(e.name)
  return names.sort()
}, LEGACY)
info(`seeded legacy warsha-project/: ${JSON.stringify(seeded)}`)
if (seeded.includes('main.py') && seeded.includes('helpers')) pass('legacy flat layout seeded')
else fail('legacy flat layout seeded', JSON.stringify(seeded))

await page.unroute('**/__seed')

// ------------------------------------------------------------ now open the app
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 45000 }).catch(() => {})
await page.waitForSelector('.cm-content, [aria-label="Start a project"]', { timeout: 20000 })
await page.waitForTimeout(2000)

const files = (await page.locator('[role="treeitem"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
info(`explorer after upgrade: ${JSON.stringify(files)}`)
for (const [label, needle] of [['main.py', 'main.py'], ['helpers/', 'helpers'], ['shapes.py', 'shapes.py'], ['notes.txt', 'notes.txt']]) {
  if (files.some((f) => f.includes(needle))) pass(`migrated file present: ${label}`)
  else fail(`migrated file present: ${label}`, files.join(', '))
}

await page.getByRole('button', { name: 'More', exact: true }).click()
await page.waitForSelector('[role="menu"]')
const rows = (await page.locator('[role="menuitem"]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
await page.keyboard.press('Escape')
info(`menu after upgrade: ${JSON.stringify(rows.slice(0, 3))}`)
if (rows.some((r) => /^My project.*Open$/.test(r))) pass('legacy workspace became a real, named project', 'My project')
else fail('legacy workspace became a real, named project', JSON.stringify(rows))

// Content must be byte-identical, not merely present.
const contents = await page.evaluate(async () => {
  const base = await navigator.storage.getDirectory()
  const root = await base.getDirectoryHandle('warsha')
  const projects = await root.getDirectoryHandle('projects')
  const out = {}
  let legacyStillThere = false
  try {
    await base.getDirectoryHandle('warsha-project')
    legacyStillThere = true
  } catch { /* retired, as intended */ }
  const ids = []
  for await (const e of projects.values()) if (e.kind === 'directory') ids.push(e.name)
  for (const id of ids) {
    const dir = await projects.getDirectoryHandle(id)
    const mf = await dir.getFileHandle('manifest.json')
    out.manifest = JSON.parse(await (await mf.getFile()).text())
    const filesDir = await dir.getDirectoryHandle('files')
    const read = async (d, prefix) => {
      for await (const e of d.values()) {
        const p = prefix ? `${prefix}/${e.name}` : e.name
        if (e.kind === 'directory') await read(await d.getDirectoryHandle(e.name), p)
        else out[p] = await (await (await d.getFileHandle(e.name)).getFile()).text()
      }
    }
    await read(filesDir, '')
  }
  return { out, legacyStillThere, projectCount: ids.length }
})
info(`manifest: ${JSON.stringify(contents.out.manifest)}`)
info(`legacy root still present: ${contents.legacyStillThere}`)

let identical = true
for (const [path, content] of Object.entries(LEGACY)) {
  if (contents.out[path] !== content) { identical = false; info(`  MISMATCH ${path}: ${JSON.stringify(contents.out[path])}`) }
}
if (identical) pass('every migrated file is byte-identical to the original')
else fail('every migrated file is byte-identical to the original')
if (contents.projectCount === 1) pass('migration produced exactly one project', '1')
else fail('migration produced exactly one project', String(contents.projectCount))
const m = contents.out.manifest
if (m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.createdAt === 'number' && typeof m.lastOpenedAt === 'number')
  pass('manifest has id / name / createdAt / lastOpenedAt', JSON.stringify(m))
else fail('manifest shape', JSON.stringify(m))
if (!contents.legacyStillThere) pass('legacy root retired after the copy verified')
else fail('legacy root retired after the copy verified', 'warsha-project/ still present')

// The migrated project must actually run.
await page.locator('[role="treeitem"]', { hasText: 'main.py' }).first().click()
await page.waitForTimeout(500)
await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.waitForFunction(
  () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('old single-workspace'),
  null, { timeout: 240000 })
pass('the migrated project runs', 'python executed the student\'s own file')

// And the migration must not repeat or duplicate on the next visit.
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(2000)
const after = await page.evaluate(async () => {
  const base = await navigator.storage.getDirectory()
  const projects = await (await base.getDirectoryHandle('warsha')).getDirectoryHandle('projects')
  let n = 0
  for await (const e of projects.values()) if (e.kind === 'directory') n++
  return n
})
if (after === 1) pass('migration does not repeat on the next visit', '1 project')
else fail('migration does not repeat on the next visit', `${after} projects`)

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
failed.forEach((f) => console.log(`FAILED: ${f[1]} :: ${f[2]}`))
await ctx.close()
process.exit(failed.length ? 1 : 0)
