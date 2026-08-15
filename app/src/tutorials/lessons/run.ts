import { IconPlay } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Running a program — the Run/Stop button and reading the result. Shape and
 * rules follow getting-started.ts: every human string is `{ en, ar }`; Arabic
 * carries the sentence and keeps the domain terms (Run, Stop, exit code, Python,
 * Java) English inline, Western digits throughout; each `shot` names a captured
 * screenshot.
 */
export const run: Tutorial = {
  id: 'run',
  category: 'running',
  icon: IconPlay({ size: 22 }),
  title: { en: 'Run your program', ar: 'شغّل برنامجك' },
  summary: {
    en: 'Run the file you are working on and read what your program prints back.',
    ar: 'شغّل الملف الذي تعمل عليه، واقرأ ما يطبعه برنامجك.',
  },
  keywords: {
    en: 'run stop start execute output console exit code offline engine python java web',
    ar: 'تشغيل إيقاف Run Stop تنفيذ مخرجات وحدة التحكم exit code بلا إنترنت محرّك Python Java Web',
  },
  steps: [
    {
      title: { en: 'Press Run', ar: 'اضغط زر التشغيل' },
      body: {
        en: 'Run starts whichever file you are looking at. The first time you run a language, Warsha downloads it once — Python, Java — and after that it starts instantly, even with no internet. If a program runs away with itself, the same button becomes Stop.',
        ar: 'يشغّل زر التشغيل الملف الذي تنظر إليه. وفي أول مرة تشغّل فيها لغة، تنزّل ورشة محرّكها مرة واحدة — Python أو Java — ثم يبدأ التشغيل فورًا بعدها، حتى بلا إنترنت. وإن استمر البرنامج بلا توقّف، تحوّل الزر نفسه إلى زر إيقاف.',
      },
      shot: 'run',
      keywords: {
        en: 'run stop start button execute play runaway download engine first time offline',
        ar: 'تشغيل إيقاف Run Stop زر بدء تنفيذ تنزيل محرّك أول مرة بلا إنترنت',
      },
      alt: {
        en: 'The Run button in the editor tab strip, highlighted.',
        ar: 'زر التشغيل في شريط تبويبات المحرّر، مع إبرازه.',
      },
    },
    {
      title: { en: 'Read the result', ar: 'اقرأ النتيجة' },
      body: {
        en: 'Whatever your program prints appears in the console below. When it finishes you see a line with its exit code; red lines mean something went wrong along the way.',
        ar: 'يظهر كل ما يطبعه برنامجك في وحدة التحكم بالأسفل. وعند انتهائه يظهر سطر يحمل exit code؛ وأي أسطر حمراء تعني أن شيئًا لم يسر كما ينبغي.',
      },
      shot: 'console-output',
      keywords: {
        en: 'output result console finished exit code error red print stdout',
        ar: 'مخرجات نتيجة وحدة التحكم انتهى exit code خطأ أحمر طباعة',
      },
      alt: {
        en: 'The console showing the program output after a run, with a red error line.',
        ar: 'وحدة التحكم تعرض مخرجات البرنامج بعد التشغيل، مع سطر خطأ أحمر.',
      },
    },
  ],
}
