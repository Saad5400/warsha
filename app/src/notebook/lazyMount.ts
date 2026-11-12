/**
 * When a notebook cell gets its CodeMirror (QA M3). Building every cell's editor up
 * front froze a 240-cell notebook for ten seconds and more: each editor carries the
 * whole language stack. A cell instead shows its code as highlighted text until it
 * comes near the screen; then its editor is built in idle time, a few per slice, so
 * opening and scrolling stay responsive. A click or a keyboard focus builds it at once
 * (CellView's host), so the student never waits on this queue.
 */

type Job = () => void

const queue = new Set<Job>()
let scheduled = false
/** The last scroll of any notebook: building waits until scrolling rests, so it never costs a scroll frame. */
let lastScroll = 0
const REST_MS = 150

/** Budget per idle slice: under a frame, so scrolling keeps its frames. */
const SLICE_MS = 10

type Deadline = { timeRemaining(): number; didTimeout: boolean }
const whenIdle = (cb: (d: Deadline) => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(cb, { timeout: 400 })
  else setTimeout(() => cb({ timeRemaining: () => SLICE_MS, didTimeout: true }), 16)
}

function pump(deadline: Deadline) {
  scheduled = false
  const resting = performance.now() - lastScroll
  if (resting < REST_MS) {
    scheduled = true
    setTimeout(() => whenIdle(pump), REST_MS - resting)
    return
  }
  const start = performance.now()
  for (const job of queue) {
    queue.delete(job)
    job()
    if (performance.now() - start >= SLICE_MS || (!deadline.didTimeout && deadline.timeRemaining() < 1)) break
  }
  schedule()
}

function schedule() {
  if (scheduled || !queue.size) return
  scheduled = true
  whenIdle(pump)
}

/** One observer per scroll root, shared by all its cells. */
const observers = new WeakMap<Element, { io: IntersectionObserver; jobs: Map<Element, Job> }>()

function observerFor(root: Element | null) {
  const key = root ?? document.documentElement
  let entry = observers.get(key)
  if (!entry) {
    const jobs = new Map<Element, Job>()
    const io = new IntersectionObserver(
      (records) => {
        for (const r of records) {
          const job = jobs.get(r.target)
          if (!job) continue
          if (r.isIntersecting) queue.add(job)
          else queue.delete(job)
        }
        schedule()
      },
      // Built a screen ahead, so a cell is live before it scrolls in.
      { root, rootMargin: '100% 0px' },
    )
    ;(root ?? window).addEventListener('scroll', () => (lastScroll = performance.now()), { passive: true })
    entry = { io, jobs }
    observers.set(key, entry)
  }
  return entry
}

/**
 * Run `mount` once `el` nears the visible part of `root` (in idle time). Returns a
 * cancel function; call it once the cell has mounted by other means or unmounts.
 */
export function mountWhenNear(el: Element, root: Element | null, mount: Job): () => void {
  const { io, jobs } = observerFor(root)
  let done = false
  const job = () => {
    if (done) return
    done = true
    io.unobserve(el)
    jobs.delete(el)
    mount()
  }
  jobs.set(el, job)
  io.observe(el)
  return () => {
    done = true
    queue.delete(job)
    io.unobserve(el)
    jobs.delete(el)
  }
}
