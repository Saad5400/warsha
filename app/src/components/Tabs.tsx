import { useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { splitPath } from '../fs/project'
import { FileBadge } from './FileBadge'
import { IconClose } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

export interface TabsProps {
  project: Project
  tabs: string[]
  activePath: string | null
  onSelect(path: string): void
  onClose(path: string): void
}

const LONG_PRESS_MS = 500

/* The strip's bottom divider is an inset shadow, not a border: with border-box
 * sizing a 1px border eats into its 44px and every tab comes out 43px tall,
 * one pixel under the touch floor. A shadow costs no layout. The scrollbar is
 * hidden because 10px out of a 44px row is not affordable — Tabs renders an
 * edge fade instead when the strip actually scrolls. */
const STRIP =
  'tab-strip flex flex-none h-bar overflow-x-auto overflow-y-hidden bg-surface-2 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] snap-x snap-proximity ' +
  '[scrollbar-width:none] [&::-webkit-scrollbar]:h-0'

/* Active tab: accent rule (7.92:1) + weight 600 + text-1 (13.19 vs 7.72). The
 * surface-1 fill matches the editor canvas so the tab owns it, and it carries
 * none of the load — the tab stays unambiguous in greyscale (principle 2).
 *
 * The 2px accent rule is an inset shadow for the same reason the strip's divider
 * above is: a border eats the box. As `border-b-2` it left the tab a 42px CONTENT
 * box inside its 44px border box, and every centred child rode 1px high — the
 * 44px close button measured T=43 B=87 against a tab of T=44 B=88, i.e. one pixel
 * of it sat up in the title bar. A shadow costs no layout, so the children centre
 * in the full 44px, and it keeps the property the transparent border was there
 * for: nothing shifts when a tab activates, because a shadow never shifted
 * anything.
 *
 * `first:` drops the leading divider on the leftmost tab. The sidebar already
 * draws its own 1px edge at x=287 and the tab's `inset 1px` landed at 288, so the
 * seam between the file tree and the first tab measured 2px of --border-subtle
 * where every other tab boundary measures 1px. */
const TAB =
  'group flex items-center gap-2 flex-none h-full min-w-[96px] max-w-[60vw] px-3 cursor-pointer ' +
  'touch-manipulation snap-end bg-surface-2 ' +
  'shadow-[inset_-1px_0_0_0_var(--border-subtle)] transition-[background-color,color] ' +
  'duration-(--dur-fast) ease-standard hover:bg-surface-3 active:bg-surface-4 ' +
  'data-[state=active]:bg-surface-1 ' +
  'data-[state=active]:shadow-[inset_1px_0_0_0_var(--border-subtle),inset_-1px_0_0_0_var(--border-subtle),inset_0_-2px_0_0_var(--accent)] ' +
  'first:data-[state=active]:shadow-[inset_-1px_0_0_0_var(--border-subtle),inset_0_-2px_0_0_var(--accent)] ' +
  'data-[state=active]:hover:bg-surface-1'

/* `tab-strip`, `tab__label` and `tab__close` are styling-free — tools/qa
 * selects all three, so they stayed behind when their rules became utilities. */
const TAB_LABEL =
  'tab__label flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-tab leading-[1.2] ' +
  'font-medium text-text-2 group-data-[state=active]:text-text-1 group-data-[state=active]:font-semibold'

// Founder ruling (P1): 44px → 40px, same as every other icon-only control.
// No hit-area expansion here (contrast IconButton in ui/Button.tsx): the
// close slot sits flush against the tab's own right edge (`-mr-2` pulls it
// into the tab's padding) with a 1px divider and the next tab immediately
// past it, so an expanded invisible zone would reach across that divider and
// steal a tap meant for opening the neighbour, not closing this one.
const TAB_CLOSE =
  'tab__close grid place-items-center flex-none size-[40px] -mr-2 rounded-sm text-[14px] leading-none text-text-3 ' +
  'touch-manipulation cursor-pointer hover:text-text-1 hover:bg-surface-4 ' +
  'active:text-text-1 active:bg-surface-4 active:scale-92'

/**
 * Active tab carries three simultaneous signals (spec §7.2) — a 2px accent rule
 * on the bottom edge, weight 600, and text-1 — so it is unambiguous in greyscale
 * and in sunlight. The fill change to surface-1 makes the tab visually own the
 * editor canvas below it, and carries none of the load. All of that lives in
 * `.tab[data-state]` in index.css.
 *
 * The behaviours a tab strip is expected to have and this one was missing:
 * middle-click to close, Cmd/Ctrl+W, a Close-others/Close-all menu, and a dirty
 * dot that turns into a close × when you reach for it.
 */
export function Tabs({ project, tabs, activePath, onSelect, onClose }: TabsProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; path: string } | null>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  // Scroll the strip itself, never via scrollIntoView: that also scrolls
  // ancestors and can shove the whole page sideways on a narrow screen.
  useEffect(() => {
    const strip = stripRef.current
    const el = activeRef.current
    if (!strip || !el) return
    const left = el.offsetLeft
    const right = left + el.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
  }, [activePath, tabs.length])

  // The strip's scrollbar is hidden (it would eat 10px of a 44px row), so the
  // only thing left to say "there are more tabs that way" is an edge fade.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const read = () =>
      setOverflow({
        start: strip.scrollLeft > 1,
        end: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1,
      })
    read()
    strip.addEventListener('scroll', read, { passive: true })
    const observer = new ResizeObserver(read)
    observer.observe(strip)
    return () => {
      strip.removeEventListener('scroll', read)
      observer.disconnect()
    }
  }, [tabs.length])

  // Cmd/Ctrl+W closes the file, not the browser tab — when there is a file to
  // close. With nothing open we leave the shortcut alone rather than swallowing
  // it, so the student's own "close this page" still works.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'w') return
      if (!activePath) return
      e.preventDefault()
      onClose(activePath)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activePath, onClose])

  const menuItems = (path: string): MenuItem[] => {
    const { name } = splitPath(path)
    return [
      { label: `Close ${name}`, icon: <IconClose />, onSelect: () => onClose(path) },
      {
        label: 'Close others',
        disabled: tabs.length < 2,
        onSelect: () => {
          for (const t of tabs) if (t !== path) onClose(t)
        },
      },
      {
        label: 'Close all',
        onSelect: () => {
          for (const t of [...tabs]) onClose(t)
        },
      },
    ]
  }

  if (tabs.length === 0) return <div className={STRIP} />

  return (
    <div className="relative flex-none">
      <div ref={stripRef} role="tablist" aria-label="Open files" className={STRIP + ' select-none'}>
        {tabs.map((path) => {
          const { name } = splitPath(path)
          const active = path === activePath
          const dirty = project.isDirty(path)
          return (
            <Tab
              key={path}
              ref={active ? activeRef : undefined}
              path={path}
              name={name}
              active={active}
              dirty={dirty}
              onSelect={() => onSelect(path)}
              onClose={() => onClose(path)}
              onMenu={(anchor) => setMenu({ anchor, path })}
            />
          )
        })}
      </div>

      {overflow.start ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-5 bg-linear-to-r from-surface-2 to-transparent"
        />
      ) : null}
      {overflow.end ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-linear-to-l from-surface-2 to-transparent"
        />
      ) : null}

      {menu ? (
        <Menu
          anchor={menu.anchor}
          items={menuItems(menu.path)}
          label={`Actions for ${splitPath(menu.path).name}`}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}

function Tab({
  ref,
  path,
  name,
  active,
  dirty,
  onSelect,
  onClose,
  onMenu,
}: {
  ref?: React.Ref<HTMLDivElement>
  path: string
  name: string
  active: boolean
  dirty: boolean
  onSelect(): void
  onClose(): void
  onMenu(anchor: MenuAnchor): void
}) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef({ x: 0, y: 0 })

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = undefined
  }

  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={active}
      data-state={active ? 'active' : 'inactive'}
      title={path}
      className={TAB}
      onClick={onSelect}
      // Middle-click closes. mousedown has to be swallowed too, or Windows
      // Chrome starts its autoscroll and the strip jumps.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault()
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        onClose()
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
      <FileBadge name={name} />
      <span className={TAB_LABEL}>{name}</span>
      {/* One 44px slot, always present, so activating or dirtying a tab never
          shifts its label. Unsaved shows the amber dot; reaching for the slot
          turns it into the ×. Below 900px the × is on the active tab only — an ×
          on every tab in a 390px strip is a mis-tap generator (§7.2). */}
      <button
        type="button"
        aria-label={dirty ? `Close ${name} (unsaved)` : `Close ${name}`}
        className={TAB_CLOSE + (active ? '' : ' hidden min-[900px]:grid')}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        {dirty ? (
          <span aria-hidden="true" className="dot-dirty group-hover:hidden group-focus-within:hidden" />
        ) : null}
        <IconClose size={14} className={dirty ? 'hidden group-hover:block group-focus-within:block' : undefined} />
      </button>
    </div>
  )
}
