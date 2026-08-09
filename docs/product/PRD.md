# Warsha — PRD (MVP, v0.1)

**One line:** a phone or tablet with Chrome is enough to write, run and hand in real multi-file Java and Python homework.

**Shape:** static site, no server, no accounts. CodeMirror 6 editor, CheerpJ for Java, Pyodide for Python, OPFS for persistence, zip for import/export. Runtimes stream stdout/stderr, accept stdin, and can be killed.

**Why it exists:** the blocker for a laptop-less student is not learning to code, it is that every classroom toolchain assumes a desktop. Existing browser IDEs either need a server (Replit-class: accounts, quotas, blocked at school) or only run single-file snippets (no `package models;`, no `Person.java` + `Student.java`). Warsha's whole reason to exist is *multi-file Java OOP with packages, on a phone, offline-capable, with nothing to log into*.

---

## 1. Personas

### P1 — Nouf, 16, shares the family iPad (primary)
Grade-11 CS elective. Homework is "submit your Java project as a zip". Owns no laptop; gets the iPad for ~1 hour after dinner, browser only, cannot install apps (parent's Apple ID). Types with two thumbs on the on-screen keyboard, hates anything that needs `Tab` or `Ctrl`.
- **Needs:** a working OOP project in under a minute, big tap targets, no setup, work survives being kicked off the device mid-task.
- **Fails today because:** every tutorial says "install JDK / IntelliJ".
- **Engine caveat:** Chrome on iPadOS is WebKit. See §7 R1 — this persona is the reason the risk is P0.

### P2 — Omar, 19, CS101, Android phone (390 px) only
University CS101. Has campus Wi-Fi and a 6.1" Android phone; the lab has 20 PCs for 120 students. Needs to finish `Student extends Person` before the 8am deadline, on the bus.
- **Needs:** run + read the exception + fix, in a loop, with the console and the code both visible on a 390 px screen; stdin that works with the on-screen keyboard; must be able to kill his own infinite `while(true)` print loop without losing the file.
- **Data-sensitive:** counts megabytes. The Java engine download must be a one-time cost he is warned about, and must be cached.

### P3 — Ms. Layla, CS teacher, 32 students, no lab budget
Assigns and grades. Cannot ask students to install anything; cannot administer accounts; will not read a manual.
- **Needs:** one URL to put on the board; a starter project she can hand out as a zip that opens correctly in Warsha; submissions arriving as zips she can open in her own IDE with the package folders intact (`app/Main.java`, `models/Person.java`).
- **In v0.1 she is served entirely by zip import/export.** No teacher UI, no dashboards, no accounts (see ROADMAP v1.0).

**Explicit non-persona for v0.1:** the professional developer. No debugger, no IntelliSense, no git — if a laptop user shows up, they should use a real IDE.

---

## 2. User journey — "opens URL" → "hands in a zip"

1. **Opens the URL** (typed off the board, or a QR code). Static page, first paint before any runtime loads. No login wall, no cookie banner, no "create account".
2. **Sees a choice, not an empty editor:** *Java (OOP starter)* / *Python starter* / *Import a .zip*. Each with one line of blurb. This screen is the product's first impression and must fit a 390 px viewport with no scrolling to reach the buttons.
3. **Picks Java (OOP starter).** Project is written to OPFS immediately (`app/Main.java`, `models/Person.java`, `models/Student.java`) and `app/Main.java` opens in the editor. Nothing has downloaded a JVM yet.
4. **Taps Run.** First run shows honest progress ("Loading Java… ~N MB, one time only"). Output streams into the console as it is produced, not at exit.
5. **Program asks for input.** `Scanner` blocks; Warsha focuses the console input line and shows an unmistakable "waiting for input" state. Nouf types `Nouf`, taps Send, sees `Hello, Nouf!`.
6. **Something breaks.** She edits `models/Student.java`, hits Run again — no engine reload this time — and reads the exception in the console. Loop: edit → Run → read. This loop is the product.
7. **Tab dies / iPad is taken away.** She reopens the URL later: the same project, same files, same open file. No dialog, no recovery wizard. OPFS did its job.
8. **Hands in.** Taps Export .zip → `warsha-project.zip` lands in Downloads/Files → she attaches it in the LMS. The zip's internal paths are exactly the project paths, so Ms. Layla can unzip and `javac app/Main.java` on her laptop.
9. **Teacher round-trip.** Ms. Layla's assignment zip → Import a .zip → replaces the project → student works from her scaffold.

Steps 3→5 must be reachable in **under 3 minutes on a first visit, on a phone, over campus Wi-Fi**, including the one-time Java download. That number is the MVP's headline metric.

---

## 3. MVP feature list

### P0 — no MVP without these
| # | Feature | Done means |
|---|---|---|
| F1 | Template picker on first visit | Java-OOP and Python templates create a real multi-file project in OPFS; no blank-editor cold start |
| F2 | Multi-file tree with folders | Create/rename/delete file and folder; nested paths (`models/Person.java`) work; taps, not right-clicks |
| F3 | CodeMirror 6 editor, mobile-usable | Java/Python highlighting, auto-indent, working undo; usable with an on-screen keyboard (see F10) |
| F4 | Java: real multi-file OOP + packages | `package models;` + `import models.Person;` across 3 files compiles and runs from `app/Main.java` |
| F5 | Python: multi-file with local imports | `from helpers.shapes import Circle` resolves |
| F6 | Streaming console (stdout + stderr) | Output appears while running; stderr visually distinct; uncaught exception/traceback readable |
| F7 | Interactive stdin | `Scanner.nextLine()` / `input()` block, prompt visible, input line focused, submitted line echoed |
| F8 | Stop button that always works | Infinite `while(true){print}` killable within ~2 s; editor and files intact; app usable afterwards without reload |
| F9 | OPFS persistence, implicit | Reload/tab-close/reopen restores files, contents, and last open file. No Save button; nothing is ever "unsaved" |
| F10 | Mobile keyboard toolbar | Tap-insert for `Tab`, `{`, `}`, `(`, `)`, `;`, `"`, `[`, `]` — the characters iOS/Android keyboards bury or autocorrect |
| F11 | Zip export | One tap → `.zip` with project-relative paths, opens correctly in a desktop IDE |
| F12 | Zip import | Picks a `.zip`, replaces the project, tolerates a single wrapper folder and strips it |
| F13 | Narrow-screen layout | Usable at 390 px and 768 px: Files / Editor / Console reachable without pinch-zoom or horizontal scroll |
| F14 | Honest first-run loading state | Named engine, approximate size, "one time only", progress that moves |
| F15 | Runtime-unsupported fallback | If the engine cannot start on this browser, one plain-language screen: what failed, what to do (see §7 R1). Never a blank page or a silent spinner |

### P1 — ship if today allows, cut without shame
| # | Feature | Note |
|---|---|---|
| F16 | Entry-point selector ("Run which file?") | Prevents the classic "ran the wrong file" panic; default = template entry |
| F17 | Clear console + copy console output | Students paste errors into WhatsApp to ask for help — this is real behaviour |
| F18 | Multiple projects on one device | Family/shared-iPad case; v0.1 can ship single-project |
| F19 | Font-size control | 10" screens and eyesight |
| F20 | Import a single `.java`/`.py` file | Teachers send loose files, not zips |
| F21 | Offline reload (SW-cached shell + engine) | Big for P2's data budget; risky to rush |

### Deliberately not P0 (would look nice, does not unblock a student today)
Themes, split-pane, tabs bar, search-in-project, format-on-save, autocompletion of any kind.

---

## 4. Non-goals for v1 (say no, on the record)
Debugger. Real LSP / IntelliSense. Shell or terminal. Git. Extension/plugin system. Safari as a *supported* target (see R1 for the difference between supported and functional). Real-time collaboration. Accounts, cloud sync, or any server-side storage. Grading/autograding. Third-party package installation (`pip install`, Maven/Gradle). Anything that requires a build config file.

---

## 5. Success metrics (things a two-person OSS project can actually measure)

The only thing measured automatically is an **anonymous page-visit count** (self-hosted Umami — see [PRIVACY](../legal/PRIVACY.md)): it says how many people opened Warsha, and nothing about what they did once inside. So every metric below is still either measured by hand on real hardware, or observable on GitHub. Anything else is decoration.

**A. Lab metrics — stopwatch, real devices, recorded in `docs/product/measurements.md` each release**
1. **Time-to-first-successful-run (TTFSR)** — URL tap → first line of correct Java output visible, cold cache, on a mid-range Android phone over Wi-Fi. **Target ≤ 180 s; stretch ≤ 90 s.** Warm cache **≤ 20 s.** Single most important number in the project.
2. **Edit→run loop latency** — Run tap → first output line, engine already warm. **Target ≤ 3 s Java, ≤ 1.5 s Python.**
3. **Java engine payload** — bytes over the wire on first run, measured in DevTools Network. **Report it every release; regressions are bugs.**
4. **Kill latency** — Stop tap → process dead, UI responsive. **Target ≤ 2 s, no reload needed.**
5. **10-inch / 390 px pass rate** — % of ACCEPTANCE.md items passing at 390 px and 768 px. **Target 100 % of P0 items.**
6. **Cold-reload survival** — 10 consecutive close/reopen cycles restore the project. **Target 10/10.**
7. **Round-trip fidelity** — export → import → file tree and bytes identical. **Target byte-identical, 3/3 templates.**

**B. Field metrics — one real classroom, one real assignment (the only user research we can afford)**
8. **Unassisted completion:** of N students given only the URL, how many hand in a valid zip without a human intervening. **Target ≥ 80 %.**
9. **Intervention log:** every question a student had to ask, written down. Top-3 becomes the next sprint. Qualitative, and worth more than any dashboard.

**C. Project-health metrics — free, from GitHub**
10. Issues labelled `broken-on-device` open > 14 days: **target 0.**
11. Time from "student reports it doesn't run" to a reproduction on a real device: **target ≤ 48 h.**

**Not metrics:** DAU, retention, stars, session length. We cannot measure them without a server, and none of them tell us whether Nouf handed in her homework.

---

## 6. Definition of done for v0.1 (today)
ACCEPTANCE.md items 1.x–10.x pass in Chrome on desktop at 390 px and 768 px viewports, **and** the Java template runs end-to-end on one real Android phone. Metric A1 and A3 measured and written down. R1 decided and documented in the README.

---

## 7. Risks

**R1 — RIskiest assumption: "Chrome on iPad" is a browser we support.** It is not a browser we control. On iPadOS, Chrome is WebKit; the brief scopes Safari/WebKit *out* while scoping the iPad persona *in*. If CheerpJ, OPFS sync access handles, or the COOP/COEP + SharedArrayBuffer setup misbehaves under WebKit — or if the JVM heap trips the WKWebView per-tab memory ceiling — then **P1, the persona in the project's own pitch, is unserved on day one.** Everything else in this PRD is a build task; this one can invalidate a persona.
*Action today, in priority order:* (a) run the Java template on one real iPad before shipping; (b) whatever the result, ship F15 so a WebKit student sees a plain explanation instead of a dead spinner; (c) state the truth in the README — "Android/desktop Chrome supported; iPad Safari/Chrome: Python yes, Java experimental" is an honest MVP, "works on any phone" is not.

**R2 — Mobile keyboards are hostile to source code.** Smart quotes, autocapitalisation, autocorrect on identifiers, and no `Tab`. A student can type code that *looks* right and won't compile. F10 plus `autocorrect/autocapitalize/spellcheck` off on the editor is P0, not polish.

**R3 — Java payload vs. prepaid data.** If first run silently burns tens of megabytes, students stop trusting the tool. Mitigation: F14's honest size warning, F21 caching, and metric A3 tracked every release.

**R4 — "It just deleted my homework."** OPFS is per-origin and per-browser-profile; clearing site data, private mode, or a different browser loses everything. Mitigation: nudge Export .zip after a successful run, and never let a destructive action (template switch, zip import) proceed without a confirm that names what will be lost.

**R5 — A wedged runtime looks like a broken app.** If kill is unreliable, the student's only recovery is closing the tab, which reads as "Warsha crashed and ate my work". F8 is a trust feature, not a convenience feature.
