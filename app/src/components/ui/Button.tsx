import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'stop' | 'quiet'

const base =
  'tap inline-flex items-center justify-center gap-2 rounded-md text-btn font-medium select-none ' +
  'min-h-touch px-3 transition-colors duration-[--dur-fast] ' +
  'disabled:bg-surface-4 disabled:text-text-disabled disabled:cursor-not-allowed active:scale-[.97]'

/** Fills and inks come from DESIGN-SPEC §7.4. Never white text on --accent. */
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-press',
  stop: 'bg-danger-soft text-danger border border-danger',
  ghost: 'bg-transparent text-text-2 border border-border-control hover:text-text-1 hover:bg-surface-3',
  danger: 'bg-danger-fill text-white',
  quiet: 'bg-transparent text-text-2 hover:bg-surface-3 hover:text-text-1',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  /** Run/Stop and primary dialog actions are 48px, not 44px. */
  large?: boolean
  children?: ReactNode
}

export function Button({ variant = 'quiet', large, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]} ${large ? 'min-h-touch-lg px-4' : ''} ${className}`}
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={
        'tap inline-grid place-items-center size-touch shrink-0 rounded-md text-[20px] leading-none ' +
        'text-text-2 hover:bg-surface-3 hover:text-text-1 active:bg-surface-4 ' +
        'disabled:text-text-disabled disabled:cursor-not-allowed ' +
        className
      }
      {...rest}
    >
      {children}
    </button>
  )
}
