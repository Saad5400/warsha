/**
 * Keyboard-aware shell geometry (DESIGN-SPEC §4.2).
 *
 * `100dvh` is correct on Android and wrong on iPadOS — there the layout
 * viewport does not shrink for the software keyboard, so a console input row
 * pinned to the bottom ends up underneath it and the student types blind.
 * visualViewport is the only mechanism both platforms honour.
 *
 * Publishes three things onto <html>:
 *   --app-h    the height the shell should occupy
 *   --kb-inset the software keyboard height (0 on Android / hardware keyboards)
 *   data-kb    "open" | "closed", for the compact layout state
 */
export function installViewport(): () => void {
  const root = document.documentElement
  let pending = 0

  function sync() {
    pending = 0
    const vv = window.visualViewport
    if (!vv) return
    // Android (resizes-content): innerHeight already shrank, so kb ≈ 0.
    // iPad: innerHeight is unchanged, so this yields the true keyboard height.
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    root.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
    root.style.setProperty('--kb-inset', `${kb}px`)
    // >100px so an attached Magic Keyboard or the iPad shortcut bar alone does
    // not trigger the compact layout.
    root.dataset.kb = kb > 100 ? 'open' : 'closed'
  }

  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(sync)
  }

  const vv = window.visualViewport
  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  const onOrientation = () => setTimeout(sync, 250)
  window.addEventListener('orientationchange', onOrientation)
  // iOS can leave visualViewport.offsetTop non-zero after the keyboard closes,
  // which pushes fixed chrome off-screen. Re-sync once blur settles.
  const onFocusOut = () =>
    setTimeout(() => {
      window.scrollTo(0, 0)
      sync()
    }, 300)
  window.addEventListener('focusout', onFocusOut)
  sync()

  return () => {
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    window.removeEventListener('orientationchange', onOrientation)
    window.removeEventListener('focusout', onFocusOut)
  }
}

/**
 * Resolves after the keyboard-driven viewport resize settles, so the console
 * can scroll to the bottom *after* the layout changed rather than before
 * (spec §4.4 step 3). Falls back to two frames when no resize arrives.
 */
export function afterViewportSettles(): Promise<void> {
  return new Promise((resolve) => {
    const vv = window.visualViewport
    let done = false
    const finish = () => {
      if (done) return
      done = true
      vv?.removeEventListener('resize', finish)
      resolve()
    }
    vv?.addEventListener('resize', finish)
    requestAnimationFrame(() => requestAnimationFrame(finish))
  })
}
