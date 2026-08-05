# Density: one VS Code shell, pointer-adaptive metrics

Two founder rulings, same day (2026-08-05), and the second reframes the first:

1. **Morning:** 44px rows, 44px tabs and pill-radius buttons on a desktop read
   as "child play", not a professional IDE. Fine-pointer layouts compact to
   VSCode-grade metrics.
2. **Later — the unification ruling:** *"why is mobile different?? I want it
   same, just slight adjustments over the vscode desktop layout for better ui
   ux."* There is **ONE layout**: the VS Code desktop shell — activity bar,
   menu bar, title, tab strip with its trailing Run corner, breadcrumbs,
   explorer pane header, panel header, status bar — at **every** size and
   pointer. Nothing about the chrome's *structure* forks on width or pointer
   any more.

So this document no longer describes two layouts (it used to: a touch-first
chrome vs a compact desk). It describes one layout and the **density tokens**
that retune it: touch devices get the same furniture with bigger hit targets
and a handful of interaction adjustments; fine-pointer desktops get VSCode's
own compact metrics. DESIGN-SPEC §5.2's touch rules still bind — as *metrics*
on coarse pointers, never as license for different furniture.

## The one condition

```css
@media (min-width: 900px) and (hover: hover) and (pointer: fine)
```

Defined twice, deliberately in step (index.css): once as the DENSITY `:root`
token block, once as the `desk:` Tailwind variant. An iPad by finger is coarse
and never matches; an iPad with a trackpad still reports a coarse primary
pointer and never matches; the QA harness (headless desktop Chrome) matches at
≥900px viewports and not at 390px, which is how one suite exercises both.

## What forks (token values, touch → fine-pointer)

`index.css`'s DENSITY block is the authority; this table mirrors it.

| Token | touch | fine | carries |
| --- | --- | --- | --- |
| `--touch` | 44 | 28 | the minimum EFFECTIVE hit area, and still the visual box of menu rows, completion rows, the stdin line and the console-floor term. Since the 2026-08-05 scale-down it is **no longer** every control's visual box — shrunk controls restore 44 via the `after:` hit-area pseudo (ui/Button.tsx) or a full-width row |
| `--touch-lg` | 48 | 32 | primary dialog actions |
| `--icon-btn` | 36 *(was 40)* | 28 | icon-only buttons — `after:-inset-1` makes 36 exactly 44 effective, so the inset may not shrink |
| `--run-h` / `--run-minw` | 36 *(was 40)* / 104 | 28 / 84 | Run/Stop (tab-strip corner) and panel-toolbar buttons; same pseudo, 44 effective |
| `--tab-close` | 40 | 20 | the tab's close/dirty slot (VSCode's own 20 on desk). Deliberately NOT shrunk with the bar: the × has no hit-area pseudo (tabs stack flush), so the slot is the target — it now fills the 40px strip |
| `--bar-tabs` / `--bar-side` / `--bar-title` / `--bar-console` | 40 (`--bar-top`, *was 44*) | 35 | tab strip, sidebar header, title bar, panel header — all VSCode's 35 on desk. There is deliberately **no** ≥900px 52px override on title or console any more; it existed only to clear the filled Run, and Run's one home is now the tab strip's trailing group |
| `--bar-crumbs` | 28 | 22 | breadcrumbs row (VSCode's own 22; 28 on touch because it holds no tap targets yet — must grow the day segments become pickers) |
| `--bar-status` | 24 *(was 30)* | 22 | status bar (VSCode's own 22) — renders at every width; only an open software keyboard hides it. 24 sits exactly on WCAG 2.2 AA's pointer minimum; every status item keeps a 44px home elsewhere |
| `--row-tree` | 36 *(was 44)* | 22 | explorer rows and the pane-header row. VISUAL height — the tap target is the full-width row itself |
| `--pane-action` | 36 (`--row-tree`, *was 44*) | 22 | pane-header action boxes (defined on `.sidebar-project-row`, read via inline style); their `after:content-none` stands, so 36 is their effective target |
| `--tree-indent` | 16 | 8 | per-level tree indent |
| `--explorer-w` | 240 | 300 | sidebar width (VSCode's default 300) |
| `--lh-console` | 1.5 | 1.36 | console line-height (the `--console-line` floor calc derives and follows) |
| `--fs-row` / `--fs-btn` | 14/14 *(btn was 15)* | 13/13 | UI type (VSCode is 13px) |
| `--fs-input` | 16 | 14 | the 16px iOS zoom floor is a touch-device rule |
| `--fs-code` / editor default | 14 *(was 15)* | 14 | not density-forked any more: 14 is VS Code's own editor default at both densities (`fs/prefs.ts` `defaultFontSize`; `--fs-code` in tokens.css tracks it) |

Not in the DENSITY fork but rescaled in the same pass (both densities):
`--fs-dlg-title` 17 → 16. `--touch-kb` is now `var(--icon-btn)` — the old
literal 40 would have GROWN a 36px icon button on keyboard-open — and
`--bar-top-kb` 40 now equals the resting `--bar-top`, making §4.3 rule 3's
kb compaction a structural no-op that is kept only as a token contract.

Radii are **not** density-forked: `--r-sm/md/lg` = 2/5/6 (Dark Modern) at all
densities.

## Adjustments that are NOT structure

The founder ruling allows "slight adjustments" on touch/small screens. The
sanctioned list — everything else renders identically:

- **Sidebar overlays instead of docking below 900px** (the `.drawer`
  transform + scrim; `aside[aria-label="Files"]` either way). The activity
  bar's Explorer item, the title-bar toggle, View > Toggle Explorer and Mod+B
  all drive it at every width.
- **Menu bar collapses to one ☰** (`aria-label="Application Menu"`) below
  1050px — VS Code's own behavior, width-based, not a touch fork.
- **Hover-reveal etiquette stands down on touch**: the tab close × is always
  visible on touch, hover/focus-revealed on desk; the pane-header action trio
  likewise. CSS-only (`desk:` / `:hover` rules) — the elements exist at every
  size.
- **The console divider** renders at every width with one persisted px
  height; touch keeps the visible grip-bar handle, desk dresses it down to
  VS Code's invisible sash.
- **Keyboard-open compaction** (`html[data-kb]`): grid compaction below
  900px, the status bar yields to the panel header's kb-open-only StatusPill,
  the window title hides (`kb-hide`).
- Safe-area `env()` paddings and the `--app-h` viewport plumbing.
- Run/Stop handedness mirroring (View menu: "Run Button on Left/Right").

Not density-gated at all: folder-row twisties, the Dark+ syntax palette
(editor/setup.ts `syntaxColors`), the quieter success toast.

## QA

Floors in tools/qa fork on the same media, read live via `matchMedia`, and the
console floor is derived from `--touch` + the measured header. Touch
obligations are still asserted where they bind: audit's 390px section,
files-touch (Pixel 7 emulation), console-kb — but they now assert the SAME
shell at bigger metrics, not a different one. WCAG 2.2 AA's 24px pointer floor
is the compact hard minimum; nothing interactive goes below 28px except the
20px tab-close slot and the 22px pane-header action boxes, both riding inside
a row that is itself the pointer target's context.

**Touch floors after the 2026-08-05 scale-down** — any QA assertion that read
"44 visual" must now read "44 EFFECTIVE": icon/run buttons are 36 visual +
`after:-inset-1` = 44; tree rows are 36-tall full-width targets; the status
bar is 24 (interactive items 24-tall, on the WCAG minimum, 44px homes
elsewhere); the pane-header trio and the per-row ⋯ are 36 effective (their
`after:content-none` overrides stand — flush neighbours). These last two plus
the always-visible 40px tab-close × are the only touch targets under 44
effective.

## Addendum: shell unification (founder ruling, 2026-08-05)

Recorded for history: before this ruling, this file's "Structural forks"
section blessed fine-pointer-only furniture (a dressed-down console header,
desk-only breadcrumbs and pane header, a touch-only project row and status
pill stand-down). All of that is repealed — those pieces render at every size
now, and the deleted touch-side structures (the ProjectSwitcher row, the
console status foot, the touch top-bar overflow ⋯, the touch segmented
console toggle) are gone, not hidden. The *model* of the morning's density
ruling survives intact: one media condition, token values fork, structure
does not.

## Addendum: the scale-down (founder ruling, 2026-08-05, live phone testing)

*"Everything feels really zoomed in and quite large… the sidebar is nice but
more compact is better, plus scaling down stuff in general for both desktop
and mobile."* Third ruling of the day. What it changed here:

- **Touch shrinks toward desk, hit areas do not.** 44px stops being a visual
  box and becomes what it always claimed to be: an *effective-target* floor,
  met by the `after:` pseudo recipe or by full-width rows. All before→after
  values are in the table above.
- **Desk was audited against real VS Code and left alone**: 13px UI type,
  22px rows/status bar, 35px tabs, 14px editor — already VS Code's own
  numbers, and the ruling's "scaling down in general" must not undershoot
  them. The two desk-visible reductions are the shared tokens
  `--fs-dlg-title` 17→16 and the editor-default unification at 14.
- The view-scale slider the founder asked for is a separate package (App
  chrome), not a density token — density is pointer-adaptive, the slider is
  student preference on top.
