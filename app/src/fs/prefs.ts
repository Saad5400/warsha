/** Small UI state that isn't project content. localStorage is plenty. */
const KEY = 'warsha.prefs.v1'

export interface Prefs {
  fontSize: number
  /** Whole-UI zoom (View > Zoom In/Out, the Manage gear's View-scale slider).
   *  0.7–1.3 in 0.05 steps, 1 = untouched. Rendered as CSS `zoom` on #root.
   *  Deliberately separate from `fontSize`, which sizes the editor type only. */
  uiScale: number
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

/**
 * The default type size is 14px — VS Code's own default — at BOTH densities
 * (founder scale-down 2026-08-05; touch was 15). Only for *unstored* prefs —
 * a size the student has chosen (stored) always wins. The density split is
 * gone but the helper stays: the value is read per-launch, not at module
 * load, and the split can come back by re-adding the matchMedia branch.
 */
const defaultFontSize = () => 14

const defaults: Omit<Prefs, 'fontSize'> = {
  uiScale: 1,
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
  const fresh: Prefs = { ...defaults, fontSize: defaultFontSize() }
  try {
    const raw = localStorage.getItem(KEY)
    cache = raw ? { ...fresh, ...(JSON.parse(raw) as Partial<Prefs>) } : fresh
  } catch {
    cache = fresh
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
