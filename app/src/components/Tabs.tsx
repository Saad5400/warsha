import { useEffect, useRef } from 'react'
import type { Project } from '../fs/project'
import { splitPath } from '../fs/project'
import { FileBadge } from './FileBadge'

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
 * and in sunlight. The fill change carries none of the load.
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

  if (tabs.length === 0) return <div className="h-bar shrink-0 border-b border-border-subtle bg-surface-2" />

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label="Open files"
      className="flex h-bar shrink-0 overflow-x-auto overflow-y-hidden border-b border-border-subtle bg-surface-2 [scrollbar-width:none] [&::-webkit-scrollbar]:h-0"
      style={{ scrollSnapType: 'x proximity' }}
    >
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
            className={
              'tap flex h-full min-w-[6rem] max-w-[60vw] shrink-0 cursor-pointer items-center gap-2 ' +
              'border-b-rail px-3 ' +
              (active
                ? 'border-accent bg-surface-1 text-text-1'
                : 'border-transparent bg-surface-2 text-text-2 hover:bg-surface-3')
            }
            style={{ scrollSnapAlign: 'end' }}
          >
            <FileBadge name={name} />
            <span className={'flex-1 truncate text-tab ' + (active ? 'font-semibold' : 'font-medium')}>{name}</span>
            {dirty ? (
              <span aria-label="Unsaved changes" className="size-[6px] shrink-0 rounded-pill bg-accent" />
            ) : (
              // Close only on the active tab below 900px: an × on every tab in a
              // 390px strip is a mis-tap generator.
              <button
                type="button"
                aria-label={`Close ${name}`}
                className={
                  'tap grid size-touch shrink-0 place-items-center rounded-sm text-[14px] text-text-3 ' +
                  'hover:text-text-1 active:bg-surface-4 ' +
                  (active ? '' : 'hidden min-[900px]:grid')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(path)
                }}
              >
                ✕
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
