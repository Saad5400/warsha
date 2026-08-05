/**
 * The badge that identifies a file's language in the explorer, the tab strip
 * and the welcome cards (spec §7.1).
 *
 * Java and Python get real glyphs (ui/LangIcons.tsx) rather than the "J" / "Py"
 * lettering this shipped with. A two-letter abbreviation has to be *read*,
 * which is the opposite of what a badge is for, and it carries nothing for a
 * student who does not already know the answer.
 *
 * Two renderings now live here (W2-A):
 *
 * - The CHIP — the surface-4 box with a monochrome glyph or letter pair — is
 *   the touch rendering, and stays the only rendering for the welcome cards
 *   (via badgeClass/LangBadge, which are untouched).
 * - The BARE icon — a 16px colored glyph from LangIcons' FileIcon, each file
 *   type in its language's brand ink (VS Code parity) — is what the tab strip,
 *   the breadcrumbs and the explorer tree show on a fine-pointer desktop. The
 *   swap is CSS-gated on the `desk:` variant, not a JS fork, so the explorer's
 *   16px desk slot (W1-C) picks it up without passing anything.
 *
 * The `bare` prop skips the chip entirely — for desk-only surfaces like the
 * breadcrumbs, where a hidden chip would be dead weight in the DOM.
 */
import { FileIcon, LangIcon, type IconLang } from './ui/LangIcons'

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

export function FileBadge({ name, size = 'sm', bare = false }: { name: string; size?: BadgeSize; bare?: boolean }) {
  const ext = extOf(name)
  const lang = langs[ext]

  // The bare colored icon (desk rendering). aria-hidden like the chip: the
  // accessible name always lives on the row or tab that holds the badge.
  const icon = (
    <FileIcon ext={ext} size={16} aria-hidden="true" className={bare ? undefined : 'hidden desk:block'} />
  )
  if (bare) return icon

  const chip = lang ? (
    <span aria-hidden="true" className={`${badgeClass(size, lang === 'java' ? 'java' : 'py')} desk:hidden`}>
      <LangIcon lang={lang} size={ICON_SIZE[size]} />
    </span>
  ) : (
    <span aria-hidden="true" className={`${badgeClass(size, 'plain')} desk:hidden`}>
      {letters[ext] ?? '·'}
    </span>
  )
  return (
    <>
      {chip}
      {icon}
    </>
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
