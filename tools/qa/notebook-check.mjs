/* Notebooks (.ipynb), end to end in Chrome against the REAL Pyodide kernel.
 *
 * Needs a DEV server (part K drives the kernel through the dev-only seam
 * `window.__warshaRuntime.kernelFor`, app/src/runtime/index.ts):
 *
 *   cd app && npx vite --port 8120 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8120/ CHROME=... node notebook-check.mjs
 *
 * K  the kernel contract (app/src/runtime/types.ts NotebookKernel): one
 *    namespace per notebook across cells, last-expression results, rich
 *    display (pandas HTML, matplotlib PNG, IPython.display shims), input(),
 *    the magics and the shell, cell-labelled tracebacks on the right line,
 *    SyntaxError lines, Interrupt (namespace survives; also out of input()),
 *    restart, two notebooks with separate namespaces, file write-back, and
 *    the debugger per cell — a breakpoint in a cell, stepping into a
 *    function defined in an EARLIER cell (whose frame names that cell).
 * U  the notebook UI: a notebook starter from the template picker, Run all
 *    with execution counts, Shift+Enter advancing, the command-mode keys
 *    (B, A, M, Y, DD, Z), input() inside a cell, IntelliSense resolving a
 *    DataFrame from an earlier cell, the saved .ipynb (valid nbformat 4.5,
 *    outputs kept), no horizontal page scroll on a phone, and RTL.
 * Screenshots (phone + desktop, LTR + RTL) land in tools/qa/screenshots/.
 * P  projects never share a notebook (QA B1): every notebook template saves as
 *    notebook.ipynb, so project A's notebook → Home → a new notebook project B
 *    must show B's own cells and run them, and after an edit + save + reload A
 *    and B must each still hold their own notebook in OPFS.
 * ONLY=K, ONLY=U or ONLY=P runs one part. */
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8120/'
const ONLY = process.env.ONLY ?? 'KUP'
const SHOTS = new URL('./screenshots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const results = []
const pass = (n, d = '') => { results.push(['PASS', n]); console.log(`PASS  ${n}${d ? ' :: ' + d : ''}`) }
const fail = (n, d = '') => { results.push(['FAIL', n]); console.log(`FAIL  ${n}${d ? ' :: ' + d : ''}`) }
const check = (n, ok, d = '') => (ok ? pass(n, d) : fail(n, d))
const J = (x) => JSON.stringify(x)

async function browser(viewport = { width: 1280, height: 860 }, mobile = false) {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-nb-')), {
    executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
    headless: true,
    viewport,
    ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('pageerror', (e) => console.log('      pageerror: ' + e.message))
  // Mute Vite's HMR socket so an edit elsewhere cannot reload the page mid-scenario.
  await page.routeWebSocket(/./, () => {})
  return { ctx, page }
}

async function isolated(page, path = '') {
  await page.goto(URL_ + path)
  for (let i = 0; i < 3; i++) {
    try {
      await page.waitForFunction(() => self.crossOriginIsolated && window.__warshaRuntime, null, { timeout: 30000 })
      return
    } catch {
      await page.reload()
    }
  }
}

/* ===================================================================== K */
if (ONLY.includes('K')) {
  const { ctx, page } = await browser()
  await isolated(page)
  check('K: page is cross-origin isolated with the dev seam', await page.evaluate(() => self.crossOriginIsolated && !!window.__warshaRuntime?.kernelFor))

  await page.evaluate(async () => {
    const { transformCell } = await import('/src/notebook/magics.ts')
    const k = window.__warshaRuntime.kernelFor('nb.ipynb')
    const T = (window.__K = { k, s: null, rec: null, stdin: [] })
    T.files = [
      { path: 'data.csv', content: 'a,b\n1,2\n3,4\n' },
      { path: 'helper.py', content: 'def sq(x):\n    return x * x\nprint("helper ran")\n' },
    ]
    T.start = async (src, id = 'c', opts = {}) => {
      const t = transformCell(src)
      const rec = (T.rec = { ev: [], out: '', err: '', outputs: [], exit: undefined, stops: [], resumes: 0, count: null })
      T.s = await k.execute(
        T.files,
        { notebook: opts.nb ?? 'nb.ipynb', workspace: opts.ws ?? 'qa', cellPath: `${opts.nb ?? 'nb.ipynb'}#cell=${id}`, source: src, code: t.code, cellMagic: t.cellMagic, pip: t.pip },
        {
          onStdout: (x) => { rec.out += x },
          onStderr: (x) => { rec.err += x },
          onStdinRequest: () => {
            rec.ev.push('stdin')
            const line = T.stdin.shift()
            if (line !== undefined) setTimeout(() => T.s.writeStdin(line), 30)
          },
          onExecuteInput: (n) => { rec.count = n },
          onOutput: (kind, o) => rec.outputs.push({ kind, o }),
          onFilesChanged: (c) => { rec.files = c },
          onDebugStop: (s) => rec.stops.push(s),
          onDebugResume: () => { rec.resumes++ },
          onExit: (c) => { rec.exit = c },
        },
        opts.debug ? { debug: { breakpoints: opts.debug } } : undefined,
      )
    }
    T.cell = async (src, id, opts) => {
      await T.start(src, id, opts)
      await new Promise((r) => { const t = setInterval(() => { if (T.rec.exit !== undefined) { clearInterval(t); r() } }, 20) })
      return T.rec
    }
  })
  const cell = (src, id = 'c', opts = {}) => page.evaluate(([s, i, o]) => window.__K.cell(s, i, o), [src, id, opts])
  const result = (r) => r.outputs.find((x) => x.kind === 'result')?.o.data['text/plain']
  const errorOf = (r) => r.outputs.find((x) => x.kind === 'error')?.o

  const t0 = Date.now()
  let r = await cell('x = 41\nx + 1', 'a')
  console.log(`      kernel booted + first cell in ${Date.now() - t0} ms`)
  check('K: last expression is the result, In[1]', result(r) === '42' && r.count === 1 && r.exit === 0, J({ res: result(r), count: r.count }))
  r = await cell('x', 'b')
  check('K: the namespace persists across cells', result(r) === '41' && r.count === 2)
  r = await cell('x;', 'b')
  check('K: a trailing semicolon suppresses the result', !result(r))

  await page.evaluate(() => { window.__K.stdin = ['Saad'] })
  r = await cell('name = input("Name: ")\nname.upper()', 'c')
  check('K: input() works in a cell', r.ev.includes('stdin') && r.out.includes('Name: ') && result(r) === "'SAAD'", J({ out: r.out, res: result(r) }))

  r = await cell('def f(a):\n    return 1 / a\n\nf(0)', 'd')
  const e = errorOf(r)
  check('K: an error is an error output, exit 1', r.exit === 1 && e?.ename === 'ZeroDivisionError')
  check('K: the traceback names the cell and its lines', !!e && e.traceback.some((l) => /Cell In\[\d+\], line 4/.test(l)) && e.traceback.some((l) => /line 2, in f/.test(l)), J(e?.traceback))
  r = await cell('a = 1\nfor i in range(3)\n    pass', 'e')
  check('K: a SyntaxError points at the cell line', errorOf(r)?.ename === 'SyntaxError' && errorOf(r).traceback.some((l) => /line 2/.test(l)), J(errorOf(r)))

  r = await cell('%time s = sum(range(1000))\n%who', 'f')
  check('K: %time and %who', r.out.includes('Wall time') && /\bs\b/.test(r.out) && /\bx\b/.test(r.out), r.out)
  r = await cell('%timeit -n 5 -r 2 sum(range(100))', 'g')
  check('K: %timeit', /per loop \(mean ± std\. dev\. of 2 runs, 5 loops each\)/.test(r.out), r.out)
  r = await cell('%%time\nt = 3\nt * 2', 'h')
  check('K: %%time runs the body and shows its result', r.out.includes('Wall time') && result(r) === '6')
  r = await cell('!ls\nfiles = !ls\n!cat data.csv | head -n 2\nlen(files)', 'i')
  check('K: !ls, captured !ls, a pipe', r.out.includes('data.csv') && r.out.includes('a,b\n1,2') && result(r) === '2', J({ out: r.out, res: result(r) }))
  r = await cell('%run helper.py\nsq(7)', 'j')
  check('K: %run brings a file\'s names into the notebook', r.out.includes('helper ran') && result(r) === '49')
  r = await cell('%%writefile out.txt\nhello notebook', 'k')
  check('K: %%writefile writes and the file comes back to the project', r.out.includes('Writing out.txt') && r.files?.written?.some((f) => f.path === 'out.txt' && f.content === 'hello notebook\n'), J(r.files))
  r = await cell('%nosuchmagic', 'l')
  check('K: an unknown magic is a clear UsageError, not a crash', errorOf(r)?.ename === 'UsageError' && /not found/.test(errorOf(r).evalue))
  r = await cell('len?', 'm')
  check('K: help with obj?', r.out.includes('Signature') && r.out.includes('Return the number of items'), r.out)
  r = await cell('from IPython.display import display, HTML, Markdown\ndisplay(HTML("<b>hi</b>"))\ndisplay(Markdown("**md**"))', 'n')
  const disp = r.outputs.filter((x) => x.kind === 'display').map((x) => Object.keys(x.o.data))
  check('K: IPython.display shims (HTML, Markdown)', disp.some((k) => k.includes('text/html')) && disp.some((k) => k.includes('text/markdown')), J(disp))

  r = await cell('import pandas as pd\ndf = pd.read_csv("data.csv")\ndf', 'o')
  const html = r.outputs.find((x) => x.kind === 'result')?.o.data['text/html']
  check('K: a DataFrame displays as an HTML table', r.exit === 0 && /<table/.test(html ?? ''), r.err.slice(0, 200))
  r = await cell('import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nplt.show()', 'p')
  const png = r.outputs.find((x) => x.kind === 'display' && x.o.data['image/png'])
  check('K: matplotlib draws an inline PNG', r.exit === 0 && !!png && png.o.metadata?.['image/png']?.width > 0, r.err.slice(0, 300))
  r = await cell('plt.plot([3, 1])', 'q')
  check('K: a figure left open is flushed after the cell', r.outputs.some((x) => x.o.data?.['image/png']))

  // Interrupt: a busy loop, then the same namespace afterwards.
  await page.evaluate(() => window.__K.start('import time\nn = 0\nwhile True:\n    n += 1', 'r'))
  await page.waitForTimeout(800)
  await page.evaluate(() => window.__K.k.interrupt())
  await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 8000 }).catch(() => {})
  r = await page.evaluate(() => window.__K.rec)
  check('K: Interrupt raises KeyboardInterrupt in the cell', r.exit === 1 && errorOf(r)?.ename === 'KeyboardInterrupt', J({ exit: r.exit, e: errorOf(r)?.ename }))
  r = await cell('(x, n > 0)', 's')
  check('K: …and the namespace survives it', result(r) === '(41, True)', result(r))

  await page.evaluate(() => { window.__K.stdin = [] })
  await page.evaluate(() => window.__K.start('v = input("wait: ")', 't'))
  await page.waitForFunction(() => window.__K.rec.ev.includes('stdin'), null, { timeout: 8000 })
  await page.evaluate(() => window.__K.k.interrupt())
  await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 8000 }).catch(() => {})
  r = await page.evaluate(() => window.__K.rec)
  check('K: Interrupt reaches a cell parked in input()', errorOf(r)?.ename === 'KeyboardInterrupt', J({ exit: r.exit, e: errorOf(r) }))

  // A function keeps quoting the lines it was compiled from after its cell is edited and re-run.
  await cell('def g():\n    return 1 / 0', 'stale')
  await cell('# g was here; this cell now says something else\nprint("edited")', 'stale')
  r = await cell('g()', 'stale2')
  check('K: a traceback through a function from an edited cell quotes its original line', !!errorOf(r) && errorOf(r).traceback.some((l) => l.includes('return 1 / 0')) && !errorOf(r).traceback.some((l) => l.includes('print("edited")')), J(errorOf(r)?.traceback))

  r = await cell('x', 'u', { nb: 'other.ipynb' })
  check('K: another notebook has its own namespace', errorOf(r)?.ename === 'NameError')
  await page.evaluate(() => window.__K.k.restart('nb.ipynb'))
  r = await cell('x', 'v')
  check('K: restart clears the namespace, and counts start over', errorOf(r)?.ename === 'NameError' && r.count === 1, J({ e: errorOf(r)?.ename, count: r.count }))

  // Debugger per cell: cell A defines a function; cell B calls it with a breakpoint in B.
  await cell('def add(a, b):\n    s = a + b\n    return s', 'dbgA')
  await page.evaluate(() => window.__K.start('p = 2\nq = add(p, 3)\nprint(q)', 'dbgB', { debug: [{ path: 'nb.ipynb#cell=dbgB', line: 2 }] }))
  await page.waitForFunction(() => window.__K.rec.stops.length >= 1, null, { timeout: 15000 }).catch(() => {})
  let st = await page.evaluate(() => window.__K.rec.stops.at(-1))
  check('K: a breakpoint in a cell stops on its cell-local line', st?.reason === 'breakpoint' && st.frames[0].path === 'nb.ipynb#cell=dbgB' && st.frames[0].line === 2, J(st?.frames?.map((f) => [f.path, f.line])))
  const locals = st?.frames[0].scopes[0].variables.map((v) => v.name) ?? []
  check('K: the cell frame shows its variables, not the kernel\'s machinery', locals.includes('p') && !locals.includes('In') && !locals.includes('_warsha_k') && !locals.includes('get_ipython'), J(locals))
  await page.evaluate(() => window.__K.s.debug.resume('stepInto'))
  await page.waitForFunction(() => window.__K.rec.stops.length >= 2, null, { timeout: 15000 }).catch(() => {})
  st = await page.evaluate(() => window.__K.rec.stops.at(-1))
  check('K: step into a function from an earlier cell lands in THAT cell', st?.frames[0].path === 'nb.ipynb#cell=dbgA' && st.frames[0].line === 2 && st.frames[0].name === 'add', J(st?.frames?.map((f) => [f.name, f.path, f.line])))
  const ev = await page.evaluate(() => window.__K.s.debug.evaluate('a + b', 0))
  check('K: evaluate in the cell frame', ev?.value === '5', J(ev))
  await page.evaluate(() => window.__K.s.debug.resume('continue'))
  await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 10000 }).catch(() => {})
  r = await page.evaluate(() => window.__K.rec)
  check('K: continue finishes the cell', r.exit === 0 && r.out.includes('5'))
  r = await cell('q', 'dbgC')
  check('K: a debugged cell\'s variables stay in the namespace', result(r) === '5')

  // ---- review fixes (kernel side) ----
  // #10: Interrupt while the cell's packages are still downloading skips the cell; no kernel kill.
  const epoch0 = await page.evaluate(() => window.__K.k.epoch)
  await page.evaluate(() => window.__K.start('import sympy\nsympy.__version__', 'pkgint'))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.__K.k.interrupt())
  await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 120000 }).catch(() => {})
  r = await page.evaluate(() => window.__K.rec)
  check('K #10: Interrupt during a package download ends the cell with KeyboardInterrupt; the kernel lives', errorOf(r)?.ename === 'KeyboardInterrupt' && (await page.evaluate(() => window.__K.k.epoch)) === epoch0, J({ exit: r.exit, e: errorOf(r)?.ename }))
  r = await cell('x = 5\nx', 'alive')
  check('K #10: …and the next cell runs in the same interpreter', result(r) === '5')
  // Suspected: sys.stdin.readline() used to swallow Interrupt as an empty line.
  await page.evaluate(() => window.__K.start('import sys\nline = sys.stdin.readline()\nprint("got", repr(line))', 'readline'))
  await page.waitForFunction(() => window.__K.rec.ev.includes('stdin'), null, { timeout: 8000 }).catch(() => {})
  await page.evaluate(() => window.__K.k.interrupt())
  await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 8000 }).catch(() => {})
  r = await page.evaluate(() => window.__K.rec)
  check('K suspected: Interrupt reaches sys.stdin.readline() as KeyboardInterrupt, not an empty line', errorOf(r)?.ename === 'KeyboardInterrupt' && !r.out.includes('got'), J({ out: r.out, e: errorOf(r)?.ename }))
  // Suspected: NaN in a display payload.
  r = await cell('display({"application/json": {"v": float("nan")}, "text/plain": "nan here"}, raw=True)\n"after"', 'nan')
  check('K suspected: a NaN in a display payload arrives (as "nan"), and the cell finishes', r.exit === 0 && result(r) === "'after'" && r.outputs.some((x) => x.o?.data?.['application/json']?.v === 'nan'), J({ exit: r.exit, err: r.err.slice(0, 200) }))
  // Suspected: one project's files are not visible to another project's cells.
  await cell('open("only_a.bin", "wb").write(bytes([0, 1, 2]))', 'wsA', { ws: 'project-A' })
  r = await cell('import os\nos.path.exists("only_a.bin")', 'wsB', { ws: 'project-B' })
  check('K suspected: files a cell wrote in project A are not in project B\'s working directory', result(r) === 'False', result(r))
  // Suspected: history is capped (IPython's cache_size) — 1,005 runs keep at most 1,000.
  await page.evaluate(async () => { for (let i = 0; i < 1005; i++) await window.__K.cell(String(i), 'cap' + (i % 3), { nb: 'cap.ipynb' }) })
  // The run asking is the 1,001st entry: 1,000 kept plus itself.
  r = await cell('(len(Out), len(_warsha_k.sources) <= 1001, "_1" in globals())', 'capcheck', { nb: 'cap.ipynb' })
  check('K suspected: Out, sources and _N stay capped at 1,000 runs', result(r) === '(1000, True, False)', result(r))
  // 11b: the kernel says when it is busy, so formatting goes to a free engine instead of waiting.
  await page.evaluate(() => window.__K.start('import time\ntime.sleep(1.5)', 'busy'))
  await page.waitForTimeout(300)
  const busyNow = await page.evaluate(() => window.__K.k.isBusy())
  await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 10000 })
  check('K 11b: the kernel reports isBusy() while a cell runs, and not after', busyNow && !(await page.evaluate(() => window.__K.k.isBusy())))

  if (process.env.PIP !== '0') {
    r = await cell('%pip install -q snowballstemmer\nimport snowballstemmer\nsnowballstemmer.stemmer("english").stemWord("running")', 'w')
    check('K: %pip installs a pure-Python package from PyPI before the cell runs', result(r) === "'run'", J({ err: r.err.slice(0, 300), out: r.out.slice(0, 200), res: result(r) }))
    // C: Interrupt while %pip is installing reports an interrupted cell, not a runtime error.
    await page.evaluate(() => window.__K.start('%pip install pyfiglet\nimport pyfiglet', 'pipint'))
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__K.k.interrupt())
    await page.waitForFunction(() => window.__K.rec.exit !== undefined, null, { timeout: 60000 }).catch(() => {})
    r = await page.evaluate(() => window.__K.rec)
    check('K C: Interrupt during %pip ends the cell as KeyboardInterrupt, not a runtime error', errorOf(r)?.ename === 'KeyboardInterrupt' && !r.err.includes('runtime error'), J({ exit: r.exit, e: errorOf(r)?.ename, err: r.err.slice(0, 200) }))
    r = await cell('!pip install definitely-not-a-real-package-xyz', 'x')
    check('K: a failed pip install explains itself and does not crash the cell', r.exit === 0 && /ERROR: Could not install/.test(r.err), r.err.slice(0, 300))
  }
  await ctx.close()
}

/* ===================================================================== U */
async function newNotebookProject(page, template, lang = 'en') {
  await page.goto(URL_ + `?lang=${lang}`)
  const btn = page.locator('button', { hasText: lang === 'en' ? /^New project$/ : /مشروع جديد/ }).first()
  await btn.waitFor({ timeout: 60000 })
  await btn.click()
  await page.locator('dialog[open]').getByRole('button', { name: /^Python/ }).first().click()
  await page.locator('.template-card').filter({ hasText: template }).first().click()
  await page.waitForSelector('.notebook-view [data-cell-id]', { timeout: 30000 })
  await page.waitForTimeout(600)
}

const kernelIdle = (page, timeout = 120000) =>
  page.waitForFunction(() => {
    const k = document.querySelector('[data-kernel]')
    return k && k.getAttribute('data-kernel') === 'idle' && !k.hasAttribute('data-busy')
  }, null, { timeout })

const savedNotebook = (page) =>
  page.evaluate(async () => {
    // The project's copy of the file, after the view's coalesced write.
    await new Promise((r) => setTimeout(r, 500))
    const tree = document.querySelector('[role="treeitem"][data-path$=".ipynb"]')
    return tree?.getAttribute('data-path') ?? null
  })

if (ONLY.includes('U')) {
  const { ctx, page } = await browser()
  await isolated(page, '?lang=en')
  await newNotebookProject(page, 'Data with pandas')
  check('U: a notebook starter opens in the notebook view', (await page.locator('.notebook-view [data-cell-id]').count()) >= 8)
  check('U: markdown cells are rendered (a heading, inline code)', (await page.locator('.nb-md h1').count()) === 1 && (await page.locator('.nb-md code').count()) >= 1)
  await page.screenshot({ path: join(SHOTS, 'notebook-desk-ltr-open.png') })

  const statusText = () => page.locator('footer').first().innerText()
  const st0 = await statusText()
  check('U: the status bar shows the kernel, not "No entry point"', st0.includes('Python not started') && !st0.includes('No entry point'), J(st0))
  // The tab strip's Run (the project's one Run) runs all cells when a notebook is the active tab.
  await page.locator('button[aria-label="Run notebook.ipynb"]').first().click()
  await kernelIdle(page)
  await page.waitForTimeout(500)
  check('U: …and follows it to "Python ready"', (await statusText()).includes('Python ready'))
  const counts = await page.$$eval('[data-count]', (els) => els.map((e) => e.textContent))
  check('U: Run all numbers every code cell in order', J(counts) === J(['[1]', '[2]', '[3]', '[4]', '[5]', '[6]']), J(counts))
  check('U: the DataFrame renders as a table in a script-less sandbox', await page.evaluate(() => {
    const f = document.querySelector('.nb-outputs iframe')
    return !!f && f.getAttribute('sandbox') === 'allow-same-origin allow-popups allow-popups-to-escape-sandbox' && !!f.contentDocument?.querySelector('table')
  }))
  check('U: the cell that wrote passed.csv put it in the explorer', (await page.locator('[role="treeitem"][data-path="passed.csv"]').count()) === 1)
  await page.screenshot({ path: join(SHOTS, 'notebook-desk-ltr-ran.png') })

  // IntelliSense: a new cell at the end sees df from cell 1.
  const last = page.locator('.notebook-view [data-cell-id]').last()
  await last.locator('.cm-content').click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('b')
  await page.waitForTimeout(400)
  await page.keyboard.type('df.he', { delay: 60 })
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {})
  const opts = await page.$$eval('.cm-tooltip-autocomplete li', (els) => els.map((e) => e.textContent))
  check('U: completion in a new cell offers DataFrame members of df from cell 1', opts.some((o) => /^head/.test(o)), J(opts.slice(0, 8)))
  await page.screenshot({ path: join(SHOTS, 'notebook-desk-ltr-completion.png') })
  check('U dup: a cell\'s completion rows carry the shared gloss (same languageStack as files)', (await page.locator('.cm-tooltip-autocomplete .cm-completionGloss').count()) > 0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('n = int(input("How many? "))\nn * 2')
  await page.keyboard.press('Shift+Enter')
  await page.waitForSelector('input[aria-label="Cell input"]', { timeout: 15000 })
  await page.keyboard.type('21')
  await page.keyboard.press('Enter')
  await kernelIdle(page, 20000)
  await page.waitForTimeout(300)
  const outText = await page.locator('.notebook-view [data-cell-id]').nth(-2).innerText()
  check('U: input() in a cell takes an answer and the cell finishes', outText.includes('How many? 21') && outText.includes('42'), outText.slice(-80))
  check('U: Shift+Enter on the last cell added a new code cell and moved into it', await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.notebook-view [data-cell-id]')]
    return cells.at(-1).getAttribute('data-cell-type') === 'code' && cells.at(-1).querySelector('.cm-focused') !== null
  }))

  // Command mode keys.
  const nCells = () => page.locator('.notebook-view [data-cell-id]').count()
  const before = await nCells()
  await page.keyboard.press('Escape')
  await page.keyboard.press('a')
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape')
  check('U: A inserts a cell above', (await nCells()) === before + 1)
  await page.keyboard.press('m')
  await page.waitForTimeout(250)
  const typeNow = await page.evaluate(() => document.querySelector('.notebook-view [data-selected]')?.getAttribute('data-cell-type'))
  await page.keyboard.press('y')
  await page.waitForTimeout(250)
  const typeBack = await page.evaluate(() => document.querySelector('.notebook-view [data-selected]')?.getAttribute('data-cell-type'))
  check('U: M makes it a text cell, Y back to code', typeNow === 'markdown' && typeBack === 'code', J([typeNow, typeBack]))
  await page.keyboard.press('d')
  await page.keyboard.press('d')
  await page.waitForTimeout(250)
  check('U: DD deletes the cell', (await nCells()) === before)
  await page.keyboard.press('z')
  await page.waitForTimeout(250)
  check('U: Z brings it back', (await nCells()) === before + 1)
  await page.keyboard.press('d')
  await page.keyboard.press('d')
  await page.waitForTimeout(400)

  // Debugging a cell from the UI: a breakpoint on its line-number gutter, Debug cell, the stop arrow in that cell.
  await page.keyboard.press('Escape')
  await page.keyboard.press('b')
  await page.waitForTimeout(400)
  await page.keyboard.insertText('a = 1\nb = a + 1\nb * 10')
  await page.keyboard.press('Escape')
  const dcell = page.locator('.notebook-view [data-selected]')
  const dcellId = await dcell.getAttribute('data-cell-id')
  // Line numbers are off in cells (Colab); F9 on the line is the keyboard path to a breakpoint.
  await dcell.locator('.cm-line').nth(1).click()
  await page.keyboard.press('F9')
  await page.waitForTimeout(200)
  check('U: F9 on a cell line sets a breakpoint on its cell path', await page.evaluate((id) => {
    const raw = Object.keys(localStorage).filter((k) => k.startsWith('warsha.debug.v1.')).map((k) => localStorage.getItem(k)).join('')
    return raw.includes(`notebook.ipynb#cell=${id}`) && raw.includes('"line":2')
  }, dcellId))
  await dcell.getByRole('button', { name: 'Cell actions' }).click()
  await page.getByRole('menuitem', { name: 'Debug cell' }).click()
  await page.waitForSelector('[data-debug-phase="paused"]', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(300)
  const stopped = await page.evaluate((id) => {
    const cell = document.querySelector(`[data-cell-id="${id}"]`)
    return {
      arrow: !!cell?.querySelector('.cm-stop-arrow, .cm-ln-stop'),
      frames: (document.querySelector('[data-debug-phase]')?.textContent ?? '').match(/notebook\.ipynb \[\d+\]:\d+/g) ?? [],
    }
  }, dcellId)
  check('U: Debug cell stops at the breakpoint, the arrow is in that cell, Run and Debug names it', stopped.arrow && stopped.frames.some((f) => /:2$/.test(f)), J(stopped))
  await page.screenshot({ path: join(SHOTS, 'notebook-desk-ltr-debug.png') })
  const overlap = await page.evaluate(() => {
    const a = document.querySelector('.debug-toolbar')?.getBoundingClientRect()
    const b = document.querySelector('.notebook-toolbar')?.getBoundingClientRect()
    return !a || !b ? 'missing' : a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left
  })
  check('U: the debug toolbar docks below the notebook toolbar, not over it', overlap === false, J(overlap))
  await page.getByRole('button', { name: /^Continue/ }).first().click()
  await kernelIdle(page, 15000)
  await page.waitForTimeout(300)
  check('U: Continue finishes the cell with its result', (await dcell.innerText()).includes('20'))
  const hint = await page.locator('[data-debug-phase]').innerText()
  check('U: Run and Debug explains debugging a notebook cell', hint.includes('in a cell') && !hint.includes('Open a program'), J(hint.slice(0, 120)))
  await dcell.locator('.cm-line').nth(1).click()
  await page.keyboard.press('F9')

  // Format cell: black through the kernel, IPython lines untouched.
  await dcell.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('!echo hi\nx=[1,2 ,3]')
  await page.keyboard.press('Shift+Alt+F')
  await page.waitForFunction((id) => document.querySelector(`[data-cell-id="${id}"] .cm-content`)?.textContent?.includes('x = [1, 2, 3]'), dcellId, { timeout: 60000 }).catch(() => {})
  const fmt = await dcell.locator('.cm-content').innerText()
  check('U: Format cell runs black and keeps the !shell line', fmt.includes('x = [1, 2, 3]') && fmt.includes('!echo hi'), J(fmt))

  // An error: red state on the cell, the traceback as an error output, the queue stops.
  await dcell.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('def ratio(a, b):\n    return a / b\n\nratio(1, 0)')
  await page.keyboard.press('Control+Enter')
  await kernelIdle(page, 20000)
  await page.waitForTimeout(300)
  const errState = await dcell.getAttribute('data-state')
  const errText = await dcell.locator('[data-error]').innerText().catch(() => '')
  check('U: a failing cell shows its traceback (cell lines) and an error state', errState === 'error' && /Cell In\[\d+\], line 4/.test(errText) && errText.includes('ZeroDivisionError'), J({ errState, errText: errText.slice(0, 160) }))
  await dcell.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(SHOTS, 'notebook-desk-ltr-error.png') })

  // ---- review fixes (UI side) ----
  // Duplication fix: cells share the file editor's stack, so toggling an Extensions-view switch reaches open cells.
  const brackets = () => page.evaluate((id) => document.querySelectorAll(`[data-cell-id="${id}"] .cm-bracket-0`).length, dcellId)
  const hadBrackets = await brackets()
  await page.evaluate(async () => {
    const r = await import('/src/extensions/registry.ts')
    const s = await import('/src/editor/setup.ts')
    r.setExtEnabled('rainbow-brackets', !r.isExtEnabled('rainbow-brackets'))
    s.refreshEditorExtensions()
  })
  await page.waitForTimeout(300)
  const toggled = await brackets()
  await page.evaluate(async () => {
    const r = await import('/src/extensions/registry.ts')
    const s = await import('/src/editor/setup.ts')
    r.setExtEnabled('rainbow-brackets', !r.isExtEnabled('rainbow-brackets'))
    s.refreshEditorExtensions()
  })
  check('U dup: toggling Rainbow Brackets restyles an open cell live', (hadBrackets > 0) !== (toggled > 0), J({ hadBrackets, toggled }))

  // #5: a print loop keeps the page responsive and ends with every line on screen (or the trim note).
  await dcell.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('for i in range(20000):\n    print(i)')
  const t5 = Date.now()
  await page.keyboard.press('Control+Enter')
  let worst = 0
  while (Date.now() - t5 < 60000) {
    const p0 = Date.now()
    const done = await page.evaluate((id) => document.querySelector(`[data-cell-id="${id}"]`)?.getAttribute('data-state') === 'ok', await dcell.getAttribute('data-cell-id'))
    worst = Math.max(worst, Date.now() - p0)
    if (done) break
    await page.waitForTimeout(100)
  }
  const tail = (await dcell.locator('pre[data-stream="stdout"]').innerText()).trim().split('\n').pop()
  check('#5 U: for i in range(20000): print(i) stays responsive and finishes', worst < 500 && tail === '19999', J({ worst, ms: Date.now() - t5, tail }))
  // #6: \r progress frames printed one at a time show the last frame only.
  await dcell.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('import sys, time\nfor p in range(0, 101, 25):\n    sys.stdout.write(f"{p}%\\r"); sys.stdout.flush(); time.sleep(0.05)\nprint("done")')
  await page.keyboard.press('Control+Enter')
  await kernelIdle(page, 20000)
  await page.waitForTimeout(300)
  const prog = await dcell.locator('pre[data-stream="stdout"]').innerText()
  check('#6 U: \\r progress frames fold to the last one', prog.trim() === 'done', J(prog))
  // #1, #2, #7: a text cell with a smuggled javascript: link, a broken TeX environment and code in a link.
  await page.keyboard.press('Escape')
  await page.keyboard.press('b')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('m')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.keyboard.insertText('[evil](\u0001javascript:alert(1)) [tab](java\tscript:alert(2)) [away](//example.com) [`read_csv`](https://pandas.pydata.org)\n\n$\\begin{cases} a \\right) \\end{cases}$')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(500)
  const md = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.notebook-view [data-cell-type="markdown"] .nb-md')]
    const el = cells.at(-1)
    return el ? { hrefs: [...el.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]), text: el.textContent, math: !!el.querySelector('math') } : null
  })
  check('#1 U: smuggled javascript: links render without an href; //host opens in a new tab', !!md && md.hrefs.every(([, h]) => !h || !/script:/i.test(h)) && md.hrefs.some(([t, h, tg]) => t === 'away' && h === 'https://example.com' && tg === '_blank'), J(md?.hrefs))
  check('#7 U: a code span inside link text renders (no "undefined")', !!md && md.hrefs.some(([t]) => t === 'read_csv') && !md.text.includes('undefined'), J(md?.text))
  check('#2 U: a malformed TeX environment renders without hanging the page', !!md && md.math)
  // The same sanitizer guards links inside HTML outputs.
  await page.keyboard.press('Escape')
  await page.keyboard.press('b')
  await page.waitForTimeout(300)
  await page.keyboard.insertText('from IPython.display import HTML\nHTML(\'<a id="j" href="\\x01javascript:alert(1)">j</a> <a id="h" href="https://example.com">h</a>\')')
  await page.keyboard.press('Shift+Enter')
  await kernelIdle(page, 20000)
  await page.waitForTimeout(800)
  const frameLinks = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.nb-outputs iframe')].at(-1)
    const d = f?.contentDocument
    return d ? { j: d.getElementById('j')?.getAttribute('href') ?? null, h: d.getElementById('h')?.getAttribute('href'), sandbox: f.getAttribute('sandbox') } : null
  })
  check('#1 U: an HTML output\'s javascript: link loses its href; vetted links open as normal pages', !!frameLinks && frameLinks.j === null && frameLinks.h === 'https://example.com' && frameLinks.sandbox.includes('allow-popups-to-escape-sandbox'), J(frameLinks))

  // B: a notebook link cannot issue the app's #room= / #share= commands; a heading link scrolls in place.
  await page.keyboard.press('Escape')
  await page.keyboard.press('b')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.keyboard.press('m')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.keyboard.insertText('[join](#room=attacker) [import](#share=eJxz) [jump](#results-section)\n\n' + 'filler\n\n'.repeat(40) + '## Results section')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(500)
  const hashBefore = await page.evaluate(() => location.hash)
  const frag = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.notebook-view [data-cell-type="markdown"] .nb-md')].at(-1)
    return el ? [...el.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]) : null
  })
  const survives = await page.evaluate(async () => {
    const a = [...document.querySelectorAll('.notebook-view .nb-md a')].at(-1)
    a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))
    return a.isConnected
  })
  check('U: selecting a text cell keeps its rendered DOM (a click\'s target is not replaced mid-click)', survives)
  await page.locator('.notebook-view .nb-md a', { hasText: 'jump' }).last().click()
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => {
    const h = document.getElementById('nb-results-section')
    const r = h?.getBoundingClientRect()
    const s = document.querySelector('.notebook-scroller').getBoundingClientRect()
    return { hash: location.hash, inView: !!r && r.top >= s.top - 2 && r.top < s.bottom }
  })
  check('B U: #room= / #share= links render without an href', !!frag && frag.filter(([t]) => t === 'join' || t === 'import').every(([, h]) => h === null), J(frag))
  check('B U: a heading link scrolls inside the notebook and leaves location.hash alone', after.inView && after.hash === hashBefore, J({ ...after, hashBefore }))

  // The file on disk: valid nbformat 4.5 with outputs.
  const text = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 700))
    const mod = await import('/src/notebook/document.ts')
    mod.flushNotebooks()
    const view = document.querySelector('[data-notebook]')
    return view ? view.getAttribute('data-notebook') : null
  })
  check('U: the notebook view names its file', text === 'notebook.ipynb')
  // Download through the notebook's ⋯ menu: the .ipynb as a file.
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    (async () => {
      await page.getByRole('button', { name: 'More notebook actions' }).click()
      await page.getByRole('menuitem', { name: 'Download .ipynb' }).click()
    })(),
  ])
  let nbJson = null
  if (dl) {
    const p = await dl.path()
    nbJson = JSON.parse((await import('node:fs')).readFileSync(p, 'utf8'))
  }
  check('U: Download .ipynb gives a valid nbformat 4.5 notebook', nbJson?.nbformat === 4 && nbJson?.nbformat_minor === 5 && Array.isArray(nbJson.cells), J({ got: !!dl }))
  check('U: it keeps ids, execution counts and outputs (the DataFrame table)', !!nbJson && nbJson.cells.every((c) => typeof c.id === 'string') &&
    nbJson.cells.some((c) => c.execution_count === 1 && c.outputs.some((o) => o.output_type === 'execute_result' && o.data['text/html'])))
  check('U: no session-only keys leak into the file', !!nbJson && !JSON.stringify(nbJson).includes('"transient"'))

  // Suspected: "Open as text" while a cell is printing must not keep rewriting the JSON under the text editor.
  const lc = page.locator('.notebook-view [data-cell-id]').last()
  await lc.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.insertText('import time\nfor i in range(40):\n    print(i); time.sleep(0.1)')
  await page.keyboard.press('Control+Enter')
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'More notebook actions' }).click()
  await page.getByRole('menuitem', { name: 'Open as text' }).click()
  await page.waitForSelector('.editor-pane .cm-content', { timeout: 10000 })
  await page.waitForTimeout(400)
  const asText1 = await page.locator('.editor-pane .cm-content').innerText()
  await page.waitForTimeout(1500)
  const asText2 = await page.locator('.editor-pane .cm-content').innerText()
  check('U suspected: a notebook shown as text is no longer rewritten by its (closed) session', asText1 === asText2 && asText1.includes('"cells"'), J({ same: asText1 === asText2, len: asText1.length }))
  await ctx.close()

}

// Every surface: phone/desk × LTR/RTL — geometry included (ONLY=G runs just this part).
if (ONLY.includes('U') || ONLY.includes('G')) {
  for (const [w, h, mobile, lang, tag] of [
    [390, 844, true, 'en', 'phone-ltr'],
    [390, 844, true, 'ar', 'phone-rtl'],
    [1280, 860, false, 'ar', 'desk-rtl'],
    [1280, 860, false, 'en', 'desk-ltr'],
  ]) {
    const b = await browser({ width: w, height: h }, mobile)
    await isolated(b.page, `?lang=${lang}`)
    await newNotebookProject(b.page, lang === 'en' ? 'Plotting with matplotlib' : 'الرسوم مع matplotlib', lang)
    await b.page.screenshot({ path: join(SHOTS, `notebook-${tag}-open.png`) })
    if (mobile) check(`U[${tag}]: the notebook tab's badge is the notebook icon, not a placeholder`, await b.page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('.ipynb'))
      const chip = tab && [...tab.querySelectorAll('span[aria-hidden="true"]')].find((e) => getComputedStyle(e).display !== 'none' && e.querySelector('svg'))
      return !!chip && !tab.textContent.includes('[ ]') && !tab.textContent.includes('·')
    }))
    await b.page.locator('[role="toolbar"] button').filter({ has: b.page.locator('svg') }).nth(2).click() // Run all
    await kernelIdle(b.page)
    await b.page.waitForTimeout(800)
    await b.page.screenshot({ path: join(SHOTS, `notebook-${tag}-ran.png`) })
    const geo = await b.page.evaluate(() => ({
      page: document.documentElement.scrollWidth <= window.innerWidth + 1,
      dir: document.documentElement.dir,
      code: getComputedStyle(document.querySelector('.notebook-view .cm-editor')).direction,
      img: [...document.querySelectorAll('.nb-outputs img')].every((i) => i.getBoundingClientRect().right <= window.innerWidth + 1),
    }))
    check(`U[${tag}]: no horizontal page scroll; plots fit; code stays LTR`, geo.page && geo.img && geo.code === 'ltr', J(geo))
    if (lang === 'ar') check(`U[${tag}]: the page is RTL`, geo.dir === 'rtl')
    await cellGeometry(b.page, tag, lang, mobile)
    await b.ctx.close()
  }
}

/* ===================================================================== P */
/** Every project's notebook.ipynb as it is on disk (OPFS), by project name. */
const notebooksOnDisk = (page) =>
  page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const projects = await (await root.getDirectoryHandle('warsha')).getDirectoryHandle('projects')
    const out = {}
    for await (const [id, dir] of projects.entries()) {
      if (dir.kind !== 'directory') continue
      let name = id
      try {
        name = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()).name
      } catch { /* no manifest */ }
      try {
        const files = await dir.getDirectoryHandle('files')
        out[name] = await (await (await files.getFileHandle('notebook.ipynb')).getFile()).text()
      } catch { /* no notebook */ }
    }
    return out
  })
/** The notebook's first heading on screen — names which template's cells are showing. */
const shownHeading = (page) => page.locator('.notebook-view .nb-md h1').first().innerText({ timeout: 15000 }).catch(() => null)
const goHome = async (page) => {
  await page.locator('nav button[aria-label="Home"]').first().click()
  await page.locator('[role="region"][aria-label]').filter({ has: page.locator('button', { hasText: /^New project$/ }) }).first().waitFor({ timeout: 15000 })
}
const openFromHome = async (page, name) => {
  await page.locator(`button[aria-label="Open — ${name}"]`).first().click()
  await page.waitForSelector('.notebook-view [data-cell-id]', { timeout: 30000 })
  await page.waitForTimeout(600)
}

if (ONLY.includes('P')) {
  const { ctx, page } = await browser({ width: 1366, height: 768 })
  const refused = []
  page.on('console', (m) => { if (/cross-project notebook write|unsaved edits after the project switched/.test(m.text())) refused.push(m.text()) })
  await isolated(page, '?lang=en')
  // 1. Project A from "Data with pandas", run.
  await newNotebookProject(page, 'Data with pandas')
  await page.locator('button[aria-label="Run notebook.ipynb"]').first().click()
  await kernelIdle(page)
  await page.waitForTimeout(500)
  check('P: project A (pandas) shows its own notebook and ran', (await shownHeading(page)) === 'Data with pandas' && (await page.locator('[data-count]').count()) === 6)

  // 2. Home → New project → Python basics notebook, in the same page (no reload).
  await goHome(page)
  await page.locator('button', { hasText: /^New project$/ }).first().click()
  await page.locator('dialog[open]').getByRole('button', { name: /^Python/ }).first().click()
  await page.locator('.template-card').filter({ hasText: 'Python basics notebook' }).first().click()
  // A project is already open, so the starter asks for the new project's name first.
  await page.locator('dialog[open]').getByRole('button', { name: /^Create$/ }).click()
  await page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await page.waitForSelector('[role="treeitem"][data-path="scores.csv"]', { state: 'detached', timeout: 15000 }).catch(() => {})
  await page.waitForSelector('.notebook-view [data-cell-id]', { timeout: 30000 })
  await page.waitForTimeout(800)
  const hB = await shownHeading(page)
  const ranCounts = () => page.$$eval('.notebook-view [data-count]', (els) => els.filter((e) => /\[\d+\]/.test(e.textContent)).length)
  check('P: Home → new notebook project B shows B\'s cells, not A\'s (no A outputs)', /Python basics/.test(hB ?? '') && (await ranCounts()) === 0, J(hB))
  check('P: …and B\'s explorer has no A files', (await page.locator('[role="treeitem"][data-path="scores.csv"]').count()) === 0)
  await page.screenshot({ path: join(SHOTS, 'notebook-projects-b-open.png') })
  await page.locator('button[aria-label="Run notebook.ipynb"]').first().click()
  // The basics notebook asks for a name partway down: answer it, then let the rest finish.
  await page.waitForSelector('input[aria-label="Cell input"]', { timeout: 120000 }).then(async () => {
    await page.keyboard.type('Saad')
    await page.keyboard.press('Enter')
  }).catch(() => {})
  await kernelIdle(page)
  await page.waitForTimeout(500)
  check('P: Run all runs B\'s cells', /Python basics/.test((await shownHeading(page)) ?? '') && (await ranCounts()) > 0, J(await ranCounts()))

  // 3. Edit B, save.
  const firstCode = page.locator('.notebook-view [data-cell-id]').filter({ has: page.locator('.cm-content') }).first()
  await firstCode.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n# edited-in-B')
  await page.keyboard.press('Control+s')
  await page.waitForTimeout(1200)

  // 4. Back to A from Home: A's own cells.
  await goHome(page)
  await openFromHome(page, 'Data with pandas')
  check('P: Home → open A shows A\'s cells, not B\'s', (await shownHeading(page)) === 'Data with pandas')
  await goHome(page)
  await openFromHome(page, 'Python basics notebook')
  check('P: Home → open B again shows B with its edit', /Python basics/.test((await shownHeading(page)) ?? '') && (await page.locator('.notebook-view').innerText()).includes('# edited-in-B'))

  // 5. Reload: what is on disk.
  await page.reload()
  await page.waitForSelector('.notebook-view [data-cell-id]', { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(800)
  const disk = await notebooksOnDisk(page)
  const a = disk['Data with pandas'] ?? ''
  const b = disk['Python basics notebook'] ?? ''
  check('P: after reload A\'s notebook.ipynb is still the pandas notebook, untouched by B', a.includes('# Data with pandas') && !a.includes('Python basics') && !a.includes('edited-in-B'), J(a.slice(0, 120)))
  check('P: after reload B\'s notebook.ipynb is the basics notebook with B\'s edit', b.includes('Python basics') && b.includes('edited-in-B') && !b.includes('# Data with pandas'), J(b.slice(0, 120)))
  await page.screenshot({ path: join(SHOTS, 'notebook-projects-after-reload.png') })
  // The documents were scoped right in the first place: the write guard never had to step in.
  check('P: no cross-project write was ever attempted (the guard stayed silent)', refused.length === 0, J(refused))
  await ctx.close()
}

/* ---- cell geometry (docs/design/NOTEBOOK.md), asserted so the visual bugs cannot come back ---- */
async function cellGeometry(page, tag, lang, mobile) {
  const T = (n) => `U[${tag}] geometry: ${n}`
  // A ran code cell with outputs: text edge, run column, one frame, the rail, no overlaps.
  const ran = await page.evaluate((mobile) => {
    const cell = [...document.querySelectorAll('.notebook-view [data-cell-type="code"]')].find((c) => c.querySelector('.nb-outputs'))
    if (!cell) return null
    cell.scrollIntoView({ block: 'center' })
    const r = (el) => el.getBoundingClientRect()
    const box = cell.querySelector('[data-code-box]')
    const line = cell.querySelector('.cm-line')
    const codeText = r(line).left + parseFloat(getComputedStyle(line).paddingLeft)
    const firstOut = cell.querySelector('.nb-outputs > div > *') ?? cell.querySelector('.nb-outputs > button:not([data-output-menu])')
    const col = r(cell.querySelector('[data-run-col]'))
    const btn = cell.querySelector('[data-run]')
    const count = cell.querySelector('[data-count]')
    const menu = cell.querySelector('[data-output-menu]')
    const cx = (x) => x.left + x.width / 2
    const cy = (x) => x.top + x.height / 2
    const rail = getComputedStyle(cell, '::before')
    const cr = r(cell)
    const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    const outs = r(cell.querySelector('.nb-outputs'))
    return {
      outputEdge: Math.abs(r(firstOut).left - codeText),
      lineNumbers: cell.querySelectorAll('.cm-lineNumbers').length,
      boxBorder: parseFloat(getComputedStyle(box).borderTopWidth) + parseFloat(getComputedStyle(box).borderLeftWidth),
      nestedBorders: [...cell.querySelectorAll('*')].filter((e) => !e.closest('.cm-tooltip, [role="toolbar"], .nb-outputs, button') && parseFloat(getComputedStyle(e).borderTopWidth) > 0 && getComputedStyle(e).borderTopStyle !== 'none' && getComputedStyle(e).borderTopColor !== 'rgba(0, 0, 0, 0)').map((e) => e.className.toString().slice(0, 40)),
      runCentreX: btn ? Math.abs(cx(r(btn)) - cx(col)) : 0,
      countCentreX: Math.abs(cx(r(count)) - cx(col)),
      menuCentreX: menu && !mobile ? Math.abs(cx(r(menu)) - cx(col)) : 0,
      runCentreY: btn ? Math.abs(cy(r(btn)) - cy(r(line))) : 0,
      railInside: rail.content !== 'none' ? { top: parseFloat(rail.top), bottom: parseFloat(rail.bottom), width: parseFloat(rail.width), left: parseFloat(rail.insetInlineStart || rail.left) } : null,
      overlaps: [
        btn && overlap(r(btn), r(box)),
        overlap(r(box), outs),
        menu && getComputedStyle(menu).display !== 'none' && overlap(r(menu), outs.left < r(menu).left ? { ...outs.toJSON(), left: outs.left + parseFloat(cell.querySelector('.nb-outputs').style.paddingLeft || '0') } : outs),
        btn && !mobile && overlap(r(btn), outs),
      ].filter(Boolean).length,
      insideCell: [box, btn, count].filter(Boolean).every((e) => { const x = r(e); return x.left >= cr.left - 0.5 && x.right <= cr.right + 0.5 && x.top >= cr.top - 0.5 && x.bottom <= cr.bottom + 0.5 }),
    }
  }, mobile)
  if (!ran) return fail(T('a code cell with output exists'))
  check(T('output left edge == editor text edge'), ran.outputEdge <= 1, J(ran.outputEdge))
  check(T('line numbers are off by default'), ran.lineNumbers === 0)
  check(T('one frame: the code box has no border, nothing inside the cell is bordered'), ran.boxBorder === 0 && ran.nestedBorders.length === 0, J(ran.nestedBorders))
  check(T('run button, count and output menu are centred in the run column'), ran.runCentreX <= 1 && ran.countCentreX <= 1 && ran.menuCentreX <= 1, J(ran))
  check(T('the run button is level with the first code line'), ran.runCentreY <= 2, J(ran.runCentreY))
  check(T('no element overlaps another in the cell; all sit inside its box'), ran.overlaps === 0 && ran.insideCell, J(ran))

  // Select it: the rail is inside the box.
  await page.locator('.notebook-view [data-cell-type="code"]').first().focus()
  await page.waitForTimeout(250)
  const rail = await page.evaluate(() => {
    const c = document.querySelector('.notebook-view [data-selected]')
    const b = getComputedStyle(c, '::before')
    return { top: parseFloat(b.top), bottom: parseFloat(b.bottom), width: parseFloat(b.width), colour: b.backgroundColor }
  })
  check(T('the selection rail is slim, inside the cell box, not white'), rail.top >= 0 && rail.bottom >= 0 && rail.width <= 2 && rail.colour !== 'rgb(250, 250, 250)' && rail.colour !== 'rgba(0, 0, 0, 0)', J(rail))

  // Markdown prose starts at the same x as code text.
  const md = await page.evaluate(() => {
    const m = document.querySelector('.notebook-view [data-cell-type="markdown"] .nb-md > :first-child')
    const line = document.querySelector('.notebook-view [data-cell-type="code"] .cm-line')
    if (!m || !line) return null
    const range = document.createRange()
    range.selectNodeContents(m)
    const text = range.getClientRects()[0]
    const lr = line.getBoundingClientRect().left + parseFloat(getComputedStyle(line).paddingLeft)
    // RTL prose starts at the right: compare its start edge with the code column's start edge.
    const ltr = getComputedStyle(m).direction === 'ltr'
    const cellBody = m.closest('[data-cell-id]').querySelector('[data-run-col]').nextElementSibling.getBoundingClientRect()
    const codeBody = line.closest('[data-cell-id]').querySelector('[data-run-col]').nextElementSibling.getBoundingClientRect()
    return ltr ? Math.abs(text.left - cellBody.left - (lr - codeBody.left)) : 0
  })
  if (md !== null) check(T('rendered markdown starts at the code text edge'), md <= 1, J(md))

  // A new empty cell: the placeholder starts at the caret.
  await page.locator('[role="toolbar"] button[aria-label="' + (lang === 'en' ? 'Add code cell' : 'أضف خلية كود') + '"]').first().click()
  await page.waitForTimeout(500)
  const ph = await page.evaluate(() => {
    const c = document.querySelector('.notebook-view [data-cell-id] .cm-focused')?.closest('[data-cell-id]')
    const p = c?.querySelector('.cm-placeholder')
    const caret = c?.querySelector('.cm-cursor')
    return p && caret ? Math.abs(p.getBoundingClientRect().left - caret.getBoundingClientRect().left) : null
  })
  check(T('the placeholder starts exactly at the caret'), ph !== null && ph <= 1, J(ph))

  // The completion popup is whole: in the viewport, unclipped, 3+ rows.
  const popup = async (where) => {
    await page.keyboard.type('prin', { delay: 50 })
    await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(250)
    const res = await page.evaluate(() => {
      const t = document.querySelector('.cm-tooltip-autocomplete')
      if (!t) return null
      const r = t.getBoundingClientRect()
      const rows = [...t.querySelectorAll('li')].filter((li) => { const x = li.getBoundingClientRect(); return x.top >= r.top - 0.5 && x.bottom <= r.bottom + 0.5 && x.height > 0 })
      const first = t.querySelector('li')?.getBoundingClientRect()
      const hit = first ? document.elementFromPoint(first.left + first.width / 2, first.top + first.height / 2) : null
      const vv = window.visualViewport ?? { width: innerWidth, height: innerHeight }
      return { inView: r.left >= 0 && r.top >= 0 && r.right <= vv.width + 0.5 && r.bottom <= vv.height + 0.5, unclipped: !!hit && t.contains(hit), rows: rows.length }
    })
    check(T(`the completion popup (${where}) is in the viewport, unclipped, 3+ rows`), !!res && res.inView && res.unclipped && res.rows >= 3, J(res))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
  }
  await popup('mid-screen')
  // The same cell pushed to the bottom of the screen: the popup flips above.
  await page.evaluate(() => {
    const c = document.querySelector('.notebook-view .cm-focused').closest('[data-cell-id]')
    const s = document.querySelector('.notebook-scroller')
    s.scrollTop += c.getBoundingClientRect().bottom - s.getBoundingClientRect().bottom + 8
  })
  await page.waitForTimeout(200)
  await popup('bottom of the screen')
  if (!mobile) {
    await page.keyboard.insertText('print(1)')
    await page.waitForTimeout(200)
    const line = await page.locator('.notebook-view .cm-focused .cm-line').first().boundingBox()
    await page.mouse.move(line.x + 30, line.y + line.height / 2)
    await page.waitForSelector('.cm-tooltip-docs', { timeout: 3000 }).catch(() => {})
    const card = await page.evaluate(() => {
      const t = document.querySelector('.cm-tooltip-docs')
      if (!t) return null
      const r = t.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(12, r.height / 2))
      return { inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5, unclipped: !!hit && t.contains(hit) }
    })
    check(T('the hover docs card is in the viewport and unclipped'), !!card && card.inView && card.unclipped, J(card))

    // Insert affordance: between two cells, inside the gap, touching neither cell.
    const gap = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.notebook-view [data-cell-id]')]
      cells[0].scrollIntoView({ block: 'center' })
      const a = cells[0].getBoundingClientRect()
      const g = cells[0].parentElement.querySelector(':scope > [data-cell-id] + [data-gap]') ?? cells[0].nextElementSibling
      return { a: a.toJSON(), g: g.getBoundingClientRect().toJSON() }
    })
    await page.mouse.move(gap.g.left + gap.g.width / 2, gap.g.top + gap.g.height / 2)
    await page.waitForTimeout(300)
    const chips = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.notebook-view [data-cell-id]')]
      const g = cells[0].nextElementSibling
      const b = cells[1].getBoundingClientRect()
      const a = cells[0].getBoundingClientRect()
      const btns = [...g.querySelectorAll('button')].map((x) => x.getBoundingClientRect())
      const shown = [...g.querySelectorAll('button')].every((x) => parseFloat(getComputedStyle(x.parentElement).opacity) > 0.9)
      const g2 = g.getBoundingClientRect()
      const hit = document.elementFromPoint(g2.left + g2.width / 2, g2.top + g2.height / 2)
      return { shown, inside: btns.length === 2 && btns.every((x) => x.top >= a.bottom - 0.5 && x.bottom <= b.top + 0.5), gap: g2.height, chip: btns[0]?.height }
    })
    check(T('hover shows "+ Code / + Text" inside the 24px gap, clear of both cells'), chips.shown && chips.inside && chips.gap === 24, J(chips))
  }
}

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
