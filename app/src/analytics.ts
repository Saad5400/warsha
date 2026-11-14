import { langForPath, TYPESCRIPT_RE } from './runtime/langForPath'

/**
 * Product analytics — the few aggregate counts that tell us whether Warsha is
 * working, and nothing more.
 *
 * The whole of this file is bounded by one rule: **an event may only ever carry
 * a value chosen from a list written down in this file.** Never a file name,
 * never a project name, never an error message, never anything a student typed.
 * `run_failed` records that a Java engine failed to boot and *which category* of
 * failure it was — not the stack trace. Adding a free-text field here would turn
 * an anonymous counter into something that can leak a student's homework, so
 * the payload types below are deliberately closed unions rather than `string`.
 *
 * ONE exception, made on purpose (2026-11-14): the `error` event carries a
 * scrubbed error message and bundle-file frames so crashes can be fixed, not just
 * counted. Its limits are written down at `reportError()` at the bottom of this
 * file; docs/legal/PRIVACY.md must say so before this ships.
 *
 * What this buys us: which languages are actually used (the "Soon" list is
 * guesswork until students tap one), whether first runs succeed, and how often
 * an engine fails to start on real devices — the R1/R3 risks in the PRD, which
 * today we can only measure by borrowing a phone.
 *
 * Every counter below has its failure half. That is deliberate and it is the
 * point of the catalogue: Warsha sees a handful of sessions a day, so an app
 * that has broken for everyone and an app nobody opened this week produce the
 * same graph unless the breakage is itself counted. `run_started` pairs with
 * `run_finished`/`run_failed`, `account_auth` carries its own result, and
 * `capability_blocked`, `app_crashed` and `cloud_backup_failed` exist only to
 * make silent dead ends visible.
 *
 * Transport is the self-hosted Umami tag in `index.html` (cookieless, no
 * identifier that survives a visit — see docs/legal/PRIVACY.md). It is loaded
 * `defer` and may be blocked outright, so `track()` buffers and gives up
 * quietly; analytics must never be something the editor waits on.
 */

/** Every language an event may name. Mirrors `Template['lang']`, plus the ids of the "Soon" tiles. */
export type EventLang = string

/** Why a project came into existence. */
export type ProjectSource = 'template' | 'blank' | 'zip' | 'share'

/** How a run ended, from the student's point of view. */
export type RunResult = 'ok' | 'error' | 'stopped'

/** The `RunFailure['kind']` values — a run that never started, bucketed by cause. */
export type FailureKind = 'offline' | 'isolation' | 'storage' | 'engine'

/** The capability ids from `capabilities.ts` — the four things a device can be missing. */
export type CapabilityId = 'wasm' | 'opfs' | 'isolation' | 'workers'

/** Which half of the account form was submitted. */
export type AuthMode = 'signin' | 'signup'

/**
 * How an account attempt ended. The failure words are the API's own closed set
 * (`AuthResult['error']`, collab/api.ts) — never the message shown to the
 * student, and never the email that was typed.
 */
export type AuthResult = 'ok' | 'taken' | 'weak' | 'invalid' | 'network'

/** Why a project failed to reach the cloud. Mirrors `SeedStatus` minus its success. */
export type BackupFailure = 'quota' | 'too-large' | 'error'

/** How opening a share link ended. */
export type ShareOpenResult = 'ok' | 'broken' | 'save-failed'

/**
 * The closed event catalogue. One entry per thing we are allowed to count; the
 * value type is the event's payload. Anything not listed here cannot be sent,
 * which is the point — `track()` takes no arbitrary name.
 */
interface Events {
  /** A project was started. `lang` is the template's language, or 'mixed' for an imported zip we cannot classify. */
  project_created: { source: ProjectSource; lang: EventLang }
  /** Run pressed. Paired with `run_finished` — the gap between the two counts is the "engine never booted" rate. */
  run_started: { lang: EventLang }
  /** A run reached an end the student saw. */
  run_finished: { lang: EventLang; result: RunResult }
  /** A run could not start at all. The single most useful number for R1 (WebKit) and R3 (payload). */
  run_failed: { lang: EventLang; kind: FailureKind }
  /** Work left the device by the student's own hand: zip, PDF or share link. */
  project_shared: { via: 'zip' | 'pdf' | 'link' }
  /** A dimmed "Soon" tile was tapped. Pure roadmap demand — the tile does nothing, and still doesn't. */
  language_requested: { lang: EventLang }
  /**
   * The device is missing something Warsha needs — one event per failed check.
   * This is the R1 risk (iPadOS/WebKit) made countable. A student who hits the
   * fatal screen leaves a page view and nothing else today, so a browser that
   * cannot run Warsha at all is currently indistinguishable from a bounce. The
   * `reason` is the capability id, never the user agent: a UA string is a
   * fingerprint, and Umami already records browser/OS/device on the visit.
   */
  capability_blocked: { level: 'fatal' | 'warn'; reason: CapabilityId }
  /**
   * The React error boundary caught a render throw — the white-screen failure.
   * No message, no stack, no component name: a stack frame can carry a file
   * path, and file names never leave the device (see `langOfEntry`). That it
   * happened, and how often, is the whole signal.
   */
  app_crashed: Record<string, never>
  /**
   * A release's offline copy installed incomplete: the service worker failed to
   * install it several times in a row and then went through best-effort
   * (public/coi-serviceworker.js). Without this, a release that cannot install
   * — one missing file — is invisible: the old version keeps running and
   * nothing says so. Nothing about the device or the files is sent.
   */
  offline_install_degraded: Record<string, never>
  /**
   * An account sign-in or sign-up attempt resolved. Both halves on one event so
   * the failure rate is the same number as the attempt count — a broken
   * warsha-api shows up as `result: network` climbing, not as a quiet week with
   * fewer successes.
   */
  account_auth: { mode: AuthMode; result: AuthResult }
  /**
   * A project could not be backed up to the account. The student is told only
   * about `quota`; the other two are silent today, which is the worst kind of
   * failure for a feature whose entire promise is that work is safe.
   */
  cloud_backup_failed: { kind: BackupFailure }
  /**
   * Someone opened a `#share=` link. Share links are how Warsha travels between
   * devices without an account, so a link that arrives broken (truncated by a
   * chat app, hand-edited) or that cannot be saved is a distribution failure we
   * otherwise never hear about. Counted for the receiving student only; the
   * sender is already counted by `project_shared`.
   */
  share_opened: { result: ShareOpenResult }
  /**
   * An unexpected error — the ONE event that carries text. See `reportError()`
   * below for why, and for everything that is stripped before it is sent.
   */
  error: ErrorPayload
}

type EventName = keyof Events

interface UmamiTag {
  track(name: string, data?: Record<string, string | number | boolean>): void
}

/** How long to hold events while the tag loads before deciding it never will (blocked, offline, self-hosted instance down). */
const READY_TIMEOUT_MS = 10_000
const POLL_MS = 250
/** A runaway caller must not grow an unbounded array in memory. */
const MAX_QUEUED = 25

const queue: Array<{ name: string; data: Record<string, string | number | boolean> }> = []
let polling = false
let gaveUp = false

function tag(): UmamiTag | null {
  const u = (globalThis as { umami?: UmamiTag }).umami
  return typeof u?.track === 'function' ? u : null
}

function flush(): boolean {
  const umami = tag()
  if (!umami) return false
  while (queue.length) {
    const event = queue.shift()!
    try {
      umami.track(event.name, event.data)
    } catch {
      /* A broken tag is not the editor's problem. */
    }
  }
  return true
}

function drainWhenReady(): void {
  if (polling || gaveUp) return
  polling = true
  const deadline = Date.now() + READY_TIMEOUT_MS
  const tick = () => {
    if (flush()) {
      polling = false
      return
    }
    if (Date.now() > deadline) {
      // Blocked or unreachable. Stop polling for the rest of the session and
      // drop what we were holding — retrying forever is a battery cost paid for
      // nothing.
      polling = false
      gaveUp = true
      queue.length = 0
      return
    }
    setTimeout(tick, POLL_MS)
  }
  tick()
}

/**
 * Count one event. Never throws, never awaits, never blocks the caller — a
 * failure to measure is not a failure the student should ever notice.
 */
export function track<K extends EventName>(name: K, data: Events[K]): void {
  if (gaveUp || typeof window === 'undefined') return
  if (queue.length >= MAX_QUEUED) return
  queue.push({ name, data: { ...data } })
  drainWhenReady()
}

/**
 * The language an entry file belongs to, for the run events. Deliberately the
 * *extension's* language and not the project's — a web project running a bare
 * `.ts` file is a different thing to measure than one rendering `index.html`.
 * Returns 'other' rather than the extension itself: an unknown suffix is still
 * a student's file name, and file names never leave the device.
 */
export function langOfEntry(entryPath: string): EventLang {
  // The engine comes from the one extension map; only the finer split the events
  // report (TypeScript vs JavaScript, a page vs a stylesheet) is decided here.
  const lang = langForPath(entryPath)
  if (lang === 'js') return TYPESCRIPT_RE.test(entryPath) ? 'typescript' : 'javascript'
  if (lang === 'web') return /\.css$/i.test(entryPath) ? 'css' : 'html'
  return lang ?? 'other'
}

// ───────────────────────────────────────────────────────────────────────────
// Error reports
// ───────────────────────────────────────────────────────────────────────────
//
// The single, deliberate exception to "no free text" above. `app_crashed` tells
// us that something broke; it cannot tell us *what*, and a crash we cannot
// reproduce on a desk is a crash we cannot fix — a Java worker dying with
// "Cannot read properties of undefined (reading 'type')" on a student's phone
// leaves nothing behind but that line in a console nobody can open.
//
// So this event carries the error's own message and where in *Warsha's* code it
// came from — and is built so that it cannot carry the student's work:
//   - only Warsha's own errors are reported: a window error from another origin
//     (an extension, a third-party script) is dropped, and callers pass engine
//     crashes, never a student program's exception or output;
//   - the message is scrubbed: URLs become their last path segment, anything that
//     looks like a file path, a source-file name or an email address is replaced,
//     long quoted strings are elided, and the result is cut to MESSAGE_MAX;
//   - `source` and `stack` are reduced to `bundle-file.js:line:col` frames — never
//     a query string, a hash, or a directory;
//   - no code, no file contents, no stdin, no user agent (Umami records browser/OS
//     on the visit already).
// Bounded per tab: one report per distinct error, MAX_REPORTS in total, so a
// throwing render loop or a crash-restart cycle cannot flood the database.

/** What kind of failure this is. Closed — add a word here before using it. */
export type ErrorKind =
  | 'runtime-crash' // an engine/worker died underneath a run (Java, Python, C#, C…)
  | 'window-error' // an uncaught exception reached `window.onerror`
  | 'unhandled-rejection' // a promise rejected with nobody listening
  | 'render-crash' // the React error boundary caught a render throw

/** What a caller may pass. Everything is optional; everything is scrubbed. */
export interface ErrorDetails {
  /** The language or engine involved: 'java', 'python'… Unknown values become 'other'. */
  lang?: EventLang
  /** The thrown value, if there is one — its message and stack are read from it. */
  error?: unknown
  /** A message to use instead of (or when there is no) `error`. */
  message?: string
  /** `file:line[:col]` or a URL of where it happened, if the caller knows better than the stack. */
  source?: string
  /** A short closed-ish tag for where in the caller it happened, e.g. 'worker-onerror', 'boot'. */
  phase?: string
}

/** The payload as it reaches Umami. Every string is already scrubbed and capped. */
interface ErrorPayload {
  kind: ErrorKind
  lang: string
  message: string
  source: string
  stack: string
  phase: string
  build: string
}

/** Umami stores event-data strings in a varchar(500); stay well inside it. */
const MESSAGE_MAX = 300
const STACK_FRAMES = 4
/** Per tab (sessionStorage), across reloads — a crash-reload-crash loop is still one student. */
const MAX_REPORTS = 10
const REPORTS_KEY = 'warsha.errorReports.v1'

const KNOWN_LANGS = new Set([
  'java', 'python', 'csharp', 'c', 'cpp', 'typescript', 'javascript', 'html', 'css', 'web', 'mixed',
])

/**
 * The build that is running: the content hash Vite put in this chunk's own file
 * name (`/assets/index-AbC123xy.js` → `AbC123xy`). Changes on every deploy that
 * changes code, needs no build-time plumbing, and is 'dev' under `vite dev`.
 */
const BUILD: string = (() => {
  try {
    const m = /-([A-Za-z0-9_-]{6,})\.js$/.exec(new URL(import.meta.url).pathname)
    return m ? m[1] : 'dev'
  } catch {
    return 'unknown'
  }
})()

const sent = new Set<string>()

function sessionCount(delta: number): number {
  try {
    const n = Number(sessionStorage.getItem(REPORTS_KEY)) || 0
    if (delta) sessionStorage.setItem(REPORTS_KEY, String(n + delta))
    return n + delta
  } catch {
    // Storage blocked: fall back to the in-memory count for this page.
    return sent.size
  }
}

/** `https://warsha.sb.sa/assets/index-x.js?v=1#a` → `index-x.js`. Our origin only; anything else → 'external'. */
function scrubUrl(url: string): string {
  try {
    const u = new URL(url, location.href)
    const name = u.pathname.split('/').filter(Boolean).pop() ?? '/'
    if (u.origin === location.origin || u.protocol === 'blob:') return name
    if (/^https:\/\/(cjrtnc\.leaningtech\.com|cdn\.jsdelivr\.net)$/.test(u.origin)) return `${u.hostname}/${name}`
    return 'external'
  } catch {
    return '?'
  }
}

function scrubMessage(raw: string): string {
  return raw
    .replace(/\b(?:https?|blob|file|chrome-extension|moz-extension):\/\/\S+/g, (u) => scrubUrl(u.replace(/[)\]'",.]+$/, '')))
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    // Paths ("/project/src/Main.java", "C:\\x\\y") and student-ish source file names.
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/:'"()]+){2,}/g, '<path>')
    .replace(/\b[\w$-]+\.(?:java|py|cs|c|h|cpp|hpp|ts|tsx|jsx|html?|css|txt|json|md|csv)\b/g, '<file>')
    // A long quoted run is more likely a student's string than an identifier.
    .replace(/(['"`])[^'"`]{40,}\1/g, '$1…$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MESSAGE_MAX)
}

/** Top frames of a V8 / JSC / SpiderMonkey stack, as `file.js:line:col` only. */
function scrubStack(stack: string | undefined): string {
  if (!stack) return ''
  const frames: string[] = []
  for (const line of stack.split('\n')) {
    const m = /((?:https?|blob):\/\/[^\s)]+?|\/[^\s)]+?):(\d+)(?::(\d+))?\)?\s*$/.exec(line)
    if (!m) continue
    frames.push(`${scrubUrl(m[1])}:${m[2]}${m[3] ? `:${m[3]}` : ''}`)
    if (frames.length >= STACK_FRAMES) break
  }
  return frames.join(' < ')
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value) return String((value as { message: unknown }).message)
  try {
    return value === undefined ? '' : `non-error: ${typeof value}`
  } catch {
    return ''
  }
}

/**
 * Report one unexpected error to Umami as an `error` event. Never throws, never
 * blocks. Safe to call from anywhere, including inside an error handler; repeats
 * of the same error and anything past MAX_REPORTS in this tab are dropped.
 *
 *   reportError('runtime-crash', { lang: 'java', error: e, phase: 'worker-onerror' })
 */
export function reportError(kind: ErrorKind, details: ErrorDetails = {}): void {
  try {
    const err = details.error
    const stackText = err instanceof Error ? err.stack : undefined
    const message = scrubMessage(details.message ?? messageOf(err)) || '(no message)'
    const stack = scrubStack(stackText)
    const source = details.source
      ? scrubStack(`at ${details.source}`) || scrubMessage(details.source).slice(0, 80)
      : stack.split(' < ')[0] ?? ''
    const lang = details.lang && KNOWN_LANGS.has(details.lang) ? details.lang : details.lang ? 'other' : 'unknown'
    const phase = (details.phase ?? '').replace(/[^\w.-]/g, '').slice(0, 40)

    const key = `${kind}|${lang}|${message}|${source}`
    if (sent.has(key)) return
    if (sessionCount(0) >= MAX_REPORTS) return
    sent.add(key)
    sessionCount(1)

    track('error', { kind, lang, message, source, stack, phase, build: BUILD })
  } catch {
    /* Reporting an error must never become one. */
  }
}

let globalsInstalled = false

/**
 * Report uncaught errors and unhandled rejections from the main window. Call once
 * at startup. Ignores what we cannot act on: cross-origin "Script error." (the
 * browser has already hidden everything), extension scripts, and the benign
 * ResizeObserver loop notice.
 */
export function installGlobalErrorReporting(): void {
  if (globalsInstalled || typeof window === 'undefined') return
  globalsInstalled = true
  window.addEventListener('error', (e) => {
    // Resource load failures (an <img> 404) arrive here too, with no message.
    if (!(e instanceof ErrorEvent) || !e.message) return
    if (e.message === 'Script error.' || /ResizeObserver loop/.test(e.message)) return
    if (e.filename && scrubUrl(e.filename) === 'external') return
    reportError('window-error', {
      error: e.error,
      message: e.error instanceof Error ? undefined : e.message,
      source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportError('unhandled-rejection', { error: e.reason })
  })
}
