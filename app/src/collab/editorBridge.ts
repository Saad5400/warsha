/**
 * The per-file editor binding (contract edge #1/#2). This is the object the
 * singleton CodeMirror controller (editor/setup.ts) consumes through the
 * `CollabBinding` type — setup.ts imports only the *type*, never `yjs` or
 * `y-codemirror.next`, so the editor stays decoupled from the collab stack and
 * the base app tree-shakes it away entirely when collaboration is off.
 *
 * Edge #1: yCollab lives in the file's own EditorState (built by `stateFor`),
 * so the binding follows file switches instead of being one stuck top-level
 * extension. Edge #2: `replaceDoc` (Format/Generate) writes a *minimal* Y.Text
 * splice rather than a whole-doc CM replace, so it merges instead of clobbering.
 */
import * as Y from 'yjs'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { keymap } from '@codemirror/view'
import type { Awareness } from 'y-protocols/awareness'
import type { Extension } from '@codemirror/state'
import { filesMap, replaceYText } from './doc'

/**
 * What editor/setup.ts needs from collaboration, and all it needs. Kept here so
 * setup.ts can `import type { CollabBinding }` with no runtime coupling.
 */
export interface CollabBinding {
  /** The yCollab extension for this file's state, or null if the path isn't a tracked doc. */
  extensionFor(path: string): Extension | null
  /** True when this path's `Y.Text` is the source of truth (suppress the editor's own onChange). */
  isCollab(path: string): boolean
  /** Apply a whole-document replacement (Format/Generate) as a minimal Y.Text edit. False if not collab. */
  replaceDoc(path: string, content: string): boolean
  /**
   * True when the local participant is a viewer (contract §7.4): the editor must
   * be read-only for every collab file — no local edits, so nothing reaches the
   * Y.Text (and thus no peer, no OPFS divergence). Remote edits still stream in.
   * A getter, not a constant: the role is learned from the server after connect,
   * and setup.ts rebuilds the open file's state when it flips.
   */
  readOnly(): boolean
  /**
   * True for a GENUINE GUEST (not a host, not an owner-rejoin) whose edits must go
   * through the file's Y.Text ONLY. Such a guest must not be allowed to type into a
   * file that has not yet bound to its Y.Text: those keystrokes would reach neither
   * the Y.Text (no yCollab extension yet) nor OPFS (onChange is suppressed once the
   * file is collab), living in a throwaway CM buffer that is overwritten at bind —
   * the data-loss window. setup.ts pairs this with "is this file bound yet?" to keep
   * the guest read-only until its Y.Text arrives; once bound it types straight in.
   * A host / owner-rejoin returns false: it may safely edit an unbound file (its
   * local edits are seeded/reconciled into the doc, never discarded).
   */
  guarded(): boolean
}

export function createEditorBinding(
  doc: Y.Doc,
  awareness: Awareness,
  /** Learns the local participant's read-only role — see `CollabBinding.readOnly`. */
  isReadOnly: () => boolean = () => false,
  /** Learns whether the local participant is a guarded guest — see `CollabBinding.guarded`. */
  isGuarded: () => boolean = () => false,
): CollabBinding {
  const files = filesMap(doc)
  // One UndoManager per file, tracking only local (sync-plugin) edits — so undo
  // never reaches across into a peer's typing.
  const undoManagers = new Map<string, Y.UndoManager>()

  // Prune on delete/rename: a removed key's UndoManager tracks a dead Y.Text (a
  // rename is delete+add of a FRESH Y.Text per contract §1), so it must be
  // destroyed and dropped or undo on the new file replays into the old one.
  // No unobserve needed — the observer dies with the doc on session destroy.
  files.observe((event) => {
    for (const [key, change] of event.changes.keys) {
      if (change.action === 'add') continue
      const um = undoManagers.get(key)
      if (um) {
        um.destroy()
        undoManagers.delete(key)
      }
    }
  })

  const undoManagerFor = (ytext: Y.Text, path: string): Y.UndoManager => {
    let um = undoManagers.get(path)
    if (!um) {
      um = new Y.UndoManager(ytext, { captureTimeout: 300 })
      undoManagers.set(path, um)
    }
    return um
  }

  return {
    readOnly: isReadOnly,
    guarded: isGuarded,
    isCollab(path) {
      return files.has(path)
    },
    extensionFor(path) {
      const ytext = files.get(path)
      if (!ytext) return null
      const undoManager = undoManagerFor(ytext, path)
      // yCollab bundles the undo *plugin* but not its keymap — add it here, and
      // setup.ts drops native history()/historyKeymap for collab states so
      // Mod-Z routes to the CRDT undo manager instead of the local one.
      return [yCollab(ytext, awareness, { undoManager }), keymap.of(yUndoManagerKeymap)]
    },
    replaceDoc(path, content) {
      const ytext = files.get(path)
      if (!ytext) return false
      // A viewer never writes: swallow the edit (return handled) so the caller
      // does not fall back to a direct CodeMirror replace either.
      if (isReadOnly()) return true
      replaceYText(ytext, content)
      return true
    },
  }
}
