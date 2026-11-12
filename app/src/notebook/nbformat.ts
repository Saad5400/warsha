/**
 * The .ipynb file format (nbformat 4), read and written losslessly.
 *
 * A notebook made in Colab or Jupyter has to come back out of Warsha still
 * being the notebook it was: every key we do not understand (Colab's
 * `metadata.colab`, widget state, `attachments`, `execution` timings, …) rides
 * along untouched, cell ids stay put, and a file that nobody edited serialises
 * byte-for-byte to what was read. That is why the model keeps each cell's and
 * output's ORIGINAL JSON object (`raw`) and only overwrites the handful of
 * fields Warsha owns — source, outputs, execution count, the collapse flags —
 * in place, so key order and the representation of every other field survive.
 *
 * Three representation choices are preserved per file rather than normalised:
 *   - the indent the file was written with (Jupyter writes 1 space, Colab 2);
 *   - whether a multi-line field is a string or a list of lines (nbformat
 *     allows both and tools differ), per field;
 *   - the trailing newline.
 * Known lossy edge: a float with no fractional part (`1.0`) in metadata
 * becomes `1` — JSON.parse cannot tell the two apart. Nothing nbformat itself
 * writes has one.
 *
 * Pure TS, no DOM, so it is unit-tested in Node (tests/notebook).
 */

export type CellType = 'code' | 'markdown' | 'raw'

/** One output, in nbformat's own JSON shape — exactly what lands in the file. */
export type NbOutput = Record<string, unknown> & { output_type: string }

export interface NbCell {
  /** Stable for the life of the cell: nbformat 4.5's `id`, else Colab's `metadata.id`, else minted. */
  id: string
  type: CellType
  source: string
  /** Code cells only; [] otherwise. */
  outputs: NbOutput[]
  executionCount: number | null
  /** The cell's original JSON (every other key lives here, untouched). */
  raw: Record<string, unknown>
}

export interface Notebook {
  cells: NbCell[]
  /** The top-level object: nbformat, nbformat_minor, metadata, and anything else. Its `cells`
   *  key only holds the place the cells go back to, so the original key order survives. */
  raw: Record<string, unknown>
  /** JSON indent the file was written with. */
  indent: number | string
  trailingNewline: boolean
}

export class NotebookParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotebookParseError'
  }
}

export const isNotebookPath = (path: string | null | undefined): boolean => !!path && /\.ipynb$/i.test(path)

/* ------------------------------------------------------------ cell paths */

/**
 * The synthetic path a cell's code runs under — `analysis.ipynb#cell=3f2a9c01`.
 *
 * One spelling everywhere a cell needs a file identity: the compile filename in
 * the kernel (so tracebacks and the debugger's frames name it), breakpoints in
 * the debug store, stop frames, and each cell editor's gutter. Built from the
 * cell's stable id, never its index, so moving or inserting a cell does not
 * re-home its breakpoints onto a neighbour.
 */
export function cellPath(notebookPath: string, cellId: string): string {
  return `${notebookPath}#cell=${cellId}`
}

/** `{ notebook, cellId }` for a cell path, or null for an ordinary file path. */
export function parseCellPath(path: string): { notebook: string; cellId: string } | null {
  const m = /^(.+\.ipynb)#cell=([A-Za-z0-9_-]+)$/i.exec(path)
  return m ? { notebook: m[1], cellId: m[2] } : null
}

/* ------------------------------------------------------------- ids */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** 8 hex chars, the length Jupyter itself mints (uuid4().hex[:8]). */
export function newCellId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    let id = ''
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    for (const b of bytes) id += b.toString(16).padStart(2, '0')
    if (!taken.has(id)) return id
  }
}

/* --------------------------------------------------------- multiline */

/** nbformat's "multiline string": a string, or a list of lines each keeping its `\n`. */
export function joinText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : String(x))).join('')
  return v == null ? '' : String(v)
}

/** The list-of-lines form nbformat writes: every line keeps its newline, the last may not. */
export function splitLines(s: string): string[] {
  if (s === '') return []
  const out: string[] = []
  let start = 0
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\n') {
      out.push(s.slice(start, i + 1))
      start = i + 1
    }
  }
  if (start < s.length) out.push(s.slice(start))
  return out
}

/** Write `text` in the same representation `previous` had (list when unknown). */
function asMultiline(text: string, previous: unknown): string | string[] {
  return typeof previous === 'string' ? text : splitLines(text)
}

/* -------------------------------------------------------------- parse */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The indent unit of a JSON text — the leading whitespace of its first indented line. */
function detectIndent(text: string): number | string {
  const m = /\n([ \t]+)\S/.exec(text)
  if (!m) return 1
  const ws = m[1]
  return /^ +$/.test(ws) ? ws.length : ws
}

export function parseNotebook(text: string): Notebook {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new NotebookParseError(`This file is not valid JSON: ${(e as Error).message}`)
  }
  if (!isObject(json)) throw new NotebookParseError('This file is not a notebook (no top-level object).')
  const major = json.nbformat
  if (typeof major !== 'number' || major < 4) {
    throw new NotebookParseError(
      typeof major === 'number'
        ? `This is an nbformat ${major} notebook; Warsha opens nbformat 4 (Jupyter 4+ and Colab).`
        : 'This file is not a notebook (no nbformat version).',
    )
  }
  if (json.cells !== undefined && !Array.isArray(json.cells)) throw new NotebookParseError('This notebook\'s "cells" is not a list.')

  const rawCells = (json.cells ?? []) as unknown[]
  const taken = new Set<string>()
  const cells: NbCell[] = []
  for (const rc of rawCells as unknown[]) {
    if (!isObject(rc)) continue
    const t = rc.cell_type
    const type: CellType = t === 'markdown' || t === 'raw' ? t : 'code'
    const meta = isObject(rc.metadata) ? rc.metadata : null
    // nbformat 4.5's id wins; Colab (minor 0) keeps a stable one in metadata.id.
    let id = typeof rc.id === 'string' && ID_RE.test(rc.id) ? rc.id : typeof meta?.id === 'string' && ID_RE.test(meta.id) ? meta.id : ''
    if (!id || taken.has(id)) id = newCellId(taken)
    taken.add(id)
    cells.push({
      id,
      type,
      source: joinText(rc.source),
      outputs: type === 'code' && Array.isArray(rc.outputs) ? (rc.outputs.filter(isObject) as NbOutput[]) : [],
      executionCount: type === 'code' && typeof rc.execution_count === 'number' ? rc.execution_count : null,
      raw: rc,
    })
  }
  return { cells, raw: { ...json, cells: null }, indent: detectIndent(text), trailingNewline: text.endsWith('\n') }
}

/* ---------------------------------------------------------- serialise */

const minorOf = (nb: Notebook): number => (typeof nb.raw.nbformat_minor === 'number' ? nb.raw.nbformat_minor : 0)

/** True when the format has a top-level cell `id` (nbformat ≥ 4.5); before that it is not allowed. */
export const hasCellIds = (nb: Notebook): boolean => (typeof nb.raw.nbformat === 'number' && nb.raw.nbformat > 4) || minorOf(nb) >= 5

function cellJson(nb: Notebook, cell: NbCell): Record<string, unknown> {
  const raw = cell.raw
  // A brand-new cell gets nbformat's own (sorted) key order.
  const out: Record<string, unknown> = Object.keys(raw).length
    ? { ...raw }
    : cell.type === 'code'
      ? { cell_type: 'code', execution_count: null, id: '', metadata: {}, outputs: [], source: [] }
      : { cell_type: cell.type, id: '', metadata: {}, source: [] }
  out.cell_type = cell.type
  if (hasCellIds(nb)) out.id = cell.id
  else {
    delete out.id
    // Before 4.5 the id has no home of its own; Colab's convention keeps it in metadata.
    const meta = isObject(out.metadata) ? out.metadata : {}
    if (meta.id !== cell.id) out.metadata = { ...meta, id: cell.id }
  }
  if (!isObject(out.metadata)) out.metadata = {}
  out.source = asMultiline(cell.source, raw.source)
  if (cell.type === 'code') {
    out.execution_count = cell.executionCount
    out.outputs = cell.outputs
  } else {
    delete out.execution_count
    delete out.outputs
  }
  return out
}

export function serializeNotebook(nb: Notebook): string {
  // Spread first, then assign: `cells` keeps its original position in the key order.
  const top: Record<string, unknown> = { ...nb.raw, cells: nb.cells.map((c) => cellJson(nb, c)) }
  const text = JSON.stringify(top, null, nb.indent)
  return nb.trailingNewline ? text + '\n' : text
}

/* ------------------------------------------------------------ editing */

/** A fresh cell (no raw JSON yet, so it serialises in nbformat's own key order). */
export function newCell(type: CellType, source = '', taken: ReadonlySet<string> = new Set()): NbCell {
  return { id: newCellId(taken), type, source, outputs: [], executionCount: null, raw: {} }
}

/** A copy with a new id and no outputs — Jupyter's "duplicate cell". */
export function duplicateCell(cell: NbCell, taken: ReadonlySet<string>): NbCell {
  const raw = { ...cell.raw }
  delete raw.id
  if (isObject(raw.metadata)) {
    const { id: _id, ...meta } = raw.metadata
    raw.metadata = meta
  }
  return { ...cell, id: newCellId(taken), raw, outputs: [], executionCount: null }
}

/** Retype a cell (code ⇄ markdown ⇄ raw), dropping what the new type cannot have. */
export function convertCell(cell: NbCell, type: CellType): NbCell {
  if (cell.type === type) return cell
  const raw = { ...cell.raw }
  if (type !== 'code') {
    delete raw.outputs
    delete raw.execution_count
  }
  delete raw.attachments
  return { ...cell, type, raw, outputs: [], executionCount: null }
}

export const cellIds = (nb: Notebook): Set<string> => new Set(nb.cells.map((c) => c.id))

/* ------------------------------------------------------ collapse flags */

function cellMeta(cell: NbCell): Record<string, unknown> {
  return isObject(cell.raw.metadata) ? cell.raw.metadata : {}
}

/**
 * Whether a cell's outputs are folded. Jupyter has spelled this two ways —
 * classic's `metadata.collapsed` and JupyterLab's `metadata.jupyter.outputs_hidden`
 * — and Colab reads the second; either one folds it here, and both are written.
 */
export function outputsCollapsed(cell: NbCell): boolean {
  const meta = cellMeta(cell)
  const j = isObject(meta.jupyter) ? meta.jupyter : null
  return meta.collapsed === true || j?.outputs_hidden === true
}

export function setOutputsCollapsed(cell: NbCell, collapsed: boolean): NbCell {
  const meta = { ...cellMeta(cell) }
  const j = isObject(meta.jupyter) ? { ...meta.jupyter } : {}
  if (collapsed) {
    meta.collapsed = true
    j.outputs_hidden = true
    meta.jupyter = j
  } else {
    delete meta.collapsed
    delete j.outputs_hidden
    if (Object.keys(j).length) meta.jupyter = j
    else delete meta.jupyter
  }
  return { ...cell, raw: { ...cell.raw, metadata: meta } }
}

/* -------------------------------------------------------- new notebook */

/** The kernelspec every new notebook carries: the stock `python3` name, so Colab and
 *  Jupyter open it with their own Python kernel without asking. */
const KERNELSPEC = { display_name: 'Python 3', language: 'python', name: 'python3' }

/** A new nbformat 4.5 notebook — Jupyter's own on-disk shape (indent 1, trailing newline). */
export function createNotebook(cells: { type: CellType; source: string }[] = [{ type: 'code', source: '' }]): Notebook {
  const taken = new Set<string>()
  const made = cells.map((c) => {
    const cell = newCell(c.type, c.source, taken)
    taken.add(cell.id)
    return cell
  })
  return {
    cells: made,
    raw: {
      cells: null,
      metadata: { kernelspec: KERNELSPEC, language_info: { name: 'python' } },
      nbformat: 4,
      nbformat_minor: 5,
    },
    indent: 1,
    trailingNewline: true,
  }
}

/** Same notebook, every output and execution count gone — what "Clear all outputs" writes. */
export function clearAllOutputs(nb: Notebook): Notebook {
  return { ...nb, cells: nb.cells.map((c) => (c.type === 'code' ? { ...c, outputs: [], executionCount: null } : c)) }
}

/* ------------------------------------------------------ text views */

/**
 * The code of a notebook as one Python text — every code cell, in order, one
 * blank line apart. What the rest of the editor's text-reading features (the
 * project-wide identifier list, the type index) should see of a notebook,
 * instead of its JSON: a notebook with a plot in it is mostly base64.
 */
export function notebookCode(text: string): string {
  try {
    return parseNotebook(text)
      .cells.filter((c) => c.type === 'code')
      .map((c) => c.source)
      .join('\n\n')
  } catch {
    return ''
  }
}

/** The text a non-notebook-aware consumer should read for a project file. */
export function readableText(path: string, content: string): string {
  return isNotebookPath(path) ? notebookCode(content) : content
}

/** The notebook text with every output stripped — what a share link carries when the full
 *  notebook would not fit in a URL. Unparseable text comes back unchanged. */
export function withoutOutputs(text: string): string {
  try {
    return serializeNotebook(clearAllOutputs(parseNotebook(text)))
  } catch {
    return text
  }
}
