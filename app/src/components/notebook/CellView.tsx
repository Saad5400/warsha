import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createCellEditor, type CellEditor, type RunMode } from '../../notebook/cellEditor'
import { cellPath, formTitle, outputsCollapsed, outputsExpanded, type NbCell } from '../../notebook/nbformat'
import { renderMarkdown } from '../../notebook/markdown'
import type { CellStatus } from '../../notebook/session'
import type { LoadProgress } from '../../runtime/types'
import { COPY } from '../../copy'
import { OutputView, SafeHtml } from './OutputView'
import { MD_PROSE, highlightPython, useMarkdownOptions, usePythonHighlight } from './markdownProse'
import { mountWhenNear } from '../../notebook/lazyMount'
import { IconWand, IconPlus, IconChevronDown, IconChevronUp, IconClose, IconCode, IconDuplicate, IconMore, IconPencil, IconPlay, IconStop, IconText, IconTrash, IconCheck } from '../ui/Icons'
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
  | 'toggleExpand'
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
  /** A run of several cells stopped before this one: its outputs are from an earlier run. */
  stale?: boolean
  waiting: boolean
  progress: LoadProgress | null
  fontSize: number
  readOnly: boolean
  /** Line numbers in code cells (off by default, as in Colab). */
  lineNumbers: boolean
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
  registerEditor(id: string, editor: LazyCellEditor | null): void
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

/** A cell's editor as the notebook sees it: built on demand (notebook/lazyMount.ts). */
export interface LazyCellEditor {
  /** The editor if it is built. */
  readonly current: CellEditor | null
  /** Build it now if it is not (synchronously), and return it. */
  mount(): CellEditor
}

/**
 * The cell's CodeMirror, created once per cell and kept in step with the model. Until
 * the cell nears the screen (or is clicked or focused) it shows its code as highlighted
 * text with the editor's metrics, so a long notebook opens without building every editor.
 */
function CellEditorHost(props: {
  cell: NbCell
  notebookPath: string
  fontSize: number
  readOnly: boolean
  lineNumbers: boolean
  desk: boolean
  /** Build the editor at once (the cell is being edited). */
  eager: boolean
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
  /** Where the code's text starts, px from the editor's left edge — outputs line up with it. */
  onTextEdge(px: number): void
  register(editor: LazyCellEditor | null): void
}) {
  const host = useRef<HTMLDivElement>(null)
  const staticView = useRef<HTMLPreElement>(null)
  const editor = useRef<CellEditor | null>(null)
  const [built, setBuilt] = useState(false)
  // Callbacks through a ref: the editor is built once and must always reach the latest props.
  const live = useRef(props)
  live.current = props
  const mount = useRef<() => CellEditor>(null!)
  mount.current = () => {
    if (editor.current) return editor.current
    const p = live.current
    // The static view leaves now, not on the next render: a click is mapped onto the editor below.
    if (staticView.current) staticView.current.style.display = 'none'
    const ed = createCellEditor(host.current!, {
      doc: p.cell.source,
      type: p.cell.type,
      path: cellPath(p.notebookPath, p.cell.id),
      fontSize: p.fontSize,
      readOnly: p.readOnly,
      lineNumbers: p.lineNumbers,
      placeholder: p.placeholder,
      context: () => live.current.context(),
      projectWords: () => live.current.projectWords(),
      onChange: (t) => live.current.onChange(t),
      onRun: (m) => live.current.onRun(m),
      onEscape: () => live.current.onEscape(),
      onLeave: (d) => live.current.onLeave(d),
      onFocus: () => live.current.onFocus(),
      onSave: () => live.current.onSave(),
      onFormat: () => live.current.onFormat(),
      onTextEdge: (px) => live.current.onTextEdge(px),
    })
    editor.current = ed
    setBuilt(true)
    return ed
  }
  useEffect(() => {
    const el = host.current
    if (!el) return
    live.current.register({
      get current() {
        return editor.current
      },
      mount: () => mount.current(),
    })
    const cancel = live.current.eager ? (mount.current(), () => {}) : mountWhenNear(el.parentElement ?? el, el.closest('.notebook-scroller'), () => mount.current())
    return () => {
      cancel()
      live.current.register(null)
      editor.current?.destroy()
      editor.current = null
      setBuilt(false)
      if (staticView.current) staticView.current.style.display = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per cell id and type
  }, [props.cell.id, props.cell.type, props.notebookPath])
  useEffect(() => {
    if (props.eager) mount.current()
  }, [props.eager])
  useEffect(() => {
    editor.current?.setDoc(props.cell.source)
  }, [props.cell.source])
  useEffect(() => {
    editor.current?.setFontSize(props.fontSize)
  }, [props.fontSize])
  useEffect(() => {
    editor.current?.setReadOnly(props.readOnly)
  }, [props.readOnly])
  useEffect(() => {
    editor.current?.setLineNumbers(props.lineNumbers)
  }, [props.lineNumbers])
  return (
    <div className="min-w-0">
      {built ? null : (
        <StaticCode
          ref={staticView}
          source={props.cell.source}
          code={props.cell.type === 'code'}
          placeholder={props.placeholder}
          fontSize={props.fontSize}
          desk={props.desk}
          lineNumbers={props.lineNumbers}
          onPointerDown={(e) => {
            // Build the editor under the pointer and put the caret where the student clicked.
            if (e.button !== 0) return
            e.preventDefault()
            const { clientX: x, clientY: y } = e
            const ed = mount.current()
            const pos = ed.view.posAtCoords({ x, y }) ?? ed.view.state.doc.length
            ed.view.dispatch({ selection: { anchor: pos } })
            ed.view.focus()
          }}
        />
      )}
      <div ref={host} className="min-w-0" />
    </div>
  )
}

/**
 * A cell's code before its editor is built: the same text, colours and metrics as the
 * CodeMirror that replaces it (cellEditor.ts cellTheme, setup.ts codeFontTheme), so the
 * swap does not move anything.
 */
function StaticCode({
  ref,
  source,
  code,
  placeholder,
  fontSize,
  desk,
  lineNumbers,
  onPointerDown,
}: {
  ref: React.Ref<HTMLPreElement>
  source: string
  code: boolean
  placeholder: string
  fontSize: number
  desk: boolean
  lineNumbers: boolean
  onPointerDown(e: React.PointerEvent): void
}) {
  const colours = usePythonHighlight()
  const html = useMemo(() => (code && colours ? highlightPython(source) : null), [code, colours, source])
  const lines = source.split('\n').length
  // Line numbers: the gutter is the digits plus 18px of padding (cellTheme), beside the desk's 18px margin.
  const gutter = lineNumbers && code ? `calc(${Math.max(2, String(lines).length)}ch + 18px)` : '0px'
  const edge = desk && code ? 28 : 10
  const wrap = !desk || !code
  return (
    <pre
      ref={ref}
      data-static-code=""
      aria-hidden="true"
      onPointerDown={onPointerDown}
      className={
        'm-0 cursor-text font-code text-text-1 [direction:ltr] text-left ' +
        (wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'overflow-x-hidden whitespace-pre')
      }
      style={{
        fontSize,
        lineHeight: `${Math.round(fontSize * (desk ? 1.35 : 1.6))}px`,
        padding: `6px 2px 6px calc(${edge}px + ${gutter})`,
      }}
    >
      {source ? (
        html !== null ? (
          // Escaped text in syntaxColors spans (markdownProse.highlightPython).
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{source}</code>
        )
      ) : (
        <span className="text-text-3">{placeholder}</span>
      )}
    </pre>
  )
}

/** docs/design/NOTEBOOK.md §3. Desk 28px, touch 32px; one column with the count. */
const RUN_BTN =
  'relative grid place-items-center size-[32px] rounded-full border cursor-pointer touch-manipulation ' +
  'after:absolute after:-inset-1.5 after:content-[""] ' +
  'transition-[background-color,color,border-color,opacity] duration-(--dur-fast) ease-standard ' +
  'border-border-control text-text-1 bg-surface-3 hover:bg-surface-4 active:bg-surface-4 ' +
  'data-[state=error]:border-danger data-[state=error]:text-danger ' +
  'desk:size-[28px] desk:[&>svg]:size-3.5'

/** Desk: idle buttons give their place to the count until the cell is hovered or selected (Colab). */
const RUN_BTN_RESTING = 'desk:opacity-0 desk:group-hover/cell:opacity-100 desk:group-data-[selected]/cell:opacity-100 desk:group-has-[.cm-focused]/cell:opacity-100 desk:focus-visible:opacity-100'

function RunButton({ status, onRun, onInterrupt }: { status: CellStatus | undefined; onRun(): void; onInterrupt(): void }) {
  const state = status?.state
  if (state === 'running') {
    return (
      <button type="button" aria-label={COPY.nbStopCell} title={COPY.nbStopCell} data-run="" data-state="running" className={RUN_BTN + ' !border-transparent'} onClick={onInterrupt}>
        <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-text-1 border-t-transparent animate-spinner motion-reduce:animate-none" />
        <IconStop size={12} />
      </button>
    )
  }
  if (state === 'queued') {
    return (
      <button type="button" aria-label={COPY.nbCellQueued} title={COPY.nbCellQueued} data-run="" data-state="queued" className={RUN_BTN + ' border-dashed bg-transparent text-text-3'} onClick={onInterrupt}>
        <span aria-hidden="true" className="flex gap-[3px]">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-[3px] rounded-full bg-current" />
          ))}
        </span>
      </button>
    )
  }
  const ran = status?.ms !== undefined ? ` · ${COPY.nbCellRanIn(fmtMs(status.ms))}` : ''
  return (
    <button type="button" aria-label={COPY.nbRunCell} title={`${COPY.nbRunCell} (Shift+Enter)${ran}`} data-run="" data-state={state ?? 'idle'} className={RUN_BTN + ' ' + RUN_BTN_RESTING} onClick={onRun}>
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

/** Run column widths (NOTEBOOK.md §1) and where the code's text starts with line numbers off. */
const RUN_COL = { desk: 44, touch: 40 }
// Desk: the 18px breakpoint margin + 4px content padding (cellEditor.ts) + 6px line padding;
// touch: no margin, 4px + 6px. notebook-check.mjs asserts these against the real editor.
export const TEXT_EDGE = { desk: 28, touch: 10 }
/** The code's first-line metrics (setup.ts codeFontTheme): the run button centres on that line. */
const firstLineCentre = (fontSize: number, desk: boolean) => 6 + Math.round(fontSize * (desk ? 1.35 : 1.6)) / 2

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

/**
 * NOTEBOOK.md §4: a long output scrolls inside a capped area (nbformat `scrolled`,
 * Colab's default), faded where it is cut. While the cell runs it follows the newest
 * line, unless the student has scrolled up to read.
 */
function OutputScroll({ capped, running, stale, onOverflow, children }: { capped: boolean; running: boolean; stale: boolean; onOverflow(over: boolean): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const live = useRef({ running, capped, onOverflow })
  live.current = { running, capped, onOverflow }
  const [cut, setCut] = useState<{ above: boolean; below: boolean }>({ above: false, below: false })
  const sync = useRef(() => {})
  sync.current = () => {
    const el = box.current
    if (!el) return
    if (live.current.running && stuck.current) el.scrollTop = el.scrollHeight
    const over = live.current.capped && el.scrollHeight > el.clientHeight + 1
    const above = over && el.scrollTop > 1
    const below = over && el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setCut((c) => (c.above === above && c.below === below ? c : { above, below }))
    live.current.onOverflow(over)
  }
  // A new run follows the output again.
  useEffect(() => {
    if (running) stuck.current = true
  }, [running])
  useEffect(() => {
    const ro = new ResizeObserver(() => sync.current())
    if (inner.current) ro.observe(inner.current)
    if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  useEffect(() => sync.current(), [capped, running, children])
  const edge = (more: boolean) => (more ? 'transparent' : '#000')
  const mask = cut.above || cut.below ? `linear-gradient(to bottom, ${edge(cut.above)}, #000 32px, #000 calc(100% - 32px), ${edge(cut.below)})` : undefined
  return (
    <div
      ref={box}
      data-output-scroll={capped ? 'capped' : 'expanded'}
      className={capped ? 'max-h-[60vh] overflow-y-auto overscroll-y-auto desk:max-h-[560px]' : ''}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      onScroll={(e) => {
        const el = e.currentTarget
        stuck.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
        sync.current()
      }}
    >
      <div ref={inner} className={'flex min-w-0 flex-col gap-1 pe-2' + (stale ? ' opacity-55' : '')}>
        {children}
      </div>
    </div>
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
  const [outMenu, setOutMenu] = useState<MenuAnchor | null>(null)
  const attachments = (cell.raw.attachments ?? undefined) as Record<string, Record<string, string>> | undefined
  const mdOpts = useMarkdownOptions(attachments)
  const collapsed = outputsCollapsed(cell)
  const expanded = outputsExpanded(cell)
  // Whether the capped output is cut (so Expand means something).
  const [overflows, setOverflows] = useState(false)
  const state = p.status?.state
  // Colab form cells (#@title): the title, with the code folded away when Colab would hide it.
  const form = useMemo(() => formTitle(cell), [cell])
  const [codeShown, setCodeShown] = useState(false)
  const codeHidden = !!form?.hideCode && !codeShown
  const showEditor = (code && !codeHidden) || p.editingText || cell.type === 'raw'
  const rendered = useMemo(() => (showEditor ? '' : renderMarkdown(cell.source, mdOpts)), [showEditor, cell.source, mdOpts])
  // Outputs start where the code's text starts — measured from the editor (line numbers move it).
  const [measuredEdge, setTextEdge] = useState<number | null>(null)
  const textEdge = measuredEdge ?? (p.desk ? TEXT_EDGE.desk : TEXT_EDGE.touch)
  const btn = p.desk ? 28 : 32
  // The run button's centre sits level with the centre of the code's first line.
  const runTop = Math.max(0, Math.round(firstLineCentre(p.fontSize, p.desk) - btn / 2))

  const act = (a: CellAction) => () => p.onAction(cell.id, a)
  const anchorOf = (e: React.MouseEvent<HTMLButtonElement>): MenuAnchor => {
    const r = e.currentTarget.getBoundingClientRect()
    const rtl = document.documentElement.dir === 'rtl'
    return { x: rtl ? r.left : r.right, y: r.bottom, fromRight: !rtl }
  }
  const expandItem: MenuItem[] =
    !collapsed && (expanded || overflows)
      ? [{ label: expanded ? COPY.nbCollapseOutput : COPY.nbExpandOutput, icon: expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />, onSelect: act('toggleExpand') }]
      : []
  const menuItems: MenuItem[] = [
    ...(code
      ? [
          { label: COPY.nbDebugCell, icon: <IconDebugAlt size={18} />, onSelect: act('debug') },
          { label: COPY.nbFormatCell, icon: <IconWand size={18} />, hint: 'Shift+Alt+F', onSelect: act('format') },
          { label: COPY.nbRunAbove, onSelect: act('runAbove'), startsGroup: true },
          { label: COPY.nbRunBelow, onSelect: act('runBelow') },
          { label: COPY.nbClearOutput, onSelect: act('clearOutput'), startsGroup: true },
          { label: collapsed ? COPY.nbShowOutput : COPY.nbHideOutput, onSelect: act('toggleOutput') },
          ...expandItem.map(({ icon: _icon, ...item }) => item),
          { label: COPY.nbToText, icon: <IconText size={18} />, onSelect: act('toText'), startsGroup: true },
        ]
      : [{ label: COPY.nbToCode, icon: <IconCode size={18} />, onSelect: act('toCode') }]),
    { label: COPY.nbDuplicate, icon: <IconDuplicate size={18} />, onSelect: act('duplicate') },
    { label: COPY.nbDelete, icon: <IconTrash size={18} />, onSelect: act('delete'), danger: true },
  ]
  const outputItems: MenuItem[] = [
    { label: COPY.nbClearOutput, icon: <IconClose size={18} />, onSelect: act('clearOutput') },
    { label: collapsed ? COPY.nbShowOutput : COPY.nbHideOutput, icon: <IconChevronDown size={18} />, onSelect: act('toggleOutput') },
    ...expandItem,
  ]
  const hasOutput = code && (cell.outputs.length > 0 || p.waiting)

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
        if (!code && !p.editingText && !p.readOnly) p.onAction(cell.id, 'edit')
      }}
      // NOTEBOOK.md §1–2: one bordered box; the rail is inside it; state is border + rail, never fill alone.
      className={
        'nb-cell group/cell relative grid grid-cols-[40px_minmax(0,1fr)] desk:grid-cols-[44px_minmax(0,1fr)] ' +
        'rounded-lg border border-transparent p-1 ' +
        'transition-[border-color,background-color] duration-(--dur-fast) ease-standard ' +
        // The keyboard focus ring stays (never removed), drawn on the border in the selection grey: the rail and border already say "selected".
        'focus-visible:outline-offset-[-1px] focus-visible:outline-(--border-control) ' +
        'desk:hover:border-border-subtle ' +
        'data-[selected]:border-border-subtle data-[selected]:bg-surface-2 ' +
        'has-[.cm-focused]:border-border-control has-[.cm-focused]:bg-surface-2 ' +
        'before:pointer-events-none before:absolute before:inset-y-1.5 before:start-0.5 before:w-0.5 before:rounded-full before:content-[""] before:bg-transparent ' +
        'data-[selected]:before:bg-text-3 has-[.cm-focused]:before:bg-info'
      }
    >
      {/* Run column: the run button and, in one column with it, the execution count. */}
      <div data-run-col="" className="relative flex flex-col items-center gap-1" style={{ paddingTop: runTop }}>
        {code && !p.readOnly ? <RunButton status={p.status} onRun={() => p.onRun(cell.id, 'run')} onInterrupt={p.onInterrupt} /> : null}
        {code ? (
          <span
            data-count=""
            style={p.desk ? { top: runTop, height: btn } : undefined}
            className={
              'font-code text-[11px] leading-none tabular-nums [direction:ltr] ' +
              (state === 'error' ? 'text-danger ' : 'text-text-3 ') +
              // Desk: in the button's place while it rests (§3); touch: under it.
              'desk:pointer-events-none desk:absolute desk:inset-x-0 desk:flex desk:items-center desk:justify-center ' +
              'transition-opacity duration-(--dur-fast) ' +
              (state === 'running' || state === 'queued' || p.readOnly
                ? 'desk:hidden'
                : 'desk:group-hover/cell:opacity-0 desk:group-data-[selected]/cell:opacity-0 desk:group-has-[.cm-focused]/cell:opacity-0')
            }
          >
            [{state === 'running' || state === 'queued' ? '*' : (cell.executionCount ?? ' ')}]
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        {menu ? <Menu anchor={menu} items={menuItems} label={COPY.nbCellActions} onClose={() => setMenu(null)} /> : null}

        {form ? (
          // A form cell's title, in the code's first-line metrics so the run button stays level with it.
          <div
            data-form-title=""
            className="flex min-w-0 items-center gap-2 pe-1"
            style={{ paddingTop: 6, paddingBottom: 6, paddingInlineStart: textEdge, minHeight: Math.round(p.fontSize * (p.desk ? 1.35 : 1.6)) + 12 }}
            onDoubleClick={() => setCodeShown(true)}
          >
            <span dir="auto" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-text-1">
              {form.title}
            </span>
            {form.hideCode ? (
              <button type="button" onClick={() => setCodeShown((v) => !v)} className="flex-none rounded-sm px-1.5 text-meta text-text-3 hover:text-text-1 cursor-pointer">
                {codeShown ? COPY.nbHideCode : COPY.nbShowCode}
              </button>
            ) : null}
          </div>
        ) : null}

        {!showEditor && code ? null : showEditor ? (
          // The code box: a tint, no border (the cell's border is the only frame), no clipping
          // (the completion popup and docs card hang outside it).
          <div data-code-box="" className="min-w-0 rounded-md bg-surface-3">
            <CellEditorHost
              cell={cell}
              notebookPath={p.notebookPath}
              fontSize={p.fontSize}
              readOnly={p.readOnly}
              lineNumbers={p.lineNumbers}
              desk={p.desk}
              eager={!code}
              context={p.context}
              projectWords={p.projectWords}
              placeholder={code ? (p.desk ? COPY.nbCodePlaceholder : COPY.nbCodePlaceholderTouch) : p.desk ? COPY.nbTextPlaceholder : COPY.nbTextPlaceholderTouch}
              onChange={(t) => p.onChange(cell.id, t)}
              onRun={(m) => p.onRun(cell.id, m)}
              onEscape={() => p.onEscape(cell.id)}
              onLeave={(d) => p.onLeave(cell.id, d)}
              onFocus={() => p.onSelect(cell.id)}
              onSave={p.onSave}
              onFormat={act('format')}
              onTextEdge={setTextEdge}
              register={(e) => p.registerEditor(cell.id, e)}
            />
          </div>
        ) : cell.source.trim() ? (
          // Markup built from escaped text only (notebook/markdown.ts). Prose starts at the code's text edge.
          // Physical, symmetric padding: each block takes its own direction (dir=auto), so an English
          // paragraph in the Arabic UI must still start at the code's (left) text edge.
          <SafeHtml className={MD_PROSE + ' py-1.5 px-[10px] desk:px-[28px]'} html={rendered} />
        ) : (
          <p className="m-0 py-2 px-[10px] text-meta italic rtl:not-italic text-text-3 desk:px-[28px]">{p.desk ? COPY.nbEmptyText : COPY.nbEmptyTextTouch}</p>
        )}

        {/* Running: a sweep under the code, and what is downloading if anything is. */}
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
          <p className="m-0 mt-1 text-micro text-text-3 [direction:ltr] text-left" style={{ paddingLeft: textEdge }} aria-live="polite">
            {p.progress.message}
          </p>
        ) : null}

        {/* Outputs: LTR, starting at the code's text edge. */}
        {hasOutput ? (
          <div aria-label={COPY.nbOutputLabel} className="nb-outputs relative mt-1 min-w-0 [direction:ltr] text-left" style={{ paddingLeft: textEdge }}>
            {/* The output toolbar (§4): one button in the run column, level with the output's first line; desk only. */}
            {!p.readOnly ? (
              <button
                type="button"
                data-output-menu=""
                aria-label={COPY.nbOutputActions}
                title={COPY.nbOutputActions}
                className={
                  TOOL_BTN +
                  ' !absolute top-0 hidden desk:grid size-[24px] desk:size-[24px] ' +
                  'opacity-0 group-hover/cell:opacity-100 group-data-[selected]/cell:opacity-100 focus-visible:opacity-100'
                }
                // In the run column: that column is to the inline-start of the body, and outputs are LTR.
                style={document.documentElement.dir === 'rtl' ? { right: -(RUN_COL.desk + 24) / 2, left: 'auto' } : { left: -(RUN_COL.desk + 24) / 2 }}
                onClick={(e) => setOutMenu(anchorOf(e))}
              >
                <IconMore size={16} />
              </button>
            ) : null}
            {outMenu ? <Menu anchor={outMenu} items={outputItems} label={COPY.nbOutputActions} onClose={() => setOutMenu(null)} /> : null}
            {p.stale ? (
              // A run stopped above this cell: say whose output this is, and mute it.
              <p data-stale="" className="m-0 mb-1 text-micro text-text-3 [direction:inherit]">
                {COPY.nbNotRun}
              </p>
            ) : null}
            {collapsed ? (
              <button type="button" onClick={act('toggleOutput')} className="block rounded-sm py-1 text-start text-meta text-text-3 hover:text-text-1 cursor-pointer">
                {COPY.nbOutputsHidden(cell.outputs.length)}
              </button>
            ) : (
              <OutputScroll capped={!expanded} running={state === 'running'} stale={!!p.stale} onOverflow={setOverflows}>
                {cell.outputs.map((o, i) => (
                  <OutputView key={i} output={o} />
                ))}
                {p.waiting ? <StdinRow onSubmit={p.onStdin} /> : null}
              </OutputScroll>
            )}
          </div>
        ) : null}

        {/* The cell's toolbar (NOTEBOOK.md §6). Desk: in the gap ABOVE the cell, trailing side, its bottom
            on the cell's top edge — it never covers code, output or the border; the gap and the notebook's
            top padding are tall enough for it. Touch: a row under the selected cell, insert chips leading,
            actions trailing. */}
        <div
          role="toolbar"
          aria-label={COPY.nbCellActions}
          className={
            'z-(--z-raised) mt-1 items-center gap-0.5 ' +
            'desk:absolute desk:bottom-[calc(100%+1px)] desk:end-2 desk:mt-0 desk:gap-0 desk:rounded-md desk:border desk:border-border-subtle desk:bg-surface-3 desk:shadow-raised desk:[&>button]:size-[24px] ' +
            // The selected cell's only — never a second one under the mouse (QA).
            (p.readOnly || !p.selected ? 'hidden' : 'flex')
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
          <ToolButton label={COPY.nbCellActions} onClick={(e) => setMenu(anchorOf(e))}>
            <IconMore size={18} />
          </ToolButton>
        </div>
      </div>
    </div>
  )
}

export const CellView = memo(CellViewImpl)
