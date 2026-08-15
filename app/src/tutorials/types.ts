/**
 * The tutorials contract — the one shape every lesson file conforms to.
 *
 * A tutorial is a short, illustrated walkthrough of one thing a student does in
 * Warsha: a title, a summary, and an ordered list of steps. Each step shows a
 * real screenshot of the app with the relevant control highlighted, plus a
 * heading and a couple of sentences.
 *
 * The screenshots are captured from the running app by tools/tutorials-shots.mjs
 * (a Playwright harness): it drives the real UI into each state, applies a CSS
 * highlight to the target element, and writes public/tutorials/<shot>.<lang>.png
 * for both languages. A Step names its `shot`; the page renders the PNG for the
 * active locale (`<shot>.ar.png` under an Arabic UI, `<shot>.en.png` otherwise),
 * so the walkthrough is bilingual down to the pixels — the Arabic screenshots
 * show the real RTL-mirrored interface.
 *
 * BILINGUAL, THE SAME WAY THE REST OF THE APP IS. Every human sentence is a
 * `Text` ({ en, ar }); the page renders whichever the active locale names. The
 * i18n line held everywhere else (see i18n/locale.ts) holds here too: Arabic
 * carries the sentence, English keeps the domain terms — Run, main, class,
 * .zip, stdin, Java — inline and untranslated, with Western digits throughout.
 */
import type { ReactNode } from 'react'

/** A string in both languages the interface speaks. */
export interface Text {
  en: string
  ar: string
}

/** Resolve a bilingual string for the active locale. */
export const say = (text: Text, loc: 'en' | 'ar'): string => text[loc]

/** Fold bilingual bags into one searchable string (both languages, so a query
 *  in either finds it regardless of which locale is showing). */
export const searchText = (...texts: (Text | undefined)[]): string =>
  texts.filter(Boolean).flatMap((x) => [x!.en, x!.ar]).join(' ')

/**
 * One numbered step: a heading, a short body, and the screenshot it points at.
 * `shot` is the base name captured by the harness — the page appends the locale
 * and `.png`. `keywords` widen what the fuzzy search can find the step by.
 */
export interface Step {
  title: Text
  body: Text
  /** Base name of the captured screenshot (no locale, no extension). */
  shot: string
  /** Alt text for the screenshot, per language (accessibility). */
  alt: Text
  /** Extra search terms (feature names, synonyms) for this step. Optional. */
  keywords?: Text
}

/** The buckets the index groups cards under (order fixed in index.ts). */
export type TutorialCategory = 'basics' | 'coding' | 'running' | 'sharing' | 'settings'

export interface Tutorial {
  /** Stable slug — React key, deep-link anchor, and search id. */
  id: string
  category: TutorialCategory
  /** A single glyph for the card (an Icon from ui/Icons, or a LangIcon). */
  icon: ReactNode
  title: Text
  /** One line under the title on the card; also the lesson's lead paragraph. */
  summary: Text
  /** Fuzzy-search terms beyond the title and summary. Optional. */
  keywords?: Text
  steps: Step[]
}
