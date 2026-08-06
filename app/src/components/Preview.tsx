import { COPY } from '../copy'

/**
 * One sandboxed iframe fed a full HTML doc via `srcdoc`, so an in-memory project
 * runs with no server. No `allow-same-origin`: paired with allow-scripts that would
 * let the page escape the sandbox and reach Warsha's storage/cookies/parent window —
 * it can only talk back through the postMessage console bridge the runtime injects.
 * Forced white background: a student's page assumes browser-default white, and
 * Warsha's dark shell would otherwise render it dark-on-dark.
 */
const SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-downloads'

export function Preview({ srcdoc }: { srcdoc: string | null }) {
  if (!srcdoc) {
    return (
      <div className="scroller flex min-h-0 flex-1 items-center justify-center bg-surface-1 px-6 text-center">
        <p className="max-w-[32ch] text-meta leading-normal text-text-3">{COPY.previewEmpty}</p>
      </div>
    )
  }

  return (
    <iframe
      // No key: each run's srcdoc carries a fresh nonce, so React reloads the frame on change alone.
      title={COPY.previewTitle}
      sandbox={SANDBOX}
      srcDoc={srcdoc}
      className="min-h-0 flex-1 border-0 bg-white"
    />
  )
}
