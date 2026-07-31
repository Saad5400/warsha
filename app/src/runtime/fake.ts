import type { ProgressReport, RunIO, RunSession, Runtime, SourceFile } from './types'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

const MB = 1024 * 1024
/** Roughly what the real engines weigh, so the progress UI is exercised honestly. */
const SIZE = { java: 38 * MB, python: 12 * MB }

/**
 * A stand-in for a real execution engine. It fakes the download → unpack → boot
 * → run cycle so the whole IDE is demoable before the Java/Python engines land:
 * reports structured progress, streams stdout in chunks (including a prompt with
 * no trailing newline), asks for stdin once, echoes the answer, honours kill().
 *
 * Replace-me target: see src/runtime/index.ts for the registry.
 */
export class FakeRuntime implements Runtime {
  readonly id: 'java' | 'python'
  private loaded = false
  private loading: Promise<void> | null = null

  constructor(id: 'java' | 'python') {
    this.id = id
  }

  load(onProgress: (p: ProgressReport) => void): Promise<void> {
    // Idempotent, and a cache hit reports nothing at all: per spec the second
    // run goes straight to Running with no progress block.
    if (this.loaded) return Promise.resolve()
    if (this.loading) return this.loading

    const lang = this.id === 'java' ? 'Java' : 'Python'
    const total = SIZE[this.id]
    this.loading = (async () => {
      for (let i = 1; i <= 5; i++) {
        await sleep(180)
        onProgress({
          phase: 'download',
          message: `Getting ${lang} ready — this happens once.`,
          loaded: Math.round((total * i) / 5),
          total,
        })
      }
      await sleep(160)
      onProgress({ phase: 'unpack', message: 'Unpacking' })
      await sleep(200)
      onProgress({ phase: 'boot', message: 'Starting up' })
      await sleep(180)
      this.loaded = true
      this.loading = null
    })()
    return this.loading
  }

  async run(files: SourceFile[], entryPath: string, io: RunIO): Promise<RunSession> {
    let killed = false
    let stdinResolve: ((line: string) => void) | null = null

    const session: RunSession = {
      kill() {
        killed = true
        if (stdinResolve) {
          stdinResolve('')
          stdinResolve = null
        }
      },
      writeStdin(line: string) {
        if (stdinResolve) {
          const r = stdinResolve
          stdinResolve = null
          r(line)
        }
      },
    }

    // Arm the resolver before announcing the request: the shell hands over a
    // line typed ahead of the prompt the moment it hears about it.
    const askStdin = () =>
      new Promise<string>((resolve) => {
        stdinResolve = resolve
        io.onStdinRequest()
      })

    void (async () => {
      const out = (t: string) => io.onStdout(t + '\n')
      const err = (t: string) => io.onStderr(t + '\n')
      const alive = async (ms: number) => {
        await sleep(ms)
        return !killed
      }

      if (this.id === 'java') {
        out(`javac ${entryPath} (${files.length} source file${files.length === 1 ? '' : 's'})`)
        if (!(await alive(360))) return io.onExit(null)
        out('=== Warsha starter ===')
        for (const line of ['Layla, age 34', 'Omar, age 20, studies Computer Science']) {
          if (!(await alive(300))) return io.onExit(null)
          out(line)
        }
        if (!(await alive(240))) return io.onExit(null)
        // Deliberately no trailing newline: the console must render this chunk
        // right away and put the input row after it on the same visual line.
        io.onStdout('Your name: ')
        const name = await askStdin()
        if (killed) return io.onExit(null)
        out(`Hello, ${name || 'friend'}! Now open models/Person.java.`)
        if (!(await alive(260))) return io.onExit(null)
        err('This is the FakeRuntime — no real JVM ran.')
        await sleep(120)
        io.onExit(0)
      } else {
        out('=== Warsha starter ===')
        for (const line of ['Circle: area = 12.57', 'Rectangle: area = 12.00', 'Total area = 24.57']) {
          if (!(await alive(300))) return io.onExit(null)
          out(line)
        }
        if (!(await alive(240))) return io.onExit(null)
        io.onStdout('Your name: ')
        const name = await askStdin()
        if (killed) return io.onExit(null)
        out(`Hello, ${name || 'friend'}! Now open helpers/shapes.py and add a Square.`)
        if (!(await alive(260))) return io.onExit(null)
        err('This is the FakeRuntime — no real interpreter ran.')
        await sleep(120)
        io.onExit(0)
      }
    })()

    return session
  }
}
