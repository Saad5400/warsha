import type { Runtime, SourceFile } from './types'
import { FakeRuntime } from './fake'
import { PythonRuntime } from '../../../runtimes/python/src'

export type LangId = 'java' | 'python'

/**
 * The single place that maps a language to its engine.
 * To plug in a real engine: implement Runtime, then swap the value here.
 *
 * One PythonRuntime instance per app is correct: it owns a single Pyodide worker
 * and reuses it across runs (see runtimes/python/INTEGRATION.md §1).
 */
const registry: Record<LangId, Runtime> = {
  java: new FakeRuntime('java'),
  python: new PythonRuntime(),
}

export function runtimeFor(entryPath: string): Runtime | null {
  const lang = langForPath(entryPath)
  return lang ? registry[lang] : null
}

export function langForPath(path: string): LangId | null {
  if (path.endsWith('.java')) return 'java'
  if (path.endsWith('.py')) return 'python'
  return null
}

const JAVA_MAIN = /public\s+static\s+void\s+main\s*\(/

/**
 * Entry-point candidates, best first. Java: any file declaring a main method.
 * Python: main.py / __main__.py, else any top-level .py file.
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

  // Whichever language actually has a runnable entry leads the list.
  return java.length ? dedupe([...java, ...pyOrdered]) : pyOrdered
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
