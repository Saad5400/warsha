import { useEffect, useRef } from 'react'
import { splitPath } from '../fs/project'
import { createEditor, type EditorController } from '../editor/setup'
import { Button } from './ui/Button'
import { IconFileLines } from './ui/Icons'
import { COPY } from '../copy'

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
}

/**
 * A mount/unmount shell around CodeMirror. All the editor logic lives in
 * editor/setup.ts; React only decides which file is showing.
 */
export function Editor({ path, content, fontSize, onChange, onSave, onController, onBrowseFiles }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<EditorController | null>(null)
  // Read handlers through refs: CodeMirror keeps its own long-lived callbacks,
  // so the view must not be rebuilt when a prop identity changes.
  const handlers = useRef({ onChange, onSave })
  handlers.current = { onChange, onSave }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const controller = createEditor(host, {
      fontSize,
      onChange: (p, c) => handlers.current.onChange(p, c),
      onSave: () => handlers.current.onSave(),
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
    <div className="editor-pane">
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
          <div className="empty empty--pane">
            <IconFileLines size={32} className="empty__glyph" />
            <p className="empty__title">No file open</p>
            <p className="empty__body">{COPY.editorEmpty}</p>
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
