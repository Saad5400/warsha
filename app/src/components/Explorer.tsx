import { useRef, useState } from 'react'
import type { Project, TreeNode } from '../fs/project'
import { FileBadge } from './FileBadge'
import { Button, IconButton } from './ui/Button'
import { IconChevronRight, IconFolderOpen, IconFolderPlus, IconMore, IconPlus } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

export interface ExplorerProps {
  project: Project
  tree: TreeNode
  activePath: string | null
  onOpenFile(path: string): void
  onNewFile(parentDir: string): void
  onNewFolder(parentDir: string): void
  onRename(path: string, isDir: boolean): void
  onDelete(path: string, isDir: boolean): void
}

const LONG_PRESS_MS = 500

/** One visual row: a real node, or the "this folder is empty" line under one. */
type VisualRow =
  | { kind: 'node'; node: TreeNode; depth: number }
  | { kind: 'empty-dir'; key: string; depth: number; dir: string }

export function Explorer(props: ExplorerProps) {
  const { project, tree, activePath } = props
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; node: TreeNode } | null>(null)

  const toggle = (path: string) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const rows: VisualRow[] = []
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      rows.push({ kind: 'node', node: child, depth })
      if (child.kind === 'dir' && !collapsed.has(child.path)) {
        if (child.children.length === 0) {
          // Empty folders are real here (FsSnapshot carries them), so they get a
          // sentence rather than looking like a broken row (spec §7.5).
          rows.push({ kind: 'empty-dir', key: `${child.path}::empty`, depth: depth + 1, dir: child.path })
        } else {
          walk(child, depth + 1)
        }
      }
    }
  }
  walk(tree, 0)

  const menuItems = (node: TreeNode): MenuItem[] => {
    const isDir = node.kind === 'dir'
    return [
      ...(isDir
        ? [
            { label: 'New file…', onSelect: () => props.onNewFile(node.path) },
            { label: 'New folder…', onSelect: () => props.onNewFolder(node.path) },
          ]
        : [{ label: 'Open', onSelect: () => props.onOpenFile(node.path) }]),
      { label: 'Rename…', onSelect: () => props.onRename(node.path, isDir) },
      { label: 'Delete', danger: true, onSelect: () => props.onDelete(node.path, isDir) },
    ]
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-2">
      <div className="flex h-bar shrink-0 items-center gap-2 border-b border-border-subtle pl-3 pr-1">
        <span className="panel-label">Explorer</span>
        {/* gap-1 here would put two 44px targets 4px apart; §5.2 asks for ≥8px. */}
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="New file" onClick={() => props.onNewFile('')}>
            <IconPlus />
          </IconButton>
          <IconButton label="New folder" onClick={() => props.onNewFolder('')}>
            <IconFolderPlus />
          </IconButton>
        </div>
      </div>

      <div className="scroller flex-1 py-1" role="tree" aria-label="Project files">
        {rows.length === 0 ? (
          <div className="empty">
            <IconFolderOpen size={32} className="empty__glyph" />
            <p className="empty__body">This project has no files yet.</p>
            <Button variant="ghost" onClick={() => props.onNewFile('')}>
              New file
            </Button>
          </div>
        ) : (
          rows.map((row) =>
            row.kind === 'node' ? (
              <Row
                key={row.node.path}
                node={row.node}
                depth={row.depth}
                open={row.node.kind === 'dir' && !collapsed.has(row.node.path)}
                active={row.node.kind === 'file' && activePath === row.node.path}
                dirty={project.isDirty(row.node.path)}
                onActivate={() =>
                  row.node.kind === 'dir' ? toggle(row.node.path) : props.onOpenFile(row.node.path)
                }
                onMenu={(anchor) => setMenu({ anchor, node: row.node })}
              />
            ) : (
              <EmptyDirRow key={row.key} depth={row.depth} onNewFile={() => props.onNewFile(row.dir)} />
            ),
          )
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
  onActivate,
  onMenu,
}: {
  node: TreeNode
  depth: number
  open: boolean
  active: boolean
  dirty: boolean
  onActivate(): void
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
      tabIndex={0}
      // The open file is marked by a 2px accent rule on the leading edge plus
      // text-1 at weight 500, never by a fill change: adjacent surfaces are
      // ~1.1:1 apart and invisible on a phone. See `.tree-row` in index.css.
      data-state={active ? 'open' : undefined}
      title={node.path}
      className="tree-row"
      style={rowPadding(depth)}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate()
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
        <FileBadge name={node.name} />
      )}

      <span className={'tree-row__label' + (isDir ? ' tree-row__label--dir' : '')}>{node.name}</span>

      {dirty ? <span aria-label="Unsaved changes" className="dot-dirty" /> : null}

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
