import * as RContextMenu from '@radix-ui/react-context-menu'
import * as RMenu from '@radix-ui/react-dropdown-menu'
import { cva, cx } from 'class-variance-authority'
import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { IconChevronRight } from './Icons'
import { useMedia } from '../../hooks/useMedia'
import { COPY } from '../../copy'
import { dirOf, locale } from '../../i18n/locale'

/** A side flyout needs a pointer that can hover and aim at it. */
const CAN_FLYOUT = '(hover: hover) and (pointer: fine)'

/** …and it needs the room to appear BESIDE its parent: a ~280px panel, its
 *  ~200px child, and the trigger they hang off. Below this the two cannot sit
 *  side by side however good the pointer is. */
const FLYOUT_ROOM = '(min-width: 700px)'

/**
 * Whether a trigger menu must navigate submenus IN PLACE instead of flying
 * them out — VS Code's mobile-web pattern, and the answer to a submenu with
 * nowhere to go.
 *
 * BOTH conditions matter, and only checking the pointer is what left the
 * language switch unreachable. A phone fails the pointer test and drills, but a
 * 390px window with a mouse — a laptop, a devtools viewport, the environment
 * this is tested in — passes it, flew the submenu out to `left: -108px`, and
 * put the rows off the edge of the screen. Room is the condition that actually
 * describes the failure; the pointer test stays because a coarse pointer cannot
 * aim across a flyout's diagonal even when the room exists.
 *
 * Lives here rather than in MenuBar because it is a fact about `TriggerMenu`:
 * every menu that can hold a submenu needs it, which now includes the activity
 * bar's Manage gear.
 */
export function useDrillIn(): boolean {
  const canFlyout = useMedia(CAN_FLYOUT)
  const hasRoom = useMedia(FLYOUT_ROOM)
  return !canFlyout || !hasRoom
}

/**
 * The reading direction, handed to every Radix root in this file explicitly.
 *
 * Radix does not look at `<html dir>`. It resolves direction from a `dir` prop
 * or from `DirectionProvider`'s React context — and the provider at the App
 * root is not enough on its own here, because Vite pre-bundles
 * `@radix-ui/react-direction` into more than one optimized chunk, so the
 * provider and the menu can end up holding two different context objects. The
 * prop is not subject to that: it is read straight off the module.
 *
 * Called during render (never hoisted to a module constant) so a language
 * switch, which re-renders the tree, moves the menus with it.
 */
const menuDir = () => dirOf(locale())

export interface MenuItem {
  /** Reconciliation key. Give one whenever the label can repeat — project names
   *  are user-typed, so two rows really can read "Homework". Falls back to the
   *  label, which is stable for the fixed rows. */
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
  /** A submenu (File > Open Recent). Rendered via Radix Sub/SubTrigger/
   *  SubContent, so hover-open, ArrowRight-open and ArrowLeft-close all come
   *  from Radix rather than being hand-rolled. */
  items?: MenuItem[]
  /** A custom CONTROL row (the Manage gear's View-scale slider), rendered
   *  verbatim instead of a Radix Item: interacting with it never
   *  select-and-closes the menu, and Radix's roving focus skips it (pointer
   *  users reach the control directly; keyboard users have the command
   *  equivalents). The caller owns the row's layout and its onKeyDown
   *  stopPropagation if the control needs arrow keys. Wins over `onSelect`/
   *  `items`; `label`/`startsGroup` still key and group the row. */
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

/** The DENSITY media (index.css), for the one JS decision this file makes:
 *  a fine-pointer desktop dismisses its menus instantly — the 90ms exit is
 *  touch furniture, and VS Code menus vanish the frame you release. */
const DESK_MQ = '(min-width: 900px) and (hover: hover) and (pointer: fine)'

/**
 * The panel. `origin-(--radix-popper-transform-origin)` is what makes the 0.98
 * scale grow out of the trigger rather than out of the panel's own middle, and
 * the four data-side pairs pick the matching 4px direction — Radix rewrites
 * data-side when it flips the menu above its anchor, so the animation flips
 * with it for free.
 *
 * At desk the chrome retunes to VS Code's menu widget — --menu-* tokens, 5px
 * radius — and the pop animation is off entirely (`desk:animate-none!` — the
 * bang because the pop classes carry two data-attributes of specificity that a
 * plain desk override would lose to).
 */
const PANEL = cx(
  'z-(--z-menu) min-w-[13rem] rounded-md border border-border-subtle bg-surface-3 p-1 shadow-raised',
  'desk:rounded-[5px] desk:border-(--menu-border) desk:bg-(--menu-bg)',
  /* Height is the SMALLER of the app viewport and what Radix's positioner says
   * is actually left between the anchor and the screen edge (it already nets
   * out collisionPadding) — so a long menu scrolls inside `scroller` instead
   * of running off a phone. The fallbacks only exist for the first frame,
   * before the size middleware has written the vars. */
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
 * A row. The hover and press fills are gated on `enabled:` rather than undone
 * by a later `disabled:` rule, so the two can never fight over source order —
 * a disabled row simply has no hover state to lose.
 *
 * At desk the selection is VS Code's: the full row fills --menu-sel-bg
 * (accent) with --menu-sel-fg ink, replacing the touch surface-4 hover.
 * `data-[highlighted]` is Radix's roving highlight (keyboard AND pointer), and
 * `data-[state=open]` keeps a submenu's parent row lit while the child is out.
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
      /* Destructive actions are never adjacent to frequent ones: Delete is
         last, separated by a divider (spec §5.2), and red the whole way. */
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

/** The icon slot is reserved whether or not a row has one, so labels do not step
 *  in and out as the eye runs down the menu. 20px is the spec §5.2 glyph size,
 *  not a spacing step — `size-5` would resolve to --sp-5, which is 24px.
 *  On the accent selection at desk the glyph takes the selection ink too. */
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
  // `rtl:-scale-x-100`: this glyph is a direction, not an ornament. Radix flies
  // the child panel out on the trailing side, so in Arabic it opens to the LEFT
  // and a right-pointing chevron promises the opposite of what happens.
  'ms-auto flex-none text-text-3 rtl:-scale-x-100',
  'desk:group-hover/item:text-(--menu-sel-fg) desk:group-data-[highlighted]/item:text-(--menu-sel-fg)',
)
const SEPARATOR = 'm-2 border-t border-border-subtle desk:border-(--menu-sep)'

/** Dropdown and context menus expose the same Item/Sub/Separator contract, so
 *  the rows are written once against whichever family is in play. */
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
 * `plain` drops the reserved leading icon column — the menu-bar dropdowns have
 * no icon gutter (VS Code reserves the left inset for checkmarks only, and
 * nothing here is checkable yet). Plain menus are desk-only surfaces, so the
 * touch menus keep their 20px glyph column untouched.
 *
 * `drill` swaps the submenu mechanism: instead of a Radix Sub flyout beside the
 * parent (which has nowhere to go on a phone), a parent row is a plain item
 * that hands itself to `drill` — TriggerMenu then re-renders the SAME panel
 * with the child rows and a "‹ Back" row. The row keeps its ▸ chevron and
 * aria-haspopup, so it still reads as "leads somewhere".
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
          /* Custom control row (see MenuItem.render): rendered verbatim, no
             Radix Item wrapper, so interacting with it cannot select-and-close
             the menu. */
          item.render
        ) : item.items && drill ? (
          /* Drill-in parent: selecting it swaps the panel's rows for the
             child's. preventDefault on the select event is what keeps the menu
             open through the swap. ArrowRight mirrors the flyout keyboarding. */
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
            {/* A real <button> for the same reasons as Item below. Radix opens
                the child on hover, ArrowRight and Enter, and closes it on
                ArrowLeft — the parent row stays lit via data-state=open. */}
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
              {/* sticky="always": on a cramped screen the flyout detaches from
                  its trigger row rather than leave the viewport; the PANEL cap
                  makes an over-tall child scroll instead of overflow. */}
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
          /* A real <button>, not Radix's div: `:disabled` is how a dead row
             greys and how it leaves the tab order, and the app's QA selects
             `[role="menuitem"]`, which Radix puts on whatever element it is
             given. */
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

  // Re-opened at a new point (a right-click on a second row) while the last one
  // was still fading: the caller keeps this Menu mounted and swaps `anchor`.
  useEffect(() => {
    clearTimeout(exit.current)
    setOpen(true)
  }, [anchor])

  useEffect(() => () => clearTimeout(exit.current), [])

  // The caller unmounts us the moment onClose fires, and an unmounted panel
  // cannot animate out — so the panel closes now, and the caller is told once
  // the exit has played. At desk there is no exit to play (the pop animation
  // is off), so the caller is told immediately.
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
          // Anchor coords are pointer/viewport px, but this marker renders
          // inside the zoomed #root (index.css view scale), where a px length
          // paints multiplied by --ui-scale — divide it back out or every
          // point-opened menu (tab ⋯, explorer right-click) drifts toward the
          // origin at scale < 1. The menu PANEL itself portals to <body>,
          // outside the zoom, and needs nothing.
          style={{
            left: `calc(${anchor.x}px / var(--ui-scale, 1))`,
            top: `calc(${anchor.y}px / var(--ui-scale, 1))`,
          }}
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
          avoidCollisions
          collisionPadding={MARGIN}
          sticky="always"
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
          {rows(items, RMenu, plain)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

/**
 * The same panel and rows, opened from a REAL trigger element rather than a
 * point. Built for the menu bar (MenuBar.tsx): Radix owns the toggle-on-press,
 * aria-haspopup/aria-expanded, and — unlike `Menu` above — hands focus back to
 * the trigger on close, which is exactly the "Escape returns focus to the
 * title" behaviour a menu bar owes its keyboard user.
 *
 * Controlled, because the menu bar coordinates several of these (ArrowLeft/
 * ArrowRight and pointerenter move the one open menu between titles).
 *
 * `drillIn` replaces side flyouts with in-place navigation — the VS Code
 * mobile-web pattern. A submenu parent (File) swaps the panel's rows for its
 * children plus a "‹ Back" row, so nothing ever opens BESIDE the panel and
 * nothing can leave a phone's screen. ArrowRight drills, ArrowLeft backs out,
 * Escape still closes the whole menu. The path resets every time the menu
 * closes — reopening always starts at the top.
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
  /* The open submenu trail, root-first, as item KEYS — App rebuilds the menu
   * arrays every render, so object identity would go stale immediately. */
  const [path, setPath] = useState<string[]>([])
  const content = useRef<HTMLDivElement | null>(null)
  const refocus = useRef(false)

  /* After a drill or back the rows just swapped under the user's finger or
   * focus; hand focus to the first row so arrows and type-ahead keep working
   * (and so focus cannot fall out of the menu, which would dismiss it). Runs
   * after every render, acts only when a handler armed it. */
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
                  {/* The chevron is its own element so `rtl:-scale-x-100` can
                      turn it around: "back" is the direction you came from,
                      which in Arabic is the other way. A "‹" baked into the
                      string would point into the panel instead of out of it. */}
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

/** Walk a drill path (item keys, root-first) down the menu tree. A stale key —
 *  the menus were rebuilt without it (a project renamed away mid-open) —
 *  falls back to the root rather than crashing. */
function levelOf(items: MenuItem[], path: string[]): MenuItem[] {
  let level = items
  for (const key of path) {
    const next = level.find((it) => (it.id ?? it.label) === key)?.items
    if (!next) return items
    level = next
  }
  return level
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
    <RContextMenu.Root dir={menuDir()} modal={false}>
      <RContextMenu.Trigger asChild>{children}</RContextMenu.Trigger>
      <RContextMenu.Portal>
        <RContextMenu.Content
          aria-label={label}
          avoidCollisions
          collisionPadding={MARGIN}
          sticky="always"
          onEscapeKeyDown={(e) => e.stopPropagation()}
          className={PANEL}
        >
          {rows(items, RContextMenu)}
        </RContextMenu.Content>
      </RContextMenu.Portal>
    </RContextMenu.Root>
  )
}
