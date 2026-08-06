import { useEffect, useRef } from 'react'
import { splitPath } from '../fs/project'
import { createEditor, type EditorController } from '../editor/setup'
import { Button } from './ui/Button'
import { IconFileLines } from './ui/Icons'
import { COPY } from '../copy'

// Spec §4.3: pane never shrinks past 96px; the editor scrolls under the console instead.
// `editor-pane` (and `empty--pane`/`empty__title` below) are QA contract selectors
// (ARCHITECTURE §4) with no styling of their own — don't rename them.
const EDITOR_PANE = 'editor-pane relative flex-1 min-w-0 min-h-editor-min overflow-hidden bg-surface-1'

// "No file open" sits at ~28% down, not dead centre — centre is where the software
// keyboard lands (spec §7.5). The 32ch cap lives on the text lines, not this layer,
// so CodeMirror's gutter and active-line band show through on both sides.
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
  /** Identifiers from the whole project, for completion. Recompute only on project change — read every keystroke. */
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
  // Refs, not deps: CodeMirror's view must not rebuild when a prop identity changes.
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

  // Lets a student tell this tab apart from their course notes in another one.
  useEffect(() => {
    document.title = path ? `${splitPath(path).name} — Warsha` : 'Warsha'
  }, [path])

  return (
    <div className={EDITOR_PANE}>
      <div ref={hostRef} className="h-full" data-empty={path ? undefined : 'true'} />
      {path ? null : (
        // Load-bearing, not decoration: without it a tap on the empty pane would reach the editor underneath.
        <div className="absolute inset-0 bg-surface-1">
          <div className={EMPTY_PANE}>
            <IconFileLines size={32} className="text-[32px] leading-none text-text-3" />
            <p className="empty__title max-w-[32ch] text-btn leading-[1.3] font-semibold text-text-2">{COPY.editorNoFile}</p>
            <p className="max-w-[32ch] text-row leading-[1.55] text-text-3">{COPY.editorEmpty}</p>
            {onBrowseFiles ? (
              <Button variant="ghost" onClick={onBrowseFiles}>
                {COPY.editorBrowseFiles}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
