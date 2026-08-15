import { IconZoomIn } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * SETTINGS — where the app-wide preferences live.
 *
 * Follows the reference lesson (lessons/getting-started.ts): every human string
 * is `{ en, ar }`, Arabic carries the sentence while domain terms (Manage,
 * Extensions, Format on Save, Zoom In / Zoom Out) stay English inline, Western
 * digits throughout, and each body is 1–2 sentences — what to do, then what
 * happens. `shot` names are captured by the harness; do not invent new ones.
 */
export const settings: Tutorial = {
  id: 'settings',
  category: 'settings',
  icon: IconZoomIn({ size: 22 }),
  title: { en: 'Make Warsha yours', ar: 'اضبط ورشة على ذوقك' },
  summary: {
    en: 'Open the settings and tune Warsha to fit your screen and the way you like to work.',
    ar: 'افتح الإعدادات واضبط ورشة لتناسب شاشتك وطريقتك في العمل.',
  },
  keywords: {
    en: 'settings preferences options manage gear customize configure',
    ar: 'إعدادات تفضيلات خيارات ضبط تخصيص إدارة الترس',
  },
  steps: [
    {
      title: { en: 'The Manage menu', ar: 'قائمة Manage' },
      body: {
        en: 'Tap the gear at the bottom of the left bar to open Manage — this is where the app-wide settings live. Everything you change here is remembered on this device.',
        ar: 'انقر الترس أسفل الشريط الجانبي لتفتح قائمة Manage — هنا تجد الإعدادات التي تخص التطبيق كله. كل ما تغيّره هنا يُحفظ على هذا الجهاز.',
      },
      shot: 'settings-menu',
      keywords: { en: 'manage gear settings menu preferences', ar: 'Manage الترس الإعدادات القائمة التفضيلات' },
      alt: {
        en: 'The Manage gear at the bottom of the left bar, highlighted, with its settings menu open.',
        ar: 'ترس Manage أسفل الشريط الجانبي، مع إبرازه وقائمة الإعدادات مفتوحة.',
      },
    },
    {
      title: { en: 'Resize the whole interface', ar: 'كبّر الواجهة أو صغّرها' },
      body: {
        en: 'Drag the View scale slider to make everything — text, buttons, panels — bigger or smaller, from 70% up to 130%. Zoom In and Zoom Out do the same thing in steps, which helps on a small phone screen.',
        ar: 'اسحب شريط View scale لتكبير كل شيء — النص والأزرار واللوحات — أو تصغيره، من 70% حتى 130%. ويفعل Zoom In وZoom Out الشيء نفسه خطوة بخطوة، وهو مفيد على شاشة الهاتف الصغيرة.',
      },
      shot: 'settings-zoom',
      keywords: {
        en: 'zoom scale bigger smaller view size text phone screen',
        ar: 'تكبير تصغير حجم العرض الشاشة الهاتف النص',
      },
      alt: {
        en: 'The View scale slider in the Manage menu, highlighted, showing the current percentage.',
        ar: 'شريط View scale في قائمة Manage، مع إبرازه وإظهار النسبة الحالية.',
      },
    },
    {
      title: { en: 'Turn editor features on or off', ar: 'شغّل ميزات المحرر أو أوقفها' },
      body: {
        en: 'Open Extensions from the left bar and flip a switch to turn each built-in feature on or off. Format on Save, for example, tidies your file automatically every time you save it.',
        ar: 'افتح Extensions من الشريط الجانبي وحرّك المفتاح لتشغيل كل ميزة مدمجة أو إيقافها. فمثلًا يرتّب Format on Save ملفك تلقائيًا في كل مرة تحفظه فيها.',
      },
      shot: 'settings-extensions',
      keywords: {
        en: 'extensions features toggle format on save enable disable editor',
        ar: 'Extensions ميزات مفتاح تشغيل إيقاف Format on Save المحرر',
      },
      alt: {
        en: 'The Extensions view with a feature row and its on/off switch highlighted.',
        ar: 'واجهة Extensions مع إبراز صف ميزة ومفتاح التشغيل/الإيقاف الخاص بها.',
      },
    },
  ],
}
