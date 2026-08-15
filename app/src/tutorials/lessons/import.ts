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
    en: 'Open a .zip you exported before, or one a teacher shared, as a new project.',
    ar: 'افتح ملف .zip صدّرته من قبل، أو أرسله معلّمك، كمشروع جديد.',
  },
  keywords: {
    en: 'import open zip upload restore teacher assignment move device',
    ar: 'استيراد فتح zip رفع استعادة معلّم واجب نقل جهاز',
  },
  steps: [
    {
      title: { en: 'File → Import .zip', ar: 'ملف ← استيراد .zip' },
      body: {
        en: 'Open the File menu and choose Import .zip. This is how work made on another device — or handed out by a teacher — comes into Warsha.',
        ar: 'افتح قائمة File واختر Import .zip. بهذه الطريقة يدخل إلى ورشة عملٌ صُنع على جهاز آخر، أو أرسله المعلّم.',
      },
      shot: 'import-menu',
      keywords: {
        en: 'file menu import zip open upload',
        ar: 'قائمة ملف استيراد zip فتح رفع',
      },
      alt: {
        en: 'The File menu open with the Import .zip item highlighted.',
        ar: 'قائمة File مفتوحة مع إبراز عنصر Import .zip.',
      },
    },
    {
      title: { en: 'Pick the file, and it opens', ar: 'اختر الملف، فيُفتح' },
      body: {
        en: 'Choose a .zip from your device (or drop it onto the dialog). Warsha shows you what is inside, then opens it as a new project — your other projects stay untouched.',
        ar: 'اختر ملف .zip من جهازك (أو أفلته على النافذة). تعرض لك ورشة ما بداخله، ثم تفتحه كمشروع جديد — وتبقى مشاريعك الأخرى كما هي.',
      },
      shot: 'import-dialog',
      keywords: {
        en: 'choose drop file preview new project confirm',
        ar: 'اختيار إفلات ملف معاينة مشروع جديد تأكيد',
      },
      alt: {
        en: 'The Import dialog, where you pick or drop a .zip file to open it.',
        ar: 'نافذة الاستيراد، حيث تختار ملف .zip أو تفلته لفتحه.',
      },
    },
  ],
}
