import { IconRunAll } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Notebooks (.ipynb) — Jupyter/Colab-style cells. Shape and rules follow
 * getting-started.ts: every human string is `{ en, ar }`; Arabic carries the
 * sentence and keeps the domain terms (notebook, Python, Shift+Enter, Run all,
 * Colab, .ipynb, CSV) English inline; each `shot` names a captured screenshot.
 */
export const notebooks: Tutorial = {
  id: 'notebooks',
  category: 'running',
  icon: IconRunAll({ size: 22 }),
  title: { en: 'Work in a notebook', ar: 'اعمل في دفتر' },
  summary: {
    en: 'Write Python in cells and run them one at a time, the way Jupyter and Colab work.',
    ar: 'اكتب Python في خلايا وشغّلها واحدة تلو الأخرى، كما في Jupyter و Colab.',
  },
  keywords: {
    en: 'notebook ipynb jupyter colab cell run all shift enter pandas data python',
    ar: 'دفتر notebook ipynb Jupyter Colab خلية تشغيل الكل Shift+Enter pandas بيانات Python',
  },
  steps: [
    {
      title: { en: 'Start a notebook', ar: 'ابدأ دفترًا' },
      body: {
        en: 'In New project, choose Python: the notebook starters are in their own section under the file starters. A .ipynb from Colab or Jupyter opens the same way through Import.',
        ar: 'من «مشروع جديد» اختر Python: قوالب الدفاتر في قسم خاص بها تحت قوالب الملفات. ويُفتح ملف .ipynb من Colab أو Jupyter بالطريقة نفسها عبر الاستيراد.',
      },
      shot: 'notebook-picker',
      keywords: {
        en: 'new notebook starter template empty notebook pandas import colab',
        ar: 'دفتر جديد قالب دفتر فارغ pandas استيراد Colab',
      },
      alt: {
        en: 'The new-project dialog on Python, with the Notebooks section highlighted.',
        ar: 'نافذة المشروع الجديد على Python، مع إبراز قسم الدفاتر.',
      },
    },
    {
      title: { en: 'Run a cell', ar: 'شغّل خلية' },
      body: {
        en: 'Each cell runs on its own: press Shift+Enter, or its ▶ button, and its output appears right under it. Variables carry over to the cells below. Run all runs every cell from the top.',
        ar: 'تعمل كل خلية وحدها: اضغط Shift+Enter أو زر ▶ الخاص بها، فتظهر مخرجاتها تحتها مباشرة. وتبقى المتغيّرات متاحة للخلايا التي تليها. ويشغّل «تشغيل الكل» كل الخلايا من الأعلى.',
      },
      shot: 'notebook-run',
      keywords: {
        en: 'run cell shift enter output run all variables kernel',
        ar: 'تشغيل خلية Shift+Enter مخرجات تشغيل الكل متغيّرات',
      },
      alt: {
        en: 'A notebook with a cell that has run, its output shown under it.',
        ar: 'دفتر فيه خلية شُغّلت، وتظهر مخرجاتها تحتها.',
      },
    },
  ],
}
