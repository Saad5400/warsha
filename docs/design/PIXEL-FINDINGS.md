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
| P0 — founder ruling | 1 | 1 | — | — |
| P1 — visible break in a surface | 6 | 5 | 1 | — |
| P2 — measurable misalignment | 5 | 4 | 1 | — |
| P3 — minor / sub-pixel | 3 | 1 | 2 | — |
| Checked, clean | 9 | — | — | 9 |

The founder's four reported defects: **one reproduced** (activity-bar icon
borders), **one reproduced with a different cause than it appeared to have**
(the amber sliver), **one reproduced and fixed in this pass** (logo/EXPLORER
alignment, F-07 below — superseded by the P0 ruling), and **one did not
reproduce** (the Run button overflowing the title bar) — see F-01.

---

## P0 · Founder ruling, 2026-08-02 (LAYOUT-VSCODE §1b): no logo, no wordmark in the title bar

VSCode puts no brand above its explorer, so `TopBar.tsx` no longer renders
`Logo` or the "Warsha" wordmark — see `git log` on `app/src/components/TopBar.tsx`
for the diff. Brand now appears in exactly one place in the running app: the
welcome panel's lockup (`1280-welcome-lockup.png`, mark + Latin wordmark only —
the Arabic line was already removed in brand v2, so `lockupAr` and the
`1280-welcome-lockup-ar` crop are gone from `pixel-crops.mjs` along with the
selectors that pointed at the removed mark: `S.logo`, `S.wordmark`).

**What replaces it is conditional, not a straight swap.** The naive read of the
ruling — "put the project switcher where the logo was" — creates a new defect:
docked at ≥900px the sidebar's own project row is already on screen two rows
below, and the same project name twice, 50px apart, reads as a duplicate
control rather than two controls. So `TopBar`'s leading segment is:

- **docked (≥900px, explorer open)** → empty. `TopBar.tsx`'s `SIDEBAR_COLUMN`
  reserves the sidebar's width as a bare spacer, purely so the divider after it
  still lands on the sidebar/editor boundary (see F-07's third check below) —
  it carries no content.
- **collapsed (≥900px, explorer toggled off)** → the project switcher
  (`ProjectSwitcher variant="title"`), because with no docked sidebar there is
  nowhere else for it.
- **phone (<900px)** → neither, unchanged from before the ruling: the bar is
  hamburger + file + ⋯, and the drawer's sidebar header carries the project one
  tap away.

Verified live (`tools/qa/spacing.mjs`, `WARSHA_URL=http://127.0.0.1:8101`):

```
alignment: {"panelLabel":60,"sidebarProject":60,"treeRow":60,"sidebarRight":288,
            "sep":288,"tabStrip":288,"titleProjects":0}
PASS  7. GRID — EXPLORER label, project row and tree rows share a left grid line
PASS  7. GRID — no wordmark and no duplicate project name in the title bar (§1b)
PASS  7. GRID — title-bar divider lands on the sidebar/editor boundary
```

`titleProjects` is a count of `.top-bar [aria-label^="Project:"]` — zero,
confirmed, in the docked state the ledger above worried about. Crops:
`1280-titlebar-full.png` (bare left edge, "main.py" then Run/⋯ at the far
right), `390-titlebar.png` (hamburger, "main.py", ⋯ — never had a logo to
begin with on phone, unaffected), `1280-corner-topleft.png` (rail icons and
EXPLORER now the only ink in that corner).

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

### F-07 · P2 · Three different left insets down the same column · fixed
**Region** `1280-sidebar-header`, `1280-sidebar-project-row`, `1280-explorer-row-active`, `1280-corner-topleft`

The title bar and the sidebar occupy the same column (both start at x=48), so
their contents are read against each other. Originally they did not agree, and
neither did the sidebar with itself:

| Element | Left edge (before) | Inset from x=48 |
| --- | --- | --- |
| Warsha mark (title bar) | 52 | 4px |
| EXPLORER label | 60 | 12px |
| Project row content (`padding-left: 8px`) | 56 | 8px |
| Tree rows (`padding-left: 12px`) | 60 | 12px |

This was the founder's "cramped logo/EXPLORER alignment": 4 against 12, 8px of
rag over a 44px vertical distance — filed here for ui-layout to settle on one
value. The P0 title-bar ruling (above) removed the mark entirely and put the
project switcher on the same grid instead, so the fix landed as a byproduct of
that work rather than as a separate pass:

**Fix** `Explorer.tsx`'s `PROJECT_ROW` moved its 8px inset from `pl-2` (on top
of the row's own 4px) to just the row's `p-1`, since the project button inside
already carries 8px of its own padding — 4+8 lands its ink at the same x as the
label 4+8 gives the EXPLORER header. `TopBar.tsx`'s `BAR` dropped its ≥900px
leading padding from `--sp-3` (12px) to `--sp-1` (4px) for the same reason: the
project switcher that now occupies that segment (when the sidebar is
collapsed) carries its own 8px button padding, so 4+8 matches too.

**After**, measured live (`spacing.mjs`, see the P0 section above for the full
output): `panelLabel`, `sidebarProject` and `treeRow` are all **x=60**. One
grid line, three rows, confirmed by getBoundingClientRect rather than by eye.

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

### F-13 · Two test-harness bugs found while re-verifying this pass, fixed in the harness (not the app)

Neither is an app defect — both are the QA scripts asserting against a shape
that moved out from under them.

**`audit.mjs` check 1a** compared `border-bottom-width`/`border-bottom-color` on
the active tab, which has been `0px`/transparent since F-03 (above) moved the
2px accent rule to an inset `box-shadow` — the check was never updated after
that fix landed, so it was failing on a tab that is actually correct. Now reads
`box-shadow` instead, matching Chrome's serialised order (`color offset-x
offset-y blur spread inset`, the reverse of the Tailwind arbitrary-value source
order): `rgb(242, 169, 75) 0px -2px 0px 0px inset`.

**`overlap.mjs`**'s two `getByRole('button', { name: 'Files' })` locators (the
hamburger) had no `exact: true`, unlike every other role lookup in the file. The
moment the welcome panel is also on screen, Playwright's default substring
match also picks up a template card's file-count line ("3 files · …", "2
files · main.py" — §7.7 of the spec) because it contains "files", and `.click()`
then throws a strict-mode violation on "resolved to 3 elements" instead of
clicking the real hamburger. Both call sites now pass `exact: true`.

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

### F-05 · P1 · The activity bar's right divider has a 48px hole at the active icon · fixed
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

### F-06 · P1 · The amber active rail starts 4px below the top of the screen · fixed
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

**Both fixed** in `ActivityBar.tsx`: `RAIL` lost its `padding: 4px 0 0`, so the
first button is flush with the top of the screen and its accent rule reads as an
edge marker rather than a floating chip; and `SLOT` lost the
`data-[state=active]:bg-surface-2` fill, which is what had been painting over the
rail's inset-shadow divider for the active button's 48px (F-05). The comparison
in F-06's last paragraph no longer exists to be got wrong — §1b removed the mark.

**But the F-05 fix silently disabled the indicator it left behind — see F-14.**


### F-08 · P2 · Indent guides vanish on hover · fixed
**Region** `1280-explorer-row-nested`, `1280-explorer-guides`, `1280-explorer-row-hover`

At rest the guide was there and very quiet — 1px of `rgb(39,44,52)` at x=71
against `--surface-2` `rgb(31,35,42)`, a channel delta of ~8. On a hovered row
the fill lifts to `rgb(38,43,51)` and the delta dropped to **~1**: the guide was
gone exactly while the pointer was on the row it belongs to.

**Fix** `index.css` — `.tree-row__guide` takes `--border-subtle` instead of
`--code-indent-guide`. The two options were "lift the guide with the row" or
"give it a colour that clears the hover fill", and only the second one works: a
per-state colour lights the hovered row's 44px and leaves the rest of the line
dim, which turns one continuous rule into a segmented one — a worse artefact
than the one being fixed. The editor's guides keep `--code-indent-guide`, since
they only ever sit on a single fill.

**After**, measured on `helpers/shapes.py` at rest and hovered:

```
rest    guide rgb(42,47,56)  over --surface-2 rgb(31,35,42)   delta 11,12,14   (was 8)
hover   guide rgb(42,47,56)  over            rgb(38,43,51)    delta  4, 4, 5   (was 1)
```

### F-14 · P1 · The activity bar's active accent rule is 2px in the cascade and 0px on screen
**Region** `1280-activitybar-explorer`, `1280-activitybar-search`, `1280-corner-topleft`

Found while re-shooting F-05/F-06 to confirm them fixed. The rail's active
section had no marker at all — brighter ink and nothing else, which is a
principle-2 break (a state may never be signalled by colour alone) on the one
control that says which panel you are looking at.

The computed style is the whole story, and it is a liar's answer:

```
active   border = 0px solid rgb(232,235,240) … rgb(242,169,75)
                  ^ width                        ^ left colour: --accent, correct
```

The amber is right there in the cascade, applied to a border that is **0px
wide**. `SLOT` asked for the width with `border-l-[var(--rail)]`, and on a
`border-l-` utility an arbitrary value of unknown type is read as a COLOUR, so
Tailwind emitted `border-left-color: var(--rail)` — promptly overridden by
`data-[state=active]:border-l-accent` — and never emitted a width at all. The
previous spelling, `border-l-rail`, fails the same way for the same reason: v4
has no border-width theme namespace, so the name resolves against the colour
one. Two spellings, both plausible, both silently nothing — this is ARCHITECTURE
§4.1's bug class with a third member.

**Fix** `ActivityBar.tsx` — `border-l-[length:var(--rail)]`. The data-type hint
is the only form that survives; everywhere else in the app the rule is a literal
(`border-l-[3px]`), which is unambiguous and needs no hint.

**After**:

```
active     border = 0px 0px 0px 2px solid … rgb(242,169,75)     <- 2px, amber
inactive   border = 0px 0px 0px 2px solid … rgba(0,0,0,0)       <- 2px, reserved
```

The inactive slots reserve the same 2px, so the glyph does not shift when a
section becomes active. Crops: `crops/1280-corner-topleft.png` (no rule) →
`crops-after/1280-corner-topleft.png` (the amber edge marker, flush to the top
of the screen).

### F-12 · P1 · Console header's Run button had zero vertical clearance in its 44px bar · fixed
**Region** `1280-console-header-left`, `1280-console-header` · **Owner** ui-finish2 (Console zone, vacant since the outage)

`spacing.mjs`'s BARS check, before this fix:

```
FAIL  6. BARS — console header / Run :: bar 44 control 44 clearance 0/0 border-bottom 0 inset-shadow true
```

The exact class of defect the title bar was fixed for (`TopBar.tsx`'s own
comment): a 44px Run button flush in a 44px header, its 10px radius running
straight into the header's divider. `RunBar.tsx`'s `HEADER` already carried a
comment explaining the 44px choice was a deliberate compromise with the bar's
height rather than the button growing to spec's 48px — the header just never
grew to give that 44px button room the way the title bar's did.

**Fix** `index.css` — `--bar-console` (44px, `tokens.css`) now gets the same
`calc(var(--touch) + var(--sp-1) + var(--sp-1))` override `--bar-title` already
had, in the same `@media (min-width: 900px)` block, so `h-bar-console` on
`RunBar.tsx`'s header picks it up with no component change. Scoped to ≥900px
only, unlike the title bar: this Run button is on screen at *every* width
(the title bar's copy of it is ≥900px-only), and a phone console has no
vertical budget to give it — §4.3 rule 4's 144px floor is "the single most
important number" in that section, and `--console-floor` derives from
`--bar-console` so it absorbs the extra 8px automatically at the widths where
it's free.

**After**: `bar 52 control 44 clearance 4/4 border-bottom 0 inset-shadow true`.
`spacing.mjs`: 11/11.

### F-09 · P3 · Console resize handle's hairline lands on a half pixel · fixed
**Region** `1280-console-divider` · `components/ConsoleDivider.tsx` · **Owner** ui-finish2 (Console zone, vacant since the outage)

`absolute inset-x-0 top-1/2 h-px -translate-y-1/2` inside an `h-3` (12px) box
puts a 1px line at css 5.5..6.5 — straddling a device-pixel boundary, so at 3x
it renders as ~1.33px of soft grey instead of a crisp rule:

```
css 17.33 .. 17.67  rgb(34,37,45)
css 17.67 .. 18.33  rgb(42,47,56)
css 18.33 .. 18.67  rgb(34,37,45)
```

**Fix** `top-[6px]` with no translate, exactly the fix this finding already
named. Gives 6.0..7.0 and a crisp line. The grab pill itself was already
correctly centred (handle 646.33..649.67 in a divider of 642..654) and is
unaffected.

### F-10 · P3 · The console's top rule is covered by the Run button → console owner (still open)
**Region** `1280-console-divider-seam` · `.console-panel`

`.console-panel` draws `box-shadow: inset 0 1px 0 0 var(--border-subtle)`. The
console header sits at the panel's top edge with its own opaque `bg-surface-2`
fill spanning the header's full width — not just Run's 104px, on closer
reading — and a child's background paints over a parent's inset shadow, so the
rule is interrupted for the header's whole width, at every viewport.

**Why this is lower priority at ≥900px, and NOT at every width.** At ≥900px the
resize handle (F-09, now crisp) sits directly above this seam and reads as the
real separator, so the covered rule costs nothing there. **Below 900px there is
no resize handle at all**, and the editor/console boundary is then marked only
by the surface-1→surface-2 tone change — which DESIGN-SPEC principle 2 is
explicit is "invisible on a phone in daylight" and exists to be backed by a
rule, not relied on alone. So on phone this is a real, if minor, gap against
principle 2, not just a cosmetic nicety. Left open rather than patched under
time pressure: the header cannot simply take its own top inset-shadow, because
on phone the header is still 44px around a 44px Run (F-12's fix is ≥900px-only
by design, for the vertical-budget reason above), so a top shadow there would
just be covered by Run in turn. A real fix needs the rule to live on the
*editor's* bottom edge instead, where nothing paints over it — untried here.

### F-15 · P2 · The console panel had three different left insets · partially fixed
**Region** `1280-console-header-left`, `1280-console-row-stdout`, `1280-console-foot` · **Owner** ui-finish2 (Console zone)

The founder named "console spacing" as a hot area, and this was what was in it.
The panel starts at x=290 and the three things stacked inside it each began
somewhere else:

| Element | Box | Inset (before) | Ink started at |
| --- | --- | --- | --- |
| Console header controls | x=290 | `padding: 0 8px` | 298 |
| Status foot text (`.console-status`) | x=290 | `padding: 4px 16px` | 306 |
| Transcript row text (`[data-kind]`) | x=298 | 3px rule + `padding-left: 8px` | 309 |

**Fix** `Console.tsx`'s `StatusLine` now carries an extra `px-2` on top of the
bare `console-status` hook, landing in `@layer utilities` — which outranks the
`@layer components` rule that sets `padding: 4px 16px` regardless of source
order — so it wins without touching `index.css` (held for `ui-theme` while
this landed). Foot ink moved from 306 to **298**, matching the header exactly.

Left as is, and this is the "partially": the transcript row's 309 is the §7.3
leading rule (3px) plus the row's own 8px padding, both load-bearing (the rule
is the stdout/stderr/echo signal principle 2 requires; the padding is shared by
every row kind). This is the same shape as F-07's tree-row exception — a
reserved accent border that has to be subtracted before comparing ink, not
zeroed out — so 309 stays as a documented, structural offset from the header/foot's
298 rather than a mistake to chase further.

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
