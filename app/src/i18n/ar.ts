/**
 * The interface in Arabic. Typed as `Bundle`, so it cannot fall behind en.ts.
 *
 * This is not a translation of en.ts, and reading it beside en.ts line by line
 * will be misleading: en.ts fixes what each string must *do* for the student —
 * say what happened, then what to do; blame nobody; no "Error:" / "Failed to";
 * second person for what the student did, third person for what the program
 * did. The Arabic carries that job in its own register, which regularly means a
 * different clause order, one sentence where English has two, or a verb where
 * English has a noun. A line that matches the English word for word is the one
 * to be suspicious of.
 *
 * Four rules were applied to every line below, and they are the difference
 * between a translation that helps and one that isolates the student:
 *
 * 1. ENGLISH STAYS ENGLISH WHERE THE DOMAIN IS ENGLISH. Java, Python, C#,
 *    main, class, package, stdin, exit code, .zip, .java, Enter, Wi-Fi, PDF.
 *    A student who learns «رمز الخروج» cannot search for it, will not find it
 *    in a stack trace, and will not see it on their exam. Arabic carries the
 *    sentence; the term keeps the name it has everywhere else.
 * 2. WESTERN DIGITS. `3`, never `٣`. Line numbers, exit codes and columns sit
 *    beside code, and code has one numeral system.
 * 3. BIDI IS HANDLED AT THE SEAM, not left to luck. Any interpolated file name,
 *    path or version goes through `iso()` — see its note. A `models/` dropped
 *    raw into an Arabic sentence renders as `/models`, which is a path the
 *    student does not have.
 * 4. ورشة IS A WORD, NOT A BRAND TOKEN. It is a normal Arabic noun and it
 *    behaves like one: «فتحت ورشة مشروعًا آخر». What it is *not* is the subject
 *    of a stock failure formula — «تعذّر على ورشة …» on every unhappy line is a
 *    tic no Arabic writer has, and it also puts the app's name in front of a
 *    student who only wants to know what happened to their file. So the failure
 *    lines name the event instead: «لم يكتمل التنزيل»، «لم يُحفظ عملك».
 *
 * The vocabulary settled on, so new strings can join it: المخرجات for what a
 * program prints (the pair المدخلات/المخرجات is what the student's own
 * curriculum uses), «زر التشغيل» whenever a sentence points at the Run button
 * rather than labelling it, and «قالب» for a starter.
 */
import type { Bundle } from './en'

/**
 * First-strong isolate (U+2068 … U+2069) around interpolated text.
 *
 * The Unicode bidi algorithm resolves a neutral character — `/`, `.`, `(` — by
 * its surroundings, so `داخل models/` puts the slash on the *Arabic* side and
 * shows `داخل /models`. An isolate makes the run resolve its own direction and
 * keeps its punctuation with it. FSI rather than LRI on purpose: a project the
 * student named «مشروعي» must stay RTL, and only first-strong detection gets
 * both cases right from one call.
 */
const iso = (s: string | number) => `⁨${s}⁩`

/**
 * File extensions, pre-isolated — and they MUST be, unlike the Latin words
 * around them.
 *
 * `Java` or `PDF` dropped into an Arabic sentence is fine: it opens with a
 * strong left-to-right letter, so the bidi algorithm gives the whole run to
 * LTR and it renders as written. `.zip` does not. Its first character is a
 * NEUTRAL full stop, which resolves to the direction of whatever surrounds it
 * — Arabic — so the dot is emitted on the Arabic side of the letters and
 * «صدّر ملف .zip» renders on screen as «صدّر ملف zip.»، an extension that does
 * not exist. Isolating the token keeps the dot with the letters it belongs to.
 *
 * Every literal extension in this file goes through one of these. A bare
 * '.zip' inside a string is a bug, not a style choice.
 */
const ZIP = iso('.zip')
const JAVA = iso('.java')
const PY = iso('.py')
/** The extensions, not the languages: `C` is `.c` and `H` is `.h`. */
const C = iso('.c')
const H = iso('.h')

/**
 * `C#`, isolated — the same bug as `.zip`, arriving from the other end.
 *
 * Here the neutral character TRAILS the Latin letters instead of leading them,
 * and it resolves exactly as badly: the `#` sits between an L run and Arabic,
 * takes the paragraph's RTL direction, and is emitted to the *left* of the `C`
 * — so «أساسيات C#» reads «#C» on screen, which is not a language. Any token
 * that opens or closes on punctuation needs the isolate; a bare `Java`, `React`
 * or `scanf` does not, because it is strong-LTR at both ends.
 */
const CSHARP = iso('C#')

/**
 * Arabic counted nouns. Not a nicety — «3 ملف» is wrong the way "3 file" is.
 *
 *   1  → ملف واحد          (mufrad)
 *   2  → ملفان             (muthanna)
 *   3–10 → 3 ملفات          (jamʿ qilla)
 *   11+  → 11 ملفًا          (tamyīz, singular accusative)
 *
 * Hundreds (100, 200 …) formally take the singular genitive; they are folded
 * into the 11+ form here, which is the reading everyone accepts and which no
 * student of ours will hit — the counts in this UI are files in a project.
 *
 * A counted noun also drags agreement along with it, which is why several call
 * sites below either put the verb *before* the count (a verb preceding its
 * subject stays singular in Arabic, so one form fits all four cases) or bake
 * the adjective into the four forms. Appending a fixed adjective to the result
 * of `files()` is what produces «ملف واحد جاهزة».
 */
function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one
  if (n === 2) return two
  const mod = n % 100
  return mod >= 3 && mod <= 10 ? `${n} ${few}` : `${n} ${many}`
}

const files = (n: number) => arCount(n, 'ملف واحد', 'ملفان', 'ملفات', 'ملفًا')
const items = (n: number) => arCount(n, 'عنصر واحد', 'عنصران', 'عناصر', 'عنصرًا')
const results = (n: number) => arCount(n, 'نتيجة واحدة', 'نتيجتان', 'نتائج', 'نتيجةً')

export const AR: Bundle = {
  // ---- runtime bootstrap ----
  runtimeFirstRunNote: 'تنزيل لمرة واحدة — بعده يبدأ التشغيل فورًا، حتى بلا إنترنت.',

  // ---- engine failures ----
  engineOffline: (lang) => `لم يكتمل تنزيل ${iso(lang)}. المرة الأولى وحدها تحتاج إلى إنترنت.`,
  engineOfflineHint: 'تأكّد من Wi-Fi وأعد المحاولة. شبكة المدرسة تحجب هذا التنزيل أحيانًا، فاسأل معلّمك.',
  engineIsolation: 'هذا المتصفّح يمنع ورشة من تشغيل البرامج التي تنتظر إجابتك.',
  engineIsolationHint: 'أعد تحميل الصفحة مرة واحدة. فإن بقي الحال، استخدم Chrome على Android أو على حاسوب.',
  engineBroken: (lang) => `تعثّر تجهيز ${iso(lang)}.`,
  engineBrokenHint: 'أعد المحاولة. وإن تكرّر الأمر، أعد تحميل الصفحة.',
  engineLost: 'توقّف محرّك اللغة عن الاستجابة، فأغلقته ورشة.',
  engineRetry: 'أعد المحاولة',
  engineDetails: 'التفاصيل',
  runUnsaved: `لم يُحفظ عملك على هذا الجهاز، فشُغّل ما هو ظاهر أمامك. صدّر ملف ${ZIP} لتحتفظ بنسخة.`,

  // ---- run lifecycle ----
  runOk: 'انتهى البرنامج. (exit code 0)',
  runFailed: (code) => `توقّف برنامجك قبل أن يكمل — exit code ${code}. السبب في الأسطر الحمراء أعلاه.`,
  runStopped: 'توقّف البرنامج. وملفاتك كلها محفوظة.',

  // ---- console ----
  stdinHint: 'برنامجك ينتظر منك إجابة — اكتبها ثم اضغط Enter.',
  stdinHintShort: 'ينتظر إجابتك — اكتبها ثم Enter.',
  consoleEmpty: 'شغّل كودك وستظهر مخرجاته هنا.',
  consoleCleared: 'مُسحت المخرجات.',

  // ---- preview surface ----
  previewTitle: 'المعاينة',
  previewEmpty: 'شغّل صفحتك وستظهر هنا.',
  viewPreview: 'المعاينة',
  viewConsole: 'وحدة التحكم',
  editorEmpty: 'اختر ملفًا من المستكشف وابدأ الكتابة.',
  truncated: 'أُخفيت الأسطر الأقدم (الحدّ 5000 سطر).',
  stdinQueued: 'سطرك محفوظ — برنامجك لم يطلب إدخالًا بعد.',
  stdinIdle: 'لا شيء يعمل الآن — اضغط زر التشغيل أولًا.',
  stdinWaitingPlaceholder: 'اكتب إجابتك ثم اضغط Enter',

  // ---- console status line ----
  statusIdle: 'كل شيء جاهز — اضغط زر التشغيل متى شئت.',
  statusIdleShortcut: (shortcut) => `كل شيء جاهز — اضغط زر التشغيل، أو ${iso(shortcut)}.`,
  statusRunning: 'برنامجك يعمل الآن.',
  statusOk: 'انتهى البرنامج — exit code 0.',
  statusFailed: (code) => `توقّف قبل أن يكمل — exit code ${code}. السبب في الأسطر الحمراء.`,
  statusFailedShort: (code) => `توقّف قبل أن يكمل — exit code ${code}.`,
  statusFailedNoCode: 'توقّف قبل أن يكمل — السبب في الأسطر الحمراء.',
  statusStopped: 'أوقفتَه أنت. وملفاتك محفوظة.',

  // ---- transcript controls ----
  copyOutput: 'نسخ المخرجات',
  copyOutputDone: 'نُسخت',
  copyOutputFailed: 'لم ينجح النسخ — حدّد النص وانسخه بنفسك.',
  clearOutput: 'مسح المخرجات',
  // "999+" is dropped rather than translated: a `+` glued to a number inside an
  // RTL badge renders on the wrong side, and the sentence says the same thing.
  newLines: (n) =>
    n > 999 ? 'أكثر من 999 سطرًا جديدًا' : arCount(n, 'سطر جديد', 'سطران جديدان', 'أسطر جديدة', 'سطرًا جديدًا'),
  jumpToLatest: 'الانتقال إلى الأحدث',
  showEarlier: (n) => `عرض ${n.toLocaleString('en')} سطرًا سابقًا`,

  // ---- status bar ----
  langJava: 'Java 17',
  langPython: 'Python 3.14',
  langPlain: 'نص عادي',
  langNone: 'لا ملف مفتوح',
  statusBarNoEntry: 'لا نقطة بداية',
  statusBarIndent: 'مسافات: 4',
  cursorAt: (line, col) => `سطر ${line}، عمود ${col}`,

  // ---- entry point ----
  noEntry: `لم تجد ورشة من أين تبدأ. أضف ملف main${PY}، أو Java class فيها main method، ثم اضغط زر التشغيل.`,
  cannotRun: (entry) => `ورشة لا تعرف بعد كيف تشغّل ${iso(entry)}.`,

  // ---- cross-file search ----
  searchPlaceholder: 'بحث',
  searchHint: 'اكتب لتبحث في كل ملفات المشروع.',
  searchMatchCase: 'مطابقة حالة الأحرف',
  searchWholeWord: 'الكلمة بأكملها',
  searchNoResults: 'لا نتائج',
  // Aa and ab are the labels printed on the two toggles, so they are named, not
  // described — the student is being pointed at a thing they can see.
  searchNoResultsHint: 'جرّب كلمات أخرى، أو أوقف زرَّي Aa و ab.',
  searchSummary: (matches, fileCount) => `${results(matches)} في ${files(fileCount)}`,
  searchCapped: (n) => `تُعرض أول ${n} نتيجة — ضيّق بحثك لترى البقية.`,

  // ---- storage ----
  storageQuotaTitle: 'مساحة هذا الجهاز أوشكت على النفاد، وقد يتوقّف الحفظ.',
  storageQuotaHint: `احذف مشروعًا انتهيت منه، أو صدّر عملك في ملف ${ZIP}.`,
  storageFailedTitle: 'لا تستطيع ورشة حفظ ملفاتك على هذا الجهاز الآن.',
  storageFailedHint: `واصل عملك — لم يضِع شيء — لكن صدّر ملف ${ZIP} قبل أن تغلق هذه الصفحة.`,
  storageMemoryTitle: 'هذا المتصفّح يمنع ورشة من حفظ الملفات، فعملك يبقى ما دامت هذه الصفحة مفتوحة.',
  storageMemoryHint: `صدّر ملف ${ZIP} قبل أن تغادر. غالبًا السبب هو التصفّح الخاص.`,
  storageEvictedTitle: 'لم يعد المشروع الذي كان مفتوحًا موجودًا، ففتحت ورشة مشروعًا آخر.',
  storageEvictedHint: `بعض المتصفّحات تحذف ملفات المواقع التي لم تفتحها منذ مدة. صدّر ملف ${ZIP} لتحتفظ بنسخة.`,
  storageExportNow: `تصدير ${ZIP}`,
  saveFailed: `لم يُحفظ عملك على هذا الجهاز. صدّر ملف ${ZIP} لتحتفظ بنسخة.`,
  multiTabTitle: 'ورشة مفتوحة في صفحة أخرى.',
  multiTabHint: 'اعمل في صفحة واحدة فقط، وإلا كتبت الصفحة الأخرى فوق ما تكتبه هنا.',

  // ---- the start panel ----
  welcomeNewFile: 'ملف جديد',
  welcomeNewProject: 'ابدأ من قالب',
  welcomeNewProjectBlurb: 'اختر لغة، ثم قالبًا على قدر مستواك.',
  welcomeImport: `استيراد ملف ${ZIP}`,
  welcomeStartProject: 'ابدأ مشروعًا',
  welcomeRecent: 'آخر المشاريع',
  welcomeRecentEmpty: 'ستظهر هنا المشاريع التي تنشئها.',
  // The count carries its own adjective: «لغتان جاهزة» is as wrong as it looks.
  welcomeLanguagesReady: (n) =>
    `${arCount(n, 'لغة واحدة جاهزة', 'لغتان جاهزتان', 'لغات جاهزة', 'لغةً جاهزة')} · والمزيد قريبًا`,

  // ---- the New-project template picker ----
  pickerTitle: 'مشروع جديد',
  pickerLangIntro: 'اختر لغة لترى قوالبها، ويمكنك تسمية المشروع لاحقًا.',
  pickerReadyHeading: 'جاهزة للتشغيل',
  pickerSoonHeading: 'قريبًا',
  pickerSoonNote: 'ورشة تشغّل كل شيء على جهازك، فكل لغة تحتاج محرّكها الخاص. وهذه في الطريق.',
  pickerSoonBadge: 'قريبًا',
  pickerSoonLabel: (lang) => `${iso(lang)} — قريبًا`,
  pickerBack: 'كل اللغات',
  pickerChooseTemplate: (lang) => `اختر قالب ${iso(lang)}`,
  pickerBlank: 'أو ابدأ بملف فارغ',
  levelBeginner: 'مبتدئ',
  levelIntermediate: 'متوسّط',
  levelAdvanced: 'متقدّم',
  templateManifest: (fileCount, entry) => `${files(fileCount)} · ${iso(entry)}`,

  // ---- install to the home screen ----
  installAction: 'تثبيت ورشة',
  // Both names given: the student has to find these rows in a Safari menu that
  // is Arabic on an Arabic device and English on an English one.
  installIos:
    'على iPhone و iPad: اضغط «مشاركة» (Share)، ثم «إضافة إلى الشاشة الرئيسية» (Add to Home Screen)، لتُفتح ورشة بعدها كأي تطبيق.',

  // ---- zip import / export ----
  importIntro: `اختر ملف ${ZIP} لمشروع — صدّرته من ورشة، أو أعطاك إياه معلّمك.`,
  importDropHint: `أفلت ملف ${ZIP} هنا، أو`,
  importReplaces: (n) => `سيحلّ هذا محلّ ${files(n)} لديك الآن. صدّر ملف ${ZIP} أولًا إن أردت الاحتفاظ بعملك.`,
  importEmptyZip: `لا ملفات داخل ملف ${ZIP} هذا. جرّب غيره.`,
  importNotZip: `هذا ليس ملف ${ZIP}. اختر ملفًا ينتهي اسمه بـ ${ZIP}.`,
  importUnreadable: (detail) => `لم يُفتح ملف ${ZIP} هذا. (${iso(detail)})`,
  importSkipped: (n) => `تُرك ${items(n)} — ورشة تستورد الملفات النصية فقط.`,
  imported: (name, n) => `استُورد ${iso(name)} — ${files(n)}.`,
  exported: (name, n) => `صُدّر ${iso(name)} — ${files(n)}.`,
  importReading: 'جارٍ القراءة…',
  importChooseZip: `اختر ملف ${ZIP}`,
  importReplaceFiles: 'استبدال الملفات',
  importAction: 'استيراد',
  // The adjective is inside the count for agreement — see arCount's note.
  importPicked: (n) => `${arCount(n, 'ملف واحد جاهز', 'ملفان جاهزان', 'ملفات جاهزة', 'ملفًا جاهزًا')} للاستيراد.`,
  importFileCount: (n) => files(n),

  // ---- accessible names for the chrome ----
  a11yActivityBar: 'شريط الأنشطة',
  a11yExplorer: 'المستكشف',
  a11ySearch: 'بحث',
  a11yManage: 'إدارة',
  a11yBreadcrumbs: 'مسار التنقّل',
  a11yDismiss: 'إغلاق',
  a11yToggleSidebar: 'إظهار الشريط الجانبي أو إخفاؤه',
  a11yTogglePanel: 'إظهار اللوحة أو إخفاؤها',
  a11yMoreActions: 'إجراءات أخرى',
  a11yResizeOutput: 'تغيير حجم لوحة المخرجات',
  a11yProgramOutput: 'مخرجات البرنامج',
  a11yProgramInput: 'مدخلات البرنامج',
  a11yProjectFiles: 'ملفات المشروع',
  a11yUnsavedChanges: 'تغييرات غير محفوظة',
  a11yAppMenu: 'قائمة التطبيق',
  a11yQuickOpen: 'الفتح السريع',
  a11yQuickOpenResults: 'نتائج الفتح السريع',
  a11ySearchFilesByName: 'البحث عن الملفات بالاسم',
  a11ySearchResults: 'نتائج البحث',
  a11yFileToRun: 'الملف الذي يُشغَّل',
  a11yFileToRunHint: 'اختر الملف الذي يبدأ منه التشغيل',
  a11yOutputView: 'لوحة المخرجات',
  a11yStatusBar: 'شريط الحالة',
  a11yOpenFiles: 'الملفات المفتوحة',
  a11yFiles: 'الملفات',
  a11yConsole: 'وحدة التحكم',
  a11yViewScale: 'حجم العرض',
  a11yGoToLine: 'الانتقال إلى سطر',
  a11ySmallerText: 'تصغير الخط',
  a11yBiggerText: 'تكبير الخط',

  // ---- explorer ----
  explorerTitle: 'المستكشف',
  explorerEmpty: 'لا ملفات بعد',
  explorerNewFile: 'ملف جديد…',
  explorerNewFolder: 'مجلّد جديد…',
  explorerOpen: 'فتح',
  explorerRename: 'إعادة تسمية…',
  explorerDelete: 'حذف',
  explorerCollapse: 'طيّ المجلّدات',
  explorerNewFilePlaceholder: 'اسم الملف الجديد',
  explorerNewFolderPlaceholder: 'اسم المجلّد الجديد',
  explorerNewFolderAction: 'مجلّد جديد',
  explorerShowStarters: 'اعرض القوالب',
  explorerEmptyBody: `أنشئ ملفًا لتبدأ. يكفي أن ينتهي اسمه بـ ${PY} أو ${JAVA} حتى تعرف ورشة كيف تشغّله.`,
  explorerActionsMenu: 'إجراءات المستكشف',
  explorerRowActions: (name) => `إجراءات ${iso(name)}`,

  // ---- editor ----
  editorNoFile: 'لا ملف مفتوح',
  editorBrowseFiles: 'تصفّح الملفات',

  // ---- the two "this went badly" screens ----
  capabilityTitle: 'ورشة لا تعمل في هذا المتصفّح',
  capabilityStillDo: 'ما يمكنك فعله هنا',
  capabilityWhatToTry: 'جرّب هذا',
  capabilityTryBody:
    'افتح ورشة في Chrome على هاتف أو جهاز لوحي بنظام Android، أو في Chrome أو Edge أو Safari على حاسوب — فهذه تشغّل Java و Python.',
  capabilityReload: 'أعد التحميل وتحقّق مجددًا',
  capWasm: 'هذا المتصفّح لا يشغّل WebAssembly، وورشة تحتاجه لتشغيل Java و Python. لن تعمل ورشة هنا.',
  capWorkers: 'هذا المتصفّح لا يشغّل المهام في الخلفية، وورشة تحتاجها لتشغيل كودك.',
  capOpfs: `هذا المتصفّح لا يحفظ الملفات على جهازك، فسيضيع عملك عند إغلاق الصفحة. صدّر ملف ${ZIP} قبل أن تغادر.`,
  capIsolation:
    'قد لا يعمل الإدخال التفاعلي لبرامج Java و Python في هذا المتصفّح بعد. أعد تحميل الصفحة مرة واحدة، فإن ظلّ برنامجك لا يقبل ما تكتبه، استخدم Chrome على Android أو على حاسوب.',
  capStillWorks: ['كتابة الكود وقراءته في المحرّر', 'إنشاء الملفات وإعادة تسميتها وحذفها', `تصدير مشروعك في ملف ${ZIP}`],
  crashTitle: 'توقّفت ورشة عن العمل',
  crashBody: 'حدث خلل في ورشة. ملفاتك ما زالت محفوظة على هذا الجهاز، وإعادة تحميل الصفحة كفيلة بإعادتها.',
  crashReload: 'أعد تحميل ورشة',
  crashForgetLayout: 'أعد التحميل مع إعادة ضبط التخطيط',
  crashWhatWentWrong: 'ما الذي حدث',

  // ---- the engine's loading phases ----
  phaseDownloading: 'جارٍ تنزيل اللغة',
  phaseUnpacking: 'جارٍ فكّ الحزمة',
  phaseStarting: 'جارٍ البدء',
  phaseCompiling: 'جارٍ ترجمة كودك',

  // ---- quick input ----
  quickCommandsPlaceholder: 'اكتب اسم الأمر الذي تريد تنفيذه',
  quickLinePlaceholder: 'اكتب رقم السطر الذي تريد الانتقال إليه',
  quickProjectsPlaceholder: 'ابحث عن مشروع سابق بالاسم',
  quickOpenFileFirst: 'افتح ملفًا أولًا، ثم اكتب رقم السطر.',
  quickNoResults: 'لا نتائج مطابقة',
  quickFilesPlaceholder: 'ابحث عن ملف بالاسم (أضف : للانتقال إلى سطر، و > لتنفيذ أمر)',
  quickLineRange: (lines, current) =>
    `اكتب رقم سطر بين 1 و ${lines} للانتقال إليه${current != null ? ` (أنت الآن في السطر ${current})` : ''}.`,

  // ---- run bar / run control ----
  runAction: 'تشغيل',
  stopAction: 'إيقاف',
  runPreparing: 'جارٍ التجهيز…',
  outputRestore: 'استعادة لوحة المخرجات',
  outputMaximize: 'تكبير لوحة المخرجات',
  outputHide: 'إخفاء المخرجات',
  outputShow: 'إظهار المخرجات',
  runWhat: (what) => `تشغيل ${iso(what)}`,
  stopWhat: (what) => `إيقاف ${iso(what)}`,
  runTipRun: (what, shortcut) => `تشغيل ${iso(what)} (${iso(shortcut)})`,
  runTipStop: (shortcut) => `إيقاف البرنامج (${iso(shortcut)})`,
  runTipStopPreparing: (shortcut) => `إيقاف تجهيز اللغة (${iso(shortcut)})`,
  statusBarRunStarts: (entry) => `التشغيل يبدأ من ${iso(entry)}`,

  // ---- the status pill's seven states ----
  pillReady: 'جاهزة',
  pillPreparing: 'قيد التجهيز',
  pillRunning: 'قيد التشغيل',
  pillWaiting: 'بانتظارك',
  pillFinished: 'انتهى',
  pillFailed: 'توقّف مبكرًا',
  pillStopped: 'أوقفته أنت',

  // ---- tabs ----
  tabsCloseOthers: 'إغلاق الأخرى',
  tabsCloseAll: 'إغلاق الكل',
  tabsClose: (name) => `إغلاق ${iso(name)}`,
  tabsCloseUnsaved: (name) => `إغلاق ${iso(name)} (غير محفوظ)`,
  tabsMore: 'المزيد',

  // ---- file and folder names the student types ----
  nameEmpty: 'الاسم فارغ.',
  nameSlashEnds: 'الاسم لا يبدأ بـ "/" ولا ينتهي بها.',
  namePathInvalid: 'هذا المسار لا يصلح.',
  nameBadCharacter: 'في هذا الاسم حرف لا تقبله الملفات.',
  nameTooLong: 'هذا الاسم أطول من اللازم.',
  nameNeedsStem: (ext) => `اكتب اسمًا قبل ${iso(`"${ext}"`)}.`,
  nameDotStart: 'الاسم لا يبدأ بنقطة.',
  nameDotEnd: 'الاسم لا ينتهي بنقطة أو مسافة.',
  nameTaken: (name) => `هنا «${iso(name)}» بالفعل.`,
  pathExists: (path) => `${iso(path)} موجود بالفعل.`,

  // ---- dialogs ----
  dlgNewFileTitle: 'ملف جديد',
  dlgNewFolderTitle: 'مجلّد جديد',
  dlgInside: (dir) => `داخل ${iso(`${dir}/`)}`,
  dlgInRoot: 'في جذر المشروع',
  // Example file and folder names: code, so untranslated.
  dlgFilePlaceholder: `Main${JAVA}`,
  dlgFolderPlaceholder: 'models',
  dlgCreate: 'إنشاء',
  dlgOk: 'حسنًا',
  dlgCancel: 'إلغاء',
  dlgRenameFileTitle: 'إعادة تسمية الملف',
  dlgRenameFolderTitle: 'إعادة تسمية المجلّد',
  dlgRename: 'إعادة تسمية',
  dlgDeleteFileTitle: 'حذف هذا الملف؟',
  dlgDeleteFolderTitle: 'حذف هذا المجلّد؟',
  dlgDeleteFileBody: (path) => `سيُحذف ${iso(path)}، ولا رجعة في هذا.`,
  dlgDeleteFolderBody: (path) => `سيُحذف ${iso(path)} وكل ما بداخله، ولا رجعة في هذا.`,
  dlgDelete: 'حذف',
  dlgEmptyTitle: 'إفراغ هذا المشروع؟',
  dlgEmptyWhat: 'إفراغ المشروع',
  dlgEmptyOk: 'أفرغه',
  // `what` arrives already translated (today: «إفراغ المشروع»), so it heads the
  // sentence as a verbal noun: «إفراغ المشروع يحذف 4 ملفات…».
  dlgReplaceBody: (what, fileCount) =>
    `${what} يحذف ${files(fileCount)} لديك الآن في ورشة. صدّر ملف ${ZIP} أولًا إن أردت الاحتفاظ بعملك.`,
  dlgNewProjectTitle: 'مشروع جديد',
  dlgNewProjectFrom: (template) => `مشروع جديد من «${iso(template)}»`,
  dlgProjectName: 'اسم المشروع',
  dlgProjectNameRequired: 'اكتب اسمًا للمشروع.',
  dlgRenameProjectTitle: 'إعادة تسمية المشروع',
  dlgDeleteProjectTitle: (name) => `حذف «${iso(name)}»؟`,
  // Verb first, so one form agrees with «ملف واحد» and with «5 ملفات» alike.
  dlgDeleteProjectBody: (fileCount) =>
    `${fileCount ? `سيُحذف معه ${files(fileCount)}. ` : ''}لا رجعة في هذا. صدّر ملف ${ZIP} أولًا إن أردت الاحتفاظ بعملك.`,
  aboutTitle: 'ورشة',
  aboutBody: `ورشة للكود — Java و Python و ${CSHARP} والويب، كلها داخل متصفّحك. وملفاتك تبقى على هذا الجهاز.`,
  aboutVersion: (version) => `الإصدار ${iso(version)}`,

  // ---- toasts ----
  noteShareBroken: 'وصل رابط المشاركة تالفًا أو ناقصًا — اطلب رابطًا جديدًا.',
  noteShareSaveFailed: 'لم يُحفظ المشروع المشارَك على هذا الجهاز.',
  noteProjectReady: (name, fileCount) => `«${iso(name)}» جاهز — ${files(fileCount)}.`,
  noteProjectReadyBare: (name) => `«${iso(name)}» جاهز.`,
  noteShareDuplicate: (name) => `هذا المشروع عندك بالفعل دون تغيير، ففُتح «${iso(name)}».`,
  noteAlreadyFormatted: 'الملف منسّق بالفعل.',
  noteFormatted: 'نُسّق الملف.',
  noteFormatNeedsPython: 'شغّل هذا الملف مرة ليُحمَّل Python، وبعدها يعمل التنسيق.',
  noteFormatFailed: 'لم يُنسَّق هذا الملف.',
  noteImageCopied: 'نُسخت الصورة — الصقها أينما شئت.',
  noteImageDownloaded: 'نُزّلت الصورة.',
  noteImageFailed: 'لم تُنشأ صورة لهذا الملف.',
  noteLinkTooBig: `هذا المشروع أكبر من أن يتّسع له رابط — صدّره في ملف ${ZIP}.`,
  noteLinkCopied: 'نُسخ الرابط — وفتحه يعيد إنشاء هذا المشروع.',
  noteLinkCopyFailed: 'لم يُنسخ الرابط.',
  notePdfMaking: 'جارٍ إنشاء ملف PDF…',
  notePdfDownloaded: 'نُزّل ملف PDF.',
  notePdfFailed: 'لم يُنشأ ملف PDF.',
  noteProjectEmptied: 'أُفرغ المشروع.',
  noteProjectNameTaken: 'عندك مشروع بهذا الاسم بالفعل.',
  noteProjectCreateFailed: 'لم يُنشأ هذا المشروع.',
  noteProjectDeleted: (name) => `حُذف «${iso(name)}».`,
  noteTemplateReady: (name, fileCount) => `${iso(name)} جاهز — ${files(fileCount)}.`,
  noteMigrated: (fileCount) => `أصبح ${files(fileCount)} في مشروع يمكنك تسميته والتنقّل بينه وبين غيره.`,
  noteMigrationKept: 'لم يكتمل نقل ملفاتك إلى مشروع، فتُركت كما هي تمامًا.',
  defaultSharedName: 'مشروع مشارَك',
  defaultProjectName: 'مشروع ورشة',

  // ---- the menu bar ----
  menuFile: 'ملف',
  menuNewFile: 'ملف جديد…',
  menuNewProject: 'مشروع جديد…',
  menuOpenRecent: 'المشاريع الأخيرة',
  menuImportZip: `استيراد ملف ${ZIP}…`,
  menuExportZip: `تصدير كملف ${ZIP}`,
  menuShareLink: 'مشاركة كرابط…',
  menuSharePdf: 'مشاركة كملف PDF…',
  menuSaveAll: 'حفظ الكل',
  menuRenameProject: 'إعادة تسمية المشروع…',
  menuEmptyProject: 'إفراغ المشروع…',
  menuDeleteProject: 'حذف المشروع…',
  menuEdit: 'تحرير',
  menuUndo: 'تراجع',
  menuRedo: 'إعادة',
  menuFind: 'بحث…',
  menuFindInFiles: 'بحث في الملفات…',
  menuView: 'عرض',
  menuToggleExplorer: 'إظهار/إخفاء المستكشف',
  menuToggleConsole: 'إظهار/إخفاء وحدة التحكم',
  menuBiggerText: 'تكبير الخط',
  menuSmallerText: 'تصغير الخط',
  // Text size and view scale are two different controls, so the four rows say
  // which one they move: الخط for the code, الواجهة for everything around it.
  menuZoomIn: 'تكبير الواجهة',
  menuZoomOut: 'تصغير الواجهة',
  menuResetZoom: 'إعادة ضبط حجم الواجهة',
  // Literal edges, not reading order: this moves the button to that side of the
  // glass, and in RTL «اليسار» is still the left of the screen.
  menuRunOnLeft: 'زر التشغيل على اليسار',
  menuRunOnRight: 'زر التشغيل على اليمين',
  menuRun: 'تشغيل',
  menuRunEntry: (entry) => `تشغيل ${iso(entry)}`,
  menuStop: 'إيقاف',
  menuFormatFile: 'تنسيق الملف',
  menuHelp: 'مساعدة',
  menuAbout: 'عن ورشة',
  menuCommandPalette: 'لوحة الأوامر…',
  menuViewScale: 'حجم العرض',
  menuFormatFileRow: 'تنسيق الملف',
  menuShareImage: 'مشاركة كصورة…',
  menuShareProjectLink: 'مشاركة المشروع كرابط…',
  menuShareProjectPdf: 'مشاركة المشروع كملف PDF…',
  menuProjectOpenHint: 'مفتوح',
  menuLanguage: 'اللغة',
  menuBack: 'رجوع',

  // ---- the command palette ----
  // The category before the colon is the same word that heads the menu bar, so
  // a student who read it in a menu can type it here and find the command.
  cmdCloseQuickInput: 'إغلاق الإدخال السريع',
  cmdCloseDrawer: 'إغلاق درج الملفات',
  cmdFileNewFile: 'ملف: ملف جديد…',
  cmdFileSaveAll: 'ملف: حفظ الكل',
  cmdFileFormat: 'ملف: تنسيق المستند',
  cmdFileShareImage: 'ملف: مشاركة كصورة…',
  cmdFileImport: `ملف: استيراد ملف ${ZIP}…`,
  cmdFileCloseEditor: 'ملف: إغلاق المحرّر',
  cmdEditFind: 'تحرير: بحث',
  cmdSearchInFiles: 'بحث: بحث في الملفات',
  cmdViewToggleSideBar: 'عرض: إظهار/إخفاء الشريط الجانبي',
  cmdViewTogglePanel: 'عرض: إظهار/إخفاء اللوحة السفلية',
  cmdViewFocusExplorer: 'عرض: التركيز على المستكشف',
  cmdViewNextEditor: 'عرض: المحرّر التالي',
  cmdViewPrevEditor: 'عرض: المحرّر السابق',
  cmdViewBiggerText: 'عرض: تكبير الخط',
  cmdViewSmallerText: 'عرض: تصغير الخط',
  cmdViewZoomIn: 'عرض: تكبير الواجهة',
  cmdViewZoomOut: 'عرض: تصغير الواجهة',
  cmdViewResetZoom: 'عرض: إعادة ضبط حجم الواجهة',
  cmdViewPalette: 'عرض: لوحة الأوامر…',
  cmdRunFile: 'تشغيل: تشغيل الملف',
  cmdRunStop: 'تشغيل: إيقاف',
  cmdGoToFile: 'انتقال: الانتقال إلى ملف…',
  cmdGoToLine: 'انتقال: الانتقال إلى سطر/عمود…',
  cmdProjectsOpenRecent: 'المشاريع: فتح مشروع سابق…',
  cmdProjectsNew: 'المشاريع: مشروع جديد…',
  cmdProjectsRename: 'المشاريع: إعادة تسمية المشروع…',
  cmdProjectsExport: `المشاريع: تصدير كملف ${ZIP}`,
  cmdProjectsShareLink: 'المشاريع: مشاركة كرابط',
  cmdProjectsSharePdf: 'المشاريع: مشاركة كملف PDF',
  cmdProjectsEmpty: 'المشاريع: إفراغ المشروع…',
  cmdProjectsDelete: 'المشاريع: حذف المشروع…',
  cmdViewLanguage: 'عرض: تغيير لغة الواجهة',

  // Starter names and blurbs, by Template id — see the note in en.ts for why
  // this record is empty there and filled here. Any id missing falls back to
  // the template's own English fields rather than disappearing from the picker.
  //
  // The name says what the starter IS and the blurb says what is inside it, in
  // the voice of a teacher pointing at an exercise — not a feature list. The
  // level is already a heading above the card, so no blurb repeats it.
  //
  // Where the language names the thing, the language's word is kept: Java and
  // C# call them `methods`, so the card does too, while Python and C call them
  // functions and «الدوالّ» is what every Arabic curriculum calls those. Same
  // for `class`, `struct`, `interface`, `ref`, `runes`, `import`/`export` —
  // the student meets them spelled that way in the file the card opens.
  templates: {
    'python-basics': {
      name: 'أساسيات Python',
      blurb: `طباعة ومتغيّرات وحلقة و${iso('input()')} — ملف واحد لا غير.`,
    },
    'python-functions': {
      name: 'الدوالّ في Python',
      blurb: 'عرّف دوالّ، ومرّ على قائمة، وقرّر لكل قيمة على حدة.',
    },
    'java-basics': {
      name: 'أساسيات Java',
      blurb: 'طباعة ومتغيّرات لها أنواع وحلقة و Scanner، في class واحد بلا packages.',
    },
    'java-methods': {
      name: 'methods في Java',
      blurb: 'اكتب static methods، واحسب متوسّط مصفوفة، وقرّر لكل قيمة.',
    },
    'java-oop': {
      name: 'بداية OOP في Java',
      blurb: 'classes موزّعة على packages، ووراثة، و Scanner يقرأ ما تكتبه.',
    },
    python: {
      name: 'بداية OOP في Python',
      blurb: `وحدة أشكال فيها classes، وحلقة تمرّ على الكائنات، و${iso('input()')}.`,
    },
    'web-page': {
      name: 'صفحة ويب',
      blurb: 'HTML للبنية، و CSS للشكل، ومعاينة حيّة بجانبهما.',
    },
    'web-js': {
      name: 'أساسيات JavaScript',
      blurb: 'JavaScript وحده: حلقة ودالّة ومخرجات في وحدة التحكم.',
    },
    'web-interactive': {
      name: 'صفحة تفاعلية',
      blurb: 'زر يستجيب للضغط — HTML و CSS و JavaScript معًا.',
    },
    'web-ts': {
      name: 'أساسيات TypeScript',
      blurb: 'أنواع و interface ودالّة لها نوع، والمخرجات في وحدة التحكم.',
    },
    'web-ts-modules': {
      name: 'modules في TypeScript',
      blurb: 'قسّم برنامجك على عدّة ملفات بـ import و export.',
    },
    'web-tailwind': {
      name: 'بطاقة Tailwind',
      blurb: 'بطاقة مصمّمة بأدوات Tailwind، تعمل من جهازك بلا أي خطوة بناء.',
    },
    'web-modules': {
      name: 'modules داخل صفحة',
      blurb: 'صفحة تستورد TypeScript عبر module script، تُحزَم وتُعرض أمامك مباشرة.',
    },
    'web-react': {
      name: 'عدّاد React',
      blurb: 'مكوّن React له state، مكتوب بـ TSX ويُحزَم على جهازك.',
    },
    'web-svelte': {
      name: 'عدّاد Svelte',
      blurb: 'مكوّن Svelte فيه runes وتنسيقات خاصة به، يُترجَم على جهازك.',
    },
    'web-vue': {
      name: 'عدّاد Vue',
      blurb: 'مكوّن Vue في ملف واحد، فيه ref وتنسيقات خاصة به، يُترجَم على جهازك.',
    },
    'csharp-basics': {
      name: `أساسيات ${CSHARP}`,
      blurb: 'طباعة ومتغيّرات لها أنواع وحلقة و Console.ReadLine، في ملف واحد من أوّله إلى آخره.',
    },
    'csharp-methods': {
      name: `methods في ${CSHARP}`,
      blurb: 'اكتب static methods، واحسب متوسّط مصفوفة، وقرّر لكل قيمة.',
    },
    'csharp-starter': {
      name: `بداية OOP في ${CSHARP}`,
      blurb: 'class للأشكال في ملف مستقل، ووراثة، وحلقة على الكائنات، وإدخال منك.',
    },
    'c-basics': {
      name: 'أساسيات C',
      blurb: 'طباعة ومتغيّرات لها أنواع وحلقة و scanf، في ملف واحد من أوّله إلى آخره.',
    },
    'c-methods': {
      name: 'الدوالّ في C',
      blurb: 'اكتب دوالّ، واحسب متوسّط مصفوفة، وقرّر لكل قيمة.',
    },
    'c-starter': {
      name: 'بداية structs في C',
      blurb: `تعريف struct ودوالّه موزّعة بين ${H} و ${C}، مع حلقة وإدخال منك.`,
    },
  },
}
