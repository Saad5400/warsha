import type { RunStatus } from '../hooks/useRunner'

/**
 * Spec §7.3. "Stopped by you" is deliberately neutral, not red — the student did
 * that on purpose and it is not an error. Reserving red for genuine failure is
 * what makes red mean something.
 */
const pills: Record<RunStatus, { label: string; glyph: string; className: string }> = {
  idle: { label: 'Ready', glyph: '○', className: 'bg-surface-4 text-text-2' },
  preparing: { label: 'Preparing', glyph: '●', className: 'bg-success-soft text-success' },
  running: { label: 'Running', glyph: '●', className: 'bg-success-soft text-success' },
  waiting: { label: 'Waiting for you', glyph: '▸', className: 'bg-info-soft text-info' },
  ok: { label: 'Finished', glyph: '✓', className: 'bg-success-soft text-success' },
  failed: { label: 'Stopped early', glyph: '✕', className: 'bg-danger-soft text-danger' },
  stopped: { label: 'Stopped by you', glyph: '■', className: 'bg-neutral-soft text-text-2' },
}

export function StatusPill({ status, exitCode }: { status: RunStatus; exitCode: number | null }) {
  const pill = pills[status]
  const label = status === 'failed' && exitCode !== null ? `${pill.label} · exit ${exitCode}` : pill.label
  return (
    <span
      data-state={status}
      className={`inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-1 text-micro font-semibold ${pill.className}`}
    >
      <span aria-hidden="true" className={status === 'running' || status === 'preparing' ? 'animate-pulse' : ''}>
        {pill.glyph}
      </span>
      <span className="whitespace-nowrap">{label}</span>
    </span>
  )
}
