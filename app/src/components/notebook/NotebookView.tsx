import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { NotebookKernel } from '../../runtime/types'
import { notebookDocument, type DocumentIO, type NotebookDocument } from '../../notebook/document'
import { useSession, type KernelStatus } from '../../notebook/session'
import {
  cellIds,
  clearAllOutputs,
  convertCell,
  createNotebook,
  duplicateCell,
  newCell,
  outputsCollapsed,
  setOutputsCollapsed,
  type CellType,
  type NbCell,
  type Notebook,
} from '../../notebook/nbformat'
import { transformCell } from '../../notebook/magics'
import type { CellEditor, RunMode } from '../../notebook/cellEditor'
import { useMedia } from '../../hooks/useMedia'
import { COPY } from '../../copy'
import { CellView, INSERT_CHIP, type CellAction } from './CellView'
import { Button } from '../ui/Button'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { IconClear, IconDownload, IconMore, IconPlus, IconRestart, IconRunAll, IconStop, IconCode, IconText, IconFileLines } from '../ui/Icons'

const DESK = '(min-width: 900px) and (hover: hover) and (pointer: fine)'

export interface NotebookViewProps {
  path: string
  /** The file's current text in the project; changes that did not come from this view are re-read. */
  content: string
  kernel: NotebookKernel
  io: DocumentIO
  fontSize: number
  /** A live-collab viewer: cells can be read, not edited or run (nothing they produced could be saved). */
  readOnly?: boolean
  projectWords(): readonly string[]
  onOpenAsText(): void
  onDownload(): void
  /** A cell is about to run under the debugger (the shell opens Run and Debug). */
  onDebugStart(): void
  /** Reformat a cell's source (actions/format.ts); rejects when it cannot. */
  formatCell(source: string): Promise<string>
  /** Tell the student how a format went — the shell's toast. */
  onFormatResult(result: 'formatted' | 'unchanged' | Error): void
}

/* Cells the student cut or copied (C / X / V in command mode), shared by every notebook. */
let clipboard: NbCell[] = []

const BAR =
  'notebook-toolbar sticky top-0 z-(--z-raised) flex h-bar-top flex-none items-center gap-1 px-2 bg-surface-1 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] min-w-0'

const BAR_BTN =
  'relative inline-flex items-center gap-1.5 min-h-icon-btn px-2 rounded-md text-btn font-medium text-text-2 cursor-pointer touch-manipulation ' +
  'after:absolute after:-inset-1 after:content-[""] whitespace-nowrap ' +
  'transition-[background-color,color] duration-(--dur-fast) ease-standard hover:not-disabled:bg-surface-3 hover:not-disabled:text-text-1 ' +
  'active:not-disabled:bg-surface-4 disabled:text-text-disabled disabled:cursor-not-allowed desk:text-meta desk:[&>svg]:size-4'

function BarButton({ label, icon, onClick, disabled, showLabel = true, ...rest }: { label: string; icon: ReactNode; onClick(e: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean; showLabel?: boolean } & Record<string, unknown>) {
  return (
    <button type="button" aria-label={label} title={label} className={BAR_BTN} disabled={disabled} onClick={onClick} {...rest}>
      {icon}
      {showLabel ? <span className="max-[559px]:hidden">{label}</span> : null}
    </button>
  )
}

function KernelPill({ status, busyCell }: { status: KernelStatus; busyCell: boolean }) {
  const text =
    status === 'starting'
      ? COPY.nbKernelStarting
      : status === 'interrupting'
        ? COPY.nbKernelInterrupting
        : busyCell
          ? COPY.nbKernelBusy
          : status === 'off'
            ? COPY.nbKernelOff
            : COPY.nbKernelIdle
  const tone = status === 'off' ? 'off' : busyCell || status !== 'idle' ? 'busy' : 'idle'
  return (
    <span data-kernel={status} data-busy={busyCell || undefined} className="flex min-w-0 items-center gap-1.5 ps-1 text-micro text-text-3" aria-live="polite">
      <span
        aria-hidden="true"
        className={
          'size-2 flex-none rounded-full border ' +
          (tone === 'idle'
            ? 'bg-success border-success'
            : tone === 'busy'
              ? 'bg-warn border-warn animate-dot-pulse motion-reduce:animate-none'
              : 'bg-transparent border-text-3')
        }
      />
      <span className="truncate max-[419px]:hidden">{text}</span>
    </span>
  )
}

/** Between two cells: "+ Code / + Text". Revealed on hover with a mouse; on touch, shown under the selected cell. */
function Inserter({ visible, always, onAdd }: { visible: boolean; always?: boolean; onAdd(type: CellType): void }) {
  return (
    <div
      className={
        'group/ins relative flex h-3 items-center justify-center desk:h-4 ' +
        (always || visible ? 'h-auto py-1 desk:py-0.5' : 'hidden desk:flex')
      }
    >
      <div
        className={
          'flex items-center gap-2 ' +
          (always || visible ? '' : 'opacity-0 group-hover/ins:opacity-100 focus-within:opacity-100 transition-opacity duration-(--dur-fast)')
        }
      >
        <span aria-hidden="true" className="absolute inset-x-12 top-1/2 h-px bg-border-subtle -z-10" />
        {(['code', 'markdown'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onAdd(t)}
            aria-label={t === 'code' ? COPY.nbAddCodeCell : COPY.nbAddTextCell}
            className={INSERT_CHIP}
          >
            <IconPlus size={14} />
            {t === 'code' ? COPY.nbAddCode : COPY.nbAddText}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NotebookView(props: NotebookViewProps) {
  const { path } = props
  const doc: NotebookDocument = useMemo(() => notebookDocument(path, props.kernel, props.io), [path, props.kernel, props.io])
  const snap = useSyncExternalStore(doc.subscribe, doc.get)
  const session = useSession(doc.session)
  const desk = useMedia(DESK)
  const nb = snap.model
  const modelRef = useRef<Notebook | null>(nb)
  modelRef.current = nb

  const [selected, setSelected] = useState<string | null>(null)
  const [editingText, setEditingText] = useState<Set<string>>(() => new Set())
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const editors = useRef(new Map<string, CellEditor>())
  const scroller = useRef<HTMLDivElement>(null)
  const undoStack = useRef<{ cell: NbCell; index: number }[]>([])
  const chord = useRef<{ key: string; at: number } | null>(null)

  // Outside changes to the file come back in; our own writes are recognised and ignored.
  useEffect(() => doc.syncFrom(props.content), [doc, props.content])
  // A brand-new (empty) .ipynb becomes a one-cell notebook.
  useEffect(() => {
    if (!snap.model && !snap.error) doc.initialize(createNotebook())
  }, [doc, snap.model, snap.error])
  useEffect(() => () => doc.flush(), [doc])
  // Keep a selection.
  useEffect(() => {
    if (!nb) return
    if (!selected || !nb.cells.some((c) => c.id === selected)) setSelected(nb.cells[0]?.id ?? null)
  }, [nb, selected])

  /* ---- cell context for completion: the code of the cells above, IPython syntax rewritten ---- */
  const transformCache = useRef(new Map<string, string>())
  const contextFns = useRef(new Map<string, () => string>())
  const contextFor = useCallback((id: string) => {
    let fn = contextFns.current.get(id)
    if (!fn) {
      fn = () => {
        const cells = modelRef.current?.cells ?? []
        const parts: string[] = []
        for (const c of cells) {
          if (c.id === id) break
          if (c.type !== 'code') continue
          let code = transformCache.current.get(c.source)
          if (code === undefined) {
            code = transformCell(c.source).code
            transformCache.current.set(c.source, code)
          }
          parts.push(code)
        }
        if (transformCache.current.size > 500) transformCache.current.clear()
        return parts.join('\n\n')
      }
      contextFns.current.set(id, fn)
    }
    return fn
  }, [])

  /* ---- focus and selection ---- */
  const focusCell = useCallback((id: string, mode: 'command' | 'edit', where?: 'start' | 'end') => {
    setSelected(id)
    // A cell inserted a moment ago has no editor until React has rendered it and CodeMirror
    // has mounted; wait a few frames for it rather than landing in command mode by accident.
    let tries = 0
    const go = () => {
      const el = scroller.current?.querySelector(`[data-cell-id="${id}"]`) as HTMLElement | null
      const ed = editors.current.get(id)
      if (mode === 'edit' && !ed && tries++ < 10) return void requestAnimationFrame(go)
      if (mode === 'edit' && ed) ed.focus(where)
      else el?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'nearest' })
    }
    // Command mode on a cell already on screen happens now: Escape then B must not type a "b".
    if (mode === 'command' && scroller.current?.querySelector(`[data-cell-id="${id}"]`)) go()
    else requestAnimationFrame(go)
  }, [])

  const indexOf = (id: string) => modelRef.current?.cells.findIndex((c) => c.id === id) ?? -1

  /* ---- structural edits ---- */
  const insertAt = useCallback(
    (index: number, type: CellType, cells?: NbCell[]) => {
      let firstId = ''
      doc.replace((m) => {
        const taken = cellIds(m)
        const fresh = cells ? cells.map((c) => { const d = duplicateCell(c, taken); taken.add(d.id); return d }) : [newCell(type, '', taken)]
        firstId = fresh[0].id
        const next = m.cells.slice()
        next.splice(index, 0, ...fresh)
        return { ...m, cells: next }
      })
      if (type === 'markdown' && !cells) setEditingText((s) => new Set(s).add(firstId))
      focusCell(firstId, 'edit')
      return firstId
    },
    [doc, focusCell],
  )

  const removeCell = useCallback(
    (id: string) => {
      const m = modelRef.current
      if (!m) return
      const i = m.cells.findIndex((c) => c.id === id)
      if (i < 0) return
      undoStack.current.push({ cell: m.cells[i], index: i })
      if (undoStack.current.length > 50) undoStack.current.shift()
      doc.replace((x) => ({ ...x, cells: x.cells.filter((c) => c.id !== id) }))
      const after = m.cells[i + 1] ?? m.cells[i - 1]
      if (after) focusCell(after.id, 'command')
    },
    [doc, focusCell],
  )

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      doc.replace((m) => {
        const i = m.cells.findIndex((c) => c.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= m.cells.length) return m
        const cells = m.cells.slice()
        ;[cells[i], cells[j]] = [cells[j], cells[i]]
        return { ...m, cells }
      })
      focusCell(id, 'command')
    },
    [doc, focusCell],
  )

  /* ---- running ---- */
  const codeIds = (from = 0, to?: number) => (modelRef.current?.cells ?? []).slice(from, to).filter((c) => c.type === 'code').map((c) => c.id)

  const run = useCallback(
    (id: string, mode: RunMode) => {
      const m = modelRef.current
      if (!m) return
      const i = m.cells.findIndex((c) => c.id === id)
      const cell = m.cells[i]
      if (!cell) return
      if (cell.type === 'markdown') {
        setEditingText((s) => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
      } else doc.session.run([id])
      if (mode === 'advance') {
        const next = m.cells[i + 1]
        if (next) focusCell(next.id, next.type === 'code' ? 'edit' : 'command', 'end')
        else insertAt(i + 1, 'code')
      } else if (mode === 'insert') insertAt(i + 1, 'code')
      else if (cell.type === 'markdown') focusCell(id, 'command')
    },
    [doc, focusCell, insertAt],
  )

  const onAction = useCallback(
    (id: string, a: CellAction) => {
      const i = indexOf(id)
      switch (a) {
        case 'up':
          return move(id, -1)
        case 'down':
          return move(id, 1)
        case 'delete':
          return removeCell(id)
        case 'duplicate': {
          const cell = modelRef.current?.cells[i]
          if (cell) insertAt(i + 1, cell.type, [cell])
          return
        }
        case 'toCode':
        case 'toText':
          doc.updateCell(id, (c) => convertCell(c, a === 'toCode' ? 'code' : 'markdown'))
          if (a === 'toText') setEditingText((s) => new Set(s).add(id))
          return focusCell(id, 'command')
        case 'clearOutput':
          return doc.updateCell(id, (c) => ({ ...c, outputs: [], executionCount: null }))
        case 'toggleOutput':
          return doc.updateCell(id, (c) => setOutputsCollapsed(c, !outputsCollapsed(c)))
        case 'debug':
          props.onDebugStart()
          return doc.session.run([id], { debug: true })
        case 'runAbove':
          return doc.session.run(codeIds(0, i))
        case 'runBelow':
          return doc.session.run(codeIds(i))
        case 'edit':
          setEditingText((s) => new Set(s).add(id))
          return focusCell(id, 'edit', 'end')
        case 'format': {
          const cell = modelRef.current?.cells[i]
          if (!cell || cell.type !== 'code') return
          const before = cell.source
          props.formatCell(before).then(
            (after) => {
              if (after === before) return props.onFormatResult('unchanged')
              // Only if nobody typed in the meantime.
              doc.updateCell(id, (c) => (c.source === before ? { ...c, source: after } : c))
              props.onFormatResult('formatted')
            },
            (e: Error) => props.onFormatResult(e),
          )
          return
        }
        case 'addCode':
        case 'addText':
          insertAt(i + 1, a === 'addCode' ? 'code' : 'markdown')
          return
        case 'doneEditing':
          setEditingText((s) => {
            const n = new Set(s)
            n.delete(id)
            return n
          })
          return focusCell(id, 'command')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the model through modelRef
    [doc, move, removeCell, insertAt, focusCell],
  )

  const runAll = () => doc.runAll()
  // The shell's Debug (F5, Run and Debug) starts from the selected cell.
  useEffect(() => {
    doc.selected = selected
  }, [doc, selected])
  const restart = () => void doc.session.restart()
  const restartRunAll = async () => {
    await doc.session.restart()
    doc.session.run(codeIds())
  }
  const clearAll = () => doc.replace((m) => clearAllOutputs(m))

  /* ---- debug stops and reveals arrive for a cell path ---- */
  useEffect(
    () =>
      doc.onReveal((cellId, line) => {
        const ed = editors.current.get(cellId)
        setSelected(cellId)
        requestAnimationFrame(() => {
          const el = scroller.current?.querySelector(`[data-cell-id="${cellId}"]`)
          el?.scrollIntoView({ block: 'center' })
          if (ed && line) {
            const doc2 = ed.view.state.doc
            const l = doc2.line(Math.max(1, Math.min(line, doc2.lines)))
            ed.view.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
          }
        })
      }),
    [doc],
  )

  /* ---- command mode (Jupyter's keys), only when focus is on a cell, not in its editor ---- */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (props.readOnly) return
    const target = e.target as HTMLElement
    if (target.closest('.cm-editor, input, textarea, [role="menu"], [role="toolbar"]')) return
    const m = modelRef.current
    if (!m || !selected) return
    const i = m.cells.findIndex((c) => c.id === selected)
    const cell = m.cells[i]
    if (!cell) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    const twice = (key: string) => {
      const now = Date.now()
      if (chord.current?.key === key && now - chord.current.at < 600) {
        chord.current = null
        return true
      }
      chord.current = { key, at: now }
      return false
    }
    let handled = true
    if (k === 'Enter' && e.shiftKey) run(cell.id, 'advance')
    else if (k === 'Enter' && mod) run(cell.id, 'run')
    else if (k === 'Enter' && e.altKey) run(cell.id, 'insert')
    else if (k === 'Enter') {
      if (cell.type === 'markdown') setEditingText((s) => new Set(s).add(cell.id))
      focusCell(cell.id, 'edit', 'end')
    } else if (mod || e.altKey) handled = false
    else if (k === 'ArrowUp' || k === 'k') i > 0 && focusCell(m.cells[i - 1].id, 'command')
    else if (k === 'ArrowDown' || k === 'j') i < m.cells.length - 1 && focusCell(m.cells[i + 1].id, 'command')
    else if (k === 'a') insertAt(i, 'code')
    else if (k === 'b') insertAt(i + 1, 'code')
    else if (k === 'd') {
      if (twice('d')) removeCell(cell.id)
    } else if (k === 'z') {
      const u = undoStack.current.pop()
      if (u) {
        doc.replace((x) => {
          const cells = x.cells.slice()
          cells.splice(Math.min(u.index, cells.length), 0, u.cell)
          return { ...x, cells }
        })
        focusCell(u.cell.id, 'command')
      }
    } else if (k === 'm') onAction(cell.id, 'toText')
    else if (k === 'y') onAction(cell.id, 'toCode')
    else if (k === 'c') clipboard = [cell]
    else if (k === 'x') {
      clipboard = [cell]
      removeCell(cell.id)
    } else if (k === 'v') {
      if (clipboard.length) insertAt(i + 1, clipboard[0].type, clipboard)
    } else if (k === 'o') onAction(cell.id, 'toggleOutput')
    else if (k === 'i') {
      if (twice('i')) doc.session.interrupt()
    } else if (k === '0') {
      if (twice('0')) restart()
    } else if (k === 'Escape') handled = true
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  /* ---- stable callbacks for memoised cells ---- */
  const onSelect = useCallback((id: string) => setSelected(id), [])
  const onChange = useCallback((id: string, text: string) => doc.updateCell(id, (c) => (c.source === text ? c : { ...c, source: text })), [doc])
  const onEscape = useCallback((id: string) => {
    setEditingText((s) => {
      if (!s.has(id)) return s
      const n = new Set(s)
      n.delete(id)
      return n
    })
    focusCell(id, 'command')
  }, [focusCell])
  const onLeave = useCallback(
    (id: string, dir: -1 | 1) => {
      const m = modelRef.current
      if (!m) return
      const i = m.cells.findIndex((c) => c.id === id)
      const next = m.cells[i + dir]
      if (!next) return
      if (next.type === 'code' || editingText.has(next.id)) focusCell(next.id, 'edit', dir < 0 ? 'end' : 'start')
      else focusCell(next.id, 'command')
    },
    [focusCell, editingText],
  )
  const onInterrupt = useCallback(() => doc.session.interrupt(), [doc])
  const onStdin = useCallback((line: string) => doc.session.writeStdin(line), [doc])
  const onSave = useCallback(() => doc.flush(), [doc])
  const registerEditor = useCallback((id: string, ed: CellEditor | null) => {
    if (ed) editors.current.set(id, ed)
    else editors.current.delete(id)
  }, [])
  const projectWords = props.projectWords

  if (snap.error) {
    return (
      <div className="notebook-view flex flex-1 flex-col items-center justify-start gap-3 bg-surface-1 px-4 pt-[max(var(--sp-5),20%)] text-center">
        <IconFileLines size={32} className="text-text-3" />
        <p className="max-w-[40ch] text-btn font-semibold text-text-2">{COPY.nbUnreadableTitle}</p>
        <p className="max-w-[48ch] text-row text-text-3">{COPY.nbUnreadableHint}</p>
        <p className="max-w-[60ch] break-words font-code text-micro text-text-3 [direction:ltr]">{snap.error}</p>
        <Button variant="ghost" onClick={props.onOpenAsText}>
          {COPY.nbOpenAsText}
        </Button>
      </div>
    )
  }
  if (!nb) return <div className="notebook-view flex-1 bg-surface-1" />

  const anyBusy = session.running !== null || Object.values(session.cells).some((c) => c.state === 'queued')
  const moreItems: MenuItem[] = [
    { label: COPY.nbRestartRunAll, icon: <IconRestart size={18} />, onSelect: () => void restartRunAll() },
    { label: COPY.nbClearOutputs, icon: <IconClear size={18} />, onSelect: clearAll },
    { label: COPY.nbDownload, icon: <IconDownload size={18} />, onSelect: props.onDownload, startsGroup: true },
    { label: COPY.nbOpenAsText, icon: <IconFileLines size={18} />, onSelect: props.onOpenAsText },
  ]

  return (
    <section aria-label={path} data-notebook={path} className="notebook-view relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1">
      <div role="toolbar" aria-label={COPY.nbToolbar} className={BAR + (props.readOnly ? ' hidden' : '')}>
        <BarButton label={COPY.nbAddCode} icon={<IconCode size={18} />} onClick={() => insertAt(selected ? indexOf(selected) + 1 : nb.cells.length, 'code')} aria-label={COPY.nbAddCodeCell} />
        <BarButton label={COPY.nbAddText} icon={<IconText size={18} />} onClick={() => insertAt(selected ? indexOf(selected) + 1 : nb.cells.length, 'markdown')} aria-label={COPY.nbAddTextCell} />
        <span aria-hidden="true" className="mx-1 h-5 w-px flex-none bg-border-subtle" />
        <BarButton label={COPY.nbRunAll} icon={<IconRunAll size={18} />} onClick={runAll} />
        <BarButton label={COPY.nbInterrupt} icon={<IconStop size={16} />} onClick={() => doc.session.interrupt()} disabled={!anyBusy} />
        <BarButton label={COPY.nbRestart} icon={<IconRestart size={18} />} onClick={restart} disabled={session.kernel === 'off' && !anyBusy} />
        <BarButton label={COPY.nbClearOutputs} icon={<IconClear size={18} />} onClick={clearAll} showLabel={false} />
        <span className="flex-1" />
        <KernelPill status={session.kernel} busyCell={anyBusy} />
        <BarButton
          label={COPY.nbMore}
          icon={<IconMore size={18} />}
          showLabel={false}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const rtl = document.documentElement.dir === 'rtl'
            setMenu({ x: rtl ? r.left : r.right, y: r.bottom, fromRight: !rtl })
          }}
        />
        {menu ? <Menu anchor={menu} items={moreItems} label={COPY.nbMore} onClose={() => setMenu(null)} /> : null}
      </div>
      {session.notice ? (
        <p role="status" className="m-0 border-b border-border-subtle bg-info-soft px-3 py-1.5 text-meta text-text-1">
          {session.notice}
        </p>
      ) : null}

      <div ref={scroller} className="notebook-scroller scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden" onKeyDown={onKeyDown}>
        <div className="mx-auto flex w-full max-w-[1100px] min-w-0 flex-col px-1 pt-4 pb-[40vh] desk:px-4">
          {nb.cells.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <p className="m-0 text-btn font-semibold text-text-2">{COPY.nbEmptyTitle}</p>
              <p className="m-0 text-row text-text-3">{COPY.nbEmptyHint}</p>
            </div>
          ) : null}
          {nb.cells.map((cell, i) => (
            <div key={cell.id} className="min-w-0">
              {i === 0 && !props.readOnly ? <Inserter visible={false} onAdd={(t) => insertAt(0, t)} /> : null}
              <CellView
                cell={cell}
                index={i}
                notebookPath={path}
                selected={selected === cell.id}
                editingText={editingText.has(cell.id)}
                status={session.cells[cell.id]}
                waiting={session.waiting === cell.id}
                progress={session.running === cell.id ? session.progress : null}
                fontSize={props.fontSize}
                readOnly={!!props.readOnly}
                desk={desk}
                first={i === 0}
                last={i === nb.cells.length - 1}
                context={contextFor(cell.id)}
                projectWords={projectWords}
                onSelect={onSelect}
                onRun={run}
                onInterrupt={onInterrupt}
                onChange={onChange}
                onAction={onAction}
                onEscape={onEscape}
                onLeave={onLeave}
                onStdin={onStdin}
                onSave={onSave}
                registerEditor={registerEditor}
              />
              {/* On touch the selected cell's own toolbar row carries the insert chips. */}
              {props.readOnly ? null : (
                <Inserter visible={false} always={i === nb.cells.length - 1 && !(selected === cell.id && !desk)} onAdd={(t) => insertAt(i + 1, t)} />
              )}
            </div>
          ))}
          {nb.cells.length === 0 && !props.readOnly ? <Inserter visible always onAdd={(t) => insertAt(0, t)} /> : null}
        </div>
      </div>
    </section>
  )
}
