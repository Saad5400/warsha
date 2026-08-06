/**
 * Student-facing strings, in one place (DESIGN-SPEC §8) — now in two languages.
 *
 * `COPY.foo` still reads exactly as it always did at every call site. What
 * changed is underneath: each key is a getter that answers from whichever
 * bundle the active locale names, so a language switch needs no prop drilling,
 * no context, and no edit to the ~90 places that read a string. The one thing
 * that makes it work is that every read happens *during render* — `useLocale()`
 * at the App root re-renders the tree on a switch, and the re-render is what
 * picks up the other bundle.
 *
 * THE ONE RULE: every `COPY` read must happen DURING RENDER.
 *
 * Reading it at module scope — `const { runOk } = COPY`, or a lookup table like
 * `const LABEL = { beginner: COPY.levelBeginner }` — snapshots whichever
 * language was active when the module was imported. That is always English:
 * every ES module in the graph evaluates before main.tsx's body runs, so before
 * `initLocale()` has resolved anything. It fails silently and only for the
 * strings that took that shape, which is how three headings in TemplatePicker
 * stayed English inside an otherwise fully Arabic picker.
 *
 * A lookup table is still fine — write it as a function that indexes on call
 * (`const label = (k) => ({ … })[k]`), not as a constant object. Inside a
 * component body, destructuring is fine.
 *
 * The English bundle is the source of truth for the shape and the tone; see
 * i18n/en.ts. What may and may not be translated is set out in i18n/locale.ts.
 */
import { AR } from './i18n/ar'
import { EN, type Bundle } from './i18n/en'
import { locale, type Locale } from './i18n/locale'

const BUNDLES: Record<Locale, Bundle> = { en: EN, ar: AR }

export const COPY: Bundle = Object.defineProperties(
  {},
  Object.fromEntries(
    (Object.keys(EN) as (keyof Bundle)[]).map((key) => [
      key,
      { get: () => BUNDLES[locale()][key], enumerable: true },
    ]),
  ),
) as Bundle
