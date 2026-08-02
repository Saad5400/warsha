/**
 * "Warsha is open in another tab."
 *
 * Two tabs on one project share one OPFS directory and two independent
 * in-memory `Project` instances. Neither corrupts the other — every write is a
 * whole-file replace and the loser is simply overwritten — but a student who
 * edits in tab A and then in tab B watches tab A's copy silently win the next
 * time it flushes, and has no way to know why.
 *
 * We do not lock them out. A student on a school iPad who double-tapped the
 * bookmark must not find the second tab dead. The lock is an **advisory**: the
 * later tab says so, and says which way the loss goes.
 *
 * Web Locks is exactly the right primitive here because the browser releases
 * the lock when the tab goes away, including on a crash — no heartbeat, no
 * stale-lock cleanup, nothing to get wrong.
 */
const LOCK_NAME = 'warsha.primary-tab'

/**
 * Calls back with `true` while this tab holds the primary lock and `false`
 * while another tab does. Returns an unsubscribe that releases the lock.
 *
 * On a browser with no Web Locks (Safari < 15.4) this reports `true` once and
 * does nothing else — the advisory is a nicety, and a browser that cannot
 * support it should not lose the banner-free default.
 */
export function watchPrimaryTab(onChange: (isPrimary: boolean) => void): () => void {
  const locks = navigator.locks
  if (!locks?.request) {
    onChange(true)
    return () => {}
  }

  const controller = new AbortController()
  let released = false
  const hold = () =>
    new Promise<void>((resolve) => {
      if (released) return resolve()
      controller.signal.addEventListener('abort', () => resolve(), { once: true })
    })

  void (async () => {
    try {
      // First try without waiting, so a lone tab never pays a round trip.
      // `ifAvailable` and `signal` are mutually exclusive in the spec, so this
      // first attempt carries no signal; it settles immediately either way.
      const got = await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (!lock) return false
        onChange(true)
        await hold()
        return true
      })
      if (got || released) return

      // Someone else has it. Say so, then queue: when they close their tab we
      // become primary and the banner goes away by itself.
      onChange(false)
      await locks.request(LOCK_NAME, { signal: controller.signal }, async () => {
        if (released) return
        onChange(true)
        await hold()
      })
    } catch {
      // AbortError on unmount, or a browser that dislikes the options bag.
      // Either way, not being able to run the advisory is not an error a
      // student should ever hear about.
    }
  })()

  return () => {
    released = true
    controller.abort()
  }
}
