import type { ProgressReport, RunIO, RunSession, Runtime, SourceFile } from './types'

/**
 * The Web runtime — Warsha's first `kind: 'preview'` engine, and the reason the
 * runtime contract grew an output surface (see types.ts `RuntimeKind`).
 *
 * Unlike Java and Python there is nothing to download and no worker: HTML, CSS
 * and JavaScript are what the browser already is. `run()` assembles the project
 * into one self-contained HTML document and hands it to the shell through
 * `io.onRender`; the shell owns the iframe and simply loads the string.
 *
 * Two things make that document behave like a page a student would recognise:
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
 *  - **The console is bridged back.** A small script injected at the top of the
 *    document forwards `console.log`/`warn`/`error`, uncaught errors and unhandled
 *    rejections to the parent, which routes them to `io.onStdout`/`onStderr`.
 *    So the Console panel stays useful for a web project — a `console.log` a
 *    student writes still shows up where the Java/Python output would.
 *
 * KNOWN PHASE-1 LIMITS (deliberate, documented): a `<script type="module">` that
 * `import`s another project file does not resolve — cross-file ES modules need
 * the blob-URL / bundling step that arrives with TypeScript in Phase 2. Binary
 * assets are not handled because the project store holds only text.
 */

const MARK = '__warsha_preview__'

/** The console-forwarding bridge, injected as the document's first script.
 *  `nonce` scopes its messages to one run, so output from a superseded iframe
 *  that is still tearing down cannot leak into the next run's Console. */
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

/**
 * Resolve a reference written inside `baseDir` to a normalised project path.
 * Returns null for anything that is not a plain relative/root path (a URL, an
 * anchor, a protocol) — those are left in the document for the browser to fetch.
 */
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

/** A minimal host page for a lone `.js` or `.css` file with no HTML around it. */
function hostPage(entryPath: string, content: string): string {
  const title = entryPath.split('/').pop() ?? entryPath
  if (entryPath.endsWith('.css')) {
    // Something for the CSS to actually style, so the preview is not blank.
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
  // Anything else (a .js entry): run it, and let console output carry the result.
  // The note keeps the Preview from looking blank/broken when a script has no
  // page of its own — its output is in the Console, one tap away.
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

/**
 * Build the document to load into the preview from an entry HTML file and the
 * rest of the project. Uses DOMParser rather than regex so malformed markup and
 * attribute quoting are the browser's problem, not ours.
 */
function assemble(entryPath: string, files: SourceFile[], nonce: string): string {
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

  // Inline project scripts: <script src="script.js"> keeps its other attributes.
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src') ?? ''
    const resolved = resolveRef(baseDir, src)
    if (resolved === null) continue
    const js = byPath.get(resolved)
    if (js === undefined) continue
    const inline = doc.createElement('script')
    for (const attr of Array.from(script.attributes)) {
      if (attr.name !== 'src') inline.setAttribute(attr.name, attr.value)
    }
    inline.setAttribute('data-warsha-src', src)
    inline.textContent = js
    script.replaceWith(inline)
  }

  // The console bridge goes first, so it is in place before any page script runs.
  const head = doc.head ?? doc.documentElement
  const bridgeScript = doc.createElement('script')
  bridgeScript.textContent = bridge(nonce)
  head.insertBefore(bridgeScript, head.firstChild)

  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

export class WebRuntime implements Runtime {
  readonly id = 'web'
  readonly kind = 'preview' as const

  /** Nothing to download; resolves immediately and reports no progress, so the
   *  shell's progress block never appears for a web run. */
  load(_onProgress: (p: ProgressReport) => void): Promise<void> {
    return Promise.resolve()
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
    const nonce = `w${Math.random().toString(36).slice(2)}`

    // The bridge posts console output to the parent; route it to the Console
    // exactly as an engine's stdout/stderr would arrive. Scoped by nonce so a
    // previous run's iframe cannot bleed into this transcript.
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
        // Blank the surface; a live page has no exit code, so "stopped" is the
        // shell tearing the preview down on the student's behalf.
        io.onRender?.('')
        io.onExit(null)
      },
      // A preview takes no stdin — a page reads from its own UI, not the Console.
      writeStdin() {},
    }

    const srcdoc = assemble(entryPath, files, nonce)
    io.onRender?.(srcdoc)
    return session
  }

  dispose(): void {
    /* No worker and no heap to release. */
  }
}
