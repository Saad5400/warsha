/**
 * How to write the Run shortcut for the device in front of the student.
 *
 * App.tsx binds Cmd/Ctrl+Enter; a tooltip or hint that names the wrong modifier
 * is worse than none, and iPads with Magic Keyboards are common in the target
 * audience (spec §5.3), so resolve it once here rather than guessing per call
 * site.
 */
export function runShortcutLabel(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  // iPadOS 13+ reports a Mac UA; both want the Command glyph either way.
  return /Mac|iPad|iPhone|iPod/.test(ua) ? '⌘↵' : 'Ctrl+↵'
}
