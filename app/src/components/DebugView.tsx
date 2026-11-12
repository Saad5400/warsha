import { useEffect, useRef, useState, type ReactNode } from 'react'
import { debugStore, useDebugState, type WatchResult } from '../debug/store'
import type { DebugStopReason, DebugValue } from '../runtime/debug'
import { splitPath } from '../fs/project'
import { Button } from './ui/Button'
import { IconChevronRight, IconClose, IconPlus } from './ui/Icons'
import { IconBreakpointsToggle, IconCloseAll, IconDebugAlt } from './ui/DebugIcons'
import { formatKeys } from '../ui/keys'
import { COPY } from '../copy'

/**
 * The sidebar's Run and Debug view — VS Code's, section for section:
 * VARIABLES (scopes of the selected frame, lazily expandable), WATCH
 * (expressions re-evaluated at every stop), CALL STACK (click a frame to
 * inspect it), BREAKPOINTS (enable/disable, remove, jump). Before a session
 * it leads with the one "Run and Debug" button and how to set a breakpoint.
 */

const HEADER = 'flex h-bar-side shrink-0 items-center gap-2 ps-3 pe-2 shadow-[inset_0_-1px_0_0_var(--border-subtle)]'
const PANEL_LABEL = 'panel-label text-[12px] leading-none font-semibold text-text-1'
const ROW =
  'group/row flex w-full items-center gap-1 pe-2 h-row-tree text-row leading-none text-start cursor-pointer ' +
  'hover:bg-(--list-hover-bg) focus-visible:outline-offset-[-1px]'
const ACTION =
  'relative grid size-6 flex-none place-items-center rounded-sm text-text-2 cursor-pointer ' +
  'hover:bg-(--list-hover-bg) hover:text-text-1 after:absolute after:-inset-1 after:content-[""]'

export interface DebugViewProps {
  /** Whether the selected entry can run under the debugger. */
  canDebug: boolean
  /** The file Start Debugging will run. */
  entry: string | null
  busy: boolean
  onStartDebugging(): void
  /** Open `path` with `line` revealed (breakpoint rows, stack frames). */
  onReveal(path: string, line: number): void
  /** Text of a line, for the breakpoint row's preview. */
  lineText(path: string, line: number): string
  /** How a path reads in a row — a file's name, or a notebook cell's "nb.ipynb [3]". Defaults to the file name. */
  nameOf?(path: string): string
}

export function DebugView({ canDebug, entry, busy, onStartDebugging, onReveal, lineText, nameOf = (p) => splitPath(p).name }: DebugViewProps) {
  const s = useDebugState()
  const active = s.phase !== 'inactive'

  return (
    <div className="flex h-full min-h-0 select-none flex-col bg-surface-2" data-debug-phase={s.phase}>
      <div className={HEADER}>
        <span className={PANEL_LABEL}>{COPY.debugTitle}</span>
      </div>
      <div className="scroller min-h-0 flex-1 pb-2">
        {active ? null : (
          <div className="flex flex-col gap-3 px-3 py-3">
            <Button
              variant="primary"
              className="w-full justify-center"
              disabled={!canDebug || busy}
              onClick={onStartDebugging}
              title={`${COPY.debugStart} (${formatKeys('F5')})`}
            >
              <IconDebugAlt size={16} />
              {COPY.debugTitle}
            </Button>
            <p className="text-micro leading-snug text-text-3">
              {canDebug ? COPY.debugIdleHint : entry ? COPY.debugUnsupported(splitPath(entry).name) : COPY.debugNoEntry}
            </p>
          </div>
        )}

        {active ? (
          <>
            <Section title={COPY.debugVariables} id="variables">
              <VariablesPane />
            </Section>
            <WatchSection />
            <Section title={COPY.debugCallStack} id="stack" badge={s.phase === 'paused' ? reasonLabel(s.stopped?.reason) : COPY.debugRunning}>
              <CallStack onReveal={onReveal} nameOf={nameOf} />
            </Section>
          </>
        ) : (
          <WatchSection />
        )}

        <Section
          title={COPY.debugBreakpoints}
          id="breakpoints"
          actions={
            s.breakpoints.length ? (
              <>
                <button
                  type="button"
                  className={ACTION}
                  aria-label={s.breakpoints.some((b) => b.enabled) ? COPY.debugDisableAll : COPY.debugEnableAll}
                  title={s.breakpoints.some((b) => b.enabled) ? COPY.debugDisableAll : COPY.debugEnableAll}
                  onClick={() => debugStore.setAllEnabled(!s.breakpoints.some((b) => b.enabled))}
                >
                  <IconBreakpointsToggle />
                </button>
                <button type="button" className={ACTION} aria-label={COPY.debugRemoveAllBreakpoints} title={COPY.debugRemoveAllBreakpoints} onClick={() => debugStore.removeAll()}>
                  <IconCloseAll />
                </button>
              </>
            ) : null
          }
        >
          {s.breakpoints.length === 0 ? (
            <Empty>{COPY.debugNoBreakpoints}</Empty>
          ) : (
            <ul role="list">
              {s.breakpoints.map((b) => {
                const hit = s.phase === 'paused' && s.stopped?.frames[0]?.path === b.path && s.stopped.frames[0].line === b.line
                return (
                  <li key={`${b.path}:${b.line}`}>
                    <div
                      className={ROW + ' ps-3' + (hit ? ' bg-(--debug-stop-line)' : '')}
                      role="button"
                      tabIndex={0}
                      data-bp={`${b.path}:${b.line}`}
                      aria-label={`${b.path}:${b.line}`}
                      onClick={() => onReveal(b.path, b.line)}
                      onKeyDown={(e) => e.key === 'Enter' && onReveal(b.path, b.line)}
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 flex-none accent-(--debug-bp) cursor-pointer"
                        checked={b.enabled}
                        aria-label={COPY.debugBreakpointEnabled(nameOf(b.path), b.line)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => debugStore.setEnabled(b.path, b.line, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-text-1">{nameOf(b.path)}</span>{' '}
                        <span className="font-mono text-[12px] text-text-3">{lineText(b.path, b.line).trim()}</span>
                      </span>
                      <span className="flex-none rounded-sm px-1 text-[11px] tabular-nums text-text-2 desk:group-hover/row:hidden">{b.line}</span>
                      <button
                        type="button"
                        className={ACTION + ' desk:hidden desk:group-hover/row:grid desk:group-focus-within/row:grid'}
                        aria-label={COPY.debugRemoveBreakpoint}
                        title={COPY.debugRemoveBreakpoint}
                        onClick={(e) => {
                          e.stopPropagation()
                          debugStore.removeBreakpoint(b.path, b.line)
                        }}
                      >
                        <IconClose size={14} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}

function reasonLabel(r: DebugStopReason | undefined): string {
  switch (r) {
    case 'breakpoint':
      return COPY.debugPausedBreakpoint
    case 'step':
      return COPY.debugPausedStep
    case 'entry':
      return COPY.debugPausedEntry
    case 'exception':
      return COPY.debugPausedException
    default:
      return COPY.debugPaused
  }
}

// ---- sections ----

const collapsed = new Set<string>()

function Section({
  title,
  id,
  badge,
  actions,
  children,
}: {
  title: string
  id: string
  badge?: string
  actions?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => !collapsed.has(id))
  return (
    <section aria-label={title} className="group/sec" data-section={id}>
      <div className="flex h-row-tree items-center pe-1 shadow-[inset_0_-1px_0_0_var(--border-subtle)]">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 self-stretch ps-1 text-start cursor-pointer"
          onClick={() => {
            if (open) collapsed.add(id)
            else collapsed.delete(id)
            setOpen(!open)
          }}
        >
          <IconChevronRight size={16} className={'flex-none text-text-2 transition-transform rtl:-scale-x-100 ' + (open ? 'rotate-90 rtl:-rotate-90' : '')} />
          <span className="truncate text-[11px] font-bold uppercase tracking-wide text-text-1">{title}</span>
          {badge ? <span className="ms-auto truncate ps-2 text-[11px] uppercase tracking-wide text-text-3">{badge}</span> : null}
        </button>
        {actions ? <div className="flex flex-none items-center gap-0.5 desk:opacity-0 desk:group-hover/sec:opacity-100 desk:focus-within:opacity-100">{actions}</div> : null}
      </div>
      {open ? <div className="py-0.5">{children}</div> : null}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-1.5 text-micro leading-snug text-text-3">{children}</p>
}

// ---- variables ----

function VariablesPane() {
  const s = useDebugState()
  const frame = s.stopped?.frames[s.frameIndex]
  if (s.phase !== 'paused' || !frame) return <Empty>{COPY.debugVarsWhenPaused}</Empty>
  if (!frame.scopes.length) return <Empty>{COPY.debugNoVariables}</Empty>
  return (
    <div role="tree" aria-label={COPY.debugVariables}>
      {frame.scopes.map((scope) => (
        <ScopeNode key={scope.name} name={scope.name} vars={scope.variables} startOpen={!scope.expensive} stopSeq={s.stopSeq} />
      ))}
    </div>
  )
}

/** Expansion survives stepping (VS Code keeps your tree open), keyed by the path of names. */
const expanded = new Set<string>()

function ScopeNode({ name, vars, startOpen, stopSeq }: { name: string; vars: DebugValue[]; startOpen: boolean; stopSeq: number }) {
  const key = `scope:${name}`
  const [open, setOpen] = useState(() => (expanded.has(key) ? true : expanded.has('!' + key) ? false : startOpen))
  const toggle = () => {
    const next = !open
    expanded.delete(key)
    expanded.delete('!' + key)
    expanded.add(next ? key : '!' + key)
    setOpen(next)
  }
  return (
    <div role="treeitem" aria-expanded={open}>
      <div className={ROW} style={{ paddingInlineStart: 4 }} onClick={toggle}>
        <IconChevronRight size={16} className={'flex-none text-text-2 rtl:-scale-x-100 ' + (open ? 'rotate-90 rtl:-rotate-90' : '')} />
        <span className="truncate text-text-1">{name}</span>
      </div>
      {open ? (
        vars.length ? (
          <div role="group">
            {vars.map((v) => (
              <ValueNode key={v.name} value={v} depth={1} path={`${key}/${v.name}`} stopSeq={stopSeq} />
            ))}
          </div>
        ) : (
          <div className="ps-9 py-0.5 text-micro italic text-text-3">{COPY.debugNoVariables}</div>
        )
      ) : null}
    </div>
  )
}

export function ValueNode({
  value,
  depth,
  path,
  stopSeq,
  label,
  actions,
  onDoubleClick,
}: {
  value: DebugValue
  depth: number
  path: string
  stopSeq: number
  /** Override for the name column (watch rows show the expression). */
  label?: string
  actions?: ReactNode
  onDoubleClick?(): void
}) {
  const expandable = !!(value.ref || value.children?.length)
  const [open, setOpen] = useState(() => expanded.has(path))
  const [kids, setKids] = useState<DebugValue[] | null>(null)

  useEffect(() => {
    if (!open || !expandable) return
    let live = true
    setKids(null)
    void debugStore.childrenOf(value).then((c) => live && setKids(c))
    return () => {
      live = false
    }
    // Re-fetch at every stop: refs are only valid for the stop they came from.
  }, [open, expandable, stopSeq, value])

  const toggle = () => {
    if (!expandable) return
    if (open) expanded.delete(path)
    else expanded.add(path)
    setOpen(!open)
  }

  return (
    <div role="treeitem" aria-expanded={expandable ? open : undefined}>
      <div
        className={ROW + ' font-mono text-[12px]'}
        style={{ paddingInlineStart: 4 + depth * 12 }}
        onClick={toggle}
        onDoubleClick={onDoubleClick}
        title={value.type ? `${value.type}` : undefined}
      >
        <span className="grid size-4 flex-none place-items-center text-text-2">
          {expandable ? <IconChevronRight size={16} className={'rtl:-scale-x-100 ' + (open ? 'rotate-90 rtl:-rotate-90' : '')} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-(--debug-name)">{label ?? value.name}</span>
          <span className="text-text-3">: </span>
          <ValueText text={value.value} />
        </span>
        {actions}
      </div>
      {open && expandable ? (
        <div role="group">
          {kids === null ? (
            <div className="py-0.5 text-micro text-text-3" style={{ paddingInlineStart: 4 + (depth + 1) * 12 + 16 }}>
              …
            </div>
          ) : kids.length === 0 ? (
            <div className="py-0.5 text-micro italic text-text-3" style={{ paddingInlineStart: 4 + (depth + 1) * 12 + 16 }}>
              {COPY.debugEmptyValue}
            </div>
          ) : (
            kids.map((k, i) => <ValueNode key={`${k.name}#${i}`} value={k} depth={depth + 1} path={`${path}/${k.name}`} stopSeq={stopSeq} />)
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Dark+ value colours: strings orange, numbers green, keywords blue — syntax colour, not chrome. */
function ValueText({ text }: { text: string }) {
  const cls = /^(["'`]|[bfru]?["'])/.test(text)
    ? 'text-(--debug-value-string)'
    : /^-?(\d|\.\d|0x|Infinity|NaN)/.test(text)
      ? 'text-(--debug-value-number)'
      : /^(true|false|null|undefined|None|True|False|nil|NULL)\b/.test(text)
        ? 'text-(--debug-value-keyword)'
        : 'text-text-1'
  return <span className={cls}>{text}</span>
}

// ---- watch ----

function WatchSection() {
  const s = useDebugState()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  return (
    <Section
      title={COPY.debugWatch}
      id="watch"
      actions={
        <>
          <button type="button" className={ACTION} aria-label={COPY.debugAddWatch} title={COPY.debugAddWatch} onClick={() => setAdding(true)}>
            <IconPlus size={16} />
          </button>
          {s.watches.length ? (
            <button type="button" className={ACTION} aria-label={COPY.debugRemoveAllWatches} title={COPY.debugRemoveAllWatches} onClick={() => debugStore.removeAllWatches()}>
              <IconCloseAll />
            </button>
          ) : null}
        </>
      }
    >
      {s.watches.length === 0 && !adding ? <Empty>{COPY.debugNoWatches}</Empty> : null}
      {s.watches.map((w) =>
        editing === w.id ? (
          <WatchInput
            key={w.id}
            initial={w.expr}
            onDone={(text) => {
              setEditing(null)
              if (text !== null) debugStore.editWatch(w.id, text)
            }}
          />
        ) : (
          <WatchRow
            key={w.id}
            expr={w.expr}
            result={s.phase === 'paused' ? s.watchResults[w.id] : undefined}
            stopSeq={s.stopSeq}
            onEdit={() => setEditing(w.id)}
            onRemove={() => debugStore.removeWatch(w.id)}
          />
        ),
      )}
      {adding ? (
        <WatchInput
          initial=""
          onDone={(text) => {
            setAdding(false)
            if (text) debugStore.addWatch(text)
          }}
        />
      ) : null}
    </Section>
  )
}

function WatchRow({
  expr,
  result,
  stopSeq,
  onEdit,
  onRemove,
}: {
  expr: string
  result: WatchResult | undefined
  stopSeq: number
  onEdit(): void
  onRemove(): void
}) {
  const remove = (
    <button
      type="button"
      className={ACTION + ' desk:hidden desk:group-hover/row:grid'}
      aria-label={COPY.debugRemoveWatch}
      title={COPY.debugRemoveWatch}
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
    >
      <IconClose size={14} />
    </button>
  )
  if (result && 'value' in result)
    return <ValueNode value={result.value} label={expr} depth={0} path={`watch:${expr}`} stopSeq={stopSeq} actions={remove} onDoubleClick={onEdit} />
  return (
    <div className={ROW + ' font-mono text-[12px]'} style={{ paddingInlineStart: 4 }} onDoubleClick={onEdit}>
      <span className="size-4 flex-none" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-(--debug-name)">{expr}</span>
        <span className="text-text-3">: </span>
        <span className="italic text-text-3">{result && 'error' in result ? result.error : COPY.debugWatchUnavailable}</span>
      </span>
      {remove}
    </div>
  )
}

function WatchInput({ initial, onDone }: { initial: string; onDone(text: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => ref.current?.focus(), [])
  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    onDone(text)
  }
  return (
    <div className="px-2 py-0.5">
      <input
        ref={ref}
        defaultValue={initial}
        placeholder={COPY.debugWatchPlaceholder}
        aria-label={COPY.debugWatchPlaceholder}
        spellCheck={false}
        className="h-6 w-full rounded-sm border border-(--focus-ring) bg-surface-1 px-1.5 font-mono text-[12px] text-text-1 outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(e.currentTarget.value)
          else if (e.key === 'Escape') finish(null)
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
      />
    </div>
  )
}

// ---- call stack ----

function CallStack({ onReveal, nameOf }: { onReveal(path: string, line: number): void; nameOf(path: string): string }) {
  const s = useDebugState()
  if (s.phase !== 'paused' || !s.stopped) return <Empty>{COPY.debugStackWhenPaused}</Empty>
  return (
    <ul role="list">
      {s.stopped.description ? (
        <li className="px-3 py-1 font-mono text-[12px] leading-snug text-danger break-words">{s.stopped.description}</li>
      ) : null}
      {s.stopped.frames.map((f, i) => (
        <li key={i}>
          <div
            role="button"
            tabIndex={0}
            aria-current={i === s.frameIndex ? 'true' : undefined}
            className={ROW + ' ps-3 ' + (i === s.frameIndex ? 'bg-(--list-inactive-sel-bg)' : '')}
            onClick={() => {
              debugStore.selectFrame(i)
              onReveal(f.path, f.line)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                debugStore.selectFrame(i)
                onReveal(f.path, f.line)
              }
            }}
          >
            <span className="size-4 flex-none">
              {i === 0 ? (
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path d="M3 4.25h6.55a1 1 0 0 1 .7.29l3.22 3.08a.53.53 0 0 1 0 .76l-3.22 3.08a1 1 0 0 1-.7.29H3a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1Z" fill="var(--debug-stop)" />
                </svg>
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate text-text-1">{f.name}</span>
            <span className="flex-none truncate ps-2 text-[11px] text-text-3">
              {nameOf(f.path)}:{f.line}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
