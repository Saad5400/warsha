# Warsha — Design Spec v1

**Scope.** A polish pass on the shell being built today (Vite + TS, CodeMirror 6, explorer / tabs / editor / console / Run-Stop, drawer under 900px). Everything here is CSS-level and implementable against that structure. Nothing here asks for a rebuild.

**Target device is the constraint.** The student's *only* device is a phone or an iPad, in Chrome. Two facts drive most decisions below:

1. **On iPadOS, "Chrome" is WebKit.** Apple still effectively blocks alternative engines, including in the EU (no browser has shipped one). So iPad behaviour = Safari behaviour, and we get `ui-monospace` there but not on Android.
2. **The on-screen keyboard is the whole design problem.** It eats 40-55% of the viewport exactly when the student needs the console most, and it behaves *differently* on the two platforms (§4).

Companion files: [`tokens.css`](./tokens.css) (copy-paste ready), [`logo.svg`](./logo.svg), [`logo-lockup.svg`](./logo-lockup.svg), [`REVIEW-CHECKLIST.md`](./REVIEW-CHECKLIST.md).

---

## 1. Design principles

1. **Calm dark, not black.** Surfaces sit in a narrow near-neutral range. Cheap contrast tricks (pure black, pure white, saturated fills) look harsh on a phone held 30cm from the face for two hours.
2. **State never rides on a background alone.** Our surface steps are only **1.07:1 - 1.66:1** apart (measured, §2.1). That is invisible on a phone in daylight. Every state that *matters* — active tab, selected file, focused input, error line — must additionally carry a ≥3:1 mark: an accent rule, a border, a weight change, or a glyph.
3. **The amber rule is the brand signature.** The same 2px amber bar appears in the logo, under the active tab, and at the left of a running process. One motif, used consistently, is what makes a minimal UI feel designed.
4. **Thumbs before pixels.** Anything a student taps more than once a minute (Run, tabs, file rows, console input) is ≥44px and lives in the lower half of the screen. Chrome that is tapped rarely (menus, settings) may live at the top.
5. **Never look broken.** Any wait over ~400ms shows a changing token — bytes, percent, or a phase name. A 40MB Java download with a static spinner reads as "frozen" and the student closes the tab.

---

## 2. Color tokens

Dark theme is the only theme in v1. All ratios below are computed (WCAG 2.x relative luminance), not estimated. "AA" = ≥4.5:1 for body text; graphical objects and control boundaries need ≥3:1 (WCAG 1.4.11).

### 2.1 Surfaces

| Token | Hex | Use |
|---|---|---|
| `--surface-0` | `#15171C` | App frame, top bar, gaps, behind drawers |
| `--surface-1` | `#1A1D23` | **Editor canvas** — the reading surface, darkest content plane |
| `--surface-2` | `#1F232A` | Panels: explorer, console, tab strip |
| `--surface-3` | `#262B33` | Raised: menus, dialogs, cards, hover fill |
| `--surface-4` | `#2F3540` | Inputs, pressed states, progress track |

Measured separation between adjacent surfaces: `1.07:1` (1↔2), `1.11:1` (2↔3), `1.37:1` (1↔4). **This is deliberate and it is why principle 2 exists.** Do not try to fix a weak state by nudging a surface — add a rule or a border instead.

### 2.2 Text

| Token | Hex | on `--surface-1` | on `--surface-2` | Use |
|---|---|---|---|---|
| `--text-1` | `#E8EBF0` | **14.13** | **13.19** | Code, stdout, dialog titles, active tab label |
| `--text-2` | `#AEB6C4` | **8.27** | **7.72** | File rows, inactive tab labels, button labels |
| `--text-3` | `#8B94A3` | **5.52** | **5.15** | Hints, breadcrumbs, meta console lines, timestamps |
| `--text-disabled` | `#7A8290` | 4.07 | 3.18 (on `-4`) | **Disabled controls only** — WCAG-exempt; never for real content |

Lowest AA-passing text colour is `--text-3`. There is no fourth grey for content; if a label needs to be quieter than `--text-3`, it needs to be deleted.

### 2.3 Accent (brand + interactive)

One accent, warm amber — the workshop/forge note, and it harmonises with One Dark's own yellows (`#E5C07B`) and oranges (`#D19A66`) rather than fighting them.

| Token | Hex | Contrast | Use |
|---|---|---|---|
| `--accent` | `#F2A94B` | **8.48** on `-1`, **7.92** on `-2`, **7.15** on `-3` | Active-tab rule, focus ring, links, caret, logo, primary fill |
| `--accent-hover` | `#DE9639` | 7.28 with `--accent-ink` | Primary button hover |
| `--accent-press` | `#C9832F` | 5.78 with `--accent-ink` | Primary button active |
| `--accent-ink` | `#15171C` | **9.01** on `--accent` | Text/icon **on** an accent fill |
| `--accent-soft` | `#33291A` | — | Tinted fill behind accent text (badges) |

**Never put white text on `--accent`** — that is `1.99:1`. Amber fills always take `--accent-ink`.

### 2.4 Semantic

| Token | Hex | on `--surface-2` | Use |
|---|---|---|---|
| `--success` | `#6BD68F` | **8.74** | Exit code 0, "Ready", download complete |
| `--danger` | `#FF8A8F` | **6.97** | **stderr text**, failed exit, delete labels |
| `--danger-fill` | `#A32126` | 7.49 with white | The only red *fill* (destructive confirm button) |
| `--danger-soft` | `#3A2226` | 6.46 with `--danger` | Stop button fill, failed pill, stderr line tint |
| `--warn` | `#E5B95C` | **8.58** | Large-download notice, storage pressure |
| `--info` | `#7FC4F5` | **8.35** | stdin echo, informational console lines |

`--danger` is a *light* red on purpose: stderr is body text at 14px and must clear 4.5:1, which a "proper" red (`#E5484D` = 4.03:1) does not. Deep red is reserved for `--danger-fill`, where white sits on top.

Red/green are the two colours colour-blind students are most likely to confuse, and they carry our two most important messages (failed vs finished). Both are therefore **always** paired with a glyph and a word — never colour alone. See §7.3.

### 2.5 Borders, rules, overlays

| Token | Hex / value | Notes |
|---|---|---|
| `--border-subtle` | `#2A2F38` | Panel dividers, 1px. Decorative — no contrast requirement. |
| `--border-control` | `#6B7789` | **Input and control boundaries.** 3.72:1 on `-1`, 3.47:1 on `-2`, 3.13:1 on `-3` — clears WCAG 1.4.11 everywhere we use it. |
| `--focus-ring` | `var(--accent)` | 2px outline + 2px offset. 7.15:1 on `--surface-3`. |
| `--scrim` | `rgba(8, 9, 12, 0.62)` | Behind drawers, dialogs, popup menus |
| `--shadow-raised` | `0 8px 24px -6px rgba(0,0,0,0.6)` | Menus, dialogs, open drawer |

### 2.6 Editor chrome (CodeMirror 6)

Keep One Dark's `HighlightStyle` — the syntax colours are good and re-picking them is wasted work. Override only the **chrome**, so the editor sits inside our surface ramp instead of One Dark's `#282c34`. That is one small `EditorView.theme({...})` on top of `oneDark`.

| Token | Hex | Maps to | Contrast |
|---|---|---|---|
| `--code-bg` | `var(--surface-1)` | `.cm-editor`, `.cm-scroller` | — |
| `--code-gutter-bg` | `var(--surface-1)` | `.cm-gutters` — flat, no separate gutter fill | — |
| `--code-gutter-fg` | `#868E9D` | `.cm-lineNumbers .cm-gutterElement` | **5.12** on `--code-bg` |
| `--code-gutter-fg-active` | `var(--text-2)` | `.cm-activeLineGutter` | 8.27 |
| `--code-active-line` | `#22262E` | `.cm-activeLine` | text-1 on it: **12.69** |
| `--code-selection` | `#384252` | `.cm-selectionBackground` | text-1 on it: **8.49** |
| `--code-search-match` | `#4A3A1E` | `.cm-searchMatch` | text-1 on it: **9.18** |
| `--code-search-match-active` | `var(--accent)` + `--accent-ink` | `.cm-searchMatch-selected` | 9.01 |
| `--code-caret` | `var(--accent)` | `.cm-cursor` | 8.48 — and 2px wide, see §3.4 |
| `--code-bracket` | `#4A5364` + 1px `--border-control` | `.cm-matchingBracket` | boundary 3.72 |
| `--code-indent-guide` | `#272C34` | indent markers, if enabled | decorative |

Gutter is **flat** (same fill as the canvas, no border) — a filled gutter costs horizontal pixels of perceived width on a 390px phone.

---

## 3. Type

### 3.1 Font stacks — what is actually on these devices

```css
--font-ui:
  system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
  "Noto Sans Arabic", Arial, sans-serif;

--font-code:
  ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas,
  "Droid Sans Mono", "Roboto Mono", "Liberation Mono", "Courier New", monospace;
```

**No webfont ships in v1.** A 40MB runtime download is already the budget; adding 80KB of Berkeley Mono to it is indefensible, and the system stacks are good on both targets.

What each stack actually resolves to, verified:

- `system-ui` — supported Chrome 56+ and Safari 11+. **San Francisco** on iPadOS, **Roboto** on Android. Both are excellent UI faces; nothing to add.
- `ui-monospace` — **Safari 13.1+ / iOS 13.4+ only. Chromium ignores it entirely** (all versions to date; it is a 2026 Interop focus area but not shipped in Blink). So: on iPad it resolves to **SF Mono** and we get the good font for free. On Android Chrome the keyword is skipped and we fall through.
- On **Android**, the generic `monospace` resolves to **Droid Sans Mono**. `"Roboto Mono"` is listed ahead of it optimistically — it is present on many devices but is *not* guaranteed addressable by name across OEM skins, so it must never be load-bearing.
- `"Noto Sans Arabic"` is in the UI stack against a future Arabic UI (§12); both platforms ship Arabic system fonts, so this is a hint, not a dependency, and it costs nothing while the interface is English-only.

**Two mandatory guards:**

```css
/* WebKit renders an unqualified `monospace` at ~81.25% of the inherited size.
   Always give code an explicit px size — never an em/inherited size. */
.cm-content, .console-line, code { font-size: 15px; }

html { -webkit-text-size-adjust: 100%; }  /* stop iOS reflowing our type on rotate */
```

Android's default mono is also reported to be inconsistently advanced on some OEM builds. Therefore: **never rely on character-cell alignment for layout.** No ASCII-art column guides, no space-padded table output in our own chrome, no `ch`-based widths for anything the user must be able to read. (User code that prints columns is the user's business.)

### 3.2 Scale

| Role | Size / line-height | Weight | Colour |
|---|---|---|---|
| Editor code | **15px** / 1.6 (24px) | 400 | One Dark tokens |
| Editor code (user-settable) | 13 / 15 / 17px | — | persist via `fs/prefs.ts` |
| Line numbers | 13px / 24px (must match code leading) | 400 | `--code-gutter-fg` |
| Console output | **14px** / 1.5 (21px) | 400, mono | §7.3 |
| **Console input** | **16px** / 1.4, mono | 400 | `--text-1` |
| Tab label | 13px / 1.2 | 500 inactive, 600 active | `--text-2` / `--text-1` |
| Explorer row | 14px / 1.2 | 400, 500 when open | `--text-2` |
| Button label | 15px / 1.2 | 600 | per variant |
| Top-bar title | 13px / 1.2, `letter-spacing: .01em` | 500 | `--text-3` |
| Status pill / badge | 12px / 1, `letter-spacing: .02em` | 600 | per state |
| Dialog title (`.dlg-title`) | 17px / 1.3 | 600 | `--text-1` |
| Dialog body (`.dlg-msg`) | 15px / 1.5 | 400 | `--text-2` |
| Section label (explorer header) | 12px / 1, uppercase, `.06em` | 600 | `--text-3` |
| Empty-state body | 14px / 1.55 | 400 | `--text-3` |

**16px is a hard floor on every focusable input** (`.dlg-input`, console input, rename field). Below 16px, iOS Safari auto-zooms the page on focus and the student is left pinching their way back. The check is on the *computed* size after transforms, so never put a 16px input inside a `scale()`.

**12px is the floor for anything else.** Nothing smaller ships.

### 3.3 Editor leading

`line-height: 1.6` on code (24px at 15px) rather than the desktop-typical 1.4. Two reasons: touch caret placement between lines gets materially easier at 24px rows, and 15px/1.6 is comfortable at phone reading distance. Line-number leading must match exactly or the gutter drifts.

### 3.4 Caret and selection on touch

- Caret: `--code-caret`, **2px** wide (`.cm-cursor { border-left-width: 2px }`). The 1px default is genuinely hard to find on a 3x phone display.
- iOS text-selection handles are large; give `.cm-content` at least `padding-left: 4px` so the leading handle is not clipped at the gutter edge.
- **`.cm-content` must carry these attributes** (via `EditorView.contentAttributes`) or iPadOS will actively corrupt code — it capitalises the first word of every line and converts `"` to `"`:

```ts
EditorView.contentAttributes.of({
  autocapitalize: 'none',
  autocorrect: 'off',
  spellcheck: 'false',
  'data-gramm': 'false',
})
```

Smart punctuation is a system keyboard setting we cannot fully disable from the page; `autocorrect="off"` suppresses it in WebKit in practice. This is on the review checklist because it is the single most likely way the iPad experience silently breaks.

---

## 4. The keyboard problem

This is the section to read twice. The behaviour differs per platform in a way that will burn an afternoon if discovered late.

### 4.1 What actually happens

| | Chrome on Android | Chrome on iPadOS (= WebKit) |
|---|---|---|
| Layout viewport when keyboard opens | Unchanged by default (`resizes-visual` since Chrome 108) | **Unchanged** |
| `100vh` | Not reduced | Not reduced |
| `100dvh` | **Shrinks** to the area above the keyboard | **Does not shrink** — tracks the layout viewport |
| `window.resize` fires | Yes | **No** |
| `visualViewport.resize` fires | Yes | Yes |
| `visualViewport.height` reduced | Yes | Yes |
| `interactive-widget=resizes-content` | **Supported (Chrome 108+)** | Not supported |
| `env(keyboard-inset-height)` | Supported (Chromium 94+) | **Not supported** |

So `100dvh` alone gives a correct layout on Android and a **broken** one on iPad — the console input row sits underneath the keyboard, invisible, while the student types blind. `visualViewport` is the only mechanism that works on both.

### 4.2 What the frontend should do

**Viewport meta:**

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover,
               interactive-widget=resizes-content">
```

`resizes-content` makes Android reflow the layout above the keyboard for free. `viewport-fit=cover` is needed for `env(safe-area-inset-*)`. **Do not add `user-scalable=no` or `maximum-scale=1`** — it fails WCAG 1.4.4 and blocks a student from pinching in on a stack trace. Kill double-tap zoom per-element with `touch-action: manipulation` on buttons and rows instead, never globally on the editor.

**Shell geometry.** The app shell is `position: fixed; inset: 0` and sized from a JS-maintained variable, so iOS cannot scroll the whole document out from under a focused input:

```css
html, body { height: 100%; overflow: hidden; overscroll-behavior: none; }
#app {
  position: fixed; inset: 0;
  height: var(--app-h, 100dvh);          /* dvh is the pre-JS fallback */
  padding-bottom: env(safe-area-inset-bottom);
  display: grid;
}
.scroller { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
```

**The 30 lines that make it work** (suggested `app/src/ui/viewport.ts`):

```ts
const root = document.documentElement
let pending = 0

function sync() {
  pending = 0
  const vv = window.visualViewport
  if (!vv) return
  // Android (resizes-content): innerHeight already shrank, so kb ≈ 0.
  // iPad: innerHeight is unchanged, so this yields the true keyboard height.
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
  root.style.setProperty('--app-h', `${Math.round(vv.height)}px`)
  root.style.setProperty('--kb-inset', `${kb}px`)
  root.dataset.kb = kb > 100 ? 'open' : 'closed'
}

const schedule = () => { if (!pending) pending = requestAnimationFrame(sync) }

const vv = window.visualViewport
vv?.addEventListener('resize', schedule)
vv?.addEventListener('scroll', schedule)
window.addEventListener('orientationchange', () => setTimeout(sync, 250))
// iOS can leave visualViewport.offsetTop non-zero after the keyboard closes
// (regression reported through iOS 26), which pushes fixed chrome off-screen.
// Re-sync after blur settles, and clamp scroll back to the top.
window.addEventListener('focusout', () => {
  setTimeout(() => { window.scrollTo(0, 0); sync() }, 300)
})
sync()
```

One formula covers both platforms: on Android `--app-h` shrinks and `--kb-inset` stays 0; on iPad `--app-h` stays tall and `--kb-inset` carries the keyboard. Layout consumes both.

Threshold is `> 100px` rather than a smaller number so an attached Magic Keyboard (which shows no software keyboard) and the iPad shortcut bar alone don't trigger the compact layout.

### 4.3 Keyboard-open layout (`html[data-kb="open"]`)

When the keyboard is up, the student is doing exactly one of two things: typing code, or answering an `input()` prompt. Layout resolves in favour of whichever has focus.

Rules, in order:

1. **The console input row is always visible.** It is `position: sticky; bottom: 0` inside the console, and the console panel gets `margin-bottom: var(--kb-inset)`. Nothing may ever cover it.
2. **Close the explorer drawer** on `data-kb="open"` below 900px. It is never the thing being typed into.
3. **Collapse decoration, not content**: hide the console header's "Clear" label (icon only), drop the top bar to 40px, remove panel padding from 12px to 8px. Recovers ~40px of vertical space with no loss of function.
4. **Console floor when stdin is pending:** the console keeps `min-height: calc(4 * 21px + 44px + 16px)` ≈ **144px** — three or four output lines plus the input row. A student answering `What is your name?` must be able to *see the question* while typing the answer. This is the single most important number in this section.
5. **Editor floor: 96px.** Below that, don't shrink further — let the editor scroll under the console instead.
6. **Run/Stop rides up with the keyboard** (§5.3), it does not get covered and it does not get hidden.

### 4.4 stdin focus choreography

`RunIO.onStdinRequest()` already exists to tell the console to focus its input. Order matters:

1. Flush any pending stdout **first**, so the prompt text is on screen before the keyboard animates.
2. Focus the input. The keyboard opens; `visualViewport.resize` fires.
3. Scroll the console to the bottom **after** the resize settles — not before. Scrolling first then resizing leaves the last line hidden behind the keyboard. Wait for one `visualViewport.resize` (or two `requestAnimationFrame`s if none arrives, e.g. hardware keyboard).
4. Show the stdin hint (§8) above the input row, not as a toast.

A program that prints `print("Your name: ")` with no newline expects the answer on the same visual line. Echo the typed answer into the transcript on Enter, styled `--info`, so the console reads like a real terminal session afterwards.

---

## 5. Spacing, touch, reach

### 5.1 Scale

4px base, 8px rhythm. `--sp-1: 4px`, `--sp-2: 8px`, `--sp-3: 12px`, `--sp-4: 16px`, `--sp-5: 24px`, `--sp-6: 32px`.
Radii: `--r-sm: 6px` (badges, inputs), `--r-md: 10px` (buttons, menu items), `--r-lg: 14px` (dialogs, cards), `--r-pill: 999px` (status pills).
Panel padding 12px on phones, 16px at ≥900px. Modest radii throughout — VSCode is sharp-cornered, but touch UI reads as friendlier with ~10px, and this is a tool for people who are nervous about tools.

### 5.2 Hit targets

- **44px minimum** on every interactive element (Apple HIG 44pt; WCAG 2.5.5 AAA also 44px). WCAG 2.2 AA only demands 24px — we are deliberately well past it, because the users are on phones.
- **48px** for Run/Stop and for primary dialog buttons.
- **≥8px** clear space between adjacent targets. Two 44px buttons flush against each other still produce mis-taps.
- Icon-only buttons: 44×44 box, **20px** glyph, centred. The glyph is not the target; the box is.
- Explorer rows and tabs: **44px** tall — this is why row height is not negotiable down to a "tighter, more VSCode" 22px.
- **Destructive actions are never adjacent to frequent ones.** In the long-press menu (`showMenu`), Delete is last, separated by an 8px gap and a `--border-subtle` divider, and styled with the existing `.menu-item.danger` class.
- Replace the tap highlight rather than just removing it: `-webkit-tap-highlight-color: transparent` **plus** a real `:active` state (`--surface-3` fill, or `transform: scale(.97)` on buttons). Removing the highlight with nothing in its place makes every tap feel unresponsive.

### 5.3 Where Run/Stop lives

**Not the top-right.** VSCode puts it there; on a tablet held in two hands that is the least reachable corner on the screen, and on a phone it demands a grip shift.

**Run/Stop lives in the console header row, at the trailing edge, pinned above the keyboard.** The console header is already a persistent horizontal strip at the bottom of the layout, so the button is:

- in the bottom third — thumb territory in both portrait and landscape;
- part of the layout, so it can never overlap code or output the way a floating action button does;
- automatically lifted by `--kb-inset` along with the console.

**Handedness.** A single attribute on the root flips the console header, mirroring Run/Stop to the leading edge for a left-handed student:

```css
.console-header { display: flex; align-items: center; gap: var(--sp-2); }
html[data-hand="left"] .console-header { flex-direction: row-reverse; }
```

Default `right`. Expose it as one switch in the overflow menu ("Run button on left"), persisted through `fs/prefs.ts`. This is ~6 lines and it is the difference between comfortable and awkward for roughly one student in ten.

**One button, not two.** It is a single control that swaps role: `Run` (amber fill, play glyph) → `Stop` (soft-danger fill, square glyph). On a 390px-wide phone, two persistent buttons cost width we need for the status pill, and a disabled-Stop-next-to-enabled-Run is a worse affordance than one live button. Guard the swap with a **250ms** ignore-taps window after the state change so a fast double-tap on Run cannot immediately kill the process it just started.

Also bind **Cmd/Ctrl + Enter** to Run/Stop. iPads with Magic Keyboards are common in the target audience and the shortcut costs one line.

### 5.4 Safe areas

`viewport-fit=cover` means content can reach under the home indicator and the notch. Apply `env(safe-area-inset-bottom)` to the shell's bottom padding and `env(safe-area-inset-left/right)` to the top bar and console header in landscape. A Run button whose lower 12px sit under the home indicator is a Run button that swipes the student out of the app.

---

## 6. Layout

```
≥900px                                    <900px (drawer)
┌──────────────────────────────────┐      ┌──────────────────────────┐
│ top bar 44                       │      │ ☰  logo  name        ⋯   │ 44
├────────┬─────────────────────────┤      ├──────────────────────────┤
│        │ tabs 44                 │      │ tabs 44 (h-scroll)       │
│ explr  ├─────────────────────────┤      ├──────────────────────────┤
│ 240    │ editor (flex)           │      │ editor (flex, min 96)    │
│        ├─────────────────────────┤      ├──────────────────────────┤
│        │ console header 44       │      │ console header 44   [Run]│
│        │ console body (resizable)│      │ console body             │
│        │ stdin row 44 (sticky)   │      │ stdin row 44 (sticky)    │
└────────┴─────────────────────────┘      └──────────────────────────┘
                                           explorer = left drawer 280
                                           + scrim, swipe/tap to close
```

- Explorer drawer: 280px wide, slides from the leading edge over `--scrim`, `--shadow-raised`. Closes on scrim tap, on file open, on Escape, and on `data-kb="open"`.
- Console body is drag-resizable at ≥900px (grab handle on the divider, 44px tall hit area even though it renders as 1px). On phones it has two states — collapsed (header only) and open (40% of `--app-h`) — toggled by tapping the header. Dragging a divider with a thumb on a 390px screen is not worth building.
- Console **auto-opens** on Run and on first stderr output. A student who taps Run and sees nothing change assumes it failed.

---

## 7. Components

Class names below match what already exists in `app/src/ui/dialogs.ts` (`.menu`, `.menu-item`, `.dlg`, `.btn`, `.toast`) — extend those, don't parallel-invent.

### 7.1 Explorer row

- 44px tall, `padding-inline: var(--sp-3)`, 8px gap between icon and label, full-bleed press area.
- 20px file-type glyph. Java and Python get a tinted 2-letter badge instead of a generic file icon: Java `--warn` on `#33291A` (7.76:1), Python `--info` on `#1B2A38` (7.75:1). Faster to scan than colour-only icons and it survives greyscale.
- Label `--text-2` 14px; truncate with `text-overflow: ellipsis` **from the end**, never wrap. Long names (`StudentEnrollmentController.java`) are the norm in Java projects, so also set `title` for hover and keep the extension visible where feasible.
- **Open file:** `--text-1` label, weight 500, plus a **2px `--accent` rule on the leading edge**. Background stays `--surface-2`. (The 1.11:1 fill change alone is invisible — principle 2.)
- **Modified:** a 6px `--accent` dot at the trailing edge, plus the filename is *not* italicised (italic monospace-adjacent labels hurt legibility at 14px).
- Nesting indent 16px per level with a 1px `--code-indent-guide` rule. Directory rows get a rotating chevron (`transform: rotate(90deg)`, 150ms).
- Long-press opens the existing `showMenu` — Rename / Duplicate / New file / New folder / — / Delete (danger).

### 7.2 Tab

- 44px tall, `padding-inline: var(--sp-3)`, `min-width: 96px`, `max-width: 60vw`, mono-adjacent label in `--font-ui` 13px.
- Strip scrolls horizontally: `overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none`. `scrollIntoView({block:'nearest', inline:'nearest'})` when a tab activates.
- **Inactive:** `--surface-2` fill, `--text-2` label, weight 500.
- **Active:** `--surface-1` fill (matches the editor canvas so the tab visually owns it) + **2px `--accent` rule along the bottom edge** + `--text-1` label at **weight 600**.
  Three simultaneous signals — accent rule (7.92:1), weight, and text colour (13.19 vs 7.72) — so the active tab is unambiguous in greyscale and in sunlight. The fill change is the *least* of the three and carries none of the load.
- Close affordance: a 44×44 tap zone with a 14px ×, `--text-3`, becoming `--text-1` on press. Only rendered on the **active** tab on phones (an × on every tab in a 390px strip is a mis-tap generator); at ≥900px show it on all tabs.
- Dirty state: the × is replaced by a 6px `--accent` dot until saved; long-press the tab for Close / Close others / Close all.

### 7.3 Console line

The console is a transcript, not a log viewer. Each line is a flex row: a 3px leading rule, then content.

| Kind | Leading rule | Text | Size | Extra |
|---|---|---|---|---|
| stdout | none (3px transparent) | `--text-1` | 14px mono | — |
| **stderr** | **3px `--danger`** | `--danger` `#FF8A8F` (6.97:1) | 14px mono | `--danger-soft` row tint at 55% |
| stdin echo | 3px `--info` | `--info` | 14px mono | prefixed `› ` |
| system / meta | none | `--text-3` (5.15:1) | 13px mono | italic allowed here |
| exit status | per state | see pills below | 13px | glyph + word |

**stderr must be distinguishable from stdout at arm's length and without colour vision.** Colour alone is not enough at 14px on a phone, so stderr carries *three* differences: hue, a 3px red leading rule, and a tinted row background. That combination survives a greyscale screenshot (the rule and tint remain), which is exactly what the review checklist tests.

Other rules:
- `white-space: pre-wrap; overflow-wrap: anywhere; tab-size: 4` — never horizontal-scroll the console. A wrapped stack trace is readable; a horizontally-scrolling one is not, on a phone.
- Wrapped continuation lines are indented 12px so wrap is visually distinct from a genuine new line.
- Auto-scroll to bottom **only if already within 40px of the bottom** — a student reading a stack trace mid-scroll must not be yanked away by late output.
- Cap at 5,000 lines, drop from the head, and say so: a `--text-3` meta line reading *"Earlier output hidden (5000-line limit)."*
- Batch DOM appends per frame. A tight `while True: print(i)` loop must not lock the main thread — this is a *design* requirement because the visible failure is "the Stop button doesn't work".
- Group the status pills:

| State | Fill | Text | Glyph | Contrast |
|---|---|---|---|---|
| Ready | `--surface-4` | `--text-2` | ○ | 6.04 |
| Running | `#16301F` | `--success` | ● animated | 7.88 |
| Finished (0) | `#16301F` | `--success` | ✓ | 7.88 |
| Failed (≠0) | `--danger-soft` | `--danger` | ✕ | 6.46 |
| Stopped by you | `#2A2F38` | `--text-2` | ■ | 6.59 |

"Stopped by you" is deliberately **neutral, not red** — the student did that on purpose and it is not an error. Reserving red for genuine failure is what makes red mean something.

### 7.4 Buttons

Extend the existing `.btn` with `.primary` / `.ghost` / `.danger`.

| Variant | Fill | Label | Border | Use |
|---|---|---|---|---|
| `.btn.primary` | `--accent` | `--accent-ink` (9.01) | none | Run, dialog confirm |
| `.btn.primary:hover` | `--accent-hover` | `--accent-ink` (7.28) | — | — |
| `.btn.primary:active` | `--accent-press` | `--accent-ink` (5.78) | — | — |
| `.btn.stop` | `--danger-soft` | `--danger` (6.46) | 1px `--danger` | Stop |
| `.btn.ghost` | transparent | `--text-2` (7.72) | 1px `--border-control` (3.47) | Cancel, Clear |
| `.btn.danger` | `--danger-fill` | `#FFFFFF` (7.49) | none | Confirm delete only |
| `.btn:disabled` | `--surface-4` | `--text-disabled` | none | `cursor: not-allowed`, no opacity trick |

Geometry: 44px tall (48px for Run/Stop and primary dialog actions), `padding-inline: var(--sp-4)`, `--r-md`, label 15px/600, `touch-action: manipulation`.
Focus: `outline: 2px solid var(--focus-ring); outline-offset: 2px` — on `:focus-visible` only, so it appears for hardware-keyboard users and never as a sticky ring after a tap.
Use `opacity` for **nothing** that conveys state; it destroys measured contrast. Disabled is a colour change, not a fade.

Run/Stop specifically: leading 20px glyph + label, `min-width: 96px` so the button doesn't resize between "Run" and "Stop" and shift its neighbours. During runtime load it becomes a disabled `Preparing…` with a 16px spinner in the glyph slot.

### 7.5 Empty states

Every empty region gets one, and every one is: 32px `--text-3` glyph, one 14px line of `--text-3` explaining what goes here, and (where there is one) a single action. Centred, `max-width: 32ch`, vertically at ~40% height rather than dead centre — dead centre sits behind the keyboard.

| Region | Line | Action |
|---|---|---|
| No file open | "Pick a file from the explorer to start editing." | `Browse files` (opens drawer) |
| Console, never run | "Output will appear here when you run your code." | — |
| Console, cleared | "Cleared." (fades after 3s to the line above) | — |
| Empty folder | "This folder is empty." | `New file` |
| No projects | → welcome screen (§7.7) | — |

### 7.6 Progress and the runtime download

**The problem.** The Java runtime is tens of MB. On school Wi-Fi that is 30-90 seconds during which nothing appears to happen. This is the highest-risk moment in the entire product: the student's conclusion is *"this website is broken"* and they leave.

**The contract:** *something numeric changes on screen at least every 2 seconds, from the first tap to the first line of output.*

Where it renders: **in the console, not in a modal.** The console auto-opens on Run, shows the progress block, and the student can still read their code while waiting. A modal blocks the app for a minute and teaches them the app is fragile. Run becomes a disabled `Preparing…`.

Progress block anatomy:

```
┌────────────────────────────────────────────────┐
│  Getting Java ready — this happens once.       │  15px --text-1, 600
│  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░  38%          │  4px bar, --r-pill
│  14.2 MB of 38 MB · about 40 seconds left      │  13px --text-3
│  Next time this is instant, even offline.      │  13px --text-3
└────────────────────────────────────────────────┘
```

- Bar: 4px tall, `--surface-4` track, `--accent` fill (6.19:1 against the track), `--r-pill`, `transition: width 200ms linear`. Never animate it backwards.
- **If total size is unknown**, show a 30%-width indeterminate sweep **plus a live byte counter**. The counter is the part that matters — an indeterminate bar alone is indistinguishable from a hang. Never show an indeterminate bar with no numbers.
- Phase names, in order, each replacing the last: `Downloading Java` → `Unpacking` → `Starting up` → `Compiling your code` → first output. Naming the phase converts dead time into visible progress.
- **Time-based escalation** (this is what prevents abandonment):
  - **8s:** append "Still going — a big first download on slow Wi-Fi can take a minute."
  - **25s:** append "You can keep editing while this finishes." Reveal a `Cancel` ghost button.
  - **60s:** offer `Try again` alongside `Cancel`, and mention that the download resumes rather than restarting (if it does).
- **Cache hit path shows none of this.** Second run goes straight to `Running` with no progress block at all. If the student sees the download UI twice, caching is broken and the UI should be the thing that tells us.
- Python (Pyodide) is smaller but not free — same component, same copy, different numbers. Don't special-case it.

**Required change to the runtime interface.** `app/src/runtime/types.ts:11` currently exposes:

```ts
load(onProgress: (msg: string) => void): Promise<void>
```

A bare string cannot render a determinate bar, a byte counter, or an ETA without the UI parsing prose — which is fragile and will break the moment a message is reworded. Widen it:

```ts
export type LoadProgress = {
  phase: 'download' | 'unpack' | 'boot' | 'compile'
  message: string          // human-readable fallback, already the current behaviour
  loaded?: number          // bytes so far
  total?: number           // bytes expected, when Content-Length is known
}
load(onProgress: (p: LoadProgress) => void): Promise<void>
```

Backwards-compatible in spirit (`message` alone still works and the UI degrades to indeterminate + counter), and it is the difference between the block above and a spinner. This is a small change to two runtime implementations and it should happen before the progress UI is built, not after.

### 7.7 Welcome screen

Shown when no project exists. Vertical stack, `max-width: 480px`, centred, 24px padding.

1. **Lockup** — 40px logomark above `Warsha` at 28px/600. Latin only: the Arabic wordmark that used to sit beneath it was removed in brand v2, and the interface ships in English throughout (§12).
2. **One line of purpose:** "Write and run Java or Python. In your browser, on your phone." `--text-2`, 15px.
3. **Two template cards**, matching the two entries in `app/src/templates.ts`.

Card spec (`.template-card`):
- Full width, stacked with a 12px gap (side-by-side only above 720px), `--surface-3` fill, **1px `--border-control` border** (3.13:1 — the border does the work, since the fill is only 1.11:1 against the page), `--r-lg`, 16px padding, min-height 88px, `--r-md` press feedback to `--surface-4`.
- Row 1: language badge (§7.1 tints) + title at 15px/600 `--text-1` — *"Java (OOP starter)"*, *"Python starter"*.
- Row 2: the existing `blurb` at 13px/1.5 `--text-2`, two lines max.
- Row 3: `--text-3` 12px file manifest — "3 files · app/Main.java" / "2 files · main.py". Sets the expectation that this is a real multi-file project, which is the point of the Java template.
- The whole card is one 88px+ target. No nested buttons.
- First card gets the `--accent` focus ring on load for hardware-keyboard users; neither card is visually "preselected" (no default choice implied).

4. Below the cards, a `.btn.ghost`: `Start from an empty folder`.
5. Footer, 12px `--text-3`: "Your files are saved in this browser on this device." — the honest statement of where the work lives, and the reason to explain export before they ask. Link `Import a .zip` (the `zip.ts` path).

**First-run explainer, on the welcome screen, before any Run:** a `--surface-2` note with a 3px `--warn` leading rule:

> **First time you run, Warsha downloads the language you picked** — about 38 MB for Java, less for Python. It happens once per device, then it works offline.

Saying this *before* the wait, not during it, converts a scary hang into an expected one.

---

## 8. Microcopy

**Tone rules.**
1. Say what happened, then what to do. Never only what went wrong.
2. Blame nothing. Not the student ("you forgot"), not the machine ("invalid input"). Prefer *"Java couldn't find…"* over *"Error: unresolved symbol"*.
3. No `Error:` prefixes, no `Invalid`, no `Failed to`, no ALL CAPS, no `!!`. Also no cheerleading — "Awesome job!! 🎉" on a successful run is condescending to someone doing coursework.
4. Second person for actions the student takes, third person for what the program does. *"You stopped it"* / *"Your program is waiting"*.
5. Under ~100 characters where possible. Name the file and line whenever we have them.
6. Never expose internals: no `WASM_ERR`, no worker names, no `SIGKILL`, no exit-code jargon without a plain-English gloss.

**The strings.**

| Key | String |
|---|---|
| `runtime.firstRun` | **Getting Java ready — this happens once (about 38 MB).** Next time it starts instantly, even offline. |
| `runtime.slow` | Still going — a big first download can take a minute on slow Wi-Fi. |
| `runtime.offline` | Couldn't download Java. Check your connection, then tap Run to try again. |
| `run.running` | Running `app/Main.java`… |
| `run.ok` | Finished. (exit code 0) |
| `run.failed` | Your program stopped early — exit code 1. The red lines above say why. |
| `run.stopped` | Stopped. Your files are all saved. |
| `stdin.hint` | Your program is waiting for something — type below and press Enter. |
| `console.empty` | Output will appear here when you run your code. |
| `compile.java` | Java couldn't compile this yet. Start with the first message — it usually points at the real problem. |
| `storage.local` | Your files are saved in this browser on this device. |

Notes on the choices: `run.ok` keeps "exit code 0" because students *should* learn what that means, but leads with "Finished." so the meaning is never gated on the jargon. `run.failed` says "stopped early", not "crashed" or "failed" — accurate, and it points at the red lines rather than leaving them to hunt. `run.stopped` volunteers that nothing was lost, because that is the actual fear when a student hits Stop. `compile.java` teaches the one habit that most helps a beginner reading javac output: read the *first* error, not the last.

---

## 9. Motion

Short, few, and skippable. `--dur-fast: 120ms` (press feedback, hover), `--dur: 180ms` (drawer, menu, dialog), `--dur-slow: 240ms` (console open/close). Easing `cubic-bezier(.2, 0, .2, 1)`.

Animate only `transform` and `opacity` (plus the progress bar's `width`). No layout-property transitions — a `height` transition on the console during a keyboard resize on iOS produces visible tearing.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
  .status-pill .dot { animation: none; }   /* running indicator becomes static */
}
```

The running indicator is the one continuous animation in the app (a 1.4s opacity pulse on a 6px dot). Under reduced motion it goes static and the pill relies on its label. Never animate the console's own content.

---

## 10. Accessibility floor

- Contrast: every content pair in §2 is ≥4.5:1; every control boundary and focus ring is ≥3:1. Ratios are stated so they can be re-checked after any colour tweak.
- Nothing is colour-only: stderr has a rule + tint, the active tab has a rule + weight, status pills have glyphs + words, file types have letter badges.
- `:focus-visible` rings everywhere; never `outline: none` without a replacement.
- Console output is a live region: `role="log" aria-live="polite"` on the transcript, `aria-atomic="false"`. Do **not** make it `assertive` — a chatty loop would flood a screen reader.
- The Run/Stop toggle updates its `aria-label` and `aria-pressed` alongside its glyph, and the state change is announced through the status pill, not through a toast.
- Explorer is a `role="tree"` with `aria-expanded` on directory rows; tabs are `role="tablist"` / `role="tab"` with `aria-selected`.
- Text zoom to 200% must not break the shell — hence `px` for chrome geometry but no `overflow: hidden` on text containers, and `max-width` in `ch` on prose.
- Respect `prefers-reduced-motion` (§9). Assume `prefers-contrast: more` will arrive later; keep the token layer as the only place colours are defined so it stays a one-file change.

---

## 11. Logo

Three files:
[`mark.svg`](./mark.svg) (the plated 64×64 source every OS icon is generated from),
[`logo.svg`](./logo.svg) (the same mark plate-less, 24×24 grid, for surfaces we control), and
[`logo-lockup.svg`](./logo-lockup.svg) (mark + Latin wordmark, for README and docs).

**The mark is a vise.** Two jaws clamp a workpiece to a bench — and the jaws are square brackets, so the same figure reads as code held open for work. *Warsha* means workshop; this is the workshop's defining object fused with what the student actually puts in it. The workpiece is `--accent`, the colour the interface already uses to mean "this one is live": the active tab's rule, the caret, the Run control.

**It replaced a "W" monogram**, and the reason generalises. A letter on a tile says nothing about what the product does, and it is the standard sign that nobody did this work. Anything proposed as a replacement has to clear the same bar this did — judged on a contact sheet at 96/64/48/32/24/16px, against a circular mask, on both background polarities. What died there, and why:

- **A play triangle over the rule** — perfectly legible at every size, and useless: it is the YouTube glyph. An icon indistinguishable from a stock one is not an icon.
- **A hammer over the rule** — collapses into a "T". Straight back to a letter.
- **An anvil** — the strongest *concept*, but the horn and waist dissolve below 32px and it becomes a bowtie.
- **A trestle bench** — reads as a picnic table, and says nothing about code.
- **Jaws and workpiece both in amber** — the channel between them closes and the whole mark is one blob at 24px. The two-tone contrast is load-bearing, not styling.

Verified by rasterising, not by assumption:

- **16px: legible.** The bracket-and-workpiece structure survives, which is the whole reason this candidate won.
- **Under a circular mask** the jaws stay inside the crop and the figure still reads.
- **Plate-less on a light background the light jaws disappear** and only the amber workpiece survives. Any light-surface use *must* override the ink: set `--logo-ink: #15171C`, or inline the SVG and swap the ink stroke to `currentColor`. Never place `logo.svg` unmodified on white.

**Two tile treatments, because the consumers differ.** `favicon.svg` and `favicon.ico` carry the mark's own rounded plate. `apple-touch-icon.png` and the PWA icons are square and full-bleed: iOS composites transparency onto black and rounds the corners itself, and Android launchers crop to a circle or squircle, so the plate must reach every edge while the glyph stays inside the central 80%. Both come out of [`tools/brand/build-brand-assets.mjs`](../../tools/brand/build-brand-assets.mjs); never hand-edit a PNG.

Usage rules: minimum clear space equal to 25% of the mark's height on all sides; never recolour the jaws to the accent or the workpiece to anything but `--accent`; never add a stroke, shadow or outline; never stretch non-uniformly; never set the wordmark in anything but the UI font at weight 600. The rounded-square plate is for OS icons only — do not put the mark on a backdrop inside the UI.

**The geometry is duplicated in three places** and nothing keeps them in sync automatically: `mark.svg` / `logo.svg`, [`app/src/components/Logo.tsx`](../../app/src/components/Logo.tsx), and the boot splash inlined in `app/index.html` (which must stay literal — it paints before any stylesheet). Change one, change all three.

In the app, build the lockup in **HTML** (`logo.svg` + a styled `<span>`), not from `logo-lockup.svg`. The wordmark then stays real text — crisp at any size, selectable, and reachable by a screen reader — rather than a traced path that has to be re-exported every time the type changes. `logo-lockup.svg` exists for README and docs, where a single self-contained file is worth more than live text.

## 12. Deferred

Explicitly out of v1, recorded so they don't get smuggled in: light theme, theme switching, font-size UI beyond the three code sizes, split editor panes, minimap (actively wrong on a phone), breadcrumbs, git anything, settings screen beyond the overflow menu, Arabic UI localisation (brand v2 removed the Arabic wordmark from the lockup, so the product is English-only end to end — RTL layout is a real project, not a polish pass).
