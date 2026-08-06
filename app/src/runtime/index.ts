import type { Runtime, SourceFile } from './types'
import { PythonRuntime } from '../../../runtimes/python/src'
import { JavaRuntime } from '../../../runtimes/java/src'
import { CSharpRuntime } from '../../../runtimes/csharp/src'
import { ClangRuntime } from '../../../runtimes/clang/src'
import { WebRuntime } from './web'
import { JsRuntime } from './js'

/** Runtime key, distinct from the editor language (see editorLangForPath). `web` draws the preview; `js` is a headless script — an HTML-referenced `.js` is inlined by `web`, not chosen here. */
export type LangId = 'java' | 'python' | 'web' | 'js' | 'csharp' | 'c'

/**
 * Maps a language to its engine (one instance each, reused across runs). Java
 * needs a classic worker for CheerpJ but Vite's `worker.format` is global, so
 * Java's worker bypasses Vite's pipeline (staged to public/ by `npm run assets`);
 * see INTEGRATION.md §2.
 */
const registry: Record<LangId, Runtime> = {
  java: new JavaRuntime({ workerUrl: new URL('warsha-jvm.worker.js', document.baseURI).href }),
  python: new PythonRuntime(),
  // .NET-wasm + Roslyn; module worker loaded by URL (not bundled) so its relative
  // dotnet.js import resolves. See runtimes/csharp/INTEGRATION.md.
  csharp: new CSharpRuntime({ workerUrl: new URL('warsha-dotnet/dotnet.worker.js', document.baseURI).href }),
  // clang-wasm compiles in a module worker, which then runs the WASIX output
  // under a WASI shim so stdin can block (interactive scanf). See runtimes/clang/INTEGRATION.md.
  c: new ClangRuntime({ workerUrl: new URL('warsha-clang.worker.js', document.baseURI).href }),
  // First-party: `web` renders into the preview iframe, `js` runs headless like
  // Node. Both are free until TS or cross-file imports pull in esbuild on demand.
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

/** Terminates every engine worker on page unload, so a backgrounded tab doesn't hold a JVM+CPython heap against iPad memory pressure. Not called on language switch — a Java re-warm costs 7–20s. */
export function disposeRuntimes(): void {
  for (const runtime of Object.values(registry)) {
    try {
      runtime.dispose?.()
    } catch {
      /* nothing useful to do while the page is closing */
    }
  }
}

/** Runtime selected by extension: html/css draws the preview, js/ts runs headless. Editor grammar is separate (editorLangForPath). */
export function langForPath(path: string): LangId | null {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.py')) return 'python'
  if (path.endsWith('.cs')) return 'csharp'
  if (path.endsWith('.c')) return 'c'
  if (/\.(html?|css)$/i.test(path)) return 'web'
  if (SCRIPT_RE.test(path)) return 'js'
  return null
}

/** Extensions the `js` engine runs headless. TypeScript or cross-file imports get bundled first (bundle.ts); plain one-file JS doesn't. */
const SCRIPT_RE = /\.(m?js|cjs|jsx|tsx?|mts|cts)$/i

const JAVA_MAIN = /public\s+static\s+void\s+main\s*\(/
const CSHARP_MAIN = /\bstatic\s+(?:async\s+)?(?:void|int|Task(?:<\s*int\s*>)?)\s+Main\s*\(/
const C_MAIN = /\b(?:int|void)\s+main\s*\(/

/**
 * Entry-point candidates, best first — Java: file with a main method; Python:
 * main.py/__main__.py else a top-level .py; C#: Main method or Program.cs else a
 * lone .cs; Web: index.html then other .html, else a lone .js/.css.
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
  // A Main method, or Program.cs (.NET's top-level-statements convention) —
  // Roslyn resolves the real entry, so a lone .cs is offered regardless of name.
  const csMain = files
    .filter(
      (f) =>
        f.path.endsWith('.cs') &&
        (CSHARP_MAIN.test(f.content) || baseName(f.path).toLowerCase() === 'program.cs'),
    )
    .map((f) => f.path)
    .sort(byDepthThenName)
  const csOrdered = csMain.length ? csMain : cs.length === 1 ? cs : []

  // The .c file declaring main; all .c files compile together, so a lone .c is
  // offered regardless of name. Headers never are.
  const c = files.filter((f) => f.path.endsWith('.c')).map((f) => f.path)
  const cMain = files
    .filter((f) => f.path.endsWith('.c') && C_MAIN.test(f.content))
    .map((f) => f.path)
    .sort(byDepthThenName)
  const cOrdered = cMain.length ? cMain : c.length === 1 ? c : []

  const browser = browserCandidates(files)

  // Whichever stack actually has a runnable entry leads the list.
  return dedupe([...java, ...pyOrdered, ...csOrdered, ...cOrdered, ...browser])
}

/** Browser-runnable candidates: html preferred, else a script or stylesheet. Which engine each selects is `runtimeFor`'s job, not this one's. */
function browserCandidates(files: SourceFile[]): string[] {
  const html = files.filter((f) => /\.html?$/i.test(f.path)).map((f) => f.path)
  if (html.length) {
    const index = html.filter((p) => baseName(p).toLowerCase() === 'index.html').sort(byDepthThenName)
    const rest = html.filter((p) => baseName(p).toLowerCase() !== 'index.html').sort(byDepthThenName)
    return dedupe([...index, ...rest])
  }
  // No HTML: scripts lead CSS (a script is a program, a stylesheet just a demo
  // page); main/index is preferred so a multi-file project runs its real entry.
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
