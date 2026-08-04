import type { Runtime, SourceFile } from './types'
import { PythonRuntime } from '../../../runtimes/python/src'
import { JavaRuntime } from '../../../runtimes/java/src'
import { CSharpRuntime } from '../../../runtimes/csharp/src'
import { WebRuntime } from './web'
import { JsRuntime } from './js'

/** A runtime key — the id under which an engine is registered. Not the same as
 *  the *editor* language (a web project's files are html/css/js individually);
 *  see `editorLangForPath` in editor/setup.ts for that.
 *
 *  `web` and `js` split on purpose: a page (`web`) draws the preview surface,
 *  while a standalone script (`js`) is a headless, Node-like console program —
 *  JavaScript or TypeScript. A `.js`/`.ts` referenced from an HTML page is not
 *  chosen here; the `web` engine inlines it into the document. */
export type LangId = 'java' | 'python' | 'web' | 'js' | 'csharp'

/**
 * The single place that maps a language to its engine.
 * To plug in a real engine: implement Runtime, then swap the value here.
 *
 * One instance each per app is correct: each owns a single worker and reuses it
 * across runs (see the INTEGRATION.md of each runtime).
 *
 * The two engines need opposite worker types and Vite's `worker.format` is one
 * global setting, so Java's worker deliberately bypasses Vite's worker pipeline:
 * `npm run assets` copies it into `public/` and it is loaded from there by URL as
 * a CLASSIC script, which CheerpJ's loader requires. Python's is a module worker
 * that Vite bundles normally. See runtimes/java/INTEGRATION.md §2.
 */
const registry: Record<LangId, Runtime> = {
  java: new JavaRuntime({ workerUrl: new URL('warsha-jvm.worker.js', document.baseURI).href }),
  python: new PythonRuntime(),
  // .NET-wasm + Roslyn, in a module worker beside its _framework bundle under
  // public/warsha-dotnet/ (both staged by `npm run assets`). Loaded by URL, not
  // bundled, so the worker's relative dotnet.js import resolves. See
  // runtimes/csharp/INTEGRATION.md.
  csharp: new CSharpRuntime({ workerUrl: new URL('warsha-dotnet/dotnet.worker.js', document.baseURI).href }),
  // First-party: a page and its assets, rendered into the preview iframe (web)
  // versus a standalone script run headless like Node (js). A page and plain JS
  // are what the browser already is (nothing to download); TypeScript and
  // cross-file imports pull the esbuild bundler once, on demand (runtime/bundle.ts).
  web: new WebRuntime(),
  js: new JsRuntime(),
}

export function runtimeFor(entryPath: string): Runtime | null {
  const lang = langForPath(entryPath)
  return lang ? registry[lang] : null
}

/** True when the entry's engine draws the preview surface rather than the
 *  console — i.e. the shell should show the iframe. */
export function isPreviewEntry(entryPath: string | null | undefined): boolean {
  return !!entryPath && runtimeFor(entryPath)?.kind === 'preview'
}

/**
 * Terminate every engine worker. Called when the page is going away, so a
 * backgrounded tab is not holding a WASM JVM plus ECJ plus a CPython heap
 * against an iPad that is looking for memory to reclaim — the top-listed iPad
 * risk in both INTEGRATION.md files.
 *
 * Not called on a language switch: a Java re-warm costs 7–20 s, and a student
 * alternating Python and Java in one lesson would pay it every time.
 */
export function disposeRuntimes(): void {
  for (const runtime of Object.values(registry)) {
    try {
      runtime.dispose?.()
    } catch {
      /* nothing useful to do while the page is closing */
    }
  }
}

/** The runtime a file's extension selects. A page (html/css) draws the preview;
 *  a standalone script (js/ts and friends) runs headless like Node. The editor's
 *  per-file grammar is a separate concern (editorLangForPath). */
export function langForPath(path: string): LangId | null {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.cs')) return 'csharp'
  if (/\.(html?|css)$/i.test(path)) return 'web'
  if (SCRIPT_RE.test(path)) return 'js'
  return null
}

/** A standalone script the `js` engine runs headless: JavaScript or TypeScript,
 *  in any of their module/extension spellings. TypeScript and cross-file imports
 *  are transpiled/bundled first (see runtime/bundle.ts); plain one-file JS is not. */
const SCRIPT_RE = /\.(m?js|cjs|jsx|tsx?|mts|cts)$/i

const JAVA_MAIN = /public\s+static\s+void\s+main\s*\(/
const CSHARP_MAIN = /\bstatic\s+(?:async\s+)?(?:void|int|Task(?:<\s*int\s*>)?)\s+Main\s*\(/

/**
 * Entry-point candidates, best first. Java: any file declaring a main method.
 * Python: main.py / __main__.py, else any top-level .py file. C#: a file with a
 * Main method or the conventional Program.cs (else a lone .cs). Web: index.html,
 * then any other .html; with no HTML at all, a lone .js or .css that can stand
 * as its own page (the runtime wraps it in a host document).
 */
export function entryCandidates(files: SourceFile[]): string[] {
  const java = files
    .filter((f) => f.path.endsWith('.java') && JAVA_MAIN.test(f.content))
    .map((f) => f.path)
    .sort(byDepthThenName)

  const py = files.filter((f) => f.path.endsWith('.py')).map((f) => f.path)
  const pyNamed = py.filter((p) => baseName(p) === 'main.py' || baseName(p) === '__main__.py').sort(byDepthThenName)
  const pyRoot = py.filter((p) => !p.includes('/')).sort(byDepthThenName)
  const pyOrdered = dedupe([...pyNamed, ...pyRoot])

  const cs = files.filter((f) => f.path.endsWith('.cs')).map((f) => f.path)
  // A file with a Main method, or Program.cs (the top-level-statements file by
  // .NET convention). Roslyn resolves the real entry across the whole
  // compilation, so a lone .cs is offered whatever it is named.
  const csMain = files
    .filter(
      (f) =>
        f.path.endsWith('.cs') &&
        (CSHARP_MAIN.test(f.content) || baseName(f.path).toLowerCase() === 'program.cs'),
    )
    .map((f) => f.path)
    .sort(byDepthThenName)
  const csOrdered = csMain.length ? csMain : cs.length === 1 ? cs : []

  const browser = browserCandidates(files)

  // Whichever stack actually has a runnable entry leads the list.
  return dedupe([...java, ...pyOrdered, ...csOrdered, ...browser])
}

/** Candidates that run in the browser itself: a page (html) preferred, else a
 *  standalone script or stylesheet. The engine each one selects — preview for a
 *  page, headless Node-like for a script — is `runtimeFor`'s job, not this one's. */
function browserCandidates(files: SourceFile[]): string[] {
  const html = files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path)
  if (html.length) {
    const index = html.filter((p) => baseName(p).toLowerCase() === 'index.html').sort(byDepthThenName)
    const rest = html.filter((p) => baseName(p).toLowerCase() !== 'index.html').sort(byDepthThenName)
    return dedupe([...index, ...rest])
  }
  // No HTML: a single script or stylesheet can still be run on its own. Scripts
  // (JS or TS) lead CSS — a script is a program, a lone stylesheet only has a
  // demo page. A conventional entry name (main/index) is preferred so a
  // multi-file module project runs its entry, not an alphabetically-first helper.
  const scripts = files.filter((f) => SCRIPT_RE.test(f.path)).map((f) => f.path)
  const named = scripts.filter((p) => /^(main|index)\.[^/]+$/i.test(baseName(p))).sort(byDepthThenName)
  const rest = scripts.filter((p) => !/^(main|index)\.[^/]+$/i.test(baseName(p))).sort(byDepthThenName)
  const css = files.filter((f) => /\.css$/i.test(f.path)).map((f) => f.path).sort(byDepthThenName)
  return dedupe([...named, ...rest, ...css])
}

function baseName(p: string) {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

function byDepthThenName(a: string, b: string) {
  const da = a.split('/').length
  const db = b.split('/').length
  return da !== db ? da - db : a.localeCompare(b)
}

function dedupe(xs: string[]) {
  return [...new Set(xs)]
}

export type { Runtime, RunIO, RunSession, SourceFile } from './types'
