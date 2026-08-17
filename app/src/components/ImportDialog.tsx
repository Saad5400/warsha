import { useId, useRef, useState } from 'react'
import { COPY } from '../copy'
import type { FsSnapshot } from '../fs/types'
import {
  pickedFromDataTransfer,
  pickedFromFileList,
  readImport,
  ZipImportError,
  type PickedFile,
  type ZipImportResult,
} from '../zip'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'
import { IconImport } from './ui/Icons'

export interface ImportDialogProps {
  /** How many files the import would replace (only meaningful when `mode` is 'replace'). */
  currentFileCount: number
  /** 'replace' overwrites the open project (File ▸ Import); 'new' starts a fresh one
   *  (New Project ▸ Import). Only the copy and the replace warning differ; App owns the outcome. */
  mode: 'replace' | 'new'
  onCancel(): void
  onImport(snapshot: FsSnapshot, name: string): void
}

const DROPZONE =
  'mt-4 flex flex-col items-center gap-2 px-4 py-5 border border-dashed border-border-control rounded-md ' +
  'bg-surface-2 text-text-3 text-center transition-[background-color,border-color] ' +
  'duration-(--dur-fast) ease-standard data-[over=true]:border-accent data-[over=true]:border-solid ' +
  'data-[over=true]:bg-surface-4 data-[over=true]:text-text-2'

/** A display name for the picked set: the .zip / lone file's name, else the folder it came from,
 *  else a generic label. Doubles as the suggested project name when importing into a new project. */
function nameFor(picked: PickedFile[]): string {
  if (picked.length === 1) {
    const only = picked[0]
    // A dropped/chosen folder with one file keeps the folder as the title, not the file.
    const top = only.path.includes('/') ? only.path.split('/')[0] : null
    return top ?? only.file.name
  }
  const tops = new Set(picked.map((p) => (p.path.includes('/') ? p.path.split('/')[0] : null)))
  if (tops.size === 1) {
    const [only] = tops
    if (only) return only
  }
  return COPY.importDefaultName
}

/**
 * One dialog for the whole import: pick, preview, confirm. It takes loose files, a whole folder,
 * or a .zip a teacher exported — the same set, whether chosen through the OS picker (the phone path)
 * or dropped on (the laptop path). A single .zip is unpacked; everything else lands verbatim. The
 * replace warning shows before picking rather than as a second modal after — stacked modals get
 * clicked through unread.
 */
export function ImportDialog({ currentFileCount, mode, onCancel, onImport }: ImportDialogProps) {
  const filesRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ name: string; result: ZipImportResult } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)
  const titleId = useId()
  const replaces = mode === 'replace' && currentFileCount > 0

  const take = async (incoming: PickedFile[]) => {
    setPicked(null)
    setProblem(null)
    if (incoming.length === 0) return
    setReading(true)
    // Yield a frame first: reading/unzip blocks the main thread, so "Reading…" would never paint otherwise.
    await new Promise((r) => requestAnimationFrame(r))
    try {
      const result = await readImport(incoming)
      if (result.snapshot.files.length === 0) setProblem(COPY.importEmpty)
      else setPicked({ name: nameFor(incoming), result })
    } catch (e) {
      // Our own refusals already read as sentences; anything else needs the wrapper.
      setProblem(e instanceof ZipImportError ? e.message : COPY.importUnreadable((e as Error).message))
    } finally {
      setReading(false)
    }
  }

  return (
    // Dismissible only until a file is staged — a stray tap shouldn't discard read files.
    <Modal onCancel={onCancel} dismissible={!picked} labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (picked) onImport(picked.result.snapshot, picked.name)
        }}
      >
        <h2 id={titleId} className="dlg-title">
          {COPY.importTitle}
        </h2>
        <p className="dlg-msg">{COPY.importIntro}</p>

        <div
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            if (e.dataTransfer) void pickedFromDataTransfer(e.dataTransfer).then(take)
          }}
          // The only dashed border in the app — "put something here" is exactly what's meant here.
          className={DROPZONE}
        >
          <IconImport size={24} />
          {/* Drag-and-drop is a laptop affordance; the buttons are what matter on a phone. */}
          <p className="text-meta text-text-3">{COPY.importDropHint}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="ghost" onClick={() => filesRef.current?.click()} disabled={reading}>
              {reading ? COPY.importReading : COPY.importChooseFiles}
            </Button>
            {/* Folder pick is a desktop nicety (webkitdirectory); harmless where it isn't offered. */}
            <Button variant="ghost" onClick={() => folderRef.current?.click()} disabled={reading}>
              {COPY.importChooseFolder}
            </Button>
          </div>
          <input
            ref={filesRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picks = pickedFromFileList(e.target.files)
              e.target.value = ''
              void take(picks)
            }}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            hidden
            // Non-standard but supported on the desktop browsers Warsha targets; typed via any.
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => {
              const picks = pickedFromFileList(e.target.files)
              e.target.value = ''
              void take(picks)
            }}
          />
        </div>

        {picked ? (
          <p className="mt-3 flex items-baseline gap-2 text-meta leading-normal text-text-1">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            <span>
              <span className="font-code">{picked.name}</span> — {COPY.importPicked(picked.result.snapshot.files.length)}
              {/* Named, not silent: a missing required file is worse when nothing says so. */}
              {picked.result.skipped.length > 0 ? (
                <>
                  {' '}
                  <span className="text-text-3">{COPY.importSkipped(picked.result.skipped.length)}</span>
                </>
              ) : null}
            </span>
          </p>
        ) : null}

        {problem ? (
          <p role="alert" className="mt-3 flex gap-2 text-meta leading-normal text-danger">
            <span aria-hidden="true">✕</span>
            {problem}
          </p>
        ) : null}

        {replaces ? (
          <div className="mt-4 note border-s-warn">
            <p className="note__text">{COPY.importReplaces(currentFileCount)}</p>
          </div>
        ) : null}

        <div className="dlg-actions">
          <Button variant="ghost" large onClick={onCancel}>
            {COPY.dlgCancel}
          </Button>
          <Button variant={replaces ? 'danger' : 'primary'} large type="submit" disabled={!picked}>
            {replaces ? COPY.importReplaceFiles : COPY.importAction}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
