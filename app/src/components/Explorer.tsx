import { useEffect, useRef, useState } from 'react'
import type { Project, TreeNode } from '../fs/project'
import { FileBadge } from './FileBadge'
import { Button, IconButton } from './ui/Button'
import {
  IconChevronRight,
  IconChevronUp,
  IconFiles,
  IconFolderOpen,
  IconFolderPlus,
  IconMore,
  IconPlus,
} from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

export interface ExplorerProps {
  project: Project
  tree: TreeNode
  activePath: string | null
  onOpenFile(path: string): void
  /**
   * A `name` means the explorer already collected it inline, so the shell must
   * not open a prompt dialog on top. Omitting it keeps the dialog path, which
   * is still what the overflow menu on a narrow screen uses.
   */
  onNewFile(parentDir: string, name?: string): void
  onNewFolder(parentDir: string, name?: string): void
  onRename(path: string, isDir: boolean, name?: string): void
  onDelete(path: string, isDir: boolean): void
  /** Empty-project state offers the template picker (the welcome flow). */
  onUseTemplate?(): void
}

const LONG_PRESS_MS = 500

/** One visual row: a real node, the "empty folder" line, or a name being typed. */
type VisualRow =
  | { kind: 'node'; node: TreeNode; depth: number }
  | { kind: 'empty-dir'; key: string; depth: number; dir: string }
  | { kind: 'draft'; key: string; depth: number; dir: string; makes: 'file' | 'dir' }

/**
 * The file tree.
 *
 * Creating and renaming happen **inline**, in the row, not in a modal: you can
 * see where the file is going while you name it, and one tap fewer stands
 * between a student and their first line of code. The shell still owns the
 * filesystem call — the explorer only hands it a name — so validation, clashes
 * and toasts stay in one place.
 */
export function Explorer(props: ExplorerProps) {
  const { project, tree, activePath } = props
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [draft, setDraft] = useState<{ dir: string; makes: 'file' | 'dir' } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; node: TreeNode } | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const toggle = (path: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const expand = (path: string) =>
    setCollapsed((cur) => {
      if (!cur.has(path)) return cur
      const next = new Set(cur)
      next.delete(path)
      return next
    })

  const startDraft = (dir: string, makes: 'file' | 'dir') => {
    setRenaming(null)
    if (dir) expand(dir)
    setDraft({ dir, makes })
  }

  const commitDraft = (name: string) => {
    const d = draft
    setDraft(null)
    if (!d) return
    const next = name.trim()
    if (!next) return
    if (d.makes === 'file') props.onNewFile(d.dir, next)
    else props.onNewFolder(d.dir, next)
  }

  const commitRename = (node: TreeNode, name: string) => {
    setRenaming(null)
    const next = name.trim()
    if (!next || next === node.name) return
    props.onRename(node.path, node.kind === 'dir', next)
  }

  const rows: VisualRow[] = []
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      rows.push({ kind: 'node', node: child, depth })
      if (child.kind === 'dir' && !collapsed.has(child.path)) {
        walk(child, depth + 1)
        if (draft?.dir === child.path) {
          rows.push({ kind: 'draft', key: 'draft', depth: depth + 1, dir: child.path, makes: draft.makes })
        } else if (child.children.length === 0) {
          // Empty folders are real here (FsSnapshot carries them), so they get a
          // sentence rather than looking like a broken row (spec §7.5).
          rows.push({ kind: 'empty-dir', key: `${child.path}::empty`, depth: depth + 1, dir: child.path })
        }
      }
    }
  }
  walk(tree, 0)
  // A root-level draft goes to the top, where a long tree cannot hide it.
  if (draft && draft.dir === '') rows.unshift({ kind: 'draft', key: 'draft', depth: 0, dir: '', makes: draft.makes })

  const hasFolders = rows.some((r) => r.kind === 'node' && r.node.kind === 'dir')

  // Keep the explorer in step with the tab strip: selecting a tab elsewhere has
  // to bring its row into view, or the selection is highlighted off-screen.
  useEffect(() => {
    if (!activePath) return
    treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(activePath)}"]`)?.scrollIntoView({
      block: 'nearest',
    })
  }, [activePath])

  /** Arrow keys walk the visible rows, the way every file tree does. */
  const moveFocus = (from: HTMLElement, delta: number) => {
    const all = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])]
    const i = all.indexOf(from)
    if (i === -1) return
    all[Math.max(0, Math.min(all.length - 1, i + delta))]?.focus()
  }

  const menuItems = (node: TreeNode): MenuItem[] => {
    const isDir = node.kind === 'dir'
    return [
      ...(isDir
        ? [
            { label: 'New file…', icon: <IconPlus />, onSelect: () => startDraft(node.path, 'file') },
            { label: 'New folder…', icon: <IconFolderPlus />, onSelect: () => startDraft(node.path, 'dir') },
          ]
        : [{ label: 'Open', icon: <IconFiles />, onSelect: () => props.onOpenFile(node.path) }]),
      { label: 'Rename…', hint: 'F2', startsGroup: true, onSelect: () => setRenaming(node.path) },
      { label: 'Delete', danger: true, onSelect: () => props.onDelete(node.path, isDir) },
    ]
  }

  return (
    // select-none on the chrome: dragging across rows must not paint a text
    // selection. The editor and the console keep their text selectable.
    <div className="flex h-full min-h-0 select-none flex-col bg-surface-2">
      <div className="flex h-bar shrink-0 items-center gap-2 border-b border-border-subtle pl-3 pr-1">
        <span className="panel-label">Explorer</span>
        {/* gap-1 here would put two 44px targets 4px apart; §5.2 asks for ≥8px. */}
        <div className="ml-auto flex items-center gap-1">
          {hasFolders ? (
            <IconButton label="Collapse folders" onClick={() => setCollapsed(allFolders(tree))}>
              <IconChevronUp />
            </IconButton>
          ) : null}
          <IconButton label="New file" onClick={() => startDraft('', 'file')}>
            <IconPlus />
          </IconButton>
          <IconButton label="New folder" onClick={() => startDraft('', 'dir')}>
            <IconFolderPlus />
          </IconButton>
        </div>
      </div>

      <div ref={treeRef} className="scroller flex-1 py-1" role="tree" aria-label="Project files">
        {rows.length === 0 ? (
          <div className="empty">
            <IconFolderOpen size={32} className="empty__glyph" />
            <p className="empty__title">No files yet</p>
            <p className="empty__body">
              Create a file to start. A name ending in .py or .java is all Warsha needs to know how to run it.
            </p>
            <div className="flex w-full flex-col gap-2">
              <Button variant="primary" onClick={() => startDraft('', 'file')}>
                New file
              </Button>
              {props.onUseTemplate ? (
                <Button variant="ghost" onClick={props.onUseTemplate}>
                  Use a template
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === 'draft') {
              return (
                <div key={row.key} className="relative flex min-h-touch items-center gap-2 pr-1" style={rowPadding(row.depth)}>
                  <Guides depth={row.depth} />
                  <span aria-hidden="true" className="tree-row__chevron">
                    {row.makes === 'dir' ? <IconFolderPlus size={20} /> : <IconPlus size={20} />}
                  </span>
                  <NameInput
                    initial=""
                    placeholder={row.makes === 'dir' ? 'models' : 'main.py'}
                    label={row.makes === 'dir' ? 'New folder name' : 'New file name'}
                    onCommit={commitDraft}
                    onCancel={() => setDraft(null)}
                  />
                </div>
              )
            }
            if (row.kind === 'empty-dir') {
              return (
                <EmptyDirRow key={row.key} depth={row.depth} onNewFile={() => startDraft(row.dir, 'file')} />
              )
            }
            return (
              <Row
                key={row.node.path}
                node={row.node}
                depth={row.depth}
                open={row.node.kind === 'dir' && !collapsed.has(row.node.path)}
                active={row.node.kind === 'file' && activePath === row.node.path}
                dirty={project.isDirty(row.node.path)}
                renaming={renaming === row.node.path}
                onActivate={() => (row.node.kind === 'dir' ? toggle(row.node.path) : props.onOpenFile(row.node.path))}
                onStartRename={() => setRenaming(row.node.path)}
                onCommitRename={(name) => commitRename(row.node, name)}
                onCancelRename={() => setRenaming(null)}
                onDelete={() => props.onDelete(row.node.path, row.node.kind === 'dir')}
                onExpand={() => expand(row.node.path)}
                onCollapse={() => toggle(row.node.path)}
                onMoveFocus={moveFocus}
                onMenu={(anchor) => setMenu({ anchor, node: row.node })}
              />
            )
          })
        )}
      </div>

      {menu ? (
        <Menu
          anchor={menu.anchor}
          items={menuItems(menu.node)}
          label={`Actions for ${menu.node.name}`}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

/** Indent is 16px per level with a hairline guide, so depth reads at a glance. */
function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="tree-row__guide"
          style={{ left: `calc(var(--sp-3) + ${i} * var(--sp-4) + 9px)` }}
        />
      ))}
    </>
  )
}

const rowPadding = (depth: number) => ({ paddingLeft: `calc(var(--sp-3) + ${depth} * var(--sp-4))` })

function Row({
  node,
  depth,
  open,
  active,
  dirty,
  renaming,
  onActivate,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onExpand,
  onCollapse,
  onMoveFocus,
  onMenu,
}: {
  node: TreeNode
  depth: number
  open: boolean
  active: boolean
  dirty: boolean
  renaming: boolean
  onActivate(): void
  onStartRename(): void
  onCommitRename(name: string): void
  onCancelRename(): void
  onDelete(): void
  onExpand(): void
  onCollapse(): void
  onMoveFocus(from: HTMLElement, delta: number): void
  onMenu(anchor: MenuAnchor): void
}) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef({ x: 0, y: 0 })
  const isDir = node.kind === 'dir'

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
  }

  return (
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={isDir ? open : undefined}
      aria-level={depth + 1}
      tabIndex={0}
      // The open file is marked by a 2px accent rule on the leading edge plus
      // text-1 at weight 500, never by a fill change: adjacent surfaces are
      // ~1.1:1 apart and invisible on a phone. See `.tree-row` in index.css.
      data-state={active ? 'open' : undefined}
      data-path={node.path}
      title={node.path}
      className="tree-row"
      style={rowPadding(depth)}
      onClick={renaming ? undefined : onActivate}
      // Double-click renames, as it does in every desktop file tree. Touch gets
      // the same action from long-press and from the ⋯ menu.
      onDoubleClick={(e) => {
        e.preventDefault()
        if (!renaming) onStartRename()
      }}
      onKeyDown={(e) => {
        if (renaming) return
        const el = e.currentTarget
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          onMoveFocus(el, e.key === 'ArrowDown' ? 1 : -1)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          if (isDir && !open) onExpand()
          else onMoveFocus(el, 1)
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          if (isDir && open) onCollapse()
          else onMoveFocus(el, -1)
        } else if (e.key === 'F2') {
          e.preventDefault()
          onStartRename()
        } else if (e.key === 'Delete') {
          e.preventDefault()
          onDelete()
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY })
      }}
      onTouchStart={(e) => {
        const t = e.touches[0]
        start.current = { x: t.clientX, y: t.clientY }
        cancel()
        timer.current = window.setTimeout(() => onMenu({ x: start.current.x, y: start.current.y }), LONG_PRESS_MS)
      }}
      onTouchMove={(e) => {
        const t = e.touches[0]
        if (Math.abs(t.clientX - start.current.x) > 10 || Math.abs(t.clientY - start.current.y) > 10) cancel()
      }}
      onTouchEnd={cancel}
      onTouchCancel={cancel}
    >
      <Guides depth={depth} />

      {isDir ? (
        <IconChevronRight size={20} className="tree-row__chevron" />
      ) : (
        // Files keep the chevron column so their names line up with folder names.
        <span aria-hidden="true" className="size-5 shrink-0" />
      )}

      {/* A folder glyph as well as the chevron: the chevron says "there is more
          in here", the folder says "this is not a file". Open and closed states
          use the two shapes so a glance down the tree reads without the labels. */}
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-text-3">
        {isDir ? open ? <IconFolderOpen size={20} /> : <IconFiles size={20} /> : <FileBadge name={node.name} />}
      </span>

      {renaming ? (
        <NameInput
          initial={node.name}
          label={`Rename ${node.name}`}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <span className={'tree-row__label' + (isDir ? ' tree-row__label--dir' : '')}>{node.name}</span>
      )}

      {dirty && !renaming ? <span aria-label="Unsaved changes" className="dot-dirty" /> : null}

      <IconButton
        label={`Actions for ${node.name}`}
        className="tree-row__more"
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onMenu({ x: r.right, y: r.bottom + 4, fromRight: true })
        }}
      >
        <IconMore />
      </IconButton>
    </div>
  )
}

/**
 * The inline name field. Autofocus **plus select-all**, because the two things a
 * student does next are "type a new name" and "fix one character" — and 16px, or
 * iOS zooms the page on focus and they have to pinch their way back (§3.2).
 */
function NameInput({
  initial,
  placeholder,
  label,
  onCommit,
  onCancel,
}: {
  initial: string
  placeholder?: string
  label: string
  onCommit(name: string): void
  onCancel(): void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const settled = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
  }, [])

  // Enter commits, Escape abandons, and clicking away commits — but only once,
  // or Enter's own blur would fire the commit a second time.
  const finish = (commit: boolean) => {
    if (settled.current) return
    settled.current = true
    if (commit) onCommit(ref.current?.value ?? '')
    else onCancel()
  }

  return (
    <input
      ref={ref}
      className="dlg-input min-w-0 flex-1 select-text"
      aria-label={label}
      defaultValue={initial}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect="off"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The shell listens for Escape and Cmd+S on the window; a name being
        // typed is not the place for either.
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}

/** "This folder is empty." plus the one action that fixes it (spec §7.5). */
function EmptyDirRow({ depth, onNewFile }: { depth: number; onNewFile(): void }) {
  return (
    <div className="relative flex min-h-touch items-center gap-2 pr-1" style={rowPadding(depth)}>
      <Guides depth={depth} />
      <p className="text-meta italic text-text-3">This folder is empty.</p>
      <Button variant="quiet" className="btn--compact" onClick={onNewFile}>
        New file
      </Button>
    </div>
  )
}

function allFolders(tree: TreeNode): Set<string> {
  const out = new Set<string>()
  const walk = (node: TreeNode) => {
    for (const c of node.children) {
      if (c.kind !== 'dir') continue
      out.add(c.path)
      walk(c)
    }
  }
  walk(tree)
  return out
}
