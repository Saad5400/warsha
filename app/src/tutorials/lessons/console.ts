import { IconTerminal } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * The console lesson — reading a program's output and answering its input.
 *
 * Shape and rules copied from getting-started.ts: every human string is
 * `{ en, ar }`; Arabic carries the sentence while the domain terms (stdout,
 * stderr, input, Scanner, Enter) stay English and inline; Western digits only;
 * each body says what to do and what happens, in 1–2 sentences.
 */
export const console: Tutorial = {
  id: 'console',
  category: 'running',
  icon: IconTerminal({ size: 22 }),
  title: { en: 'Read output and type input', ar: 'اقرأ المخرجات واكتب المدخلات' },
  summary: {
    en: 'See what your program prints, spot problems it reports, and answer it when it asks.',
    ar: 'شاهد ما يطبعه برنامجك، ولاحظ ما يبلّغ عنه من مشكلات، وأجبه حين يسأل.',
  },
  keywords: {
    en: 'console output input stdout stderr print terminal run clear copy',
    ar: 'وحدة التحكم المخرجات المدخلات طباعة تشغيل مسح نسخ',
  },
  steps: [
    {
      title: { en: 'Output, and answering back', ar: 'المخرجات، والرد على البرنامج' },
      body: {
        en: 'The console shows everything your program prints (stdout); a problem it reports appears in red (stderr). When the program asks for input (Python input(), Java Scanner), type your answer on the same line as the prompt and press Enter.',
        ar: 'تعرض وحدة التحكم كل ما يطبعه برنامجك (stdout)، وأي مشكلة يبلّغ عنها تظهر باللون الأحمر (stderr). وحين يطلب البرنامج مُدخلًا (input() في Python أو Scanner في Java)، اكتب إجابتك على السطر نفسه واضغط Enter.',
      },
      shot: 'console-output',
      keywords: {
        en: 'stdout stderr print output red error input stdin scanner prompt enter',
        ar: 'طباعة مخرجات خطأ أحمر مدخلات إدخال سؤال إجابة',
      },
      alt: {
        en: 'The console showing printed output, with a red stderr line.',
        ar: 'وحدة التحكم تعرض مخرجات مطبوعة، مع سطر stderr باللون الأحمر.',
      },
    },
    {
      title: { en: 'Clear or copy the output', ar: 'امسح المخرجات أو انسخها' },
      body: {
        en: 'From the console actions you can copy the whole transcript to paste elsewhere, or clear it to start fresh. Clearing only empties the view; your next run fills it again.',
        ar: 'من إجراءات وحدة التحكم يمكنك نسخ المخرجات كاملة للصقها في مكان آخر، أو مسحها لتبدأ من جديد. المسح يفرّغ العرض فقط؛ ويملؤه تشغيلك التالي مرة أخرى.',
      },
      shot: 'console-clear',
      keywords: {
        en: 'clear copy output actions transcript paste',
        ar: 'مسح نسخ إجراءات لصق تفريغ',
      },
      alt: {
        en: 'The console action buttons, with Copy output and Clear output highlighted.',
        ar: 'أزرار إجراءات وحدة التحكم، مع إبراز نسخ المخرجات ومسحها.',
      },
    },
  ],
}
