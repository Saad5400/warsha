# Warsha — Theme v4 addendum (VS Code "Dark Modern" parity)

> **SUPERSEDED, 2026-08-05 (same day):** the founder rejected the Dark Modern
> *palette* — "I do not like vscode blue theme, I want my original black and
> white theme back." Current values and rationale live in
> [`THEME-V5.md`](./THEME-V5.md), canonical hex in [`tokens.css`](./tokens.css).
> What survives of v4 is everything **structural**: the expanded token
> vocabulary (§3), the border-mandatory seam rule (§5), the component grammar
> and the density/geometry rulings. The v4 *colour values* below no longer
> govern, and the §4 sub-3:1 border exception is retired.

**Founder directive, 2026-08-05:** retheme Warsha to visual parity with VS
Code's default **Dark Modern** theme, as part of the app-wide VS Code-parity
overhaul. This document is an **addendum** to
[`DESIGN-SPEC.md`](./DESIGN-SPEC.md) and **supersedes
[`THEME-V3.md`](./THEME-V3.md)** (the black/white/glitch pass): it overrides
the token *values* in DESIGN-SPEC §2 / THEME-V3, adds the v4 token families
(lists, tree, bars, tabs, menus, widgets, quick input, badges, scrollbars,
terminal), and states the two places where v4 knowingly relaxes an earlier
rule (§4, §5). Layout (§6), touch targets (§5), motion timing (§9), microcopy
(§8) and the rest of the accessibility floor (§10) are unchanged and still
govern.

**How this shipped.** Same mechanism as v3: token values changed in
`docs/design/tokens.css`, token names did not, so every component that reads
`var(--accent)` / `bg-surface-2` / `text-danger` restyled itself. The three
places literals live outside `tokens.css` remain the known ones —
`app/index.html`'s pre-CSS boot screen (updated in the same commit: boot
background `#1F1F1F` = `--surface-1`, theme-color `#181818` = `--surface-0`,
mark ink `#CCCCCC` = `--text-1`), `editor/setup.ts`'s syntax/kind colours,
and `LangIcons.tsx`'s per-language brand fills. New in v4: a full contract of
**new** tokens that the parity waves consume — later packages add *no* colour
values of their own.

---

## 1. What changed, and why

**Accent** is no longer white: it is VS Code's `#0078D4` blue, and it is the
single lever — the active-tab rule, the activity-bar indicator, the focus
ring, Run, the console rail and the menu selection all alias it, so one edit
re-accents the app. Whatever must **not** follow the accent is decoupled:
`--code-caret` is `#AEAFAD` (VS Code's caret) and must never be re-aliased to
`--accent`, or the caret turns blue.

**Surfaces** moved from the v3 240-hue near-black ramp to Dark Modern's flat
neutral greys — and `--surface-0` now **equals** `--surface-2` (`#181818`) by
design. Adjacent chrome panels are separated by 1px `--border-subtle`
hairlines, not by luminance (§5).

**Semantic colours** are VS Code's own: `#89D185` / `#F85149` / `#CCA700` /
`#4DAAFC`, with soft fills re-derived on the `#181818` ground.

## 2. Old → new value table (retuned tokens)

| Token | v3 | v4 |
| --- | --- | --- |
| `--surface-0` | `#09090B` | `#181818` |
| `--surface-1` | `#0E0E11` | `#1F1F1F` |
| `--surface-2` | `#151519` | `#181818` (== `--surface-0`, see §5) |
| `--surface-3` | `#242429` | `#202020` |
| `--surface-4` | `#323239` | `#313131` |
| `--text-1` | `#FAFAFA` | `#CCCCCC` |
| `--text-2` | `#BABAC4` | `#9D9D9D` |
| `--text-3` | `#8B8B9C` | `#868686` |
| `--text-disabled` | `#6A6A7C` | `#6E7681` |
| `--accent` | `#FAFAFA` | `#0078D4` |
| `--accent-hover` | `#DFDFE2` | `#026EC1` |
| `--accent-press` | `#C5C5C9` | `#025A9F` |
| `--accent-ink` | `#09090B` | `#FFFFFF` |
| `--accent-soft` | `#29292E` | `#04395E` |
| `--success` | `#6BD68F` | `#89D185` |
| `--success-soft` | `#16301F` | `#1B2B1E` |
| `--danger` | `#FF8A8F` | `#F85149` |
| `--danger-soft` | `#3A2226` | `#351B1B` |
| `--danger-fill` | `#A32126` | `#B91007` |
| `--warn` | `#E5B95C` | `#CCA700` |
| `--warn-soft` | `#33291A` | `#2E2717` |
| `--info` | `#7FC4F5` | `#4DAAFC` |
| `--info-soft` | `#1B2A38` | `#172939` |
| `--neutral-soft` | `#242429` | `#2A2D2E` |
| `--border-subtle` | `#242429` | `#2B2B2B` |
| `--border-control` | `#8D8D9A` | `#3C3C3C` (see §4) |
| `--scrim` | `rgba(4,4,5,0.7)` | `rgba(0,0,0,0.5)` |
| `--shadow-raised` | `0 8px 24px -6px rgba(0,0,0,0.75)` | `0 0 8px 2px rgba(0,0,0,0.36)` |
| `--code-gutter-fg` | `#8D8D9A` | `#6E7681` |
| `--code-gutter-fg-active` | `var(--text-2)` | `#CCCCCC` (alias broken — literal on purpose) |
| `--code-selection` | `#35353B` | `#264F78` |
| `--code-search-match` | `#423C2E` | `rgba(234,92,0,0.33)` |
| `--code-caret` | `var(--accent)` | `#AEAFAD` (decoupled — mandatory) |
| `--code-bracket` | `#4F4F59` | `rgba(0,100,0,0.1)` |
| `--code-indent-guide` | `#222226` | `#404040` |
| `--r-sm` / `--r-md` / `--r-lg` | `4px` / `6px` / `10px` | `2px` / `5px` / `6px` |

Unchanged where you might expect a change: `--code-bg` /
`--code-gutter-bg` still alias `--surface-1`; `--code-active-line` stays
`#1D1D20` (it is the *touch* fill only — desk uses the
`--code-active-line-border` outline treatment); type scale, spacing, motion
and touch geometry are untouched.

## 3. New token families (the full v4 contract)

All in `tokens.css`; later packages only consume. Lists/tree
(`--list-hover-bg`, `--list-active-sel-bg` `#04395E`,
`--list-inactive-sel-bg` `#37373D`, `--list-highlight` `#2AAAFF`, drop fills,
`--tree-guide`/`-inactive`); editor extras (inactive selection, selection
match, selected search match `#9E6A03`, active-line border, bracket-match
border, rainbow brackets `#FFD700`/`#DA70D6`/`#179FFF`, whitespace,
`--code-widget-bg`); bars (`--titlebar-*`, `--statusbar-*` incl. the
accent remote block and the white-alpha item hovers, `--ab-*`); tabs
(`--tab-active-bg` = editor bg, `--tab-accent-top` = accent — the rule moved
to the TOP edge in v4); panel (`--panel-tab-active`, `--sash-hover`,
`--toolbar-hover-bg` `rgba(90,93,94,0.31)` — one token for toolbar hover AND
menubar selection); menus (`--menu-bg` `#1F1F1F`, `--menu-border`/`-sep`
`#454545`, selection = accent + white); inputs/widgets (`--input-*`,
`--widget-bg` `#202020`, `--border-widget`); quick input (`--qi-*`,
`--picker-group-*`, `--kbd-*` chip anatomy); badges/buttons (`--badge-*`,
`--btn-*`); scrollbar sliders (three translucent greys, VS Code's exact
alphas); the 16 ANSI terminal colours + `--terminal-sel` (contract only — no
renderer yet); `--progress`, `--link`; and geometry (`--row-tree`,
`--tree-indent`, both retuned by the DENSITY block at desk).

## 4. The border exception (deliberate)

v1-v3 required every control boundary to clear **3:1** against its surface;
`--border-control` was `#8D8D9A` for exactly that reason. v4 **drops that
rule**: `--border-control` is now `#3C3C3C`, which is ~1.5:1 on the surfaces
it sits on. This is what VS Code itself ships (`dropdown.border`,
`input.border` = `#3C3C3C`), and parity wins here by explicit decision — a
light border on every input is the single loudest tell that a dark UI is not
VS Code. Consequence for authors: a boundary that must be *perceived* (not
just decorate) needs a second signal — fill (`--input-bg` is a step above its
surround), weight, or focus (`--focus-ring` is the fully-saturated accent).
WCAG 1.4.11 applies to *required* visual information; the paired fill/focus
treatment is the conformance story. Do not "fix" the border locally.

## 5. Surfaces identical, borders mandatory (deliberate)

`--surface-0 == --surface-2 == #181818`. The v1-v3 warning "adjacent surfaces
are only ~1.1:1 apart, add a border" becomes absolute in v4: adjacent chrome
surfaces are **0** apart. Every seam between panels — title bar/sidebar,
sidebar/editor, panel/status bar — must be drawn with `--border-subtle`
(`#2B2B2B`) or the panels visually merge. There is no luminance fallback any
more; if a divider rule is dropped, the boundary is simply gone.

## 6. WCAG re-check (the ratios a reviewer should verify)

On `--surface-1` `#1F1F1F` / on `--surface-0`&`-2` `#181818`:

| Foreground | on `-1` | on `-0`/`-2` | Verdict |
| --- | --- | --- | --- |
| `--text-1` `#CCCCCC` | 10.3 | 11.0 | AAA |
| `--text-2` `#9D9D9D` | 6.1 | 6.5 | AA (any size) |
| `--text-3` `#868686` | **4.53** | 4.9 | AA — at the edge on the editor canvas; never below 12px there |
| `--danger` `#F85149` | 4.9 | 5.3 | AA — stderr body text clears 4.5 |
| `--warn` `#CCA700` | — | 7.7 | AA |
| `--info` `#4DAAFC` (= `--link`) | — | 7.2 | AA |
| `#FFFFFF` on `--accent` `#0078D4` | 4.53 | | AA at the app's 13px UI type |
| `#FFFFFF` on `--accent-soft` `#04395E` (list selection) | 12.0 | | AAA |
| `#FFFFFF` on `--danger-fill` `#B91007` | 6.7 | | AA |

`--text-disabled` `#6E7681` remains WCAG-exempt (disabled controls only).

## 7. Housekeeping

- `tokens.css`'s header was rewritten for v4 (the "accent is now white" story
  was v3's and is wrong now).
- `app/src/index.css` maps every new token in `@theme inline` (naming rule
  documented there: `*-bg` tokens drop the suffix, so utilities read
  `bg-titlebar`, `bg-menu-sel`), retunes the DENSITY block (`--bar-title`
  35px, `--row-tree` 22px, `--tree-indent` 8px, `--explorer-w` 300px) and
  repoints the global scrollbars at the `--scrollbar-slider` family (square
  ends everywhere; the 14px full-gutter slider is desk-only).
- `public/manifest.webmanifest`'s `theme_color` should be brought to
  `#181818` to match `index.html` (owned by the brand pipeline, flagged, not
  edited here).
