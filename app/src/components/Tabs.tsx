import { useEffect, useRef, useState } from 'react'
import type { Project } from '../fs/project'
import { splitPath } from '../fs/project'
import { FileBadge } from './FileBadge'
import { RunControl, type RunControlState } from './RunControl'
import { IconButton } from './ui/Button'
import { IconClose, IconMore } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'
import { COPY } from '../copy'

export interface TabsProps {
  project: Project
  tabs: string[]
  activePath: string | null
  onSelect(path: string): void
  onClose(path: string): void
  /** Run/Stop's one home: the strip's trailing group. Same state object as the console
   *  header's copy, so the two can never drift. */
  runControl?: RunControlState
  /**
   * The strip's "⋯" menu — file-scoped actions only (Format, Share as
   * image…). The app-scoped rows live in the menu bar.
   */
  moreItems?: MenuItem[]
}

const LONG_PRESS_MS = 500

// Bottom divider is an inset shadow, not a border (a border would eat into the 44px touch
// height). Scrollbar hidden (10px out of 44px isn't affordable) — an edge fade substitutes.
// `overscroll-x-contain` keeps a fling inside the strip; without it iOS turns a swipe's
// tail into back-navigation.
const STRIP =
  'tab-strip flex flex-none h-bar-tabs overflow-x-auto overflow-y-hidden overscroll-x-contain bg-surface-2 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] snap-x snap-proximity ' +
  '[scrollbar-width:none] [&::-webkit-scrollbar]:h-0'

// Active tab: 1px accent rule on top, no bottom divider — its opaque fill covers the strip's
// divider, so the seam into the editor below disappears. All inset shadows, never borders
// (a border ate 2px off the box and shifted centred children). `first:` drops the leading
// divider to avoid doubling up with the sidebar's own edge. Accent shadow listed first:
// audit.mjs reads it off the front of the computed box-shadow.
const TAB =
  'group flex items-center gap-2 desk:gap-1.5 flex-none h-full min-w-[96px] desk:min-w-0 ' +
  'max-w-[60vw] desk:max-w-[240px] px-3 desk:pl-2.5 desk:pr-1 cursor-pointer ' +
  'touch-manipulation snap-end bg-surface-2 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle),inset_-1px_0_0_0_var(--border-subtle)] transition-[background-color,color] ' +
  'duration-(--dur-fast) ease-standard hover:bg-surface-3 active:bg-surface-4 ' +
  'desk:hover:bg-tab-hover desk:active:bg-tab-hover ' +
  'data-[state=active]:bg-tab-active ' +
  'data-[state=active]:shadow-[inset_0_1px_0_0_var(--tab-accent-top),inset_1px_0_0_0_var(--border-subtle),inset_-1px_0_0_0_var(--border-subtle)] ' +
  'first:data-[state=active]:shadow-[inset_0_1px_0_0_var(--tab-accent-top),inset_-1px_0_0_0_var(--border-subtle)] ' +
  'data-[state=active]:hover:bg-tab-active data-[state=active]:active:bg-tab-active'

// `tab-strip`, `tab__label`, `tab__close` are styling-free QA selectors, kept when their rules became utilities.
const TAB_LABEL =
  'tab__label flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-tab leading-[1.2] ' +
  // Desk stays weight 400 always (VS Code never bolds a tab) so activating one can't reflow the strip.
  'font-medium desk:font-normal group-data-[state=active]:font-semibold desk:group-data-[state=active]:font-normal ' +
  'text-tab-inactive-fg group-data-[state=active]:text-tab-active-fg'

// No hit-area expansion (unlike IconButton): the close slot sits flush against the tab's
// edge, and an expanded invisible zone would steal taps meant for the next tab over.
// Dirty dot is `background: currentColor`, so dot/×/label always share one tone.
// Press-shrink is touch-only furniture, dropped on desk hover.
const TAB_CLOSE =
  'tab__close grid place-items-center flex-none size-tab-close -mr-2 desk:mr-0 rounded-sm desk:rounded-[5px] leading-none ' +
  'text-text-2 group-data-[state=active]:text-text-1 ' +
  'touch-manipulation cursor-pointer hover:text-text-1 hover:bg-surface-4 desk:hover:bg-(--toolbar-hover-bg) ' +
  'active:text-text-1 active:bg-surface-4 desk:active:bg-(--toolbar-hover-bg) active:scale-92 desk:active:scale-100 ' +
  'transition-opacity duration-(--dur-fast) ease-standard'

// Fine-pointer only: an inactive clean tab hides its × until hovered/focused. Active and
// dirty tabs stay always-on — hiding the dirty dot would hide the one unsaved-work signal.
const TAB_CLOSE_REVEAL =
  ' desk:opacity-0 desk:group-hover:opacity-100 desk:group-focus-within:opacity-100'

/**
 * Active tab: 1px top accent rule, white label, no bottom divider into the editor —
 * unambiguous in greyscale and sunlight. Adds what was missing from a basic tab strip:
 * middle-click to close, Cmd/Ctrl+W, Close-others/-all, and a dirty dot that becomes a ×.
 */
export function Tabs({ project, tabs, activePath, onSelect, onClose, runControl, moreItems }: TabsProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; path: string } | null>(null)
  const [actionsAnchor, setActionsAnchor] = useState<MenuAnchor | null>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  // Scroll the strip directly — scrollIntoView also scrolls ancestors, shoving the page sideways.
  useEffect(() => {
    const strip = stripRef.current
    const el = activeRef.current
    if (!strip || !el) return
    const left = el.offsetLeft
    const right = left + el.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
  }, [activePath, tabs.length])

  // Scrollbar is hidden (10px out of 44px), so an edge fade signals "more tabs that way" instead.
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

  // Cmd/Ctrl+W now lives in App.tsx's command registry with every other shortcut, not here.

  const menuItems = (path: string): MenuItem[] => {
    const { name } = splitPath(path)
    return [
      { label: COPY.tabsClose(name), icon: <IconClose />, onSelect: () => onClose(path) },
      {
        label: COPY.tabsCloseOthers,
        disabled: tabs.length < 2,
        onSelect: () => {
          for (const t of tabs) if (t !== path) onClose(t)
        },
      },
      {
        label: COPY.tabsCloseAll,
        onSelect: () => {
          for (const t of [...tabs]) onClose(t)
        },
      },
    ]
  }

  // VS Code's Run/⋯ corner. Sits OUTSIDE [role="tablist"] so tab counts are unaffected,
  // and carries its own background/divider so the bar still reads as one piece.
  const trailing =
    runControl || moreItems ? (
      <div
        className={
          'flex items-center gap-1 flex-none px-1 bg-surface-2 ' +
          'shadow-[inset_0_-1px_0_0_var(--border-subtle)]'
        }
      >
        {runControl ? <RunControl run={runControl} placement="tabs" /> : null}
        {moreItems?.length ? (
          <IconButton
            label={COPY.tabsMore}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setActionsAnchor({ x: r.right, y: r.bottom + 4, fromRight: true })
            }}
          >
            <IconMore />
          </IconButton>
        ) : null}
        {actionsAnchor && moreItems ? (
          <Menu anchor={actionsAnchor} items={moreItems} label={COPY.a11yMoreActions} onClose={() => setActionsAnchor(null)} />
        ) : null}
      </div>
    ) : null

  // No open editors → no strip at all (VS Code parity); the editor column just gets that height back.
  if (tabs.length === 0) return null

  return (
    <div className="flex flex-none">
      {/* Own positioning context so the edge fades mark the scroller's edges, not the trailing group. */}
      <div className="relative min-w-0 flex-1">
        <div ref={stripRef} role="tablist" aria-label={COPY.a11yOpenFiles} className={STRIP + ' select-none'}>
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
            className="pointer-events-none absolute inset-y-0 start-0 w-5 bg-linear-to-r rtl:bg-linear-to-l from-surface-2 to-transparent"
          />
        ) : null}
        {overflow.end ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 end-0 w-5 bg-linear-to-l rtl:bg-linear-to-r from-surface-2 to-transparent"
          />
        ) : null}
      </div>

      {trailing}

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
      // Middle-click closes; mousedown must be swallowed too or Windows Chrome's autoscroll jumps the strip.
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
      {/* One slot, always present, so activating/dirtying a tab never shifts the label. Touch
          shows the × always (no hover to reveal it); only desk plays hide-until-hover (REVEAL). */}
      <button
        type="button"
        aria-label={dirty ? COPY.tabsCloseUnsaved(name) : COPY.tabsClose(name)}
        className={TAB_CLOSE + (active || dirty ? '' : TAB_CLOSE_REVEAL)}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        {dirty ? (
          <span aria-hidden="true" className="dot-dirty group-hover:hidden group-focus-within:hidden" />
        ) : null}
        <IconClose size={16} className={dirty ? 'hidden group-hover:block group-focus-within:block' : undefined} />
      </button>
    </div>
  )
}
