import { IconEye } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * The preview lesson — seeing a web page render live beside the console.
 *
 * Shape and rules copied from getting-started.ts: every human string is
 * `{ en, ar }`; Arabic carries the sentence while the domain terms (HTML, CSS,
 * JavaScript, console.log) stay English and inline; Western digits only; each
 * body says what to do and what happens, in 1–2 sentences.
 */
export const preview: Tutorial = {
  id: 'preview',
  category: 'running',
  icon: IconEye({ size: 22 }),
  title: { en: 'Preview a web page', ar: 'عايِن صفحة الويب' },
  summary: {
    en: 'A Web project (HTML, CSS, JavaScript) renders live in the preview — nothing to download.',
    ar: 'يُعرض مشروع Web (HTML وCSS وJavaScript) مباشرةً في المعاينة — دون تنزيل أي شيء.',
  },
  keywords: {
    en: 'preview web page html css javascript render browser run',
    ar: 'معاينة ويب صفحة عرض متصفح تشغيل',
  },
  steps: [
    {
      title: { en: 'Your page, live', ar: 'صفحتك مباشرةً' },
      body: {
        en: 'A Web project renders as a real page in the preview, beside the console. Plain HTML, CSS and JavaScript need nothing downloaded — run it again and the preview updates to match your latest code.',
        ar: 'يُعرض مشروع Web كصفحة حقيقية في المعاينة، بجانب الconsole. لا يحتاج HTML وCSS وJavaScript العادي إلى أي تنزيل — شغّله من جديد فتتحدّث المعاينة لتطابق آخر أكوادك.',
      },
      shot: 'preview',
      keywords: {
        en: 'preview render page html css javascript live update run',
        ar: 'معاينة عرض صفحة مباشر تحديث تشغيل',
      },
      alt: {
        en: 'The preview showing a rendered web page beside the console.',
        ar: 'المعاينة تعرض صفحة ويب مصوَّرة بجانب الconsole.',
      },
    },
    {
      title: { en: 'Switch to the console', ar: 'انتقل إلى الconsole' },
      body: {
        en: 'Use the Preview and Console tabs to switch between your page and its output. Anything you write with console.log, and any errors on the page, land in the Console tab.',
        ar: 'استخدم تبويبَي Preview وConsole للتنقّل بين صفحتك ومخرجاتها. كل ما تكتبه بـ console.log، وأي أخطاء في الصفحة، تظهر في تبويب Console.',
      },
      shot: 'preview-toggle',
      keywords: {
        en: 'toggle tab preview console switch console.log errors output',
        ar: 'تبويب تبديل تنقل أخطاء مخرجات',
      },
      alt: {
        en: 'The Preview and Console tabs above the output pane, with the toggle highlighted.',
        ar: 'تبويبا Preview وConsole فوق لوح المخرجات، مع إبراز أداة التبديل.',
      },
    },
  ],
}
