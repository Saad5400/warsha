/* Warsha Java runtime -- test harness.
 *
 * Plain JS, and it touches the module through THE CONTRACT ONLY:
 *   runtime.load(onProgress) / runtime.run(files, entry, io)
 *   session.kill() / session.writeStdin(line)
 * Nothing here reaches into the worker or any internal. The two properties it
 * reads outside the contract (runtime.lastBoot / runtime.lastRun) are timings
 * for display, and no assertion depends on them.
 */

import { JavaRuntime } from '../src/index'
import { PROGRAMS } from './programs.js'
import { TEMPLATE } from './template.generated.js'

const SCENARIOS = { template: TEMPLATE, ...PROGRAMS }

const runtime = new JavaRuntime({
  // CheerpJ's console chatter, including the JIT-failure noise it emits on every
  // ECJ compile. Kept visible here so the self-test can prove the noise really
  // occurs and really stays out of the student's output.
  onInternalLog: (entry) => {
    internal.push(entry)
    if (entry.noise) state.noiseSeen++
    renderInternal()
  },
})

const el = (id) => document.getElementById(id)

// --- state ------------------------------------------------------------------

const state = {
  scenario: 'template',
  running: false,
  awaitingStdin: false,
  exitCode: undefined,
  /** Visual mirror of the console, including harness [notes]. */
  output: '',
  /** ONLY what the program and compiler wrote: what a student would see. */
  io: '',
  progress: [],
  noiseSeen: 0,
}

const internal = []
let session = null
const waiters = { stdin: [], exit: [], output: [] }

function settle(kind, value) {
  const list = waiters[kind]
  waiters[kind] = []
  for (const waiter of list) {
    clearTimeout(waiter.timer)
    waiter.resolve(value)
  }
}

function waitFor(kind, ms, label) {
  return new Promise((resolve, reject) => {
    const waiter = { resolve }
    waiter.timer = setTimeout(() => {
      waiters[kind] = waiters[kind].filter((x) => x !== waiter)
      reject(new Error(`timed out after ${ms}ms waiting for ${label || kind}`))
    }, ms)
    waiters[kind].push(waiter)
  })
}

function waitForOutput(needle, ms) {
  if (state.io.includes(needle)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const waiter = { needle, resolve }
    waiter.timer = setTimeout(() => {
      waiters.output = waiters.output.filter((x) => x !== waiter)
      reject(new Error(`timed out after ${ms}ms waiting for output ${JSON.stringify(needle)}`))
    }, ms)
    waiters.output.push(waiter)
  })
}

function checkOutputWaiters() {
  const hits = waiters.output.filter((waiter) => state.io.includes(waiter.needle))
  if (!hits.length) return
  waiters.output = waiters.output.filter((waiter) => !hits.includes(waiter))
  for (const waiter of hits) {
    clearTimeout(waiter.timer)
    waiter.resolve()
  }
}

// --- console ----------------------------------------------------------------

function log(text, cls) {
  state.output += text
  if (cls !== 'sys' && cls !== 'in') state.io += text
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

function showProgress(report) {
  // The contract allows a bare string; this runtime sends the rich object.
  const p = typeof report === 'string' ? { phase: 'boot', message: report } : report
  let text = `${p.phase}: ${p.message}`
  if (typeof p.loaded === 'number') {
    const mib = (n) => (n / 1024 / 1024).toFixed(2)
    text += p.total ? ` ${mib(p.loaded)}/${mib(p.total)} MiB` : ` ${mib(p.loaded)} MiB`
  }
  el('prog').textContent = text
  return p
}

function showTimings() {
  const boot = runtime.lastBoot
  const run = runtime.lastRun
  const parts = []
  if (boot) parts.push(`boot ${Math.round(boot.initMs)}ms + warm ${Math.round(boot.warmMs)}ms`)
  if (run) parts.push(`compile ${Math.round(run.compileMs)}ms + run ${Math.round(run.runMs)}ms`)
  el('timing').textContent = parts.join('  |  ')
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
    showTimings()
    syncButtons()
    settle('exit', code)
  },
}

// --- load / run / stop ------------------------------------------------------

async function load() {
  setStatus('loading…')
  await runtime.load((report) => {
    const p = showProgress(report)
    state.progress.push(p)
    // Only log phase changes; the download reports many byte updates.
    const previous = state.progress[state.progress.length - 2]
    if (!previous || previous.message !== p.message) log(`[${p.message}]\n`, 'sys')
  })
  el('prog').textContent = `Java ${runtime.javaVersion} ready`
  showTimings()
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
  setStatus(`running ${name}…`)
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
  // Echo at the cursor, like the real console will: CheerpJ has no tty, so
  // nothing echoes typed input unless the page does it.
  log(line + '\n', 'in')
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
    const button = document.createElement('button')
    button.className = 'tab'
    button.id = 's-' + name
    button.textContent = scenario.label
    button.setAttribute('aria-selected', String(name === state.scenario))
    button.onclick = () => {
      state.scenario = name
      renderScenarios()
      renderFiles()
    }
    box.appendChild(button)
  }
}

function renderFiles() {
  const scenario = SCENARIOS[state.scenario]
  const box = el('files')
  box.textContent = ''
  for (const file of scenario.files) {
    const heading = document.createElement('div')
    heading.className = 'fname'
    heading.textContent = file.path + (file.path === scenario.entry ? '  (entry)' : '')
    const body = document.createElement('pre')
    body.className = 'fbody'
    body.textContent = file.content
    box.append(heading, body)
  }
}

function renderInternal() {
  const box = el('internal')
  if (!box) return
  const noise = internal.filter((entry) => entry.noise).length
  el('noise').textContent = `CheerpJ console: ${internal.length} lines, ${noise} filtered as noise`
  box.textContent = internal
    .slice(-40)
    .map((entry) => `${entry.noise ? '[noise] ' : ''}${entry.text}`)
    .join('\n')
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
  for (const row of report) {
    const div = document.createElement('div')
    div.className = 'row ' + (row.ok ? 'pass' : 'fail')
    div.textContent = `${row.ok ? 'PASS' : 'FAIL'}  ${row.name}${row.detail ? '  -- ' + row.detail : ''}`
    box.appendChild(div)
  }
  const failed = report.filter((row) => !row.ok).length
  el('summary').textContent = report.length
    ? `${report.length - failed}/${report.length} checks passed`
    : ''
  el('summary').className = failed ? 'bad' : 'ok'
}

/** Last non-empty line of program output: what the student sees while blocked. */
function lastLine() {
  const lines = state.io.split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.length ? lines[lines.length - 1] : ''
}

function firstMatch(re) {
  const m = state.io.match(re)
  return m ? m[0] : '(not found)'
}

/**
 * The uncaught-exception report on its own: from "Exception in thread" to the
 * end of the output, with trailing newlines dropped.
 *
 * The exception checks compare this as ONE EXACT STRING against what a real
 * `java` prints. Asserting on substrings is how the old rendering drifted into
 * something no JVM has ever produced -- every individual `includes()` passed.
 */
function traceBlock() {
  const at = state.io.indexOf('Exception in thread')
  return at < 0 ? '' : state.io.slice(at).replace(/\n+$/, '')
}

/** Clears the console mirror so each scenario asserts only on its own output. */
function freshConsole() {
  el('out').textContent = ''
  state.output = ''
  state.io = ''
}

const LOAD_MS = 240_000 // a cold engine download + compiler warm-up
const COMPILE_MS = 180_000 // a compile on a cold ECJ can take double digits of seconds

async function selfTest() {
  report.length = 0
  renderReport()
  const timings = {}

  try {
    // --- 1. the shipped java-oop template, verbatim, including its Scanner ---
    freshConsole()
    const coldStart = performance.now()
    await run('template')
    await waitFor('stdin', LOAD_MS, 'template Scanner read')
    timings.coldToFirstPrompt = Math.round(performance.now() - coldStart)
    check('1a template: ran and printed its banner', state.io.includes('=== Warsha starter ==='))
    check(
      '1b template: Person.describe()',
      state.io.includes('Layla, age 34'),
      firstMatch(/Layla[^\n]*/),
    )
    check(
      '1c template: Student overrides describe() (polymorphism across files)',
      state.io.includes('Omar, age 20, studies Computer Science'),
      firstMatch(/Omar[^\n]*/),
    )
    check(
      '1d template: prompt visible while blocked, with no flush and no newline',
      lastLine() === 'Your name: ',
      JSON.stringify(lastLine()),
    )
    send('Warsha')
    let code = await waitFor('exit', COMPILE_MS, 'template exit')
    check('1e template: exit code 0', code === 0, `got ${code}`)
    check(
      '1f template: used the line we typed',
      state.io.includes('Hello, Warsha! Now open models/Person.java.'),
      firstMatch(/Hello[^\n]*/),
    )

    // --- 2. prompt-then-read, three times, incl. a token read --------------
    freshConsole()
    const warmStart = performance.now()
    await run('prompt')
    await waitFor('stdin', COMPILE_MS, 'first prompt')
    timings.warmToFirstPrompt = Math.round(performance.now() - warmStart)
    check('2a partial line "Name: " before the read blocks', lastLine() === 'Name: ', JSON.stringify(lastLine()))
    send('Sara')
    await waitFor('stdin', COMPILE_MS, 'second prompt')
    check('2b partial line "Age: " before nextInt() blocks', lastLine() === 'Age: ', JSON.stringify(lastLine()))
    send('19')
    await waitFor('stdin', COMPILE_MS, 'third prompt')
    check('2c partial line "City: " before the read blocks', lastLine() === 'City: ', JSON.stringify(lastLine()))
    send('Riyadh')
    code = await waitFor('exit', COMPILE_MS, 'prompt exit')
    check('2d nextInt() parsed the token', state.io.includes('[echo] age parsed as int: 19'))
    check(
      '2e three separate print calls stayed on one line',
      state.io.includes('[echo] Riyadh <- three separate print calls, no newline until here'),
      firstMatch(/\[echo\] Riyadh[^\n]*/),
    )
    check('2f all three reads completed', state.io.includes('PROMPT-TEST-OK Sara/19/Riyadh'))
    check('2g exit code 0', code === 0, `got ${code}`)

    // --- 3. same class name in two packages --------------------------------
    freshConsole()
    await run('same-name')
    code = await waitFor('exit', COMPILE_MS, 'same-name exit')
    check('3a app.Item resolved', state.io.includes('app.Item     -> app.Item(cart entry)'))
    check('3b models.Item resolved', state.io.includes('models.Item  -> models.Item(database row)'))
    check(
      '3c both loaded under their own fully-qualified names',
      state.io.includes('loaded as app.Item and models.Item'),
      firstMatch(/loaded as[^\n]*/),
    )
    check('3d genuinely two distinct classes', state.io.includes('different classes? true'))
    check('3e exit code 0 (flat /str/ namespace solved)', code === 0 && state.io.includes('SAME-NAME-OK'), `got ${code}`)

    // --- 4. compile error: student-relative path, line, caret ---------------
    freshConsole()
    await run('compile-error')
    code = await waitFor('exit', COMPILE_MS, 'compile-error exit')
    check(
      '4a diagnostic names the student\'s own path',
      /(^|\s)models\/Broken\.java/.test(state.io),
      firstMatch(/[^\s]*Broken\.java[^\n]*/),
    )
    check('4b no /files/ path leaked', !state.io.includes('/files/'), firstMatch(/\/files\/[^\s]*/))
    check('4c no /str/ path leaked', !state.io.includes('/str/'), firstMatch(/\/str\/[^\s]*/))
    check('4d diagnostic carries a line number', /\(at line \d+\)/.test(state.io), firstMatch(/\(at line \d+\)/))
    check(
      '4e diagnostic carries a caret',
      state.io.split('\n').some((line) => line.trim() === '^'),
    )
    check('4f exit code non-zero and non-null', code !== null && code !== 0, `got ${code}`)
    check('4g nothing ran', !state.io.includes('42'), firstMatch(/42/))

    // --- 5. uncaught exception: byte-for-byte what a real JVM prints --------
    //
    // The whole block is compared as one exact string. `java` on classes with a
    // SourceFile attribute and no line table (javac -g:source, which is what
    // CheerpJ effectively leaves us with) prints precisely this -- verified
    // against a real JDK -- so anything less than equality is a regression.
    freshConsole()
    const noiseBefore = state.noiseSeen
    await run('crash')
    code = await waitFor('exit', COMPILE_MS, 'crash exit')
    check('5a the program ran up to the throw', state.io.includes('about to divide by zero'))
    check('5b execution stopped at the throw', !state.io.includes('never reached'))
    check(
      '5c EXACT real-JVM output for an uncaught divide by zero',
      traceBlock() ===
        'Exception in thread "main" java.lang.ArithmeticException: / by zero\n' +
          '\tat models.Calculator.divide(Calculator.java)\n' +
          '\tat app.Crash.main(Crash.java)',
      JSON.stringify(traceBlock()),
    )
    check(
      '5d implicit message restored ("/ by zero", which CheerpJ drops)',
      state.io.includes('java.lang.ArithmeticException: / by zero'),
      firstMatch(/java\.lang\.ArithmeticException[^\n]*/),
    )
    check(
      '5e frames name the file each class was declared in',
      state.io.includes('(Calculator.java)') && state.io.includes('(Crash.java)'),
      firstMatch(/at models\.Calculator[^\n]*/),
    )
    check(
      '5f no apology in place of a line number',
      !/line unknown|Unknown Source/.test(state.io),
      firstMatch(/[^\n]*(line unknown|Unknown Source)[^\n]*/),
    )
    check('5g warsha.* frames filtered out', !state.io.includes('warsha.'), firstMatch(/[^\s]*warsha\.[^\n]*/))
    check(
      '5h reflection frames filtered out',
      !state.io.includes('sun.reflect.') && !state.io.includes('java.lang.reflect.'),
      firstMatch(/[^\s]*reflect\.[^\n]*/),
    )
    check('5i no JIT-failure noise in the student\'s output', !/JIT failure|please report a bug/.test(state.io))
    check(
      '5j ...and that noise really did occur (so the filter is doing work)',
      state.noiseSeen > noiseBefore,
      `${state.noiseSeen - noiseBefore} noise lines this scenario, ${state.noiseSeen} total`,
    )
    check('5k exit code non-zero and non-null', code !== null && code !== 0, `got ${code}`)

    // --- 5B. an explicitly thrown message survives CheerpJ ------------------
    freshConsole()
    await run('throw-message')
    code = await waitFor('exit', COMPILE_MS, 'throw-message exit')
    check(
      '5Ba EXACT output for an explicit throw with a message',
      traceBlock() ===
        'Exception in thread "main" java.lang.IllegalStateException: the tank is empty\n' +
          '\tat app.Refuse.main(Refuse.java)',
      JSON.stringify(traceBlock()),
    )
    check('5Bb exit code non-zero and non-null', code !== null && code !== 0, `got ${code}`)

    // --- 5C. cause chain: Caused by + "... N more" --------------------------
    freshConsole()
    await run('caused-by')
    code = await waitFor('exit', COMPILE_MS, 'caused-by exit')
    check(
      '5Ca EXACT output for a wrapped-and-rethrown exception',
      traceBlock() ===
        'Exception in thread "main" java.lang.IllegalStateException: could not place order 7\n' +
          '\tat app.Order.place(Order.java)\n' +
          '\tat app.Order.main(Order.java)\n' +
          'Caused by: java.lang.IllegalArgumentException: no order with id 7\n' +
          '\tat models.Repo.find(Repo.java)\n' +
          '\t... 2 more',
      JSON.stringify(traceBlock()),
    )
    check('5Cb exit code non-zero and non-null', code !== null && code !== 0, `got ${code}`)

    // --- 5D. a second top-level class reports ITS OWN file ------------------
    // The one case no fallback can guess: models.Shape was declared in
    // Shapes.java, and "Shape.java" is not a file the student has.
    freshConsole()
    await run('two-classes-one-file')
    code = await waitFor('exit', COMPILE_MS, 'two-classes-one-file exit')
    check(
      '5Da EXACT output, with the non-public class named against its real file',
      traceBlock() ===
        'Exception in thread "main" java.lang.IllegalArgumentException: negative side: -1\n' +
          '\tat models.Shape.area(Shapes.java)\n' +
          '\tat models.Shapes.area(Shapes.java)\n' +
          '\tat app.Draw.main(Draw.java)',
      JSON.stringify(traceBlock()),
    )
    check(
      '5Db no invented Shape.java',
      !state.io.includes('Shape.java)'),
      firstMatch(/[^\n]*Shape\.java\)[^\n]*/),
    )
    check('5Dc exit code non-zero and non-null', code !== null && code !== 0, `got ${code}`)

    // --- 6. infinite loop -> kill -> run again ------------------------------
    freshConsole()
    await run('infinite-loop')
    await waitForOutput('still alive', COMPILE_MS)
    // kill() reports the exit synchronously, so register the waiter first.
    const killed = waitFor('exit', 10_000, 'kill exit')
    const killStart = performance.now()
    stop()
    code = await killed
    timings.killMs = Math.round(performance.now() - killStart)
    check('6a kill() ends the session with exit null', code === null, `got ${code}`)
    check('6b kill() is immediate', performance.now() - killStart < 1000, `${timings.killMs}ms`)

    freshConsole()
    const rewarmStart = performance.now()
    await run('same-name')
    code = await waitFor('exit', LOAD_MS, 'exit after kill')
    timings.rewarmMs = Math.round(performance.now() - rewarmStart)
    check(
      '6c run() works again after kill()',
      code === 0 && state.io.includes('SAME-NAME-OK'),
      `re-warm to finished run ${timings.rewarmMs}ms`,
    )

    // --- 7. System.exit: reported, and the runtime recovers ----------------
    freshConsole()
    await run('system-exit')
    code = await waitFor('exit', COMPILE_MS, 'system-exit exit')
    check('7a output before System.exit survived', state.io.includes('EXIT-TEST leaving with status 3'))
    check('7b System.exit(3) surfaces as exit 3', code === 3, `got ${code}`)

    freshConsole()
    await run('prompt')
    await waitFor('stdin', LOAD_MS, 'prompt after System.exit')
    send('After')
    await waitFor('stdin', COMPILE_MS, 'second prompt after System.exit')
    send('7')
    await waitFor('stdin', COMPILE_MS, 'third prompt after System.exit')
    send('Jeddah')
    code = await waitFor('exit', COMPILE_MS, 'exit after System.exit run')
    check(
      '7c a run after System.exit still works (JVM replaced)',
      code === 0 && state.io.includes('PROMPT-TEST-OK After/7/Jeddah'),
      `got ${code}`,
    )
    // --- 8. per-run output directories really are cleaned up ---------------
    // /files/ is IndexedDB-backed and survives everything, so run directories
    // would accumulate forever if delete() did not work there -- something the
    // spike never established. Build prints the outcome on CheerpJ's own
    // console, which the runtime forwards on its internal channel.
    const gc = internal
      .map((entry) => /warsha-gc: deleted=(\d+) failed=(\d+)/.exec(entry.text))
      .filter(Boolean)
    check('8a Build reported on its cleanup', gc.length > 0, `${gc.length} reports`)
    check(
      '8b old run directories are really deleted (delete() works on /files/)',
      gc.some((m) => Number(m[1]) > 0) && gc.every((m) => Number(m[2]) === 0),
      gc.length ? gc.map((m) => `deleted=${m[1]} failed=${m[2]}`).join(', ') : 'no reports',
    )
  } catch (error) {
    check('self-test completed without error', false, String((error && error.message) || error))
  }

  const failed = report.filter((row) => !row.ok).length
  setStatus(failed ? `SELF-TEST FAILED (${failed})` : 'SELF-TEST PASSED')
  el('timing').textContent =
    `cold->prompt ${timings.coldToFirstPrompt}ms | warm->prompt ${timings.warmToFirstPrompt}ms | ` +
    `kill ${timings.killMs}ms | after-kill run ${timings.rewarmMs}ms`
  return { passed: report.length - failed, failed, timings, report }
}

// --- wiring -----------------------------------------------------------------

el('run').onclick = () => {
  run().catch((error) => log(`\n[harness error] ${error}\n`, 'err'))
}
el('stop').onclick = stop
el('clear').onclick = freshConsole
el('selftest').onclick = () => selfTest()
el('send').onclick = () => send(el('stdin').value)
el('eof').onclick = () => {
  if (session && state.awaitingStdin) {
    log('[EOF]\n', 'sys')
    state.awaitingStdin = false
    session.writeEof()
    syncButtons()
  }
}
el('stdin').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    send(el('stdin').value)
  }
})

renderScenarios()
renderFiles()
renderInternal()
syncButtons()
setStatus('idle')

// Exposed for scripted verification. Everything here goes through the contract.
window.harness = { state, report, internal, run, stop, send, selfTest, load, waitFor, waitForOutput, runtime }
