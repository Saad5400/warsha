import { useRef, useState } from 'react'
import type { Project, TreeNode } from '../fs/project'
import { FileBadge } from './FileBadge'
import { IconButton } from './ui/Button'
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

  const rows: TreeNode[] = []
  const depths = new Map<string, number>()
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      rows.push(child)
      depths.set(child.path, depth)
      if (child.kind === 'dir' && !collapsed.has(child.path)) walk(child, depth + 1)
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
        <span className="text-micro font-semibold uppercase tracking-wider text-text-3">Explorer</span>
        <div className="ml-auto flex items-center">
          <IconButton label="New file" onClick={() => props.onNewFile('')}>
            +
          </IconButton>
          <IconButton label="New folder" onClick={() => props.onNewFolder('')}>
            <FolderPlusGlyph />
          </IconButton>
        </div>
      </div>

      <div className="scroller flex-1 py-1" role="tree" aria-label="Project files">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-meta leading-normal text-text-3">
            No files yet. Use + above to add one.
          </p>
        ) : (
          rows.map((node) => (
            <Row
              key={node.path}
              node={node}
              depth={depths.get(node.path) ?? 0}
              open={node.kind === 'dir' && !collapsed.has(node.path)}
              active={node.kind === 'file' && activePath === node.path}
              dirty={project.isDirty(node.path)}
              onActivate={() => (node.kind === 'dir' ? toggle(node.path) : props.onOpenFile(node.path))}
              onMenu={(anchor) => setMenu({ anchor, node })}
            />
          ))
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
      data-state={active ? 'open' : undefined}
      title={node.path}
      // The open file is marked by a 2px accent rule on the leading edge, not by
      // a fill change: adjacent surfaces are ~1.1:1 apart and invisible on a phone.
      className={
        'tap group flex min-h-touch cursor-pointer items-center gap-2 border-l-rail pr-1 ' +
        (active ? 'border-accent bg-surface-2' : 'border-transparent hover:bg-surface-3')
      }
      style={{ paddingLeft: `calc(var(--sp-3) + ${depth} * var(--sp-4))` }}
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
      {isDir ? (
        <span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center text-text-3 transition-transform duration-[--dur-fast]"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        >
          ›
        </span>
      ) : (
        <FileBadge name={node.name} />
      )}

      <span
        className={
          'flex-1 truncate text-row ' +
          (active ? 'font-medium text-text-1' : isDir ? 'font-medium text-text-2' : 'text-text-2')
        }
      >
        {node.name}
      </span>

      {dirty ? <span aria-label="Unsaved changes" className="size-[6px] shrink-0 rounded-pill bg-accent" /> : null}

      <button
        type="button"
        aria-label={`Actions for ${node.name}`}
        className="tap grid size-touch shrink-0 place-items-center rounded-sm text-text-3 hover:bg-surface-4 hover:text-text-1"
        onClick={(e) => {
          e.stopPropagation()
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          onMenu({ x: r.right, y: r.bottom + 4, fromRight: true })
        }}
      >
        ⋯
      </button>
    </div>
  )
}

function FolderPlusGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.5 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M10 9.5v4M8 11.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
