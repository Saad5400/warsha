import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import { formatKeys } from '../ui/keys'
import { useTreeDnd, type DndNode } from '../hooks/useTreeDnd'

export interface ExplorerProps {
  project: Project
  /**
   * The open project's display name, for the pane header's folder row.
   * `Project` itself is nameless by design (it is a file store), so the shell
   * passes the name it already derives for the title bar. Optional so the
   * explorer still renders while the shell catches up; the pane header then
   * shows its actions against a blank label.
   */
  projectName?: string
  tree: TreeNode
  activePath: string | null
  onOpenFile(path: string): void
  /**
   * A `name` means the explorer already collected it inline, so the shell must
   * not open a prompt dialog on top. Omitting it keeps the dialog path, which
   * is still what the menu bar's File > New File… uses.
   */
  onNewFile(parentDir: string, name?: string): void
  onNewFolder(parentDir: string, name?: string): void
  onRename(path: string, isDir: boolean, name?: string): void
  onDelete(path: string, isDir: boolean): void
  /**
   * Drag-and-drop moved `path` into folder `toDir` (`''` is the project root).
   * The shell owns the filesystem move, exactly as it owns rename — the explorer
   * only reports where the row was dropped. See useTreeDnd for the gesture.
   */
  onMove(path: string, toDir: string): void
  /**
   * Reveals the start panel behind the drawer. Only passed below 900px — docked,
   * the starters are already on screen and the button would be a no-op, so the
   * empty state drops to "New file" alone.
   */
  onShowStarters?(): void
}

/* The sidebar's own header bar. See the note at its call site for why the
 * divider is a shadow and the leading padding is --sp-3. `explorer-head` is the
 * hook the desk hover-reveal reads (index.css): VS Code hides the ⋯ view
 * action at rest, but only where a hover exists to reveal it. */
const HEADER =
  'explorer-head flex h-bar-side shrink-0 items-center gap-2 pl-3 pr-2 shadow-[inset_0_-1px_0_0_var(--border-subtle)]'

/* Spec §3.2 section label. `panel-label` carries no styling — tools/qa reads it.
 * Title-case at 12px/600 (VS Code's sidebar title), not the old small-caps. */
const PANEL_LABEL = 'panel-label text-[12px] leading-none font-semibold text-text-1'

/* VS Code's pane header, at EVERY size (one shell — founder ruling
 * 2026-08-05): an --row-tree row (44px touch, 22px desk) — the project
 * folder's name as a bold 11px label, with the tree actions riding on the
 * right. At desk they hide until the row is hovered or one of them holds
 * focus; on touch there is no hover, so they stay visible (index.css owns the
 * reveal). Keeps `sidebar-project-row` because tools/qa finds the project row
 * by it. */
const PANE_HEADER =
  'sidebar-project-row flex h-row-tree flex-none items-center pr-1 shadow-[inset_0_-1px_0_0_var(--border-subtle)]'

/* The pane header's actions. IconButton, boxed to `--pane-action` (inline
 * style — the size-icon-btn class would win a class-order fight): the full
 * 44px touch target on coarse pointers, VS Code's 22px under the desk media
 * (`.sidebar-project-row` in index.css carries the token; the glyph already
 * follows via the icon-btn recipe's own desk rule). `after:content-none`
 * because the three sit flush — no clear space for the hit-area pseudo, and on
 * touch the real box is already ≥44px. */
const PANE_ACTION = 'after:content-none'
const PANE_ACTION_SIZE = { width: 'var(--pane-action)', height: 'var(--pane-action)' } as const

/** One visual row: a real node, or a name being typed. */
type VisualRow =
  | { kind: 'node'; node: TreeNode; depth: number }
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
  const [viewMenu, setViewMenu] = useState<MenuAnchor | null>(null)
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
  // A flat path→node index, rebuilt each render, so the drag can look up any
  // row's kind by its `data-path` and reopen the menu on a long-press.
  const nodeByPath = new Map<string, TreeNode>()
  const walk = (node: TreeNode, depth: number) => {
    for (const child of node.children) {
      nodeByPath.set(child.path, child)
      rows.push({ kind: 'node', node: child, depth })
      if (child.kind === 'dir' && !collapsed.has(child.path)) {
        walk(child, depth + 1)
        if (draft?.dir === child.path) {
          rows.push({ kind: 'draft', key: 'draft', depth: depth + 1, dir: child.path, makes: draft.makes })
        }
        // An expanded empty folder renders nothing beneath — VS Code parity
        // (one shell, founder ruling 2026-08-05). New file… is still one
        // gesture away: the row's ⋯ / long-press on touch, right-click at desk.
      }
    }
  }
  walk(tree, 0)
  // A root-level draft goes to the top, where a long tree cannot hide it.
  if (draft && draft.dir === '') rows.unshift({ kind: 'draft', key: 'draft', depth: 0, dir: '', makes: draft.makes })

  const hasFolders = rows.some((r) => r.kind === 'node' && r.node.kind === 'dir')

  const dnd = useTreeDnd({
    scroller: treeRef,
    nodeAt: (path) => {
      const n = nodeByPath.get(path)
      return n ? { path: n.path, name: n.name, isDir: n.kind === 'dir' } : undefined
    },
    onMove: props.onMove,
    onExpand: expand,
    // A touch that lifts but never moves is the old long-press: reopen the menu.
    onLongPress: (node, x, y) => {
      const n = nodeByPath.get(node.path)
      if (n) setMenu({ anchor: { x, y }, node: n })
    },
  })

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
      // The hint goes through formatKeys like every other shortcut label, even
      // though F2 formats to itself — one formatter, no hand-written variants.
      { label: 'Rename…', hint: formatKeys('F2'), startsGroup: true, onSelect: () => setRenaming(node.path) },
      { label: 'Delete', danger: true, onSelect: () => props.onDelete(node.path, isDir) },
    ]
  }

  return (
    // select-none on the chrome: dragging across rows must not paint a text
    // selection. The editor and the console keep their text selectable.
    <div className="flex h-full min-h-0 select-none flex-col bg-surface-2">
      {/* The divider is an inset shadow, not `border-b`: with border-box a 1px
          border comes out of the bar's own 44px, leaving 43px for the 44px icon
          buttons inside it — the exact defect the BARS recipe exists to prevent,
          and it was here. pl-3 matches the title bar's leading padding, so the
          logo mark above and this label start on one vertical grid line. */}
      <div className={HEADER}>
        <span className={PANEL_LABEL}>Explorer</span>
        {/* One lone ⋯ (VS Code's "Views and More Actions" slot) at every size:
            hover-revealed at desk, always visible on touch (`.explorer-head` in
            index.css). The tree actions themselves live on the pane header
            below. No `after:content-none` — with no flush neighbour the ≥44px
            hit-area pseudo has room to expand, which is exactly what a lone
            40px control on touch needs. Never labelled "More" — that exact
            name is the tab strip's, and actions-check clicks it unscoped. */}
        <IconButton
          label="More actions"
          className="ml-auto"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setViewMenu({ x: r.right, y: r.bottom + 4, fromRight: true })
          }}
        >
          <IconMore />
        </IconButton>
      </div>

      {/* The pane header (LAYOUT-VSCODE: the Explorer section row), at every
          size — the touch-only projectSlot row is gone with the shell's
          ProjectSwitcher; every project-scoped job lives in the menu bar's
          File menu now (W1-B). */}
      <div className={PANE_HEADER}>
        {/* A static label, deliberately not VS Code's collapsible section
            toggle: one project means one section, and a twistie that blanks
            the whole tree is a foot-gun, not a feature (founder ruling
            2026-08-05). */}
        <span className="flex h-full min-w-0 flex-1 items-center gap-1 pl-2">
          <span className="truncate text-[11px] font-bold text-text-1">{props.projectName ?? ''}</span>
        </span>
        <div className="flex items-center">
          <IconButton label="New file" className={PANE_ACTION} style={PANE_ACTION_SIZE} onClick={() => startDraft('', 'file')}>
            <IconPlus />
          </IconButton>
          <IconButton label="New folder" className={PANE_ACTION} style={PANE_ACTION_SIZE} onClick={() => startDraft('', 'dir')}>
            <IconFolderPlus />
          </IconButton>
          {hasFolders ? (
            <IconButton
              label="Collapse folders"
              className={PANE_ACTION}
              style={PANE_ACTION_SIZE}
              onClick={() => setCollapsed(allFolders(tree))}
            >
              <IconChevronUp />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div
        ref={treeRef}
        // With no rows the pane centres its empty state vertically (founder
        // ruling 2026-08-05) — flex only then, so row layout never changes.
        className={
          'scroller flex-1 py-1' +
          (rows.length === 0 ? ' flex flex-col justify-center' : '')
        }
        role="tree"
        aria-label="Project files"
        // Hooks for the drag: `data-tree-root` marks the root drop zone, and
        // `data-drop-root` lights the whole panel when a drop would land here.
        data-tree-root=""
        data-drop-root={dnd.dropDir === '' ? 'true' : undefined}
        // While a drag is live the tree owns the pointer; native scroll must not
        // fight the captured drag (auto-scroll near the edges replaces it).
        data-dnd-active={dnd.dragging ? 'true' : undefined}
      >
        {rows.length === 0 ? (
          <div className="empty">
            <IconFolderOpen size={32} className="empty__glyph" />
            <p className="empty__title">No files yet</p>
            <p className="empty__body">
              Create a file to start. A name ending in .py or .java is all Warsha needs to know how to run it.
            </p>
            {/* Starter first, and filled (founder ruling 2026-08-05): the
                starter is the primary way in wherever an empty project offers
                one, and "New file" is the quiet second for the student who
                already knows their filename. `onShowStarters` only arrives
                below 900px — docked, the start panel's own card is on screen
                and carries the lead, so the empty state keeps just "New file". */}
            <div className="flex w-full flex-col gap-2">
              {props.onShowStarters ? (
                <Button variant="primary" onClick={props.onShowStarters}>
                  Show starters
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => startDraft('', 'file')}>
                New file
              </Button>
            </div>
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === 'draft') {
              return (
                <div key={row.key} className="relative flex min-h-row-tree items-center gap-2 pr-1" style={rowPadding(row.depth)}>
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
                // The drop lands in a folder, so only folder rows light up; a
                // file drop highlights its parent folder instead (or the root).
                dropTarget={row.node.kind === 'dir' && dnd.dropDir === row.node.path}
                onPointerDownRow={(e) =>
                  dnd.onRowPointerDown(e, {
                    path: row.node.path,
                    name: row.node.name,
                    isDir: row.node.kind === 'dir',
                  })
                }
                consumeClick={dnd.consumeClick}
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

      {/* The header ⋯: the same actions the pane header carries, reachable
          without hovering (they hide at rest at desk). */}
      {viewMenu ? (
        <Menu
          anchor={viewMenu}
          items={[
            { label: 'New file…', icon: <IconPlus />, onSelect: () => startDraft('', 'file') },
            { label: 'New folder…', icon: <IconFolderPlus />, onSelect: () => startDraft('', 'dir') },
            ...(hasFolders
              ? [{ label: 'Collapse folders', icon: <IconChevronUp />, startsGroup: true, onSelect: () => setCollapsed(allFolders(tree)) }]
              : []),
          ]}
          label="Explorer actions"
          onClose={() => setViewMenu(null)}
        />
      ) : null}

      {dnd.dragging && dnd.chip ? (
        <DragChip node={dnd.dragging} x={dnd.chip.x} y={dnd.chip.y} touch={dnd.chip.touch} />
      ) : null}
    </div>
  )
}

/**
 * The label that rides under the pointer during a drag, so it is always clear
 * what is being moved. On touch it floats above the finger — a chip pinned under
 * the thumb is a chip you cannot see. Purely decorative: pointer-events none,
 * aria-hidden, and the real move is announced by the tree updating.
 */
function DragChip({ node, x, y, touch }: { node: DndNode; x: number; y: number; touch: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="tree-drag-chip"
      style={{ left: x, top: y, transform: touch ? 'translate(-50%, calc(-100% - 20px))' : 'translate(14px, 10px)' }}
    >
      <span className="grid size-5 shrink-0 place-items-center text-text-3">
        {node.isDir ? <IconFiles size={20} /> : <FileBadge name={node.name} />}
      </span>
      <span className="truncate">{node.name}</span>
    </div>
  )
}

/** One hairline guide per level, so depth reads at a glance. The per-level step
 *  is `--tree-indent` (16px touch, 8px desk — DENSITY), so guides track the
 *  same indent the rows use at both densities. */
function Guides({ depth }: { depth: number }) {
  if (depth === 0) return null
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="tree-row__guide"
          // Offset by --rail for the same reason rowPadding is: `left` is
          // measured from the row's PADDING box, which begins after the 2px
          // reserved accent border, so the guide has to give the 2px back or it
          // stops sitting on the chevron centre it marks. `--guide-nudge` is the
          // half-slot that centres the guide on the twistie column: the slot is
          // 20px on touch and 16px at desk, so the nudge lives on
          // `.tree-row__guide` in index.css where the DENSITY block can retune it.
          style={{ left: `calc(var(--sp-3) - var(--rail) + ${i} * var(--tree-indent) + var(--guide-nudge, 9px))` }}
        />
      ))}
    </>
  )
}

/* 12px of inset, MINUS the 2px the row already spends on its reserved accent
 * border — so a top-level row's chevron starts on x=60, the same grid line as
 * the Explorer label, the project row's folder glyph and (at ≥900px) the title
 * bar above them. Without the subtraction the tree ran 2px right of everything
 * else in its own column (PIXEL-FINDINGS F-07). Per-level step is
 * `--tree-indent`: 16px on touch, 8px at desk (DENSITY block). */
const rowPadding = (depth: number) => ({
  paddingLeft: `calc(var(--sp-3) - var(--rail) + ${depth} * var(--tree-indent))`,
})

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
  dropTarget,
  onPointerDownRow,
  consumeClick,
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
  /** True while a drop on this (folder) row would land here — lights the row. */
  dropTarget: boolean
  /** Starts the drag gesture. See useTreeDnd. */
  onPointerDownRow(e: ReactPointerEvent<HTMLElement>): void
  /** True right after a drag ends, so its trailing click does not open the row. */
  consumeClick(): boolean
}) {
  const isDir = node.kind === 'dir'

  return (
    <div
      role="treeitem"
      aria-selected={active}
      aria-expanded={isDir ? open : undefined}
      aria-level={depth + 1}
      tabIndex={0}
      // On touch the open file is marked by a 2px accent rule on the leading
      // edge plus text-1 at weight 500, never by a fill change: adjacent
      // surfaces are ~1.1:1 apart and invisible on a phone. At desk it is
      // VS Code's full-row selection fill instead (`--list-active-sel-bg`,
      // greying out when the tree loses focus). See `.tree-row` in index.css.
      data-state={active ? 'open' : undefined}
      // Lit while a drop would land in this folder (see `.tree-row[data-drop]`).
      data-drop={dropTarget ? 'true' : undefined}
      data-path={node.path}
      title={node.path}
      className="tree-row"
      style={rowPadding(depth)}
      onPointerDown={renaming ? undefined : onPointerDownRow}
      // A drag ends in a pointerup that browsers still follow with a click; when
      // the row was dragged, swallow that click so it does not also open.
      onClick={renaming ? undefined : () => (consumeClick() ? undefined : onActivate())}
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
      // Touch has no right-click: a press-and-hold that does not turn into a
      // drag reopens this menu (see useTreeDnd's onLongPress). Desktop keeps the
      // real context menu here.
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <Guides depth={depth} />

      {/* A folder's glyph IS the twistie: a chevron that points right closed and
          rotates down open — the shape every file tree since VSCode has taught.
          It reuses the rows' 20px icon slot (`tree-row__chevron`, the same slot
          the draft rows use, and the selector tools/qa reads for the rotation),
          so the tree still spends no extra width on a chevron column. Files
          keep their language badge. */}
      {isDir ? (
        <span
          aria-hidden="true"
          className={
            // desk:transition-none: VS Code's twistie snaps; the rotate class
            // itself stays at both densities (tools/qa asserts the rotation).
            'tree-row__chevron shrink-0 transition-transform duration-(--dur-fast) ease-standard desk:transition-none' +
            (open ? ' rotate-90' : '')
          }
        >
          <IconChevronRight size={16} />
        </span>
      ) : (
        <span aria-hidden="true" className="grid size-5 desk:size-4 shrink-0 place-items-center text-text-3">
          <FileBadge name={node.name} />
        </span>
      )}

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
        // after:content-none: tree rows stack with no gap between them
        // (Explorer's HEADER comment applies the same logic) — IconButton's
        // ≥44px hit-area pseudo needs clear space to expand into or it steals
        // taps from the row above/below. Visual size still drops to 40px.
        // desk:hidden, not an index.css rule: the ⋯ is GONE at desk (the
        // right-click context menu covers it), and only a display utility can
        // outrank the recipe's own `inline-grid` — a components-layer
        // `display: none` loses the @layer fight to it (FileBadge hides its
        // touch badge the same way).
        className="tree-row__more after:content-none desk:hidden"
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
