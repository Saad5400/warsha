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
  /**
   * Run/Stop for the strip's trailing group — VS Code's editor-actions corner,
   * Run's one home at every size (one shell, founder ruling; W1-B relocated it
   * out of the title bar). Same single state object as the console header, so
   * the two can never drift.
   */
  runControl?: RunControlState
  /**
   * The strip's "⋯" menu — file-scoped actions only (Format, Share as
   * image…). The app-scoped rows live in the menu bar.
   */
  moreItems?: MenuItem[]
}

const LONG_PRESS_MS = 500

/* The strip's bottom divider is an inset shadow, not a border: with border-box
 * sizing a 1px border eats into its 44px and every tab comes out 43px tall,
 * one pixel under the touch floor. A shadow costs no layout. It shows only on
 * the strip's empty tail — every tab's opaque background covers it, inactive
 * tabs redraw their own copy, and the ACTIVE tab deliberately doesn't, which
 * is what connects it to the editor (see TAB below). The scrollbar is hidden
 * because 10px out of a 44px row is not affordable — Tabs renders an edge fade
 * instead when the strip actually scrolls. `overscroll-x-contain` keeps a
 * momentum fling inside the strip: without it the scroll chains to the page
 * and iOS turns the tail of a swipe into back-navigation. */
const STRIP =
  'tab-strip flex flex-none h-bar-tabs overflow-x-auto overflow-y-hidden overscroll-x-contain bg-surface-2 ' +
  'shadow-[inset_0_-1px_0_0_var(--border-subtle)] snap-x snap-proximity ' +
  '[scrollbar-width:none] [&::-webkit-scrollbar]:h-0'

/* Active tab: VS Code's grammar — a 1px accent rule on the TOP edge, and the
 * bottom edge left open so the tab's fill (--tab-active-bg == the editor
 * canvas) runs seamlessly into the editor below. Inactive tabs carry their own
 * 1px bottom divider; the active tab simply omits it, and its opaque
 * background covers the STRIP's divider (a parent's inset shadow paints under
 * its children's backgrounds), which is what makes the seam disappear.
 *
 * Every rule here is an inset shadow, never a border: a border eats the box.
 * As `border-b-2` the old accent rule left the tab a 42px CONTENT box inside
 * its 44px border box and every centred child rode 1px high. A shadow costs no
 * layout, so nothing shifts when a tab activates.
 *
 * `first:` drops the leading divider on the leftmost tab. The sidebar already
 * draws its own 1px edge and the tab's `inset 1px` landed right next to it, so
 * the seam between the file tree and the first tab measured 2px of
 * --border-subtle where every other tab boundary measures 1px.
 *
 * The accent shadow is listed FIRST so it leads the computed box-shadow —
 * audit.mjs reads `rgb(0, 120, 212) 0px 1px 0px 0px inset` off the front. */
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

/* `tab-strip`, `tab__label` and `tab__close` are styling-free — tools/qa
 * selects all three, so they stayed behind when their rules became utilities. */
const TAB_LABEL =
  'tab__label flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-tab leading-[1.2] ' +
  // Touch keeps the weight pair (medium → semibold on activation); at desk the
  // weight is 400 always — VS Code never bolds a tab, the white fg + top rule
  // carry the state — so activating a tab cannot reflow the strip.
  'font-medium desk:font-normal group-data-[state=active]:font-semibold desk:group-data-[state=active]:font-normal ' +
  'text-tab-inactive-fg group-data-[state=active]:text-tab-active-fg'

// Founder ruling (P1): 44px → 40px, same as every other icon-only control.
// No hit-area expansion here (contrast IconButton in ui/Button.tsx): the
// close slot sits flush against the tab's own right edge (`-mr-2` pulls it
// into the tab's padding) with a 1px divider and the next tab immediately
// past it, so an expanded invisible zone would reach across that divider and
// steal a tap meant for opening the neighbour, not closing this one.
/* The slot inherits the label's ink (text-2, white on the active tab): the
 * dirty dot is `background: currentColor`, so dot, × and label always read as
 * one tone. Desk hover uses the shared toolbar-hover fill at VS Code's 5px
 * radius, and drops the press shrink — scale feedback is touch furniture. */
const TAB_CLOSE =
  'tab__close grid place-items-center flex-none size-tab-close -mr-2 desk:mr-0 rounded-sm desk:rounded-[5px] leading-none ' +
  'text-text-2 group-data-[state=active]:text-text-1 ' +
  'touch-manipulation cursor-pointer hover:text-text-1 hover:bg-surface-4 desk:hover:bg-(--toolbar-hover-bg) ' +
  'active:text-text-1 active:bg-surface-4 desk:active:bg-(--toolbar-hover-bg) active:scale-92 desk:active:scale-100 ' +
  'transition-opacity duration-(--dur-fast) ease-standard'

/* VSCode's close-button etiquette, fine pointers only: an inactive, clean tab
 * keeps its × hidden until the pointer (or keyboard focus) is on the tab. The
 * active tab and any dirty tab (whose slot holds the dot) stay always-on —
 * hiding the dirty dot would hide the one signal that work is unsaved. */
const TAB_CLOSE_REVEAL =
  ' desk:opacity-0 desk:group-hover:opacity-100 desk:group-focus-within:opacity-100'

/**
 * Active tab signals (spec §7.2, revised for VS Code parity): a 1px accent rule
 * on the TOP edge, a white label, and the editor-canvas fill running with no
 * bottom divider into the editor below — unambiguous in greyscale and in
 * sunlight. Touch additionally bolds the label; desk holds weight 400
 * throughout, as VS Code does.
 *
 * The behaviours a tab strip is expected to have and this one was missing:
 * middle-click to close, Cmd/Ctrl+W, a Close-others/Close-all menu, and a dirty
 * dot that turns into a close × when you reach for it.
 */
export function Tabs({ project, tabs, activePath, onSelect, onClose, runControl, moreItems }: TabsProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; path: string } | null>(null)
  const [actionsAnchor, setActionsAnchor] = useState<MenuAnchor | null>(null)
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

  // Cmd/Ctrl+W (close the file, not the browser tab) is no longer bound here:
  // it lives in App.tsx's command registry with every other shortcut, same
  // guard included — with nothing open the key is left to the browser.

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

  /* The editor-actions group: VS Code's Run/⋯ corner at the strip's trailing
   * edge, rendered at every size (one shell, founder ruling — this is Run's
   * one home). It sits OUTSIDE [role="tablist"], so tab counts are unaffected,
   * and carries the strip's own background + bottom divider so the bar reads
   * as one piece. The controls ride the density tokens: 40px boxes fit the
   * 44px touch bar, 28px fit --bar-tabs (35px) at desk, 3–4px clearance
   * either way. */
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

  // No open editors → no strip at all (VS Code parity). The editor column is a
  // flex stack, so the bar's absence just hands its height to the editor; the
  // trailing Run/⋯ group goes with it, exactly as VS Code's editor-actions
  // corner does when the last editor closes.
  if (tabs.length === 0) return null

  return (
    <div className="flex flex-none">
      {/* The scroller and its edge fades keep their own positioning context so
          the fades mark the SCROLLER's edges, not the whole bar's — the
          trailing group must never sit under a fade. */}
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
      {/* One --tab-close slot, always present, so activating or dirtying a tab
          never shifts its label. Unsaved shows the dot (currentColor — the
          slot's own ink); reaching for the slot turns it into the ×. On touch
          the × is always visible on every tab — there is no hover to reveal
          it, and the 96px min-width tab leaves the 40px slot honest room.
          Only desk plays VS Code's hide-until-hover etiquette (REVEAL). */}
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
