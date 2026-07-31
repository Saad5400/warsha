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

  if (tabs.length === 0) return <div className="tab-strip" />

  return (
    <div className="relative flex-none">
      <div ref={stripRef} role="tablist" aria-label="Open files" className="tab-strip select-none">
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
      className="tab group"
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
      <span className="tab__label">{name}</span>
      {/* One 44px slot, always present, so activating or dirtying a tab never
          shifts its label. Unsaved shows the amber dot; reaching for the slot
          turns it into the ×. Below 900px the × is on the active tab only — an ×
          on every tab in a 390px strip is a mis-tap generator (§7.2). */}
      <button
        type="button"
        aria-label={dirty ? `Close ${name} (unsaved)` : `Close ${name}`}
        className={'tab__close' + (active ? '' : ' hidden min-[900px]:grid')}
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
