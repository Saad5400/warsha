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
 * ONLY=K or ONLY=U runs one part. */
import { chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.env.WARSHA_URL ?? 'http://127.0.0.1:8120/'
const ONLY = process.env.ONLY ?? 'KU'
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
        { notebook: opts.nb ?? 'nb.ipynb', cellPath: `${opts.nb ?? 'nb.ipynb'}#cell=${id}`, source: src, code: t.code, cellMagic: t.cellMagic, pip: t.pip },
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

  if (process.env.PIP !== '0') {
    r = await cell('%pip install -q snowballstemmer\nimport snowballstemmer\nsnowballstemmer.stemmer("english").stemWord("running")', 'w')
    check('K: %pip installs a pure-Python package from PyPI before the cell runs', result(r) === "'run'", J({ err: r.err.slice(0, 300), out: r.out.slice(0, 200), res: result(r) }))
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

  await page.getByRole('button', { name: 'Run all' }).click()
  await kernelIdle(page)
  await page.waitForTimeout(500)
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
  await dcell.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^2$/ }).click()
  await page.waitForTimeout(200)
  check('U: a click on a cell\'s gutter sets a breakpoint on its cell path', await page.evaluate((id) => {
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
  await page.getByRole('button', { name: /^Continue/ }).first().click()
  await kernelIdle(page, 15000)
  await page.waitForTimeout(300)
  check('U: Continue finishes the cell with its result', (await dcell.innerText()).includes('20'))
  await dcell.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^2$/ }).click()

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
  await ctx.close()

  // Phone, LTR and RTL; desktop RTL.
  for (const [w, h, mobile, lang, tag] of [
    [390, 844, true, 'en', 'phone-ltr'],
    [390, 844, true, 'ar', 'phone-rtl'],
    [1280, 860, false, 'ar', 'desk-rtl'],
  ]) {
    const b = await browser({ width: w, height: h }, mobile)
    await isolated(b.page, `?lang=${lang}`)
    await newNotebookProject(b.page, lang === 'en' ? 'Plotting with matplotlib' : 'الرسوم مع matplotlib', lang)
    await b.page.screenshot({ path: join(SHOTS, `notebook-${tag}-open.png`) })
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
    await b.ctx.close()
  }
}

const failed = results.filter((r) => r[0] === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
