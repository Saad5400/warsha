/**
 * The project's source files, as the editor's text-reading features see them —
 * hover docs (user doc comments) and the type index (the student's own classes).
 *
 * App.tsx registers the accessor once per project revision; a module-level seam
 * beats threading a prop through the editor's singleton mount. `revision` is the
 * project's change counter, so each consumer's cached scan re-runs at most once
 * per edit burst.
 */

export interface ProjectFileText {
  path: string
  content: string
}

let fileSource: (() => readonly ProjectFileText[]) | null = null
let sourceRevision = -1

export function setProjectSource(get: () => readonly ProjectFileText[], revision: number): void {
  fileSource = get
  sourceRevision = revision
}

export const projectFiles = (): readonly ProjectFileText[] => fileSource?.() ?? []

/** -1 until App has registered a source. */
export const projectRevision = (): number => sourceRevision
