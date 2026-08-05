/**
 * The keybinding vocabulary: one spelling for a shortcut, parsed once, matched
 * and displayed everywhere from the same string.
 *
 * A binding is written the way VS Code writes it — `"Mod+S"`, `"Shift+Alt+F"`,
 * `"F5"`, or a two-chord sequence separated by a space, `"Mod+K Mod+O"`. `Mod`
 * is the platform primary: ⌘ on Apple hardware, Ctrl everywhere else. `Ctrl`
 * spelled out means the literal Control key on BOTH platforms — VS Code keeps
 * a handful of those on the Mac too (⌃G for Go to Line, ⌃` for the panel),
 * and so do we.
 *
 * App.tsx owns the ONE window keydown listener and the command registry; this
 * file owns nothing stateful. `matchEvent` compares a single chord against a
 * KeyboardEvent, `chords` splits a sequence, and `formatKeys` renders the
 * platform label every hint in the app now goes through — a tooltip that names
 * the wrong modifier is worse than none (spec §5.3, the reason ui/shortcut.ts
 * existed), so no call site writes "Ctrl" or "⌘" by hand any more.
 */

/** One command: what the palette lists, what the keydown dispatches. */
export interface Command {
  id: string
  /** The palette row — VS Code's wording where one exists. */
  title: string
  /** Bindings: single chords or two-chord sequences ("Mod+K Mod+O"). */
  keys?: string[]
  /**
   * Mirrors real state, never a permanent stub: a command that answers false is
   * skipped by the keydown (the browser keeps the key — Ctrl+W with no file
   * open must still close the page) and left out of the palette.
   */
  enabled?(): boolean
  /** Palette visibility (default true) — false for aliases like Mod+Enter. */
  inPalette?: boolean
  /**
   * Skip the BINDING while focus is in an input/textarea/select (the palette
   * row is unaffected) — Ctrl+B in a dialog's text field belongs to the field,
   * not the sidebar. The editor is not "typing" for this purpose: VS Code
   * toggles the sidebar from the editor, and so do we.
   */
  skipWhenTyping?: boolean
  run(): void
}

/** iPadOS 13+ reports a Mac UA; both want the Command glyph either way. */
export const isMacLike: boolean =
  typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)

interface Chord {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  mod: boolean
  key: string
}

/** "Mod+K Mod+O" → ["Mod+K", "Mod+O"]. A single chord comes back alone. */
export function chords(spec: string): string[] {
  return spec.split(' ').filter(Boolean)
}

function parseChord(spec: string): Chord {
  const parts = spec.split('+')
  const key = parts[parts.length - 1]
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase())
  return {
    ctrl: mods.includes('ctrl'),
    meta: mods.includes('meta') || mods.includes('cmd'),
    alt: mods.includes('alt'),
    shift: mods.includes('shift'),
    mod: mods.includes('mod'),
    key: key.length === 1 ? key.toLowerCase() : key,
  }
}

/**
 * The event's key, normalised to the chord vocabulary. Backquote goes by
 * physical position (`e.code`) because that is how VS Code binds it — on
 * layouts where the glyph moves, the key under Esc still opens the panel.
 */
function eventKey(e: KeyboardEvent): string {
  if (e.code === 'Backquote') return '`'
  return e.key.length === 1 ? e.key.toLowerCase() : e.key
}

/** True while the keydown is a modifier alone — a chord in progress, not a key. */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return e.key === 'Control' || e.key === 'Meta' || e.key === 'Alt' || e.key === 'Shift'
}

/**
 * Does this KeyboardEvent land exactly on this single chord? Exact means
 * exact: `Mod+S` does not match Ctrl+Shift+S, and `Mod` requires the OTHER
 * primary to be up — ⌘S on a Mac, never Ctrl+S pretending.
 */
export function matchEvent(e: KeyboardEvent, chordSpec: string): boolean {
  const c = parseChord(chordSpec)
  const wantCtrl = c.ctrl || (c.mod && !isMacLike)
  const wantMeta = c.meta || (c.mod && isMacLike)
  return (
    e.ctrlKey === wantCtrl &&
    e.metaKey === wantMeta &&
    e.altKey === c.alt &&
    e.shiftKey === c.shift &&
    eventKey(e) === c.key
  )
}

/* Display names. Enter renders as ↵ on both platforms — that keeps the Run
 * hint byte-identical to what ui/shortcut.ts always produced ("⌘↵" /
 * "Ctrl+↵"), which the console's idle line quotes and QA reads. */
const MAC_KEY: Record<string, string> = {
  Enter: '↵',
  Escape: '⎋',
  PageUp: '⇞',
  PageDown: '⇟',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}
const PC_KEY: Record<string, string> = { Enter: '↵', Escape: 'Esc' }

function formatChord(spec: string): string {
  const c = parseChord(spec)
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key
  if (isMacLike) {
    // Apple's modifier order (⌃⌥⇧⌘), glyphs run together — "⇧⌘P", "⌃G".
    return (
      (c.ctrl ? '⌃' : '') +
      (c.alt ? '⌥' : '') +
      (c.shift ? '⇧' : '') +
      (c.mod || c.meta ? '⌘' : '') +
      (MAC_KEY[c.key] ?? key)
    )
  }
  const parts: string[] = []
  if (c.ctrl || c.mod) parts.push('Ctrl')
  if (c.shift) parts.push('Shift')
  if (c.alt) parts.push('Alt')
  parts.push(PC_KEY[c.key] ?? key)
  return parts.join('+')
}

/** The platform label for a binding — chords joined by a space, VS Code's way. */
export function formatKeys(spec: string): string {
  return chords(spec).map(formatChord).join(' ')
}
