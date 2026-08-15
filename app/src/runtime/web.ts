import { bundleProject, ensureBundler, needsBundle } from './bundle'
import { assetUrl } from './assetUrl'
import type { ProgressReport, RunContext, RunIO, RunSession, Runtime, SourceFile } from './types'

/**
 * The Web runtime — Warsha's first `kind: 'preview'` engine, and the reason the
 * runtime contract grew an output surface (see types.ts `RuntimeKind`).
 *
 * Unlike Java and Python there is (usually) nothing to download and no worker:
 * HTML, CSS and JavaScript are what the browser already is. `run()` assembles the
 * project into one self-contained HTML document and hands it to the shell through
 * `io.onRender`; the shell owns the iframe and simply loads the string.
 *
 * Three things make that document behave like a page a student would recognise:
 *
 *  - **Local references are inlined.** A `<link rel="stylesheet" href="styles.css">`
 *    or `<script src="script.js">` that points at a file *in the project* is
 *    replaced by an inline `<style>` / `<script>` holding that file's current
 *    text. A srcdoc iframe has no base URL to resolve those paths against, and
 *    the project files live in memory rather than on a server, so inlining is
 *    the way multi-file HTML/CSS/JS works at all. References to the network
 *    (`https://…`, a CDN) are left untouched, which is what will let a later
 *    phase pull Tailwind or a framework from a CDN.
 *
 *  - **Modules and TypeScript are bundled (Phase 2b).** A `<script type="module">`
 *    that `import`s another project file — or any `<script src="…​.ts">` — cannot
 *    resolve those imports inside a srcdoc iframe, and the browser cannot run TS
 *    at all. Such scripts (whether `src` or inline) are handed to the same
 *    in-browser esbuild bundler the standalone JS engine uses (`runtime/bundle.ts`),
 *    which transpiles TS and resolves cross-file relative imports against the
 *    in-memory project, then the bundled result is inlined. A plain classic script,
 *    or a module script with no project imports, still runs verbatim with nothing
 *    to download — the bundler is fetched (~12 MB, once) only when a page actually
 *    needs it, and `load()` shows that download's progress.
 *
 *  - **Tailwind is served on-device (Phase 3).** A `<script>` pointing at the
 *    Tailwind Play CDN (`cdn.tailwindcss.com`) or the `@tailwindcss/browser` build
 *    is replaced by Warsha's first-party copy (`public/warsha-tailwind.js`, staged
 *    by `npm run assets`), fetched same-origin and *inlined* into the document
 *    (see `loadTailwindSource` — a linked `<script src>` would be a cross-origin
 *    load from the sandboxed iframe's opaque origin and COEP would block it). A
 *    student writes the familiar CDN line every tutorial shows, and it just works,
 *    offline included. The on-device build is Tailwind v4: utility classes work
 *    identically; a v3 Play CDN `tailwind.config = {…}` object does not apply (v4
 *    config lives in a `<style type="text/tailwindcss">` `@theme` block instead).
 *
 *  - **The console is bridged back.** A small script injected at the top of the
 *    document forwards `console.log`/`warn`/`error`, uncaught errors and unhandled
 *    rejections to the parent, which routes them to `io.onStdout`/`onStderr`.
 *    So the Console panel stays useful for a web project — a `console.log` a
 *    student writes still shows up where the Java/Python output would.
 *
 * KNOWN LIMIT (deliberate): binary assets are not handled because the project
 * store holds only text. A bare specifier (`import _ from 'lodash'`) has no
 * node_modules to resolve against and becomes a clear build error.
 */

const MARK = '__warsha_preview__'

/** Warsha's first-party, on-device Tailwind build (staged by `npm run assets`,
 *  see package.json / .gitignore). */
const TAILWIND_URL = assetUrl('warsha-tailwind.js')

/**
 * Fetches and caches the Tailwind build once. Inlined, never linked — the
 * sandboxed iframe has an opaque origin, so a same-origin `<script src>` would
 * be cross-origin to it and COEP would block it.
 */
let tailwindSource: Promise<string> | null = null
function loadTailwindSource(): Promise<string> {
  if (!tailwindSource) {
    tailwindSource = fetch(TAILWIND_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`could not load the Tailwind build (${r.status})`)
        return r.text()
      })
      .catch((err) => {
        tailwindSource = null // let a later run retry rather than latch the failure
        throw err
      })
  }
  return tailwindSource
}

/** Recognises both the v3 Play CDN and the v4 `@tailwindcss/browser` build as servable on-device. */
function isTailwindCdn(url: string): boolean {
  return /cdn\.tailwindcss\.com/i.test(url) || /@tailwindcss\/browser/i.test(url)
}

/** Forwards console output to the parent. `nonce` scopes messages to one run so a tearing-down iframe can't leak into the next run's Console. */
function bridge(nonce: string): string {
  return `(function(){
  var NONCE=${JSON.stringify(nonce)};
  function send(stream,text){
    try{parent.postMessage({mark:${JSON.stringify(MARK)},nonce:NONCE,stream:stream,text:String(text)},'*')}catch(e){}
  }
  function fmt(a){
    if(typeof a==='string')return a;
    if(a instanceof Error)return a.stack||a.message||String(a);
    try{return JSON.stringify(a)}catch(e){return String(a)}
  }
  function line(args){return Array.prototype.map.call(args,fmt).join(' ')+'\\n'}
  var c=window.console||{};
  ['log','info','debug'].forEach(function(k){var o=c[k];c[k]=function(){send('out',line(arguments));if(o)try{o.apply(c,arguments)}catch(e){}}});
  ['warn','error'].forEach(function(k){var o=c[k];c[k]=function(){send('err',line(arguments));if(o)try{o.apply(c,arguments)}catch(e){}}});
  window.addEventListener('error',function(e){send('err',(e.message||'Script error')+(e.filename?' ('+(e.lineno||0)+':'+(e.colno||0)+')':'')+'\\n')});
  window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;send('err','Uncaught (in promise) '+fmt(r)+'\\n')});
})();`
}

/** Directory of a project-relative path: "src/index.html" → "src", "index.html" → "". */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** Is this an address the browser should fetch itself, not one of our files? */
function isExternal(ref: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|data:|blob:|#)/i.test(ref)
}

/** Resolves a reference relative to `baseDir` to a project path; null for a URL/anchor/protocol, which the browser fetches itself. */
function resolveRef(baseDir: string, ref: string): string | null {
  const trimmed = ref.trim()
  if (!trimmed || isExternal(trimmed)) return null
  // A leading "/" means the project root; otherwise it is relative to baseDir.
  const start = trimmed.startsWith('/') ? '' : baseDir
  const segments = `${start}/${trimmed}`.split('/')
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** Escapes `</script>` so it doesn't close the inline tag early when the document is serialised. */
function safeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1')
}

/**
 * What to do with a `<script>` when assembling the page — shared by
 * `pageNeedsBundle` and `assemble` so they agree:
 *   - `leave` — external, missing, or already-runnable as written.
 *   - `verbatim` — a project script, no imports, no TS: inline as-is.
 *   - `bundle` — TypeScript or cross-file imports: goes through esbuild (`esm` or `iife`).
 */
type ScriptPlan =
  | { kind: 'leave' }
  | { kind: 'verbatim'; code: string }
  | { kind: 'bundle'; entry: string; format: 'esm' | 'iife'; inlineText?: string }

/** Counter feeding unique synthetic paths for inline module blocks. */
function planScript(
  script: HTMLScriptElement,
  baseDir: string,
  byPath: Map<string, string>,
  inlineIndex: number,
): ScriptPlan {
  const isModule = (script.getAttribute('type') ?? '').trim().toLowerCase() === 'module'
  const src = script.getAttribute('src')

  if (src) {
    const resolved = resolveRef(baseDir, src)
    if (resolved === null) return { kind: 'leave' } // URL / CDN / data: — the browser fetches it
    const code = byPath.get(resolved)
    if (code === undefined) return { kind: 'leave' } // points at nothing we have; leave it be
    if (needsBundle(resolved, code)) {
      return { kind: 'bundle', entry: resolved, format: isModule ? 'esm' : 'iife' }
    }
    return { kind: 'verbatim', code }
  }

  // Inline block: bundle only a module that actually imports a project file; anything else already runs as written.
  const text = script.textContent ?? ''
  if (isModule && needsBundle(`${baseDir ? `${baseDir}/` : ''}__warsha_inline_${inlineIndex}.mjs`, text)) {
    return { kind: 'bundle', entry: `${baseDir ? `${baseDir}/` : ''}__warsha_inline_${inlineIndex}.mjs`, format: 'esm', inlineText: text }
  }
  return { kind: 'leave' }
}

/** Does the entry page need esbuild (a module/TS script importing a project file)? Parses it exactly as `assemble` will, so `load()` can fetch the bundler up front instead of mid-render. */
function pageNeedsBundle(files: SourceFile[], entryPath: string): boolean {
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const entry = byPath.get(entryPath)
  if (!/\.html?$/i.test(entryPath) || entry === undefined) return false // a lone .css/.js host page has no bundling scripts
  const baseDir = dirOf(entryPath)
  const doc = new DOMParser().parseFromString(entry, 'text/html')
  let inlineIndex = 0
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    if (!script.getAttribute('src')) inlineIndex++
    if (planScript(script as HTMLScriptElement, baseDir, byPath, inlineIndex).kind === 'bundle') return true
  }
  return false
}

/** A minimal host page for a lone `.js` or `.css` file with no HTML around it. */
function hostPage(entryPath: string, content: string): string {
  const title = entryPath.split('/').pop() ?? entryPath
  if (entryPath.endsWith('.css')) {
    // Something for the CSS to style, so the preview isn't blank.
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${content}</style></head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>This page is styled by your <code>${escapeHtml(title)}</code>. Add an <code>index.html</code> to control the markup.</p>
<button type="button">A button</button>
</body></html>`
  }
  // A .js entry: run it, and note in the page that its output is in the Console
  // — keeps the preview from looking blank.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body><main style="font-family:system-ui,sans-serif;color:#555;max-width:34rem;margin:2rem auto;padding:0 1rem;line-height:1.6">
<p><code>${escapeHtml(title)}</code> has no page of its own. What it prints with <code>console.log</code> is in the <strong>Console</strong> tab.</p>
</main><script>${content}</script></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

/** Red banner injected at the top of the body so a failed script names the problem instead of silently vanishing. */
function errorBanner(doc: Document, messages: string[]): HTMLElement {
  const banner = doc.createElement('div')
  banner.setAttribute('data-warsha-build-error', '')
  banner.setAttribute(
    'style',
    'position:sticky;top:0;z-index:2147483647;margin:0;padding:.6rem .9rem;background:#7f1d1d;color:#fff;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;border-bottom:2px solid #fca5a5',
  )
  banner.textContent = `Build error — see the Console.\n\n${messages.join('\n\n')}`
  return banner
}

/**
 * Builds the preview document via DOMParser (not regex, so malformed markup is
 * the browser's problem). Async for esbuild bundling; a build failure surfaces
 * as a banner via `onError`, not a throw, so the page still runs.
 */
async function assemble(
  entryPath: string,
  files: SourceFile[],
  nonce: string,
  onError: (text: string) => void,
): Promise<string> {
  const byPath = new Map(files.map((f) => [f.path, f.content]))
  const entry = byPath.get(entryPath)
  const isHtml = /\.html?$/i.test(entryPath)
  const source = isHtml && entry !== undefined ? entry : hostPage(entryPath, entry ?? '')
  const baseDir = dirOf(entryPath)

  const doc = new DOMParser().parseFromString(source, 'text/html')

  // Inline project stylesheets: <link rel="stylesheet" href="styles.css">.
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const href = link.getAttribute('href') ?? ''
    const resolved = resolveRef(baseDir, href)
    if (resolved === null) continue
    const css = byPath.get(resolved)
    if (css === undefined) continue
    const style = doc.createElement('style')
    style.setAttribute('data-warsha-src', href)
    if (link.getAttribute('media')) style.setAttribute('media', link.getAttribute('media') as string)
    style.textContent = css
    link.replaceWith(style)
  }

  // Replace a Tailwind CDN script with our inlined on-device build, in place
  // (must run before other scripts). On fetch failure, leave the original CDN
  // script rather than dropping styling silently.
  const twScripts = Array.from(doc.querySelectorAll('script[src]')).filter((s) =>
    isTailwindCdn(s.getAttribute('src') ?? ''),
  )
  if (twScripts.length) {
    try {
      const twSource = safeScript(await loadTailwindSource())
      for (const script of twScripts) {
        const inline = doc.createElement('script')
        inline.setAttribute('data-warsha-src', script.getAttribute('src') as string)
        inline.textContent = twSource
        script.replaceWith(inline)
      }
    } catch (err) {
      onError(`${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  // Inline project scripts verbatim; a module/TS script with cross-file imports
  // is bundled first (planScript). CDN scripts are untouched.
  const buildErrors: string[] = []
  let inlineIndex = 0
  for (const script of Array.from(doc.querySelectorAll('script')) as HTMLScriptElement[]) {
    if (!script.getAttribute('src')) inlineIndex++
    const plan = planScript(script, baseDir, byPath, inlineIndex)
    if (plan.kind === 'leave') continue

    const inline = doc.createElement('script')
    for (const attr of Array.from(script.attributes)) {
      if (attr.name !== 'src') inline.setAttribute(attr.name, attr.value)
    }

    if (plan.kind === 'verbatim') {
      inline.textContent = safeScript(plan.code)
      script.replaceWith(inline)
      continue
    }

    // 'bundle': transpile via esbuild. An inline module gets a synthetic entry
    // file so relative imports resolve against the page's directory.
    const bundleFiles = plan.inlineText !== undefined ? [...files, { path: plan.entry, content: plan.inlineText }] : files
    try {
      const code = await bundleProject(bundleFiles, plan.entry, { format: plan.format })
      // A module bundle must load as a module; an iife bundle is a classic script.
      if (plan.format === 'esm') inline.setAttribute('type', 'module')
      else inline.removeAttribute('type')
      inline.textContent = safeScript(code)
      script.replaceWith(inline)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      buildErrors.push(message)
      onError(`${message}\n`)
      script.remove() // drop the broken script; the banner explains why
    }
  }

  // The console bridge goes first, so it is in place before any page script runs.
  const head = doc.head ?? doc.documentElement
  const bridgeScript = doc.createElement('script')
  bridgeScript.textContent = bridge(nonce)
  head.insertBefore(bridgeScript, head.firstChild)

  if (buildErrors.length) {
    const body = doc.body ?? doc.documentElement
    body.insertBefore(errorBanner(doc, buildErrors), body.firstChild)
  }

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

export class WebRuntime implements Runtime {
  readonly id = 'web'
  readonly kind = 'preview' as const

  /** Usually nothing to download — a plain page reports no progress. Only a page
   *  needing transpiling/bundling fetches esbuild here (same progress bar as the
   *  JS engine), so the 12MB is never paid invisibly mid-render. */
  async load(onProgress: (p: ProgressReport) => void, ctx?: RunContext): Promise<void> {
    if (ctx && pageNeedsBundle(ctx.files, ctx.entry)) {
      await ensureBundler(onProgress)
    }
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
    const nonce = `w${Math.random().toString(36).slice(2)}`

    // Routes the bridge's console output to the Console like any engine's
    // stdout/stderr; nonce-scoped so a previous iframe can't bleed in.
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (!d || d.mark !== MARK || d.nonce !== nonce) return
      if (d.stream === 'err') io.onStderr(String(d.text))
      else io.onStdout(String(d.text))
    }
    window.addEventListener('message', onMessage)

    let closed = false
    const session: RunSession = {
      kill() {
        if (closed) return
        closed = true
        window.removeEventListener('message', onMessage)
        // Blank the surface — a live page has no exit code, so this is the shell tearing the preview down.
        io.onRender?.('')
        io.onExit(null)
      },
      // A preview takes no stdin — a page reads from its own UI, not the Console.
      writeStdin() {},
    }

    const srcdoc = await assemble(entryPath, files, nonce, (t) => io.onStderr(t))
    // A Stop mid-assemble already tore the session down — don't paint a superseded document over the blanked preview.
    if (!closed) io.onRender?.(srcdoc)
    return session
  }

  dispose(): void {
    /* No worker and no heap to release. */
  }
}
