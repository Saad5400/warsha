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
  if (entryPath.endsWith('.java')) return 'java'
  if (entryPath.endsWith('.py')) return 'python'
  if (entryPath.endsWith('.cs')) return 'csharp'
  if (entryPath.endsWith('.c')) return 'c'
  if (/\.(m?tsx?|cts|mts)$/i.test(entryPath)) return 'typescript'
  if (/\.(m?jsx?|cjs)$/i.test(entryPath)) return 'javascript'
  if (/\.html?$/i.test(entryPath)) return 'html'
  if (/\.css$/i.test(entryPath)) return 'css'
  return 'other'
}
