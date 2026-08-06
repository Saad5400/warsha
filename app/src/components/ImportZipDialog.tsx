import { useId, useRef, useState } from 'react'
import { COPY } from '../copy'
import type { FsSnapshot } from '../fs/types'
import { importZip, ZipImportError, type ZipImportResult } from '../zip'
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

const DROPZONE =
  'mt-4 flex flex-col items-center gap-2 px-4 py-5 border border-dashed border-border-control rounded-md ' +
  'bg-surface-2 text-text-3 text-center transition-[background-color,border-color] ' +
  'duration-(--dur-fast) ease-standard data-[over=true]:border-accent data-[over=true]:border-solid ' +
  'data-[over=true]:bg-surface-4 data-[over=true]:text-text-2'

/**
 * One dialog for the whole import: pick, preview, confirm. The warning shows before
 * picking rather than as a second modal after — stacked modals get clicked through unread.
 */
export function ImportZipDialog({ currentFileCount, onCancel, onImport }: ImportZipDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<{ name: string; result: ZipImportResult } | null>(null)
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
    // Yield a frame first: unzipSync blocks the main thread, so "Reading…" would never paint otherwise.
    await new Promise((r) => requestAnimationFrame(r))
    try {
      const result = await importZip(file)
      if (result.snapshot.files.length === 0) setProblem(COPY.importEmptyZip)
      else setPicked({ name: file.name, result })
    } catch (e) {
      // Our own refusals already read as sentences; anything else needs the wrapper.
      setProblem(e instanceof ZipImportError ? e.message : COPY.importUnreadable((e as Error).message))
    } finally {
      setReading(false)
    }
  }

  return (
    // Dismissible only until a file is staged — a stray tap shouldn't discard a read zip.
    <Modal onCancel={onCancel} dismissible={!picked} labelledBy={titleId}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (picked) onImport(picked.result.snapshot, picked.name)
        }}
      >
        <h2 id={titleId} className="dlg-title">
          Import a .zip
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
            const file = e.dataTransfer.files?.[0]
            if (file) void take(file)
          }}
          // The only dashed border in the app — "put something here" is exactly what's meant here.
          className={DROPZONE}
        >
          <IconFiles size={24} />
          {/* Drag-and-drop is a laptop affordance; the button is what matters on a phone. */}
          <p className="text-meta text-text-3">{COPY.importDropHint}</p>
          <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={reading}>
            {reading ? COPY.importReading : COPY.importChooseZip}
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
