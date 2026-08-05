import { formatKeys } from './keys'

/**
 * How to write the Run shortcut for the device in front of the student.
 *
 * App.tsx binds Mod+Enter; a tooltip or hint that names the wrong modifier
 * is worse than none, and iPads with Magic Keyboards are common in the target
 * audience (spec §5.3). Kept as a named helper (rather than every call site
 * spelling `formatKeys('Mod+Enter')`) because three components quote it and
 * the console's idle line reads it verbatim.
 */
export function runShortcutLabel(): string {
  return formatKeys('Mod+Enter')
}
