# Warsha — Theme v5 addendum (the black/white identity, back, on the v4 structure)

**Founder directive, 2026-08-05:** *"I do not like vscode blue theme, I want my
original black and white theme back."* This document is an **addendum** to
[`DESIGN-SPEC.md`](./DESIGN-SPEC.md) and **supersedes
[`THEME-V4.md`](./THEME-V4.md)** (the Dark Modern parity skin). It is a
reconciliation, not a revert: everything **structural** that v4 built stays —
layout, density, the VS Code component grammar (top-edge tab rule, full-row
list selections, the status-bar remote block, hairline panel seams), and the
**entire expanded token vocabulary** (lists, tree, bars, tabs, menus, widgets,
quick input, badges, scrollbars, terminal). What goes is v4's *palette*: every
family is re-expressed in [`THEME-V3.md`](./THEME-V3.md)'s monochrome identity
— the 240-hue near-black surface ramp, the **white accent**, restrained greys,
and chroma in the chrome reserved for the four semantic colours.

**How this shipped.** Same mechanism as v3 and v4: token *values* changed in
[`tokens.css`](./tokens.css), token *names* did not — including every name v4
introduced — so every component restyled itself with zero component edits. The
literal-carrying files outside `tokens.css` moved in the same pass:
`app/index.html`'s pre-CSS boot screen (boot background `#09090B` =
`--surface-0`, theme-color `#09090B`, mark ink `#FAFAFA` = `--text-1`) and
`public/manifest.webmanifest` (`background_color` and `theme_color` both
`#09090B` — all three literals now agree). `editor/setup.ts`'s **syntax**
palette is untouched *on purpose*: the founder's complaint is blue **chrome**;
colourful code on monochrome chrome is the brand.

---

## 1. What changed, and why

**Accent is white again** (`#FAFAFA`). The single-lever property v4 built is
kept: `--tab-accent-top`, `--ab-active-border`, `--panel-tab-active`,
`--sash-hover`, `--focus-ring`, `--progress`, `--link` and
`--badge-accent-bg` all alias `var(--accent)`, so the active-tab rule, the
activity-bar indicator, the panel underline, the ring, the progress bar,
links and the accent badge went white in one edit. Two deliberate
de-aliasings survive or appear:

- `--code-caret` stays a **literal** (`#FAFAFA`) — equal to the accent by
  value, decoupled by v4's rule so an accent retune can never silently move
  the caret.
- `--statusbar-remote-bg` **stops** aliasing `--accent`: the components put
  literal white text on that block, and white-on-white is not a colour. See
  §3.

**Surfaces** return to v3's exact 240-hue near-black ramp (`#09090B` /
`#0E0E11` / `#151519` / `#242429` / `#323239`). Unlike v4, `--surface-0` no
longer equals `--surface-2` — but **v4's border discipline is kept as law**:
adjacent surfaces are only ~1.03-1.2:1 apart, so every load-bearing seam still
carries `--border-subtle` (`#242429`), and no state is ever signalled by a
fill change alone.

**The v4 border exception is retired.** `--border-control` returns to v3's
`#8D8D9A`, which clears 3:1 on all four surfaces (5.88 / 5.56 / 4.71 / 3.88)
— the WCAG 1.4.11 gap v4 knowingly opened (`#3C3C3C`, ~1.5:1, "parity wins")
closes again, because there is no parity to win any more.

**Selection is grey/white, not blue.** v4's `#04395E`-family selection fills
(lists, menus, editor, terminal) become the v3 overlay language: neutral greys
off the 240-hue ramp for fills, full white for the selected row's label.

**Semantic colours** are v3's exact hex — `#6BD68F` / `#FF8A8F` / `#E5B95C` /
`#7FC4F5` with their v3 soft fills — the only chroma left in the chrome.

## 2. Old → new value table (v4 → v5)

Unlisted tokens are unchanged from v4 (aliases like `--code-bg`, the
scrollbar alphas, the 16 ANSI colours, all type/spacing/geometry/motion —
density and scale are final and were not touched).

| Token | v4 (Dark Modern) | v5 (monochrome) |
| --- | --- | --- |
| `--surface-0` | `#181818` | `#09090B` |
| `--surface-1` | `#1F1F1F` | `#0E0E11` |
| `--surface-2` | `#181818` | `#151519` |
| `--surface-3` | `#202020` | `#242429` |
| `--surface-4` | `#313131` | `#323239` |
| `--text-1` | `#CCCCCC` | `#FAFAFA` |
| `--text-2` | `#9D9D9D` | `#BABAC4` |
| `--text-3` | `#868686` | `#8B8B9C` |
| `--text-disabled` | `#6E7681` | `#6A6A7C` |
| `--accent` | `#0078D4` | `#FAFAFA` |
| `--accent-hover` | `#026EC1` | `#DFDFE2` |
| `--accent-press` | `#025A9F` | `#C5C5C9` |
| `--accent-ink` | `#FFFFFF` | `#09090B` |
| `--accent-soft` | `#04395E` | `rgba(250,250,250,0.10)` (v3's `#29292E`, re-derived as a translucent white so it composes on any surface) |
| `--success` / `-soft` | `#89D185` / `#1B2B1E` | `#6BD68F` / `#16301F` |
| `--danger` / `-soft` / `-fill` | `#F85149` / `#351B1B` / `#B91007` | `#FF8A8F` / `#3A2226` / `#A32126` |
| `--warn` / `-soft` | `#CCA700` / `#2E2717` | `#E5B95C` / `#33291A` |
| `--info` / `-soft` | `#4DAAFC` / `#172939` | `#7FC4F5` / `#1B2A38` |
| `--neutral-soft` | `#2A2D2E` | `#242429` (== `--border-subtle` == `--list-hover-bg`, both v3/v4 relationships intact) |
| `--border-subtle` | `#2B2B2B` | `#242429` |
| `--border-control` | `#3C3C3C` (sub-3:1) | `#8D8D9A` (3:1 everywhere — v4 §4 exception retired) |
| `--scrim` | `rgba(0,0,0,0.5)` | `rgba(4,4,5,0.7)` |
| `--shadow-raised` | `0 0 8px 2px rgba(0,0,0,0.36)` | `0 8px 24px -6px rgba(0,0,0,0.75)` |
| `--list-hover-bg` | `#2A2D2E` | `#242429` |
| `--list-active-sel-bg` | `#04395E` | `#3A3A42` |
| `--list-inactive-sel-bg` | `#37373D` | `#2B2B31` |
| `--list-highlight` | `#2AAAFF` | `#E5B95C` (see §4) |
| `--list-drop-bg` | `#383B3D` | `#35353B` |
| `--sidebar-drop-bg` | `rgba(83,89,93,0.5)` | `rgba(88,88,98,0.5)` |
| `--tree-guide` / `-inactive` | `#585858` / `rgba(88,88,88,0.4)` | `#55555E` / `rgba(85,85,94,0.4)` |
| `--code-gutter-fg` | `#6E7681` | `#8D8D9A` |
| `--code-gutter-fg-active` | `#CCCCCC` (literal) | `#FAFAFA` (still a literal) |
| `--code-active-line-border` | `#282828` | `#26262B` |
| `--code-selection` | `#264F78` | `#35353B` (v3) |
| `--code-selection-inactive` | `#3A3D41` | `#2B2B31` |
| `--code-selection-match` | `rgba(173,214,255,0.15)` | `rgba(250,250,250,0.12)` |
| `--code-search-match` | `rgba(234,92,0,0.33)` | `#423C2E` (v3's warm match) |
| `--code-search-match-selected` | `#9E6A03` | `#5C5033` |
| `--code-caret` | `#AEAFAD` | `#FAFAFA` (v3's white caret, kept literal) |
| `--code-bracket` / `-border` | `rgba(0,100,0,0.1)` / `#888888` | `rgba(250,250,250,0.08)` / `#8D8D9A` |
| `--code-bracket-1/2/3` | rainbow cycle | **unchanged** — syntax territory |
| `--code-indent-guide` / `-active` | `#404040` / `#707070` | `#222226` / `#55555E` |
| `--code-widget-bg` / `--widget-bg` | `#202020` | `#242429` |
| `--titlebar-bg` / `--statusbar-bg` | `#181818` | `#09090B` |
| `--titlebar-fg` / `--statusbar-fg` | `#CCCCCC` | `#BABAC4` |
| `--titlebar-border` / `--statusbar-border` | `#2B2B2B` | `#242429` |
| `--statusbar-remote-bg` | `var(--accent)` (blue) | `#1F6640` (see §3) |
| `--ab-fg` / `-inactive` | `#D7D7D7` / `#868686` | `#DFDFE2` / `#8B8B9C` |
| `--toolbar-hover-bg` | `rgba(90,93,94,0.31)` | `rgba(255,255,255,0.10)` |
| `--menu-bg` | `#1F1F1F` | `#242429` |
| `--menu-border` / `-sep` | `#454545` | `#45454E` |
| `--menu-sel-bg` / `-fg` | `var(--accent)` / `#FFFFFF` | `#3A3A42` / `#FFFFFF` (== the list selection: one language) |
| `--input-bg` | `#313131` | `#323239` |
| `--input-placeholder` | `#989898` | `#8B8B9C` |
| `--border-widget` | `rgba(204,204,204,0.2)` | `rgba(250,250,250,0.18)` |
| `--qi-bg` / `--qi-border` | `#222222` / `#313131` | `#242429` / `#3E3E46` |
| `--qi-input-bg` / `-border` | `#313131` / `#3C3C3C` | `#323239` / `#8D8D9A` |
| `--picker-group-fg` / `-border` | `#3794FF` / `#3C3C3C` | `#BABAC4` / `#3E3E46` |
| `--kbd-fg` | `#CCCCCC` | `#DFDFE2` |
| `--badge-bg` / `-fg` | `#616161` / `#F8F8F8` | `#4F4F59` / `#FAFAFA` |
| `--badge-accent-bg` / `-fg` | accent / `#FFFFFF` | `var(--accent)` / `var(--accent-ink)` (white badge, near-black ink) |
| `--btn-secondary-bg` / `-fg` / `-hover-bg` | `#313131` / `#CCCCCC` / `#3C3C3C` | `#323239` / `#FAFAFA` / `#3E3E46` |
| `--terminal-sel` | `#264F78` | `#35353B` (== `--code-selection`) |
| `--progress` / `--link` | accent / `#4DAAFC` | `var(--accent)` both — v3 had no separate link colour; the underline carries linkness |

## 3. The status-bar remote block (state colours)

v4 filled the remote block with the accent while a run was live. In v5 the
accent is white and `StatusPill.tsx`'s bar variant puts **literal white text**
on `bg-statusbar-remote` — so the alias had to break. Following v3's own
semantics (v3's pill rendered preparing/running as **success green**, and
"semantic colours are the only chroma in the chrome"), the live block is a
**success-strength green fill**, `#1F6640`, white text at **6.9:1** (AA at any
size). *Failed* keeps the component's `--danger-fill`, now v3's `#A32126`
(white text **7.49:1**). *Idle / finished / stopped* stay unfilled, exactly
as v4 designed. Colour still never travels alone — the glyph and the word go
with it.

## 4. `--list-highlight` — the one warm exception, and why

Matched characters in filtered lists (quick input, completions) were VS Code's
`#2AAAFF`. A "bright white" highlight is impossible here: the labels
themselves are near-white (`#FAFAFA`), so white-on-white carries nothing, and
values-only surgery cannot add a weight change. v3 solved exactly this problem
for search matches — "kept **warm**, on purpose … distinguishable from the
cool selection grey without reintroducing amber as an accent" — so v5 extends
that precedent: `--list-highlight` is `#E5B95C` (the `--warn` hex used as a
highlight, not as a warning). Ratios: **6.0:1** on `--list-active-sel-bg`,
**8.3:1** on `--surface-3`, **9.9:1** on `--surface-2`. Same rules as v3 §2.6:
it never appears outside match highlighting, and it is not the accent.

## 5. WCAG re-check (the ratios a reviewer should verify)

Computed WCAG 2.x relative luminance, same method as v3/v4. On `--surface-1`
`#0E0E11` / `--surface-2` `#151519` unless stated:

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--text-1` `#FAFAFA` on `-1` / `-2` | 18.47 / 17.45 | AAA |
| `--text-2` `#BABAC4` on `-1` / `-2` | 10.01 / 9.46 | AAA |
| `--text-3` `#8B8B9C` on `-1` / `-2` | 5.76 / 5.44 | AA (lowest text grey) |
| `--accent` `#FAFAFA` on `-1` / `-2` / `-3` | 18.47 / 17.45 / 14.8 | AAA |
| `--accent-ink` `#09090B` on `--accent` | 19.06 | AAA |
| `#FFFFFF` on `--list-active-sel-bg` `#3A3A42` | 11.3 | AAA |
| `--text-1` on `--list-inactive-sel-bg` `#2B2B31` | ~14 | AAA |
| `--list-highlight` `#E5B95C` on `#3A3A42` / `-3` | 6.0 / 8.3 | AA |
| `#FFFFFF` on `--statusbar-remote-bg` `#1F6640` | 6.9 | AA |
| `#FFFFFF` on `--danger-fill` `#A32126` | 7.49 | AA |
| `--danger` `#FF8A8F` on `-1` / `-2` (stderr body) | 8.52 / 8.05 | AA+ |
| `--success` / `--warn` / `--info` on `-2` | 10.09 / 9.91 / 9.64 | AA+ |
| `--statusbar-fg` `#BABAC4` on `#09090B` | ~10.5 | AAA |
| `--picker-group-fg` `#BABAC4` on `--qi-bg` `#242429` | 7.9 | AA (11px group labels) |
| `--badge-fg` `#FAFAFA` on `--badge-bg` `#4F4F59` | 7.75 | AA |
| `--btn-secondary-fg` `#FAFAFA` on `#323239` | 12.2 | AAA |
| `--border-control` `#8D8D9A` on `-1`/`-2`/`-3`/`-4` | 5.88 / 5.56 / 4.71 / 3.88 | ≥3:1 everywhere (1.4.11) |
| `--tab-active-fg` `#FFFFFF` on `--surface-1` | 19.4 | AAA |
| `--text-1` on `--code-selection` `#35353B` | 11.67 | AAA |

`--text-disabled` `#6A6A7C` remains WCAG-exempt (disabled controls only). The
16 ANSI colours are program output, unchanged from v4; every one is at least
as readable on the darker v5 ground as it was on `#181818` (worst case
`--ansi-blue` `#2472C8`: 4.0:1 on `-1`, up from 3.7:1).

## 6. What v4 built that v5 keeps (so nobody "restores" it away)

- The full v4 token contract — every name, consumed by the parity waves.
- Border-mandatory seams (v4 §5), now enforced by discipline rather than
  identical fills.
- The tab grammar (1px accent rule on the TOP edge, editor-fill active tab,
  weight 400 both states), the full-row list selection model, the desk
  bordered active-line treatment, the status-bar remote block, kbd-chip
  anatomy, scrollbar alphas.
- All density/geometry/type founder rulings of 2026-08-05 (`--fs-code` 14px,
  `--bar-top` 40px, radii 2/5/6, `--row-tree` 36→22, …).
- The Dark+ syntax palette and completion-kind colours in `editor/setup.ts`,
  and the rainbow-bracket cycle (`--code-bracket-1/2/3`) — code stays
  colourful.

## 7. Housekeeping

- `tools/qa` computed-colour assertions retuned to v5 hex (deliberately, file
  by file, never by loosening coverage): `audit.mjs` (focus ring, card
  border, active tab, tree selection, primary/disabled buttons, scrim, stdin
  caret/echo `--info`, remote block, stderr ink), `files-verify.mjs` (tree
  fills, tab signals, caret comment), `files-complete.mjs`
  (`--list-highlight`), `console-check.mjs` (stderr ink).
- `THEME-V4.md` carries a superseded pointer to this document; `THEME-V3.md`'s
  pointer now notes that v5 restored its identity on the v4 structure.
