import * as RMenu from '@radix-ui/react-dropdown-menu'
import { cva, cx } from 'class-variance-authority'
import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { IconChevronRight } from './Icons'
import { useMedia } from '../../hooks/useMedia'
import { COPY } from '../../copy'
import { dirOf, locale } from '../../i18n/locale'

/** A side flyout needs a pointer that can hover and aim at it. */
const CAN_FLYOUT = '(hover: hover) and (pointer: fine)'

/** …and the room to sit BESIDE its parent (~280px panel + ~200px child) —
 *  below this width they can't fit side by side regardless of pointer. */
const FLYOUT_ROOM = '(min-width: 700px)'

/**
 * Whether a trigger menu must navigate submenus IN PLACE instead of flying
 * them out — VS Code's mobile-web pattern for a submenu with nowhere to go.
 *
 * BOTH conditions matter: pointer-only checking flew the submenu off-screen
 * (`left: -108px`) on a narrow window with a mouse (laptop/devtools) — it
 * passes the pointer test but lacks the room. The pointer test stays too: a
 * coarse pointer can't aim across a flyout's diagonal even with room.
 *
 * Lives here, not in MenuBar: every submenu-holding menu needs it, including
 * the activity bar's Manage gear.
 */
export function useDrillIn(): boolean {
  const canFlyout = useMedia(CAN_FLYOUT)
  const hasRoom = useMedia(FLYOUT_ROOM)
  return !canFlyout || !hasRoom
}

/**
 * Reading direction, passed to every Radix root explicitly — Radix ignores
 * `<html dir>` and resolves from a `dir` prop or `DirectionProvider` context,
 * but Vite pre-bundles `@radix-ui/react-direction` into more than one chunk,
 * so the App-root provider and the menu can hold different context objects.
 * The prop sidesteps that.
 *
 * Called during render, not hoisted to a module constant, so a language
 * switch (which re-renders) moves the menus with it.
 */
const menuDir = () => dirOf(locale())

export interface MenuItem {
  /** Reconciliation key — give one when the label can repeat (user-typed project
   *  names collide, e.g. two "Homework"s). Falls back to label for fixed rows. */
  id?: string
  label: string
  /** Absent on a submenu parent — `items` is what that row does. */
  onSelect?: () => void
  /** Destructive: red ink, sorted last, behind a divider (spec §5.2). */
  danger?: boolean
  /** 20px leading glyph. Decorative — the label always carries the meaning. */
  icon?: ReactNode
  /** Trailing hint: a keyboard shortcut, or a count. */
  hint?: string
  /** Draws a divider above this item, so related actions read as one group. */
  startsGroup?: boolean
  disabled?: boolean
  /** A submenu (File > Open Recent) — via Radix Sub/SubTrigger/SubContent, so
   *  hover/ArrowRight/ArrowLeft all come from Radix, not hand-rolled. */
  items?: MenuItem[]
  /** A custom CONTROL row (e.g. the Manage gear's scale slider) rendered verbatim,
   *  not as a Radix Item — it never select-and-closes, and roving focus skips it.
   *  Caller owns layout/keydown handling. Wins over `onSelect`/`items`; `label`/
   *  `startsGroup` still apply. */
  render?: ReactNode
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

/** DENSITY media (index.css): fine-pointer desktop dismisses instantly — the
 *  90ms exit is touch-only furniture (VS Code menus vanish on release). */
const DESK_MQ = '(min-width: 900px) and (hover: hover) and (pointer: fine)'

/**
 * `origin-(--radix-popper-transform-origin)` grows the 0.98 scale out of the
 * trigger, not the panel's middle; the four data-side pairs match Radix's
 * flip-side rewrites so the animation direction follows for free.
 *
 * At desk: VS Code's --menu-* tokens/5px radius, pop animation off entirely —
 * `desk:animate-none!` needs the bang since the pop classes out-specify a
 * plain override.
 */
const PANEL = cx(
  'z-(--z-menu) min-w-[13rem] rounded-md border border-border-subtle bg-surface-3 p-1 shadow-raised',
  'desk:rounded-[5px] desk:border-(--menu-border) desk:bg-(--menu-bg)',
  /* Height is the SMALLER of the viewport and Radix's room to the anchor — long
   * menus scroll (`scroller`) instead of overflowing on a phone. Fallbacks only
   * cover the first frame, before the size middleware writes real values. */
  'scroller max-h-[min(calc(var(--app-h,100dvh)-var(--sp-4)),var(--radix-popper-available-height,100dvh))]',
  'max-w-[min(20rem,calc(100vw-var(--sp-4)),var(--radix-popper-available-width,100vw))]',
  'origin-(--radix-popper-transform-origin)',
  'data-[state=open]:data-[side=top]:animate-pop-from-bottom',
  'data-[state=open]:data-[side=bottom]:animate-pop-from-top',
  'data-[state=open]:data-[side=left]:animate-pop-from-right',
  'data-[state=open]:data-[side=right]:animate-pop-from-left',
  'data-[state=closed]:animate-pop-out',
  'desk:animate-none!',
)

/**
 * Hover/press fills are gated on `enabled:`, not undone by a later `disabled:`
 * rule — so source order can't make them fight; a disabled row just has no
 * hover state to lose.
 *
 * At desk: VS Code-style selection fills --menu-sel-bg/--menu-sel-fg, replacing
 * the touch surface-4 hover. `data-[highlighted]` is Radix's roving highlight;
 * `data-[state=open]` keeps a submenu's parent lit while its child is out.
 */
const row = cva(
  cx(
    'group/item flex min-h-touch w-full cursor-pointer items-center gap-3 rounded-sm px-3 text-start text-row',
    'desk:min-h-[26px] desk:text-[13px]',
    'touch-manipulation transition-colors duration-(--dur-fast) ease-standard',
    'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-text-disabled',
  ),
  {
    variants: {
      /* Destructive actions stay away from frequent ones: Delete goes last, divided, red (spec §5.2). */
      tone: {
        normal: cx(
          'text-text-1 enabled:hover:bg-surface-4 enabled:active:bg-surface-4',
          'desk:enabled:hover:bg-(--menu-sel-bg) desk:enabled:hover:text-(--menu-sel-fg)',
          'desk:enabled:active:bg-(--menu-sel-bg) desk:enabled:active:text-(--menu-sel-fg)',
          'desk:data-[highlighted]:bg-(--menu-sel-bg) desk:data-[highlighted]:text-(--menu-sel-fg)',
          'desk:data-[state=open]:bg-(--menu-sel-bg) desk:data-[state=open]:text-(--menu-sel-fg)',
        ),
        danger: 'text-danger enabled:hover:bg-danger-soft enabled:active:bg-danger-soft',
      },
    },
    defaultVariants: { tone: 'normal' },
  },
)

/** Icon slot is reserved even when empty, so labels don't shift as the eye runs
 *  down. 20px is spec §5.2's glyph size, not a spacing step (`size-5` is 24px
 *  via --sp-5). Takes the selection ink too, at desk. */
const ICON = cx(
  'grid size-[20px] flex-none place-items-center text-text-3',
  'group-hover/item:text-text-2 group-disabled/item:text-text-disabled!',
  'desk:group-hover/item:text-(--menu-sel-fg) desk:group-data-[highlighted]/item:text-(--menu-sel-fg)',
)
const LABEL = 'min-w-0 flex-1 truncate'
const HINT = cx(
  'ms-4 flex-none text-micro tabular-nums text-text-3 group-disabled/item:text-text-disabled!',
  'desk:ml-auto desk:text-[13px] desk:text-text-2',
  'desk:group-hover/item:text-(--menu-sel-fg) desk:group-data-[highlighted]/item:text-(--menu-sel-fg)',
)
/** Submenu marker — same trailing slot as HINT, but a glyph. */
const SUB_HINT = cx(
  // `rtl:-scale-x-100`: this glyph shows direction, not decoration — Radix flies the child out the trailing side, which is LEFT in Arabic.
  'ms-auto flex-none text-text-3 rtl:-scale-x-100',
  'desk:group-hover/item:text-(--menu-sel-fg) desk:group-data-[highlighted]/item:text-(--menu-sel-fg)',
)
const SEPARATOR = 'm-2 border-t border-border-subtle desk:border-(--menu-sep)'

/** Dropdown and context menus share the same Item/Sub/Separator contract, so rows are written once for either family. */
interface RowParts {
  Item: ComponentType<{
    asChild?: boolean
    disabled?: boolean
    onSelect?: (event: Event) => void
    children?: ReactNode
  }>
  Separator: ComponentType<{ className?: string }>
  Sub: ComponentType<{ children?: ReactNode }>
  SubTrigger: ComponentType<{ asChild?: boolean; disabled?: boolean; children?: ReactNode }>
  SubContent: ComponentType<{
    className?: string
    avoidCollisions?: boolean
    collisionPadding?: number
    sticky?: 'partial' | 'always'
    sideOffset?: number
    children?: ReactNode
  }>
  Portal: ComponentType<{ children?: ReactNode }>
}

/**
 * `plain` drops the leading icon column — menu-bar dropdowns have no icon
 * gutter (VS Code reserves it for checkmarks only), desk-only, so touch menus
 * keep their 20px column.
 *
 * `drill` replaces the Radix Sub flyout (nowhere to go on a phone): the parent
 * row becomes a plain item that hands off to `drill`, and TriggerMenu re-renders
 * the same panel with the child rows plus a "‹ Back" row. Keeps its ▸ chevron
 * and aria-haspopup so it still reads as "leads somewhere".
 */
function rows(items: MenuItem[], parts: RowParts, plain = false, drill?: (item: MenuItem) => void): ReactNode {
  const { Item, Separator, Sub, SubTrigger, SubContent, Portal } = parts
  const ordered = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)]
  const firstDanger = ordered.findIndex((i) => i.danger)

  return ordered.map((item, i) => {
    const body = (
      <>
        {plain ? null : (
          <span aria-hidden="true" className={ICON}>
            {item.icon}
          </span>
        )}
        <span className={LABEL}>{item.label}</span>
        {item.hint ? <span className={HINT}>{item.hint}</span> : null}
      </>
    )

    return (
      <Fragment key={item.id ?? item.label}>
        {i > 0 && (item.startsGroup || i === firstDanger) ? <Separator className={SEPARATOR} /> : null}
        {item.render ? (
          /* Custom control row (see MenuItem.render) — no Radix Item wrapper, so it can't select-and-close the menu. */
          item.render
        ) : item.items && drill ? (
          /* Drill-in parent: preventDefault on select swaps the panel to the child's rows and keeps the menu open; ArrowRight mirrors it. */
          <Item
            asChild
            disabled={item.disabled || item.items.length === 0}
            onSelect={(e) => {
              e.preventDefault()
              drill(item)
            }}
          >
            <button
              type="button"
              aria-haspopup="menu"
              disabled={item.disabled}
              className={row({ tone: item.danger ? 'danger' : 'normal' })}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight') return
                e.preventDefault()
                drill(item)
              }}
            >
              {body}
              <span aria-hidden="true" className={SUB_HINT}>
                <IconChevronRight size={14} />
              </span>
            </button>
          </Item>
        ) : item.items ? (
          <Sub>
            {/* Real <button>, same reasons as Item below. Radix opens the child on hover/ArrowRight/Enter, closes on ArrowLeft; parent stays lit via data-state=open. */}
            <SubTrigger asChild disabled={item.disabled || item.items.length === 0}>
              <button
                type="button"
                disabled={item.disabled}
                className={row({ tone: item.danger ? 'danger' : 'normal' })}
              >
                {body}
                <span aria-hidden="true" className={SUB_HINT}>
                  <IconChevronRight size={14} />
                </span>
              </button>
            </SubTrigger>
            <Portal>
              {/* sticky="always": on a cramped screen the flyout detaches rather than leave the viewport; PANEL's cap makes an over-tall child scroll instead of overflowing. */}
              <SubContent
                className={PANEL}
                avoidCollisions
                collisionPadding={MARGIN}
                sticky="always"
                sideOffset={2}
              >
                {rows(item.items, parts, plain)}
              </SubContent>
            </Portal>
          </Sub>
        ) : (
          /* Real <button>, not Radix's div: `:disabled` greys it and drops it from tab order; QA selects `[role="menuitem"]`, which Radix applies to whatever element it's given. */
          <Item asChild disabled={item.disabled} onSelect={() => item.onSelect?.()}>
            <button
              type="button"
              disabled={item.disabled}
              className={row({ tone: item.danger ? 'danger' : 'normal' })}
            >
              {body}
            </button>
          </Item>
        )}
      </Fragment>
    )
  })
}

/**
 * Long-press / overflow menu, on Radix DropdownMenu.
 *
 * These open at a POINT (right-click, long-press, a button's corner), so Radix
 * gets a zero-size trigger parked at the anchor — it then derives the flip,
 * edge-shift and grow-corner that the old hand-rolled measure-then-place pass
 * did manually, without needing an invisible measuring frame.
 *
 * Arrow keys, Home/End and type-ahead come from Radix's roving focus.
 */
export function Menu({
  anchor,
  items,
  onClose,
  label,
  plain,
}: {
  anchor: MenuAnchor
  items: MenuItem[]
  onClose: () => void
  label: string
  /** No leading icon column — see `rows`. Desk-only menu surfaces set this. */
  plain?: boolean
}) {
  const [open, setOpen] = useState(true)
  const exit = useRef(0)

  // Re-opened at a new point while the last one was still fading — caller keeps this Menu mounted and swaps `anchor`.
  useEffect(() => {
    clearTimeout(exit.current)
    setOpen(true)
  }, [anchor])

  useEffect(() => () => clearTimeout(exit.current), [])

  // Caller unmounts on onClose, and an unmounted panel can't animate out — so
  // this closes now and tells the caller once the exit plays (immediately at desk).
  const close = () => {
    setOpen(false)
    clearTimeout(exit.current)
    if (window.matchMedia(DESK_MQ).matches) onClose()
    else exit.current = window.setTimeout(onClose, EXIT_MS)
  }

  return (
    <RMenu.Root
      dir={menuDir()}
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
      // Not modal — a modal Radix menu locks body scroll and blanks pointer events app-wide, more than a row menu should cost. Escape/outside-press still dismiss.
      modal={false}
    >
      <RMenu.Trigger asChild>
        {/* Zero-size, untouchable marker — exists only so Radix's positioner has something to measure from. */}
        <span
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed size-0 border-0 bg-transparent p-0"
          // Anchor coords are viewport px, but this marker renders inside the zoomed
          // #root (index.css view scale) — divide out --ui-scale or point-opened menus
          // drift toward the origin at scale < 1. The PANEL itself portals to <body>,
          // outside the zoom, and needs no adjustment.
          style={{
            left: `calc(${anchor.x}px / var(--ui-scale, 1))`,
            top: `calc(${anchor.y}px / var(--ui-scale, 1))`,
          }}
        />
      </RMenu.Trigger>

      <RMenu.Portal>
        <RMenu.Content
          aria-label={label}
          // Radix aims this at the trigger, an empty marker with no name — cleared so aria-label is what's read.
          aria-labelledby={undefined}
          side="bottom"
          align={anchor.fromRight ? 'end' : 'start'}
          sideOffset={0}
          avoidCollisions
          collisionPadding={MARGIN}
          sticky="always"
          // Stops Escape reaching the shell's own handler (which would also close the
          // drawer underneath) — capture-phase, so stopping here is enough; not
          // preventDefault, so Radix still dismisses.
          onEscapeKeyDown={(e) => e.stopPropagation()}
          // Nothing to hand focus back to — the marker isn't a real control, and the opening row is often gone (Rename replaces it with a self-focusing field).
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={PANEL}
        >
          {rows(items, RMenu, plain)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

/**
 * Same panel and rows, opened from a REAL trigger (menu bar). Unlike `Menu`
 * above, Radix hands focus back to the trigger on close — the "Escape returns
 * focus to the title" behaviour a menu bar owes its keyboard user.
 *
 * Controlled: the menu bar coordinates several of these (ArrowLeft/ArrowRight,
 * pointerenter moving the one open menu between titles).
 *
 * `drillIn`: VS Code's mobile-web pattern — a submenu parent (File) swaps the
 * panel's rows for its children plus a "‹ Back" row, so nothing opens beside
 * the panel or off a phone's screen. ArrowRight drills, ArrowLeft backs out;
 * the path resets on every close.
 */
export function TriggerMenu({
  trigger,
  items,
  label,
  open,
  onOpenChange,
  plain,
  drillIn,
}: {
  trigger: ReactNode
  items: MenuItem[]
  label: string
  open: boolean
  onOpenChange(open: boolean): void
  plain?: boolean
  /** In-place submenu navigation instead of side flyouts (coarse pointers). */
  drillIn?: boolean
}) {
  /* Open submenu trail, root-first, as item KEYS — App rebuilds menu arrays every render, so object identity goes stale immediately. */
  const [path, setPath] = useState<string[]>([])
  const content = useRef<HTMLDivElement | null>(null)
  const refocus = useRef(false)

  /* Rows just swapped under the user after a drill/back — hand focus to the first
   * row so arrows/type-ahead keep working and focus can't fall out (dismissing
   * the menu). Runs every render, acts only when a handler armed it. */
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    content.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled):not([data-menu-back])')
      ?.focus()
  })

  const level = drillIn ? levelOf(items, path) : items
  const enter = (item: MenuItem) => {
    refocus.current = true
    setPath((p) => [...p, item.id ?? item.label])
  }
  const back = () => {
    refocus.current = true
    setPath((p) => p.slice(0, -1))
  }

  return (
    <RMenu.Root
      dir={menuDir()}
      open={open}
      onOpenChange={(next) => {
        if (!next) setPath([])
        onOpenChange(next)
      }}
      modal={false}
    >
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          ref={content}
          aria-label={label}
          side="bottom"
          align="start"
          sideOffset={0}
          avoidCollisions
          collisionPadding={MARGIN}
          sticky="always"
          onEscapeKeyDown={(e) => e.stopPropagation()}
          onKeyDown={
            drillIn && path.length > 0
              ? (e) => {
                  if (e.key !== 'ArrowLeft' || e.defaultPrevented) return
                  e.preventDefault()
                  back()
                }
              : undefined
          }
          className={PANEL}
        >
          {drillIn && path.length > 0 ? (
            <>
              <RMenu.Item
                asChild
                onSelect={(e) => {
                  e.preventDefault()
                  back()
                }}
              >
                <button type="button" data-menu-back className={row({ tone: 'normal' })}>
                  {plain ? null : <span aria-hidden="true" className={ICON} />}
                  {/* Own element so `rtl:-scale-x-100` can flip it — "back" points the
                      other way in Arabic, and a "‹" baked into the string couldn't flip. */}
                  <span className={LABEL}>
                    <span aria-hidden="true" className="inline-block rtl:-scale-x-100">‹</span> {COPY.menuBack}
                  </span>
                </button>
              </RMenu.Item>
              <RMenu.Separator className={SEPARATOR} />
            </>
          ) : null}
          {rows(level, RMenu, plain, drillIn ? enter : undefined)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

/** Walk a drill path (item keys, root-first) down the tree. A stale key (menu
 *  rebuilt without it, e.g. a mid-open rename) falls back to the root instead of crashing. */
function levelOf(items: MenuItem[], path: string[]): MenuItem[] {
  let level = items
  for (const key of path) {
    const next = level.find((it) => (it.id ?? it.label) === key)?.items
    if (!next) return items
    level = next
  }
  return level
}
