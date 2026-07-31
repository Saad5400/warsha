import { useEffect, useRef } from 'react'
import type { Project } from '../fs/project'
import { splitPath } from '../fs/project'
import { FileBadge } from './FileBadge'
import { IconClose } from './ui/Icons'

export interface TabsProps {
  project: Project
  tabs: string[]
  activePath: string | null
  onSelect(path: string): void
  onClose(path: string): void
}

/**
 * Active tab carries three simultaneous signals (spec §7.2) — a 2px accent rule
 * on the bottom edge, weight 600, and text-1 — so it is unambiguous in greyscale
 * and in sunlight. The fill change to surface-1 makes the tab visually own the
 * editor canvas below it, and carries none of the load. All of that lives in
 * `.tab[data-state]` in index.css.
 */
export function Tabs({ project, tabs, activePath, onSelect, onClose }: TabsProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)

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

  if (tabs.length === 0) return <div className="tab-strip" />

  return (
    <div ref={stripRef} role="tablist" aria-label="Open files" className="tab-strip">
      {tabs.map((path) => {
        const { name } = splitPath(path)
        const active = path === activePath
        const dirty = project.isDirty(path)
        return (
          <div
            key={path}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            title={path}
            onClick={() => onSelect(path)}
            className="tab"
          >
            <FileBadge name={name} />
            <span className="tab__label">{name}</span>
            {dirty ? (
              <span aria-label="Unsaved changes" className="dot-dirty" />
            ) : (
              // Close only on the active tab below 900px: an × on every tab in a
              // 390px strip is a mis-tap generator.
              <button
                type="button"
                aria-label={`Close ${name}`}
                className={'tab__close' + (active ? '' : ' hidden min-[900px]:grid')}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(path)
                }}
              >
                <IconClose size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
