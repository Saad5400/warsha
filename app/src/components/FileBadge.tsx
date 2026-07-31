/**
 * Two-letter language badge instead of a generic file glyph (spec §7.1): faster
 * to scan than colour-only icons, and it survives greyscale.
 * Java = warn on warn-soft (7.76:1), Python = info on info-soft (7.75:1).
 */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

const badges: Record<string, { text: string; tone: string }> = {
  java: { text: 'J', tone: 'badge--java' },
  py: { text: 'Py', tone: 'badge--py' },
  md: { text: 'M', tone: 'badge--plain' },
  txt: { text: 'T', tone: 'badge--plain' },
  json: { text: '{}', tone: 'badge--plain' },
}

export function FileBadge({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const badge = badges[extOf(name)] ?? { text: '·', tone: 'badge--plain' }
  return (
    <span aria-hidden="true" className={`badge badge--${size} ${badge.tone}`}>
      {badge.text}
    </span>
  )
}

/** The same badge keyed by language rather than by filename (welcome cards). */
export function LangBadge({ lang, size = 'md' }: { lang: 'java' | 'python'; size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden="true" className={`badge badge--${size} ${lang === 'java' ? 'badge--java' : 'badge--py'}`}>
      {lang === 'java' ? 'J' : 'Py'}
    </span>
  )
}
