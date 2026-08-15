import { IconFilePlus } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Starting a project: choose a language, pick a starter, land in the editor.
 * Follows getting-started.ts — every human string is `{ en, ar }`, Arabic
 * carries the sentence, English keeps the domain terms inline, Western digits,
 * bodies of 1–2 sentences. `shot` names a screenshot the harness captures.
 */
export const createProject: Tutorial = {
  id: 'create-project',
  category: 'basics',
  icon: IconFilePlus({ size: 22 }),
  title: { en: 'Create your first project', ar: 'أنشئ مشروعك الأول' },
  summary: {
    en: 'Start a project by choosing a language and a starter, then land in the editor ready to write.',
    ar: 'ابدأ مشروعًا باختيار لغة وقالب، ثم تصل إلى المحرر جاهزًا للكتابة.',
  },
  keywords: {
    en: 'new project create language template starter python java web',
    ar: 'مشروع جديد إنشاء لغة قالب بداية بايثون جافا ويب',
  },
  steps: [
    {
      title: { en: 'Choose a language', ar: 'اختر لغة' },
      body: {
        en: 'New project opens a picker with one tile per language. Ready languages like Python, Java and Web are bright and can be picked; the ones still on the way are dimmed until Warsha can run them.',
        ar: 'يفتح «مشروع جديد» نافذة فيها بطاقة لكل لغة. اللغات الجاهزة مثل Python وJava وWeb تظهر واضحة ويمكن اختيارها، أما التي لم تجهز بعد فتظهر باهتة إلى أن تصبح ورشة قادرة على تشغيلها.',
      },
      shot: 'picker-langs',
      keywords: {
        en: 'language python java web csharp c ready soon dimmed tile picker',
        ar: 'لغة بايثون جافا ويب جاهزة قريبًا باهتة بطاقة',
      },
      alt: {
        en: 'The New-project picker showing a tile per language, the ready ones bright and the rest dimmed.',
        ar: 'نافذة «مشروع جديد» وفيها بطاقة لكل لغة، الجاهزة واضحة والباقي باهت.',
      },
    },
    {
      title: { en: 'Pick a starter', ar: 'اختر قالبًا' },
      body: {
        en: 'Once you choose a language, its starters appear grouped from beginner to advanced. Pick one and it fills the project with working code you can Run right away.',
        ar: 'بعد اختيار اللغة تظهر قوالبها مرتّبة من المستوى المبتدئ إلى المتقدّم. اختر واحدًا فيملأ المشروع بكود يعمل ويمكنك تشغيله فورًا بزر التشغيل.',
      },
      shot: 'picker-templates',
      keywords: {
        en: 'starter template beginner intermediate advanced example sample fill',
        ar: 'قالب مبتدئ متوسط متقدّم مثال بداية',
      },
      alt: {
        en: "A language's starters in the picker, grouped from beginner to advanced, one card each.",
        ar: 'قوالب اللغة داخل النافذة، مرتّبة من المبتدئ إلى المتقدّم، لكل قالب بطاقة.',
      },
    },
    {
      title: { en: 'Straight into the editor', ar: 'مباشرة إلى المحرر' },
      body: {
        en: 'The new project opens right in the editor with its files ready. Change a line and press Run whenever you like.',
        ar: 'يُفتح المشروع الجديد في المحرر مباشرةً وملفاته جاهزة. عدّل سطرًا واضغط زر التشغيل متى شئت.',
      },
      shot: 'editor',
      alt: {
        en: 'A freshly created project open in the editor, ready to edit and run.',
        ar: 'مشروع أُنشئ للتو مفتوح في المحرر، جاهز للتعديل والتشغيل.',
      },
    },
  ],
}
