import { COPY } from '../copy'
import { IconEye } from '../components/ui/Icons'
import type { Peer } from './presence'

/**
 * The one standing piece of collaboration UI: a pill in the title bar, shown
 * ONLY while a room is active (this project forbids dead UI). It doubles as the
 * exit — clicking it ends the session — and shows a stacked swatch of who else
 * is here. Until the session has real data (a guest waiting on the first sync)
 * it reads "Connecting…" with a pulsing amber dot instead of claiming "Live".
 * The way IN is the "Start collaboration" command/menu row; there is
 * deliberately no always-present button for it.
 */
export function CollabControl({
  active,
  connecting,
  peers,
  readOnly,
  onStop,
}: {
  active: boolean
  /** True while the session exists but nothing has synced yet (guest pre-sync). */
  connecting: boolean
  peers: Peer[]
  /** True when the local participant is a viewer — a "View only" badge sits by the pill. */
  readOnly?: boolean
  onStop(): void
}) {
  if (!active) return null
  return (
    <span className="inline-flex items-center gap-2">
    {readOnly ? (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-2 px-2 h-icon-btn text-meta text-text-3"
        title={COPY.collabViewOnlyHint}
      >
        <IconEye size={14} aria-hidden="true" />
        <span className="font-medium">{COPY.collabViewOnly}</span>
      </span>
    ) : null}
    <button
      type="button"
      onClick={onStop}
      aria-label={COPY.collabStop}
      title={COPY.collabStop}
      className={
        'inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-3 ' +
        'px-3 h-icon-btn text-meta text-text-2 cursor-pointer ' +
        'hover:bg-surface-4 hover:text-text-1 transition-colors duration-(--dur-fast) ease-standard ' +
        'max-[899px]:kb-open:h-touch-kb'
      }
    >
      {/* Live: the accent-green "connected" dot. Connecting: pulsing amber. */}
      <span
        aria-hidden="true"
        className={connecting ? 'size-2 rounded-full bg-[#E5B95C] animate-pulse' : 'size-2 rounded-full bg-[var(--accent)]'}
      />
      <span className="font-medium">{connecting ? COPY.collabConnecting : COPY.collabLive}</span>
      {peers.length > 0 ? (
        <span className="inline-flex items-center -space-x-1" aria-hidden="true">
          {peers.slice(0, 3).map((p) => (
            <span
              key={p.clientId}
              className="size-4 rounded-full border border-surface-3"
              style={{ backgroundColor: p.user.color }}
              title={p.user.name}
            />
          ))}
          {peers.length > 3 ? <span className="ms-1 tabular-nums">+{peers.length - 3}</span> : null}
        </span>
      ) : null}
    </button>
    </span>
  )
}
