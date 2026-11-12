/**
 * The debugger's one source of truth, outside React: breakpoints (persisted
 * per project), the live session's phase (running / paused), the parked stop
 * with its frames, the selected frame, and watch expressions.
 *
 * Every debug surface reads this: the editor's gutter/current-line/inline
 * values (editor/debugExt.ts), the Run & Debug view, the floating toolbar, the
 * status bar. useRunner attaches the engine's DebugSession and forwards its
 * stop/resume events here. Plain TS + a subscribe() — React reads it through
 * useDebugState() (useSyncExternalStore).
 */
import { useSyncExternalStore } from 'react'
import type { DebugBreakpoint, DebugFrame, DebugSession, DebugStepCommand, DebugStopped, DebugValue } from '../runtime/debug'

export interface BreakpointEntry {
  path: string
  line: number
  enabled: boolean
}

export type DebugPhase = 'inactive' | 'running' | 'paused'

export interface WatchEntry {
  id: number
  expr: string
}

export type WatchResult = { value: DebugValue } | { error: string }

export interface DebugState {
  phase: DebugPhase
  stopped: DebugStopped | null
  /** Index into stopped.frames the views are showing (0 = where execution is parked). */
  frameIndex: number
  breakpoints: BreakpointEntry[]
  watches: WatchEntry[]
  watchResults: Record<number, WatchResult>
  /** Bumps on every stop, so effects (open the file, reveal the line) fire even on a same-line stop. */
  stopSeq: number
  /** Whether the run under way was started with the debugger. */
  debugging: boolean
}

type Listener = () => void

const STORAGE_PREFIX = 'warsha.debug.v1.'

/** Extensions whose files can carry a breakpoint (the debuggable engines' sources),
 *  and notebook cells, whose path is `nb.ipynb#cell=<id>` (notebook/nbformat.ts). */
const DEBUGGABLE = /\.(py|java|cs|c|m?js|cjs|jsx|tsx?|mts|cts)$|\.ipynb#cell=[\w-]+$/i
export function canHoldBreakpoints(path: string | null | undefined): boolean {
  return !!path && DEBUGGABLE.test(path)
}

class DebugStore {
  private state: DebugState = {
    phase: 'inactive',
    stopped: null,
    frameIndex: 0,
    breakpoints: [],
    watches: [],
    watchResults: {},
    stopSeq: 0,
    debugging: false,
  }
  private listeners = new Set<Listener>()
  private session: DebugSession | null = null
  private projectKey: string | null = null
  private varCache = new Map<number, Promise<DebugValue[]>>()
  private nextWatchId = 1

  // ---- subscription ----
  get = () => this.state
  subscribe = (fn: Listener) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private set(patch: Partial<DebugState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of [...this.listeners]) fn()
  }

  // ---- persistence (per project) ----
  setProject(id: string | null) {
    if (id === this.projectKey) return
    this.projectKey = id
    let breakpoints: BreakpointEntry[] = []
    let watches: WatchEntry[] = []
    if (id) {
      try {
        const raw = localStorage.getItem(STORAGE_PREFIX + id)
        if (raw) {
          const data = JSON.parse(raw) as { breakpoints?: BreakpointEntry[]; watches?: string[] }
          breakpoints = (data.breakpoints ?? []).filter((b) => typeof b.path === 'string' && b.line > 0)
          watches = (data.watches ?? []).map((expr) => ({ id: this.nextWatchId++, expr }))
        }
      } catch {
        /* a corrupt entry just means no breakpoints */
      }
    }
    this.set({ breakpoints: sortBps(breakpoints), watches, watchResults: {} })
  }
  private persist() {
    if (!this.projectKey) return
    try {
      localStorage.setItem(
        STORAGE_PREFIX + this.projectKey,
        JSON.stringify({ breakpoints: this.state.breakpoints, watches: this.state.watches.map((w) => w.expr) }),
      )
    } catch {
      /* storage full or blocked — breakpoints still work for this session */
    }
  }

  // ---- breakpoints ----
  linesFor(path: string): BreakpointEntry[] {
    return this.state.breakpoints.filter((b) => b.path === path)
  }
  has(path: string, line: number) {
    return this.state.breakpoints.some((b) => b.path === path && b.line === line)
  }
  toggleBreakpoint(path: string, line: number) {
    if (!canHoldBreakpoints(path)) return
    const exists = this.has(path, line)
    this.updateBreakpoints(
      exists
        ? this.state.breakpoints.filter((b) => !(b.path === path && b.line === line))
        : [...this.state.breakpoints, { path, line, enabled: true }],
    )
  }
  setEnabled(path: string, line: number, enabled: boolean) {
    this.updateBreakpoints(this.state.breakpoints.map((b) => (b.path === path && b.line === line ? { ...b, enabled } : b)))
  }
  setAllEnabled(enabled: boolean) {
    this.updateBreakpoints(this.state.breakpoints.map((b) => ({ ...b, enabled })))
  }
  removeBreakpoint(path: string, line: number) {
    this.updateBreakpoints(this.state.breakpoints.filter((b) => !(b.path === path && b.line === line)))
  }
  removeAll() {
    this.updateBreakpoints([])
  }
  /** The editor moved this file's breakpoints with an edit (lines inserted above, etc.). */
  replaceFile(path: string, entries: { line: number; enabled: boolean }[]) {
    const mine = this.linesFor(path)
    if (mine.length === entries.length && mine.every((b, i) => b.line === entries[i].line && b.enabled === entries[i].enabled)) return
    this.updateBreakpoints([
      ...this.state.breakpoints.filter((b) => b.path !== path),
      ...entries.map((e) => ({ path, ...e })),
    ])
  }
  renamePath(from: string, to: string) {
    const isDir = (p: string) => within(p, from)
    if (!this.state.breakpoints.some((b) => isDir(b.path))) return
    this.updateBreakpoints(this.state.breakpoints.map((b) => (isDir(b.path) ? { ...b, path: to + b.path.slice(from.length) } : b)))
  }
  dropPath(path: string) {
    const gone = (p: string) => within(p, path)
    if (!this.state.breakpoints.some((b) => gone(b.path))) return
    this.updateBreakpoints(this.state.breakpoints.filter((b) => !gone(b.path)))
  }
  enabledBreakpoints(): DebugBreakpoint[] {
    return this.state.breakpoints.filter((b) => b.enabled).map(({ path, line }) => ({ path, line }))
  }
  private updateBreakpoints(next: BreakpointEntry[]) {
    const deduped = new Map<string, BreakpointEntry>()
    for (const b of next) deduped.set(`${b.path}:${b.line}`, b)
    this.set({ breakpoints: sortBps([...deduped.values()]) })
    this.persist()
    this.session?.setBreakpoints(this.enabledBreakpoints())
  }

  // ---- session lifecycle (driven by useRunner, and by a notebook's session) ----
  /**
   * Two things can run code: the program runner and a notebook's kernel. Each
   * passes itself as `owner`, and while one is DEBUGGING the other's lifecycle
   * calls are ignored — a plain Run starting (or ending) must not reset the
   * store under a paused notebook cell, orphaning it with no way to resume.
   * Starting a second debug session is refused by the callers (`busyFor`).
   */
  private owner: unknown = 'program'
  /** True when someone other than `owner` holds a live debug session. */
  busyFor(owner: unknown): boolean {
    return this.state.debugging && this.owner !== owner
  }
  begin(debugging: boolean, owner: unknown = 'program') {
    if (this.busyFor(owner)) return
    this.owner = owner
    this.session = null
    this.varCache.clear()
    this.set({ phase: debugging ? 'running' : 'inactive', debugging, stopped: null, frameIndex: 0, watchResults: {} })
  }
  attach(session: DebugSession, owner: unknown = 'program') {
    if (this.busyFor(owner)) return
    this.session = session
    // Breakpoints toggled while the engine was booting reach it now.
    session.setBreakpoints(this.enabledBreakpoints())
  }
  end(owner: unknown = 'program') {
    if (this.busyFor(owner)) return
    this.session = null
    this.varCache.clear()
    if (this.state.phase !== 'inactive' || this.state.debugging)
      this.set({ phase: 'inactive', debugging: false, stopped: null, frameIndex: 0, watchResults: {} })
  }
  /** Stops and resumes come from whoever runs code; only the owner of the live debug session is heard. */
  onStop(stopped: DebugStopped, owner: unknown = 'program') {
    if (this.busyFor(owner)) return
    this.varCache.clear()
    this.set({ phase: 'paused', stopped, frameIndex: 0, stopSeq: this.state.stopSeq + 1 })
    void this.refreshWatches()
  }
  onResume(owner: unknown = 'program') {
    if (this.busyFor(owner)) return
    this.varCache.clear()
    if (this.state.phase === 'paused') this.set({ phase: 'running', stopped: null, frameIndex: 0 })
  }

  // ---- commands ----
  resume(cmd: DebugStepCommand) {
    if (this.state.phase !== 'paused' || !this.session) return
    this.session.resume(cmd)
    // Optimistic: the toolbar flips to Pause immediately; onDebugResume confirms.
    this.onResume(this.owner)
  }
  pause() {
    if (this.state.phase === 'running') this.session?.pause()
  }
  selectFrame(i: number) {
    const frames = this.state.stopped?.frames
    if (!frames || i < 0 || i >= frames.length || i === this.state.frameIndex) return
    this.set({ frameIndex: i })
    void this.refreshWatches()
  }
  currentFrame(): DebugFrame | null {
    return this.state.stopped?.frames[this.state.frameIndex] ?? null
  }

  /** Children of an expandable value; cached for the life of the stop. */
  variables(ref: number): Promise<DebugValue[]> {
    if (!this.session || this.state.phase !== 'paused') return Promise.resolve([])
    let p = this.varCache.get(ref)
    if (!p) {
      p = this.session.variables(ref).catch(() => [])
      this.varCache.set(ref, p)
    }
    return p
  }

  async childrenOf(v: DebugValue): Promise<DebugValue[]> {
    if (v.children) return v.children
    if (v.ref) return this.variables(v.ref)
    return []
  }

  /** Evaluate in the selected frame: the engine's own evaluator when it has one, else a path walk over the frame's variables. */
  async evaluate(expr: string): Promise<DebugValue> {
    const text = expr.trim()
    if (!text) throw new Error('Empty expression')
    const frame = this.currentFrame()
    if (!frame || !this.session || this.state.phase !== 'paused') throw new Error('Not paused')
    if (this.session.evaluate) return this.session.evaluate(text, this.state.frameIndex)
    return this.resolvePath(frame, text)
  }

  private async resolvePath(frame: DebugFrame, expr: string): Promise<DebugValue> {
    const steps = parsePath(expr)
    if (!steps) throw new Error(`Can't evaluate "${expr}" here — try a variable name like a.b[0]`)
    const [root, ...rest] = steps
    let cur: DebugValue | undefined
    if (root === 'this') cur = thisValue(frame)
    if (!cur) {
      for (const scope of frame.scopes) {
        cur = scope.variables.find((v) => v.name === root)
        if (cur) break
      }
    }
    if (!cur) {
      // A bare field name inside a method — look through `this`.
      const self = thisValue(frame)
      if (self) cur = (await this.childrenOf(self)).find((v) => v.name === root)
    }
    if (!cur) throw new Error(`${root} is not defined`)
    for (const step of rest) {
      const kids = await this.childrenOf(cur)
      const next: DebugValue | undefined = kids.find((k) => k.name === step || k.name === `[${step}]` || k.name === `'${step}'` || k.name === `"${step}"`)
      if (!next) throw new Error(`${cur.name} has no ${/^\d+$/.test(step) ? `element [${step}]` : `member ${step}`}`)
      cur = next
    }
    return { ...cur, name: expr }
  }

  // ---- watches ----
  addWatch(expr: string) {
    const text = expr.trim()
    if (!text) return
    const w = { id: this.nextWatchId++, expr: text }
    this.set({ watches: [...this.state.watches, w] })
    this.persist()
    void this.refreshWatch(w)
  }
  editWatch(id: number, expr: string) {
    const text = expr.trim()
    if (!text) return this.removeWatch(id)
    this.set({ watches: this.state.watches.map((w) => (w.id === id ? { ...w, expr: text } : w)) })
    this.persist()
    const w = this.state.watches.find((x) => x.id === id)
    if (w) void this.refreshWatch(w)
  }
  removeWatch(id: number) {
    const { [id]: _gone, ...rest } = this.state.watchResults
    this.set({ watches: this.state.watches.filter((w) => w.id !== id), watchResults: rest })
    this.persist()
  }
  removeAllWatches() {
    this.set({ watches: [], watchResults: {} })
    this.persist()
  }
  private async refreshWatches() {
    await Promise.all(this.state.watches.map((w) => this.refreshWatch(w)))
  }
  private async refreshWatch(w: WatchEntry) {
    if (this.state.phase !== 'paused') return
    const seq = this.state.stopSeq
    const frame = this.state.frameIndex
    let result: WatchResult
    try {
      result = { value: await this.evaluate(w.expr) }
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) }
    }
    // Drop a stale answer: the program moved on, or another frame was picked.
    if (seq !== this.state.stopSeq || frame !== this.state.frameIndex) return
    this.set({ watchResults: { ...this.state.watchResults, [w.id]: result } })
  }
}

/** `p` is `root`, under it as a folder, or one of its cells as a notebook. */
function within(p: string, root: string): boolean {
  return p === root || p.startsWith(root + '/') || p.startsWith(root + '#')
}

function sortBps(bps: BreakpointEntry[]) {
  return bps.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path.localeCompare(b.path)))
}

function thisValue(frame: DebugFrame): DebugValue | undefined {
  for (const s of frame.scopes) {
    const v = s.variables.find((x) => x.name === 'this' || x.name === 'self')
    if (v) return v
    if (/^this$/i.test(s.name)) return { name: 'this', value: '', children: s.variables }
  }
  return undefined
}

/** `a.b[2]["k"]` → ['a','b','2','k']; null when it is not a plain path. */
export function parsePath(expr: string): string[] | null {
  const re = /^\s*([A-Za-z_$][\w$]*)|\.\s*([A-Za-z_$][\w$]*)|\[\s*(-?\d+|"[^"]*"|'[^']*')\s*\]|->\s*([A-Za-z_$][\w$]*)/y
  const out: string[] = []
  let i = 0
  const src = expr.trim()
  while (i < src.length) {
    re.lastIndex = i
    const m = re.exec(src)
    if (!m || (out.length === 0 && !m[1]) || (out.length > 0 && m[1])) return null
    const part = m[1] ?? m[2] ?? m[4] ?? m[3]!.replace(/^["']|["']$/g, '')
    out.push(part)
    i = re.lastIndex
  }
  return out.length ? out : null
}

export const debugStore = new DebugStore()

export function useDebugState(): DebugState {
  return useSyncExternalStore(debugStore.subscribe, debugStore.get)
}
