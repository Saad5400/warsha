import { useEffect, useRef } from 'react'
import { createEditor, type EditorController } from '../editor/setup'
import { COPY } from '../copy'

export interface EditorProps {
  path: string | null
  content: string
  fontSize: number
  onChange(path: string, content: string): void
  onSave(): void
  /** Lets the shell drive the controller (rename, close) without re-mounting. */
  onController(controller: EditorController | null): void
}

/**
 * A mount/unmount shell around CodeMirror. All the editor logic lives in
 * editor/setup.ts; React only decides which file is showing.
 */
export function Editor({ path, content, fontSize, onChange, onSave, onController }: EditorProps) {
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

  return (
    <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-1">
      <div ref={hostRef} className="h-full" data-empty={path ? undefined : 'true'} />
      {path ? null : (
        <div className="absolute inset-0 grid place-items-center bg-surface-1 p-5 text-center">
          <div>
            <p className="text-btn text-text-2">No file open</p>
            <p className="mt-1 text-meta text-text-3">{COPY.editorEmpty}</p>
          </div>
        </div>
      )}
    </div>
  )
}
