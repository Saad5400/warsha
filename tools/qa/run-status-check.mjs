/* Run status: can a student always tell what Run is doing, and does Warsha ever
 * call a working program broken?
 *
 * Drives local Chrome against a served app, one language at a time, each in a
 * FRESH profile (so the first Run really is a cold download), and records the run
 * state every 200 ms straight off the DOM: the status bar's run-state block, the
 * console's progress block, the header's activity line, the still-running note
 * and any failure card. The checks then read that timeline.
 *
 * Cases, per language (Python, Java, C#, C):
 *   1. Stop while the language is still downloading (throttled network).
 *   2. Cold first run on a throttled network: the step is named in the status bar,
 *      something on screen changes at least every 2 s, the activity line runs,
 *      no failure — and Finished carries its time.
 *   3. Warm run: no download UI at all.
 *   4. A program printing continuously: no "still running" note; Stop mid-print.
 *   5. A program silent for 62 s then blocked in input() for 62 s, with the console
 *      collapsed meanwhile. Never reported as failed or stalled; "Still running"
 *      appears after 30 s and keeps counting; waiting reopens the console, focuses
 *      the input, drops the activity line. Python imports numpy first (an in-run
 *      package download); Java comes off a Stop, so it recompiles cold — the two
 *      cases where the old 45 s watchdog fired on a running program.
 *   6. Stop while waiting for input.
 *   7. A crash: "Stopped early · exit N" and the red-lines sentence.
 *   8. Offline first run (fresh profile): an actionable failure card, then online +
 *      Try again recovers.
 * Plus, Python only: 9. a blackholed engine CDN (requests that never answer):
 *   the stall card after ~45 s, then Try again recovers.
 *
 * Screenshots (phone for Python and C#, desktop for Java and C), each state in
 * English and Arabic; the dark/light pair once per language — Warsha has one
 * (dark) theme, so "light" only proves a light-preferring OS changes nothing.
 *
 * Usage: node run-status-check.mjs [--lang python,java,csharp,c] [--no-main] [--no-offline] [--no-blackhole]
 * WARSHA_URL / WARSHA_SHOTS / CHROME as in README.md; THROTTLE_MBPS (default 8).
 * One browser at a time, closed between languages. Expect ~25 minutes for all four.
 */
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.WARSHA_URL ?? 'http://127.0.0.1:8086/'
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const MBPS = Number(process.env.THROTTLE_MBPS ?? 8)
mkdirSync(SHOTS, { recursive: true })

const args = process.argv.slice(2)
const argVal = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}
const LANGS = (argVal('--lang') ?? 'python,java,csharp,c').split(',')
const OFFLINE = !args.includes('--no-offline')
const BLACKHOLE = !args.includes('--no-blackhole')
const MAIN = !args.includes('--no-main')

const results = []
let tag = ''
const pass = (n, d = '') => { results.push(['PASS', `${tag} ${n}`, d]); console.log(`PASS  [${tag}] ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', `${tag} ${n}`, d]); console.log(`FAIL  [${tag}] ${n}${d ? ' :: ' + d : ''}`) }
const check = (ok, n, d = '') => (ok ? pass(n, d) : fail(n, d))
const info = (m) => console.log(`      ${m}`)

// ------------------------------------------------------------------ programs
// Busy-waits, not sleep(): every engine runs a busy loop the same way, and a
// silent CPU-bound program is exactly the case under test.
const PROGRAMS = {
  python: {
    lang: 'Python', template: 'Python (empty)', cdn: /cdn\.jsdelivr\.net\/pyodide/,
    hello: 'print("Hello from Warsha")\n',
    prints: 'import time\nfor i in range(80):\n    print("tick", i)\n    t = time.time()\n    while time.time() - t < 0.1:\n        pass\n',
    // numpy: the first import downloads it inside the run (in-run progress).
    quietThenInput:
      'import numpy as np\nimport time\nt0 = time.time()\nx = 0\nwhile time.time() - t0 < 62:\n    x += 1\nname = input("Your name: ")\nprint("Hi", name, int(np.arange(4).sum()))\n',
    input: 'input("Type something: ")\n',
    crash: 'print("before the crash")\nraise ValueError("boom")\n',
  },
  java: {
    lang: 'Java', template: 'Java (empty)', cdn: /leaningtech\.com/,
    hello: 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello from Warsha");\n  }\n}\n',
    prints:
      'public class Main {\n  public static void main(String[] args) {\n    for (int i = 0; i < 80; i++) {\n      System.out.println("tick " + i);\n      long t = System.currentTimeMillis();\n      while (System.currentTimeMillis() - t < 100) {}\n    }\n  }\n}\n',
    quietThenInput:
      'import java.util.Scanner;\npublic class Main {\n  public static void main(String[] args) {\n    long t0 = System.currentTimeMillis();\n    long x = 0;\n    while (System.currentTimeMillis() - t0 < 62000) { x++; }\n    Scanner in = new Scanner(System.in);\n    System.out.print("Your name: ");\n    String name = in.nextLine();\n    System.out.println("Hi " + name + " " + (x > 0));\n  }\n}\n',
    input:
      'import java.util.Scanner;\npublic class Main {\n  public static void main(String[] args) {\n    System.out.print("Type something: ");\n    new Scanner(System.in).nextLine();\n  }\n}\n',
    crash:
      'public class Main {\n  public static void main(String[] args) {\n    System.out.println("before the crash");\n    throw new IllegalStateException("boom");\n  }\n}\n',
  },
  csharp: {
    lang: 'C#', template: 'C# (empty)', cdn: /warsha-dotnet\//,
    hello: 'using System;\nclass Program {\n  static void Main() {\n    Console.WriteLine("Hello from Warsha");\n  }\n}\n',
    prints:
      'using System;\nusing System.Diagnostics;\nclass Program {\n  static void Main() {\n    for (int i = 0; i < 80; i++) {\n      Console.WriteLine("tick " + i);\n      var sw = Stopwatch.StartNew();\n      while (sw.ElapsedMilliseconds < 100) {}\n    }\n  }\n}\n',
    quietThenInput:
      'using System;\nusing System.Diagnostics;\nclass Program {\n  static void Main() {\n    var sw = Stopwatch.StartNew();\n    long x = 0;\n    while (sw.ElapsedMilliseconds < 62000) { x++; }\n    Console.Write("Your name: ");\n    var name = Console.ReadLine();\n    Console.WriteLine("Hi " + name + " " + (x > 0));\n  }\n}\n',
    input: 'using System;\nclass Program {\n  static void Main() {\n    Console.Write("Type something: ");\n    Console.ReadLine();\n  }\n}\n',
    crash:
      'using System;\nclass Program {\n  static void Main() {\n    Console.WriteLine("before the crash");\n    throw new InvalidOperationException("boom");\n  }\n}\n',
  },
  c: {
    lang: 'C(?!#)', template: 'C (empty)', cdn: /unpkg\.com|wasmer|registry/,
    hello: '#include <stdio.h>\nint main(void) {\n  printf("Hello from Warsha\\n");\n  return 0;\n}\n',
    prints:
      '#include <stdio.h>\n#include <time.h>\nint main(void) {\n  for (int i = 0; i < 80; i++) {\n    printf("tick %d\\n", i);\n    fflush(stdout);\n    clock_t t = clock();\n    while ((clock() - t) * 1000 / CLOCKS_PER_SEC < 100) {}\n  }\n  return 0;\n}\n',
    quietThenInput:
      '#include <stdio.h>\n#include <time.h>\nint main(void) {\n  time_t t0 = time(NULL);\n  long x = 0;\n  while (time(NULL) - t0 < 62) { x++; }\n  char name[64];\n  printf("Your name: ");\n  fflush(stdout);\n  if (scanf("%63s", name) == 1) printf("Hi %s %d\\n", name, x > 0);\n  return 0;\n}\n',
    input: '#include <stdio.h>\nint main(void) {\n  char s[32];\n  printf("Type something: ");\n  fflush(stdout);\n  scanf("%31s", s);\n  return 0;\n}\n',
    crash: '#include <stdio.h>\nint main(void) {\n  printf("before the crash\\n");\n  fprintf(stderr, "boom\\n");\n  return 3;\n}\n',
  },
}

// Phone for Python and C#, desktop for Java and C: every state gets seen at both sizes.
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
const FORM = { python: 'phone', java: 'desktop', csharp: 'phone', c: 'desktop' }

// ------------------------------------------------------------------ helpers

async function openContext(form) {
  const dir = mkdtempSync(join(tmpdir(), 'warsha-runstatus-'))
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROME,
    headless: true,
    ...(form === 'phone' ? PHONE : DESKTOP),
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page, dir, errors }
}

async function closeContext({ ctx, dir }) {
  await ctx.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Network throttling for the page AND its workers — every engine downloads from a
 * worker, and a page-only emulation leaves those at full speed. Auto-attach hands
 * each new worker's session the same conditions before it runs.
 */
async function throttle(ctx, page, mbps) {
  const conditions = mbps
    ? { offline: false, latency: 150, downloadThroughput: (mbps * 1e6) / 8, uploadThroughput: 1e6 / 8 }
    : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }
  const cdp = page.__cdp ?? (page.__cdp = await ctx.newCDPSession(page))
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', conditions)
  page.__conditions = conditions
  if (!page.__autoAttach) {
    page.__autoAttach = true
    cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
      if (!/worker/.test(targetInfo.type)) return
      const send = (method, params = {}) =>
        cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: Date.now() % 1e9, method, params }) }).catch(() => {})
      await send('Network.enable')
      await send('Network.emulateNetworkConditions', page.__conditions)
      await send('Runtime.runIfWaitingForDebugger')
    })
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false })
  }
}

/** Starts the in-page sampler: one entry per CHANGE of what the student sees, timestamped. */
async function startSampler(page) {
  await page.evaluate(() => {
    if (window.__rsTimer) clearInterval(window.__rsTimer)
    const t0 = performance.now()
    window.__rs = []
    window.__rsTimer = setInterval(() => {
      const bar = document.querySelector('footer[aria-label="Status bar"] .status-remote')
      const pill = bar ?? document.querySelector('.console-header .pill')
      const prog = document.querySelector('.progress-block')
      const s = {
        state: pill?.getAttribute('data-state') ?? null,
        pill: pill?.textContent.trim() ?? null,
        phase: prog?.getAttribute('data-phase') ?? null,
        progress: prog ? prog.textContent.replace(/\s+/g, ' ').trim() : null,
        activity: !!document.querySelector('.run-activity'),
        quiet: document.querySelector('.console-quiet')?.getAttribute('data-quiet-s') ?? null,
        failure: document.querySelector('[data-failure]')?.getAttribute('data-failure') ?? null,
        empty: document.querySelector('.console-empty')?.textContent ?? null,
        consoleOpen: !!document.querySelector('[aria-label="Program output"]'),
        inputFocused: document.activeElement?.getAttribute('aria-label') === 'Program input',
        // A screenshot stalls the page's timers; gaps around one are the camera, not the app.
        shooting: !!window.__shooting,
      }
      const key = JSON.stringify(s)
      const last = window.__rs[window.__rs.length - 1]
      if (!last || last.key !== key) window.__rs.push({ t: Math.round(performance.now() - t0), key, ...s })
    }, 200)
  })
}
const samples = (page) => page.evaluate(() => window.__rs.map(({ key, ...s }) => s))

const runState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('footer[aria-label="Status bar"] .status-remote') ?? document.querySelector('.console-header .pill')
    return { state: el?.getAttribute('data-state') ?? null, text: el?.textContent.trim() ?? '' }
  })

const waitState = (page, states, timeout) =>
  page.waitForFunction(
    (want) => {
      const el = document.querySelector('footer[aria-label="Status bar"] .status-remote') ?? document.querySelector('.console-header .pill')
      return want.includes(el?.getAttribute('data-state'))
    },
    [states].flat(),
    { timeout, polling: 200 },
  ).then(() => true, () => false)

const output = (page) => page.locator('[aria-label="Program output"]').innerText().catch(() => '')

async function setEditor(page, text) {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  // insertText is one input event, like a paste: typing would trip auto-close and auto-indent.
  await page.keyboard.insertText(text)
  await page.waitForTimeout(700)
}

// The tab strip's Run/Stop names the file ("Run main.py") — and "Run and Debug" must not match.
const runBtn = (page) => page.getByRole('button', { name: /^Run \S+\.(py|java|cs|c)$/ }).first()
const stopBtn = (page) => page.getByRole('button', { name: /^Stop \S+\.(py|java|cs|c)$/ }).first()

async function clickRun(page) {
  await page.waitForTimeout(300) // the 250 ms swap guard
  await runBtn(page).click()
}
async function clickStop(page) {
  await page.waitForTimeout(300)
  await stopBtn(page).click()
}

/** The longest stretch, in ms, with nothing on screen changing, over samples matching `when`. */
function longestFreeze(list, when) {
  let worst = 0
  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].shooting || list[i].shooting) continue
    if (when(list[i - 1])) worst = Math.max(worst, list[i].t - list[i - 1].t)
  }
  return worst
}

let locale = 'en'
/** Flips the interface language through the command palette, the way a student would. */
async function toggleLocale(page) {
  const title = locale === 'en' ? 'View: Switch Language' : 'عرض: تغيير لغة الواجهة'
  await page.keyboard.press('F1')
  await page.waitForTimeout(250)
  await page.keyboard.insertText(title)
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  locale = locale === 'en' ? 'ar' : 'en'
}

/**
 * The state on screen, in both languages (and both colour schemes when `schemes`).
 * Leaves the page in English, so the selectors above keep working.
 */
async function shotBoth(page, name, { schemes = false } = {}) {
  const lang = tag
  const form = FORM[lang]
  await page.evaluate(() => { window.__shooting = true })
  const take = async (suffix) => page.screenshot({ path: `${SHOTS}/rs-${lang}-${form}-${name}-${suffix}.png` })
  await take('en-dark')
  if (schemes) {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForTimeout(150)
    await take('en-light')
    await page.emulateMedia({ colorScheme: 'dark' })
  }
  await toggleLocale(page)
  await take('ar-dark')
  if (schemes) {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.waitForTimeout(150)
    await take('ar-light')
    await page.emulateMedia({ colorScheme: 'dark' })
  }
  await toggleLocale(page)
  await page.waitForTimeout(300)
  await page.evaluate(() => { window.__shooting = false })
}

async function bootProject(page, P) {
  await page.goto(BASE + '?lang=en', { waitUntil: 'load' })
  // coi-serviceworker registers, then reloads once for the isolation headers.
  await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(800)
  const btn = page.getByRole('button', { name: 'New project', exact: true }).first()
  await btn.waitFor({ timeout: 60000 })
  await btn.click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + P.lang) }).first().click()
  await page.locator('.template-card').filter({ hasText: P.template }).first().click()
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  await page.waitForTimeout(600)
}

// ------------------------------------------------------------------ one language

async function languageSuite(id) {
  tag = id
  const P = PROGRAMS[id]
  const form = FORM[id]
  console.log(`\n==== ${id} (${form}) ====`)
  if (!MAIN) return extraSuites(id)
  const c = await openContext(form)
  const { ctx, page } = c
  try {
    await bootProject(page, P)
    await setEditor(page, P.hello)

    // ---- 1. Stop while downloading
    await throttle(ctx, page, MBPS)
    await startSampler(page)
    await clickRun(page)
    await page.waitForTimeout(4000)
    const pre = await runState(page)
    if (pre.state === 'preparing') {
      await shotBoth(page, '1-downloading', { schemes: true })
      await clickStop(page)
      const stopped = await waitState(page, 'stopped', 4000)
      const out = await output(page)
      check(stopped && /Stopped\./.test(out), '1. Stop while the language downloads ends it cleanly', `${(await runState(page)).text} / ${out.slice(-60)}`)
    } else info(`1. skipped: the download had already finished (${pre.state}) — raise latency or lower THROTTLE_MBPS`)

    // ---- 2. cold first run, throttled
    await startSampler(page)
    const t0 = Date.now()
    await clickRun(page)
    // Shoot whatever loading step is on screen ~6 s in, once.
    await page.waitForTimeout(6000)
    if ((await runState(page)).state === 'preparing') await shotBoth(page, '2-loading')
    const ok2 = await waitState(page, ['ok', 'failed'], 300000)
    const cold = await samples(page)
    const coldMs = Date.now() - t0
    const end = await runState(page)
    check(ok2 && end.state === 'ok', '2. cold first run finishes', `${end.text} after ${(coldMs / 1000).toFixed(1)}s`)
    check(/Finished · [\d.]+(s|m)/.test(end.text), '2. Finished carries its time', JSON.stringify(end.text))
    const loading = cold.filter((s) => s.state === 'preparing' || s.progress)
    const phases = [...new Set(cold.map((s) => s.phase).filter(Boolean))]
    info(`phases seen: ${phases.join(' → ') || '(none)'}; ${loading.length} loading samples`)
    for (const s of loading.filter((x, i, a) => i === 0 || x.pill !== a[i - 1].pill).slice(0, 8)) info(`  t=${s.t} pill=${JSON.stringify(s.pill)} block=${JSON.stringify(s.progress)}`)
    check(phases.includes('download'), '2. the download is shown as a download', phases.join(','))
    // The step is named in the status bar while loading, not a minute of "Preparing".
    // (Samples taken while a screenshot flipped the language read in Arabic: «جارٍ …».)
  const named = loading.filter((s) => s.phase && !/^\W*(Downloading|Unpacking|Starting|Compiling|جارٍ)/.test(s.pill ?? ''))
    check(named.length === 0, '2. the status bar names the loading step', named.slice(0, 2).map((s) => s.pill).join(' | '))
    check(loading.some((s) => /\d+%/.test(s.pill ?? '')), '2. the status bar shows the download percent', loading.map((s) => s.pill).find((p) => /%/.test(p ?? '')) ?? 'never')
    const freeze = longestFreeze(cold, (s) => s.state === 'preparing' || !!s.progress)
    check(freeze <= 2200, '2. something on screen changes at least every 2 s while loading', `longest freeze ${freeze} ms`)
    check(loading.every((s) => s.activity), '2. the activity line runs through loading')
    check(!cold.some((s) => s.failure), '2. no failure card on a slow but moving download')
    check(cold.some((s) => /one|once|first|مرة/i.test(s.progress ?? '')), '2. the download says it is one-time', cold.map((s) => s.progress).find((p) => /first|once|one-time/i.test(p ?? '')) ?? '')
    await shotBoth(page, '2-finished')
    await throttle(ctx, page, 0)

    // ---- 3. warm run
    await startSampler(page)
    await clickRun(page)
    await waitState(page, ['ok', 'failed'], 60000)
    const warm = await samples(page)
    check(!warm.some((s) => s.phase === 'download'), '3. a warm run shows no download', [...new Set(warm.map((s) => s.phase))].join(','))
    check((await runState(page)).state === 'ok', '3. warm run finishes', (await runState(page)).text)

    // ---- 4. continuous printing, Stop mid-print
    await setEditor(page, P.prints)
    await startSampler(page)
    await clickRun(page)
    await page.waitForFunction(() => /tick 1\b|tick 1\n/.test(document.querySelector('[aria-label="Program output"]')?.innerText ?? ''), null, { timeout: 90000 }).catch(() => {})
    await page.waitForTimeout(2500)
    const printing = await samples(page)
    const rs4 = await runState(page)
    check(rs4.state === 'running', '4. printing program reads as Running', rs4.text)
    check(!printing.some((s) => s.quiet), '4. no "still running" note while it prints')
    check(printing.filter((s) => s.state === 'running').every((s) => s.activity), '4. activity line runs while it prints')
    await clickStop(page)
    const st4 = await waitState(page, 'stopped', 3000)
    check(st4, '4. Stop mid-print stops within 3 s', (await runState(page)).text)
    // Python's kill() answers synchronously; the 2 s Stop backstop used to fire anyway.
    await page.waitForTimeout(3000)
    const still4 = await runState(page)
    check(still4.state === 'stopped' && !/stopped responding/.test(await output(page)), '4. and stays "Stopped by you" (no late "stopped responding")', still4.text)
    await shotBoth(page, '4-stopped')

    // ---- 5. silent 62 s, then input() for 62 s (console collapsed meanwhile)
    await setEditor(page, P.quietThenInput)
    await startSampler(page)
    await clickRun(page)
    // Shoot an in-run loading step if one shows (Java's cold compile, Python's numpy).
    const inRun = await page.waitForFunction(
      () => document.querySelector('footer .status-remote')?.getAttribute('data-state') === 'running' && !!document.querySelector('.progress-block'),
      null, { timeout: 60000, polling: 200 },
    ).then(() => true, () => false)
    if (inRun) {
      await page.waitForTimeout(3000)
      if (await page.locator('.progress-block').count()) await shotBoth(page, '5-in-run-loading')
    }
    // Program running quietly: wait past the 30 s note, shoot it, then collapse the console.
    await page.waitForSelector('.console-quiet', { timeout: 120000 }).catch(() => {})
    await page.waitForTimeout(12000)
    const quietSecs = (await samples(page)).map((s) => Number(s.quiet)).filter(Boolean)
    check(quietSecs.length > 0 && Math.min(...quietSecs) >= 30, '5. "Still running" shows after 30 s of silence', `first at ${quietSecs[0] ?? '-'}s`)
    check(new Set(quietSecs).size >= 10, '5. its counter keeps counting', `${new Set(quietSecs).size} values: ${[...new Set(quietSecs)].join(',')}`)
    await shotBoth(page, '5-still-running', { schemes: true })
    await page.getByRole('button', { name: 'Hide output' }).click().catch(() => {})
    const reachedWait = await waitState(page, 'waiting', 150000)
    check(reachedWait, '5. the program reaches input() after its silent stretch')
    await page.waitForTimeout(1000)
    const atWait = await samples(page)
    const last = atWait[atWait.length - 1]
    check(last.consoleOpen, '5. waiting reopens a collapsed console')
    check(last.inputFocused, '5. waiting focuses the console input')
    check(!last.activity, '5. no activity line while it waits for you')
    await shotBoth(page, '5-waiting')
    // Sit in input() past the old 45 s watchdog.
    await page.waitForTimeout(62000)
    const waited = await samples(page)
    const running = waited.filter((s) => s.state === 'running' && !s.progress)
    check(!waited.some((s) => s.failure || s.state === 'failed'), '5. never reported as failed — not in the silence, not in input()', waited.filter((s) => s.failure || s.state === 'failed').map((s) => `t=${s.t} ${s.pill} ${s.failure ?? ''}`).slice(0, 2).join(' | '))
    check(running.filter((s) => s.t > 1000).every((s) => s.activity), '5. activity line runs through the silent stretch')
    check(!waited.some((s) => s.state === 'waiting' && s.quiet), '5. no "still running" note while waiting')
    check((await runState(page)).state === 'waiting', '5. still waiting after 62 s', (await runState(page)).text)
    if (inRun) {
      const after = waited.filter((s) => s.state === 'running' && !s.progress && waited.some((p) => p.progress && p.t < s.t))
      check(after.length > 0, '5. the in-run loading block clears once the program starts, not at first output', `${after.length} running samples without the block before any output`)
    }
    await page.locator('[aria-label="Program input"]').fill('Saad')
    await page.locator('[aria-label="Program input"]').press('Enter')
    const done5 = await waitState(page, ['ok', 'failed'], 30000)
    check(done5 && /Hi/.test(await output(page)), '5. answering finishes the program', (await runState(page)).text)

    // ---- 6. Stop while waiting
    await setEditor(page, P.input)
    await clickRun(page)
    await waitState(page, 'waiting', 60000)
    await clickStop(page)
    check(await waitState(page, 'stopped', 3000), '6. Stop while waiting for input', (await runState(page)).text)

    // ---- 7. a crash
    await setEditor(page, P.crash)
    await clickRun(page)
    await waitState(page, ['ok', 'failed'], 60000)
    const rs7 = await runState(page)
    const out7 = await output(page)
    check(rs7.state === 'failed' && /Stopped early · exit [1-9]/.test(rs7.text), '7. a crash reads "Stopped early · exit N"', rs7.text)
    check(/red lines above say why/.test(out7), '7. and says where to look', out7.slice(-90))
    await shotBoth(page, '7-crashed')

    check(c.errors.length === 0, 'no uncaught page errors', c.errors.slice(0, 3).join(' | '))
  } catch (e) {
    fail('suite crashed', String(e && e.stack || e).slice(0, 400))
    await page.screenshot({ path: `${SHOTS}/rs-${id}-crash.png` }).catch(() => {})
  } finally {
    await closeContext(c)
  }

  await extraSuites(id)
}

async function extraSuites(id) {
  if (OFFLINE) await offlineSuite(id)
  if (BLACKHOLE && id === 'python') await blackholeSuite(id)
}

// ---- 8. offline first run, then recover
async function offlineSuite(id) {
  tag = id
  const P = PROGRAMS[id]
  const c = await openContext(FORM[id])
  const { ctx, page } = c
  try {
    await bootProject(page, P)
    await setEditor(page, P.hello)
    await ctx.setOffline(true)
    await startSampler(page)
    await clickRun(page)
    const failed = await waitState(page, 'failed', 120000)
    const s = await samples(page)
    const card = await page.locator('[data-failure]').first()
    const kind = await card.getAttribute('data-failure').catch(() => null)
    const text = await card.innerText().catch(() => '')
    check(failed && kind === 'offline', '8. offline first run: a failure card that names the network', `${kind} :: ${text.replace(/\s+/g, ' ').slice(0, 120)}`)
    info(`failed after ${s.find((x) => x.state === 'failed')?.t ?? '-'} ms`)
    await page.getByRole('button', { name: 'Details' }).click().catch(() => {})
    info(`engine detail: ${(await page.locator('.console-failure__detail').innerText().catch(() => '')).slice(0, 300)}`)
    await shotBoth(page, '8-offline')
    await ctx.setOffline(false)
    await page.getByRole('button', { name: 'Try again' }).click()
    check(await waitState(page, 'ok', 300000), '8. back online, Try again recovers', (await runState(page)).text)
  } catch (e) {
    fail('offline suite crashed', String(e && e.stack || e).slice(0, 400))
  } finally {
    await closeContext(c)
  }
}

// ---- 9. a blackholed CDN: requests that never answer — the watchdog's one job
async function blackholeSuite(id) {
  tag = id
  const P = PROGRAMS[id]
  const c = await openContext(FORM[id])
  const { ctx, page } = c
  try {
    await bootProject(page, P)
    await setEditor(page, P.hello)
    const held = []
    // Never fulfilled, never aborted: what a dropped-packet network looks like.
    await ctx.route(P.cdn, (route) => { held.push(route) })
    await clickRun(page)
    const clicked = Date.now()
    const failed = await waitState(page, 'failed', 90000)
    const at = Date.now() - clicked
    const kind = await page.locator('[data-failure]').first().getAttribute('data-failure').catch(() => null)
    check(failed && kind === 'offline' && at >= 44000 && at <= 52000, '9. a download that never answers fails after ~45 s, as a network problem', `${kind} at ${at} ms (${held.length} requests held)`)
    await shotBoth(page, '9-stalled')
    await ctx.unroute(P.cdn)
    for (const r of held) await r.abort().catch(() => {})
    await page.getByRole('button', { name: 'Try again' }).click()
    check(await waitState(page, 'ok', 300000), '9. Try again recovers once the network answers', (await runState(page)).text)
  } catch (e) {
    fail('blackhole suite crashed', String(e && e.stack || e).slice(0, 400))
  } finally {
    await closeContext(c)
  }
}

for (const id of LANGS) await languageSuite(id)

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
for (const f of failed) console.log(`  FAIL ${f[1]} :: ${f[2]}`)
process.exit(failed.length ? 1 : 0)
