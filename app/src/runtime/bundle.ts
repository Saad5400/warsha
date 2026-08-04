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

  const plugin: import('esbuild-wasm').Plugin = {
    name: VFS,
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // The entry point: esbuild passes it here first, with no importer.
        if (args.kind === 'entry-point') {
          return { path: normalise('', args.path), namespace: VFS }
        }
        if (isExternal(args.path)) return { path: args.path, external: true }
        // Anything not relative/root is a bare specifier (an npm package) — there
        // is no node_modules on the device, so let esbuild report it can't resolve.
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
      target: 'es2020',
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
        const where = loc ? `${loc.file || 'entry'}:${loc.line ?? 0}:${loc.column ?? 0}: ` : ''
        return `${where}${d.text}`
      })
      .join('\n')
  }
  return e?.message || String(err)
}
