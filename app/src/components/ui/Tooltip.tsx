import * as RTooltip from '@radix-ui/react-tooltip'
import { cx } from 'class-variance-authority'
import { createContext, useContext, type ReactNode } from 'react'

/**
 * 12px is the app's absolute type floor (--fs-micro), and a tooltip is the one
 * place tempted to go under it. `pointer-events-none` because a tooltip
 * explains the control the pointer is already on and must never become the
 * thing the pointer hits. The four data-side pairs share the menu's pop
 * animation, so a tooltip and a menu leaving the same button move alike.
 */
const PANEL = cx(
  'pointer-events-none z-(--z-menu) max-w-[18rem] rounded-sm border border-border-subtle bg-surface-4',
  'px-2 py-1 text-micro leading-[1.4] text-text-1 shadow-raised',
  'origin-(--radix-popper-transform-origin)',
  'data-[state=delayed-open]:data-[side=top]:animate-pop-from-bottom',
  'data-[state=delayed-open]:data-[side=bottom]:animate-pop-from-top',
  'data-[state=delayed-open]:data-[side=left]:animate-pop-from-right',
  'data-[state=delayed-open]:data-[side=right]:animate-pop-from-left',
  'data-[state=instant-open]:data-[side=top]:animate-pop-from-bottom',
  'data-[state=instant-open]:data-[side=bottom]:animate-pop-from-top',
  'data-[state=instant-open]:data-[side=left]:animate-pop-from-right',
  'data-[state=instant-open]:data-[side=right]:animate-pop-from-left',
  'data-[state=closed]:animate-fade-out',
)

/**
 * The replacement for `title=""`.
 *
 * A native title attribute waits about a second, renders in the OS's font at
 * the OS's size, cannot be styled, and on a touch device never appears at all —
 * which is most of Warsha's traffic. This is the same label in our own tokens,
 * on our own clock.
 *
 * IT DOES NOT REPLACE AN ACCESSIBLE NAME. `IconButton` carries `aria-label`, and
 * that is what a screen reader announces; a tooltip is a sighted-pointer
 * affordance layered on top. Wrapping a control that has no accessible name in a
 * Tooltip does not give it one.
 *
 *   <Tooltip label="Collapse all folders">
 *     <IconButton label="Collapse all folders">…</IconButton>
 *   </Tooltip>
 *
 * Nothing consumes this yet — the chrome still uses `title=` — so adopting it is
 * a call site's decision, one control at a time.
 */

/** Whether a real provider is above us. Radix throws without one, and asking
 *  every call site to remember that is how a tooltip ships broken. */
const HasProvider = createContext(false)

/** Group tooltips so that, once one has opened, its neighbours skip the delay —
 *  the behaviour that makes a row of icon buttons feel like a toolbar rather
 *  than a set of independent controls. Optional: a lone Tooltip provides its
 *  own. */
export function TooltipProvider({
  children,
  delayDuration = 400,
  skipDelayDuration = 300,
}: {
  children: ReactNode
  delayDuration?: number
  skipDelayDuration?: number
}) {
  return (
    <HasProvider value={true}>
      <RTooltip.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration}>
        {children}
      </RTooltip.Provider>
    </HasProvider>
  )
}

export interface TooltipProps {
  /** The text. Keep it to a few words — a tooltip is a reminder, not help. */
  label: ReactNode
  /** The control it describes. Must accept a ref and spread its props. */
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Distance from the control, in px. */
  sideOffset?: number
  delayDuration?: number
  /** Draw the little pointer at the control. Off by default: at 12px type it
   *  reads as a smudge more often than as a pointer. */
  arrow?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Tooltip({
  label,
  children,
  side = 'top',
  sideOffset = 6,
  delayDuration,
  arrow = false,
  open,
  defaultOpen,
  onOpenChange,
}: TooltipProps) {
  const inner = (
    <RTooltip.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} delayDuration={delayDuration}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={sideOffset} collisionPadding={8} className={PANEL}>
          {label}
          {arrow ? <RTooltip.Arrow className="fill-surface-4" width={10} height={5} /> : null}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )

  return useContext(HasProvider) ? inner : <TooltipProvider>{inner}</TooltipProvider>
}
