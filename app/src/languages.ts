/**
 * The language catalogue the New-project picker is built from.
 *
 * Warsha runs code entirely on the device, so a language is "ready" only once
 * its engine is actually wired into runtime/index.ts — today that is Java and
 * Python and nothing else. Every other entry here is a promise, not a feature:
 * it shows in the picker as a dimmed "Soon" tile that cannot be chosen, so a
 * student sees where Warsha is going without being handed a language that would
 * fail the moment they pressed Run.
 *
 * To make a language runnable: implement its Runtime, register it in
 * runtime/index.ts, flip `status` to 'ready' here, add its starters under
 * content/templates/ (and templates.ts), and — if it deserves a real mark
 * rather than a monogram — a glyph in ui/LangIcons.tsx. Nothing else in the
 * picker needs to change; it is a projection of this list.
 *
 * `mark` is the two-or-three-character monogram a "soon" language shows in place
 * of a real logo. It follows FileBadge's precedent: a letterform is a label you
 * read, which is wrong for a badge but right for a placeholder that is honestly
 * saying "artwork later". Ready languages ignore it — they draw their glyph.
 */

export type LangStatus = 'ready' | 'soon'

export interface Language {
  /** Stable key. A ready language's id equals its Template.lang. */
  id: string
  label: string
  status: LangStatus
  /** Shown on a ready tile — the answer to "which Java is this?". */
  version?: string
  /** Monogram for a "soon" tile; ignored when a glyph exists. */
  mark: string
}

/* Ordered the way the picker shows them: ready first (the two a student can use
 * today), then the "soon" set roughly by how often a first course reaches for
 * it. This list is the one place that grows as engines land. */
export const languages: Language[] = [
  { id: 'python', label: 'Python', status: 'ready', version: 'Python 3.14', mark: 'Py' },
  { id: 'java', label: 'Java', status: 'ready', version: 'Java 8', mark: 'J' },
  { id: 'javascript', label: 'JavaScript', status: 'soon', mark: 'JS' },
  { id: 'typescript', label: 'TypeScript', status: 'soon', mark: 'TS' },
  { id: 'c', label: 'C', status: 'soon', mark: 'C' },
  { id: 'cpp', label: 'C++', status: 'soon', mark: 'C++' },
  { id: 'csharp', label: 'C#', status: 'soon', mark: 'C#' },
  { id: 'go', label: 'Go', status: 'soon', mark: 'Go' },
  { id: 'rust', label: 'Rust', status: 'soon', mark: 'Rs' },
  { id: 'kotlin', label: 'Kotlin', status: 'soon', mark: 'Kt' },
  { id: 'swift', label: 'Swift', status: 'soon', mark: 'Sw' },
  { id: 'ruby', label: 'Ruby', status: 'soon', mark: 'Rb' },
  { id: 'php', label: 'PHP', status: 'soon', mark: 'Php' },
  { id: 'r', label: 'R', status: 'soon', mark: 'R' },
  { id: 'dart', label: 'Dart', status: 'soon', mark: 'Dt' },
  { id: 'scala', label: 'Scala', status: 'soon', mark: 'Sc' },
  { id: 'sql', label: 'SQL', status: 'soon', mark: 'SQL' },
  { id: 'lua', label: 'Lua', status: 'soon', mark: 'Lua' },
  { id: 'perl', label: 'Perl', status: 'soon', mark: 'Pl' },
  { id: 'haskell', label: 'Haskell', status: 'soon', mark: 'Hs' },
]

export const readyLanguages = languages.filter((l) => l.status === 'ready')
export const soonLanguages = languages.filter((l) => l.status === 'soon')

export function languageById(id: string): Language | undefined {
  return languages.find((l) => l.id === id)
}
