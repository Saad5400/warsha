/**
 * Keyboard-aware shell geometry (DESIGN-SPEC §4.2).
 *
 * `100dvh` is correct on Android and wrong on iPadOS — there the layout
 * viewport does not shrink for the software keyboard, so a console input row
 * pinned to the bottom ends up underneath it and the student types blind.
 * visualViewport is the only mechanism both platforms honour.
 *
 * Publishes four things onto <html>:
 *   --app-h    the height the shell should occupy
 *   --app-top  the visual viewport's top offset (see the note by its write below)
 *   --kb-inset the hidden part of the layout viewport (0 on Android / hardware keyboards)
 *   data-kb    "open" | "closed", for the compact layout state
 */
export function installViewport(): () => void {
  const root = document.documentElement
  let pending = 0

  function sync() {
    pending = 0
    const vv = window.visualViewport
    if (!vv) return
    // The hidden part of the layout viewport: ≈0 on Android (resizes-content
    // already shrank innerHeight), the keyboard on iOS (which never shrinks it).
    // Never subtract vv.offsetTop, as §4.2's sample does — iPhone scrolls the
    // visual viewport flush to the layout viewport's bottom, cancelling this to 0.
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height))
    root.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
    // iOS scrolls the page up under the keyboard to reveal a focused input, which
    // leaves visualViewport.offsetTop > 0. The shell is `fixed; top: 0` and sized
    // to vv.height, so a positive offset drops its bottom edge that many pixels
    // ABOVE the keyboard — a blank band between the console and the keyboard while
    // the student types. Publishing the offset lets the shell re-anchor its top to
    // it (CSS, keyboard-open only), so the shell tracks the visible viewport
    // instead of the layout viewport it is fixed to. 0 on Android and desktop.
    root.style.setProperty('--app-top', `${Math.max(0, Math.round(vv.offsetTop))}px`)
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
 * The view scale in force (prefs.uiScale — App publishes it as `--ui-scale` on
 * <html>, and `#root { zoom: var(--ui-scale) }` in index.css applies it).
 *
 * The geometry contract lives in that index.css block; this is the JS side of
 * its px-lengths clause. Pointer coordinates and everything measured through
 * getBoundingClientRect / innerHeight are UNZOOMED viewport px, but a px length
 * handed back to the zoomed #root paints multiplied by the scale — so anything
 * that measures the viewport and then writes px into the shell divides by this
 * first. Read from the computed value rather than from prefs so it cannot
 * disagree with what is actually painting.
 */
export function uiScale(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'))
  return Number.isFinite(v) && v > 0 ? v : 1
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
