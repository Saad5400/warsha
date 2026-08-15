import { IconUser } from '../../components/ui/Icons'
import type { Tutorial } from '../types'

/**
 * Signing in to save work across devices — Warsha's optional cloud account.
 * Warsha works with no account at all (your files live on the device); signing
 * in is what raises your sync limits and carries your work between devices.
 * Shape and rules follow getting-started.ts.
 */
export const account: Tutorial = {
  id: 'account',
  category: 'sharing',
  icon: IconUser({ size: 22 }),
  title: { en: 'Sign in and save to the cloud', ar: 'سجّل الدخول واحفظ في السحابة' },
  summary: {
    en: 'Optional: sign in to carry your projects between devices and raise your sync limits.',
    ar: 'اختياري: سجّل الدخول لتنقل مشاريعك بين الأجهزة وترفع حدود المزامنة.',
  },
  keywords: {
    en: 'account sign in log in cloud sync sign up email password devices save backup',
    ar: 'حساب تسجيل الدخول دخول سحابة مزامنة بريد كلمة المرور أجهزة حفظ نسخة احتياطية',
  },
  steps: [
    {
      title: { en: 'Find Sign in', ar: 'اعثر على تسجيل الدخول' },
      body: {
        en: 'Warsha needs no account to write and run code — your files live on this device. When you do want your work on more than one device, open the Manage menu and choose Sign in.',
        ar: 'لا تحتاج ورشة إلى حساب لتكتب وتشغّل الكود — فملفاتك على هذا الجهاز. وحين ترغب في أن يكون عملك على أكثر من جهاز، افتح قائمة الإدارة واختر تسجيل الدخول.',
      },
      shot: 'account-menu',
      keywords: {
        en: 'manage menu sign in account gear settings',
        ar: 'قائمة الإدارة تسجيل الدخول حساب الإعدادات',
      },
      alt: {
        en: 'The Manage menu open with the Sign in item highlighted.',
        ar: 'قائمة الإدارة مفتوحة مع إبراز عنصر تسجيل الدخول.',
      },
    },
    {
      title: { en: 'Sign in to sync', ar: 'سجّل الدخول للمزامنة' },
      body: {
        en: 'Enter your email and password (or create an account). Once you are signed in, your projects sync to the cloud, so you can pick any of them up again on another device — and your sync limits go up.',
        ar: 'أدخل بريدك وكلمة المرور (أو أنشئ حسابًا). بعد تسجيل الدخول تتزامن مشاريعك مع السحابة، فتستأنف أيًّا منها على جهاز آخر — وترتفع حدود المزامنة لديك.',
      },
      shot: 'account-dialog',
      keywords: {
        en: 'email password sign up create account sync cloud limits devices',
        ar: 'بريد كلمة المرور إنشاء حساب مزامنة سحابة حدود أجهزة',
      },
      alt: {
        en: 'The sign-in dialog with email and password fields.',
        ar: 'نافذة تسجيل الدخول وفيها حقلا البريد وكلمة المرور.',
      },
    },
  ],
}
