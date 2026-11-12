/**
 * An open notebook: its parsed model, its write-back to the project, and its
 * kernel session — one object per notebook path, kept outside React.
 *
 * Outside React because a running cell outlives the view: switching to another
 * tab unmounts the notebook view, and the cell's outputs must still land in the
 * model and reach the file. So the model lives here, the view subscribes to it,
 * and the session writes into it whether or not anyone is looking.
 *
 * Write-back is coalesced: a cell printing in a loop changes the model many
 * times a second, and each change would re-serialise every output (images
 * included). The text goes to the project at most every WRITE_MS, and at once
 * whenever something needs the file current (before a cell runs, on save).
 */
import type { FilesChange, NotebookKernel, SourceFile } from '../runtime/types'
import { NotebookSession, type SessionMessages } from './session'
import { parseNotebook, serializeNotebook, NotebookParseError, type NbCell, type Notebook } from './nbformat'

const WRITE_MS = 300

export interface DocumentIO {
  read(): string | undefined
  /** Store new text for the notebook file (project, or the live-collab doc). */
  write(text: string): void
  files(): SourceFile[]
  onFilesChanged(change: FilesChange): void
  onFailure(message: string, detail: string): void
  messages(): SessionMessages
}

export class NotebookDocument {
  private model: Notebook | null = null
  private error: string | null = null
  private lastText: string | null = null
  private timer = 0
  private listeners = new Set<() => void>()
  readonly session: NotebookSession
  private snapshot: { model: Notebook | null; error: string | null } = { model: null, error: null }

  constructor(
    public path: string,
    kernel: NotebookKernel,
    private io: DocumentIO,
  ) {
    this.load(io.read() ?? '')
    this.session = new NotebookSession(path, kernel, {
      files: () => {
        this.flush()
        return this.io.files()
      },
      cell: (id) => this.model?.cells.find((c) => c.id === id),
      update: (id, fn) => this.updateCell(id, fn),
      cellIds: () => this.model?.cells.map((c) => c.id) ?? [],
      onFilesChanged: (change) => this.io.onFilesChanged(change),
      onFailure: (m, d) => this.io.onFailure(m, d),
    }, () => this.io.messages())
  }

  /** The I/O can change under an open notebook (collab attached, a new project instance). */
  setIO(io: DocumentIO) {
    this.io = io
  }

  get = () => this.snapshot
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    this.snapshot = { model: this.model, error: this.error }
    for (const fn of [...this.listeners]) fn()
  }

  private load(text: string) {
    this.lastText = text
    try {
      this.model = parseNotebook(text)
      this.error = null
    } catch (e) {
      // An empty new file is an empty notebook, not a broken one.
      if (!text.trim()) {
        this.model = null
        this.error = null
      } else {
        this.error = e instanceof NotebookParseError ? e.message : String(e)
      }
    }
    this.emit()
  }

  /**
   * The file changed underneath us (undo in another view, a collaborator, a
   * program that rewrote it). Our own writes come back here too and are
   * recognised by their text, so a keystroke never re-parses the notebook.
   */
  syncFrom(text: string) {
    if (text === this.lastText) return
    if (this.timer) return // our pending write wins; it is newer than what the project holds
    this.load(text)
  }

  /** Replace the whole model (structural edits: insert, move, delete, convert). */
  replace(fn: (nb: Notebook) => Notebook) {
    if (!this.model) return
    this.model = fn(this.model)
    this.emit()
    this.schedule()
  }

  updateCell(id: string, fn: (cell: NbCell) => NbCell) {
    this.replace((nb) => {
      const i = nb.cells.findIndex((c) => c.id === id)
      if (i < 0) return nb
      const cells = nb.cells.slice()
      cells[i] = fn(cells[i])
      return { ...nb, cells }
    })
  }

  /** Adopt a model for a file that had no notebook in it yet (a brand-new .ipynb). */
  initialize(nb: Notebook) {
    this.model = nb
    this.error = null
    this.emit()
    this.flush(true)
  }

  private schedule() {
    if (this.timer) return
    this.timer = window.setTimeout(() => this.flush(), WRITE_MS)
  }

  /** Write the current model to the project now, if it changed. */
  flush(force = false) {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = 0
    } else if (!force) return
    if (!this.model) return
    const text = serializeNotebook(this.model)
    if (text === this.lastText) return
    this.lastText = text
    this.io.write(text)
  }

  private revealers = new Set<(cellId: string, line: number) => void>()
  private pendingReveal: { cellId: string; line: number } | null = null

  /** Bring a cell (and a line in it) into view: a debug stop, a breakpoint row, a traceback. */
  reveal(cellId: string, line: number) {
    if (!this.revealers.size) this.pendingReveal = { cellId, line }
    for (const fn of this.revealers) fn(cellId, line)
  }

  /** The view listens here; a reveal requested before it mounted is delivered on subscribe. */
  onReveal(fn: (cellId: string, line: number) => void) {
    this.revealers.add(fn)
    const p = this.pendingReveal
    this.pendingReveal = null
    if (p) queueMicrotask(() => fn(p.cellId, p.line))
    return () => {
      this.revealers.delete(fn)
    }
  }

  rename(path: string) {
    this.path = path
    this.session.rename(path)
  }

  dispose() {
    this.flush()
    this.session.dispose()
    this.listeners.clear()
  }
}

/* --------------------------------------------------------------- registry */

const open = new Map<string, NotebookDocument>()

const pendingReveals = new Map<string, { cellId: string; line: number }>()

/** The open document for `path`, created on first use (and re-pointed at fresh I/O after). */
export function notebookDocument(path: string, kernel: NotebookKernel, io: DocumentIO): NotebookDocument {
  let doc = open.get(path)
  if (!doc) {
    doc = new NotebookDocument(path, kernel, io)
    open.set(path, doc)
    const p = pendingReveals.get(path)
    pendingReveals.delete(path)
    if (p) doc.reveal(p.cellId, p.line)
  } else doc.setIO(io)
  return doc
}

/** Show a cell's line — now if the notebook is open, else as soon as its view opens it. */
export function revealCell(path: string, cellId: string, line: number) {
  const doc = open.get(path)
  if (doc) doc.reveal(cellId, line)
  else pendingReveals.set(path, { cellId, line })
}

export const openNotebook = (path: string): NotebookDocument | undefined => open.get(path)

/** Close every open notebook not in `keep` (tabs closed, project switched). */
export function closeNotebooksExcept(keep: ReadonlySet<string>) {
  for (const [path, doc] of open) {
    if (keep.has(path)) continue
    doc.dispose()
    open.delete(path)
  }
}

export function renameNotebook(from: string, to: string) {
  for (const [path, doc] of [...open]) {
    const next = path === from ? to : path.startsWith(from + '/') ? to + path.slice(from.length) : null
    if (next === null) continue
    open.delete(path)
    doc.rename(next)
    open.set(next, doc)
  }
}

/** Write every pending notebook edit (Save All, before a project-wide Run or export). */
export function flushNotebooks() {
  for (const doc of open.values()) doc.flush()
}
