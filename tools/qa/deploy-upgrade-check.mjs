/* "Old version cached -> new version deployed -> returning student runs code."
 *
 * WHY THIS EXISTS
 * Students reported that running code "often" failed with Warsha's own error
 * ("Warsha could not start Java", a blank shell, a dead Run) and that only
 * clearing the cache and hard-refreshing made it go away. Nothing in the other
 * suites could see it, because every one of them starts from a FRESH profile
 * against ONE build — and the bug lives entirely in the gap between two builds:
 * an HTTP cache, a service-worker cache and an open tab that still hold the old
 * one while the server already serves the new one.
 *
 * So this suite plays a deploy, through the REAL production nginx config
 * (app/deploy/nginx.conf in nginx:alpine, exactly what /Dockerfile ships):
 *
 *   A. RETURNING VISITOR. v1 is served; a persistent profile visits and runs
 *      every language, warming the service worker and the HTTP cache. The tab is
 *      closed, v2 is deployed, and the same profile comes back the way a student
 *      does — a plain navigation, no reload button, nothing cleared — and runs
 *      every language again. Then it comes back once more, because a poisoned
 *      cache shows up on the visit AFTER the one that poisoned it.
 *   B. TAB LEFT OPEN ACROSS THE DEPLOY. A v1 tab is left open; v2 is deployed;
 *      the student opens a second tab (which installs v2's service worker, and
 *      that evicts v1's caches); the browser drops its HTTP cache; then the
 *      student goes back to the OLD tab and presses Run in
 *      every language. The page may heal itself by reloading onto v2 — that is a
 *      pass, the student just presses Run again — but an error is not.
 *   C. OFFLINE RIGHT AFTER THE UPGRADE. On that first v2 visit, before anything
 *      has run on v2, the network goes and every language the student used on
 *      v1 is run again. Runtimes must outlive a deploy; Java and C have known
 *      offline limits (OFFLINE_LIMITS) and are reported, not asserted.
 *
 * What "works" means, per visit: the output arrives and the run exits clean; the
 * page is the v2 document; nothing v1 downloaded from a runtime CDN is
 * downloaded again (every service-worker network request is watched); every same-origin runtime file the service worker
 * hands the page is byte-identical to v2 on disk (no v1 worker under a v2
 * bundle); and Cache Storage holds no HTML under a script/wasm/dll URL (the
 * SPA-fallback poison).
 *
 * v1's files are served with a Last-Modified WARSHA_V1_AGE_DAYS in the past, as
 * production's are a few days after a deploy. That is what gives a browser a
 * heuristic freshness window on files sent without Cache-Control — the exact
 * window the bug lived in. Without it the suite would be testing a server that
 * production is not.
 *
 * Inputs: two built dist/ folders. Make v2 by changing any app code and any
 * runtime worker, then `npx vite build` again, e.g.:
 *
 *   cd app && npx vite build && cp -a dist /tmp/v1
 *   # edit a string in src/, and a runtime worker (runtimes/python/src/worker.js),
 *   # restage the public/ workers, build again:
 *   npx vite build && cp -a dist /tmp/v2
 *   cd ../tools/qa && WARSHA_V1_DIST=/tmp/v1 WARSHA_V2_DIST=/tmp/v2 node deploy-upgrade-check.mjs
 *
 * Needs docker (nginx:alpine) and real network for the Pyodide / CheerpJ / unpkg
 * CDNs. Runs ONE headless browser at a time.
 *
 * Overridable:
 *   WARSHA_V1_DIST, WARSHA_V2_DIST  the two builds                       (required)
 *   WARSHA_LANGS        comma list of python,java,csharp,c,js,web,vue,svelte,tailwind,notebook (default all)
 *   WARSHA_SCENARIOS    comma list of A,B,C                              (default all)
 *   WARSHA_NGINX_CONF   nginx server block    (default ../../app/deploy/nginx.conf)
 *   WARSHA_PORT         host port for nginx                              (default 8291)
 *   WARSHA_V1_AGE_DAYS  how old v1's Last-Modified is                    (default 10)
 *   CHROME              Chrome binary                (default /usr/bin/google-chrome)
 */
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const V1 = process.env.WARSHA_V1_DIST
const V2 = process.env.WARSHA_V2_DIST
if (!V1 || !V2 || !existsSync(join(V1, 'index.html')) || !existsSync(join(V2, 'index.html'))) {
  console.error('Set WARSHA_V1_DIST and WARSHA_V2_DIST to two built dist/ folders (see the header).')
  process.exit(2)
}
const CONF = resolve(process.env.WARSHA_NGINX_CONF ?? join(HERE, '../../app/deploy/nginx.conf'))
const PORT = Number(process.env.WARSHA_PORT ?? 8291)
const AGE_DAYS = Number(process.env.WARSHA_V1_AGE_DAYS ?? 10)
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const BASE = `http://127.0.0.1:${PORT}/`
const RUN_TIMEOUT_MS = Number(process.env.WARSHA_RUN_TIMEOUT_MS ?? 240000)
const SHOTS = process.env.WARSHA_SHOTS ?? join(HERE, 'screenshots')
const SCENARIOS = (process.env.WARSHA_SCENARIOS ?? 'A,B,C').split(',').map((s) => s.trim().toUpperCase())

const results = []
const pass = (name, detail = '') => { results.push(true); console.log(`PASS  ${name}${detail ? ' :: ' + detail : ''}`) }
const fail = (name, detail = '') => { results.push(false); console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`) }
const check = (name, ok, detail = '') => (ok ? pass : fail)(name, detail)
const info = (m) => console.log(`      ${m}`)

// ------------------------------------------------------------------ the programs
// One small program per engine, each printing a marker the check waits for. They
// arrive as #share= links (app/src/sharelink.ts), so every language opens as its
// own project without walking the template picker six times.
const PROGRAMS = {
  python: { entry: 'main.py', files: [['main.py', 'print("upgrade-ok python")\n']] },
  java: {
    entry: 'Main.java',
    files: [['Main.java', 'public class Main {\n  public static void main(String[] args) {\n    System.out.println("upgrade-ok java");\n  }\n}\n']],
  },
  csharp: {
    entry: 'Program.cs',
    files: [['Program.cs', 'using System;\n\nclass Program {\n  static void Main() {\n    Console.WriteLine("upgrade-ok csharp");\n  }\n}\n']],
  },
  c: { entry: 'main.c', files: [['main.c', '#include <stdio.h>\n\nint main(void) {\n  printf("upgrade-ok c\\n");\n  return 0;\n}\n']] },
  js: { entry: 'main.ts', files: [['main.ts', 'const lang: string = "js";\nconsole.log(`upgrade-ok ${lang}`);\n']] },
  // TSX + React: exercises the esbuild wasm and the staged React blob, both
  // unhashed public/ files, which is the class of file the bug is about.
  web: {
    entry: 'index.html',
    preview: true,
    files: [
      ['index.html', '<!doctype html>\n<html><body><div id="root"></div><script type="module" src="main.tsx"></script></body></html>\n'],
      ['main.tsx', 'import { createRoot } from "react-dom/client";\nconst el = document.getElementById("root");\nif (el) createRoot(el).render(<p>upgrade-ok web</p>);\n'],
    ],
  },
  // The two other bundled frameworks and the on-device Tailwind, each a staged
  // public/ file of its own (warsha-vue/svelte.json, warsha-tailwind.js).
  vue: {
    entry: 'index.html',
    preview: true,
    files: [
      ['index.html', '<!doctype html>\n<html><body><div id="app"></div><script type="module" src="main.js"></script></body></html>\n'],
      ['main.js', 'import { createApp } from "vue";\nimport App from "./App.vue";\ncreateApp(App).mount("#app");\n'],
      ['App.vue', '<script setup>\nimport { ref } from "vue";\nconst who = ref("vue");\n</script>\n\n<template>\n  <p>upgrade-ok {{ who }}</p>\n</template>\n'],
    ],
  },
  svelte: {
    entry: 'index.html',
    preview: true,
    files: [
      ['index.html', '<!doctype html>\n<html><body><div id="app"></div><script type="module" src="main.js"></script></body></html>\n'],
      ['main.js', 'import { mount } from "svelte";\nimport App from "./App.svelte";\nmount(App, { target: document.getElementById("app") });\n'],
      ['App.svelte', '<script>\n  let who = $state("svelte");\n</script>\n\n<p>upgrade-ok {who}</p>\n'],
    ],
  },
  // The CDN tag is the one students paste; the runtime swaps it for the staged
  // build. Passing means the utility class actually styled the text.
  tailwind: {
    entry: 'index.html',
    preview: true,
    previewOk: () => {
      const el = document.querySelector('#tw')
      return !!el && getComputedStyle(el).fontWeight === '700'
    },
    files: [
      ['index.html', '<!doctype html>\n<html><head><script src="https://cdn.tailwindcss.com"></script></head><body><p id="tw" class="font-bold">upgrade-ok tailwind</p></body></html>\n'],
    ],
  },
  // A Jupyter notebook: its own kernel (runtimes/python/src/kernel.js) and its
  // own lazy UI chunk, run through the notebook's "Run cell", not the tab Run.
  // The printed marker is built at run time so the cell SOURCE never contains it.
  notebook: {
    entry: 'lab.ipynb',
    notebook: true,
    files: [
      ['lab.ipynb', JSON.stringify({
        cells: [{ cell_type: 'code', execution_count: null, metadata: {}, outputs: [], source: ['print("upgrade-ok " + "notebook")'] }],
        metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } },
        nbformat: 4,
        nbformat_minor: 5,
      })],
    ],
  },
}
const LANGS = (process.env.WARSHA_LANGS ?? Object.keys(PROGRAMS).join(',')).split(',').map((s) => s.trim()).filter(Boolean)

const shareLink = (lang) => {
  const p = PROGRAMS[lang]
  const payload = { v: 1, n: `upgrade ${lang}`, e: p.entry, f: p.files, d: [] }
  // fflate's deflateSync (what the app inflates with) is raw DEFLATE, no zlib header.
  const data = deflateRawSync(Buffer.from(JSON.stringify(payload)), { level: 9 })
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${BASE}#share=${data}`
}

// ------------------------------------------------------------------ the server
const SERVE = mkdtempSync(join(tmpdir(), 'warsha-upgrade-serve-'))
// mkdtemp makes it 0700; nginx's worker runs as another user and would 403.
chmodSync(SERVE, 0o755)
const CONTAINER = `warsha-upgrade-check-${PORT}`

/** Every file under a folder, as paths relative to it. */
function walk(root, rel = '') {
  const out = []
  for (const name of readdirSync(join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name
    if (statSync(join(root, r)).isDirectory()) out.push(...walk(root, r))
    else out.push(r)
  }
  return out
}

/** Replace what nginx serves IN PLACE (the bind mount pins the folder inode, so
 *  a rename-swap would go unseen), stamping every file's mtime — and so its
 *  Last-Modified — `ageDays` in the past. */
function deploy(dist, ageDays) {
  for (const name of readdirSync(SERVE)) rmSync(join(SERVE, name), { recursive: true, force: true })
  cpSync(dist, SERVE, { recursive: true })
  const when = new Date(Date.now() - ageDays * 86400_000)
  for (const f of walk(SERVE)) utimesSync(join(SERVE, f), when, when)
}

function startNginx() {
  try { execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' }) } catch { /* not running */ }
  execFileSync('docker', [
    'run', '-d', '--name', CONTAINER, '-p', `127.0.0.1:${PORT}:80`,
    '-v', `${SERVE}:/usr/share/nginx/html:ro`,
    '-v', `${CONF}:/etc/nginx/conf.d/default.conf:ro`,
    'nginx:alpine',
  ], { stdio: 'ignore' })
}
const stopNginx = () => { try { execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' }) } catch { /* gone */ } }

/** The hashed entry script a document boots — the cheapest exact "which build is
 *  this page" fingerprint, since its name changes whenever any bundled code does. */
const entryOf = (html) => html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1] ?? null
const V1_ENTRY = entryOf(readFileSync(join(V1, 'index.html'), 'utf8'))
const V2_ENTRY = entryOf(readFileSync(join(V2, 'index.html'), 'utf8'))
if (!V1_ENTRY || !V2_ENTRY || V1_ENTRY === V2_ENTRY) {
  console.error(`v1 and v2 must be different builds (entries ${V1_ENTRY} / ${V2_ENTRY}).`)
  process.exit(2)
}
info(`v1 entry ${V1_ENTRY}  ->  v2 entry ${V2_ENTRY}`)

/** The cache a build's service worker fills: `warsha-shell-<version>`, the
 *  version the warsha:sw-precache plugin stamps onto the worker's first line. */
const shellCacheOf = (dist) =>
  `warsha-shell-${readFileSync(join(dist, 'coi-serviceworker.js'), 'utf8').match(/__WARSHA_VERSION__="([^"]+)"/)?.[1]}`
/** Real, not-precached wasm chunks of v2 (precache is JS/CSS only, so these
 *  are fetched lazily and cache-first): the targets of the poisoning check. */
const POISON_URLS = readdirSync(join(V2, 'assets')).filter((f) => f.endsWith('.wasm')).slice(0, 2).map((f) => `${BASE}assets/${f}`)
const V1_SHELL = shellCacheOf(V1)
const V2_SHELL = shellCacheOf(V2)

/** Until `name` is the one shell cache present: that build's worker has
 *  installed, activated and evicted the other build's caches. */
async function waitShell(page, name, timeout = 90000) {
  // Polled from here, not with waitForFunction: caches.keys() is async, and a
  // predicate that returns a Promise is truthy at once.
  for (const end = Date.now() + timeout; Date.now() < end; await page.waitForTimeout(500)) {
    const shells = await page.evaluate(async () => (await caches.keys()).filter((n) => n.startsWith('warsha-shell-'))).catch(() => [])
    if (shells.length === 1 && shells[0] === name) return true
  }
  return false
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

// ------------------------------------------------------------------ the browser
const PROFILE = mkdtempSync(join(tmpdir(), 'warsha-upgrade-profile-'))
let ctx = null
/** Every Content-Security-Policy violation the browser logged, across all
 *  pages, frames and workers of every context, enforced or report-only. Split at
 *  the end into Warsha's own pages and the Web preview: the preview is a srcdoc
 *  frame, which inherits the page's policy while running the student's code. */
const cspViolations = []
const launch = async (profile = PROFILE) => {
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1280, height: 900 },
  })
  ctx.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) cspViolations.push({ text: m.text(), where: m.location()?.url ?? '' })
  })
  return ctx
}

/** The errors that mean "the platform broke", as opposed to a student's program
 *  failing. Collected per page so a scenario can assert on its own. */
const PLATFORM_ERROR = /Failed to fetch dynamically imported module|Failed to load module script|MIME type|could not start|Importing a module script failed|Warsha crashed/i
function watch(page) {
  const errors = []
  // An error in a document that then reloaded itself (the stale-build self-heal
  // in app/src/ui/staleBuild.ts) never reached the student's eyes — the reload
  // was the response to it. Those move to `healed`; the scenario separately
  // asserts the tab landed on the deployed build, so a heal cannot hide a loop.
  errors.healed = []
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) errors.healed.push(...errors.splice(0)) })
  page.on('console', (m) => { if (m.type() === 'error' && PLATFORM_ERROR.test(m.text())) errors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => { if (PLATFORM_ERROR.test(e.message)) errors.push('pageerror: ' + e.message.slice(0, 300)) })
  return errors
}

async function waitControlled(page) {
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller && self.crossOriginIsolated === true, null, { timeout: 60000 })
}

/** Open a language's project and press Run, the way a student does. Returns what
 *  the student ended up looking at. If the page reloads itself mid-way (the
 *  stale-build self-heal), the student presses Run once more — that is allowed,
 *  an error message is not. */
async function runLang(page, lang, { allowHeal = false } = {}) {
  const p = PROGRAMS[lang]
  const marker = `upgrade-ok ${lang}`
  let healed = false
  let navigated = false
  const onNav = (f) => { if (f === page.mainFrame()) navigated = true }
  page.on('framenavigated', onNav)
  try {
    // Opened as a same-document hash change, never a page load: scenario B is
    // about a tab that stays the SAME document across the deploy, and a full
    // navigation would quietly swap it for a fresh one. Back at `/` first, since
    // `/p/<id>` -> `/#share=` is a cross-path (full) navigation.
    await page.evaluate((hash) => {
      history.pushState(null, '', '/')
      location.hash = hash
    }, new URL(shareLink(lang)).hash)
    const ready = p.notebook ? '[data-notebook] .cm-content' : '.cm-content'
    await page.waitForSelector(ready, { timeout: 60000 })
    await page.waitForTimeout(400)
    for (let attempt = 0; attempt < 2; attempt++) {
      navigated = false
      // The tab strip's Run is labelled "Run <file>" (RunControl); a bare /^Run/
      // would also match the menu bar's Run menu and open it instead. A notebook
      // runs a cell from the cell's own gutter button.
      // dispatchEvent, not click(): the "project ready" toast sits over the tab
      // strip for a few seconds and would swallow a pointer click.
      const run = p.notebook
        ? page.locator('[data-notebook]').getByRole('button', { name: 'Run cell', exact: true }).first()
        : page.getByRole('button', { name: `Run ${p.entry}`, exact: true })
      await run.dispatchEvent('click', {}, { timeout: 30000 })
      const outcome = await (async () => {
        const deadline = Date.now() + RUN_TIMEOUT_MS
        while (Date.now() < deadline) {
          if (navigated) return { kind: 'reloaded' }
          const state = await page.evaluate(() => ({
            out: document.querySelector('[aria-label="Program output"]')?.innerText ?? '',
            notebook: document.querySelector('[data-notebook]')?.innerText ?? '',
            // The run console's failure block, or a notebook's error toast.
            failure: document.querySelector('.console-failure__title')?.textContent
              ?? document.querySelector('.toast[data-kind="error"]')?.textContent ?? null,
            crash: !!document.querySelector('[data-crash]'),
          })).catch(() => null)
          if (state) {
            if (state.crash) return { kind: 'crash' }
            if (state.failure) return { kind: 'failure', text: state.failure }
            if (p.notebook) {
              if (state.notebook.includes(marker)) return { kind: 'ok' }
            } else if (!p.preview && state.out.includes(marker) && /Finished\. \(exit code 0\)/.test(state.out)) return { kind: 'ok' }
            if (p.preview) {
              for (const f of page.frames()) {
                if (f === page.mainFrame()) continue
                const t = await f.evaluate(() => document.body?.innerText ?? '').catch(() => '')
                if (t.includes(marker) && (!p.previewOk || (await f.evaluate(p.previewOk).catch(() => false)))) return { kind: 'ok' }
              }
            }
          }
          await page.waitForTimeout(500)
        }
        return { kind: 'timeout' }
      })()
      if (outcome.kind === 'reloaded' && allowHeal && !healed) {
        healed = true
        await page.waitForSelector('.cm-content', { timeout: 60000 })
        await page.waitForTimeout(400)
        continue
      }
      if (outcome.kind !== 'ok') {
        mkdirSync(SHOTS, { recursive: true })
        await page.screenshot({ path: join(SHOTS, `deploy-upgrade-${lang}-${Date.now()}.png`) }).catch(() => {})
      }
      if (outcome.kind === 'timeout') {
        const out = await page.locator('[aria-label="Program output"]').innerText().catch(() => '')
        return { ...outcome, healed, text: out.slice(-200) }
      }
      return { ...outcome, healed }
    }
    return { kind: 'reloaded-twice', healed }
  } finally {
    page.off('framenavigated', onNav)
  }
}

/** Everything the service worker would hand the page for each same-origin,
 *  unhashed file it has cached — fetched THROUGH the worker, as an engine
 *  would — hashed in the page. Plus any HTML sitting under a non-HTML URL. */
async function cacheAudit(page) {
  return page.evaluate(async () => {
    const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const urls = new Set()
    const poisoned = []
    for (const n of await caches.keys()) {
      if (!n.startsWith('warsha-')) continue
      const c = await caches.open(n)
      for (const req of await c.keys()) {
        const u = new URL(req.url)
        if (u.origin !== location.origin) continue
        const res = await c.match(req)
        const type = res?.headers.get('content-type') ?? ''
        const looksLikePage = u.pathname.endsWith('/') || u.pathname.endsWith('.html')
        if (/text\/html/.test(type) && !looksLikePage) poisoned.push(`${n} ${u.pathname}`)
        if (!looksLikePage && !u.pathname.startsWith('/assets/')) urls.add(u.pathname)
      }
    }
    const served = {}
    for (const path of urls) {
      try {
        const r = await fetch(path)
        served[path] = r.ok ? hex(await crypto.subtle.digest('SHA-256', await r.arrayBuffer())) : `status ${r.status}`
      } catch (e) {
        served[path] = `error ${e.message}`
      }
    }
    return { served, poisoned, names: await caches.keys() }
  })
}

function assertFresh(label, audit, dist) {
  const stale = []
  for (const [path, got] of Object.entries(audit.served)) {
    const file = join(dist, decodeURIComponent(path))
    if (!existsSync(file)) continue // a file v2 dropped; nothing current to compare against
    if (got !== sha(readFileSync(file))) stale.push(path)
  }
  check(`${label}: every cached runtime file served is the deployed one`, stale.length === 0,
    stale.length ? `${stale.length} stale: ${stale.slice(0, 6).join(', ')}` : `${Object.keys(audit.served).length} files compared`)
  check(`${label}: no HTML cached under a script/wasm URL`, audit.poisoned.length === 0, audit.poisoned.slice(0, 4).join(', '))
}

async function assertOnV2(label, page) {
  const entry = await page.evaluate(() => document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null)
  check(`${label}: the page is the deployed build`, entry === V2_ENTRY, `entry ${entry}`)
}

function reportRun(label, lang, r) {
  const how = r.healed ? ' (after one self-heal reload)' : ''
  check(`${label}: ${lang} runs`, r.kind === 'ok', r.kind === 'ok' ? `ok${how}` : `${r.kind}${r.text ? ': ' + r.text.replace(/\s+/g, ' ').slice(0, 160) : ''}`)
}

/** Engines that cannot start offline however well the worker caches, and why.
 *  Run anyway and reported as WARN, so a change that fixes one shows up. */
const OFFLINE_LIMITS = {
  java: "CheerpJ's loader arrives via a no-cors importScripts() (opaque, never stored) and lazily range-reads JVM modules a first run did not touch",
  c: 'Wasmer resolves clang/clang with a POST to registry.wasmer.io/graphql, which no cache can answer',
}

/** The cross-origin URLs sitting in Warsha's caches: the runtime CDN downloads. */
async function crossOriginCached(page) {
  const urls = await page.evaluate(async () => {
    const out = []
    for (const n of await caches.keys()) {
      if (!n.startsWith('warsha-')) continue
      for (const req of await (await caches.open(n)).keys()) {
        if (new URL(req.url).origin !== location.origin) out.push(req.url)
      }
    }
    return out
  })
  return new Set(urls)
}

const summarizeHosts = (urls) => {
  const by = {}
  for (const u of urls) by[new URL(u).host] = (by[new URL(u).host] ?? 0) + 1
  return Object.entries(by).map(([h, n]) => `${h} ${n}`).join(', ')
}

/** Every network request the service worker makes for one of `urls` from now
 *  until stop() — i.e. a runtime download the cache should have answered. Range
 *  reads are left out: they bypass the cache by design (tools/qa/sw-range.mjs). */
function watchRefetches(urls) {
  const hits = []
  const pending = []
  const on = (req) => {
    if (!req.serviceWorker() || req.method() !== 'GET' || !urls.has(req.url()) || req.headers().range) return
    pending.push(req.response().then(async (res) => {
      // sizes() reports -1 for a service worker's requests; the header, else
      // the body itself, is the honest count of what came down the wire.
      const sizes = await req.sizes().catch(() => ({ responseBodySize: -1 }))
      let bytes = sizes.responseBodySize
      if (!(bytes > 0)) bytes = Number(res?.headers()['content-length'] ?? 0)
      if (!(bytes > 0)) bytes = (await res?.body().catch(() => null))?.length ?? 0
      hits.push({ url: req.url(), status: res?.status(), bytes })
    }).catch(() => hits.push({ url: req.url(), status: 'failed', bytes: 0 })))
  }
  ctx.on('request', on)
  return {
    async stop() {
      ctx.off('request', on)
      await Promise.all(pending)
      return hits
    },
  }
}

// ------------------------------------------------------------------ the scenarios
process.on('exit', stopNginx)
startNginx()
try {
  deploy(V1, AGE_DAYS)
  await new Promise((r) => setTimeout(r, 800))
  const probe = await fetch(BASE).catch((e) => ({ status: e.message }))
  if (probe.status !== 200) throw new Error(`nginx is not serving ${BASE}: ${probe.status}`)

  if (SCENARIOS.includes('A') || SCENARIOS.includes('C')) {
    console.log('\n-- A. returning visitor: v1 visited, tab closed, v2 deployed, comes back')
    deploy(V1, AGE_DAYS)
    await launch()
    let page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(BASE, { waitUntil: 'load' })
    await waitControlled(page)
    // Let install's precache finish so v1 is cached the way a real visit leaves it.
    check('A: v1 is installed', await waitShell(page, V1_SHELL))
    for (const lang of LANGS) {
      const r = await runLang(page, lang)
      check(`A v1 warm-up: ${lang} runs`, r.kind === 'ok', r.kind)
    }
    // What v1 left downloaded from the runtime CDNs. A deploy changes none of
    // these URLs, so v2 must never fetch one of them again.
    const v1Downloads = await crossOriginCached(page)
    info(`v1 cached ${v1Downloads.size} cross-origin runtime files: ${summarizeHosts([...v1Downloads])}`)
    // Two things an older worker could have left behind, planted on purpose:
    //  - `/` fetched as data, exactly as ui/staleBuild.ts does on any failure. A
    //    worker that cached it long-term would, after the deploy, boot that old
    //    page offline — whose entry chunk the deploy pruned: a blank screen.
    //  - the prod nginx's SPA-fallback HTML stored under real /assets/*.wasm
    //    URLs, by the pre-fix worker, in its legacy cache and in the long-lived
    //    one. Neither may ever be served as the wasm again.
    await page.evaluate(() => fetch('/').then((r) => r.text())).catch(() => {})
    await page.evaluate(async (urls) => {
      const html = () => new Response('<!doctype html><title>poison</title>', { headers: { 'content-type': 'text/html' } })
      await (await caches.open('warsha-runtime-legacy00')).put(urls[0], html())
      await (await caches.open('warsha-keep')).put(urls[1] ?? urls[0], html())
    }, POISON_URLS)
    await ctx.close()

    deploy(V2, 0)
    info('deployed v2')

    for (const visit of ['first visit after deploy', 'second visit after deploy']) {
      await launch()
      page = ctx.pages()[0] ?? (await ctx.newPage())
      const errors = watch(page)
      const refetched = watchRefetches(v1Downloads)
      await page.goto(BASE, { waitUntil: 'load' })
      await page.waitForSelector('button:has-text("New project"), .cm-content', { timeout: 60000 })
        .then(() => pass(`A ${visit}: the shell booted`))
        .catch(() => fail(`A ${visit}: the shell booted`, 'no welcome panel or editor within 60s'))

      if (visit === 'first visit after deploy' && SCENARIOS.includes('C')) {
        // C. Right after the upgrade, before ANY language has run on v2: the v2
        // worker is in (and has evicted v1's per-build cache), then the network
        // goes. Every language the student already used must still be there.
        console.log('\n-- C. offline right after the upgrade, nothing run on v2 yet')
        check('C: the v2 service worker is installed', await waitShell(page, V2_SHELL))
        await ctx.setOffline(true)
        // `/` is the installed app's start_url: what a student taps on a plane.
        await page.goto(BASE, { waitUntil: 'load' }).catch(() => {})
        await page.waitForSelector('.cm-content, button:has-text("New project")', { timeout: 30000 })
          .then(() => pass('C offline: the upgraded shell boots at /'))
          .catch(() => fail('C offline: the upgraded shell boots at /', 'blank — an older page was served'))
        await assertOnV2('C offline', page)
        // The runtime files the worker serves offline are this build's, not the
        // previous one's — staleBuild cannot catch a mismatch with no network.
        assertFresh('C offline', await cacheAudit(page), V2)
        for (const lang of LANGS) {
          const r = await runLang(page, lang)
          if (OFFLINE_LIMITS[lang]) {
            console.log(`${r.kind === 'ok' ? 'PASS' : 'WARN'}  C offline: ${lang} runs :: ${r.kind}${r.kind === 'ok' ? '' : ' — known limit: ' + OFFLINE_LIMITS[lang]}`)
          } else {
            reportRun('C offline', lang, r)
          }
        }
        await ctx.setOffline(false)
        console.log('\n-- A (cont.) back online')
      }

      if (visit === 'first visit after deploy') {
        const served = await page.evaluate(async (urls) => Promise.all(urls.map(async (u) => {
          const r = await fetch(u)
          const head = new Uint8Array(await r.arrayBuffer()).slice(0, 4)
          return { u, status: r.status, type: r.headers.get('content-type'), wasm: head[0] === 0 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d }
        })), POISON_URLS)
        check('A: an HTML page cached under a wasm URL by an older worker is never served', served.every((x) => x.wasm),
          served.map((x) => `${x.u.split('/').pop()} ${x.status} ${x.type}${x.wasm ? '' : ' NOT WASM'}`).join(', '))
      }
      for (const lang of LANGS) reportRun(`A ${visit}`, lang, await runLang(page, lang, { allowHeal: true }))
      await assertOnV2(`A ${visit}`, page)
      assertFresh(`A ${visit}`, await cacheAudit(page), V2)
      const again = await refetched.stop()
      check(`A ${visit}: no runtime file v1 downloaded is downloaded again`, again.length === 0,
        again.length
          ? `${again.length} refetched, ${(again.reduce((n, r) => n + r.bytes, 0) / 1e6).toFixed(1)} MB: ${again.slice(0, 4).map((r) => r.url).join(', ')}`
          : `0 of ${v1Downloads.size} refetched, 0 bytes`)
      check(`A ${visit}: no platform errors in the console`, errors.length === 0, errors.slice(0, 3).join(' | '))
      await ctx.close()
    }
  }

  if (SCENARIOS.includes('B')) {
    console.log('\n-- B. tab left open across the deploy')
    deploy(V1, AGE_DAYS)
    await launch(mkdtempSync(join(tmpdir(), 'warsha-upgrade-tab-')))
    const old = ctx.pages()[0] ?? (await ctx.newPage())
    const errors = watch(old)
    await old.goto(BASE, { waitUntil: 'load' })
    await waitControlled(old)
    await old.waitForSelector('button:has-text("New project"), .cm-content', { timeout: 60000 })

    check('B: v1 is installed in the open tab', await waitShell(old, V1_SHELL))
    deploy(V2, 0)
    info('deployed v2 while the v1 tab stays open')
    const fresh = await ctx.newPage()
    await fresh.goto(BASE, { waitUntil: 'load' })
    // A second tab's navigation is what makes the browser fetch the new worker;
    // wait until it has taken over (v1's caches gone) before going back.
    check('B: the v2 service worker took over and evicted v1\'s caches', await waitShell(fresh, V2_SHELL))
    info(`caches ${JSON.stringify(await fresh.evaluate(() => caches.keys()))}`)
    await fresh.close()
    // And the browser has since evicted its HTTP cache (it does, under storage
    // pressure). Otherwise the old tab's chunks are still in it and the tab only
    // works by luck — this makes it face the deploy for real: v1's hashed chunks
    // are gone from the server and from every cache.
    const cdp = await ctx.newCDPSession(old)
    await cdp.send('Network.clearBrowserCache')
    await cdp.detach()

    await old.bringToFront()
    for (const lang of LANGS) reportRun('B old tab', lang, await runLang(old, lang, { allowHeal: true }))
    await assertOnV2('B old tab', old)
    if (errors.healed.length) info(`self-healed past ${errors.healed.length} error(s), first: ${errors.healed[0]}`)
    check('B old tab: no platform errors in the console', errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }
} finally {
  if (ctx) await ctx.close().catch(() => {})
  stopNginx()
  rmSync(SERVE, { recursive: true, force: true })
}

{
  const inPreview = (v) => v.where.startsWith('about:srcdoc') || /about:srcdoc/.test(v.text)
  const own = cspViolations.filter((v) => !inPreview(v))
  const preview = cspViolations.filter(inPreview)
  console.log('\n-- Content-Security-Policy')
  const distinct = (list) => [...new Set(list.map((v) => `${v.where || '?'} :: ${v.text.replace(/\s+/g, ' ').slice(0, 160)}`))]
  check('CSP: no violation on Warsha\'s own pages, workers included', own.length === 0,
    own.length ? `${own.length}: ${distinct(own).slice(0, 4).join(' || ')}` : `${cspViolations.length} violations seen in total`)
  if (preview.length) {
    info(`${preview.length} in the Web preview (student code, inheriting the page policy):`)
    for (const t of distinct(preview).slice(0, 6)) info(`  ${t}`)
  }
}

const failed = results.filter((r) => !r).length
console.log(`\n==== ${results.length - failed}/${results.length} checks passed ====`)
process.exit(failed ? 1 : 0)
