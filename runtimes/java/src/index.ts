/* Warsha Java runtime -- public entry point.
 *
 *   import { JavaRuntime } from '../../runtimes/java/src'
 *   const java = new JavaRuntime({ workerUrl: './warsha-jvm.worker.js' })
 *   await java.load(p => showProgress(p))
 *   const session = await java.run(files, 'app/Main.java', io)
 *
 * See INTEGRATION.md for Vite wiring (the worker must stay CLASSIC, unlike the
 * Python runtime's) and behaviour notes.
 */

export { JavaRuntime } from './javaRuntime'
export type { JavaRuntimeOptions, JavaRunSession } from './javaRuntime'
export type { LoadPhase, LoadProgress, ProgressReport, RunIO, RunSession, Runtime, SourceFile } from './types'
