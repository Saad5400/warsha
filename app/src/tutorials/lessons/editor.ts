import { IconPencil } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Writing and editing code: the editor itself, the tabs above it, and the
 * autocomplete popup. Follows getting-started.ts — every human string is
 * `{ en, ar }`, Arabic carries the sentence, English keeps the domain terms
 * inline, Western digits, bodies of 1–2 sentences. `shot` names a screenshot
 * the harness captures.
 */
export const editor: Tutorial = {
  id: 'editor',
  category: 'coding',
  icon: IconPencil({ size: 22 }),
  title: { en: 'Write and edit code', ar: 'اكتب الكود وعدّله' },
  summary: {
    en: 'Get comfortable in the code editor — highlighting, tabs, and autocomplete.',
    ar: 'تعرّف على محرر الكود: تلوين الصياغة، والتبويبات، والإكمال التلقائي.',
  },
  keywords: {
    en: 'editor code write edit tabs autocomplete completion snippet highlighting',
    ar: 'محرر كود كتابة تعديل تبويبات إكمال تلقائي قصاصة تلوين',
  },
  steps: [
    {
      title: { en: 'The code editor', ar: 'محرر الكود' },
      body: {
        en: 'Your code sits in the editor, with syntax highlighting for colour, line numbers down the side, and indent guides that line up each block.',
        ar: 'يظهر الكود في المحرر مع تلوين الصياغة (syntax highlighting)، وأرقام الأسطر على الجانب، وخطوط إرشاد المسافات البادئة التي تحاذي كل كتلة.',
      },
      shot: 'editor',
      keywords: {
        en: 'syntax highlighting line numbers indent guides colours code',
        ar: 'تلوين الصياغة أرقام الأسطر خطوط الإرشاد المسافة البادئة',
      },
      alt: {
        en: 'The code editor with syntax highlighting, line numbers and indent guides.',
        ar: 'محرر الكود مع تلوين الصياغة وأرقام الأسطر وخطوط إرشاد المسافات البادئة.',
      },
    },
    {
      title: { en: 'Tabs for open files', ar: 'تبويبات للملفات المفتوحة' },
      body: {
        en: 'Every file you open becomes a tab along the top, and a dot on a tab means it has unsaved changes. Tap the × to close a tab when you are done with it.',
        ar: 'كل ملف تفتحه يصبح تبويبًا في الأعلى، والنقطة على التبويب تعني وجود تغييرات غير محفوظة. انقر × لإغلاق التبويب عند انتهائك منه.',
      },
      shot: 'editor-tabs',
      keywords: {
        en: 'tab tabs open file close unsaved changes dirty dot',
        ar: 'تبويب تبويبات ملف مفتوح إغلاق تغييرات غير محفوظة نقطة',
      },
      alt: {
        en: 'The tab strip above the editor, one tab per open file, with an unsaved-changes dot.',
        ar: 'شريط التبويبات فوق المحرر، تبويب لكل ملف مفتوح، مع نقطة التغييرات غير المحفوظة.',
      },
    },
    {
      title: { en: 'Autocomplete and snippets', ar: 'الإكمال التلقائي والقصاصات' },
      body: {
        en: 'As you type, a list of suggestions appears — snippet abbreviations you have seen a teacher type, like sout, psvm and fori, plus common names like Scanner and println. Press Enter or Tab to accept the highlighted one.',
        ar: 'أثناء الكتابة تظهر قائمة اقتراحات — قصاصات مثل sout وpsvm وfori التي رأيت معلّمك يكتبها، إضافةً إلى أسماء شائعة مثل Scanner وprintln. اضغط Enter أو Tab لقبول المُظلَّل.',
      },
      shot: 'editor-autocomplete',
      keywords: {
        en: 'autocomplete completion suggestion snippet sout psvm fori intellisense enter tab',
        ar: 'إكمال تلقائي اقتراح قصاصة sout psvm fori Enter Tab',
      },
      alt: {
        en: 'The autocomplete popup listing snippet abbreviations and API names as code is typed.',
        ar: 'قائمة الإكمال التلقائي تعرض القصاصات وأسماء الـ API أثناء كتابة الكود.',
      },
    },
  ],
}
