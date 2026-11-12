/**
 * The notebook kernel under the shared load-stall watchdog (runtime/stallWatchdog.ts):
 * a boot or a cell's package download that goes quiet fails instead of leaving the
 * notebook on "Starting" for good; a cell whose code has started is never watched.
 * Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { newCell } from '../../src/notebook/nbformat.ts'

// session.ts schedules with the browser's timers; Node has the same ones.
const g = globalThis as Record<string, unknown>
g.window ??= globalThis
g.requestAnimationFrame ??= (fn: () => void) => setTimeout(fn, 0) as unknown as number
g.cancelAnimationFrame ??= (id: number) => clearTimeout(id)
const { NotebookSession } = await import('../../src/notebook/session.ts')
const { STALL_LIMITS } = await import('../../src/runtime/stallWatchdog.ts')

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const msgs = () => ({ restarted: '', forcedRestart: '', lost: '', debugBusy: '' })

/** A kernel whose boot and cells the test scripts. */
function kernel(opts: { load?: (onProgress: (p: unknown) => void) => Promise<void>; execute?: (io: Record<string, (...a: unknown[]) => void>) => void }) {
  const k = {
    epoch: 1,
    disposed: 0,
    killed: 0,
    load: opts.load ?? (async () => {}),
    execute: async (_f: unknown, _cell: unknown, io: Record<string, (...a: unknown[]) => void>) => {
      opts.execute?.(io)
      return { kill: () => (k.killed++, io.onExit?.(null)), writeStdin() {} }
    },
    interrupt() {},
    restart: async () => {},
    dispose: () => void k.disposed++,
  }
  return k
}

function host() {
  const failures: string[] = []
  return {
    failures,
    files: () => [],
    workspace: () => 'p',
    cell: () => newCell('code', 'import numpy'),
    update() {},
    cellIds: () => [],
    onFilesChanged() {},
    onFailure: (m: string) => void failures.push(m),
  }
}

async function withShortBudgets(fn: () => Promise<void>) {
  const saved = { ...STALL_LIMITS }
  STALL_LIMITS.downloadMs = 60
  STALL_LIMITS.busyMs = 120
  try {
    await fn()
  } finally {
    Object.assign(STALL_LIMITS, saved)
  }
}

test('a kernel boot that never answers fails as a network problem, and the engine is discarded', () =>
  withShortBudgets(async () => {
    const k = kernel({ load: () => new Promise(() => {}) }) // black-holed: never settles, never reports
    const h = host()
    const s = new NotebookSession('a.ipynb', k, h, msgs)
    s.run(['c'])
    await tick(20)
    assert.equal(s.get().kernel, 'starting')
    await tick(120)
    assert.deepEqual(h.failures, ['timed out'], 'the classifier reads this as offline')
    assert.equal(k.disposed, 1, 'the stuck engine is thrown away, so Run starts clean')
    assert.equal(s.get().kernel, 'off')
    assert.equal(s.get().running, null)
    assert.equal(s.get().cells.c?.state, 'error')
    s.dispose()
  }))

test('a boot that keeps reporting bytes is never cut short', () =>
  withShortBudgets(async () => {
    let finish: () => void = () => {}
    const k = kernel({
      load: (onProgress) =>
        new Promise<void>((resolve) => {
          finish = resolve
          let n = 0
          const id = setInterval(() => onProgress({ phase: 'download', message: '', loaded: ++n * 1e5, total: 1e7 }), 30)
          setTimeout(() => clearInterval(id), 300)
        }),
      // The cell itself ends at once: cells of every session share one turn (session.ts `exclusive`).
      execute: (io) => setTimeout(() => io.onExit?.(0), 1),
    })
    const h = host()
    const s = new NotebookSession('b.ipynb', k, h, msgs)
    s.run(['c'])
    await tick(280) // well past the 60 ms window, but never 60 ms without a report
    assert.deepEqual(h.failures, [])
    finish()
    await tick(30)
    assert.equal(k.disposed, 0)
    s.dispose()
  }))

test("a cell's package download that goes quiet kills the cell, not the page", () =>
  withShortBudgets(async () => {
    const k = kernel({ execute: (io) => io.onProgress?.({ phase: 'download', message: 'Loading numpy', loaded: 1e5 }) })
    const h = host()
    const s = new NotebookSession('c.ipynb', k, h, msgs)
    s.run(['c'])
    await tick(150)
    assert.deepEqual(h.failures, ['timed out'])
    assert.equal(k.killed, 1)
    assert.equal(s.get().running, null)
    s.dispose()
  }))

test('a cell whose code has started is never watched: silence, input(), a long loop', () =>
  withShortBudgets(async () => {
    let exit: ((c: number) => void) | null = null
    const k = kernel({
      execute: (io) => {
        io.onProgress?.({ phase: 'download', message: 'Loading numpy', loaded: 1e5 })
        setTimeout(() => io.onExecuteInput?.(1), 20) // packages in, the code begins
        setTimeout(() => io.onStdinRequest?.(), 40)
        exit = io.onExit as (c: number) => void
      },
    })
    const h = host()
    const s = new NotebookSession('d.ipynb', k, h, msgs)
    s.run(['c'])
    await tick(400)
    assert.deepEqual(h.failures, [])
    assert.equal(k.killed, 0)
    assert.equal(s.get().waiting, 'c')
    exit!(0)
    await tick(20)
    s.dispose()
  }))
