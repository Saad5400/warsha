# Pixel findings

A loupe pass over the UI: every small region captured on its own at
deviceScaleFactor 3 with padding around it, read like a design review, and every
suspicion then confirmed or killed with a number.

Regenerate the evidence at any time:

```bash
cd app && npm run build && npx vite preview --port 8099 --strictPort --host
cd tools/qa && WARSHA_URL=http://127.0.0.1:8099/ node pixel-crops.mjs
```

That writes ~116 crops plus `crops/measurements.json` — the
`getBoundingClientRect` and computed styles behind each one. A finding below
cites a crop and a number; re-running and diffing `measurements.json` is how you
check it is still fixed. See `tools/qa/README.md` for the shared env vars
(`WARSHA_URL`, `CHROME`) and the three this script adds (`WARSHA_CROPS`,
`WARSHA_DSF`, `WARSHA_PAD`, `WARSHA_ONLY`).

**Two habits this pass depends on.** Crops are *padded*, because a clip taken at
an element's exact border box can never show that the element overflows its
parent. And nothing is filed on the strength of the image alone: several things
that looked wrong at 3x measured clean, and one that looked like a rounding
artefact turned out to be a 4px stripe. Both directions are recorded below.

Measurements are at 1280x900 unless stated. Colours are the resolved values:
`--surface-1` `rgb(26,29,35)`, `--surface-2` `rgb(31,35,42)`, `--border-subtle`
`rgb(42,47,56)`, `--accent` `rgb(242,169,75)`.

---

## Summary

| Severity | Found | Fixed here | Routed | Not a defect |
| --- | --- | --- | --- | --- |
| P1 — visible break in a surface | 3 | 2 | 1 | — |
| P2 — measurable misalignment | 5 | 1 | 4 | — |
| P3 — minor / sub-pixel | 3 | — | 3 | — |
| Checked, clean | 9 | — | — | 9 |

The founder's four reported defects: **one reproduced** (activity-bar icon
borders), **one reproduced with a different cause than it appeared to have**
(the amber sliver), **one reproduced** (logo/EXPLORER alignment), and **one did
not reproduce** (the Run button overflowing the title bar) — see F-01.

---

## Fixed in this pass

### F-02 · P1 · Active-line highlight breaks for 4px beside the gutter
**Region** `1280-editor-gutter-active` · **Owner** eng-pixel (editor chrome)

The active line's highlight ran as two bands with bare canvas between them. A
horizontal cut through the row read:

```
css   0.00 .. 20.00   rgb(34,38,46)   <- .cm-activeLineGutter
css  20.00 .. 24.00   rgb(26,29,35)   <- 4px of --surface-1, nothing painted
css  24.00 .. 270.00  rgb(34,38,46)   <- .cm-activeLine
```

`.cm-gutters` ends at x=311.61 where `.cm-content` begins, and `.cm-content`
carries `paddingLeft: 4px` (deliberately — it is the clearance that stops iOS
selection handles being clipped against the gutter edge), so `.cm-activeLine`
starts at 315.61 and the two highlights never met.

**Fix** `src/editor/setup.ts` — `boxShadow: '-4px 0 0 0 var(--code-active-line)'`
on `.cm-activeLine`. A shadow rather than a negative margin because `.cm-line`'s
own `paddingLeft` is rewritten per line by `editor/indentGuides.ts` (measured
42.0059px on an indented line), so anything that has to stay in step with it
drifts. The shadow paints into padding that already exists, costs no layout, and
leaves the iOS clearance intact.

**After** the same cut is continuous: `css 14.00 .. 270.00  rgb(34,38,46)`.
Crops: `crops/1280-editor-gutter-active.png` → `crops-after/1280-editor-gutter-active.png`.

### F-03 · P2 · Tab close button sits 1px above its tab
**Region** `1280-tab-close`, `1280-tab-badge` · **Owner** eng-pixel (Tabs.tsx, coordinated with eng-tailwind)

The tab measured T=44 B=88; its 44px close button measured **T=43 B=87** — one
pixel of a control in the tab strip overlapping the title bar above it. The
badge showed the same lean: T=55 B=75 inside a tab whose centre is 66, i.e.
overflow `top:-11 bottom:-13`.

Cause: `border-b-2` for the active accent rule left the tab a **42px content
box** inside its 44px border box, and every `items-center` child centred in 42px
lands 1px proud.

**Fix** `src/components/Tabs.tsx` — carry the 2px accent as
`inset_0_-2px_0_0_var(--accent)` in the existing shadow stack and drop
`border-b-2 border-b-transparent` / `data-[state=active]:border-b-accent`. This
is the argument the strip's own divider two constants above already makes
("a 1px border eats into its 44px"), applied to the tab. The transparent border
existed so activating a tab never shifts its label; a shadow gives that for
free, because a shadow never shifted anything.

**After** close button `overflow {top: 0, bottom: 0}`; badge `{top: -12,
bottom: -12}` — centred rather than 1px high.

### F-04 · P2 · Double divider where the file tree meets the first tab
**Region** `1280-tab-tab-seam` · **Owner** eng-pixel (Tabs.tsx)

Every tab-to-tab boundary draws 1px of `--border-subtle`. The sidebar-to-first-tab
boundary drew 2px:

```
before   css 7.00 .. 9.00   2.00px  rgb(42,47,56)
after    css 7.00 .. 8.00   1.00px  rgb(42,47,56)
```

The sidebar draws its own edge at x=287; the active first tab's
`inset 1px 0 0 0 var(--border-subtle)` landed at 288, immediately beside it, in
the same colour.

**Fix** a `first:` variant that drops the leading inset shadow on the leftmost
tab. `first:data-[state=active]:` is (0,3,0) against the base rule's (0,2,0), so
it wins on specificity regardless of emitted order.

---

## Routed to other owners

I inspected these and did not edit them. Numbers are given so the fix can be
verified the same way.

### F-01 · Run button overflowing the title bar — **did not reproduce** → ui-layout
**Region** `1280-titlebar-run`, `1280-tablist-full`

Recorded because it is on ui-layout's board as a P0 and the cross-check matters.
At 3x the amber button *reads* as though its rounded bottom corners spill past
the bar, which is how it was reported. It does not. Both the DOM and the pixels
say flush:

```
title bar   T=0   B=44        Run button  T=0  B=44  (104x44, min-height 44px)
crop pixels amber rows 0..44 css, cols 14..118 — exactly the button box
```

The apparent overflow is the tab strip's `--surface-2` fill starting at y=44
against the bar's darker `--surface-0`: the eye reads the tone change as the bar
ending higher than it does. Worth keeping in mind for the two title-bar P0s —
**verify with `measurements.json`, not with the crop**, or this one gets "fixed"
twice.

Caveat: ui-layout changed the bar from 44px to **52px** while this pass was
running. Everything above was measured against the 44px bar. Re-run
`WARSHA_ONLY='titlebar|corner' node pixel-crops.mjs` after that lands.

### F-05 · P1 · The activity bar's right divider has a 48px hole at the active icon → ui-layout
**Region** `1280-activitybar-explorer`, `1280-activitybar-search`, `1280-activitybar-full`

This is the founder's "inconsistent activity-bar icon borders", and it is real.
A vertical cut at x=47.5 down the whole rail:

```
css   0.00 ..   4.00     rgb(42,47,56)   <- divider
css   4.00 ..  52.00     rgb(31,35,42)   <- GONE for the active button's 48px
css  52.00 .. 875.00     rgb(42,47,56)   <- divider
```

`.activity-bar` draws its edge as `box-shadow: inset -1px 0 0 0
var(--border-subtle)`. An inset shadow paints above the element's own background
but **below its children's**, and `.activity-btn[data-state="active"]` has
`background: var(--surface-2)` at the rail's full 48px width — so the active
button paints over the divider for its whole height. Because that fill is also
exactly the sidebar's colour, the active icon appears to merge into the file
tree while the inactive ones sit behind a crisp edge.

Cheapest fix: inset the active fill by the divider (`w-[47px]`, or a 1px
transparent right border on `.activity-btn`), or move the edge to the sidebar's
left rather than the rail's right.

### F-06 · P1 · The amber active rail starts 4px below the top of the screen → ui-layout
**Region** `1280-corner-topleft`, `1280-activitybar-full`

The founder's "stray amber sliver". A vertical cut at x=1:

```
css   0.00 ..   4.00   rgb(21,23,28)    <- bare rail
css   4.00 ..  52.00   rgb(242,169,75)  <- the 2px accent rail
css  52.00 .. 874.00   rgb(21,23,28)
```

`.activity-bar` has `padding: 4px 0 0`, and the accent is a `border-left` on the
button rather than on the rail, so the amber begins 4px down. At the very corner
of the window it reads as a detached amber chip rather than as an edge marker.

Same 4px is the reason the first icon does not line up with the title bar: the
folder glyph's centre is y=28 against the Warsha mark's y=22 — **6px apart**, in
the one place where two elements are most obviously compared.

### F-07 · P2 · Three different left insets down the same column → ui-layout
**Region** `1280-sidebar-header`, `1280-sidebar-project-row`, `1280-explorer-row-active`

The title bar and the sidebar occupy the same column (both start at x=48), so
their contents are read against each other. They do not agree, and neither does
the sidebar with itself:

| Element | Left edge | Inset from x=48 |
| --- | --- | --- |
| Warsha mark (title bar) | 52 | **4px** |
| EXPLORER label | 60 | **12px** |
| Project row content (`padding-left: 8px`) | 56 | **8px** |
| Tree rows (`padding-left: 12px`) | 60 | 12px |

This is the founder's "cramped logo/EXPLORER alignment": 4 against 12, 8px of
rag over a 44px vertical distance. Picking one value (12px reads best against
the 48px rail) for the mark and the project row would settle all three.

### F-08 · P2 · Indent guides vanish on hover → ui-layout
**Region** `1280-explorer-row-nested`, `1280-explorer-guides`

At rest the guide is there and very quiet — 1px of `rgb(39,44,52)` at x=71
against `--surface-2` `rgb(31,35,42)`, a channel delta of ~8. On a hovered row
the fill lifts to `rgb(38,43,51)` and the delta drops to **~1**: the guide is
gone exactly while the pointer is on the row it belongs to. Either lift the
guide with the row or give it a colour that clears the hover fill.

### F-09 · P3 · Console resize handle's hairline lands on a half pixel → eng-terminal
**Region** `1280-console-divider` · `components/ConsoleDivider.tsx`

`absolute inset-x-0 top-1/2 h-px -translate-y-1/2` inside an `h-3` (12px) box
puts a 1px line at css 5.5..6.5 — straddling a device-pixel boundary, so at 3x
it renders as ~1.33px of soft grey instead of a crisp rule:

```
css 17.33 .. 17.67  rgb(34,37,45)
css 17.67 .. 18.33  rgb(42,47,56)
css 18.33 .. 18.67  rgb(34,37,45)
```

`top-[6px]` with no translate gives 6.0..7.0 and a crisp line. The grab pill
itself is correctly centred (handle 646.33..649.67 in a divider of 642..654).

### F-10 · P3 · The console's top rule is covered by the Run button → eng-terminal
**Region** `1280-console-divider-seam` · `.console-panel`

`.console-panel` draws `box-shadow: inset 0 1px 0 0 var(--border-subtle)`. Run is
44px tall in a 44px header at the panel's top edge, and a child's background
paints over an inset shadow — so the rule is interrupted for the button's 104px.
Low severity only because the resize handle's own hairline 6px above it reads as
the real separator; if F-09 is fixed and this is not, there will be one crisp
rule and one broken one 6px apart.

### F-11 · P3 · Tab lead-in and trail-out are optically unequal → eng-tailwind / eng-pixel
**Region** `1280-tab-active`

The badge starts 12px from the tab's left edge; the close glyph ends 19px from
its right, because the 44px close slot is pulled back into the padding with
`-mr-2`. Consistent across all tabs, so it reads as weight rather than as a
mistake — noted rather than filed.

---

## Checked and clean

Recording these so the next pass does not re-open them.

- **Console header, 320px to 1280px.** `scrollWidth === clientWidth` at 1280,
  900, 768, 430, 390, 360 and 320, `documentElement` overflow 0, no control past
  the viewport at any of them. A light fragment at css 389.33 in
  `390-console-header.png` is sub-pixel antialiasing, not a clipped control.
- **The console's 2px left inset** (panel content at x=290 against the editor's
  288) is `border-left: var(--rail) solid transparent` — the reserved amber
  leading edge, coloured only while a program runs. By design.
- **Status bar item spacing.** All six gaps in the right group measure exactly
  8px; left inset 8px, right inset 8px; both groups' centres on the bar's centre
  at y=887.
- **Overflow menu.** 44px rows throughout, 4px padding plus a 1px border top and
  bottom, separators evenly inset. Symmetric — an asymmetry I thought I saw at
  3x was not there.
- **Explorer row internals.** chevron → badge → label → ⋯ gaps all 8px; the
  label takes every pixel available (`122..231` against a ⋯ slot at `239..283`).
  The 44px ⋯ slot is reserved when idle, so long names ellipsize 44px early —
  the same anti-shift trade the tab strip makes.
- **Tab-to-tab dividers** are 1px, and one, everywhere except F-04.
- **Welcome lockup.** The Arabic wordmark's centre is 783.995 against a lockup
  centre of 784. Cards are equal boxes (221.33 x 166.09) with a 12px gap
  (`--sp-3`).
- **Console resize grab pill** is centred in its track (see F-09).
- **Editor gutter.** Line numbers right-aligned, baselines matched to the code,
  active-line gutter box the same height as the line.

---

## What the harness does not cover yet

- Junction crops record no geometry unless given an explicit `probe`, so
  `1280-tab-editor-seam` and friends are images only.
- The progress block is caught by racing a `[data-phase]` selector against the
  engine download; on a warm cache it can be missed. Re-run with
  `WARSHA_ONLY=progress` if the crop is absent.
- `1280-toast`, `1280-dialog-input` and `1280-dialog-dropzone` did not resolve on
  the last run — the toast needs a Copy that lands while output exists, and the
  import dialog's field selectors need revisiting once ui-primitives settles.
- Light theme, and the Java project's icons and error states, were out of scope
  for this pass.
