/**
 * What a file's name says about it.
 *
 * Warsha reads the ending and nothing else: `langForPath` picks the engine from
 * it, `editorLangForPath` picks the grammar, `entryCandidates` decides what Run
 * can start, and `FileBadge` draws the icon. A file with no ending is therefore
 * inert — plain text that never runs — which is almost never what a student
 * meant by typing `Main`.
 *
 * This module answers the two questions the shell asks before it creates or
 * renames a file: is an ending missing, and which endings are worth offering.
 * Pure, so the ranking can be reasoned about without a project open.
 */
import { extOf } from './components/FileBadge'
import { langForPath } from './runtime'

export function leafOf(name: string): string {
  const i = name.lastIndexOf('/')
  return i === -1 ? name : name.slice(i + 1)
}

/** True when the leaf carries an ending. A leading dot is a name, not an ending — ".gitignore" is whole. */
export function hasExtension(name: string): boolean {
  return leafOf(name).lastIndexOf('.') > 0
}

/**
 * Names that are complete without an ending everywhere else in the world. A
 * student who types one of these means it, so nothing is offered for them.
 */
const WHOLE_WITHOUT_ONE = new Set([
  'makefile',
  'dockerfile',
  'license',
  'licence',
  'notice',
  'readme',
  'changelog',
  'authors',
  'contributing',
  'procfile',
  'cname',
])

export function isWholeWithoutExtension(name: string): boolean {
  return WHOLE_WITHOUT_ONE.has(leafOf(name).toLowerCase())
}

/**
 * The endings the picker offers when the project itself has nothing to say —
 * one per language Warsha can actually run, web's three included, ordered the
 * way a first course meets them. Every one of them is offered rather than a
 * shortlist: a cut-off that hides the ending a student wanted is the silence
 * this whole module exists to avoid. Kept in sync with `languages.ts` by hand —
 * a new engine is a new ending here.
 */
const READY_EXTENSIONS = ['java', 'py', 'js', 'html', 'css', 'cs', 'c'] as const

/**
 * Endings to offer for `name`, best first.
 *
 * Ranking, in order: the file being edited (a student naming `Helper` while
 * looking at `App.java` means `.java`), then what the project already speaks,
 * most-used first, then the rest of the runnable languages — so the list is
 * never empty, even in a project with no files yet. `unusable` drops the ones
 * that would land on a name the project already has, or one the naming rules
 * reject.
 */
export function extensionChoices(opts: {
  paths: readonly string[]
  /** The open file, and the file Run starts — the two best clues about what the student is writing. */
  preferred?: readonly (string | null | undefined)[]
  /** An ending that cannot be used here — the name it makes is taken, or the rules reject it. A dead option is worse than one fewer. */
  unusable?: (ext: string) => boolean
  limit?: number
}): string[] {
  const { paths, preferred = [], unusable, limit = READY_EXTENSIONS.length } = opts

  const used = new Map<string, number>()
  for (const p of paths) {
    if (!langForPath(p)) continue
    const ext = extOf(p)
    if (ext) used.set(ext, (used.get(ext) ?? 0) + 1)
  }
  const byUse = [...used.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ext]) => ext)

  const fromOpenFiles = preferred
    .filter((p): p is string => !!p && !!langForPath(p))
    .map((p) => extOf(p))
    .filter(Boolean)

  const ordered = [...fromOpenFiles, ...byUse, ...READY_EXTENSIONS]
  const out: string[] = []
  for (const ext of ordered) {
    if (out.includes(ext) || unusable?.(ext)) continue
    out.push(ext)
    if (out.length === limit) break
  }
  return out
}
