import { formatKeys } from './keys'

/**
 * Named helper rather than every call site spelling `formatKeys('Mod+Enter')`
 * — three components and the console's idle line quote it verbatim, and a
 * hint naming the wrong modifier is worse than none (iPads with Magic
 * Keyboards are common here — spec §5.3).
 */
export function runShortcutLabel(): string {
  return formatKeys('Mod+Enter')
}
