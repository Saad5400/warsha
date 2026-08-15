import { IconShare } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Share and export — getting your work off Warsha and to someone else.
 *
 * Shape and rules copied from getting-started.ts: every human string is
 * `{ en, ar }`; Arabic carries the sentence while the domain terms (.zip, link,
 * PDF, Import) stay English and untranslated inline; Western digits throughout;
 * each body is 1–2 sentences that say what to do and what happens. A neutral-
 * leading extension like `.zip` is wrapped in a first-strong isolate (U+2068 …
 * U+2069) inside Arabic so it does not render reversed as «zip.» — the same
 * seam ar.ts handles with its `ZIP` constant.
 *
 * Context that shapes the copy: Warsha has no accounts and nothing on a server —
 * every project lives on the device, and each of these paths keeps it that way.
 */
export const share: Tutorial = {
  id: 'share',
  category: 'sharing',
  icon: IconShare({ size: 22 }),
  title: { en: 'Share and export your work', ar: 'شارك عملك وصدّره' },
  summary: {
    en: 'Take your project to another device or hand it in — as a file, a link, an image, or a PDF, all without an account.',
    ar: 'انقل مشروعك إلى جهاز آخر أو سلّمه — كملف أو link أو صورة أو PDF، وكل ذلك بلا حساب.',
  },
  keywords: {
    en: 'share export zip link image pdf hand in submit send device local no account',
    ar: 'مشاركة تصدير zip link صورة pdf تسليم إرسال محلي بلا حساب',
  },
  steps: [
    {
      title: { en: 'Export the project as a .zip', ar: 'صدّر المشروع كملف ⁨.zip⁩' },
      body: {
        en: 'Choose Export as .zip to save the whole project as a single file on your device. Carry it to another computer or hand it in, and open it again anytime with Import.',
        ar: 'اختر Export as ⁨.zip⁩ لحفظ المشروع كله في ملف واحد على جهازك. انقله إلى حاسوب آخر أو سلّمه لمعلّمك، وافتحه متى شئت عبر Import.',
      },
      shot: 'export-zip',
      keywords: {
        en: 'export zip download project file hand in submit import',
        ar: 'تصدير zip تنزيل المشروع ملف تسليم استيراد',
      },
      alt: {
        en: 'The project menu with Export as .zip highlighted.',
        ar: 'قائمة المشروع مع إبراز خيار التصدير كملف ⁨.zip⁩.',
      },
    },
    {
      title: { en: 'Share a link to the project', ar: 'شارك المشروع عبر link' },
      body: {
        en: 'Share as link folds the whole project into a link you can send in a chat. Whoever opens it gets their own copy to edit — still with no account, and nothing ever travels through a server.',
        ar: 'يطوي «شارك عبر link» المشروع كله داخل link يمكنك إرساله في محادثة. من يفتحه يحصل على نسخته الخاصة ليعدّلها — بلا حساب، ودون أن يمرّ شيء عبر أي خادم.',
      },
      shot: 'share-link',
      keywords: {
        en: 'share link url copy send project no account no server',
        ar: 'مشاركة رابط link نسخ إرسال المشروع بلا حساب بلا خادم',
      },
      alt: {
        en: 'The share menu with Share as link highlighted.',
        ar: 'قائمة المشاركة مع إبراز خيار المشاركة عبر link.',
      },
    },
    {
      title: { en: 'Share as an image or PDF', ar: 'شارك كصورة أو PDF' },
      body: {
        en: "Share as image turns the file you're viewing into a clean picture of the code you can post anywhere. For the whole project, Share as PDF lays every file out as one document to read or print.",
        ar: 'يحوّل «شارك كصورة» الملف الذي تعرضه إلى صورة أنيقة للكود يمكنك نشرها في أي مكان. ولمشاركة المشروع كله، يرتّب «شارك كـ PDF» جميع الملفات في مستند واحد تقرؤه أو تطبعه.',
      },
      shot: 'share-image',
      keywords: {
        en: 'share image png code screenshot pdf print document export',
        ar: 'مشاركة صورة png لقطة كود pdf طباعة مستند',
      },
      alt: {
        en: 'The file menu with Share as image and Share as PDF highlighted.',
        ar: 'قائمة الملف مع إبراز خياري المشاركة كصورة والمشاركة كـ PDF.',
      },
    },
  ],
}
