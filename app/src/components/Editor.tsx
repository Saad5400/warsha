import { useEffect, useRef } from 'react'
import { splitPath } from '../fs/project'
import { createEditor, type EditorController } from '../editor/setup'
import { Button } from './ui/Button'
import { IconFileLines } from './ui/Icons'
import { COPY } from '../copy'

/* Spec §4.3 rule 5: the pane does not shrink past 96px — the editor scrolls
 * under the console instead.
 *
 * The leading `editor-pane` carries no styling. Several class names in this app
 * are contract selectors that tools/qa reads (ARCHITECTURE §4) — they stayed
 * behind when their rules moved into utilities, and renaming one breaks a suite
 * rather than a pixel. The same goes for `empty--pane` and `empty__title`. */
const EDITOR_PANE = 'editor-pane relative flex-1 min-w-0 min-h-editor-min overflow-hidden bg-surface-1'

/* The "no file open" state, at ~28% of the pane rather than dead centre —
 * dead centre is where the software keyboard goes (spec §7.5). The measure
 * lives on the two text lines, never on this layer: capping the layer itself
 * at 32ch makes an inset-0 backdrop paint only a narrow centred column, and
 * CodeMirror's gutter and active-line band show through on both sides.
 * `empty--pane` carries no styling — tools/qa selects it. */
const EMPTY_PANE =
  'empty--pane absolute inset-0 flex flex-col items-center justify-start gap-3 mx-auto ' +
  'px-4 pb-0 pt-[max(var(--sp-5),28%)] text-center bg-surface-1'

export interface EditorProps {
  path: string | null
  content: string
  fontSize: number
  onChange(path: string, content: string): void
  onSave(): void
  /** Lets the shell drive the controller (rename, close) without re-mounting. */
  onController(controller: EditorController | null): void
  /** The one action on the "no file open" empty state (spec §7.5). */
  onBrowseFiles?: () => void
  /**
   * Identifiers from every file in the project, so completion reaches past the
   * file being edited. Recompute it only when the project changes — it is read
   * on every keystroke that opens the popup.
   */
  projectWords?: readonly string[]
  /** Caret position for the status bar, 1-based. Fires only when it moves. */
  onCursor?(line: number, col: number): void
}

/**
 * A mount/unmount shell around CodeMirror. All the editor logic lives in
 * editor/setup.ts; React only decides which file is showing.
 */
export function Editor({
  path,
  content,
  fontSize,
  onChange,
  onSave,
  onController,
  onBrowseFiles,
  projectWords,
  onCursor,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<EditorController | null>(null)
  // Read handlers through refs: CodeMirror keeps its own long-lived callbacks,
  // so the view must not be rebuilt when a prop identity changes.
  const handlers = useRef({ onChange, onSave, projectWords, onCursor })
  handlers.current = { onChange, onSave, projectWords, onCursor }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const controller = createEditor(host, {
      fontSize,
      onChange: (p, c) => handlers.current.onChange(p, c),
      onSave: () => handlers.current.onSave(),
      projectWords: () => handlers.current.projectWords ?? [],
      onCursor: (line, col) => handlers.current.onCursor?.(line, col),
    })
    controllerRef.current = controller
    onController(controller)
    return () => {
      onController(null)
      controllerRef.current = null
      controller.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  useEffect(() => {
    if (path) controllerRef.current?.open(path, content)
  }, [path, content])

  useEffect(() => {
    controllerRef.current?.setFontSize(fontSize)
  }, [fontSize])

  // A student with Warsha and their course notes in two tabs needs to be able to
  // tell them apart, and the filename is what does that.
  useEffect(() => {
    document.title = path ? `${splitPath(path).name} — Warsha` : 'Warsha'
  }, [path])

  return (
    <div className={EDITOR_PANE}>
      <div ref={hostRef} className="h-full" data-empty={path ? undefined : 'true'} />
      {path ? null : (
        // The backdrop is load-bearing, not decoration: `.empty--pane` is capped
        // at 32ch, so as an inset-0 layer it only paints a narrow centred column
        // and CodeMirror's gutter, line 1 and active-line band show through on
        // either side of it. This is what actually covers the canvas, and it also
        // stops a tap on the void reaching an editor with no file in it.
        <div className="absolute inset-0 bg-surface-1">
          {/* Sits at ~28% of the pane rather than dead centre: dead centre is
              where the software keyboard goes (spec §7.5). */}
          <div className={EMPTY_PANE}>
            <IconFileLines size={32} className="text-[32px] leading-none text-text-3" />
            <p className="empty__title max-w-[32ch] text-btn leading-[1.3] font-semibold text-text-2">No file open</p>
            <p className="max-w-[32ch] text-row leading-[1.55] text-text-3">{COPY.editorEmpty}</p>
            {onBrowseFiles ? (
              <Button variant="ghost" onClick={onBrowseFiles}>
                Browse files
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
