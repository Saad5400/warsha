import { IconFilesStack } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Managing the project's files — the Explorer tree, creating a file inline, and
 * a row's own menu. Shape and rules follow getting-started.ts: every human
 * string is `{ en, ar }`; Arabic carries the sentence and keeps the domain
 * terms (main.py, .py, .java) English inline, with Western digits throughout;
 * each `shot` names a screenshot the harness captures.
 */
export const files: Tutorial = {
  id: 'files',
  category: 'coding',
  icon: IconFilesStack({ size: 22 }),
  title: { en: 'Manage files and folders', ar: 'أدر الملفات والمجلدات' },
  summary: {
    en: 'Create, rename, move, and delete the files and folders in your project.',
    ar: 'أنشئ ملفات ومجلدات مشروعك، وأعد تسميتها وانقلها واحذفها.',
  },
  keywords: {
    en: 'explorer files folders tree new file rename move delete download drag',
    ar: 'المستكشف Explorer ملفات مجلدات شجرة ملف جديد إعادة تسمية نقل حذف تنزيل سحب',
  },
  steps: [
    {
      title: { en: 'The Explorer', ar: 'المستكشف' },
      body: {
        en: 'The Explorer lists every file and folder in your project as a tree. Tap any file to open it in the editor.',
        ar: 'يعرض المستكشف كل ملف ومجلد في مشروعك على هيئة شجرة. انقر أي ملف ليُفتح في المحرّر.',
      },
      shot: 'explorer',
      keywords: {
        en: 'explorer sidebar panel files folders tree open',
        ar: 'المستكشف Explorer الشريط الجانبي ملفات مجلدات شجرة فتح',
      },
      alt: {
        en: 'The Explorer panel at the side of the workspace, its file tree highlighted.',
        ar: 'لوحة المستكشف على جانب مساحة العمل، مع إبراز شجرة الملفات.',
      },
    },
    {
      title: { en: 'Create a file', ar: 'أنشئ ملفًا' },
      body: {
        en: 'Use New file, type a name that ends with its extension — like main.py — and the new file opens, ready for your code.',
        ar: 'استخدم «ملف جديد»، واكتب اسمًا ينتهي بالامتداد — مثل ⁨main.py⁩ — فيُفتح الملف الجديد جاهزًا لتكتب فيه.',
      },
      shot: 'explorer-newfile',
      keywords: {
        en: 'new file create add name extension py java',
        ar: 'ملف جديد إنشاء إضافة اسم امتداد',
      },
      alt: {
        en: 'The New file control in the Explorer, with a file name being typed inline in the tree.',
        ar: 'زر «ملف جديد» في المستكشف، واسم ملف يُكتب مباشرةً داخل الشجرة.',
      },
    },
    {
      title: { en: "Each file's own menu", ar: 'قائمة كل ملف' },
      body: {
        en: 'Every file has a menu to rename, download, or delete it. You can also drag a file into a folder to move it there.',
        ar: 'لكل ملف قائمة لإعادة تسميته أو تنزيله أو حذفه. ويمكنك أيضًا سحب الملف إلى مجلد لنقله إليه.',
      },
      shot: 'explorer-rowmenu',
      keywords: {
        en: 'rename download delete move drag menu actions row',
        ar: 'إعادة تسمية تنزيل حذف نقل سحب قائمة إجراءات صف',
      },
      alt: {
        en: "A file row's actions menu open, showing Rename, Download file, and Delete.",
        ar: 'قائمة إجراءات أحد الملفات مفتوحة، تعرض إعادة التسمية والتنزيل والحذف.',
      },
    },
    {
      title: { en: 'Bring in a file from your device', ar: 'أضف ملفًا من جهازك' },
      body: {
        en: 'Add files puts a file from your device — a CSV of data, a text file — into this project, next to your code. Drag files onto a folder to put them there. If a file with that name is already there, Warsha asks whether to keep both, replace it, or skip it.',
        ar: 'يضيف زر «إضافة ملفات» ملفًا من جهازك — ملف بيانات CSV أو ملفًا نصيًا — إلى هذا المشروع بجانب الكود. اسحب الملفات إلى مجلد لتوضع فيه. وإن وُجد ملف بالاسم نفسه، تسألك ورشة: الاحتفاظ بالاثنين أو الاستبدال أو التخطّي.',
      },
      shot: 'explorer-addfiles',
      keywords: {
        en: 'add upload files csv data device drag drop import into project',
        ar: 'إضافة رفع ملفات CSV بيانات جهاز سحب إفلات استيراد إلى المشروع',
      },
      alt: {
        en: 'The Add files button in the Explorer header, highlighted.',
        ar: 'زر إضافة ملفات في رأس المستكشف، مع إبرازه.',
      },
    },
  ],
}
