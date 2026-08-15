import type { ProgressReport, SourceFile } from './types'
import { assetUrl } from './assetUrl'

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
let ready: Promise<typeof import('esbuild-wasm')> | null = null

/** Where `npm run assets` stages the bundler wasm (see package.json / .gitignore). */
const WASM_URL = assetUrl('warsha-esbuild.wasm')

/** Fetches the wasm with byte progress and compiles it — doing the fetch ourselves (not esbuild's `wasmURL`) is what enables a determinate progress bar. */
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

/** Idempotent — first caller pays the download, later callers await the same promise. `worker: true` keeps a large bundle from janking the editor. */
export function ensureBundler(onProgress: (p: ProgressReport) => void = () => {}): Promise<typeof import('esbuild-wasm')> {
  if (!ready) {
    ready = (async () => {
      const mod = await import('esbuild-wasm')
      const wasmModule = await fetchWasmModule(onProgress)
      await mod.initialize({ wasmModule, worker: true })
      return mod
    })().catch((err) => {
      // Let a later run retry from scratch rather than latching the failure.
      ready = null
      throw err
    })
  }
  return ready
}

/** React, bundled first-party on-device (tools/prebuild-react.mjs) — keeps the preview one self-contained inlinable document, per the same COEP-driven never-link rule as Tailwind and the wasm. */
const REACT_URL = assetUrl('warsha-react.json')

/** Virtual dir for the injected React shim files; the leading dot avoids colliding with a real student path. */
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

/** Fetches the React bundle once, same-origin (so COEP doesn't apply — bytes are bundled into student output, never linked). Cached; a failure lets the next run retry. */
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

/** Does this project use React (a .tsx/.jsx file, or an import of react/react-dom)? A false positive only costs an unused ~196KB fetch, so this errs toward loading. */
export function needsReact(files: SourceFile[]): boolean {
  return files.some(
    (f) =>
      /\.(tsx|jsx)$/i.test(f.path) ||
      /(?:import|export|require|import\s*)\s*(?:[^;]*?from\s*)?['"]react(?:-dom)?(?:\/[^'"]*)?['"]/.test(f.content),
  )
}

/**
 * Svelte/Vue served like React (prebuilt on-device runtime in the virtual FS),
 * but also need a *compiler* — the SFC compiles to JS at bundle time, in the
 * parent app so COEP never touches it.
 */
interface FrameworkAssets {
  version: string
  files: Record<string, string>
}

/** Cached same-origin fetch of a prebuilt runtime JSON, mirroring the React loader; failure resets the cache for retry. */
function assetLoader(url: string, label: string): () => Promise<FrameworkAssets> {
  let cache: Promise<FrameworkAssets> | null = null
  return () => {
    if (!cache) {
      cache = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`Could not load the ${label} runtime (${r.status})`)
          return r.json() as Promise<FrameworkAssets>
        })
        .catch((err) => {
          cache = null
          throw err
        })
    }
    return cache
  }
}

const SVELTE_DIR = '.warsha-svelte'
const VUE_DIR = '.warsha-vue'

/** Bare specifier → runtime file; merged with REACT_SPECIFIERS. Only resolves once that runtime's actually injected, so unrelated imports still error. */
const SVELTE_SPECIFIERS: Record<string, string> = {
  svelte: `${SVELTE_DIR}/svelte.js`,
  'svelte/internal/client': `${SVELTE_DIR}/internal-client.js`,
  'svelte/internal/disclose-version': `${SVELTE_DIR}/disclose-version.js`,
}
const VUE_SPECIFIERS: Record<string, string> = {
  vue: `${VUE_DIR}/vue.js`,
}
const FRAMEWORK_SPECIFIERS: Record<string, string> = { ...REACT_SPECIFIERS, ...SVELTE_SPECIFIERS, ...VUE_SPECIFIERS }

const loadSvelteAssets = assetLoader(assetUrl('warsha-svelte.json'), 'Svelte')
const loadVueAssets = assetLoader(assetUrl('warsha-vue.json'), 'Vue')

/** SFC compilers, lazily imported (a Vite chunk, like esbuild) and cached; run inside the bundler's onLoad on the main thread. */
let svelteCompiler: Promise<typeof import('svelte/compiler')> | null = null
function loadSvelteCompiler(): Promise<typeof import('svelte/compiler')> {
  if (!svelteCompiler) svelteCompiler = import('svelte/compiler').catch((e) => ((svelteCompiler = null), Promise.reject(e)))
  return svelteCompiler
}
let vueCompiler: Promise<typeof import('@vue/compiler-sfc')> | null = null
function loadVueCompiler(): Promise<typeof import('@vue/compiler-sfc')> {
  if (!vueCompiler) vueCompiler = import('@vue/compiler-sfc').catch((e) => ((vueCompiler = null), Promise.reject(e)))
  return vueCompiler
}

/** Svelte/Vue file, or a bare-package import? Same erring-toward-loading logic as needsReact. */
export function needsSvelte(files: SourceFile[]): boolean {
  return files.some((f) => /\.svelte$/i.test(f.path) || /(?:from|import)\s*['"]svelte(?:\/[^'"]*)?['"]/.test(f.content))
}
export function needsVue(files: SourceFile[]): boolean {
  return files.some((f) => /\.vue$/i.test(f.path) || /(?:from|import)\s*['"]vue['"]/.test(f.content))
}

/** Compiles one .svelte component to JS; CSS is injected by the runtime (`css: 'injected'`), no separate stylesheet handling. */
function compileSvelte(compiler: typeof import('svelte/compiler'), source: string, path: string): string {
  const filename = path.split('/').pop() || path
  return compiler.compile(source, { filename, name: 'Component', generate: 'client', css: 'injected', dev: false }).js.code
}

/** Stable id per file path, feeding Vue's scoped-style attribute so CSS and rendered DOM agree — no RNG needed. */
function scopeHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return 'warsha' + (h >>> 0).toString(36)
}

/** Compiles a .vue SFC — inlined script-setup render, scoped styles injected at runtime via a `<style>` tag. Returns the loader so `lang="ts"` scripts get transpiled too. */
function compileVue(compiler: typeof import('@vue/compiler-sfc'), source: string, path: string): { code: string; loader: 'js' | 'ts' } {
  const filename = path.split('/').pop() || path
  const id = scopeHash(path)
  const scopeId = `data-v-${id}`
  const { descriptor, errors } = compiler.parse(source, { filename })
  if (errors.length) throw new Error(errors.map((e) => e.message).join('\n'))
  const hasScoped = descriptor.styles.some((s) => s.scoped)
  const lang = (descriptor.scriptSetup?.lang || descriptor.script?.lang) === 'ts' ? 'ts' : 'js'
  const script = compiler.compileScript(descriptor, {
    id,
    inlineTemplate: true,
    templateOptions: { scoped: hasScoped, compilerOptions: { scopeId: hasScoped ? scopeId : undefined } },
  })
  // Name the default export so we can stamp `__scopeId` on it — that's what makes
  // Vue add the `data-v-…` attribute the scoped CSS needs to match.
  let code = compiler.rewriteDefault(script.content, '_sfc_main')
  if (hasScoped) code += `\n_sfc_main.__scopeId = ${JSON.stringify(scopeId)}`
  code += `\nexport default _sfc_main`
  const styles = descriptor.styles.map((s) => compiler.compileStyle({ source: s.content, filename, id: scopeId, scoped: s.scoped }))
  const styleErrors = styles.flatMap((s) => s.errors)
  if (styleErrors.length) throw new Error(styleErrors.map((e) => String(e.message ?? e)).join('\n'))
  const css = styles.map((s) => s.code).join('\n').trim()
  const inject = css
    ? `\n;(function(){try{var s=document.createElement("style");s.textContent=${JSON.stringify(css)};document.head.appendChild(s)}catch(e){}})();\n`
    : ''
  return { code: code + inject, loader: lang }
}

/** Does this entry need the bundler? TS/TSX/JSX always does; plain JS only if it imports another module — so a simple one-file script skips esbuild entirely (js.ts). */
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

/** Candidate paths for an extensionless import, in order: exact file, then TS/JS extensions, then an index file. */
function candidates(base: string): string[] {
  const exts = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.svelte', '.vue', '.json']
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
  /** Output format: ESM (default) preserves top-level `await`, for a module worker or `<script type="module">`; IIFE suits a classic inline script. */
  format?: 'esm' | 'iife'
}

/** Bundles `entryPath` and its imports into one chunk. Throws an `Error` with human-readable build errors (path:line:col: text), so it prints like any other program error. */
export async function bundleProject(
  files: SourceFile[],
  entryPath: string,
  opts: BundleOptions = {},
): Promise<string> {
  const esbuild = await ensureBundler()
  const byPath = new Map(files.map((f) => [f.path, f.content]))

  // React on demand — inject the shim files into the virtual FS so
  // react/react-dom/jsx-runtime resolve and bundle in; nothing fetched otherwise.
  if (needsReact(files)) {
    const { files: reactFiles } = await loadReactAssets()
    for (const [name, content] of Object.entries(reactFiles)) {
      byPath.set(`${REACT_DIR}/${name}`, content)
    }
  }

  // Svelte/Vue: inject the runtime the same way and preload the SFC compiler so
  // onLoad can transform files synchronously.
  let svelte: typeof import('svelte/compiler') | null = null
  if (needsSvelte(files)) {
    const [{ files: svelteFiles }, compiler] = await Promise.all([loadSvelteAssets(), loadSvelteCompiler()])
    for (const [name, content] of Object.entries(svelteFiles)) byPath.set(`${SVELTE_DIR}/${name}`, content)
    svelte = compiler
  }
  let vue: typeof import('@vue/compiler-sfc') | null = null
  if (needsVue(files)) {
    const [{ files: vueFiles }, compiler] = await Promise.all([loadVueAssets(), loadVueCompiler()])
    for (const [name, content] of Object.entries(vueFiles)) byPath.set(`${VUE_DIR}/${name}`, content)
    vue = compiler
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
        // A framework bare specifier maps to its runtime file, present only when
        // injected above — otherwise it errors cleanly like any missing import.
        const framework = FRAMEWORK_SPECIFIERS[args.path]
        if (framework && byPath.has(framework)) return { path: framework, namespace: VFS }
        // A remaining bare specifier is an npm package — no node_modules on-device, so let esbuild report it.
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
        // A single-file component isn't JS yet — compile it first; a failure becomes a named build error, like any other.
        const named = args.path.split('/').pop() || args.path
        if (svelte && /\.svelte$/i.test(args.path)) {
          try {
            return { contents: compileSvelte(svelte, content, args.path), loader: 'js' }
          } catch (err) {
            return { errors: [{ text: `${named}: ${err instanceof Error ? err.message : String(err)}` }] }
          }
        }
        if (vue && /\.vue$/i.test(args.path)) {
          try {
            const { code, loader } = compileVue(vue, content, args.path)
            return { contents: code, loader }
          } catch (err) {
            return { errors: [{ text: `${named}: ${err instanceof Error ? err.message : String(err)}` }] }
          }
        }
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
      // es2022, matching the app's own target, so top-level `await` is allowed in ESM output.
      target: 'es2022',
      // Automatic JSX compiles to react/jsx-runtime imports (resolved to the shim
      // above) — no `import React` needed; harmless for plain JS/TS.
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
