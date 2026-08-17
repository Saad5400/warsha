import { IconImport } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Bringing a project IN — the twin of the share/export lesson. Shape and rules
 * follow getting-started.ts: bilingual `{ en, ar }`, Arabic carries the
 * sentence, domain terms (.zip, File) stay English inline, Western digits.
 */
export const importProject: Tutorial = {
  id: 'import',
  category: 'sharing',
  icon: IconImport({ size: 22 }),
  title: { en: 'Import a project', ar: 'استورد مشروعًا' },
  summary: {
    en: 'Bring in loose files, a whole folder, or a .zip — from this device or one a teacher shared.',
    ar: 'أدخِل ملفات مفردة، أو مجلّدًا كاملًا، أو ملف .zip — من جهازك أو أرسله معلّمك.',
  },
  keywords: {
    en: 'import open zip upload files folder restore teacher assignment move device',
    ar: 'استيراد فتح zip رفع ملفات مجلد استعادة معلّم واجب نقل جهاز',
  },
  steps: [
    {
      title: { en: 'File → Import', ar: 'ملف ← استيراد' },
      body: {
        en: 'Open the File menu and choose Import. This is how work made on another device — or handed out by a teacher — comes into Warsha. New Project offers the same Import beside the starters.',
        ar: 'افتح قائمة File واختر Import. بهذه الطريقة يدخل إلى ورشة عملٌ صُنع على جهاز آخر، أو أرسله المعلّم. ويوفّر New Project الاستيراد نفسه بجانب القوالب.',
      },
      shot: 'import-menu',
      keywords: {
        en: 'file menu import zip files folder open upload',
        ar: 'قائمة ملف استيراد zip ملفات مجلد فتح رفع',
      },
      alt: {
        en: 'The File menu open with the Import item highlighted.',
        ar: 'قائمة File مفتوحة مع إبراز عنصر Import.',
      },
    },
    {
      title: { en: 'Pick files, and they open', ar: 'اختر الملفات، فتُفتح' },
      body: {
        en: 'Choose files or a folder from your device — or drop them onto the dialog, a .zip included. Warsha shows you what is inside, then opens it. Import from New Project starts a fresh project and leaves your others untouched.',
        ar: 'اختر ملفات أو مجلّدًا من جهازك — أو أفلتها على النافذة، وملف .zip من بينها. تعرض لك ورشة ما بداخلها، ثم تفتحها. والاستيراد من New Project يبدأ مشروعًا جديدًا ويترك مشاريعك الأخرى كما هي.',
      },
      shot: 'import-dialog',
      keywords: {
        en: 'choose drop files folder zip preview new project confirm',
        ar: 'اختيار إفلات ملفات مجلد zip معاينة مشروع جديد تأكيد',
      },
      alt: {
        en: 'The Import dialog, where you pick or drop files, a folder, or a .zip to open them.',
        ar: 'نافذة الاستيراد، حيث تختار أو تفلت ملفات أو مجلّدًا أو ملف .zip لفتحها.',
      },
    },
  ],
}
