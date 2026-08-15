import { IconLightbulb } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * REFERENCE LESSON — the shape every other lesson copies.
 *
 * Rules, all enforced by `Tutorial`/`Text` and by review:
 *  - Every human string is `{ en, ar }`. Arabic carries the sentence; English
 *    keeps the domain terms (Run, main, .zip, Java) inline and untranslated.
 *    Western digits in both. See i18n/locale.ts for the full line.
 *  - `shot` names a screenshot the harness captures; do NOT invent one that the
 *    harness does not produce (see tools/tutorials-shots.mjs SHOTS).
 *  - Keep bodies to 1–2 sentences: say what to do and what happens.
 */
export const gettingStarted: Tutorial = {
  id: 'getting-started',
  category: 'basics',
  icon: IconLightbulb({ size: 22 }),
  title: { en: 'Getting started', ar: 'البداية' },
  summary: {
    en: 'Open Warsha and find your way around the projects home.',
    ar: 'افتح ورشة وتعرّف على صفحة مشاريعك.',
  },
  keywords: { en: 'start begin home welcome first time open', ar: 'ابدأ بداية الرئيسية ترحيب أول مرة فتح' },
  steps: [
    {
      title: { en: 'Your projects home', ar: 'صفحة مشاريعك' },
      body: {
        en: 'Every time you open Warsha you land here — a grid of your projects. Nothing you make is uploaded anywhere; it all stays on this device.',
        ar: 'في كل مرة تفتح فيها ورشة تصل إلى هنا — شبكة بمشاريعك. لا يُرفع أي شيء تصنعه إلى أي مكان؛ يبقى كله على هذا الجهاز.',
      },
      shot: 'home',
      alt: {
        en: 'The Warsha projects home, with the New project button highlighted.',
        ar: 'صفحة مشاريع ورشة، مع إبراز زر مشروع جديد.',
      },
    },
    {
      title: { en: 'Pick up where you left off', ar: 'أكمل من حيث توقفت' },
      body: {
        en: 'The project you touched last sits on top as a Continue card. Tap it to reopen it exactly as you left it.',
        ar: 'يظهر آخر مشروع فتحته في الأعلى ضمن بطاقة «أكمل». انقرها لتعيد فتحه تمامًا كما تركته.',
      },
      shot: 'home-continue',
      alt: {
        en: 'The Continue card at the top of the home, highlighted.',
        ar: 'بطاقة «أكمل» في أعلى الصفحة، مع إبرازها.',
      },
    },
    {
      title: { en: 'Arabic or English', ar: 'العربية أو الإنجليزية' },
      body: {
        en: 'The globe switches the whole interface between Arabic and English. Your code and its output stay exactly as you wrote them.',
        ar: 'يبدّل زر الكرة الأرضية الواجهة كلها بين العربية والإنجليزية. تبقى الأكواد ومخرجاتها كما كتبتها تمامًا.',
      },
      shot: 'home-language',
      keywords: { en: 'language arabic english translate rtl globe', ar: 'اللغة العربية الإنجليزية ترجمة الكرة الأرضية' },
      alt: {
        en: 'The language globe button in the home header, highlighted.',
        ar: 'زر اللغة (الكرة الأرضية) في ترويسة الصفحة، مع إبرازه.',
      },
    },
  ],
}
