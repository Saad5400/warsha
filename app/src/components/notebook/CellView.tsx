import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createCellEditor, type CellEditor, type RunMode } from '../../notebook/cellEditor'
import { cellPath, outputsCollapsed, type NbCell } from '../../notebook/nbformat'
import { renderMarkdown } from '../../notebook/markdown'
import type { CellStatus } from '../../notebook/session'
import type { LoadProgress } from '../../runtime/types'
import { COPY } from '../../copy'
import { OutputView } from './OutputView'
import { MD_PROSE, useMarkdownOptions } from './markdownProse'
import { IconWand, IconPlus, IconChevronDown, IconChevronRight, IconChevronUp, IconClose, IconCode, IconDuplicate, IconMore, IconPencil, IconPlay, IconStop, IconText, IconTrash, IconCheck } from '../ui/Icons'
import { IconDebugAlt } from '../ui/DebugIcons'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'

export type CellAction =
  | 'up'
  | 'down'
  | 'duplicate'
  | 'delete'
  | 'toCode'
  | 'toText'
  | 'clearOutput'
  | 'toggleOutput'
  | 'debug'
  | 'runAbove'
  | 'runBelow'
  | 'edit'
  | 'doneEditing'
  | 'addCode'
  | 'addText'
  | 'format'

export interface CellViewProps {
  cell: NbCell
  index: number
  notebookPath: string
  selected: boolean
  /** A text cell showing its source instead of its rendering. */
  editingText: boolean
  status: CellStatus | undefined
  waiting: boolean
  progress: LoadProgress | null
  fontSize: number
  desk: boolean
  first: boolean
  last: boolean
  context(): string
  projectWords(): readonly string[]
  onSelect(id: string): void
  onRun(id: string, mode: RunMode): void
  onInterrupt(): void
  onChange(id: string, text: string): void
  onAction(id: string, action: CellAction): void
  onEscape(id: string): void
  onLeave(id: string, dir: -1 | 1): void
  onStdin(line: string): void
  onSave(): void
  registerEditor(id: string, editor: CellEditor | null): void
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

/** The cell's CodeMirror, created once per cell and kept in step with the model. */
function CellEditorHost(props: {
  cell: NbCell
  notebookPath: string
  fontSize: number
  context(): string
  projectWords(): readonly string[]
  placeholder: string
  onChange(text: string): void
  onRun(mode: RunMode): void
  onEscape(): void
  onLeave(dir: -1 | 1): void
  onFocus(): void
  onSave(): void
  onFormat(): void
  register(editor: CellEditor | null): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<CellEditor | null>(null)
  // Callbacks through a ref: the editor is built once and must always reach the latest props.
  const live = useRef(props)
  live.current = props
  useEffect(() => {
    const el = host.current
    if (!el) return
    const ed = createCellEditor(el, {
      doc: props.cell.source,
      type: props.cell.type,
      path: cellPath(props.notebookPath, props.cell.id),
      fontSize: props.fontSize,
      context: () => live.current.context(),
      projectWords: () => live.current.projectWords(),
      onChange: (t) => live.current.onChange(t),
      onRun: (m) => live.current.onRun(m),
      onEscape: () => live.current.onEscape(),
      onLeave: (d) => live.current.onLeave(d),
      onFocus: () => live.current.onFocus(),
      onSave: () => live.current.onSave(),
      onFormat: () => live.current.onFormat(),
    })
    editor.current = ed
    live.current.register(ed)
    return () => {
      live.current.register(null)
      ed.destroy()
      editor.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per cell id and type
  }, [props.cell.id, props.cell.type, props.notebookPath])
  useEffect(() => {
    editor.current?.setDoc(props.cell.source)
  }, [props.cell.source])
  useEffect(() => {
    editor.current?.setFontSize(props.fontSize)
  }, [props.fontSize])
  return (
    <div className="relative min-w-0">
      <div ref={host} className="min-w-0" />
      {props.cell.source === '' ? (
        <span aria-hidden="true" className="pointer-events-none absolute top-[7px] start-[calc(2ch+20px)] truncate font-code text-[13px] text-text-3 [direction:ltr]">
          {props.placeholder}
        </span>
      ) : null}
    </div>
  )
}

const GUTTER_BTN =
  'relative grid place-items-center size-[32px] rounded-full border cursor-pointer touch-manipulation ' +
  'after:absolute after:-inset-1.5 after:content-[""] ' +
  'transition-[background-color,color,border-color] duration-(--dur-fast) ease-standard ' +
  'border-border-control text-text-1 bg-surface-3 hover:bg-surface-4 active:bg-surface-4 ' +
  'data-[state=error]:border-danger data-[state=error]:text-danger ' +
  'desk:size-[26px] desk:[&>svg]:size-3.5'

function RunButton({ status, onRun, onInterrupt }: { status: CellStatus | undefined; onRun(): void; onInterrupt(): void }) {
  const state = status?.state
  if (state === 'running') {
    return (
      <button type="button" aria-label={COPY.nbStopCell} title={COPY.nbStopCell} data-state="running" className={GUTTER_BTN + ' !border-transparent'} onClick={onInterrupt}>
        <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-text-1 border-t-transparent animate-spinner motion-reduce:animate-none" />
        <IconStop size={14} />
      </button>
    )
  }
  if (state === 'queued') {
    return (
      <button type="button" aria-label={COPY.nbCellQueued} title={COPY.nbCellQueued} data-state="queued" className={GUTTER_BTN + ' border-dashed text-text-3'} onClick={onInterrupt}>
        <span aria-hidden="true" className="font-code text-[11px]">…</span>
      </button>
    )
  }
  return (
    <button type="button" aria-label={COPY.nbRunCell} title={`${COPY.nbRunCell} (Shift+Enter)`} data-state={state ?? 'idle'} className={GUTTER_BTN} onClick={onRun}>
      {/* Not mirrored in RTL: a play arrow is a media control, not a direction. */}
      <IconPlay size={16} className="ms-0.5" />
    </button>
  )
}

/** "+ Code" / "+ Text": the insert chips, shared with the notebook's between-cells inserter. */
export const INSERT_CHIP =
  'inline-flex items-center gap-1 rounded-pill border border-border-control bg-surface-2 px-2.5 min-h-[32px] desk:min-h-[22px] ' +
  'text-meta font-medium text-text-2 cursor-pointer touch-manipulation hover:bg-surface-3 hover:text-text-1 active:bg-surface-4 ' +
  'transition-[background-color,color] duration-(--dur-fast) ease-standard'

const TOOL_BTN =
  'relative grid place-items-center size-icon-btn rounded-md text-text-2 cursor-pointer touch-manipulation ' +
  'hover:bg-surface-4 hover:text-text-1 active:bg-surface-4 disabled:text-text-disabled disabled:cursor-not-allowed disabled:bg-transparent ' +
  'transition-[background-color,color] duration-(--dur-fast) ease-standard desk:[&>svg]:size-4'

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick(e: React.MouseEvent<HTMLButtonElement>): void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} className={TOOL_BTN} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

function StdinRow({ onSubmit }: { onSubmit(line: string): void }) {
  const ref = useRef<HTMLInputElement>(null)
  // Where the student was (Shift+Enter has usually moved them into the next cell): they go back there after answering.
  const back = useRef<Element | null>(null)
  useEffect(() => {
    back.current = document.activeElement
    const input = ref.current
    input?.focus({ preventScroll: false })
    return () => {
      const el = back.current
      const here = document.activeElement
      if (el instanceof HTMLElement && el.isConnected && (here === input || here === document.body || here === null)) el.focus({ preventScroll: true })
    }
  }, [])
  return (
    <input
      ref={ref}
      aria-label={COPY.nbInputLabel}
      placeholder={COPY.stdinWaitingPlaceholder}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="send"
      className="mt-1 block w-full min-h-touch rounded-sm border border-border-control bg-surface-1 px-2 font-code text-[16px] text-info [direction:ltr] placeholder:font-ui placeholder:text-text-3 desk:min-h-[28px] desk:text-[13px]"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onSubmit(e.currentTarget.value)
        }
      }}
    />
  )
}

function CellViewImpl(p: CellViewProps) {
  const { cell } = p
  const code = cell.type === 'code'
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const attachments = (cell.raw.attachments ?? undefined) as Record<string, Record<string, string>> | undefined
  const mdOpts = useMarkdownOptions(attachments)
  const collapsed = outputsCollapsed(cell)
  const state = p.status?.state
  const showEditor = code || p.editingText || cell.type === 'raw'
  const rendered = useMemo(() => (showEditor ? '' : renderMarkdown(cell.source, mdOpts)), [showEditor, cell.source, mdOpts.highlight])

  const act = (a: CellAction) => () => p.onAction(cell.id, a)
  const menuItems: MenuItem[] = [
    ...(code
      ? [
          { label: COPY.nbDebugCell, icon: <IconDebugAlt size={18} />, onSelect: act('debug') },
          { label: COPY.nbFormatCell, icon: <IconWand size={18} />, hint: 'Shift+Alt+F', onSelect: act('format') },
          { label: COPY.nbRunAbove, onSelect: act('runAbove'), startsGroup: true },
          { label: COPY.nbRunBelow, onSelect: act('runBelow') },
          { label: COPY.nbClearOutput, onSelect: act('clearOutput'), startsGroup: true },
          { label: collapsed ? COPY.nbShowOutput : COPY.nbHideOutput, onSelect: act('toggleOutput') },
          { label: COPY.nbToText, icon: <IconText size={18} />, onSelect: act('toText'), startsGroup: true },
        ]
      : [{ label: COPY.nbToCode, icon: <IconCode size={18} />, onSelect: act('toCode') }]),
    { label: COPY.nbDuplicate, icon: <IconDuplicate size={18} />, onSelect: act('duplicate') },
    { label: COPY.nbDelete, icon: <IconTrash size={18} />, onSelect: act('delete'), danger: true },
  ]

  const statusText =
    state === 'queued' ? COPY.nbCellQueued : state === 'running' ? COPY.nbCellRunning : state === 'error' ? COPY.nbCellError : state === 'interrupted' ? COPY.nbCellInterrupted : p.status?.ms !== undefined ? COPY.nbCellRanIn(fmtMs(p.status.ms)) : ''

  return (
    <div
      role="group"
      aria-label={COPY.nbCellLabel(p.index + 1, code ? 'code' : 'text')}
      data-cell-id={cell.id}
      data-cell-type={cell.type}
      data-selected={p.selected || undefined}
      data-state={state ?? 'idle'}
      tabIndex={p.selected ? 0 : -1}
      onPointerDown={() => p.onSelect(cell.id)}
      onFocus={(e) => {
        if (e.target === e.currentTarget) p.onSelect(cell.id)
      }}
      onDoubleClick={() => {
        if (!code && !p.editingText) p.onAction(cell.id, 'edit')
      }}
      className={
        // A text cell has no run button: on a phone its gutter gives the width back to the prose.
        'nb-cell group/cell relative grid desk:grid-cols-[48px_minmax(0,1fr)] gap-x-1 ' +
        (code ? 'grid-cols-[40px_minmax(0,1fr)] ' : 'grid-cols-[4px_minmax(0,1fr)] ') +
        'rounded-lg border border-transparent py-1 pe-2 ' +
        'transition-[border-color,background-color] duration-(--dur-fast) ease-standard ' +
        'focus-visible:outline-offset-[-1px] ' +
        'data-[selected]:border-border-subtle data-[selected]:bg-surface-2/40 ' +
        'before:absolute before:inset-y-2 before:start-0 before:w-[2px] before:rounded-full before:content-[""] before:bg-transparent ' +
        'data-[selected]:before:bg-accent data-[state=error]:before:bg-danger ' +
        'focus-within:has-[.cm-focused]:border-border-control'
      }
    >
      {/* Gutter: run button and execution count (code); nothing for text. */}
      <div className="flex flex-col items-center gap-0.5 pt-1">
        {code ? (
          <>
            <RunButton status={p.status} onRun={() => p.onRun(cell.id, 'run')} onInterrupt={p.onInterrupt} />
            <span
              data-count=""
              className={
                'font-code text-[11px] leading-[1.4] tabular-nums [direction:ltr] ' +
                (state === 'error' ? 'text-danger' : 'text-text-3')
              }
            >
              [{state === 'running' || state === 'queued' ? '*' : (cell.executionCount ?? ' ')}]
            </span>
          </>
        ) : null}
      </div>

      <div className="min-w-0">
        {menu ? <Menu anchor={menu} items={menuItems} label={COPY.nbCellActions} onClose={() => setMenu(null)} /> : null}

        {showEditor ? (
          <div
            className={
              'min-w-0 overflow-hidden rounded-md border border-border-subtle ' +
              (code ? 'bg-(--code-bg)' : 'bg-surface-1')
            }
          >
            <CellEditorHost
              cell={cell}
              notebookPath={p.notebookPath}
              fontSize={p.fontSize}
              context={p.context}
              projectWords={p.projectWords}
              placeholder={code ? (p.desk ? COPY.nbCodePlaceholder : COPY.nbCodePlaceholderTouch) : ''}
              onChange={(t) => p.onChange(cell.id, t)}
              onRun={(m) => p.onRun(cell.id, m)}
              onEscape={() => p.onEscape(cell.id)}
              onLeave={(d) => p.onLeave(cell.id, d)}
              onFocus={() => p.onSelect(cell.id)}
              onSave={p.onSave}
              onFormat={act('format')}
              register={(e) => p.registerEditor(cell.id, e)}
            />
          </div>
        ) : cell.source.trim() ? (
          // Markup built from escaped text only (notebook/markdown.ts).
          <div className={MD_PROSE + ' px-2 py-1.5'} dangerouslySetInnerHTML={{ __html: rendered }} />
        ) : (
          <p className="m-0 px-2 py-2 text-meta italic text-text-3">{p.desk ? COPY.nbEmptyText : COPY.nbEmptyTextTouch}</p>
        )}

        {/* Running: a sweep on the cell, and what is downloading if anything is. */}
        {state === 'running' ? (
          <div aria-hidden="true" className="relative mt-1 h-0.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className={
                'absolute inset-y-0 start-0 bg-text-2 ' +
                (p.progress?.total ? '' : 'w-1/3 animate-sweep motion-reduce:w-full motion-reduce:opacity-50')
              }
              style={p.progress?.total ? { width: `${Math.min(100, (100 * (p.progress.loaded ?? 0)) / p.progress.total)}%` } : undefined}
            />
          </div>
        ) : null}
        {state === 'running' && p.progress ? (
          <p className="m-0 mt-1 text-micro text-text-3" aria-live="polite">
            {p.progress.message}
          </p>
        ) : null}

        {/* Outputs. */}
        {code && (cell.outputs.length > 0 || p.waiting) ? (
          <div aria-label={COPY.nbOutputLabel} className="nb-outputs relative mt-1.5 min-h-[40px] min-w-0 desk:min-h-0">
            {/* Starts below the gutter's run button + count, which a one-line cell is shorter than. */}
            <div className="absolute -start-[44px] desk:-start-[52px] top-3 flex flex-col items-center gap-0.5 w-[40px] desk:w-[48px]">
              <button
                type="button"
                aria-label={collapsed ? COPY.nbShowOutput : COPY.nbHideOutput}
                title={collapsed ? COPY.nbShowOutput : COPY.nbHideOutput}
                className={TOOL_BTN + ' size-[28px] desk:size-[22px]'}
                onClick={act('toggleOutput')}
              >
                {collapsed ? <IconChevronRight size={16} className="rtl:-scale-x-100" /> : <IconChevronDown size={16} />}
              </button>
              {!collapsed ? (
                <button
                  type="button"
                  aria-label={COPY.nbClearOutput}
                  title={COPY.nbClearOutput}
                  // Mouse only: on a phone two stacked buttons outgrew a one-line output; Clear output is in the cell's ⋯ menu there.
                  className={TOOL_BTN + ' hidden desk:grid size-[28px] desk:size-[22px] desk:opacity-0 desk:group-hover/cell:opacity-100 desk:focus-visible:opacity-100'}
                  onClick={act('clearOutput')}
                >
                  <IconClose size={14} />
                </button>
              ) : null}
            </div>
            {collapsed ? (
              <button type="button" onClick={act('toggleOutput')} className="block w-full rounded-sm px-2 py-1 text-start text-meta text-text-3 hover:bg-surface-3 cursor-pointer">
                {COPY.nbOutputsHidden(cell.outputs.length)}
              </button>
            ) : (
              <div className="flex min-w-0 flex-col gap-1 px-2 [direction:ltr] text-left">
                {cell.outputs.map((o, i) => (
                  <OutputView key={i} output={o} />
                ))}
                {p.waiting ? <StdinRow onSubmit={p.onStdin} /> : null}
              </div>
            )}
          </div>
        ) : null}

        {statusText && code ? (
          <p
            className={
              'm-0 mt-0.5 px-2 text-micro leading-[1.4] ' +
              (state === 'error' ? 'text-danger' : 'text-text-3') +
              (state === 'ok' || state === undefined ? ' desk:opacity-0 desk:group-hover/cell:opacity-100' : '')
            }
          >
            {statusText}
          </p>
        ) : null}
        {/* The cell's toolbar. With a mouse it floats over the cell's top edge on hover/selection,
            as in Colab; on touch it is a row under the selected cell — floating, it covered the
            first line of the cell, the very line a phone has least room to show — and it carries
            the "+ Code / + Text" insert chips too, so a phone spends one row on all of it. */}
        <div
          role="toolbar"
          aria-label={COPY.nbCellActions}
          className={
            'z-(--z-raised) mt-1 items-center gap-0.5 ' +
            'desk:absolute desk:-top-4 desk:end-2 desk:mt-0 desk:rounded-md desk:border desk:border-border-subtle desk:bg-surface-3 desk:p-0.5 desk:shadow-raised ' +
            (p.selected ? 'flex' : 'hidden desk:group-hover/cell:flex')
          }
        >
          {p.desk ? null : (
            <>
              {(['code', 'markdown'] as const).map((t) => (
                <button key={t} type="button" onClick={act(t === 'code' ? 'addCode' : 'addText')} className={INSERT_CHIP} aria-label={t === 'code' ? COPY.nbAddCodeCell : COPY.nbAddTextCell}>
                  <IconPlus size={14} />
                  {t === 'code' ? COPY.nbAddCode : COPY.nbAddText}
                </button>
              ))}
              <span className="flex-1" />
            </>
          )}
          {!code && cell.type === 'markdown' ? (
            p.editingText ? (
              <ToolButton label={COPY.nbDoneEditing} onClick={act('doneEditing')}>
                <IconCheck size={18} />
              </ToolButton>
            ) : (
              <ToolButton label={COPY.nbEditText} onClick={act('edit')}>
                <IconPencil size={18} />
              </ToolButton>
            )
          ) : null}
          <ToolButton label={COPY.nbMoveUp} onClick={act('up')} disabled={p.first}>
            <IconChevronUp size={18} />
          </ToolButton>
          <ToolButton label={COPY.nbMoveDown} onClick={act('down')} disabled={p.last}>
            <IconChevronDown size={18} />
          </ToolButton>
          <ToolButton label={COPY.nbDelete} onClick={act('delete')}>
            <IconTrash size={18} />
          </ToolButton>
          <ToolButton
            label={COPY.nbCellActions}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: document.documentElement.dir === 'rtl' ? r.left : r.right, y: r.bottom, fromRight: document.documentElement.dir !== 'rtl' })
            }}
          >
            <IconMore size={18} />
          </ToolButton>
        </div>
      </div>
    </div>
  )
}

export const CellView = memo(CellViewImpl)
