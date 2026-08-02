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
2. **Sidebar header like VSCode's**: the word EXPLORER (11px caps, text-3),
   below it a **project row: current project name + chevron** — clicking opens
   the project switcher (switch / new / new-from-template / rename / delete /
   export zip). THIS REPLACES the right-side "⋯" overflow as the home of
   project actions. The overflow menu keeps only app-level odds and ends
   (import zip, about, font size).
3. **Status bar** (bottom, full width, 24-28px, surface-0, always visible on
   ≥900px; on phones it collapses into the console status line which already
   exists): left → engine/run state + exit code (mirrors console status pill);
   right → active file language ("Java 8" / "Python 3.14"), entry file name,
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
