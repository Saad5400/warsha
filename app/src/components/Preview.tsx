import { COPY } from '../copy'

/**
 * The preview surface — the output pane's second face, shown for a web project
 * where the Console shows a program's transcript for Java/Python.
 *
 * It is one sandboxed iframe. The runner hands it a complete HTML document
 * (`srcdoc`) that the Web runtime assembled from the project; loading a string
 * rather than a URL is what lets a page built from in-memory files run with no
 * server behind it.
 *
 * SANDBOX. `allow-scripts` lets the student's own JavaScript run, but there is
 * deliberately **no** `allow-same-origin`: the two together are an
 * escape-the-sandbox pair, and without same-origin the page cannot reach
 * Warsha's storage, cookies or the parent window at all. The page talks back to
 * Warsha through exactly one channel — the `postMessage` console bridge the
 * runtime injects — and nothing else. `allow-forms`/`allow-modals`/`allow-popups`
 * are the ordinary things a learning page does (submit a form, `alert()`).
 *
 * A white canvas, always: a student's page usually assumes the browser's default
 * white, and Warsha's shell is dark — without this a page that sets no background
 * would render dark-on-dark and read as broken.
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
      // No key on srcdoc: each run carries a fresh nonce so the string always
      // differs, and React reloads the frame when the attribute changes.
      title={COPY.previewTitle}
      sandbox={SANDBOX}
      srcDoc={srcdoc}
      className="min-h-0 flex-1 border-0 bg-white"
    />
  )
}
