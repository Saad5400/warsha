import { useState } from 'react'
import { Logo } from './Logo'
import { IconButton } from './ui/Button'
import { IconMenu, IconMore } from './ui/Icons'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

export interface TopBarProps {
  onToggleExplorer(): void
  menuItems: MenuItem[]
  /** The file being edited. Rendered as the quiet top-bar title (spec §3.2). */
  title?: string | null
}

/**
 * Chrome that is tapped rarely may live at the top (principle 4) — the hamburger
 * and the overflow menu are the only two things up here. Run/Stop deliberately
 * does not live in the top-right; see RunBar.
 */
export function TopBar({ onToggleExplorer, menuItems, title }: TopBarProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  return (
    <header className="top-bar safe-x">
      <IconButton label="Files" onClick={onToggleExplorer}>
        <IconMenu />
      </IconButton>

      <span className="flex min-w-0 items-center gap-2">
        <Logo size={22} />
        <span className="top-bar__wordmark kb-hide">Warsha</span>
        {title ? (
          <>
            <span aria-hidden="true" className="top-bar__sep kb-hide" />
            <span className="top-bar__title kb-hide">{title}</span>
          </>
        ) : null}
      </span>

      <div className="ml-auto flex items-center pl-2">
        <IconButton
          label="More"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setAnchor({ x: r.right, y: r.bottom + 4, fromRight: true })
          }}
        >
          <IconMore />
        </IconButton>
      </div>

      {anchor ? (
        <Menu anchor={anchor} items={menuItems} label="Project menu" onClose={() => setAnchor(null)} />
      ) : null}
    </header>
  )
}
