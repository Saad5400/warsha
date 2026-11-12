import { useEffect, useState } from 'react'

/**
 * True once `on` has held for `ms`, false again the moment it drops — and restarted
 * whenever `restartOn` changes. For text that should appear only when a wait has
 * gone on long enough to need it, so a quick wait never flashes it.
 */
export function useAfter(on: boolean, ms: number, restartOn?: unknown): boolean {
  const [due, setDue] = useState(false)
  useEffect(() => {
    setDue(false)
    if (!on) return
    const id = window.setTimeout(() => setDue(true), ms)
    return () => window.clearTimeout(id)
  }, [on, ms, restartOn])
  return on && due
}
