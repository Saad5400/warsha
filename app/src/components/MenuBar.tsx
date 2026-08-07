import { useEffect, useRef, useState } from 'react'
import { useMedia } from '../hooks/useMedia'
import { IconButton } from './ui/Button'
import { IconMenu } from './ui/Icons'
import { TriggerMenu, useDrillIn, type MenuItem } from './ui/Menu'
import { COPY } from '../copy'

/** One top-level menu: its title and its dropdown. Built by App, which owns
 *  every action the rows call. */
export interface MenuBarMenu {
  label: string
  items: MenuItem[]
}

/** Below this width five titles no longer fit beside the centred window title,
 *  so the bar collapses to VS Code's single ☰ trigger. */
const COLLAPSE = '(min-width: 1050px)'

// --toolbar-hover-bg is shared with the toolbar-icon hover (global token dedupe).
// Radix stamps data-state=open on the trigger, so the open menu's title stays filled.
const TITLE_BTN =
  'flex h-full flex-none items-center px-2 rounded-[4px] text-[13px] leading-none text-(--titlebar-fg) ' +
  'cursor-pointer select-none whitespace-nowrap transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:bg-(--toolbar-hover-bg) data-[state=open]:bg-(--toolbar-hover-bg)'

/**
 * VS Code's menu bar; collapses to a single ☰ trigger below 1050px (also the phone path).
 *
 * Keyboard: titles share one roving tabindex (Arrow/Home/End move between them);
 * Down/Enter/Space opens the focused title; while open, Arrow keys close and open the
 * neighbour unless a Radix submenu already claimed the key; pointerenter on a sibling
 * title switches menus. Alt-mnemonics are skipped (browsers own Alt).
 */
export function MenuBar({ menus }: { menus: MenuBarMenu[] }) {
  const wide = useMedia(COLLAPSE)
  const drillIn = useDrillIn()
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const anyOpen = openMenu !== null

  // ArrowLeft/Right bubble out of Radix (which only claims vertical arrows, Escape, and the submenu pair) and land here.
  useEffect(() => {
    if (!anyOpen) return
    const n = menus.length
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 1 : -1
      setOpenMenu((cur) => (cur === null ? cur : (cur + delta + n) % n))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyOpen, menus.length])

  // Below 1050px: single ☰ trigger; its dropdown lists the titles as submenus.
  // Accessible name is a translated QA contract — suites pin English via ?lang=en (see fromUrl() in i18n/locale.ts).
  // kb class compacts this button with the title bar below 900px while the keyboard is up.
  if (!wide) {
    return (
      <TriggerMenu
        open={appMenuOpen}
        onOpenChange={setAppMenuOpen}
        items={menus.map((m) => ({ label: m.label, items: m.items }))}
        label={COPY.a11yAppMenu}
        drillIn={drillIn}
        trigger={
          <IconButton label={COPY.a11yAppMenu} className="max-[899px]:kb-open:size-touch-kb">
            <IconMenu />
          </IconButton>
        }
      />
    )
  }

  const move = (to: number) => {
    setFocusIdx(to)
    buttons.current[to]?.focus()
  }

  const onTitleKeyDown = (i: number) => (e: React.KeyboardEvent) => {
    const n = menus.length
    if (e.key === 'ArrowRight') move((i + 1) % n)
    else if (e.key === 'ArrowLeft') move((i - 1 + n) % n)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(n - 1)
    else return
    e.preventDefault()
  }

  return (
    <div role="menubar" aria-label={COPY.a11yAppMenu} className="flex h-full items-stretch">
      {menus.map((m, i) => (
        <TriggerMenu
          key={m.label}
          open={openMenu === i}
          // Functional update guards against a late "close i" clobbering "open j" (event order isn't guaranteed).
          onOpenChange={(next) => {
            setOpenMenu((cur) => (next ? i : cur === i ? null : cur))
            if (next) setFocusIdx(i)
          }}
          items={m.items}
          label={`${m.label} menu`}
          trigger={
            <button
              type="button"
              role="menuitem"
              ref={(el) => {
                buttons.current[i] = el
              }}
              tabIndex={i === focusIdx ? 0 : -1}
              className={TITLE_BTN}
              onKeyDown={onTitleKeyDown(i)}
              onFocus={() => setFocusIdx(i)}
              onPointerEnter={() => {
                if (openMenu !== null && openMenu !== i) setOpenMenu(i)
              }}
            >
              {m.label}
            </button>
          }
        />
      ))}
    </div>
  )
}
