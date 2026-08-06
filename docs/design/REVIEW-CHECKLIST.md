# Warsha — Visual / UX Review Checklist

20 checks. Run them against screenshots and two short screen recordings of the built app.

**Capture on a real phone and a real iPad in Chrome** — not a desktop window resized to 390px. The keyboard behaviour, the font resolution, and the safe areas are the three things most likely to be wrong, and none of them reproduce in a desktop viewport.

**Capture set.** Portrait and landscape, both devices:
**A** welcome screen · **B** editor with a file open · **C** console mid-run with stderr present · **D** console with stdin pending **and the keyboard open** · **E** video: first run, cold cache · **F** explorer drawer open · **G** long-press menu · **H** greyscale copies of B, C, D · **I** video: keyboard opened and dismissed five times.

Section references are to `DESIGN-SPEC.md`.

**Note:** written 2026-07-30, before LAYOUT-VSCODE.md's addenda (2026-08-01, 2026-08-05) and DENSITY.md's 2026-08-05 scale-down moved Run/Stop out of the console header and changed touch hit-area metrics. Checks 12, 14 and 15 below have been updated to match; treat LAYOUT-VSCODE.md and DENSITY.md as authoritative over this checklist wherever they conflict.

---

### Colour, and what survives without it

- [ ] **1. Active tab and open file are identifiable in greyscale (H).** Each must carry an accent rule *plus* a weight or text-colour change. If you can only tell by the background fill it fails — our surface steps are 1.07:1 and vanish on a phone in daylight. (§1.2, §7.1, §7.2)
- [ ] **2. stderr separates from stdout at arm's length.** Glance at C from ~60cm: red lines should jump out. Then check H — the 3px red leading rule and the row tint must still separate them with no hue at all. (§7.3)
- [ ] **3. The five run states are distinguishable in greyscale** — Ready, Running, Finished, Failed, Stopped — because each carries a glyph and a word, not just a colour. Confirm "Stopped." is **neutral, not red**: the student did that on purpose. (§7.3)
- [ ] **4. Fills and states are honest.** No white text on an amber fill anywhere (1.99:1 — instant fail); disabled controls change colour rather than fading; nothing important is a faded version of something else. (§2.3, §7.4)
- [ ] **5. Control boundaries are visible.** Dialog inputs, the console input row, and the welcome cards have a discernible edge against their surface — `--border-control`, not an invisible `--border-subtle`. (§2.5)

### Type

- [ ] **6. Code is genuinely monospaced on both devices.** Type `iiii` above `WWWW` in B; the runs must be identical width. Expect SF Mono on iPad, Droid Sans Mono on Android — proportional letterforms on Android mean the stack is being skipped. (§3.1)
- [ ] **7. Code is not silently shrunk, and line numbers track it.** A capital M matches the specified 15px (WebKit renders unqualified `monospace` at ~81.25%, so "a size too small on iPad only" means the explicit `font-size` is missing), and the gutter shows no cumulative drift at the bottom of a long file. (§3.1, §3.3)
- [ ] **8. Nothing below 12px ships, and every focusable input is ≥16px.** (§3.2)

### The keyboard — highest-risk area

- [ ] **9. On iPad with the keyboard up, the console input row is fully visible and the prompt is readable.** In D: the row is not clipped and not behind the keyboard, and three to four lines of output are still on screen. This is the exact failure `100dvh` produces on iOS, and it makes every program that calls `input()` unusable. (§4.1-4.3)
- [ ] **10. Focusing an input does not zoom the page.** Try the console input, the rename field, and a dialog input on iPad. Any zoom means a font-size under 16px. (§3.2)
- [ ] **11. Dismissing the keyboard restores the layout exactly (I).** Five open/close cycles, including one dismissed by tapping *away* rather than Done. No leftover gap at the bottom, no chrome pushed off the top — this is where the iOS `visualViewport.offsetTop` reset bug appears. (§4.2)
- [ ] **12. Run/Stop is never covered by the keyboard.** *(Superseded placement: Run/Stop no longer lives in the console header — LAYOUT-VSCODE.md's One-shell addendum (2026-08-05) gave it one home, the tab strip's trailing corner, at every size and pointer, repealing DESIGN-SPEC §5.3.)* Confirm the tab strip and its trailing Run/Stop control stay visible and unobstructed with the keyboard open, and that the page itself never scrolls horizontally in any capture. (LAYOUT-VSCODE.md One-shell addendum; §4.3)

### iPad text integrity — silent corruption

- [ ] **13. Type a fresh line of code on an iPad using the on-screen keyboard.** The first word must **not** auto-capitalise, `"` must stay a straight quote and not become `"`, and no spell-check underlines may appear in the editor. Any of these means `.cm-content` is missing its `autocapitalize` / `autocorrect` / `spellcheck` attributes — and student code gets corrupted in a way a beginner cannot possibly diagnose. (§3.4)

### Touch and reach

- [ ] **14. Measure the targets.** Explorer rows, tabs, close buttons, panel-toolbar buttons and menu items ≥44px; Run/Stop's *hit area* ≥44px *(DENSITY.md's 2026-08-05 scale-down shrank the visual `--run-h` box to 36px, with the 44px floor delivered only through an `after:` hit-area pseudo-element — never a 48px visual box, superseding DESIGN-SPEC §5.2's 48px call)*; ≥8px between adjacent targets; Delete sits last in the long-press menu (G), separated and red. (DENSITY.md; §5.2)
- [ ] **15. Run is reachable by one thumb with no grip shift** — tablet two-handed in landscape, phone one-handed in portrait. *(Run/Stop's home moved to the tab strip's trailing corner at every size — LAYOUT-VSCODE.md's One-shell addendum — superseding DESIGN-SPEC §5.3's console-header placement.)* Confirm the View menu's "Run Button on Left/Right" (DENSITY.md) mirrors it to the leading edge without rearranging the rest of the tab strip. (LAYOUT-VSCODE.md One-shell addendum; DENSITY.md)
- [ ] **16. Taps feel alive.** Every button and row has a visible press state. A removed tap highlight with no `:active` replacement makes a working app feel dead. (§5.2)

### Running, waiting, failing

- [ ] **17. First run, cold cache (E): something numeric changes at least every 2 seconds.** A static spinner, or a bar with no byte counter, fails — this is the moment a student decides the site is broken. Also: the editor stays scrollable and readable throughout (no modal), and the **second** run shows no download UI at all (if it appears twice, caching is broken). (§7.6)
- [ ] **18. Output behaves under stress.** Console auto-opens on Run; auto-scroll does not yank the view away while you are scrolled up reading a stack trace; a long trace wraps rather than scrolling sideways; and `while True: print(1)` neither freezes the UI nor stops Stop from responding within a second. (§6, §7.3)

### Copy, empty states, chrome

- [ ] **19. Read every string aloud.** No `Error:`, no `Invalid`, no internals (`WASM`, worker names, `SIGKILL`), no blame, no exclamation-mark cheerleading; each message says what happened *and* what to do next. Every empty region has a sentence rather than blank grey (no file open, console never run, empty folder), and the "first run downloads ~38 MB" warning appears on the welcome screen **before** the wait, not only during it. (§7.5, §7.7, §8)
- [ ] **20. Chrome details.** Long names (`StudentEnrollmentController.java`) truncate with an ellipsis in both explorer and tabs without wrapping or pushing the layout; the two welcome cards match `templates.ts` and are each a single large target; the logo is sharp at 24px with a mark-only favicon and never white-on-light; in landscape nothing sits under the notch and Run clears the home indicator; a hardware keyboard shows a visible amber focus ring at every stop with `Cmd/Ctrl+Enter` running the program; and with system "Reduce Motion" on, drawers appear without animating while the running pill stays readable. (§5.4, §7.2, §7.7, §9, §11)
