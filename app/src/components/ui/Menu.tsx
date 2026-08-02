import * as RContextMenu from '@radix-ui/react-context-menu'
import * as RMenu from '@radix-ui/react-dropdown-menu'
import { cva, cx } from 'class-variance-authority'
import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'

export interface MenuItem {
  /** Reconciliation key. Give one whenever the label can repeat — project names
   *  are user-typed, so two rows really can read "Homework". Falls back to the
   *  label, which is stable for the fixed rows. */
  id?: string
  label: string
  onSelect: () => void
  /** Destructive: red ink, sorted last, behind a divider (spec §5.2). */
  danger?: boolean
  /** 20px leading glyph. Decorative — the label always carries the meaning. */
  icon?: ReactNode
  /** Trailing hint: a keyboard shortcut, or a count. */
  hint?: string
  /** Draws a divider above this item, so related actions read as one group. */
  startsGroup?: boolean
  disabled?: boolean
}

export interface MenuAnchor {
  x: number
  y: number
  /** Right-align to x (used when opening from a trailing-edge button). */
  fromRight?: boolean
}

/** Clear space kept between the menu and every viewport edge. */
const MARGIN = 8

/** The 90ms exit plus a frame. See `close` below for why this exists. */
const EXIT_MS = 110

/**
 * The panel. `origin-(--radix-popper-transform-origin)` is what makes the 0.98
 * scale grow out of the trigger rather than out of the panel's own middle, and
 * the four data-side pairs pick the matching 4px direction — Radix rewrites
 * data-side when it flips the menu above its anchor, so the animation flips
 * with it for free.
 */
const PANEL = cx(
  'z-(--z-menu) min-w-[13rem] rounded-md border border-border-subtle bg-surface-3 p-1 shadow-raised',
  'scroller max-h-[calc(var(--app-h,100dvh)-var(--sp-4))] max-w-[min(20rem,calc(100vw-var(--sp-4)))]',
  'origin-(--radix-popper-transform-origin)',
  'data-[state=open]:data-[side=top]:animate-pop-from-bottom',
  'data-[state=open]:data-[side=bottom]:animate-pop-from-top',
  'data-[state=open]:data-[side=left]:animate-pop-from-right',
  'data-[state=open]:data-[side=right]:animate-pop-from-left',
  'data-[state=closed]:animate-pop-out',
)

/**
 * A row. The hover and press fills are gated on `enabled:` rather than undone
 * by a later `disabled:` rule, so the two can never fight over source order —
 * a disabled row simply has no hover state to lose.
 */
const row = cva(
  cx(
    'group/item flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-sm px-3 text-left text-row',
    'touch-manipulation transition-colors duration-(--dur-fast) ease-standard',
    'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-disabled',
  ),
  {
    variants: {
      /* Destructive actions are never adjacent to frequent ones: Delete is
         last, separated by a divider (spec §5.2), and red the whole way. */
      tone: {
        normal: 'text-text-1 enabled:hover:bg-surface-4 enabled:active:bg-surface-4',
        danger: 'text-danger enabled:hover:bg-danger-soft enabled:active:bg-danger-soft',
      },
    },
    defaultVariants: { tone: 'normal' },
  },
)

/** The icon slot is reserved whether or not a row has one, so labels do not step
 *  in and out as the eye runs down the menu. 20px is the spec §5.2 glyph size,
 *  not a spacing step — `size-5` would resolve to --sp-5, which is 24px. */
const ICON = cx(
  'grid size-[20px] flex-none place-items-center text-text-3',
  'group-hover/item:text-text-2 group-disabled/item:text-text-disabled!',
)
const LABEL = 'min-w-0 flex-1 truncate'
const HINT = 'ml-4 flex-none text-micro tabular-nums text-text-3 group-disabled/item:text-text-disabled!'
const SEPARATOR = 'm-2 border-t border-border-subtle'

/** Dropdown and context menus expose the same Item/Separator contract, so the
 *  rows are written once against whichever pair is in play. */
interface RowParts {
  Item: ComponentType<{
    asChild?: boolean
    disabled?: boolean
    onSelect?: (event: Event) => void
    children?: ReactNode
  }>
  Separator: ComponentType<{ className?: string }>
}

function rows(items: MenuItem[], { Item, Separator }: RowParts) {
  const ordered = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)]
  const firstDanger = ordered.findIndex((i) => i.danger)

  return ordered.map((item, i) => (
    <Fragment key={item.id ?? item.label}>
      {i > 0 && (item.startsGroup || i === firstDanger) ? <Separator className={SEPARATOR} /> : null}
      {/* A real <button>, not Radix's div: `:disabled` is how a dead row greys
          and how it leaves the tab order, and the app's QA selects
          `[role="menuitem"]`, which Radix puts on whatever element it is
          given. */}
      <Item asChild disabled={item.disabled} onSelect={() => item.onSelect()}>
        <button type="button" disabled={item.disabled} className={row({ tone: item.danger ? 'danger' : 'normal' })}>
          <span aria-hidden="true" className={ICON}>
            {item.icon}
          </span>
          <span className={LABEL}>{item.label}</span>
          {item.hint ? <span className={HINT}>{item.hint}</span> : null}
        </button>
      </Item>
    </Fragment>
  ))
}

/**
 * Long-press / overflow menu, on Radix DropdownMenu.
 *
 * These menus open at a POINT — a right-click, a long-press, the corner of a
 * button — and every caller already passes that point rather than wiring up a
 * trigger. Radix wants a trigger, so it gets a zero-size one parked at the
 * anchor; everything Radix then derives from it — the flip when there is no
 * room below, the shift away from a viewport edge, the corner the panel grows
 * out of — is what the hand-rolled measure-then-place pass used to do by hand,
 * minus the frame of invisibility it needed in order to measure.
 *
 * Arrow keys, Home/End and type-ahead now come from Radix's roving focus.
 */
export function Menu({
  anchor,
  items,
  onClose,
  label,
}: {
  anchor: MenuAnchor
  items: MenuItem[]
  onClose: () => void
  label: string
}) {
  const [open, setOpen] = useState(true)
  const exit = useRef(0)

  // Re-opened at a new point (a right-click on a second row) while the last one
  // was still fading: the caller keeps this Menu mounted and swaps `anchor`.
  useEffect(() => {
    clearTimeout(exit.current)
    setOpen(true)
  }, [anchor])

  useEffect(() => () => clearTimeout(exit.current), [])

  // The caller unmounts us the moment onClose fires, and an unmounted panel
  // cannot animate out — so the panel closes now, and the caller is told once
  // the exit has played.
  const close = () => {
    setOpen(false)
    clearTimeout(exit.current)
    exit.current = window.setTimeout(onClose, EXIT_MS)
  }

  return (
    <RMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      // Not modal: a modal Radix menu locks body scroll and blanks pointer
      // events app-wide, which is more than a row menu should cost. Escape and
      // an outside press still dismiss.
      modal={false}
    >
      <RMenu.Trigger asChild>
        {/* The marker a point-opened menu is anchored to. Zero-size and
            untouchable: it exists only to give Radix's positioner something to
            measure from. */}
        <span
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed size-0 border-0 bg-transparent p-0"
          style={{ left: anchor.x, top: anchor.y }}
        />
      </RMenu.Trigger>

      <RMenu.Portal>
        <RMenu.Content
          aria-label={label}
          // Radix aims this at the trigger, and the trigger is an empty marker
          // with no name to give. Cleared, so aria-label is what gets read.
          aria-labelledby={undefined}
          side="bottom"
          align={anchor.fromRight ? 'end' : 'start'}
          sideOffset={0}
          collisionPadding={MARGIN}
          // Escape must close the menu WITHOUT also reaching the shell's own
          // Escape handler and closing the drawer underneath it. Radix listens
          // in the capture phase, so stopping here stops the whole path — and
          // it is not preventDefault, so Radix still dismisses.
          onEscapeKeyDown={(e) => e.stopPropagation()}
          // Nothing to hand focus back to: the marker is not a real control, and
          // the row that opened the menu is often gone by now — Rename replaces
          // it with a field that focuses itself.
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={PANEL}
        >
          {rows(items, RMenu)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

/**
 * The same menu, opened the way a desktop expects: right-click or long-press
 * anywhere on `children`, with Radix owning the pointer handling.
 *
 * Nothing consumes this yet — Explorer and Tabs still capture the pointer
 * themselves and hand `Menu` a point — but it is the shape those call sites
 * should collapse into, and adopting it changes no row markup.
 */
export function ContextMenu({ items, label, children }: { items: MenuItem[]; label: string; children: ReactNode }) {
  return (
    <RContextMenu.Root modal={false}>
      <RContextMenu.Trigger asChild>{children}</RContextMenu.Trigger>
      <RContextMenu.Portal>
        <RContextMenu.Content
          aria-label={label}
          collisionPadding={MARGIN}
          onEscapeKeyDown={(e) => e.stopPropagation()}
          className={PANEL}
        >
          {rows(items, RContextMenu)}
        </RContextMenu.Content>
      </RContextMenu.Portal>
    </RContextMenu.Root>
  )
}
