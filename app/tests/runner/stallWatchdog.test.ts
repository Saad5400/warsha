/**
 * The load-stall watchdog (hooks/stallWatchdog.ts), one test per case in its header.
 * Run with: `npm run test:runner`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUSY_STALL_MS,
  DOWNLOAD_STALL_MS,
  createStallWatchdog,
  type StallKind,
} from '../../src/hooks/stallWatchdog.ts'
import type { LoadProgress } from '../../src/runtime/types.ts'

/** A hand-cranked clock and a document whose visibility the test flips. */
function rig() {
  let now = 0
  let nextId = 1
  const pending = new Map<number, { at: number; fn: () => void }>()
  const listeners = new Set<() => void>()
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  const fired: StallKind[] = []
  const dog = createStallWatchdog(
    (kind) => fired.push(kind),
    {
      set: (fn, ms) => {
        const id = nextId++
        pending.set(id, { at: now + ms, fn })
        return id
      },
      clear: (id) => void pending.delete(id),
    },
    doc as never,
  )
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      pending.delete(due[0])
      due[1].fn()
    }
    now = end
  }
  const setVisible = (v: boolean) => {
    doc.visibilityState = v ? 'visible' : 'hidden'
    for (const fn of [...listeners]) fn()
  }
  return { dog, fired, advance, setVisible, listeners }
}

const dl = (loaded: number): LoadProgress => ({ phase: 'download', message: '', loaded, total: 40e6 })
const phase = (p: LoadProgress['phase']): LoadProgress => ({ phase: p, message: '' })

test('1. nothing reported at all: a download stall after 45 s', () => {
  const r = rig()
  r.dog.report(null)
  r.advance(DOWNLOAD_STALL_MS - 1)
  assert.deepEqual(r.fired, [])
  r.advance(1)
  assert.deepEqual(r.fired, ['download'])
})

test('2. a slow download that keeps moving never trips, however long it runs', () => {
  const r = rig()
  r.dog.report(null)
  // Five minutes at one report every 40 s, the worst school-wifi trickle.
  for (let i = 1; i <= 8; i++) {
    r.advance(40_000)
    r.dog.report(dl(i * 1e6))
  }
  assert.deepEqual(r.fired, [])
})

test('3. a download that stops moving fires 45 s after its last report', () => {
  const r = rig()
  r.dog.report(dl(1e6))
  r.advance(30_000)
  r.dog.report(dl(2e6))
  r.advance(DOWNLOAD_STALL_MS - 1)
  assert.deepEqual(r.fired, [])
  r.advance(1)
  assert.deepEqual(r.fired, ['download'])
})

test('4. byteless phases (unpack, boot, compile) get the long budget, and fire as busy', () => {
  for (const p of ['unpack', 'boot', 'compile'] as const) {
    const r = rig()
    r.dog.report(phase(p))
    // C's sysroot warm-up on a slow phone: well past the old 45 s.
    r.advance(90_000)
    assert.deepEqual(r.fired, [], p)
    r.advance(BUSY_STALL_MS - 90_000)
    assert.deepEqual(r.fired, ['busy'], p)
  }
})

test('5. once the program starts it never fires: silent compute, input(), endless loop', () => {
  const r = rig()
  r.dog.report(dl(1e6)) // a package download inside the run
  r.dog.stop() // the program's own code began
  r.advance(10 * 60_000)
  assert.deepEqual(r.fired, [])
  assert.equal(r.listeners.size, 0, 'no visibility listener left behind')
})

test('5b. stop() is idempotent, and a later report re-arms', () => {
  const r = rig()
  r.dog.stop()
  r.dog.report(phase('compile'))
  r.dog.stop()
  r.dog.stop()
  r.advance(BUSY_STALL_MS * 2)
  assert.deepEqual(r.fired, [])
  r.dog.report(dl(0))
  r.advance(DOWNLOAD_STALL_MS)
  assert.deepEqual(r.fired, ['download'])
})

test('6. a hidden tab does not report a stall; coming back restarts the window', () => {
  const r = rig()
  r.dog.report(dl(1e6))
  r.setVisible(false)
  // The phone sat locked for ten minutes; its timers ran late or not at all.
  r.advance(10 * 60_000)
  assert.deepEqual(r.fired, [])
  r.setVisible(true)
  r.advance(DOWNLOAD_STALL_MS - 1)
  assert.deepEqual(r.fired, [], 'a fresh window, not the time spent hidden')
  r.dog.report(dl(2e6)) // the download really was still going
  r.advance(DOWNLOAD_STALL_MS - 1)
  assert.deepEqual(r.fired, [])
  r.advance(1)
  assert.deepEqual(r.fired, ['download'])
})

test('it fires once, then lets go', () => {
  const r = rig()
  r.dog.report(null)
  r.advance(DOWNLOAD_STALL_MS * 3)
  assert.deepEqual(r.fired, ['download'])
  assert.equal(r.listeners.size, 0)
})
