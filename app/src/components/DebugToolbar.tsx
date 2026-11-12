import type { ReactNode } from 'react'
import { debugStore, useDebugState } from '../debug/store'
import {
  IconDebugContinue,
  IconDebugPause,
  IconDebugRestart,
  IconDebugStepInto,
  IconDebugStepOut,
  IconDebugStepOver,
  IconDebugStop,
} from './ui/DebugIcons'
import { formatKeys } from '../ui/keys'
import { COPY } from '../copy'

/**
 * VS Code's floating debug toolbar: docked over the top of the editor while a
 * debug session runs (bottom on touch, out of the code's way). Continue⇄Pause, the three
 * steps, Restart, Stop — each also on its VS Code key (App's command table).
 */
export function DebugToolbar({
  onRestart,
  onStop,
  belowBar = false,
}: {
  onRestart(): void
  onStop(): void
  /** The editor area opens with a toolbar of its own (a notebook's): dock under it, not over it. */
  belowBar?: boolean
}) {
  const s = useDebugState()
  if (s.phase === 'inactive') return null
  const paused = s.phase === 'paused'

  return (
    <div
      role="toolbar"
      aria-label={COPY.a11yDebugToolbar}
      className={
        // Touch: bottom-start, clear of the ⋯ fab (bottom-end) and of the code at the
        // top, where the stopped line usually is. Desk: VS Code's top-centre dock.
        'debug-toolbar absolute bottom-[calc(env(safe-area-inset-bottom)+var(--sp-3))] start-3 ' +
        'desk:bottom-auto desk:start-auto desk:left-1/2 desk:-translate-x-1/2 ' +
        (belowBar ? 'desk:top-[calc(var(--bar-top)+var(--sp-1))] ' : 'desk:top-1 ') +
        'z-(--z-raised) flex items-center gap-0.5 rounded-md p-0.5 ' +
        'border border-border-subtle bg-(--code-widget-bg) shadow-raised select-none'
      }
    >
      {paused ? (
        <Btn label={COPY.debugContinue} keys="F5" tone="go" onClick={() => debugStore.resume('continue')}>
          <IconDebugContinue />
        </Btn>
      ) : (
        <Btn label={COPY.debugPause} keys="F6" onClick={() => debugStore.pause()}>
          <IconDebugPause />
        </Btn>
      )}
      <Btn label={COPY.debugStepOver} keys="F10" disabled={!paused} onClick={() => debugStore.resume('stepOver')}>
        <IconDebugStepOver />
      </Btn>
      <Btn label={COPY.debugStepInto} keys="F11" disabled={!paused} onClick={() => debugStore.resume('stepInto')}>
        <IconDebugStepInto />
      </Btn>
      <Btn label={COPY.debugStepOut} keys="Shift+F11" disabled={!paused} onClick={() => debugStore.resume('stepOut')}>
        <IconDebugStepOut />
      </Btn>
      <Btn label={COPY.debugRestart} keys="Mod+Shift+F5" tone="go" onClick={onRestart}>
        <IconDebugRestart />
      </Btn>
      <Btn label={COPY.debugStop} keys="Shift+F5" tone="stop" onClick={onStop}>
        <IconDebugStop />
      </Btn>
    </div>
  )
}

function Btn({
  label,
  keys,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string
  keys: string
  tone?: 'go' | 'stop'
  disabled?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${formatKeys(keys)})`}
      disabled={disabled}
      onClick={onClick}
      className={
        'relative grid size-9 desk:size-7 place-items-center rounded-sm cursor-pointer touch-manipulation ' +
        'hover:not-disabled:bg-(--list-hover-bg) disabled:opacity-40 disabled:cursor-default ' +
        'after:absolute after:-inset-1 after:content-[""] ' +
        (tone === 'go' ? 'text-success' : tone === 'stop' ? 'text-danger' : 'text-text-1')
      }
    >
      {children}
    </button>
  )
}
