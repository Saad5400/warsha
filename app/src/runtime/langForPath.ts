/**
 * THE extension → language map. Its own module, with no imports, so the
 * lightweight boot path (analytics, the crash screen) can name a file's
 * language without pulling every engine in through runtime/index.ts.
 */

/** Runtime key, distinct from the editor language (see editorLangForPath). `web` draws the preview; `js` is a headless script — an HTML-referenced `.js` is inlined by `web`, not chosen here. */
export type LangId = 'java' | 'python' | 'web' | 'js' | 'csharp' | 'c'

/** Extensions the `js` engine runs headless. TypeScript or cross-file imports get bundled first (bundle.ts); plain one-file JS doesn't. */
export const SCRIPT_RE = /\.(m?js|cjs|jsx|tsx?|mts|cts)$/i

/** TypeScript among the scripts — what `js` must transpile first. */
export const TYPESCRIPT_RE = /\.(m?tsx?|cts|mts)$/i

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
