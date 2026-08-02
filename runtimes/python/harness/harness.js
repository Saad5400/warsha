/* Warsha Python runtime -- test harness.
 *
 * Plain JS, and it touches the module through THE CONTRACT ONLY:
 *   runtime.load(onProgress) / runtime.run(files, entry, io)
 *   session.kill() / session.writeStdin(line)
 * Nothing here reaches into the worker or any internal.
 */

import { PythonRuntime } from '../src/index'
import { PROGRAMS } from './programs.js'
import { TEMPLATE } from './template.generated.js'

const SCENARIOS = { template: TEMPLATE, ...PROGRAMS }

const runtime = new PythonRuntime()

const el = (id) => document.getElementById(id)

// --- state ------------------------------------------------------------------

const state = {
  scenario: 'template',
  loaded: false,
  running: false,
  awaitingStdin: false,
  exitCode: undefined,
  output: '', // plain-text mirror of the console, for assertions
  progress: [],
}

let session = null
const waiters = { stdin: [], exit: [], output: [] }

function settle(kind, value) {
  const list = waiters[kind]
  waiters[kind] = []
  for (const w of list) {
    clearTimeout(w.timer)
    w.resolve(value)
  }
}

function waitFor(kind, ms, label) {
  return new Promise((resolve, reject) => {
    const w = { resolve }
    w.timer = setTimeout(() => {
      waiters[kind] = waiters[kind].filter((x) => x !== w)
      reject(new Error(`timed out after ${ms}ms waiting for ${label || kind}`))
    }, ms)
    waiters[kind].push(w)
  })
}

function waitForOutput(needle, ms) {
  if (state.output.includes(needle)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const w = { needle, resolve }
    w.timer = setTimeout(() => {
      waiters.output = waiters.output.filter((x) => x !== w)
      reject(new Error(`timed out after ${ms}ms waiting for output ${JSON.stringify(needle)}`))
    }, ms)
    waiters.output.push(w)
  })
}

function checkOutputWaiters() {
  const hits = waiters.output.filter((w) => state.output.includes(w.needle))
  if (!hits.length) return
  waiters.output = waiters.output.filter((w) => !hits.includes(w))
  for (const w of hits) {
    clearTimeout(w.timer)
    w.resolve()
  }
}

// --- console ----------------------------------------------------------------

function log(text, cls) {
  state.output += text
  const out = el('out')
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40
  if (cls) {
    const span = document.createElement('span')
    span.className = cls
    span.textContent = text
    out.appendChild(span)
  } else {
    out.appendChild(document.createTextNode(text))
  }
  if (atBottom) out.scrollTop = out.scrollHeight
  checkOutputWaiters()
}

function setStatus(text) {
  el('stat').textContent = text
}

function syncButtons() {
  el('run').disabled = state.running
  el('stop').disabled = !state.running
  el('selftest').disabled = state.running
  el('inrow').hidden = !state.awaitingStdin
}

// --- the RunIO the module is driven with ------------------------------------

const io = {
  onStdout(text) {
    log(text)
  },
  onStderr(text) {
    log(text, 'err')
  },
  onStdinRequest() {
    state.awaitingStdin = true
    syncButtons()
    el('stdin').value = ''
    el('stdin').focus()
    settle('stdin')
  },
  onExit(code) {
    state.running = false
    state.awaitingStdin = false
    state.exitCode = code
    session = null
    log(`\n[exit ${code === null ? 'null (killed)' : code}]\n`, 'sys')
    setStatus(`exit ${code === null ? 'null (killed)' : code}`)
    syncButtons()
    settle('exit', code)
  },
}

// --- load / run / stop ------------------------------------------------------

const mib = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

async function load() {
  setStatus('loading...')
  await runtime.load((report) => {
    state.progress.push(report)
    // Progress is a LoadProgress object; the string arm is still accepted, so
    // render both rather than stringifying an object into "[object Object]".
    const text =
      typeof report === 'string'
        ? report
        : report.total
          ? `${report.message} (${mib(report.loaded)} / ${mib(report.total)})`
          : report.message
    el('prog').textContent = text
    log(`[${text}]\n`, 'sys')
  })
  state.loaded = true
  el('prog').textContent = `Python ${runtime.version} ready`
  setStatus('ready')
}

async function run(name = state.scenario) {
  const scenario = SCENARIOS[name]
  if (!scenario) throw new Error(`unknown scenario ${name}`)
  state.scenario = name
  renderScenarios()

  state.running = true
  state.exitCode = undefined
  syncButtons()
  setStatus(`running ${name}...`)
  log(`\n[run ${name} -> ${scenario.entry}]\n`, 'sys')

  await load()
  session = await runtime.run(scenario.files, scenario.entry, io)
  return session
}

function stop() {
  if (session) session.kill()
}

function send(line) {
  if (!session || !state.awaitingStdin) return false
  log(line + '\n', 'in') // echo at the cursor, like the real console will
  state.awaitingStdin = false
  session.writeStdin(line)
  syncButtons()
  return true
}

// --- scenario picker / file view --------------------------------------------

function renderScenarios() {
  const box = el('scenarios')
  box.textContent = ''
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const b = document.createElement('button')
    b.className = 'tab'
    b.id = 's-' + name
    b.textContent = scenario.label
    b.setAttribute('aria-selected', String(name === state.scenario))
    b.onclick = () => {
      state.scenario = name
      renderScenarios()
      renderFiles()
    }
    box.appendChild(b)
  }
}

function renderFiles() {
  const scenario = SCENARIOS[state.scenario]
  const box = el('files')
  box.textContent = ''
  for (const file of scenario.files) {
    const h = document.createElement('div')
    h.className = 'fname'
    h.textContent = file.path + (file.path === scenario.entry ? '  (entry)' : '')
    const pre = document.createElement('pre')
    pre.className = 'fbody'
    pre.textContent = file.content
    box.append(h, pre)
  }
}

// --- self test --------------------------------------------------------------

const report = []

function check(name, ok, detail = '') {
  report.push({ name, ok, detail })
  renderReport()
  return ok
}

function renderReport() {
  const box = el('report')
  box.textContent = ''
  for (const r of report) {
    const row = document.createElement('div')
    row.className = 'row ' + (r.ok ? 'pass' : 'fail')
    row.textContent = `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -- ' + r.detail : ''}`
    box.appendChild(row)
  }
  const failed = report.filter((r) => !r.ok).length
  el('summary').textContent = report.length
    ? `${report.length - failed}/${report.length} checks passed`
    : ''
  el('summary').className = failed ? 'bad' : 'ok'
}

/** Last non-empty line currently on screen (what the student sees while blocked). */
function lastLine() {
  const lines = state.output.split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.length ? lines[lines.length - 1] : ''
}

async function selfTest() {
  report.length = 0
  renderReport()

  try {
    // --- 1. the shipped template, verbatim, including its input() ----------
    el('out').textContent = ''
    state.output = ''
    await run('template')
    await waitFor('stdin', 90_000, 'template input()')
    const beforeRead = state.output
    check(
      '1a template: multi-file import ran (helpers.shapes)',
      beforeRead.includes('Circle: area = 12.57') && beforeRead.includes('Rectangle: area = 12.00'),
      JSON.stringify(beforeRead.slice(0, 60)),
    )
    check('1b template: computed total', beforeRead.includes('Total area = 24.57'))
    check(
      '1c template: prompt visible while blocked (no flush)',
      lastLine() === 'Your name: ',
      JSON.stringify(lastLine()),
    )
    send('Warsha')
    let code = await waitFor('exit', 30_000, 'template exit')
    check('1d template: exit code 0', code === 0, `got ${code}`)
    check('1e template: used the line we wrote', state.output.includes('Hello, Warsha!'))

    // --- 2. input() twice --------------------------------------------------
    await run('input-twice')
    await waitFor('stdin', 30_000, 'first input()')
    check('2a first prompt shown while blocked', lastLine() === 'first number: ', JSON.stringify(lastLine()))
    send('3')
    await waitFor('stdin', 30_000, 'second input()')
    check('2b second prompt shown while blocked', lastLine() === 'second number: ', JSON.stringify(lastLine()))
    send('4')
    code = await waitFor('exit', 30_000, 'input-twice exit')
    check('2c both lines reached Python', state.output.includes('3 + 4 = 7'))
    check('2d exit code 0', code === 0, `got ${code}`)

    // --- 3. partial-line prompts (no flush anywhere) -----------------------
    await run('partial-prompt')
    const cases = [
      ["A) input('prompt: ') -> ", 'alpha'],
      ["B) print(end='') then bare input() -> ", 'beta'],
      ['C) sys.stdout.write() then bare input() -> ', 'gamma'],
      ['D) partials: one two -> ', 'delta'],
    ]
    for (const [expected, answer] of cases) {
      await waitFor('stdin', 30_000, `prompt ${expected}`)
      check(`3 partial line before read: ${expected.slice(0, 2)}`, lastLine() === expected, JSON.stringify(lastLine()))
      send(answer)
    }
    code = await waitFor('exit', 30_000, 'partial-prompt exit')
    check('3e all reads completed, no EOFError', state.output.includes('all reads completed, no EOFError'))
    check('3f exit code 0', code === 0, `got ${code}`)

    // --- 4. uncaught exception --------------------------------------------
    await run('traceback')
    code = await waitFor('exit', 30_000, 'traceback exit')
    check('4a student file + line in traceback', /File "main\.py", line 4/.test(state.output), firstMatch(/File "main\.py"[^\n]*/))
    check('4b helper file + line in traceback', /File "helpers\/boom\.py", line 3/.test(state.output), firstMatch(/File "helpers\/boom\.py"[^\n]*/))
    check('4c no absolute FS paths leaked', !state.output.includes('/home/pyodide'))
    check('4d exit code non-null and non-zero', code !== null && code !== 0, `got ${code}`)
    // Pyodide's own machinery has no CPython counterpart, so a frame from it in
    // a student's traceback is the Python equivalent of showing them our
    // launcher. The runner filters those out; this is the guard on that.
    check(
      '4e no Pyodide-internal frames',
      !/\/pyodide\/|\/_pyodide\//.test(state.output),
      firstMatch(/[^\n]*_?pyodide\/[^\n]*/),
    )

    // --- 4B. a warning shows THIS run's source line, not the last one's ----
    // Source lines come from linecache, which is keyed by file name and lives
    // as long as the interpreter -- and one interpreter serves every run. This
    // must follow `traceback`, whose main.py line 3 is the decoy.
    // state.output is cumulative across the whole self-test, and the decoy
    // string is something the PREVIOUS scenario legitimately printed -- so this
    // must assert on this scenario's own slice, not on everything so far.
    const beforeWarning = state.output.length
    await run('warning')
    code = await waitFor('exit', 30_000, 'warning exit')
    const warned = state.output.slice(beforeWarning)
    check(
      '4Ba warning names the student file and line',
      warned.includes('main.py:3: DeprecationWarning: this API is going away'),
      JSON.stringify(warned.match(/main\.py:\d+: [^\n]*/)?.[0] ?? '(not found)'),
    )
    check(
      '4Bb warning shows THIS run\'s source line',
      warned.includes('  warnings.warn("this API is going away", DeprecationWarning)'),
      JSON.stringify(warned.match(/DeprecationWarning: [^\n]*\n[^\n]*/)?.[0] ?? '(not found)'),
    )
    check(
      '4Bc ...and not the previous run\'s (stale linecache)',
      !warned.includes('about to fail'),
      JSON.stringify(warned.match(/[^\n]*about to fail[^\n]*/)?.[0] ?? ''),
    )
    check('4Bd a warning is not fatal', code === 0 && warned.includes('still running'), `got ${code}`)

    // --- 5. infinite loop -> kill -> run again ----------------------------
    await run('infinite-loop')
    await waitForOutput('still alive', 30_000)
    // kill() reports the exit synchronously, so register the waiter first.
    const killed = waitFor('exit', 10_000, 'kill exit')
    const t0 = performance.now()
    stop()
    code = await killed
    check('5a kill() ends the session with exit null', code === null, `got ${code}`)
    check('5b kill() is fast', performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)}ms`)

    const t1 = performance.now()
    await run('input-twice')
    await waitFor('stdin', 60_000, 'input() after kill')
    const rewarm = Math.round(performance.now() - t1)
    send('10')
    await waitFor('stdin', 30_000, 'second input() after kill')
    send('32')
    code = await waitFor('exit', 30_000, 'exit after kill')
    check('5c run() works after kill()', code === 0 && state.output.includes('10 + 32 = 42'), `re-warm ${rewarm}ms`)
  } catch (error) {
    check('self-test completed without error', false, String(error && error.message ? error.message : error))
  }

  const failed = report.filter((r) => !r.ok).length
  setStatus(failed ? `SELF-TEST FAILED (${failed})` : 'SELF-TEST PASSED')
  return { passed: report.length - failed, failed, report }
}

function firstMatch(re) {
  const m = state.output.match(re)
  return m ? m[0] : '(not found)'
}

// --- wiring -----------------------------------------------------------------

el('run').onclick = () => {
  run().catch((e) => log(`\n[harness error] ${e}\n`, 'err'))
}
el('stop').onclick = stop
el('clear').onclick = () => {
  el('out').textContent = ''
  state.output = ''
}
el('selftest').onclick = () => selfTest()
el('send').onclick = () => send(el('stdin').value)
el('stdin').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    send(el('stdin').value)
  }
})

const isolated = self.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function'
el('iso').textContent = isolated
  ? 'crossOriginIsolated: true - SharedArrayBuffer: ok'
  : `crossOriginIsolated: ${self.crossOriginIsolated} - SAB: ${typeof SharedArrayBuffer}`
el('iso').className = isolated ? 'ok' : 'bad'

renderScenarios()
renderFiles()
syncButtons()
setStatus(isolated ? 'idle' : 'not cross-origin isolated -- reload the page')

// Exposed for scripted verification. Everything here goes through the contract.
window.harness = { state, report, run, stop, send, selfTest, load, waitFor, waitForOutput, runtime }
