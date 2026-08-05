# Warsha — Theme v3 addendum (Catodemy-style black/white + glitch)

> **SUPERSEDED, 2026-08-05:** the v3 black/white/glitch values were replaced
> by the VS Code **Dark Modern** parity sweep ([`THEME-V4.md`](./THEME-V4.md))
> — and then, the same day, the founder ordered the monochrome identity BACK:
> [`THEME-V5.md`](./THEME-V5.md) restores this document's palette (surfaces,
> white accent, semantic hex) on top of v4's structure and expanded token
> vocabulary. Canonical hex lives in [`tokens.css`](./tokens.css); v5 is the
> governing document. This one stays as the historical record of the v3 pass
> and as the *identity* ground truth v5 cites.

**Founder directive, 2026-08-02:** replace the amber/dark theme with a
Catodemy-style black-and-white "glitched/hacked" system — "mostly black and
white… but still nice UI/UX and easy on the eye." This document is an
**addendum** to [`DESIGN-SPEC.md`](./DESIGN-SPEC.md), not a replacement: it
overrides the token *values* in DESIGN-SPEC §2 and adds one new motion
primitive (§3 below). Everything else in DESIGN-SPEC — layout (§6), touch
targets (§5), motion timing (§9), the accessibility floor (§10), microcopy
(§8) — is unchanged and still governs.

**How this shipped.** Every component in `app/src/components/**` already
consumed semantic tokens (`var(--accent)`, `bg-surface-2`, `text-danger`,
…) rather than literal colours — DESIGN-SPEC's own Layer-1/Layer-2/Layer-3
architecture (see the header comment in `app/src/index.css`) exists
precisely so a restyle is a values-only change. Confirmed by a sweep of
`app/src/**/*.{ts,tsx}` for hardcoded amber hex/Tailwind-amber-scale
utilities: **none found**. The two files that carry literal hex outside
`tokens.css` are `LangIcons.tsx` (Python/Java's own trademarked logo colours
— never recoloured, out of scope by design) and `Logo.tsx` (owned by the
brand-v3 workstream; its `--logo-accent` fallback already reads
`var(--accent)` first, so it inherits this pass with no edit). `editor/setup.ts`
needed **zero changes**: its `chromeTheme` is built entirely from `var(--...)`
custom properties, so the monochrome-chrome / coloured-syntax split (this
document's central requirement) was already correct by construction — oneDark
supplies syntax colour, `chromeTheme` overrides only the surfaces the tokens
below control.

---

## 1. What changed, and why

**Surfaces** went from a warm-ish charcoal ramp to a cooler, darker,
240-hue near-black ramp — closer to Catodemy's `--background: 240 10% 3.9%`
than to v1's `#15171C`. **Accent** stopped being amber and became
near-white: the interactive/brand signature (active-tab rule, focus ring,
caret, Run fill, the console rail) is now the same near-white as primary
text, which is what makes the UI read as black-and-white rather than
"dark theme with an accent colour." **Semantic colours kept their v1 hex —
success/danger/warn/info are the only chroma left in the chrome**, and
darkening the surfaces under them only improved their contrast (see §2).
**Syntax highlighting is untouched** — oneDark's colours are exactly what
they were; only the chrome around the code changed.

## 2. Token table — old (v1) → new (v3)

All ratios are computed WCAG 2.x relative luminance, not estimated, using
the same method DESIGN-SPEC §2 uses. "AA" = ≥4.5:1 body text, ≥3:1 graphical
objects/control boundaries (WCAG 1.4.11).

### 2.1 Surfaces

| Token | v1 | v3 | Use |
|---|---|---|---|
| `--surface-0` | `#15171C` | **`#09090B`** | App frame, top bar, gaps |
| `--surface-1` | `#1A1D23` | **`#0E0E11`** | Editor canvas — reading surface |
| `--surface-2` | `#1F232A` | **`#151519`** | Panels: explorer, console, tabs |
| `--surface-3` | `#262B33` | **`#242429`** | Raised: menus, dialogs, cards |
| `--surface-4` | `#2F3540` | **`#323239`** | Inputs, pressed, progress track |

Adjacent-surface separation: `1.03:1` (0↔1), `1.06:1` (1↔2), `1.11:1` (2↔3),
`1.17:1` (3↔4) — in the same 1.0-1.2:1 band as v1's own measured 1.07-1.66:1.
**Principle 2 from DESIGN-SPEC still holds without qualification: a state may
never be signalled by a surface change alone.** Darkening the ramp did not
relax this — every state that matters still carries a rule, a border, a
weight change, or a glyph, unchanged from v1.

### 2.2 Text

| Token | v1 | v3 | on `-1` | on `-2` |
|---|---|---|---|---|
| `--text-1` | `#E8EBF0` | **`#FAFAFA`** | **18.47** | **17.45** |
| `--text-2` | `#AEB6C4` | **`#BABAC4`** | **10.01** | **9.46** |
| `--text-3` | `#8B94A3` | **`#8B8B9C`** | **5.76** | **5.44** |
| `--text-disabled` | `#7A8290` | **`#6A6A7C`** | 3.64 | 3.44 (WCAG-exempt) |

Every content pair improved over v1 — a darker canvas under the same
near-white gives more headroom, not less. `--text-3` is still the lowest
AA-passing text colour; there is still no fourth grey for content.

### 2.3 Accent — was amber, now white (the whole point of this pass)

| Token | v1 | v3 | Use |
|---|---|---|---|
| `--accent` | `#F2A94B` | **`#FAFAFA`** | Active-tab rule, focus ring, links, caret, logo workpiece, primary fill |
| `--accent-hover` | `#DE9639` | **`#DFDFE2`** | Primary button hover |
| `--accent-press` | `#C9832F` | **`#C5C5C9`** | Primary button active |
| `--accent-ink` | `#15171C` | **`#09090B`** | Text/icon **on** an accent fill — 19.06:1 (was 9.01) |
| `--accent-soft` | `#33291A` | **`#29292E`** | Tinted fill behind accent text (badges) |

`--accent` on surfaces: **18.47** on `-1`, **17.45** on `-2`, **14.8** on
`-3` (was 8.48/7.92/7.15). The rule "never put white text on `--accent`" is
retired as stated — it *is* white now — and replaced by its structural
successor: **always use `--accent-ink` for text/icons on an `--accent`
fill**, never a literal. `--accent-ink` is tuned to `--accent` specifically
(19.06:1); it is not a general-purpose "ink" colour for other fills.

### 2.4 Semantic — unchanged hex, rechecked against the new (darker) surfaces

| Token | Hex (unchanged) | on `-1` | on `-2` | on `-3` |
|---|---|---|---|---|
| `--success` | `#6BD68F` | 10.68 | **9.09→10.09** | 8.56 |
| `--danger` | `#FF8A8F` | 8.52 | **8.05** | 6.83 |
| `--warn` | `#E5B95C` | 10.49 | **9.91** | 8.41 |
| `--info` | `#7FC4F5` | 10.2 | **9.64** | 8.18 |

(v1's own stated ratios were all measured against `-2`: success 8.74, danger
6.97, warn 8.58, info 8.35 — every one of them is higher now, purely because
the surface under them got darker while the foreground held still.) Soft
fills (`--success-soft` `#16301F`, `--danger-soft` `#3A2226`, `--warn-soft`
`#33291A`, `--info-soft` `#1B2A38`) and `--danger-fill` `#A32126` are also
unchanged — they are standalone dark tints, independent of the neutral ramp,
and their own foreground-on-fill ratios (7.88 / 6.46 / — / 7.75 / 7.49 with
white) do not move.

One dependency did change: **`--warn-soft` is no longer visually identical
to `--accent-soft`.** In v1 both happened to equal `#33291A` because accent
and warn were both amber-family hues; now that accent is white, they are
independent tokens with independent values (`--warn-soft` keeps its own warm
dark tint; `--accent-soft` is a new neutral dark tint, §2.3). Nothing
consumes `--warn-soft` as if it were `--accent-soft` today, so this is a
values-only change with no component fallout — flagged here so it stays
that way.

`--neutral-soft` moves from `#2A2F38` to **`#242429`** (8.02:1 with
`--text-2`, was 6.59:1) — it now equals `--border-subtle`, the same
relationship v1 had (both were `#2A2F38` there too).

### 2.5 Borders, rings, overlays

| Token | v1 | v3 | Notes |
|---|---|---|---|
| `--border-subtle` | `#2A2F38` | **`#242429`** | Panel dividers, decorative |
| `--border-control` | `#6B7789` | **`#8D8D9A`** | Control boundaries — see below |
| `--focus-ring` | `var(--accent)` | `var(--accent)` (now white) | 2px outline + 2px offset |
| `--scrim` | `rgba(8,9,12,0.62)` | **`rgba(4,4,5,0.7)`** | Behind drawers, dialogs, menus |
| `--shadow-raised` | `0 8px 24px -6px rgba(0,0,0,.6)` | **`…rgba(0,0,0,.75)`** | Deeper, to read against a darker canvas |

**`--border-control` closes a pre-existing gap, not just a recolour.** v1's
`#6B7789` cleared 3:1 on `-1`/`-2`/`-3` (3.72/3.47/3.13, the numbers
DESIGN-SPEC states) but only **2.71:1 on `-4`** — under the WCAG 1.4.11 floor
on inputs and pressed states, a fact v1 never surfaced because its own table
stops at `-3`. v3's `#8D8D9A` clears **3:1 on all four surfaces**
(5.88 / 5.56 / 4.71 / **3.88**), so this pass is strictly more compliant
than the baseline it replaces, not just re-skinned.

### 2.6 Editor chrome (CodeMirror 6)

No change to *mechanism* — `chromeTheme` in `editor/setup.ts` is
unchanged, because it was already 100% `var(--code-*)` / `var(--accent)` /
etc. Only the values these tokens resolve to moved:

| Token | v1 | v3 | Notes |
|---|---|---|---|
| `--code-bg` / `--code-gutter-bg` | `var(--surface-1)` | `var(--surface-1)` | unchanged (token, not value) |
| `--code-gutter-fg` | `#868E9D` (5.12) | **`#8D8D9A`** (**5.88**) | |
| `--code-active-line` | `#22262E` (12.69) | **`#1D1D20`** (**16.11**) | |
| `--code-selection` | `#384252` (8.49) | **`#35353B`** (**11.67**) | cool neutral, was cool-blue |
| `--code-search-match` | `#4A3A1E` (9.18) | **`#423C2E`** (**10.49**) | kept **warm**, on purpose |
| `--code-caret` | `var(--accent)` (amber) | `var(--accent)` (**white**) | 2px, unchanged geometry |
| `--code-bracket` | `#4A5364` | **`#4F4F59`** | +1px `--border-control` boundary |
| `--code-indent-guide` | `#272C34` | **`#222226`** | decorative |

**Why `--code-search-match` stays warm instead of going neutral like
everything else:** with `--code-selection` now a cool neutral grey, a search
highlight at the *same* lightness and hue would be visually indistinguishable
from a text selection while a student is trying to tell "this is highlighted
because I searched for it" apart from "this is highlighted because I
selected it." The warm tint is not a brand-accent reintroduction (it is not
`--accent`, not used anywhere else, and never appears without the search
feature active) — it is the same differentiation trick v1 used for the same
reason, kept because the problem it solves didn't go away when amber did.

## 3. Glitch — the one brand-specific effect

The founder's brief was explicit that this is a *moment*, not a texture:
"mostly black and white… glitched/hacked effect… but still nice UI/UX and
easy on the eye." Two implementations, both CSS-only
(`app/src/index.css`, `@keyframes warsha-glitch-mark` / `warsha-glitch-rail`),
both respecting `prefers-reduced-motion` through the same global block every
other animation in the app already uses (`animation-iteration-count: 1
!important` under reduced motion — for the looping mark animation that alone
neuters it into a no-op; the rail animation is already a single iteration by
design).

1. **The welcome lockup** (`WelcomePanel.tsx`, wraps `<LogoLockup/>` in a
   span carrying `animate-glitch-mark motion-reduce:animate-none`). A 7s
   loop that sits still for ~92% of its cycle and stutters — jittered
   `translate` + a duplicated-edge `drop-shadow` standing in for an RGB
   channel split — for about 250ms. A rare tic, not a loop anyone consciously
   notices, on the one screen where "hacked workshop" branding is allowed to
   introduce itself.
2. **The console rail's run-state entry** (`.console-panel[data-state=
   'preparing'|'running'|'waiting']` in `index.css`). A one-shot (non-looping)
   keyframe on the same rule that already colours the rail `--accent` when a
   run starts — a brief width/brightness stutter that fires exactly once, at
   the instant the state attribute starts matching, so the moment a run
   *begins* reads as a switch thrown rather than a CSS transition settling.

**What is deliberately NOT glitched, and must stay that way:** the editor
canvas, the console transcript, file/tab rows, dialogs, any surface a
student is actively reading. Glitch is a brand accent used sparingly at
exactly two call sites above — adding a third without checking with Design
first is the mistake this section exists to prevent. The loading-shimmer
moment DESIGN-SPEC §7.6 asks for (`ProgressBlock.tsx`'s `animate-sweep`) was
not touched: it already existed pre-v3, is not a "glitch" effect by this
document's definition (a smooth translateX sweep, not a stutter), and
inherits the new white `--accent` automatically through the token swap —
no component edit needed there either.

## 4. What did NOT change

Everything DESIGN-SPEC states outside the color tables in its §2:
layout (§6), touch targets and reach (§5), motion **timing** (§9 — durations
and easing are the same `--dur-fast`/`--dur`/`--dur-slow`/`--ease`; only two
new keyframes were added, no existing one was retimed), spacing/radii scale,
type scale and font stacks (§3), the keyboard-handling contract (§4),
microcopy (§8), the accessibility floor as a *set of rules* (§10 — contrast
minimums, focus-visible-only rings, live regions, compound state signalling),
and the logo geometry/usage rules (§11, all owned by the brand-v3 workstream
task #28). Component markup and class names are unchanged everywhere except
the two files this document names in §3 (`WelcomePanel.tsx`) and the
comment-only amber→accent language cleanup in `index.css` (no selectors or
values touched by that cleanup, only prose describing them).

## 4a. Focus ring geometry — founder ruling, 2026-08-02

The default `:focus-visible` ring (`app/src/index.css` `@layer base`) moved
from **2px width / 2px offset** to **1px width / no offset**, app-wide. This
is a geometry-only ruling — colour is unchanged (still `var(--focus-ring)` =
`var(--accent)`, i.e. white).

Three call sites carry a **-1px inset** variant instead of the default, for
controls with zero slack around their own box (a column exactly as wide as
the button in it, or an element clipped by a scroll parent) — the rule is
`outline-offset` = **minus the ring's own width**, which keeps the ring
flush against the *inside* of the border with zero outward overflow, so it
can never be clipped by a parent that ends exactly at that edge:

| Site | Before | After |
|---|---|---|
| `ActivityBar.tsx` rail buttons | `outline-offset-[-2px]` | `outline-offset-[-1px]` |
| `StatusBar.tsx` font-size stepper | `outline-offset-[-1px]` | unchanged — already equalled the new `-width` |
| `.stdin-input:focus-visible` (index.css) | `outline: 2px solid …; outline-offset: -2px` | `outline: 1px solid …; outline-offset: -1px` |

Verified by tabbing through the real app (real `Tab`/`ArrowDown` key
events — a scripted `.focus()` call does not reliably trigger
`:focus-visible` in Chromium, since the pseudo-class also tracks the most
recent input modality; using the actual keyboard is what makes this
observation trustworthy) across the title bar, explorer rows, tabs, console
header controls (Run, icon buttons), the overflow menu, an inline rename
input, and the stdin live line. The 1px white ring stayed clearly visible
everywhere, including against `--border-control`-bordered controls (welcome
cards, the rename input) — `--border-control` `#8D8D9A` (rgb(141,141,154))
and the ring colour `#FAFAFA` (rgb(250,250,250)) are far enough apart in
lightness that the ring reads as a distinct, brighter line rather than
merging with the control's own border. No surface needed a colour/inversion
workaround to stay legible at 1px/0.

## 5. QA contract

Unchanged from DESIGN-SPEC/PIXEL-FINDINGS: `tools/qa/verify.mjs`,
`audit.mjs`, `motion.mjs`, `spacing.mjs`, `overlap.mjs` must all stay green
against this pass. Where `audit.mjs` asserts a *computed* colour (not just a
contrast ratio), its expectations were updated to the v3 hex values in §2
above — deliberately, file by file, never by loosening a check's coverage.
See the verification report for the exact run.
