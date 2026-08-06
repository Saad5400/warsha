/** Small UI state that isn't project content. localStorage is plenty. */
import type { Locale } from '../i18n/locale'

const KEY = 'warsha.prefs.v1'

export interface Prefs {
  fontSize: number
  /** `null` follows the browser locale; a stored value is an explicit choice and always wins, even if it matches. */
  locale: Locale | null
  /** Whole-UI zoom, 0.7–1.3 step 0.05, 1 = untouched; CSS `zoom` on #root — separate from `fontSize` (editor type only). */
  uiScale: number
  consoleHeight: number
  consoleCollapsed: boolean
  openTabs: string[]
  activePath: string | null
  entryPath: string | null
  /** Which edge Run/Stop sits on — see DESIGN-SPEC §5.3 handedness. */
  hand: 'right' | 'left'
  /** Project to reopen next visit. Tab/entry prefs stay global by design — filtered against whichever project loads. */
  currentProjectId: string | null
}

/** 14px (VS Code default), both densities — touch used to be 15. Function, not a constant, so it's read per-launch. */
const defaultFontSize = () => 14

const defaults: Omit<Prefs, 'fontSize'> = {
  locale: null,
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
