import { useState, type SVGProps } from 'react'
import { IconFilesStack } from './ui/Icons'
import { TriggerMenu, useDrillIn, type MenuItem } from './ui/Menu'
import { COPY } from '../copy'

/* The rail itself. It starts in row 2, under the full-width title bar (the
 * title bar spans both columns), so the two stack instead of meeting at a
 * corner — VS Code's frame, where the title runs edge to edge and the rail
 * hangs below it. Same fill as that bar, and the same inset-shadow divider
 * every other bar in the app uses (a real border would come out of its 48px).
 *
 * NO top padding, deliberately. It used to have 4px, which started the first
 * button at y=4 and left its active rule floating with bare surface above it
 * at x=0 — the founder read that, correctly, as a stray sliver on the app's
 * edge. VSCode's rail starts its first item flush with the top. */
const RAIL =
  'flex flex-col items-center flex-none w-activity bg-surface-0 ' +
  'shadow-[inset_-1px_0_0_0_var(--border-subtle)] pl-[env(safe-area-inset-left)] ' +
  'col-start-1 row-start-2 row-span-1'

/* 48px square — the column's own width, comfortably past the 44px floor.
 *
 * Hover feedback is FOREGROUND-ONLY: an intentional divergence from the
 * icon-btn recipe. VS Code's rail never paints a fill behind a hovered or
 * active glyph — the whole column stays flat and the ink does the talking
 * (#868686 resting, #D7D7D7 hovered/active, via the --ab-* tokens; never
 * pure white).
 *
 * The active indicator is a 2px accent rule drawn as an inset box-shadow.
 * It used to be a `border-l-[length:var(--rail)]` border, which needed a
 * `length:` type hint to survive Tailwind v4 (a bare custom property on
 * `border-l-` is read as a colour and compiles to width 0 — ARCHITECTURE
 * §4.1) and, being box-sized, pushed every glyph 1px off the column's true
 * center at all times. The shadow paints over the padding box instead: no
 * type-hint trap, no reserved width, glyphs dead-center.
 *
 * Disabled is a colour change, never opacity — opacity destroys measured
 * contrast. Disabled ink deliberately equals the inactive tone, so the rail
 * reads as exactly two tones: bright where you are or point, dim everywhere
 * else. */
const SLOT =
  'grid place-items-center flex-none size-activity cursor-pointer touch-manipulation ' +
  'text-(--ab-fg-inactive) transition-colors duration-(--dur-fast) ease-standard ' +
  'hover:not-disabled:text-(--ab-fg) ' +
  'data-[state=active]:text-(--ab-fg) ' +
  'data-[state=active]:shadow-[inset_2px_0_0_0_var(--ab-active-border)] ' +
  'disabled:text-(--ab-fg-inactive) disabled:cursor-default ' +
  // The ring goes inside the box: the column is exactly as wide as the button,
  // so any outset ring would be clipped by the rail's own edge. -1px matches
  // the app-wide 1px ring width (founder ruling 2026-08-02: 1px/0 default,
  // was 2px/2px) so it sits flush against the inside with zero overflow.
  'focus-visible:outline-offset-[-1px]'

export type SideView = 'explorer' | 'search'

export interface ActivityBarProps {
  /** Which sidebar view is showing, or null while the sidebar is hidden —
   *  exactly one rail item carries the active rule at a time, VS Code's own
   *  selection model. */
  activeView: SideView | null
  /** Show the Explorer view (or hide the sidebar if it is already up). */
  onShowExplorer(): void
  /** Show the cross-file Search view (same toggle contract). */
  onShowSearch(): void
  /** The gear's dropdown — built by App, which owns every action in it. */
  manageItems: MenuItem[]
}

/**
 * VSCode's far-left icon column (LAYOUT-VSCODE §1), at EVERY width — one shell
 * (founder ruling 2026-08-05). Below 900px it drives the overlay drawer. (A
 * fold-away strip and a sub-480 40px narrowing shipped briefly on 2026-08-05
 * and were reverted the same day — the founder confirmed the 48px column is
 * fine on a real device, and the extra chevron was chrome without a job.)
 *
 * Every slot on this rail does something real (the founder's no-dead-UI
 * mandate). The W1-D silhouette slots — Source Control, Run and Debug,
 * Extensions, Accounts — were permanently disabled stand-ins for views that do
 * not exist, and are gone until the views do; familiarity is not worth a
 * column of buttons that answer nothing. What remains: Explorer and Search
 * switch the sidebar between its two views (each toggles the sidebar closed
 * when its view is already up — VS Code's rail), and the Manage gear opens a
 * menu of the app-scoped actions VS Code keeps behind its own gear.
 * aria-labels are the bare VS Code view names, so `[aria-label^=...]` prefix
 * selectors in QA keep matching when shortcut suffixes arrive.
 *
 * The column is 48px per the plan, and every hit area is the full column
 * square — past the 44px floor at full width.
 */
export function ActivityBar({
  activeView,
  onShowExplorer,
  onShowSearch,
  manageItems,
}: ActivityBarProps) {
  const [manageOpen, setManageOpen] = useState(false)
  // The gear holds a submenu now (Language), and this rail is on screen at
  // every width — so it needs the same in-place navigation the menu bar's ☰
  // uses on a phone. Without it the flyout opens beside a panel that already
  // reaches the edge and the rows land off-screen.
  const drillIn = useDrillIn()

  return (
    <nav className={RAIL} aria-label={COPY.a11yActivityBar}>
      <button
        type="button"
        className={SLOT}
        aria-label={COPY.a11yExplorer}
        title={COPY.a11yExplorer}
        aria-pressed={activeView === 'explorer'}
        data-state={activeView === 'explorer' ? 'active' : 'inactive'}
        onClick={onShowExplorer}
      >
        <IconFilesStack size={24} />
      </button>

      {/* A VIEW now, like VS Code's: the slot switches the sidebar to the
          cross-file Search view (SearchView.tsx). The editor's own find panel
          stays on Mod+F / Edit > Find. */}
      <button
        type="button"
        className={SLOT}
        aria-label={COPY.a11ySearch}
        title={COPY.a11ySearch}
        aria-pressed={activeView === 'search'}
        data-state={activeView === 'search' ? 'active' : 'inactive'}
        onClick={onShowSearch}
      >
        <IconSearch size={24} />
      </button>

      {/* Everything after this spacer sits flush with the bottom of the rail —
          VS Code's Manage gear. */}
      <div className="mt-auto" aria-hidden="true" />

      <TriggerMenu
        open={manageOpen}
        onOpenChange={setManageOpen}
        items={manageItems}
        label={COPY.a11yManage}
        plain
        drillIn={drillIn}
        trigger={
          <button type="button" className={SLOT} aria-label={COPY.a11yManage} title={COPY.a11yManage} data-state="inactive">
            <IconManage size={24} />
          </button>
        }
      />

    </nav>
  )
}

/* ---- codicon glyphs, local to the rail. ----------------------------------
 *
 * Path data traced from microsoft/vscode-codicons (MIT): search and
 * settings-gear. Fill-based on a 24px grid — NOT the 20px/1.6px-stroke grid of
 * ui/Icons.tsx, and deliberately so: the rail renders VS Code's own shapes at
 * VS Code's own size, and a restroked 20px approximation is exactly the
 * "almost right" that reads as a knock-off. The 16px-native search codicon is
 * scaled ×1.5 onto the same grid, which lands its 1px strokes at the 1.5px
 * weight of the 24px set. They stay here rather than in ui/Icons.tsx because
 * nothing else may use them: one odd grid, one owner. (IconFilesStack lives in
 * ui/Icons.tsx beside the folder it deliberately is not.) */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

function CodIcon({ size = 24, children, ...rest }: IconProps & { children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  )
}

const IconSearch = (p: IconProps) => (
  <CodIcon {...p}>
    <g transform="scale(1.5)">
      <path d="M10.0195 10.7266C9.06578 11.5217 7.83875 12 6.5 12C3.46243 12 1 9.53757 1 6.5C1 3.46243 3.46243 1 6.5 1C9.53757 1 12 3.46243 12 6.5C12 7.83875 11.5217 9.06578 10.7266 10.0195L13.8535 13.1464C14.0488 13.3417 14.0488 13.6583 13.8535 13.8536C13.6583 14.0488 13.3417 14.0488 13.1464 13.8536L10.0195 10.7266ZM11 6.5C11 4.01472 8.98528 2 6.5 2C4.01472 2 2 4.01472 2 6.5C2 8.98528 4.01472 11 6.5 11C8.98528 11 11 8.98528 11 6.5Z" />
    </g>
  </CodIcon>
)

const IconManage = (p: IconProps) => (
  <CodIcon {...p}>
    <path d="M12 9C10.3425 9 9.00002 10.3425 9.00002 12C9.00002 13.6575 10.3425 15 12 15C13.6575 15 15 13.6575 15 12C15 10.3425 13.6575 9 12 9ZM12 13.5C11.172 13.5 10.5 12.828 10.5 12C10.5 11.172 11.172 10.5 12 10.5C12.828 10.5 13.5 11.172 13.5 12C13.5 12.828 12.828 13.5 12 13.5ZM21.8475 14.5725L19.9185 12.942C19.8675 12.8985 19.8195 12.8505 19.776 12.7995C19.332 12.279 19.3965 11.5005 19.9185 11.058L21.8475 9.4275C22.0395 9.2655 22.113 9.0045 22.0365 8.766C21.579 7.3545 20.823 6.06 19.8285 4.962C19.7085 4.83 19.5405 4.758 19.368 4.758C19.2975 4.758 19.227 4.77 19.1595 4.794L16.779 5.6415C16.716 5.664 16.65 5.682 16.584 5.694C16.509 5.7075 16.434 5.715 16.3605 5.715C15.7725 5.715 15.2505 5.298 15.141 4.701L14.6865 2.223C14.6415 1.977 14.451 1.782 14.205 1.7295C13.485 1.5765 12.7485 1.5 12.0015 1.5C11.2545 1.5 10.5165 1.578 9.79652 1.7295C9.55052 1.782 9.36002 1.977 9.31502 2.223L8.86202 4.701C8.85002 4.767 8.83202 4.8315 8.80952 4.8945C8.62802 5.4 8.15102 5.715 7.64102 5.715C7.50302 5.715 7.36202 5.691 7.22402 5.643L4.84352 4.7955C4.77602 4.7715 4.70402 4.7595 4.63502 4.7595C4.46252 4.7595 4.29452 4.8315 4.17452 4.9635C3.17852 6.0615 2.42402 7.356 1.96502 8.7675C1.88702 9.006 1.96202 9.267 2.15402 9.429L4.08302 11.0595C4.13402 11.103 4.18202 11.151 4.22552 11.202C4.66952 11.7225 4.60502 12.501 4.08302 12.9435L2.15402 14.574C1.96202 14.736 1.88852 14.997 1.96502 15.2355C2.42252 16.647 3.17852 17.9415 4.17452 19.0395C4.29452 19.1715 4.46252 19.2435 4.63502 19.2435C4.70552 19.2435 4.77602 19.2315 4.84352 19.2075L7.22402 18.36C7.28702 18.3375 7.35302 18.3195 7.41902 18.3075C7.49402 18.294 7.56902 18.288 7.64252 18.288C8.23052 18.288 8.75252 18.705 8.86202 19.302L9.31502 21.78C9.36002 22.026 9.55052 22.221 9.79652 22.2735C10.5165 22.4265 11.2545 22.503 12.0015 22.503C12.7485 22.503 13.4865 22.425 14.205 22.2735C14.451 22.221 14.6415 22.026 14.6865 21.78L15.141 19.302C15.153 19.236 15.171 19.1715 15.1935 19.1085C15.375 18.603 15.852 18.288 16.362 18.288C16.5 18.288 16.641 18.312 16.779 18.36L19.158 19.2075C19.227 19.2315 19.2975 19.2435 19.3665 19.2435C19.539 19.2435 19.707 19.1715 19.827 19.0395C20.823 17.9415 21.5775 16.647 22.035 15.2355C22.113 14.997 22.038 14.736 21.846 14.574L21.8475 14.5725ZM19.092 17.589L17.2815 16.944C16.9845 16.839 16.6755 16.785 16.362 16.785C15.2085 16.785 14.1705 17.514 13.782 18.5985C13.731 18.738 13.6935 18.882 13.6665 19.029L13.3215 20.9055C12.8865 20.9685 12.444 21 12.0015 21C11.559 21 11.1165 20.9685 10.68 20.904L10.3365 19.0275C10.098 17.727 8.96552 16.7835 7.64252 16.7835C7.48052 16.7835 7.31552 16.7985 7.14902 16.8285C7.00352 16.8555 6.86102 16.893 6.72002 16.9425L4.90952 17.5875C4.35752 16.896 3.91652 16.1385 3.59102 15.321L5.05202 14.0865C5.61152 13.614 5.95202 12.951 6.01202 12.222C6.07202 11.493 5.84252 10.785 5.36702 10.227C5.27102 10.1145 5.16452 10.008 5.05202 9.912L3.59102 8.6775C3.91652 7.86 4.35752 7.101 4.90952 6.411L6.72002 7.056C7.01702 7.161 7.32602 7.215 7.64102 7.215C8.79452 7.215 9.83252 6.486 10.221 5.4015C10.272 5.2605 10.3095 5.1165 10.3365 4.971L10.68 3.0945C11.1165 3.0315 11.559 2.9985 12.0015 2.9985C12.444 2.9985 12.8865 3.03 13.3215 3.093L13.665 4.9695C13.9035 6.27 15.036 7.2135 16.359 7.2135C16.521 7.2135 16.686 7.1985 16.851 7.1685C16.9965 7.1415 17.1405 7.104 17.2815 7.0545L19.092 6.4095C19.644 7.0995 20.085 7.8585 20.4105 8.676L18.951 9.9105C18.3915 10.383 18.0495 11.046 17.991 11.775C17.931 12.504 18.1605 13.2135 18.636 13.77C18.7335 13.884 18.8385 13.989 18.9525 14.085L20.4135 15.3195C20.088 16.137 19.647 16.896 19.095 17.586L19.092 17.589Z" />
  </CodIcon>
)
