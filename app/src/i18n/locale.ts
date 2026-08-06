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
 * What the browser asks for, when the student has never chosen.
 *
 * Any `ar-*` tag counts — ar-SA, ar-EG, ar and the rest are one UI here; the
 * differences between them are dialect, and this interface is written in Modern
 * Standard Arabic that all of them read. `languages` before `language` so a
 * student whose phone is English-first but who lists Arabic still gets... no:
 * order is preference order, so the first entry that we support wins, exactly
 * as the student ranked them.
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
 * `?lang=ar` / `?lang=en` — an override that beats both the stored choice and
 * the browser, and is deliberately NOT persisted.
 *
 * It exists for two readers. The QA suites in tools/qa assert on English
 * `aria-label`s and on `stdinWaitingPlaceholder` verbatim; they currently get
 * English because headless Chrome asks for en-US, which is luck rather than a
 * guarantee. And a teacher putting one URL on the board can pin the language
 * the class sees regardless of what each phone is set to.
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
 * `/ar/` and `/en/` — the prerendered per-locale entry points.
 *
 * These exist for search engines, not for the app: one URL that is only ever
 * `/` has one `<html lang>`, one title and one description to a crawler, so
 * half the interface Warsha ships is unreachable from an Arabic query. The
 * build emits a copy of index.html under each prefix with its own lang/dir,
 * title, description, og:locale and hreflang cluster — see
 * app/ARCHITECTURE.md §7 and the `warsha:locale-entries` plugin.
 *
 * They are real entry points, not landing pages: `/ar/` boots the same app,
 * from the same hashed bundle one directory up, and this function is what makes
 * it open in Arabic. Reading the path rather than a build-injected global is
 * deliberate — it means the generated HTML carries no script of its own, and
 * `vite dev` gets the same behaviour for free through its history fallback.
 *
 * Ranked with `?lang=` and NOT persisted, for the same reason: both are "this
 * link says which language", which is a fact about the visit, not a new
 * standing choice by the student. A student who has explicitly picked English
 * still has that choice waiting when they next open `/`.
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
 * Resolve and apply the locale, before React mounts.
 *
 * A stored `locale` is an explicit choice and wins over the browser; `null`
 * means "follow the browser", which is the default a first-time visitor gets.
 * Ahead of both sit the two URL signals — `?lang=` and the `/ar/` `/en/` path
 * prefix — because a link that names a language is a stronger statement about
 * this visit than a preference saved on some earlier one. Neither is persisted.
 * Doing all of this pre-render is what stops the shell painting LTR and
 * flipping a frame later.
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

/**
 * `lang` and `dir` on the root element, which is what actually does the work:
 * `dir` flips every logical property in one go, and `lang` picks the right
 * Arabic shaping and stops a screen reader reading Arabic with an English voice.
 */
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
