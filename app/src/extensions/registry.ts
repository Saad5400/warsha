/**
 * The extension registry — Warsha's "installed extensions", VS Code style.
 *
 * Each editor feature is already a self-contained factory returning a
 * CodeMirror `Extension` (see editor/*.ts); this file turns that list into data
 * a student can toggle. Two kinds live here:
 *
 *   - `editor`   — contributes CodeMirror extensions, swapped live through a
 *                  Compartment (see editor/setup.ts `extConf`).
 *   - `behavior` — a plain on/off flag the shell reads elsewhere; Format on
 *                  Save is one, consulted by App's save path, not the editor.
 *
 * Enabled state is a per-device preference (fs/prefs.ts `extensions`): the
 * stored map holds only explicit choices, so a descriptor's `default` is the
 * answer until the student flips it. Human names/descriptions are NOT here —
 * they live in i18n (copy.ts), keyed by id, so this stays logic-only.
 */
import type { Extension } from '@codemirror/state'
import { rainbowBrackets } from '../editor/rainbowBrackets'
import { indentGuides } from '../editor/indentGuides'
import { indentRainbow } from '../editor/indentRainbow'
import { prefs, setPrefs } from '../fs/prefs'

export type ExtId = 'rainbow-brackets' | 'indent-guides' | 'indent-rainbow' | 'format-on-save'

export type ExtCategory = 'appearance' | 'formatting'

interface BaseExt {
  id: ExtId
  category: ExtCategory
  /** Whether it is on before the student has ever touched it. */
  default: boolean
}

/** Contributes CodeMirror extensions, reconfigured live when toggled. */
interface EditorExt extends BaseExt {
  kind: 'editor'
  build(): Extension
}

/** A flag the shell reads directly (e.g. the save path); no editor wiring. */
interface BehaviorExt extends BaseExt {
  kind: 'behavior'
}

export type ExtDescriptor = EditorExt | BehaviorExt

/** Registration order is display order in the Extensions view, and for the
 *  editor kind it is also precedence order inside `extConf`. Rainbow Brackets
 *  is last so its depth marks sit over the indent tints on shared spans. */
export const EXTENSIONS: readonly ExtDescriptor[] = [
  { id: 'indent-guides', category: 'appearance', kind: 'editor', default: true, build: () => indentGuides(4) },
  { id: 'indent-rainbow', category: 'appearance', kind: 'editor', default: false, build: () => indentRainbow(4) },
  { id: 'rainbow-brackets', category: 'appearance', kind: 'editor', default: true, build: () => rainbowBrackets() },
  { id: 'format-on-save', category: 'formatting', kind: 'behavior', default: true },
]

const byId = new Map(EXTENSIONS.map((e) => [e.id, e]))

/** True when extension `id` is on — the stored choice, or its default. */
export function isExtEnabled(id: ExtId): boolean {
  return prefs().extensions[id] ?? byId.get(id)?.default ?? false
}

/** Persist a toggle. Only explicit choices are stored, so a later default
 *  change still reaches anyone who never flipped that switch. */
export function setExtEnabled(id: ExtId, on: boolean): void {
  setPrefs({ extensions: { ...prefs().extensions, [id]: on } })
}

/** The CodeMirror extensions for every enabled `editor`-kind entry, in
 *  registration order — the content of `extConf` in editor/setup.ts. */
export function enabledEditorExtensions(): Extension[] {
  return EXTENSIONS.filter((e) => e.kind === 'editor' && isExtEnabled(e.id)).map((e) => (e as EditorExt).build())
}
