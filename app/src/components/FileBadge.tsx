/**
 * Two-letter language badge instead of a generic file glyph (spec §7.1): faster
 * to scan than colour-only icons, and it survives greyscale.
 * Java = warn on warn-soft, Python = info on info-soft.
 */
export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

const badges: Record<string, { text: string; className: string }> = {
  java: { text: 'J', className: 'bg-warn-soft text-warn' },
  py: { text: 'Py', className: 'bg-info-soft text-info' },
  md: { text: 'M', className: 'bg-surface-4 text-text-3' },
  txt: { text: 'T', className: 'bg-surface-4 text-text-3' },
  json: { text: '{}', className: 'bg-surface-4 text-text-3' },
}

export function FileBadge({ name }: { name: string }) {
  const badge = badges[extOf(name)] ?? { text: '•', className: 'bg-surface-4 text-text-3' }
  return (
    <span
      aria-hidden="true"
      className={`grid size-5 shrink-0 place-items-center rounded-sm font-code text-[10px] font-bold ${badge.className}`}
    >
      {badge.text}
    </span>
  )
}
