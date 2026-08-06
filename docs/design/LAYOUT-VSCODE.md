# Layout addendum: VSCode-familiar, by founder ruling (2026-08-01)

This addendum OVERRIDES DESIGN-SPEC.md wherever they conflict. The original
brief said "VSCode-inspired, not a pixel clone"; the founder's verdict on the
result: consistent but unfamiliar. **Familiarity is the feature.** A student
who has watched any programming tutorial expects VSCode's furniture in
VSCode's places. We keep our tokens, type scale, and touch rules — we adopt
VSCode's floor plan.

## The floor plan (desktop / tablet ≥900px)

```
┌──┬────────────────────────────────────────────────┐
│AB│ Title bar: logo · (project name ▾)      Run ▶  │
│  ├──────────────┬─────────────────────────────────┤
│  │ EXPLORER     │ tabs                             │
│  │ <project> ▾  ├─────────────────────────────────┤
│  │  file tree   │ editor                           │
│  │              ├─────────────────────────────────┤
│  │              │ console (resizable)              │
├──┴──────────────┴─────────────────────────────────┤
│ status bar                                         │
└────────────────────────────────────────────────────┘
```

1. **Activity bar** (far left, 48px, icon-only): Explorer toggle now;
   Search/Settings are future slots. On <900px it disappears — the drawer
   pattern already covers it.
1b. **No logo, no app name in the title bar** (founder ruling, 2026-08-02):
   VSCode does not put a wordmark above the explorer, so neither do we. The
   top-left of the title bar is empty (or holds the project name); the brand
   appears only on the welcome panel, the favicon, and the OG image. This
   overrides the "logo · (project name ▾)" sketch above.
2. **Sidebar header like VSCode's**: the word EXPLORER (11px caps, text-3),
   below it a **project row: current project name + chevron** — clicking opens
   the project switcher (switch / new / new-from-template / rename / delete /
   export zip). THIS REPLACES the right-side "⋯" overflow as the home of
   project actions. The overflow menu keeps only app-level odds and ends
   (import zip, about, font size).
3. **Status bar** (bottom, full width, 24-28px, surface-0, always visible on
   ≥900px; on phones it collapses into the console status line which already
   exists): left → engine/run state + exit code (mirrors console status pill);
   right → active file language ("Java 17" / "Python 3.14"), entry file name,
   cursor Ln:Col, font-size stepper. Colors stay OUR tokens — no VSCode blue.
4. **Run button**: top-right of the title bar (VSCode's play-button position),
   in ADDITION to remaining reachable near the console on touch layouts —
   reachability rules from DESIGN-SPEC §5 still bind.
5. Tabs, editor, resizable console: unchanged placement (already VSCode-like).

## Primitives refactor (same sprint)

Replace hand-rolled Dialog/Menu/Toast with Radix-based shadcn-style
components (copied into src/components/ui/, not a dependency on a kit):
radix-ui react-dialog, react-dropdown-menu, react-context-menu,
react-tooltip, plus sonner-style toasts. Styled exclusively from tokens.css
variables; animations 120-180ms enter / 90ms exit, respecting
prefers-reduced-motion (the global block already exists). The testing
contract (aria-labels, data-attributes, exact button names documented in
ARCHITECTURE.md §4) MUST survive: Radix renders portals — keep the
aria-labels and roles identical.

## What does NOT change

Tokens, type scale, 44px touch rules, keyboard-inset behavior (§4), the
console UX, the amber accent discipline, greyscale-readability requirements,
and every QA contract selector. The suites in tools/qa are the definition of
"didn't break it".

## Parity pass addendum (founder mandate, 2026-08-05)

The Dark Modern / VS Code-parity waves (THEME-V4, DENSITY.md) finish the job
this addendum started, and update its model where the two disagree. Colour
first: **the "no VSCode blue" line in §3 and the "amber accent discipline"
above are superseded** — THEME-V4 makes `--accent` #0078D4, VS Code's own
blue, with `--accent-ink` #FFFFFF. Everything below is desk-only (the DENSITY
media: ≥900px + hover + fine pointer); touch layouts are untouched.

### Full-width title bar (revises §1b/§4)

The title bar spans BOTH grid columns — it runs *over* the activity rail,
which starts underneath it (VS Code's own stacking). 35px tall at desk.
Composition, left to right: the **menu bar**, the **centred window title**
`● file — project — Warsha` (absolute against the bar so it centres on the
window, not the leftover space; ● is the unsaved marker), and the view-toggle
icon squares on the right. **Run left this bar for the tab strip's trailing
actions** — that relocation is what makes 35px possible. §4's "Run top-right
of the title bar" is superseded at desk; the touch reachability rule stands.

### Menu bar (new)

File / Edit / View / Run / Help, mapped to existing app actions — no dead
menus. 13px titles in `--titlebar-fg`, hover fill `--toolbar-hover-bg`, open
dropdowns with full-row `--menu-sel-bg` selection. Roving tabindex;
ArrowLeft/Right walk between open menus; no Alt-mnemonics (browser
conflicts — VS Code web skips them too). On a narrow desk window it collapses
to one ☰ trigger; on touch it does not exist (the drawer ☰ is `Files`).
Contract handle: `aria-label="Application Menu"` (ARCHITECTURE §4).
Project switching moved here: **File > Open Recent** plus the welcome panel's
Recent section replace the title-bar project button at desk; the sidebar
switcher survives touch-only.

### Pane header (revises §2)

At desk the §2 "project row" becomes VS Code's pane header: a 22px row
(`--row-tree`) — collapse twistie, the project folder's name as a bold 11px
label, and the tree actions (new file / new folder / etc.) riding the right
edge, hidden until the row is hovered or one of them holds focus. The twistie
is a real section collapse (hides the tree). Keeps the `sidebar-project-row`
QA hook. The EXPLORER caps label stays above it. Touch keeps the 52px project
row and `projectSlot` unchanged.

### Breadcrumbs row (new)

VS Code's path trail: a 22px row between the tab strip and the editor,
tracking the active tab's path. Desk-only, static v1 (display, not
navigation — yet). Handles: `.breadcrumbs`, `aria-label="Breadcrumbs"`.

### Sash (revises the console divider)

At desk the console drag handle dresses down to VS Code's sash: a 0-height
boundary owning no layout space, with a ±4px hit band and a 4px face that
fills `--sash-hover` (the accent) after VS Code's ~300ms hover linger, or
instantly while dragging. The touch layouts keep today's visible grip-bar
handle — a sash you cannot see is a fine-pointer-only move.

## One-shell addendum (founder ruling, 2026-08-05)

*"why is mobile different?? I want it same, just slight adjustments over the
vscode desktop layout for better ui ux."*

This ruling OVERRIDES every width- or pointer-scoping above (and DENSITY.md's
old two-layout philosophy). The parity-pass floor plan is no longer
"desktop / tablet ≥900px" — it is the ONLY floor plan, at every size and
pointer. Where earlier sections say "desk-only", "touch keeps X" or "on
phones it collapses", read this list instead:

- **Activity bar renders at all widths.** §1's "on <900px it disappears" is
  dead; below 900px its Explorer item drives the sidebar as an overlay drawer
  (the one structural adjustment: overlay vs docked, same `aside`).
- **Title bar is one composition everywhere**: menu bar leading, centred
  `● file — project — Warsha` window title (hidden while the software
  keyboard compacts the bar), sidebar/panel toggles + install control
  trailing. The touch "Files" hamburger, the touch file-title composition and
  the touch "⋯" overflow are deleted.
- **Menu bar exists at every size.** "On touch it does not exist" is dead;
  the <1050px collapse to ☰ `aria-label="Application Menu"` is what phones
  get — width-based, VS Code's own behavior.
- **Project actions live in the menu bar's File menu at every size** (New
  File / New Project / Open Recent / Import / Export / Save All / Rename /
  Empty / Delete). `ProjectSwitcher` is deleted; §2's sidebar project row is
  now the pane header at all sizes (bold project label + New file / New
  folder / Collapse trio, hover-revealed on desk, always visible on touch).
- **Run has one home**: the tab strip's trailing editor-actions corner, at
  every size and pointer. It is gone from the title bar AND from the console
  header; §4's touch-reachability placement is repealed.
- **Status bar renders at all widths** (30px touch / 22px desk). §3's "on
  phones it collapses into the console status line" is dead — the console
  status foot no longer exists; while the software keyboard hides the bar,
  the panel header shows the same StatusPill.
- **Breadcrumbs render at all widths** (`--bar-crumbs`: 28px touch / 22px
  desk), no longer desk-only.
- **The console panel header is one VS Code panel toolbar everywhere**:
  PREVIEW/CONSOLE caps tabs leading; entry picker, Copy, Clear,
  Maximize/Restore and collapse trailing. The touch labelled buttons and
  segmented toggle are deleted.
- **The sash/divider renders at every width** with one persisted height;
  the visible grip handle on touch vs the invisible sash on desk is a
  sanctioned adjustment, not a fork.

What "slight adjustments" means — the full sanctioned list, and the token
metrics themselves — is DENSITY.md's job now; structure never forks.
