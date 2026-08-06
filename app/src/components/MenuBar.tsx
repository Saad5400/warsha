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

/* A title: 13px --titlebar-fg, ~8px inline padding, full bar height, with the
 * hover/open fill VS Code gives it (--toolbar-hover-bg — the ONE token that is
 * also the toolbar-icon hover, per the global dedupe). Radix stamps
 * data-state=open on the trigger, so the open menu's title stays filled. */
const TITLE_BTN =
  'flex h-full flex-none items-center px-2 rounded-[4px] text-[13px] leading-none text-(--titlebar-fg) ' +
  'cursor-pointer select-none whitespace-nowrap transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:bg-(--toolbar-hover-bg) data-[state=open]:bg-(--toolbar-hover-bg)'

/**
 * VS Code's menu bar — File Edit View Run Help. Rendered by TopBar at EVERY
 * size (one shell, founder ruling): below 1050px it collapses itself to the
 * single ☰ "Application Menu" trigger — VS Code's own behaviour — which is
 * also how phones reach the same menus behind one 44px button.
 *
 * Keyboard model:
 *  - the titles are one tab stop (roving tabindex); ArrowLeft/Right, Home and
 *    End move between them while everything is closed;
 *  - Down/Enter/Space open the focused title (Radix's trigger handles those);
 *  - while a dropdown is open, ArrowLeft/Right close it and open the
 *    neighbour — unless a Radix submenu already claimed the key (checked via
 *    defaultPrevented, so ArrowLeft still closes File > Open Recent);
 *  - Escape closes and Radix hands focus back to the title.
 *  - pointerenter on a sibling title while any menu is open switches to it,
 *    which is the one behaviour that makes a menu bar feel like a menu bar.
 * Alt-mnemonics are skipped on purpose — browsers own Alt (VS Code web skips
 * them too).
 */
export function MenuBar({ menus }: { menus: MenuBarMenu[] }) {
  const wide = useMedia(COLLAPSE)
  const drillIn = useDrillIn()
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const [appMenuOpen, setAppMenuOpen] = useState(false)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const anyOpen = openMenu !== null

  // ArrowLeft/Right while a dropdown is open: the keydown bubbles out of the
  // Radix content (Radix only claims the keys it uses — vertical arrows,
  // Escape, and the submenu pair, which it preventDefaults) and lands here.
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

  // Below 1050px: one ☰ trigger whose dropdown lists the titles as submenus.
  // The accessible name is an aria contract (tools/qa opens the menu by it).
  // It is translated like every other label, so the suites pin English with
  // ?lang=en — see the note on fromUrl() in i18n/locale.ts.
  // The kb class: below 900px the title bar compacts to 40px while the
  // software keyboard is up, and this button compacts with it (--touch-kb).
  if (!wide) {
    return (
      <TriggerMenu
        open={appMenuOpen}
        onOpenChange={setAppMenuOpen}
        items={menus.map((m) => ({ label: m.label, items: m.items }))}
        label={COPY.a11yAppMenu}
        plain
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
          // Functional, because switching menus fires a dismiss for the old one
          // and an open for the new one in whichever order the pointer events
          // land — the guard keeps a late "close i" from clobbering "open j".
          onOpenChange={(next) => {
            setOpenMenu((cur) => (next ? i : cur === i ? null : cur))
            if (next) setFocusIdx(i)
          }}
          items={m.items}
          label={`${m.label} menu`}
          plain
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
