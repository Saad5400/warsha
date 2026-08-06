/* Failure injection: what a student sees when things go wrong.
 *
 * The other suites prove the happy paths work. This one breaks things on
 * purpose — blocks the CDNs, kills workers from outside their own kill path,
 * makes OPFS throw, feeds the importer a zip bomb — and asserts that every
 * failure ends in a sentence a student can act on, with the app still usable
 * and Run still working without a page reload.
 *
 * Each scenario gets its OWN browser context. Storage state, service workers and
 * route handlers all leak between pages otherwise, and a suite whose scenarios
 * can contaminate each other is worse than no suite: the failures it reports are
 * not the ones it names.
 *
 *   WARSHA_URL    base URL of a SERVED BUILD  (default http://127.0.0.1:8086/)
 *   WARSHA_SHOTS  where screenshots land      (default tools/qa/screenshots/)
 *   CHROME        Chrome binary               (default /usr/bin/google-chrome)
 *   WARSHA_JAVA   set to 0 to skip the two Java scenarios (they cost ~60s)
 *
 * 127.0.0.1 rather than localhost deliberately: a preview server bound to IPv4
 * only is unreachable via "localhost" when Chrome resolves it to ::1 first. */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { seedStarter } from './lib/seed.mjs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const RUN_JAVA = process.env.WARSHA_JAVA !== '0'
mkdirSync(SHOTS, { recursive: true })

const results = []
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const info = (m) => console.log(`      ${m}`)
const check = (ok, n, d = '') => (ok ? pass(n, d) : fail(n, d))

/** The two third-party origins the engines cannot work without. */
const PYODIDE_CDN = '**://cdn.jsdelivr.net/**'
const CHEERPJ_CDN = '**://cjrtnc.leaningtech.com/**'

/**
 * One scenario, one browser context.
 * `before` runs pre-navigation — the only point where addInitScript/route
 * can catch the app's own startup.
 */
async function scenario(name, { before, body }) {
  console.log(`\n--- ${name} ---`)
  const dir = mkdtempSync(join(tmpdir(), 'warsha-robust-'))
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  try {
    if (before) await before(page, ctx)
    await body(page, ctx, consoleErrors)
  } catch (e) {
    fail(`${name} (scenario threw)`, String(e && e.stack ? e.stack.split('\n')[0] : e))
    await page.screenshot({ path: `${SHOTS}/robust-${slug(name)}-threw.png` }).catch(() => {})
  } finally {
    await ctx.close().catch(() => {})
  }
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Record every Worker the page constructs, so a test can kill one. */
const WORKER_SPY = `
  window.__warshaWorkers = []
  const Native = window.Worker
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args)
      window.__warshaWorkers.push(this)
    }
  }
`

/** Make every OPFS write reject, the way a full disk does. */
const BREAK_OPFS_WRITES = `
  const proto = window.FileSystemFileHandle && window.FileSystemFileHandle.prototype
  if (proto && proto.createWritable) {
    proto.createWritable = async function () {
      const e = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      throw e
    }
  }
`

/** Make OPFS itself unreachable, the way Safari private browsing does. */
const BREAK_OPFS_ENTIRELY = `
  Object.defineProperty(navigator.storage, 'getDirectory', {
    configurable: true,
    value: async () => { throw new DOMException('not allowed', 'SecurityError') },
  })
`

// Prefix match: the accessible name includes the file, e.g. "Run main.py".
const runBtn = (page) => page.getByRole('button', { name: /^Run\b/ }).first()
const outputText = (page) => page.locator('[aria-label="Program output"]').innerText()
const failureBlock = (page) => page.locator('[data-failure]')

/**
 * Waits until Run is enabled, not just `.cm-content` — the editor can mount
 * from React state before the project's files exist in storage.
 */
async function waitForRunnable(page) {
  await page.waitForSelector('.cm-content', { timeout: 20000 })
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll('button')].find((b) => /^Run\b/.test(b.getAttribute('aria-label') ?? ''))
      return !!btn && !btn.disabled
    },
    null,
    { timeout: 20000 },
  )
}

/**
 * Without isolation, Python's load() rejects with a misleading error, which
 * flaked network scenarios ~1 in 3 runs. The service worker's first reload
 * doesn't always stick, so give it a second push.
 */
async function openApp(page) {
  await page.goto(BASE, { waitUntil: 'load' })
  const isolated = () =>
    page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 30000 })
      .then(() => true)
      .catch(() => false)
  if (await isolated()) return
  await page.reload({ waitUntil: 'load' })
  if (!(await isolated())) info('WARNING: page is not cross-origin isolated; Python results are unreliable')
}

async function startPythonProject(page) {
  await openApp(page)
  await seedStarter(page, { name: 'Python (OOP starter)' })
  await waitForRunnable(page)
}

async function startJavaProject(page) {
  await openApp(page)
  await seedStarter(page, { lang: 'Java', name: 'Java (OOP starter)' })
  await waitForRunnable(page)
}

/**
 * Click a project-scoped action via the File menu. Below 1050px the bar
 * collapses into a single ☰ "Application Menu" trigger (VS Code parity).
 */
async function clickProjectMenu(page, nameRe) {
  const wide = await page.evaluate(() => matchMedia('(min-width: 1050px)').matches)
  if (!wide) {
    await page.getByRole('button', { name: 'Application Menu' }).click()
    await page.waitForSelector('[role="menu"]', { timeout: 5000 })
    await page.getByRole('menuitem', { name: 'File', exact: true }).hover()
    await page.waitForFunction(() => document.querySelectorAll('[role="menu"]').length >= 2, null, { timeout: 5000 })
  } else {
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.waitForSelector('[role="menu"]', { timeout: 5000 })
  }
  await page.getByRole('menuitem', { name: nameRe }).first().click()
}

/** Replace the whole active file. */
async function typeProgram(page, source) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type(source)
  await page.waitForTimeout(700) // past the 350ms debounce
}

// ---------------------------------------------------------------------------
// A minimal ZIP writer — archives here are deliberately malformed, so hand-
// building them (not fflate) is the point.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c
  const table = crc32.table ?? (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  }))
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * `entries`: `[{name,data}]` (stored) or `[{name,deflated,originalSize,crc}]`
 * for a pre-compressed entry — how the bomb declares a size far bigger than its bytes.
 */
function makeZip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, 'utf8')
    const deflated = e.deflated ?? null
    const body = deflated ?? e.data
    const method = deflated ? 8 : 0
    const originalSize = e.originalSize ?? e.data.length
    const sum = e.crc ?? crc32(e.data ?? Buffer.alloc(0))

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(originalSize, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    chunks.push(local, nameBytes, body)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(method, 10)
    cd.writeUInt32LE(sum, 16)
    cd.writeUInt32LE(body.length, 20)
    cd.writeUInt32LE(originalSize, 24)
    cd.writeUInt16LE(nameBytes.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBytes)

    offset += local.length + nameBytes.length + body.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

/** Open the import dialog and hand it a buffer as a .zip. */
async function importBuffer(page, name, buffer) {
  await page.getByRole('button', { name: /Import a \.zip|Import \.zip/ }).first().click()
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 5000 })
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/zip', buffer })
  // Ready-line or error settles quickly, except the deliberately oversized
  // cases — hence the timeout.
  await page.waitForTimeout(2500)
}

// ===========================================================================
// 1. The Pyodide CDN is unreachable when the student presses Run.
// ===========================================================================
await scenario('python engine CDN unreachable', {
  before: async (page, ctx) => {
    // ctx.route, not page.route — the service worker's own fetches are
    // outside the page's route table.
    await ctx.route(PYODIDE_CDN, (route) => route.abort('connectionfailed'))
  },
  body: async (page, ctx, consoleErrors) => {
    await startPythonProject(page)
    await runBtn(page).click()

    const block = failureBlock(page)
    await block.waitFor({ timeout: 90000 }).catch(() => {})
    const shown = await block.count()
    check(shown > 0, 'blocked CDN produces a failure block, not a spinner')
    if (shown > 0) {
      const kind = await block.getAttribute('data-failure')
      const text = await block.innerText()
      info(`kind=${kind} :: ${text.replace(/\n/g, ' | ').slice(0, 200)}`)
      check(kind === 'offline', 'failure is classified as offline', `data-failure=${kind}`)
      check(
        !/TypeError|Failed to fetch|stack|\bat \w+\./.test(text.split('Details')[0]),
        'headline carries no engine jargon',
      )
      check(/Try again/.test(text), 'a Try again action is offered')
    }

    // Not busy any more: the control is back to Run, so a student is not stuck.
    const runVisible = await runBtn(page).count()
    check(runVisible > 0, 'Run is available again after the failure')

    // The rest of the IDE is untouched.
    await page.locator('.cm-content').click()
    await page.keyboard.type('# still editable')
    const editorText = await page.locator('.cm-content').innerText()
    check(editorText.includes('# still editable'), 'editor still works while the engine is unreachable')

    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'no unhandled rejection', unhandled.slice(0, 3).join(' | '))

    await page.screenshot({ path: `${SHOTS}/robust-cdn-blocked.png` })

    // ---- and now the recovery: unblock, press the block's own button ----
    await ctx.unroute(PYODIDE_CDN)
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    const recovered = await page
      .waitForFunction(
        () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Your name:'),
        null,
        { timeout: 180000 },
      )
      .then(() => true)
      .catch(() => false)
    check(recovered, 'Try again runs for real once the network is back')
    if (!recovered) info((await outputText(page)).slice(-300))
    check(consoleErrors.filter((e) => !/favicon|jsdelivr|net::|Failed to fetch/i.test(e)).length === 0,
      'no unexpected console errors', consoleErrors.slice(0, 3).join(' | '))
  },
})

// ===========================================================================
// 2. The download dies part-way through (the wasm blob, specifically).
// ===========================================================================
await scenario('python download aborted mid-flight', {
  before: async (page, ctx) => {
    // Drops after the loader starts — not a site that was never reached.
    await ctx.route('**/pyodide.asm.wasm', (route) => route.abort('connectionreset'))
  },
  body: async (page) => {
    await startPythonProject(page)
    await runBtn(page).click()
    const appeared = await failureBlock(page).waitFor({ timeout: 120000 }).then(() => true).catch(() => false)
    check(appeared, 'a dropped download ends in a failure block')
    if (appeared) info(`kind=${await failureBlock(page).getAttribute('data-failure')}`)
    const stuck = await page.getByRole('button', { name: /^Stop\b/ }).count()
    check(stuck === 0, 'the control is no longer stuck on Stop')
    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'no unhandled rejection on a dropped download', unhandled.slice(0, 3).join(' | '))
  },
})

// ===========================================================================
// 3. The Java engine's CDN is unreachable. Different origin, different loader
//    (importScripts inside a classic worker), so it is genuinely a second case.
// ===========================================================================
if (RUN_JAVA) {
  await scenario('java engine CDN unreachable', {
    before: async (page, ctx) => {
      await ctx.route(CHEERPJ_CDN, (route) => route.abort('connectionfailed'))
    },
    body: async (page) => {
      await startJavaProject(page)
      await runBtn(page).click()
      const appeared = await failureBlock(page).waitFor({ timeout: 120000 }).then(() => true).catch(() => false)
      check(appeared, 'blocked CheerpJ CDN produces a failure block')
      if (appeared) {
        const text = await failureBlock(page).innerText()
        info(text.replace(/\n/g, ' | ').slice(0, 200))
        check(/Java/.test(text), 'the message names Java, not "the language engine"')
        check(/Try again/.test(text), 'a Try again action is offered')
      }
      const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
      check(unhandled.length === 0, 'no unhandled rejection (java)', unhandled.slice(0, 3).join(' | '))
      await page.screenshot({ path: `${SHOTS}/robust-java-cdn-blocked.png` })
    },
  })
}

// ===========================================================================
// 4. The worker dies mid-run, killed from outside its own kill path.
//    This is the iPad memory-reclaim case, which fires no event at all.
// ===========================================================================
await scenario('worker terminated mid-run', {
  before: async (page) => {
    await page.addInitScript(WORKER_SPY)
  },
  body: async (page) => {
    await startPythonProject(page)
    await typeProgram(page, 'import time\nfor i in range(1000): print("tick", i); time.sleep(0.05)')
    await runBtn(page).click()
    await page.waitForFunction(
      () => (document.querySelector('[aria-label="Program output"]')?.innerText.match(/tick/g) || []).length > 3,
      null,
      { timeout: 180000 },
    )
    pass('program is running before the kill')

    // Straight past kill(), the way the browser does it.
    const killed = await page.evaluate(() => {
      const w = window.__warshaWorkers
      if (!w || !w.length) return false
      w[w.length - 1].terminate()
      return true
    })
    check(killed, 'worker terminated from outside the engine')

    await page.waitForTimeout(1500)
    const stillRunning = await page.getByRole('button', { name: /^Stop\b/ }).count()
    info(`control shows Stop: ${stillRunning > 0} (expected — nothing tells the page its worker died)`)

    // Stop must always get the student out, even with no onExit ever coming.
    if (stillRunning > 0) await page.getByRole('button', { name: /^Stop\b/ }).first().click()
    const recovered = await page
      .waitForFunction(
        () => {
          // Tab-strip Run names its file ("Run main.py") — prefix, not equality.
          const btn = [...document.querySelectorAll('button')].find((b) => /^Run\b/.test(b.getAttribute('aria-label') ?? ''))
          return !!btn && !btn.disabled
        },
        null,
        { timeout: 10000 },
      )
      .then(() => true)
      .catch(() => false)
    check(recovered, 'Stop ends the session even with no onExit from the engine')

    // Transcript flushes on an animation frame — may land a beat after Run reappears.
    const said = await page
      .waitForFunction(
        () => /stopped responding|Stopped\./.test(
          document.querySelector('[aria-label="Program output"]')?.innerText ?? '',
        ),
        null,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false)
    check(said, 'the session ended with something visible', (await outputText(page)).slice(-160))

    // And the whole point: Run works again, no reload.
    await typeProgram(page, 'print("alive again")')
    await runBtn(page).click()
    const ranAgain = await page
      .waitForFunction(
        () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('alive again'),
        null,
        { timeout: 180000 },
      )
      .then(() => true)
      .catch(() => false)
    check(ranAgain, 'Run works again after a worker death, with no page reload')
    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'no unhandled rejection after a worker death', unhandled.slice(0, 3).join(' | '))
    await page.screenshot({ path: `${SHOTS}/robust-worker-death.png` })
  },
})

// ===========================================================================
// 5. OPFS writes start failing (a full disk).
// ===========================================================================
await scenario('OPFS writes fail', {
  body: async (page) => {
    await startPythonProject(page)
    // Broken AFTER the project exists — storage filled up mid-session, not missing from the start.
    await page.evaluate(BREAK_OPFS_WRITES)
    await typeProgram(page, 'print("this edit cannot be saved")')

    const banner = page.locator('.storage-banner[data-notice="write-failed"]')
    const shown = await banner.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    check(shown, 'a failing write raises the persistent banner')
    if (shown) {
      const text = await banner.innerText()
      info(text.replace(/\n/g, ' | '))
      check(/zip/i.test(text), 'the banner tells the student how to keep their work')
      check((await banner.getAttribute('data-tone')) === 'danger', 'the banner is in the danger tone')
    }

    // Not a toast: still there after the student ignores it for a while.
    await page.waitForTimeout(3000)
    check(await banner.count() > 0, 'the banner is persistent, not a toast')

    // The edit is still on screen and still runnable.
    const editorText = await page.locator('.cm-content').innerText()
    check(editorText.includes('cannot be saved'), 'the edit is not lost from the editor')

    const dirty = await page.locator('[role="tab"] .dot-dirty, [role="tab"] [data-dirty="true"]').count()
    info(`dirty markers visible: ${dirty}`)

    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'a failed write is not an unhandled rejection', unhandled.slice(0, 3).join(' | '))
    await page.screenshot({ path: `${SHOTS}/robust-opfs-write-fail.png` })
  },
})

// ===========================================================================
// 6. OPFS is not available at all (Safari private browsing).
// ===========================================================================
await scenario('OPFS unavailable at startup', {
  before: async (page) => {
    await page.addInitScript(BREAK_OPFS_ENTIRELY)
  },
  body: async (page) => {
    await page.goto(BASE, { waitUntil: 'load' })
    const loaded = await page
      .waitForSelector('button:has-text("New from a starter"), .cm-content', { timeout: 30000 })
      .then(() => true)
      .catch(() => false)
    check(loaded, 'the IDE still loads with no usable storage')

    const crashed = await page.locator('[data-crash="true"]').count()
    check(crashed === 0, 'no crash screen')

    const banner = page.locator('.storage-banner[data-notice="memory-only"]')
    const shown = await banner.waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
    check(shown, 'the student is told their work will not survive the tab')
    if (shown) info((await banner.innerText()).replace(/\n/g, ' | '))

    // And it is a working IDE, not a read-only shell.
    await seedStarter(page, { name: 'Python (OOP starter)' })
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await typeProgram(page, 'print("memory only")')
    const editorText = await page.locator('.cm-content').innerText()
    check(editorText.includes('memory only'), 'files can still be created and edited in memory')
    await page.screenshot({ path: `${SHOTS}/robust-no-storage.png` })
  },
})

// ===========================================================================
// 7. The remembered project is gone — iOS eviction, or another tab deleting it.
// ===========================================================================
await scenario('remembered project has vanished', {
  body: async (page) => {
    await startPythonProject(page)
    // Mimics iOS: wipes OPFS but leaves localStorage, so prefs point at a dead
    // project id. Reload happens in the same task as the wipe — a setPrefs
    // call in between would overwrite the injected id with the real one from
    // prefs()'s module-level cache.
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      // A debounced save may still be in flight, holding a lock that makes
      // removeEntry throw — retry until a full sweep hits nothing mid-write.
      for (let attempt = 0; attempt < 20; attempt++) {
        let locked = false
        for await (const [name] of root.entries()) {
          try {
            await root.removeEntry(name, { recursive: true })
          } catch {
            locked = true
          }
        }
        if (!locked) break
        await new Promise((r) => setTimeout(r, 250))
      }
      location.reload()
    })
    await page.waitForLoadState('load')

    const loaded = await page
      .waitForSelector('.cm-content, button:has-text("New from a starter")', { timeout: 30000 })
      .then(() => true)
      .catch(() => false)
    check(loaded, 'the app opens something rather than crash-looping on a missing id')
    check((await page.locator('[data-crash="true"]').count()) === 0, 'no crash screen after eviction')

    const banner = page.locator('.storage-banner[data-notice="evicted"]')
    const shown = await banner.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    check(shown, 'the student is told the project was reopened elsewhere')
    if (shown) info((await banner.innerText()).replace(/\n/g, ' | '))
  },
})

// ===========================================================================
// 8. Two tabs at once.
// ===========================================================================
await scenario('open in two tabs', {
  body: async (page, ctx) => {
    await startPythonProject(page)
    const second = await ctx.newPage()
    await second.goto(BASE, { waitUntil: 'load' })
    await second.waitForSelector('.cm-content, button:has-text("New from a starter")', { timeout: 30000 })

    const advisory = second.locator('.storage-banner[data-notice="multi-tab"]')
    const shown = await advisory.waitFor({ timeout: 8000 }).then(() => true).catch(() => false)
    check(shown, 'the second tab says Warsha is already open elsewhere')
    if (shown) info((await advisory.innerText()).replace(/\n/g, ' | '))

    // Advisory, not a lock-out: the second tab must still be a working IDE.
    await second.locator('.cm-content').click()
    await second.keyboard.press('Control+a')
    await second.keyboard.type('print("second tab works")')
    await second.waitForTimeout(700)
    const text = await second.locator('.cm-content').innerText()
    check(text.includes('second tab works'), 'the second tab is fully usable')

    // Both tabs writing the same OPFS project: last write wins, nothing breaks.
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('print("first tab wins")')
    await page.waitForTimeout(900)
    check((await page.locator('[data-crash="true"]').count()) === 0, 'concurrent writes do not crash tab one')
    check((await second.locator('[data-crash="true"]').count()) === 0, 'concurrent writes do not crash tab two')
    const errs = await second.evaluate(() => window.__warshaErrors ?? [])
    check(errs.length === 0, 'concurrent writes raise no unhandled rejection', errs.slice(0, 3).join(' | '))
    await second.screenshot({ path: `${SHOTS}/robust-two-tabs.png` })
  },
})

// ===========================================================================
// 9. Hostile and awkward .zip imports.
// ===========================================================================
await scenario('zip import edge cases', {
  body: async (page) => {
    await page.goto(BASE, { waitUntil: 'load' })
    await page.waitForSelector('button:has-text("Import")', { timeout: 20000 })

    const problem = () => page.locator('[role="alert"]').first()

    // --- a zip bomb: 96 MB of zeros in about 100 kB on disk ---
    const zeros = Buffer.alloc(96 * 1024 * 1024)
    const bomb = makeZip([
      { name: 'boom.txt', deflated: deflateRawSync(zeros), originalSize: zeros.length, crc: crc32(zeros) },
    ])
    info(`bomb archive is ${Math.round(bomb.length / 1024)} kB and declares ${zeros.length} bytes`)
    const t0 = Date.now()
    await importBuffer(page, 'bomb.zip', bomb)
    const bombMs = Date.now() - t0
    const bombText = (await problem().count()) ? await problem().innerText() : ''
    info(`bomb: ${bombMs}ms :: ${bombText}`)
    check(bombText.length > 0, 'a zip bomb is refused with a message', bombText)
    check(bombMs < 20000, 'the refusal is fast — nothing was inflated', `${bombMs}ms`)
    check((await page.locator('[data-crash="true"]').count()) === 0, 'the zip bomb did not take the tab down')

    // --- path traversal and a binary file, alongside a real one ---
    const mixed = makeZip([
      { name: 'main.py', data: Buffer.from('print("ok")\n') },
      { name: '../escape.py', data: Buffer.from('print("nope")\n') },
      { name: 'app/../../also-escape.py', data: Buffer.from('print("nope")\n') },
      { name: 'logo.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01, 0x02]) },
    ])
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('button:has-text("Import")', { timeout: 20000 })
    await importBuffer(page, 'mixed.zip', mixed)
    const dialogText = await page.locator('form').innerText()
    info(`mixed: ${dialogText.replace(/\n/g, ' | ')}`)
    check(/1 file ready to import/.test(dialogText), 'only the safe text file is accepted', dialogText.slice(0, 160))
    check(/left out/.test(dialogText), 'the skipped entries are named, not swallowed')

    // --- an oversized archive, refused before a byte is read ---
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('button:has-text("Import")', { timeout: 20000 })
    await page.getByRole('button', { name: /Import a \.zip|Import \.zip/ }).first().click()
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 5000 })
    // Path, not buffer — Playwright refuses in-memory files over 50MB, which
    // is the limit under test.
    const bigPath = join(mkdtempSync(join(tmpdir(), 'warsha-big-')), 'huge.zip')
    writeFileSync(bigPath, Buffer.alloc(55 * 1024 * 1024))
    const bigT0 = Date.now()
    await page.locator('input[type="file"]').setInputFiles(bigPath)
    await page.waitForTimeout(2000)
    const bigMs = Date.now() - bigT0
    const bigText = (await problem().count()) ? await problem().innerText() : ''
    info(`oversize: ${bigMs}ms :: ${bigText}`)
    check(/MB/.test(bigText), 'an oversized .zip is refused by size', bigText)
    check((await page.locator('[data-crash="true"]').count()) === 0, 'the oversized file did not take the tab down')

    // --- garbage that is not a zip at all ---
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('button:has-text("Import")', { timeout: 20000 })
    await importBuffer(page, 'lies.zip', Buffer.from('this is not a zip file, it is a sentence'))
    const junkText = (await problem().count()) ? await problem().innerText() : ''
    info(`garbage: ${junkText}`)
    check(junkText.length > 0, 'a corrupt .zip is refused with a message', junkText)

    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'no unhandled rejection from any bad import', unhandled.slice(0, 3).join(' | '))
    await page.screenshot({ path: `${SHOTS}/robust-zip-edge-cases.png` })
  },
})

// ===========================================================================
// 10. A 500-file project: the explorer, the editor and export must survive.
// ===========================================================================
await scenario('500-file project', {
  body: async (page) => {
    const many = makeZip(
      Array.from({ length: 500 }, (_, i) => ({
        name: `pkg${String(i % 25).padStart(2, '0')}/mod${String(i).padStart(3, '0')}.py`,
        data: Buffer.from(`# module ${i}\nVALUE_${i} = ${i}\n`),
      })).concat([{ name: 'main.py', data: Buffer.from('print("five hundred")\n') }]),
    )
    await page.goto(BASE, { waitUntil: 'load' })
    await page.waitForSelector('button:has-text("Import")', { timeout: 20000 })
    const t0 = Date.now()
    await importBuffer(page, 'many.zip', many)
    await page.getByRole('button', { name: /^(Import|Replace files)$/ }).click()
    await page.waitForSelector('.cm-content', { timeout: 60000 })
    const importMs = Date.now() - t0
    info(`import + first paint: ${importMs}ms`)
    check(importMs < 60000, 'a 501-file import completes (sluggish is fine, frozen is not)', `${importMs}ms`)
    check((await page.locator('[data-crash="true"]').count()) === 0, 'no crash on 501 files')

    // The explorer is still interactive.
    const rows = await page.locator('[role="treeitem"]').count()
    info(`explorer rows rendered: ${rows}`)
    check(rows > 0, 'the explorer rendered the tree', `${rows} rows`)

    // Export is the escape hatch every storage warning points at — must work
    // on the biggest project.
    const exportT0 = Date.now()
    const download = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
    await clickProjectMenu(page, /Export as \.zip/)
    const got = await download
    const exportMs = Date.now() - exportT0
    info(`export: ${exportMs}ms, download=${got ? got.suggestedFilename() : 'none'}`)
    check(!!got, 'zip export of a 501-file project produced a download', `${exportMs}ms`)

    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'no unhandled rejection at 501 files', unhandled.slice(0, 3).join(' | '))
    await page.screenshot({ path: `${SHOTS}/robust-500-files.png` })
  },
})

// ===========================================================================
// 11. A runaway program: the console must stay bounded and Stop must respond.
// ===========================================================================
await scenario('runaway output stays bounded', {
  body: async (page) => {
    await startPythonProject(page)
    // No newline — grows ONE line, the case a line cap exists for (Java has
    // no engine-side limit).
    await typeProgram(page, 'while True: print("x" * 400, end="")')
    await runBtn(page).click()
    await page.waitForTimeout(15000)

    const before = await page.evaluate(() => ({
      rows: document.querySelectorAll('.console-row').length,
      chars: document.querySelector('[aria-label="Program output"]')?.innerText.length ?? 0,
    }))
    info(`after 15s: ${before.rows} rows in the DOM, ${before.chars} characters on screen`)
    check(before.rows <= 1300, 'the render window holds', `${before.rows} rows`)
    check(before.chars < 30_000_000, 'the transcript is bounded', `${before.chars} chars`)

    const stopT0 = Date.now()
    await page.getByRole('button', { name: /^Stop\b/ }).click()
    const stopped = await page
      .waitForFunction(
        () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('Stopped'),
        null,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false)
    check(stopped, 'Stop responds while output is streaming', `${Date.now() - stopT0}ms`)

    await typeProgram(page, 'print("recovered")')
    await runBtn(page).click()
    const ok = await page
      .waitForFunction(
        () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('recovered'),
        null,
        { timeout: 120000 },
      )
      .then(() => true)
      .catch(() => false)
    check(ok, 'Run works again after a runaway program')
    await page.screenshot({ path: `${SHOTS}/robust-runaway.png` })
  },
})

// ===========================================================================
// 12. A long session: many consecutive runs, no leak, no drift.
// ===========================================================================
await scenario('long session: 12 consecutive runs', {
  before: async (page) => {
    await page.addInitScript(WORKER_SPY)
  },
  body: async (page) => {
    await startPythonProject(page)
    await typeProgram(page, 'print("run marker")')
    await runBtn(page).click()
    await page.waitForFunction(
      () => document.querySelector('[aria-label="Program output"]')?.innerText.includes('run marker'),
      null,
      { timeout: 180000 },
    )
    const heapAt = async () =>
      page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0))
    const firstHeap = await heapAt()

    let completed = 1
    for (let i = 2; i <= 12; i++) {
      await typeProgram(page, `print("run ${i} done")`)
      await runBtn(page).click()
      const ok = await page
        .waitForFunction(
          (n) => document.querySelector('[aria-label="Program output"]')?.innerText.includes(`run ${n} done`),
          i,
          { timeout: 120000 },
        )
        .then(() => true)
        .catch(() => false)
      if (!ok) break
      completed++
    }
    check(completed === 12, 'twelve consecutive runs all completed', `${completed}/12`)

    const lastHeap = await heapAt()
    const workers = await page.evaluate(() => (window.__warshaWorkers ?? []).length)
    info(`workers constructed across the session: ${workers}`)
    info(`heap ${Math.round(firstHeap / 1e6)}MB -> ${Math.round(lastHeap / 1e6)}MB`)
    // One worker per engine, reused across runs — twelve clean runs shouldn't build twelve.
    check(workers <= 4, 'workers are reused across runs, not leaked', `${workers} constructed`)
    if (firstHeap > 0) {
      check(lastHeap < firstHeap * 3 + 50e6, 'heap did not grow without bound',
        `${Math.round(firstHeap / 1e6)}MB -> ${Math.round(lastHeap / 1e6)}MB`)
    } else {
      info('performance.memory unavailable; heap growth not asserted')
    }
    const unhandled = await page.evaluate(() => window.__warshaErrors ?? [])
    check(unhandled.length === 0, 'no unhandled rejection across a long session', unhandled.slice(0, 3).join(' | '))
  },
})

// ===========================================================================
// 13. CheerpJ's /files/ is IndexedDB-backed and survives reloads. Prove a
//     deleted class cannot ghost-run from a stale .class across a reload.
// ===========================================================================
if (RUN_JAVA) {
  await scenario('deleted java class cannot ghost-run after a reload', {
    body: async (page) => {
      await startJavaProject(page)
      await runBtn(page).click()
      const ran = await page
        .waitForFunction(
          () => /Your name:|Warsha/.test(document.querySelector('[aria-label="Program output"]')?.innerText ?? ''),
          null,
          { timeout: 300000 },
        )
        .then(() => true)
        .catch(() => false)
      check(ran, 'the Java starter compiled and ran once (so .class files exist in /files/)')
      if (!ran) {
        info((await outputText(page)).slice(-400))
        return
      }
      await page.getByRole('button', { name: /^Stop\b/ }).click().catch(() => {})
      await page.waitForTimeout(800)

      // Reload rebuilds the JVM from persisted /files/ — the exact condition
      // a stale .class needs.
      const deleted = await page.evaluate(async () => {
        const item = [...document.querySelectorAll('[role="treeitem"]')].find((el) =>
          /Person\.java|Student\.java/.test(el.textContent ?? ''),
        )
        return item ? (item.textContent ?? '').trim() : null
      })
      info(`deleting: ${deleted}`)
      if (!deleted) {
        fail('found a model class to delete', 'no Person.java/Student.java row in the explorer')
        return
      }
      const row = page.locator('[role="treeitem"]', { hasText: /Person\.java|Student\.java/ }).first()
      await row.click({ button: 'right' })
      await page.getByRole('menuitem', { name: /Delete/ }).click()
      await page.getByRole('button', { name: /Delete/ }).last().click()
      await page.waitForTimeout(800)

      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('.cm-content', { timeout: 30000 })
      await runBtn(page).click()
      const settled = await page
        .waitForFunction(
          () => /ERROR in|cannot be resolved|Stopped early|exit code/.test(
            document.querySelector('[aria-label="Program output"]')?.innerText ?? '',
          ),
          null,
          { timeout: 300000 },
        )
        .then(() => true)
        .catch(() => false)
      const text = await outputText(page)
      info(text.slice(-500))
      check(settled, 'the run after deletion settled rather than hanging')
      check(
        /ERROR in|cannot be resolved/.test(text),
        'the deleted class is a COMPILE ERROR, not a ghost run from a stale .class',
        text.slice(-200),
      )
      await page.screenshot({ path: `${SHOTS}/robust-java-stale-class.png` })
    },
  })
}

// ---------------------------------------------------------------------- summary
const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
for (const f of failed) console.log(`FAILED: ${f[1]} :: ${f[2]}`)
process.exit(failed.length ? 1 : 0)
