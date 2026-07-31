import { useState } from 'react'
import { Logo } from './Logo'
import { IconButton } from './ui/Button'
import { Menu, type MenuAnchor, type MenuItem } from './ui/Menu'

export interface TopBarProps {
  onToggleExplorer(): void
  menuItems: MenuItem[]
}

export function TopBar({ onToggleExplorer, menuItems }: TopBarProps) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)

  return (
    <header
      className="flex h-full items-center gap-1 border-b border-border-subtle bg-surface-0 px-1"
      style={{
        paddingLeft: 'max(var(--sp-1), env(safe-area-inset-left))',
        paddingRight: 'max(var(--sp-1), env(safe-area-inset-right))',
      }}
    >
      <IconButton label="Files" onClick={onToggleExplorer}>
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </IconButton>

      <span className="flex min-w-0 items-center gap-2 pl-1">
        <Logo size={22} />
        <span className="kb-hide truncate text-btn font-semibold text-text-1">Warsha</span>
      </span>

      <div className="ml-auto flex items-center">
        <IconButton
          label="More"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setAnchor({ x: r.right, y: r.bottom + 4, fromRight: true })
          }}
        >
          ⋯
        </IconButton>
      </div>

      {anchor ? (
        <Menu anchor={anchor} items={menuItems} label="Project menu" onClose={() => setAnchor(null)} />
      ) : null}
    </header>
  )
}
