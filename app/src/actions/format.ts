/**
 * "Format file" (top-right ⋯ menu, Shift+Alt+F) — reformat the active file,
 * client-side, in whichever language it is written in.
 *
 * Java goes through prettier + prettier-plugin-java, loaded on first use only
 * (see `loadJavaFormatter` below) — it never touches CheerpJ. Python goes
 * through black, run inside the *already-booted* Pyodide worker (see
 * `runtimes/python/src/pythonRuntime.ts#format`); this module never boots a
 * second interpreter just to format a file.
 *
 * Deliberately pure: this file does not know about toasts, menus or the
 * editor. `App.tsx` calls `formatFile`, catches what it throws, and decides
 * what the student sees.
 */
import { langForPath, runtimeFor } from '../runtime'

/** Thrown when a .py file is formatted before the student has ever run one —
 *  Pyodide is not booted, and booting it just to format would be a silent,
 *  confusing 11 MB download behind a menu click. */
export class PythonNotLoadedError extends Error {}

/** True for any language `langForPath` recognises, not just Java/Python (the
 *  two `formatFile` handles) — other extensions pass here then throw there. */
export function canFormat(path: string | null): boolean {
  return path !== null && langForPath(path) !== null
}

let javaFormatterPromise: Promise<{
  format: (source: string, options: Record<string, unknown>) => Promise<string>
  javaPlugin: unknown
}> | null = null

/** Loaded once per page, on the first Java format — never in the initial
 *  bundle, and never merely because a .java file was opened. */
function loadJavaFormatter() {
  if (!javaFormatterPromise) {
    javaFormatterPromise = Promise.all([import('prettier/standalone'), import('prettier-plugin-java')]).then(
      ([prettier, javaPluginModule]) => ({
        format: prettier.format,
        javaPlugin: javaPluginModule.default,
      }),
    )
  }
  return javaFormatterPromise
}

/** Exported for `actions/generate.ts`, which builds a new source string (fields
 *  spliced into the class) and leans on this same tabWidth-4 pass to lay it out
 *  canonically — the generator writes rough Java, prettier makes it idiomatic. */
export async function formatJava(source: string): Promise<string> {
  const { format, javaPlugin } = await loadJavaFormatter()
  return format(source, {
    parser: 'java',
    plugins: [javaPlugin],
    tabWidth: 4,
  })
}

async function formatPython(path: string, source: string): Promise<string> {
  const runtime = runtimeFor(path)
  if (!runtime?.format) throw new Error('Python formatting is unavailable.')
  if (runtime.isReady && !runtime.isReady()) {
    throw new PythonNotLoadedError('Python has not been loaded yet.')
  }
  return runtime.format(source)
}

/**
 * Reformats `source`. Rejects with `PythonNotLoadedError` for the one case
 * the caller should word differently; any other extension is a caller bug,
 * not user-facing, and rejects like any other error.
 */
export async function formatFile(path: string, source: string): Promise<string> {
  const lang = langForPath(path)
  if (lang === 'java') return formatJava(source)
  if (lang === 'python') return formatPython(path, source)
  throw new Error(`Cannot format ${path}: unrecognised language.`)
}
