import type { ProgressReport, SourceFile } from './types'

/**
 * The in-browser bundler — esbuild-wasm, wrapped so the two JavaScript engines
 * (js.ts for a standalone script, web.ts for a page's module scripts) can turn a
 * set of project files into one runnable chunk.
 *
 * Why a bundler at all: the moment a `.ts` needs transpiling, or one file
 * `import`s another *project* file, the browser cannot do it on its own — a
 * srcdoc iframe and a blob worker both lack the filesystem those imports resolve
 * against, and neither speaks TypeScript. esbuild does both in one pass, entirely
 * on the device: `load()` fetches a ~12 MB wasm once (the same shape as Pyodide's
 * download), and every bundle after that is a few milliseconds on the main
 * thread. Nothing is sent anywhere.
 *
 * The project files are a virtual filesystem: a plugin answers esbuild's resolve
 * and load calls out of the in-memory `SourceFile[]` instead of disk. A relative
 * import (`./util`, `../lib/math`) resolves to a sibling file, trying the usual
 * TypeScript/JavaScript extensions; a `https://…` / `data:` reference is marked
 * external and left for the page to fetch (the seam a later CDN/framework phase
 * builds on); a bare specifier (`import _ from 'lodash'`) has nowhere to resolve
 * offline and becomes a clear "Could not resolve" build error.
 */

/** esbuild is initialised exactly once per page; both engines share it. */
let esbuildMod: typeof import('esbuild-wasm') | null = null
let ready: Promise<typeof import('esbuild-wasm')> | null = null

/** Where `npm run assets` stages the bundler wasm (see package.json / .gitignore). */
const WASM_URL = new URL('warsha-esbuild.wasm', document.baseURI).href

/**
 * Fetch the wasm with byte progress, compile it, and hand esbuild a ready
 * `WebAssembly.Module`. Doing the fetch ourselves (rather than letting esbuild's
 * `wasmURL` do it) is what lets the shell show a determinate bar for the one big
 * download, exactly as the Python engine does for Pyodide.
 */
async function fetchWasmModule(onProgress: (p: ProgressReport) => void): Promise<WebAssembly.Module> {
  const res = await fetch(WASM_URL)
  if (!res.ok) throw new Error(`Could not download the bundler (${res.status})`)

  const total = Number(res.headers.get('Content-Length')) || undefined
  // No body reader (or no length): compile straight from the response.
  if (!res.body) {
    onProgress({ phase: 'download', message: 'Downloading the bundler…', total })
    return WebAssembly.compile(await res.arrayBuffer())
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    onProgress({ phase: 'download', message: 'Downloading the bundler…', loaded, total })
  }

  const bytes = new Uint8Array(loaded)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.length
  }
  onProgress({ phase: 'boot', message: 'Starting the bundler…' })
  return WebAssembly.compile(bytes)
}

/**
 * Idempotent bootstrap. The first caller pays the download; concurrent and later
 * callers await the same promise. `worker: true` runs the wasm off the main
 * thread, so a large bundle never janks the editor.
 */
export function ensureBundler(onProgress: (p: ProgressReport) => void = () => {}): Promise<typeof import('esbuild-wasm')> {
  if (!ready) {
    ready = (async () => {
      const mod = await import('esbuild-wasm')
      const wasmModule = await fetchWasmModule(onProgress)
      await mod.initialize({ wasmModule, worker: true })
      esbuildMod = mod
      return mod
    })().catch((err) => {
      // Let a later run retry from scratch rather than latching the failure.
      ready = null
      throw err
    })
  }
  return ready
}

/** True once the bundler has finished booting — a caller can skip the progress
 *  UI on a warm engine. */
export function isBundlerReady(): boolean {
  return esbuildMod !== null
}

/**
 * React, bundled first-party and on-device (see tools/prebuild-react.mjs). A
 * page whose `main.tsx` imports `react` / `react-dom/client` gets React resolved
 * into its bundle from this asset, so the preview stays one self-contained,
 * inlinable document — the same "never link, always inline" rule Tailwind and
 * the wasm follow, and for the same COEP reason.
 */
const REACT_URL = new URL('warsha-react.json', document.baseURI).href

/** A reserved virtual directory for the injected React shim/core files. The
 *  leading dot keeps it clear of any real project path a student would write. */
const REACT_DIR = '.warsha-react'

/** Bare specifier → the virtual shim file that provides its named exports. */
const REACT_SPECIFIERS: Record<string, string> = {
  react: `${REACT_DIR}/react.js`,
  'react/jsx-runtime': `${REACT_DIR}/jsx-runtime.js`,
  'react-dom': `${REACT_DIR}/react-dom.js`,
  'react-dom/client': `${REACT_DIR}/react-dom-client.js`,
}

interface ReactAssets {
  version: string
  files: Record<string, string>
}
let reactAssets: Promise<ReactAssets> | null = null

/** Fetch the first-party React bundle once (same-origin from the parent, so the
 *  app's COEP is a non-issue here — the bytes are bundled *into* the student's
 *  output, never linked from the preview). Cached; a failure lets a later run
 *  retry rather than latching. */
function loadReactAssets(): Promise<ReactAssets> {
  if (!reactAssets) {
    reactAssets = fetch(REACT_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the React runtime (${r.status})`)
        return r.json() as Promise<ReactAssets>
      })
      .catch((err) => {
        reactAssets = null
        throw err
      })
  }
  return reactAssets
}

/**
 * Does this project reach for React — a `.tsx`/`.jsx` file (its JSX compiles to
 * `react/jsx-runtime` imports) or any `import`/`require` of `react`/`react-dom`?
 * A false positive only costs an unused ~196 KB fetch (esbuild drops anything the
 * entry never imports), so the check errs toward loading.
 */
export function needsReact(files: SourceFile[]): boolean {
  return files.some(
    (f) =>
      /\.(tsx|jsx)$/i.test(f.path) ||
      /(?:import|export|require|import\s*)\s*(?:[^;]*?from\s*)?['"]react(?:-dom)?(?:\/[^'"]*)?['"]/.test(f.content),
  )
}

/**
 * Does this entry need the bundler, or can it run as-is? A `.ts`/`.tsx`/`.jsx`
 * always does (it must be transpiled); a plain `.js`/`.mjs` only does when it
 * actually reaches for another module — so the common "one file, some
 * console.log" script keeps its zero-download, instant path (js.ts) and never
 * touches esbuild.
 */
export function needsBundle(entryPath: string, content: string): boolean {
  if (/\.(tsx?|mts|cts|jsx)$/i.test(entryPath)) return true
  // import / export statements, dynamic import(), or CommonJS require().
  return /(^|[\n;])\s*(import|export)\b/.test(content) || /\bimport\s*\(/.test(content) || /\brequire\s*\(/.test(content)
}

const VFS = 'warsha-vfs'

/** Directory of a normalised vfs path: "src/a.ts" → "src", "a.ts" → "". */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** Collapse "." and ".." against a base dir into a plain project path. */
function normalise(baseDir: string, spec: string): string {
  const start = spec.startsWith('/') ? '' : baseDir
  const segments = `${start}/${spec}`.split('/')
  const out: string[] = []
  for (const seg of segments) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return out.join('/')
}

/** The candidate paths an extensionless import may mean, in resolution order —
 *  an exact file, then the TS/JS extensions, then an index file in a folder. */
function candidates(base: string): string[] {
  const exts = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json']
  return [base, ...exts.map((e) => base + e), ...exts.map((e) => `${base}/index${e}`)]
}

/** esbuild's loader for a file, by extension. Unknown text is treated as JS. */
function loaderFor(path: string): 'ts' | 'tsx' | 'js' | 'jsx' | 'json' | 'css' | 'text' {
  if (/\.tsx$/i.test(path)) return 'tsx'
  if (/\.(ts|mts|cts)$/i.test(path)) return 'ts'
  if (/\.jsx$/i.test(path)) return 'jsx'
  if (/\.(m?js|cjs)$/i.test(path)) return 'js'
  if (/\.json$/i.test(path)) return 'json'
  if (/\.css$/i.test(path)) return 'css'
  return 'js'
}

/** Is this a reference the environment should fetch, not one of our files? */
function isExternal(spec: string): boolean {
  return /^(?:https?:)?\/\//i.test(spec) || /^(?:data|blob|node):/i.test(spec)
}

export interface BundleOptions {
  /** Output format. ESM (the default) preserves top-level `await` and is what a
   *  module worker or a `<script type="module">` loads; IIFE suits a classic
   *  inline page script. */
  format?: 'esm' | 'iife'
}

/**
 * Bundle `entryPath` and everything it imports into one chunk of the requested
 * format. Throws an `Error` whose message is the collected, human-readable build
 * errors (path:line:col: text) — the caller prints it to stderr, so a student's
 * type error or bad import reads like any other program error in the Console.
 */
export async function bundleProject(
  files: SourceFile[],
  entryPath: string,
  opts: BundleOptions = {},
): Promise<string> {
  const esbuild = await ensureBundler()
  const byPath = new Map(files.map((f) => [f.path, f.content]))

  // React on demand: drop the first-party shim/core files into the virtual FS so
  // `react` / `react-dom/client` / `react/jsx-runtime` resolve to them and get
  // bundled in (one shared instance — see prebuild-react.mjs). Nothing is fetched
  // for a project that never touches React.
  if (needsReact(files)) {
    const { files: reactFiles } = await loadReactAssets()
    for (const [name, content] of Object.entries(reactFiles)) {
      byPath.set(`${REACT_DIR}/${name}`, content)
    }
  }

  const plugin: import('esbuild-wasm').Plugin = {
    name: VFS,
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // The entry point: esbuild passes it here first, with no importer.
        if (args.kind === 'entry-point') {
          return { path: normalise('', args.path), namespace: VFS }
        }
        if (isExternal(args.path)) return { path: args.path, external: true }
        // A React bare specifier maps to its on-device shim (present only when
        // the project needs React, so a missing map entry still errors cleanly).
        const react = REACT_SPECIFIERS[args.path]
        if (react && byPath.has(react)) return { path: react, namespace: VFS }
        // Anything else not relative/root is a bare specifier (an npm package) —
        // there is no node_modules on the device, so let esbuild report it.
        if (!args.path.startsWith('.') && !args.path.startsWith('/')) return null

        const baseDir = dirOf(args.importer)
        for (const candidate of candidates(normalise(baseDir, args.path))) {
          if (byPath.has(candidate)) return { path: candidate, namespace: VFS }
        }
        return null
      })

      build.onLoad({ filter: /.*/, namespace: VFS }, (args) => {
        const content = byPath.get(args.path)
        if (content === undefined) return null
        return { contents: content, loader: loaderFor(args.path) }
      })
    },
  }

  try {
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: opts.format ?? 'esm',
      platform: 'browser',
      // es2022 (the app's own build target) so top-level `await` is allowed in
      // ESM output — a lower target makes esbuild reject it outright.
      target: 'es2022',
      // Automatic JSX: `.jsx`/`.tsx` compiles to `react/jsx-runtime` imports
      // (resolved to the on-device shim above), so no `import React` is needed in
      // scope. Harmless for plain JS/TS, which emits no JSX calls.
      jsx: 'automatic',
      sourcemap: false,
      logLevel: 'silent',
      plugins: [plugin],
    })
    return result.outputFiles?.[0]?.text ?? ''
  } catch (err) {
    throw new Error(formatBuildError(err))
  }
}

/** Turn esbuild's thrown error (with its `errors` array) into printable text. */
function formatBuildError(err: unknown): string {
  const e = err as { errors?: Array<{ text: string; location?: { file?: string; line?: number; column?: number } | null }>; message?: string }
  if (e && Array.isArray(e.errors) && e.errors.length) {
    return e.errors
      .map((d) => {
        const loc = d.location
        // Strip the internal virtual-fs namespace so a student sees "main.ts",
        // not "warsha-vfs:main.ts".
        const file = (loc?.file || 'entry').replace(new RegExp(`^${VFS}:`), '')
        const where = loc ? `${file}:${loc.line ?? 0}:${loc.column ?? 0}: ` : ''
        return `${where}${d.text}`
      })
      .join('\n')
  }
  return e?.message || String(err)
}
