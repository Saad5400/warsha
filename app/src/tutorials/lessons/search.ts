import { IconSearch } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Search and quick-open — finding your way around a project without the mouse.
 *
 * Shape and rules copied from getting-started.ts: every human string is
 * `{ en, ar }`; Arabic carries the sentence while the domain terms (Search,
 * Ctrl+P, Enter, Run) stay English and untranslated inline; Western digits
 * throughout; each body is 1–2 sentences that say what to do and what happens.
 */
export const search: Tutorial = {
  id: 'search',
  category: 'coding',
  icon: IconSearch({ size: 22 }),
  title: { en: 'Search and quick-open', ar: 'ابحث وافتح بسرعة' },
  summary: {
    en: 'Find text anywhere in your project, jump to any file, and run any action — all from the keyboard.',
    ar: 'اعثر على أي نص في مشروعك، وانتقل إلى أي ملف، وشغّل أي أمر — كل ذلك من لوحة المفاتيح.',
  },
  keywords: {
    en: 'search find quick open command palette fuzzy ctrl+p ctrl+shift+p navigate jump',
    ar: 'بحث إيجاد فتح سريع لوحة الأوامر مطابقة تقريبية تنقّل انتقال',
  },
  steps: [
    {
      title: { en: 'Search across every file', ar: 'ابحث في كل الملفات' },
      body: {
        en: 'Open Search in the sidebar and type a word; it scans every file in your project at once and lists each place the word appears. Tap a result to jump straight to that line in the editor.',
        ar: 'افتح Search في الشريط الجانبي واكتب كلمة؛ فيبحث عنها في كل ملفات مشروعك دفعةً واحدة ويعرض كل موضع تظهر فيه. انقر أي نتيجة لتنتقل مباشرةً إلى ذلك السطر في المحرر.',
      },
      shot: 'search',
      keywords: {
        en: 'search find text across files sidebar results',
        ar: 'بحث إيجاد نص عبر الملفات الشريط الجانبي نتائج',
      },
      alt: {
        en: 'The sidebar Search view, results grouped by file, with the search box highlighted.',
        ar: 'عرض Search في الشريط الجانبي والنتائج مجمّعة حسب الملف، مع إبراز صندوق البحث.',
      },
    },
    {
      title: { en: 'Quick-open a file by name', ar: 'افتح ملفًا بسرعة بالاسم' },
      body: {
        en: "Press Ctrl+P and type a few letters from a file's name — even letters scattered through it — and the closest matches rise to the top. Press Enter to open the highlighted one.",
        ar: 'اضغط Ctrl+P واكتب بعض حروف اسم الملف — حتى لو كانت متفرقة داخله — فترتفع أقرب النتائج إلى الأعلى (مطابقة تقريبية fuzzy). اضغط Enter لفتح الملف المميّز.',
      },
      shot: 'quick-open',
      keywords: {
        en: 'quick open file ctrl+p fuzzy jump to file name',
        ar: 'فتح سريع ملف مطابقة تقريبية الانتقال إلى ملف بالاسم',
      },
      alt: {
        en: 'The quick-open panel at the top of the window, listing files that match the typed letters.',
        ar: 'لوحة الفتح السريع أعلى النافذة تعرض الملفات المطابقة للحروف المكتوبة.',
      },
    },
    {
      title: { en: 'Run any action by name', ar: 'شغّل أي أمر بالاسم' },
      body: {
        en: 'Press Ctrl+Shift+P to open the command palette, then type what you want to do — Run, Share, toggle the console — and pick it from the list. You never have to hunt for the action in a menu.',
        ar: 'اضغط Ctrl+Shift+P لفتح command palette، ثم اكتب ما تريد فعله — Run أو Share أو إظهار الـ console — واختره من القائمة. لن تضطر للبحث عن الأمر داخل القوائم.',
      },
      shot: 'command-palette',
      keywords: {
        en: 'command palette ctrl+shift+p actions commands run shortcuts',
        ar: 'لوحة الأوامر أوامر تشغيل اختصارات',
      },
      alt: {
        en: 'The command palette open with a > prefix, listing matching actions beside their keyboard shortcuts.',
        ar: 'الـ command palette مفتوحة وتبدأ بعلامة >، وتعرض الأوامر المطابقة مع اختصاراتها.',
      },
    },
  ],
}
