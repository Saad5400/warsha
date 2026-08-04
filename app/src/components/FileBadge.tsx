/**
 * The badge that identifies a file's language in the explorer, the tab strip
 * and the welcome cards (spec §7.1).
 *
 * Java and Python get real glyphs (ui/LangIcons.tsx) rather than the "J" / "Py"
 * lettering this shipped with. A two-letter abbreviation has to be *read*,
 * which is the opposite of what a badge is for, and it carries nothing for a
 * student who does not already know the answer.
 *
 * The glyphs are monochrome (see LangIcons' header): this is a black/white UI,
 * so both language badges use one neutral chip — surface-4 under a bright
 * text-1 glyph (~11:1) — instead of the old warm/cool tones. The mark's shape,
 * not its colour, does the identifying. The other extensions keep their letter
 * — "M" and "{}" are not standing in for a logo, so there is no low-effort
 * placeholder to fix there; they stay on the quieter plain tone.
 */
import { LangIcon, type IconLang } from './ui/LangIcons'

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

const langs: Record<string, IconLang> = { java: 'java', py: 'python', cs: 'csharp' }

export type BadgeSize = 'sm' | 'md'
export type BadgeTone = 'java' | 'py' | 'plain'

const BADGE = 'grid place-items-center flex-none rounded-sm font-code font-bold leading-none'
const BADGE_SIZE: Record<BadgeSize, string> = {
  sm: 'size-[20px] text-micro tracking-[-0.03em]',
  md: 'size-[24px] text-meta tracking-[-0.03em]',
}
const BADGE_TONE: Record<BadgeTone, string> = {
  java: 'bg-surface-4 text-text-1',
  py: 'bg-surface-4 text-text-1',
  plain: 'bg-surface-4 text-text-3',
}

/** The badge's own class string. Exported so the welcome cards can wrap a "+". */
export function badgeClass(size: BadgeSize, tone: BadgeTone): string {
  return `${BADGE} ${BADGE_SIZE[size]} ${BADGE_TONE[tone]}`
}

const letters: Record<string, string> = {
  md: 'M',
  txt: 'T',
  json: '{}',
  // Web files. Short marks in the code font, the same "a letter is a label, not a
  // logo" call the other plain extensions make — html/css/js do not each own a
  // vendor glyph small enough to read at 20px, so they stay lettered.
  html: '<>',
  htm: '<>',
  css: '#',
  js: 'JS',
  mjs: 'JS',
  jsx: 'JS',
  ts: 'TS',
  tsx: 'TS',
}

/** Inset inside the 20px / 24px badge box so the glyph is not flush to the fill. */
const ICON_SIZE = { sm: 18, md: 20 } as const

export function FileBadge({ name, size = 'sm' }: { name: string; size?: BadgeSize }) {
  const ext = extOf(name)
  const lang = langs[ext]

  if (lang) {
    return <LangBadge lang={lang} size={size} />
  }

  return (
    <span aria-hidden="true" className={badgeClass(size, 'plain')}>
      {letters[ext] ?? '·'}
    </span>
  )
}

/** The same badge keyed by language rather than by filename (welcome cards). */
export function LangBadge({ lang, size = 'md' }: { lang: IconLang; size?: BadgeSize }) {
  return (
    <span aria-hidden="true" className={badgeClass(size, lang === 'java' ? 'java' : 'py')}>
      <LangIcon lang={lang} size={ICON_SIZE[size]} />
    </span>
  )
}
