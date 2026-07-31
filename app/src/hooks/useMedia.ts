import { useEffect, useState } from 'react'

/** Reactive media query. Used for the <900px drawer threshold. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/**
 * Tracks the html[data-kb] state that ui/viewport.ts writes, so React can react
 * to the software keyboard (close the drawer, shed decoration).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const root = document.documentElement
    const read = () => setOpen(root.dataset.kb === 'open')
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['data-kb'] })
    return () => observer.disconnect()
  }, [])
  return open
}
