import { useEffect, useId, useState, type ReactNode } from 'react'
import { COPY } from '../copy'
import type { LinkAccess, WarshaApi } from '../collab/api'
import { buildRoomUrl } from '../collab'
import { Button } from './ui/Button'
import { Modal } from './ui/Dialog'
import { IconLink, IconShare, IconEye } from './ui/Icons'

/**
 * The live-room share dialog (contract §7.4), Google-Docs style but link-only for
 * this deploy: an owner picks who can open the `#room=` link — Editor, Viewer, or
 * Off — and copies it. Per-person email sharing is deferred until email
 * verification exists, so that block is shown disabled ("coming soon").
 *
 * A guest (non-owner) sees the copy-link only — they cannot change access. The
 * owner may be anonymous (a device principal can own a doc); link-access still
 * works over the device token, so this dialog does not require an account.
 */
const OPTIONS: { value: LinkAccess; icon: ReactNode; title: () => string; desc: () => string }[] = [
  { value: 'editor', icon: <IconShare size={18} />, title: () => COPY.shareLinkEditor, desc: () => COPY.shareLinkEditorDesc },
  { value: 'viewer', icon: <IconEye size={18} />, title: () => COPY.shareLinkViewer, desc: () => COPY.shareLinkViewerDesc },
  { value: 'none', icon: <IconLink size={18} />, title: () => COPY.shareLinkOff, desc: () => COPY.shareLinkOffDesc },
]

export function ShareDialog({
  api,
  roomId,
  isOwner,
  onLinkAccess,
  onClose,
  notify,
}: {
  /** Null offline — link-access can't be changed; copy-link still works. */
  api: WarshaApi | null
  roomId: string
  /** The host owns the doc; a guest does not (copy-link only). */
  isOwner: boolean
  /** Publish the owner's chosen link access into the live doc meta (H2, §7.4), so
   *  already-connected honest guests re-resolve their role. Called after the PATCH
   *  succeeds; the server PATCH stays the authoritative gate for new joiners. */
  onLinkAccess?(access: LinkAccess): void
  onClose(): void
  notify(message: string, kind?: 'info' | 'success' | 'error'): void
}) {
  const titleId = useId()
  const url = buildRoomUrl(roomId)
  // Server default is `editor` (Phase-1 parity); read the real value for an owner.
  const [access, setAccess] = useState<LinkAccess>('editor')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState<LinkAccess | null>(null)

  useEffect(() => {
    if (!api || !isOwner) {
      setLoaded(true)
      return
    }
    let live = true
    void api.listDocs().then((docs) => {
      if (!live) return
      const entry = docs?.find((d) => d.id === roomId)
      if (entry) setAccess(entry.linkAccess)
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [api, isOwner, roomId])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url ?? '')
      notify(COPY.shareLinkCopied, 'success')
    } catch {
      notify(COPY.noteLinkCopyFailed, 'error')
    }
  }

  const choose = async (value: LinkAccess) => {
    if (value === access || saving) return
    if (!api) {
      notify(COPY.authErrorNetwork, 'error')
      return
    }
    setSaving(value)
    const result = await api.patchDoc(roomId, { linkAccess: value })
    setSaving(null)
    if (!result) {
      notify(COPY.shareUpdateFailed, 'error')
      return
    }
    setAccess(result.linkAccess)
    // Propagate through the CRDT so already-connected honest guests react live (H2).
    onLinkAccess?.(result.linkAccess)
    notify(COPY.shareUpdated, 'success')
  }

  return (
    <Modal onCancel={onClose} dismissible labelledBy={titleId}>
      <h2 id={titleId} className="mb-2 text-dlg-title leading-[1.3] font-semibold text-text-1">
        {COPY.shareTitle}
      </h2>

      {isOwner ? (
        <>
          <p className="mb-3 text-meta leading-normal text-text-3">{COPY.shareIntro}</p>
          <div className="flex flex-col gap-1" role="radiogroup" aria-label={COPY.shareLinkAccessLabel}>
            {OPTIONS.map((o) => {
              const selected = access === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!loaded || saving !== null}
                  onClick={() => void choose(o.value)}
                  className={
                    'flex items-start gap-3 rounded-md border px-3 py-2 text-start transition-colors duration-(--dur-fast) ' +
                    'disabled:cursor-not-allowed ' +
                    (selected
                      ? 'border-accent bg-surface-2'
                      : 'border-border-subtle hover:border-border-control hover:bg-surface-2')
                  }
                >
                  <span aria-hidden="true" className="mt-0.5 grid size-[20px] flex-none place-items-center text-text-3">
                    {o.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-row text-text-1">{o.title()}</span>
                    <span className="block text-micro leading-normal text-text-3">{o.desc()}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={
                      'mt-0.5 size-4 flex-none rounded-full border ' +
                      (selected ? 'border-accent bg-accent' : 'border-border-control')
                    }
                  />
                </button>
              )
            })}
          </div>
        </>
      ) : (
        // A guest can't change access — just the note + copy-link.
        <p className="mb-3 text-meta leading-normal text-text-3">{COPY.shareGuestNote}</p>
      )}

      {/* Per-person sharing is deferred (needs email verification) — shown, disabled. */}
      {isOwner ? (
        <div className="mt-4 rounded-md border border-dashed border-border-control bg-surface-2 px-3 py-2 opacity-70">
          <div className="flex items-center justify-between gap-2">
            <span className="text-meta text-text-2">{COPY.shareEmailTitle}</span>
            <span className="rounded-full bg-surface-4 px-2 py-0.5 text-micro text-text-3">{COPY.shareComingSoon}</span>
          </div>
          <p className="mt-1 text-micro leading-normal text-text-3">{COPY.shareEmailNote}</p>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => void copy()}>
          <IconLink size={16} aria-hidden="true" />
          {COPY.shareCopyLink}
        </Button>
        <Button variant="primary" large onClick={onClose}>
          {COPY.dlgDone}
        </Button>
      </div>
    </Modal>
  )
}
