/**
 * An open notebook: its parsed model, its write-back to the project, and its
 * kernel session — one object per (project, notebook path), kept outside React.
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
 *
 * Every document belongs to the project it was loaded from (its `owner`), and only ever writes
 * there. Two projects routinely hold a file of the same name — every notebook starter saves as
 * `notebook.ipynb` — and the shell's one Project object reads and writes whichever project is
 * attached, so a document keyed by path alone would carry one project's cells into the next
 * and save them over its file.
 */
import type { FilesChange, NotebookKernel, SourceFile } from '../runtime/types'
import { NotebookSession, type SessionMessages } from './session'
import { createNotebook, mergeNotebooks, parseNotebook, serializeNotebook, NotebookParseError, type NbCell, type Notebook } from './nbformat'

const WRITE_MS = 300

/**
 * How a document reaches its file. Path-taking, never path-capturing: a rename moves an
 * open notebook to a new path while a write may be pending, and that write belongs at the
 * NEW path.
 */
export interface DocumentIO {
  read(path: string): string | undefined
  /** Store new text for the notebook (project, or the live-collab doc). Writes nothing when the
   *  file no longer exists — a notebook deleted while open is not brought back. */
  write(path: string, text: string): void
  files(): SourceFile[]
  /** Which project this I/O reads and writes right now — the attached project's id — or null
   *  while a switch is between projects (nothing may open or write then). A document is
   *  scoped to the owner it was loaded under; it is also the kernel's workspace. */
  owner(): string | null
  onFilesChanged(change: FilesChange): void
  onFailure(message: string, detail: string): void
  messages(): SessionMessages
}

/** Registry key: a notebook is one project's file, never just a path. */
const keyOf = (owner: string, path: string) => `${owner}\u0000${path}`

export class NotebookDocument {
  /** The project this document was loaded from — the only one it may ever write to. */
  readonly owner: string
  private model: Notebook | null = null
  private error: string | null = null
  /** The text this document and its file last agreed on — the base of a merge. */
  private lastText: string | null = null
  private timer = 0
  private disposed = false
  private listeners = new Set<() => void>()
  readonly session: NotebookSession
  private snapshot: { model: Notebook | null; error: string | null } = { model: null, error: null }
  /** A live-collab viewer: nothing it does may change the file, and nothing may run. */
  readOnly = false

  constructor(
    public path: string,
    kernel: NotebookKernel,
    private io: DocumentIO,
  ) {
    const owner = io.owner()
    if (owner === null) throw new Error('A notebook cannot open while the project is switching')
    this.owner = owner
    this.load(io.read(path) ?? '')
    this.session = new NotebookSession(
      path,
      kernel,
      {
        files: () => {
          this.flush()
          return this.io.files()
        },
        workspace: () => this.owner,
        cell: (id) => this.model?.cells.find((c) => c.id === id),
        update: (id, fn) => this.updateCell(id, fn),
        cellIds: () => this.model?.cells.map((c) => c.id) ?? [],
        onFilesChanged: (change) => {
          if (this.attached('program file changes')) this.io.onFilesChanged(change)
        },
        onFailure: (m, d) => this.io.onFailure(m, d),
      },
      () => this.io.messages(),
    )
  }

  /** The I/O can change under an open notebook (collab attached, a new project instance). */
  setIO(io: DocumentIO) {
    this.io = io
  }

  /**
   * The last line of defence against cross-project writes: the I/O must still be attached to
   * the project this document was loaded from. A document from project A must never reach
   * project B's `notebook.ipynb`, whatever path led here — refused and logged, never written.
   */
  private attached(what: string): boolean {
    const now = this.io.owner()
    if (now === this.owner) return true
    console.error(`[warsha] refused a cross-project notebook write (${what}): ${this.path} belongs to project ${this.owner}, the attached project is ${now ?? '(switching)'}`)
    return false
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
    if (!text.trim()) {
      // An empty file is an empty notebook — in memory only. It is written when the student
      // changes something, never on open: an empty text can be transient (a guest whose copy has
      // not synced, a restored tab before storage answered) and must not overwrite real content.
      this.model = createNotebook()
      this.error = null
    } else {
      try {
        this.model = parseNotebook(text)
        this.error = null
      } catch (e) {
        this.model = null
        this.error = e instanceof NotebookParseError ? e.message : String(e)
      }
    }
    this.emit()
  }

  /**
   * The file changed underneath us (a collaborator, undo in another view, a program that
   * rewrote it). Our own writes come back here too and are recognised by their text.
   *
   * With local edits not yet written (a streaming cell keeps one pending almost always),
   * the two are MERGED cell by cell against the last agreed text — taking the remote text
   * and dropping ours, or the reverse, loses somebody's edit (mergeNotebooks).
   */
  syncFrom(text: string) {
    if (this.disposed || text === this.lastText) return
    if (!this.timer || !this.model) return this.load(text)
    let base: Notebook
    let remote: Notebook
    try {
      base = this.lastText?.trim() ? parseNotebook(this.lastText) : createNotebook([])
      remote = parseNotebook(text)
    } catch {
      return // an unreadable remote state: our pending write replaces it
    }
    this.model = mergeNotebooks(base, this.model, remote)
    this.lastText = text
    this.emit()
  }

  /** Replace the whole model (structural edits: insert, move, delete, convert). */
  replace(fn: (nb: Notebook) => Notebook) {
    if (!this.model || this.disposed || this.readOnly) return
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

  private schedule() {
    if (this.timer) return
    this.timer = window.setTimeout(() => this.flush(), WRITE_MS)
  }

  /** Write pending edits to the file now. */
  flush() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = 0
    if (!this.model || this.disposed) return
    const text = serializeNotebook(this.model)
    if (text === this.lastText) return
    if (!this.attached('save')) return
    this.lastText = text
    this.io.write(this.path, text)
  }

  /** The cell the view has selected — what the shell's Debug starts from. */
  selected: string | null = null

  /** Code cells from `from` (index) to `to`, in order — what Run all, Run below and Debug pick from. */
  codeIds(from = 0, to?: number): string[] {
    return (this.model?.cells ?? []).slice(from, to).filter((c) => c.type === 'code').map((c) => c.id)
  }

  /** Run every code cell, top to bottom — the notebook's Run all, and the shell's Run. */
  runAll() {
    if (this.readOnly) return
    this.session.run(this.codeIds())
  }

  /** Debug the selected code cell, else the first one — the shell's Debug (F5, Run and Debug). */
  debugCurrent() {
    if (this.readOnly) return
    const cells = this.model?.cells ?? []
    const sel = cells.find((c) => c.id === this.selected && c.type === 'code')
    const id = sel?.id ?? this.codeIds()[0]
    if (id) this.session.run([id], { debug: true })
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

  /** Closed: pending edits go to the file (if `write`), and from then on nothing the session or
   *  a late callback does reaches the model or the file. A project switch closes with
   *  write=false, after flushing while the old project was still attached. */
  dispose(write = true) {
    if (this.disposed) return
    if (write) this.flush()
    clearTimeout(this.timer)
    this.timer = 0
    this.disposed = true
    this.session.dispose()
    this.listeners.clear()
  }

  get closed(): boolean {
    return this.disposed
  }

  /** Edits not yet written to the file. */
  get pending(): boolean {
    return !!this.timer
  }
}

/* --------------------------------------------------------------- registry */

/** Open documents by (owner, path). Only the attached project's are ever looked up; any other
 *  project's left here (a switch that bypassed closeNotebooksForSwitch) is closed on sight. */
const open = new Map<string, NotebookDocument>()

const pendingReveals = new Map<string, { cellId: string; line: number }>()

/** Close every document that is not the attached project's. They cannot write (attached()
 *  refuses), so whatever they still held would be lost silently — say so. */
function closeOtherProjects(owner: string) {
  for (const [key, doc] of open) {
    if (doc.owner === owner) continue
    if (doc.pending) console.error(`[warsha] closed ${doc.path} of project ${doc.owner} with unsaved edits after the project switched to ${owner}`)
    doc.dispose(false)
    open.delete(key)
  }
}

/**
 * The attached project's document for `path`, created on first use (and re-pointed at fresh
 * I/O after). Null while the project is switching: the files in memory then are the project
 * being left, and a document loaded from them would show (and later save) that project's
 * notebook under the next one's name.
 */
export function notebookDocument(path: string, kernel: NotebookKernel, io: DocumentIO): NotebookDocument | null {
  const owner = io.owner()
  if (owner === null) return null
  closeOtherProjects(owner)
  const key = keyOf(owner, path)
  let doc = open.get(key)
  if (!doc) {
    doc = new NotebookDocument(path, kernel, io)
    open.set(key, doc)
    const p = pendingReveals.get(key)
    pendingReveals.delete(key)
    if (p) doc.reveal(p.cellId, p.line)
  } else doc.setIO(io)
  return doc
}

/** Show a cell's line — now if the notebook is open, else as soon as its view opens it. */
export function revealCell(owner: string | null, path: string, cellId: string, line: number) {
  if (owner === null) return
  const key = keyOf(owner, path)
  const doc = open.get(key)
  if (doc) doc.reveal(cellId, line)
  else pendingReveals.set(key, { cellId, line })
}

export const openNotebook = (owner: string | null, path: string): NotebookDocument | undefined =>
  owner === null ? undefined : open.get(keyOf(owner, path))

/** Close every open notebook not in `keep` (their tabs closed, or shown as text) — and every
 *  notebook of a project other than `owner`. */
export function closeNotebooksExcept(owner: string | null, keep: ReadonlySet<string>) {
  for (const [key, doc] of open) {
    if (doc.owner === owner && keep.has(doc.path)) continue
    doc.dispose(doc.owner === owner)
    open.delete(key)
  }
}

/**
 * The project is about to switch stores: write every pending notebook edit to the project
 * still attached, then close them all without another write. Done BEFORE the switch —
 * after it, the same Project object reads and writes the next project, where a
 * `notebook.ipynb` of the same name would receive this one's edits.
 */
export function closeNotebooksForSwitch() {
  for (const doc of open.values()) doc.flush()
  for (const doc of open.values()) doc.dispose(false)
  open.clear()
  pendingReveals.clear()
}

export function renameNotebook(owner: string | null, from: string, to: string) {
  for (const [key, doc] of [...open]) {
    if (doc.owner !== owner) continue
    const path = doc.path
    const next = path === from ? to : path.startsWith(from + '/') ? to + path.slice(from.length) : null
    if (next === null) continue
    open.delete(key)
    doc.rename(next)
    open.set(keyOf(doc.owner, next), doc)
  }
}

/** A project file's text changed (from anywhere). If it is an open notebook of that project,
 *  its document takes the change in — its own writes are recognised by their text and ignored. */
export function notebookFileChanged(owner: string | null, path: string, text: string | undefined) {
  if (text !== undefined && owner !== null) open.get(keyOf(owner, path))?.syncFrom(text)
}

/** Write every pending notebook edit (Save All, before a project-wide Run or export). Each
 *  document writes only to its own project (NotebookDocument.attached). */
export function flushNotebooks() {
  for (const doc of open.values()) doc.flush()
}

let parsed: { text: string; nb: Notebook | null } | null = null
/**
 * A notebook's model for a reader that is not its view (the debugger's breakpoint rows and
 * frame names): the open document's own model, else one parse of the file, cached by text —
 * a row per breakpoint must not re-parse the whole .ipynb.
 */
export function notebookModel(owner: string | null, path: string, text: string | undefined): Notebook | null {
  const doc = openNotebook(owner, path)
  if (doc) return doc.get().model
  if (text === undefined) return null
  if (parsed?.text !== text) {
    let nb: Notebook | null = null
    try {
      nb = parseNotebook(text)
    } catch {
      /* unreadable: no cells to name */
    }
    parsed = { text, nb }
  }
  return parsed.nb
}
