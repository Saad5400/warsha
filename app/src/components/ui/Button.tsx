import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef, ReactNode } from 'react'

/**
 * Variants come from DESIGN-SPEC §7.4 via cva. `not-disabled:` guards hover/active
 * because disabled still matches those pseudo-classes; disabled gets a flat color
 * swap instead of opacity, to keep contrast. `--accent-ink` (not white) keeps text
 * readable on `--accent` regardless of palette.
 */
const button = cva(
  // `btn` is a dead style hook now, kept only so `audit.mjs`'s cursor/44px checks find it.
  // `desk:px-3` is manual: 16px padding on a DENSITY-compacted 28px control would look pill-shaped.
  'btn inline-flex items-center justify-center gap-2 flex-none min-h-touch px-4 desk:px-3 desk:[&>svg]:size-4 rounded-md border border-transparent ' +
    'font-ui text-btn leading-[1.2] font-semibold select-none touch-manipulation cursor-pointer ' +
    'transition-[background-color,color,transform] duration-(--dur-fast) ease-standard active:scale-97 ' +
    'disabled:scale-100 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface-4 disabled:text-text-disabled',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:not-disabled:bg-accent-hover active:not-disabled:bg-accent-press',
        stop:
          'bg-danger-soft text-danger border-danger ' +
          'hover:not-disabled:bg-[color-mix(in_srgb,var(--danger-soft)_70%,var(--danger)_12%)] ' +
          'active:not-disabled:bg-[color-mix(in_srgb,var(--danger-soft)_60%,var(--danger)_20%)]',
        ghost:
          'bg-transparent text-text-2 border-border-control ' +
          'hover:not-disabled:bg-surface-3 hover:not-disabled:text-text-1 ' +
          'active:not-disabled:bg-surface-4 active:not-disabled:text-text-1',
        danger:
          'bg-danger-fill text-white ' +
          'hover:not-disabled:bg-[color-mix(in_srgb,var(--danger-fill)_88%,white)] ' +
          'active:not-disabled:bg-[color-mix(in_srgb,var(--danger-fill)_80%,black)]',
        quiet:
          'bg-transparent text-text-2 font-medium ' +
          'hover:not-disabled:bg-surface-3 hover:not-disabled:text-text-1 ' +
          'active:not-disabled:bg-surface-4 active:not-disabled:text-text-1',
      },
      /** min-width keeps Run/Stop the same size across the swap so neighbours don't shift. */
      large: { true: 'min-h-touch-lg min-w-[96px]', false: '' },
      /** Still a 44px target, just visually secondary — for a dense row's inline action. */
      compact: { true: 'px-2 text-meta', false: '' },
    },
    defaultVariants: { variant: 'quiet', large: false, compact: false },
  },
)

export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  /** Run/Stop and primary dialog actions are 48px, not 44px. */
  large?: boolean
  /** Visually secondary at the same 44px target — a row's inline "New file". */
  compact?: boolean
  children?: ReactNode
}

export function Button({ variant = 'quiet', large, compact, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      // Published as an attribute since `.btn--primary` etc. no longer exist — audit.mjs's amber-fill check reads it.
      data-variant={variant}
      className={button({ variant, large, compact }) + (className ? ' ' + className : '')}
      {...rest}
    >
      {children}
    </button>
  )
}

/**
 * 40px visual box; `after:` pads the hit area to ≥44px (spec §5.2) via a -4px
 * inset pseudo-element — safe wherever there's ≥8px of gap to expand into.
 * Two tighter-gap call sites (Explorer's sidebar trio, its per-row "⋯") opt
 * out with `after:content-none` so the padding can't steal a neighbour's tap.
 */
const iconButton = cva(
  // Same dead-hook move as `btn` — audit.mjs and the pixel-crop harness key off `.icon-btn`.
  // `size-icon-btn` compacts under DENSITY (40→28px); the glyph shrinks with it (20→16px).
  'icon-btn relative inline-grid place-items-center flex-none size-icon-btn rounded-md text-[20px] leading-none text-text-2 ' +
    'desk:[&>svg]:size-4 ' +
    'after:absolute after:-inset-1 after:content-[""] ' +
    'touch-manipulation cursor-pointer transition-[background-color,color] duration-(--dur-fast) ease-standard ' +
    'hover:not-disabled:bg-surface-3 hover:not-disabled:text-text-1 ' +
    'active:not-disabled:bg-surface-4 active:not-disabled:text-text-1 ' +
    'disabled:text-text-disabled disabled:cursor-not-allowed',
)

export function IconButton({
  label,
  className = '',
  children,
  ...rest
}: ComponentPropsWithRef<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={iconButton() + (className ? ' ' + className : '')}
      {...rest}
    >
      {children}
    </button>
  )
}
