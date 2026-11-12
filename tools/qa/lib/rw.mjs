/**
 * Shared helpers for real-world-check.mjs: open a project straight from files
 * (through the same #share= link a teacher would send, so no typing into
 * CodeMirror and no auto-indent mangling), run it, read the console, type
 * into stdin, Stop.
 *
 * Every helper reads what the student sees — the console transcript and the
 * console panel's `data-state` — never engine internals.
 */
import { deflateRawSync } from 'node:zlib'

/** The `#share=` payload `sharelink.ts` decodes: raw DEFLATE of the JSON, URL-safe base64. */
export function shareHash(name, files, entry = null) {
  const payload = { v: 1, n: name, e: entry, f: Object.entries(files), d: [] }
  const b64 = deflateRawSync(Buffer.from(JSON.stringify(payload)), { level: 9 })
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return '#share=' + b64
}

export const OUT = '[aria-label="Program output"]'
export const STDIN = '[aria-label="Program input"]'
export const PANEL = 'section.console-panel'

/** The shell's own last line for a run that ended (Finished / stopped early / Stopped / engine lost). */
export const END_LINE = /Finished\. \(exit code|stopped early|Stopped\.|stopped responding/

export const output = (page) => page.locator(OUT).innerText().catch(() => '')
export const status = (page) => page.locator(PANEL).getAttribute('data-state').catch(() => null)

/** The tab strip's Run/Stop control: its accessible name carries the file ("Run main.py"). A bare
 *  "Run" is the menu bar's Run menu, and "Run and Debug" the activity bar. */
export const RUN_CONTROL = /^Run \S+\.\w+$/
export const STOP_CONTROL = /^Stop \S+\.\w+$/
export const runButton = (page) => page.getByRole('button', { name: RUN_CONTROL }).first()
export const stopButton = (page) => page.getByRole('button', { name: STOP_CONTROL }).first()

/** Whether the Run control is enabled — the editor can mount before the project's files exist. */
export async function waitRunnable(page, timeout = 30000) {
  await page.waitForFunction((src) => {
    const re = new RegExp(src)
    const b = [...document.querySelectorAll('button')].find((x) => re.test(x.getAttribute('aria-label') ?? ''))
    return !!b && !b.disabled
  }, RUN_CONTROL.source, { timeout })
}

/** Opens the app on `files` as a fresh project and waits until Run is enabled. */
export async function openProject(page, base, name, files, entry = null) {
  // A different hash alone would not reload the SPA; go via about:blank.
  await page.goto('about:blank')
  await page.goto(base + shareHash(name, files, entry), { waitUntil: 'load' })
  const isolated = await page.waitForFunction(() => self.crossOriginIsolated === true, null, { timeout: 30000 })
    .then(() => true).catch(() => false)
  if (!isolated) await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  await waitRunnable(page)
}


/** Waits for the console panel to reach one of `states` (idle|preparing|running|waiting|ok|failed|stopped). */
export async function waitState(page, states, timeout = 240000) {
  const want = Array.isArray(states) ? states : [states]
  return page.waitForFunction((w) => w.includes(document.querySelector('section.console-panel')?.getAttribute('data-state')),
    want, { timeout }).then(() => true).catch(() => false)
}

export async function waitText(page, needle, timeout = 240000) {
  return page.waitForFunction(([sel, n]) => {
    const t = document.querySelector(sel)?.innerText ?? ''
    return n instanceof RegExp ? n.test(t) : t.includes(n)
  }, [OUT, needle], { timeout }).then(() => true).catch(() => false)
}

/** Clicks Run, honouring the shell's 250 ms swap guard, and waits for the run to end. */
export async function runToEnd(page, { timeout = 240000, stdin = [] } = {}) {
  await waitRunnable(page)
  await page.waitForTimeout(300)
  await runButton(page).click()
  await waitState(page, ['preparing', 'running', 'waiting', 'ok', 'failed', 'stopped'], 5000)
  for (const line of stdin) {
    if (!(await waitState(page, 'waiting', timeout))) break
    await typeLine(page, line)
  }
  await waitState(page, ['ok', 'failed', 'stopped'], timeout)
  // The console reveals a burst at terminal-scroll speed (console/buffer.ts), so the
  // exit line can trail the state flip by a few seconds.
  await waitText(page, END_LINE, 8000)
  return { state: await status(page), text: await output(page) }
}

export async function typeLine(page, line) {
  const box = page.locator(STDIN)
  await box.fill(line)
  await box.press('Enter')
}

/** Replaces the active editor's whole document. */
export async function setEditorText(page, text) {
  await page.evaluate((t) => {
    const el = document.querySelector('.cm-content')
    // CodeMirror keeps its tile on the content DOM (EditorView.findFromDOM does the same).
    const view = el?.cmTile?.root?.view ?? el?.closest('.cm-editor')?.cmView?.view
    if (!view) throw new Error('no EditorView on .cm-content')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } })
  }, text)
  await page.waitForTimeout(500) // past the 350 ms write-behind debounce
}

export function tally() {
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : ''}`)
    return !!ok
  }
  return { results, check }
}
