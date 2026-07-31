import type { ComponentPropsWithRef, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'stop' | 'quiet'

/**
 * Fills, inks and states come from DESIGN-SPEC §7.4 and live in index.css
 * (`.btn`, `.btn--*`). Every variant has hover, active and focus-visible — a
 * hover-only affordance is invisible on the target device, which has no hover.
 * Never white text on --accent (1.99:1); amber fills take --accent-ink.
 */
export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  /** Run/Stop and primary dialog actions are 48px, not 44px. */
  large?: boolean
  children?: ReactNode
}

export function Button({ variant = 'quiet', large, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={
        // cursor: a <button> is `cursor: default` by default in every browser and
        // Tailwind's preflight does not change it. Harmless on the target device,
        // wrong on a laptop.
        `btn btn--${variant} cursor-pointer disabled:cursor-not-allowed${large ? ' btn--lg' : ''}` +
        (className ? ' ' + className : '')
      }
      {...rest}
    >
      {children}
    </button>
  )
}

/** Square icon-only control: 44px box, 20px glyph — the box is the target. */
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
      className={`icon-btn cursor-pointer disabled:cursor-not-allowed${className ? ' ' + className : ''}`}
      {...rest}
    >
      {children}
    </button>
  )
}
