import { useId, useRef, useState } from 'react'
import { COPY, count } from '../copy'
import type { FsSnapshot } from '../fs/types'
import { importZip } from '../zip'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'
import { IconFiles } from './ui/Icons'

export interface ImportZipDialogProps {
  /** How many files the import would replace. */
  currentFileCount: number
  onCancel(): void
  onImport(snapshot: FsSnapshot, fileName: string): void
}

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip'

/**
 * One dialog for the whole import: choose or drop the .zip, see what is in it,
 * see what it costs, confirm. The warning is stated *before* the file is picked
 * rather than in a second confirm afterwards — two stacked modals for one
 * decision is how a student ends up clicking through both without reading
 * either.
 */
export function ImportZipDialog({ currentFileCount, onCancel, onImport }: ImportZipDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ name: string; snapshot: FsSnapshot } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [over, setOver] = useState(false)
  const titleId = useId()
  const replaces = currentFileCount > 0

  const take = async (file: File) => {
    setPicked(null)
    setProblem(null)
    if (!isZip(file)) return setProblem(COPY.importNotZip)
    setReading(true)
    try {
      const snapshot = await importZip(file)
      if (snapshot.files.length === 0) setProblem(COPY.importEmptyZip)
      else setPicked({ name: file.name, snapshot })
    } catch (e) {
      setProblem(COPY.importUnreadable((e as Error).message))
    } finally {
      setReading(false)
    }
  }

  return (
    // Dismissible until a .zip is staged: closing the picker costs nothing, but
    // once a file is read, a stray tap outside should not throw it away.
    <Modal onCancel={onCancel} dismissible={!picked} labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (picked) onImport(picked.snapshot, picked.name)
        }}
      >
        <h2 id={titleId} className="dlg-title">
          Import a .zip
        </h2>
        <p className="dlg-msg">{COPY.importIntro}</p>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void take(file)
          }}
          className={
            'mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center ' +
            // duration-(--dur-fast), not duration-[--dur-fast]: Tailwind v4 reads
            // the bare-variable form as an arbitrary value, emits an invalid
            // declaration, and the browser drops it.
            'transition-colors duration-(--dur-fast) ' +
            (over ? 'border-accent bg-surface-4' : 'border-border-control bg-surface-2')
          }
        >
          <IconFiles size={24} className={over ? 'text-accent' : 'text-text-3'} />
          {/* Drag-and-drop is a laptop affordance; the button is the one that
              matters on a phone, so it is never the small print. */}
          <p className="text-meta text-text-3">{COPY.importDropHint}</p>
          <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={reading}>
            {reading ? 'Reading…' : 'Choose a .zip'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void take(file)
            }}
          />
        </div>

        {picked ? (
          <p className="mt-3 flex items-baseline gap-2 text-meta leading-normal text-text-1">
            <span aria-hidden="true" className="text-success">
              ✓
            </span>
            <span>
              <span className="font-code">{picked.name}</span> — {count(picked.snapshot.files.length, 'file')} ready to
              import.
            </span>
          </p>
        ) : null}

        {problem ? (
          <p role="alert" className="mt-3 flex gap-2 text-meta leading-normal text-danger">
            <span aria-hidden="true">✕</span>
            {problem}
          </p>
        ) : null}

        <div className={'mt-4 note ' + (replaces ? 'note--warn' : '')}>
          <p className="note__text">{replaces ? COPY.importReplaces(currentFileCount) : COPY.importNothingToReplace}</p>
        </div>

        <div className="dlg-actions">
          <Button variant="ghost" large onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={replaces ? 'danger' : 'primary'} large type="submit" disabled={!picked}>
            {replaces ? 'Replace files' : 'Import'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
