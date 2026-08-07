import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { splitPath } from '../fs/project'
import { LONG_PRESS_MS, LONG_PRESS_SLOP } from '../ui/longPress'

/** One draggable tree entry — the minimum the drag needs to know about a node. */
export interface DndNode {
  path: string
  name: string
  isDir: boolean
}

/**
 * Pointer-based DnD for the file tree (not HTML5 drag, which never fires on
 * touch), one code path for mouse/touch/pen — modelled on ConsoleDivider.
 *
 * Mouse: press + move past a threshold starts the drag; a click still opens
 * the file. Touch/pen: press-and-hold lifts first so a swipe still scrolls;
 * holding without moving falls through to the context menu.
 *
 * Drop target: onto a folder goes into it, onto a file lands beside it (its
 * parent), onto empty space goes to root. Moving into itself/its own subtree
 * or back into its current folder is a no-op.
 */

// One feel across the app (ui/longPress.ts): hold, mouse-drag threshold and
// scroll slop all align to 500ms / 8px. The three roles stay distinct — only
// the numbers were unified (were 360ms, 6px, 10px).
const TOUCH_HOLD_MS = LONG_PRESS_MS // press-and-hold before a touch lifts into a drag
const MOVE_THRESHOLD = LONG_PRESS_SLOP // px a mouse travels before a press becomes a drag
const SCROLL_SLOP = LONG_PRESS_SLOP // finger travel before the hold is read as a scroll
const HOVER_EXPAND_MS = 640 // hover a collapsed folder this long and it opens
const EDGE_BAND = 52 // auto-scroll when the pointer is this close to an edge
const EDGE_SPEED = 14 // px per frame at the very edge

const parentDir = (path: string) => splitPath(path).dir

interface Pending {
  node: DndNode
  el: HTMLElement
  pointerId: number
  touch: boolean
  startX: number
  startY: number
}

export interface TreeDnd {
  /** The node currently being dragged, or null. Drives the floating chip. */
  dragging: DndNode | null
  /** Folder a drop would land in: a path, '' for root, or null for no valid target. Highlights that row. */
  dropDir: string | null
  /** Pointer position and input kind for the floating drag chip. */
  chip: { x: number; y: number; touch: boolean } | null
  /** Spread onto every draggable row. */
  onRowPointerDown(e: ReactPointerEvent, node: DndNode): void
  /** Row calls this from onClick; true means a drag just happened — swallow it. */
  consumeClick(): boolean
}

export function useTreeDnd(opts: {
  /** The scrolling tree container — used for auto-scroll and root hit-testing. */
  scroller: RefObject<HTMLElement | null>
  /** Look up a node by its `data-path`, so the hit-test can read isDir. */
  nodeAt(path: string): DndNode | undefined
  /** Move `from` into folder `toDir` ('' = root). */
  onMove(from: string, toDir: string): void
  /** Open a collapsed folder (used by hover-to-expand while dragging). */
  onExpand(path: string): void
  /** A held-but-not-dragged touch — the long-press that opens the menu. */
  onLongPress(node: DndNode, x: number, y: number): void
}): TreeDnd {
  const [dragging, setDragging] = useState<DndNode | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [chip, setChip] = useState<{ x: number; y: number; touch: boolean } | null>(null)

  // Latest props, read by the stable pointer listeners without re-binding them.
  const cb = useRef(opts)
  cb.current = opts

  // State lives in refs — listeners are created once (so add/removeEventListener
  // pair up) and need live values on every event.
  const pending = useRef<Pending | null>(null)
  const active = useRef(false) // has the press crossed into a real drag?
  const movedSinceLift = useRef(false) // did the pointer travel after lifting?
  const justDragged = useRef(false) // suppress the click that trails a drag
  const holdTimer = useRef<number | undefined>(undefined)
  const expandTimer = useRef<number | undefined>(undefined)
  const expandFor = useRef<string | null>(null)
  const dropDirRef = useRef<string | null>(null)
  const autoScroll = useRef(0) // signed px/frame; 0 = idle
  const raf = useRef<number | undefined>(undefined)

  // Built once; everything it reads is in a ref, so it never goes stale or needs to be a dependency.
  const self = useRef<{
    lift(x: number, y: number): void
    move(e: PointerEvent): void
    up(e: PointerEvent): void
    cancel(): void
  } | null>(null)

  if (!self.current) {
    const clearHold = () => {
      if (holdTimer.current) clearTimeout(holdTimer.current)
      holdTimer.current = undefined
    }
    const clearExpand = () => {
      if (expandTimer.current) clearTimeout(expandTimer.current)
      expandTimer.current = undefined
      expandFor.current = null
    }
    const stopAutoScroll = () => {
      autoScroll.current = 0
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = undefined
    }
    const tickAutoScroll = () => {
      const el = cb.current.scroller.current
      if (el && autoScroll.current) el.scrollTop += autoScroll.current
      raf.current = autoScroll.current ? requestAnimationFrame(tickAutoScroll) : undefined
    }

    // Resolves and highlights the drop folder under the pointer — elementFromPoint
    // still hit-tests under pointer capture, enabling cross-row targeting.
    const updateTarget = (x: number, y: number) => {
      const drag = pending.current
      if (!drag) return
      const under = document.elementFromPoint(x, y) as HTMLElement | null
      const rowEl = under?.closest<HTMLElement>('[data-path]')
      const inTree = !!under?.closest('[data-tree-root]')

      let dir: string | null = null
      let hoveredDir: string | null = null // a collapsed folder to maybe open
      if (rowEl) {
        const p = rowEl.getAttribute('data-path') ?? ''
        const n = cb.current.nodeAt(p)
        if (n) {
          dir = n.isDir ? p : parentDir(p)
          if (n.isDir) hoveredDir = p
        }
      } else if (inTree) {
        dir = '' // empty space inside the tree drops at the root
      }

      // Reject the moves that make no sense before drawing a target.
      const from = drag.node.path
      if (dir !== null) {
        const sameParent = dir === parentDir(from)
        const intoSelf = drag.node.isDir && (dir === from || dir.startsWith(from + '/'))
        if (sameParent || intoSelf) dir = null
      }

      dropDirRef.current = dir
      setDropDir(dir)

      // Spring open a collapsed folder the pointer rests on, so nested drops work.
      if (hoveredDir && hoveredDir !== expandFor.current) {
        clearExpand()
        expandFor.current = hoveredDir
        const target = hoveredDir
        expandTimer.current = window.setTimeout(() => cb.current.onExpand(target), HOVER_EXPAND_MS)
      } else if (!hoveredDir) {
        clearExpand()
      }

      // Auto-scroll near the top/bottom edges of the tree.
      const box = cb.current.scroller.current?.getBoundingClientRect()
      if (box) {
        const top = y - box.top
        const bottom = box.bottom - y
        let v = 0
        if (top < EDGE_BAND) v = -Math.ceil(((EDGE_BAND - top) / EDGE_BAND) * EDGE_SPEED)
        else if (bottom < EDGE_BAND) v = Math.ceil(((EDGE_BAND - bottom) / EDGE_BAND) * EDGE_SPEED)
        if (v !== autoScroll.current) {
          autoScroll.current = v
          if (v && !raf.current) raf.current = requestAnimationFrame(tickAutoScroll)
          else if (!v) stopAutoScroll()
        }
      }
    }

    const beginDrag = (x: number, y: number) => {
      const drag = pending.current
      if (!drag || active.current) return
      active.current = true
      movedSinceLift.current = false
      clearHold()
      // Captured now, not on press — on touch, capturing earlier would steal the scroll gesture.
      try {
        drag.el.setPointerCapture(drag.pointerId)
      } catch {
        /* pointer already gone — the up handler still cleans up */
      }
      setDragging(drag.node)
      setChip({ x, y, touch: drag.touch })
      updateTarget(x, y)
    }

    const teardown = () => {
      const drag = pending.current
      clearHold()
      clearExpand()
      stopAutoScroll()
      if (drag) {
        try {
          drag.el.releasePointerCapture(drag.pointerId)
        } catch {
          /* nothing to release */
        }
        drag.el.removeEventListener('pointermove', self.current!.move)
        drag.el.removeEventListener('pointerup', self.current!.up)
        drag.el.removeEventListener('pointercancel', self.current!.cancel)
      }
      pending.current = null
      active.current = false
      dropDirRef.current = null
      setDragging(null)
      setDropDir(null)
      setChip(null)
    }

    self.current = {
      lift(x: number, y: number) {
        beginDrag(x, y)
      },
      move(e: PointerEvent) {
        const drag = pending.current
        if (!drag) return
        const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
        if (!active.current) {
          if (drag.touch) {
            // A moving finger before the hold fires is a scroll — let it go.
            if (moved > SCROLL_SLOP) {
              clearHold()
              teardown()
            }
            return
          }
          if (moved > MOVE_THRESHOLD) beginDrag(e.clientX, e.clientY)
          return
        }
        if (moved > MOVE_THRESHOLD) movedSinceLift.current = true
        e.preventDefault() // hold the page still while a captured drag runs
        setChip({ x: e.clientX, y: e.clientY, touch: drag.touch })
        updateTarget(e.clientX, e.clientY)
      },
      up(e: PointerEvent) {
        const drag = pending.current
        const dir = dropDirRef.current
        // Touch lifted but never moved = long-press; hand it to the context menu instead of dropping nowhere.
        const longPress = !!drag?.touch && active.current && !movedSinceLift.current
        const node = drag?.node
        const dragged = active.current
        const x = e.clientX
        const y = e.clientY
        if (dragged && drag && dir !== null) cb.current.onMove(drag.node.path, dir)
        if (dragged) justDragged.current = true // swallow the trailing click
        teardown()
        if (longPress && node) cb.current.onLongPress(node, x, y)
      },
      cancel() {
        teardown()
      },
    }
  }

  const onRowPointerDown = (e: ReactPointerEvent, node: DndNode) => {
    if (e.button !== 0) return // let right-click reach the context menu
    // Don't hijack presses meant for the row's own controls (⋯ button, rename field) — those own the interaction.
    if ((e.target as HTMLElement).closest('button, input, a, [role="menu"]')) return
    if (pending.current) self.current!.cancel() // abandon a half-started gesture
    justDragged.current = false // a fresh press; any stale swallow is void now
    const el = e.currentTarget as HTMLElement
    const touch = e.pointerType !== 'mouse'
    pending.current = { node, el, pointerId: e.pointerId, touch, startX: e.clientX, startY: e.clientY }
    active.current = false

    el.addEventListener('pointermove', self.current!.move)
    el.addEventListener('pointerup', self.current!.up)
    el.addEventListener('pointercancel', self.current!.cancel)

    if (touch) {
      const x = e.clientX
      const y = e.clientY
      if (holdTimer.current) clearTimeout(holdTimer.current)
      holdTimer.current = window.setTimeout(() => self.current!.lift(x, y), TOUCH_HOLD_MS)
    }
  }

  useEffect(() => {
    return () => self.current?.cancel()
  }, [])

  const consumeClick = () => {
    if (justDragged.current) {
      justDragged.current = false
      return true
    }
    return false
  }

  return { dragging, dropDir, chip, onRowPointerDown, consumeClick }
}
