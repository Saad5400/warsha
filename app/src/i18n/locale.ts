/**
 * Which language the interface speaks — and only the interface.
 *
 * THE LINE THIS MODULE EXISTS TO HOLD (read before adding a string):
 *
 *   The *interface* is translated. The *domain* is not.
 *
 * Warsha's students study computing in English: their textbook says `class`,
 * their exam says `NullPointerException`, and the answer they will search for
 * is written in English. So an Arabic UI that also translates the vocabulary
 * would teach words that work nowhere else — in the teacher's slides, in the
 * stack trace, on the exam — and quietly cut the student off from every other
 * resource they have. The rule, applied without exception in en.ts / ar.ts:
 *
 *   - Arabic for the sentence:  «تعذّر على ورشة حفظ ملفاتك على هذا الجهاز»
 *   - English for the term:     Java, Python, main, package, stdin, exit code,
 *                               .zip, class — inline, untranslated, unglossed.
 *   - Western digits everywhere. Never Arabic-Indic numerals: a line number, an
 *     exit code and a column are read next to code, and code has one numeral
 *     system.
 *
 * Code, program output and the editor are not part of "the interface" at all.
 * They stay LTR in both locales — see the `direction: ltr` pins in index.css.
 *
 * Both scripts are drawn by one webfont, Readex Pro — the @font-face block in
 * index.css carries the reasoning and the byte budget. The short version:
 * `system-ui` does resolve to a real Arabic face everywhere, but a different one
 * per platform and none of them metric-matched to the Latin beside it, and a
 * bilingual UI cannot be built on three different vertical rhythms.
 */
import { useSyncExternalStore } from 'react'
import { prefs, setPrefs } from '../fs/prefs'

export type Locale = 'ar' | 'en'

export const LOCALES: readonly Locale[] = ['ar', 'en'] as const

/** The language's own name — a language switch that names languages in the
 *  language you cannot read is the one control nobody can use. */
export const LOCALE_NAMES: Record<Locale, string> = {
  ar: 'العربية',
  en: 'English',
}

export const dirOf = (l: Locale): 'rtl' | 'ltr' => (l === 'ar' ? 'rtl' : 'ltr')

/**
 * What the browser asks for, before any choice is made.
 *
 * Any `ar-*` tag counts — dialect differences don't matter, since the UI is
 * written in Modern Standard Arabic that reads for all of them. `languages`
 * (plural) is checked in order, so the first supported entry wins, matching
 * the student's own ranking.
 */
export function detectLocale(): Locale {
  const asked = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const tag of asked) {
    const base = tag?.toLowerCase().split('-')[0]
    if (base === 'ar') return 'ar'
    if (base === 'en') return 'en'
  }
  return 'en'
}

/**
 * `?lang=ar` / `?lang=en` — overrides both the stored choice and the browser,
 * deliberately not persisted. Two readers rely on it: QA in tools/qa
 * (currently passing only by luck, since headless Chrome happens to ask for
 * en-US) and a teacher pinning one URL for the whole class.
 */
function fromUrl(): Locale | null {
  try {
    const asked = new URLSearchParams(location.search).get('lang')?.toLowerCase()
    return asked === 'ar' || asked === 'en' ? asked : null
  } catch {
    return null
  }
}

/**
 * `/ar/` and `/en/` — prerendered per-locale entry points, for search
 * engines: a single `/` can only offer a crawler one `<html lang>`/title, so
 * this serves each locale its own (build emits a copy of index.html per
 * prefix — see app/ARCHITECTURE.md §7 and the `warsha:locale-entries` plugin).
 *
 * Real entry points, not landing pages — `/ar/` boots the same bundle.
 * Reading the path (not a build-injected global) means the generated HTML
 * carries no script of its own, and `vite dev` gets it for free too.
 *
 * Not persisted, like `?lang=` — a URL naming a language is a fact about this
 * visit, not a standing choice.
 */
function fromPath(): Locale | null {
  try {
    const first = location.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
    return first === 'ar' || first === 'en' ? first : null
  } catch {
    return null
  }
}

let current: Locale = 'en'
const listeners = new Set<() => void>()

/** The active locale. Safe to call outside React — it is a plain module value,
 *  set once by `initLocale()` before the first render. */
export const locale = (): Locale => current

/**
 * Resolves and applies the locale before React mounts — doing it pre-render
 * stops the shell painting LTR and flipping a frame later. Priority: the URL
 * signals (`?lang=`, `/ar//en/` prefix) first, since a link naming a language
 * is a stronger statement than a saved preference; then the stored choice;
 * then the browser default.
 */
export function initLocale(): Locale {
  current = fromUrl() ?? fromPath() ?? prefs().locale ?? detectLocale()
  applyToDocument(current)
  return current
}

export function setLocale(next: Locale) {
  if (next === current) return
  current = next
  setPrefs({ locale: next })
  applyToDocument(next)
  for (const fn of listeners) fn()
}

/** `dir` on the root flips every logical property at once; `lang` picks
 *  correct Arabic shaping and stops a screen reader using an English voice on
 *  Arabic text. */
function applyToDocument(l: Locale) {
  const html = document.documentElement
  html.lang = l
  html.dir = dirOf(l)
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Re-render on a language switch. Mounted once, at the App root: every string
 *  in the tree is read from `COPY` during render, so one root subscription is
 *  the whole propagation mechanism. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, locale, locale)
}
