/** Small UI state that isn't project content. localStorage is plenty. */
const KEY = 'warsha.prefs.v1'

export interface Prefs {
  fontSize: number
  consoleHeight: number
  consoleCollapsed: boolean
  openTabs: string[]
  activePath: string | null
  entryPath: string | null
  /** Which edge Run/Stop sits on — see DESIGN-SPEC §5.3 handedness. */
  hand: 'right' | 'left'
  /**
   * Which project to reopen on the next visit. The tab/entry prefs above stay
   * global on purpose: they are filtered against the project that actually
   * loads, so paths belonging to another project simply drop out.
   */
  currentProjectId: string | null
}

const defaults: Prefs = {
  fontSize: 15,
  consoleHeight: 220,
  consoleCollapsed: false,
  openTabs: [],
  activePath: null,
  entryPath: null,
  hand: 'right',
  currentProjectId: null,
}

let cache: Prefs | null = null

export function prefs(): Prefs {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? { ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) } : { ...defaults }
  } catch {
    cache = { ...defaults }
  }
  return cache
}

export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...prefs(), ...patch }
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode */
  }
}
