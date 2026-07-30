# Warsha — MVP Acceptance Checklist (v0.1)

**Who runs this:** one QA engineer, verbatim, top to bottom, in Chrome.
**Result values:** PASS / FAIL / BLOCKED. A FAIL on any **[P0]** item blocks the release. **[P1]** items are recorded but do not block.
**No step may require DevTools** except where a step says so.

### Environments (run the whole list in E1; run §9 and §10 in all three)
- **E1** Desktop Chrome, latest, window 1280×800, cache cleared (DevTools → Application → Clear site data).
- **E2** Desktop Chrome, DevTools device toolbar, **768 × 1024** (iPad-class), touch emulation on.
- **E3** Desktop Chrome, DevTools device toolbar, **390 × 844** (phone-class), touch emulation on.
- **E4** *(best effort, and the only environment that proves the product)* one real Android phone on Chrome. Record device + Android version.

### Reference strings used below (from the shipped templates — copy/paste to compare)
- Java expected output, lines 1–4:
  ```
  === Warsha demo output ===
  Person: Layla (34)
  Student: Omar (20), major=Computer Science
  Omar is enrolled in 4 courses
  ```
  then the prompt `What is your name? `
- Python expected output, lines 1–4:
  ```
  === Warsha demo output ===
  Circle(r=2) area = 12.57
  Rectangle(3x4) area = 12.00
  Total area = 24.57
  ```
  then the prompt `Your name: `

---

## 1. First visit (cold, no prior data)

1.1 **[P0]** Clear site data, then load the Warsha URL. → Page renders usable content in ≤ 3 s. No login screen, no account prompt, no cookie banner, no blank white page.

1.2 **[P0]** Observe the first screen without scrolling or tapping. → A choice of at least: *Java (OOP starter)*, *Python starter*, *Import a .zip*. Each has a one-line description. No empty editor as the landing state.

1.3 **[P0]** Note whether anything large downloads before you choose. (DevTools → Network, filter: All, check Transferred.) → Landing page transfers well under 5 MB; **no Java/Python engine is fetched before a Run.**

1.4 **[P0]** Read every string on the first screen. → No lorem, no placeholder, no untranslated key, no "TODO". No jargon a 16-year-old would not know ("OPFS", "WASM", "transpile" must not appear in primary UI copy).

1.5 **[P1]** Reload the landing page. → Same screen, no error, no duplicate project created.

---

## 2. Create the Java OOP project from a template

2.1 **[P0]** Tap *Java (OOP starter)*. → Editor view appears in ≤ 2 s with a file tree.

2.2 **[P0]** Inspect the file tree. → Exactly these entries exist, with folder nesting shown: `app/Main.java`, `models/Person.java`, `models/Student.java`.

2.3 **[P0]** Observe which file is open. → `app/Main.java`, with syntax highlighting, first line `package app;`.

2.4 **[P0]** Open `models/Student.java`. → Content contains `public class Student extends Person` and an `@Override` on `describe()`. Highlighting active.

2.5 **[P0]** Confirm the project is real, not a demo: is any "read-only", "preview" or "sample" badge shown? → No. The files are editable.

2.6 **[P1]** Tap *Python starter* (or the equivalent new-project path). → A confirm dialog appears that **names what will be lost** ("this replaces your current project"). Cancel it → Java project untouched, still 3 files.

---

## 3. Edit

3.1 **[P0]** In `models/Person.java`, change the `describe()` return prefix from `"Person: "` to `"Human: "`. → Character appears immediately; no lag > 100 ms per keystroke; no "unsaved" indicator required.

3.2 **[P0]** Press Enter inside a method body. → Cursor auto-indents to the enclosing block's indentation.

3.3 **[P0]** Type `{` then Enter then `}` manually. → No duplicated or swallowed braces; the editor does not fight the typed closing brace.

3.4 **[P0]** Undo repeatedly (Ctrl/Cmd+Z, and the toolbar undo if present). → Returns to `"Person: "` exactly. Redo restores `"Human: "`.

3.5 **[P0]** Create a new file: add `models/Teacher.java` via the file tree's new-file action. → File appears **inside** `models/`, is empty, and opens. Its path renders as `models/Teacher.java`, not `models\Teacher.java` or `/models/Teacher.java`.

3.6 **[P0]** Paste into `models/Teacher.java`:
```java
package models;
public class Teacher extends Person {
    public Teacher(String name, int age) { super(name, age); }
    @Override public String describe() { return "Teacher: " + getName(); }
}
```
→ Pastes intact. **No smart/curly quotes** appear in place of `"`. No autocapitalised identifiers.

3.7 **[P0]** Rename `models/Teacher.java` to `models/Instructor.java`. → Tree updates, editor tab/title updates, content preserved.

3.8 **[P0]** Delete `models/Instructor.java`. → A confirm is shown; after confirming, file is gone from the tree and the editor shows another file (not a broken/blank pane).

3.9 **[P1]** Create a folder `util`, then create `util/Helper.java` inside it. → Nested path created correctly; empty folder `util` still visible before the file is added.

---

## 4. Run (Java, multi-file, packages)

4.1 **[P0]** With `models/Person.java` reverted to `"Person: "` (undo if needed), tap **Run**. → A loading state names the engine, gives an approximate size, and says it is one-time. Progress visibly advances (not a frozen spinner).

4.2 **[P0]** Time from tap to the first output line. Record the number. → First output appears; record as **TTFSR**. Target ≤ 180 s cold on E4, ≤ 60 s on E1.

4.3 **[P0]** Compare the console to the Java reference block above. → Lines 1–4 match **exactly**, in order. This proves cross-package compilation (`app` → `models`) and inheritance/override.

4.4 **[P0]** Check output arrived progressively, not all at once at exit. (Watch during 4.2, or re-run.) → Lines stream as produced.

4.5 **[P0]** Tap Run a second time (no reload). → **No engine re-download** (Network shows no multi-MB fetch); first output in ≤ 3 s. Record as **loop latency**.

4.6 **[P0]** Edit `Person.describe()` to return `"Human: " + name ...`, Run again. → Output line 2 is now `Human: Layla (34)`. Recompilation picked up the edit; no stale-output.

4.7 **[P0]** Introduce a compile error: in `models/Person.java` delete a `;` at the end of a statement. Run. → Console shows a compiler error message **naming the file and line**, styled as an error (stderr), and the app remains fully usable. No blank console, no silent failure, no "undefined".

4.8 **[P0]** Fix the `;`, Run. → Clean run again, correct output. (Proves recovery from an error state.)

4.9 **[P0]** Introduce a runtime error: add `String s = null; s.length();` as the first lines of `main`. Run. → Console shows a `NullPointerException` with a stack trace that names `Main.main`. Remove the lines afterwards.

4.10 **[P1]** Switch to the Python starter and Run. → Console matches the Python reference block above exactly, including `Total area = 24.57`, proving `from helpers.shapes import ...` resolved.

---

## 5. Interactive stdin

5.1 **[P0]** In the Java project, Run. → Execution reaches `What is your name? `, the prompt is **visible in the console**, and the run does not exit.

5.2 **[P0]** Observe the UI while it waits. → An unmistakable waiting-for-input state (focused input line and/or explicit "waiting for input" label). The input field is focused **without** the user hunting for it.

5.3 **[P0]** Type `Nouf` and submit (Enter and/or a Send button). → Console echoes the submitted line, then prints `Hello, Nouf! Welcome to Warsha.`, then the program exits with a visible completion/exit indicator.

5.4 **[P0]** Run again and submit an **empty** line. → Program does not hang or crash; prints the `world` fallback path (`Hello, world! Welcome to Warsha.`).

5.5 **[P0]** Run again and, while waiting for input, tap **Stop**. → Run terminates; console shows a stopped/killed indication; the waiting state clears; **no orphan waiting-for-input state remains**.

5.6 **[P0]** In E3 (390 px), repeat 5.1–5.3 with the on-screen keyboard shown. → The console output *and* the input line remain visible while the keyboard is up; the input line is not covered by the keyboard or pushed off-screen.

5.7 **[P1]** Python: Run, and at `Your name: ` submit `Omar`. → `Hello, Omar! Welcome to Warsha.`

---

## 6. Stop an infinite loop

6.1 **[P0]** In `app/Main.java`, replace the body of `main` with:
```java
int i = 0;
while (true) { System.out.println("spam " + i++); }
```
Run. → Output floods the console; the **Stop control remains visible and tappable** (not scrolled away, not disabled); the page does not become unresponsive to taps.

6.2 **[P0]** Tap Stop. Time it. → Output ceases within **≤ 2 s**; a stopped indication appears. Record as **kill latency**.

6.3 **[P0]** After stopping, scroll the editor and type a character. → Editor responds normally. **No page reload was required.**

6.4 **[P0]** Verify no work was lost: check the file tree and each file's contents. → All 3 files present with their current contents.

6.5 **[P0]** Tap Run again after a kill. → A fresh run starts and produces correct output (once `main` is restored). Proves the runtime is re-usable after a kill, not wedged.

6.6 **[P0]** Repeat the same infinite-loop test in **Python** (`while True: print("spam")`) → same expectations as 6.1–6.5.

6.7 **[P0]** Let an infinite print loop run for a full 30 s before stopping. → The tab does not crash ("Aw, Snap!"), and memory does not grow without bound (console output is capped/trimmed rather than retained forever). Stop still works.

6.8 **[P1]** During a long-running run, tap Run again. → Either the button is disabled while running, or the old run is killed first. Never two concurrent runs interleaving output.

---

## 7. Persistence across reload

7.1 **[P0]** Restore `app/Main.java` to the template's `main`, edit `models/Student.java` (add a comment `// mine`), open `models/Person.java`, then **reload the page (F5)**. → Same project loads with **no template picker**, all 3 files present, `// mine` still in `Student.java`, and the previously open file (`models/Person.java`) is open.

7.2 **[P0]** Close the tab entirely, open a new tab, navigate to the URL. → Project restored as in 7.1.

7.3 **[P0]** Confirm there is no Save button and nothing ever reads "unsaved". → Persistence is implicit.

7.4 **[P0]** Type a character and reload **within 1 second** (before any idle timeout). → The character survives, or at most the last keystroke is lost — never the whole file, never a corrupted/empty file.

7.5 **[P0]** Reload while a program is *running*. → Page comes back to a clean, non-running state with files intact. No zombie run, no permanently disabled Run button.

7.6 **[P0]** Repeat 7.2 ten times consecutively. → 10/10 successful restores. Record the count.

7.7 **[P1]** Open the same URL in a second tab while the first is open. → No data corruption; the newer tab reflects the stored project (a warning about two tabs is acceptable; silent data loss is not).

---

## 8. Zip export / import

8.1 **[P0]** Tap **Export .zip**. → A `.zip` downloads with a sensible filename (contains "warsha" and/or the project name). No error toast.

8.2 **[P0]** Unzip it outside the browser and list the paths. → Exactly `app/Main.java`, `models/Person.java`, `models/Student.java` — **project-relative, forward slashes, folder structure preserved**. No absolute paths, no `__MACOSX`, no leading `./`.

8.3 **[P0]** *(Teacher-fidelity check)* In a terminal in the unzipped folder, run `javac app/Main.java models/*.java`. → Compiles with no errors. (This is Ms. Layla's grading path; if it fails, the export is not a submission.)

8.4 **[P0]** Diff the unzipped file contents against what the editor shows. → Byte-identical, including the `// mine` comment and trailing newlines.

8.5 **[P0]** Clear site data, reload Warsha, choose **Import a .zip**, pick the exported zip. → Project restored: same 3 paths, same contents, editor opens a Java file. Run → correct Java reference output.

8.6 **[P0]** Import a zip that has a **single wrapper folder** (`MyProject/app/Main.java`, …). → Wrapper is stripped; tree shows `app/Main.java`, not `MyProject/app/Main.java`. Run still works.

8.7 **[P0]** Import a zip while a project already exists. → A confirm names what will be replaced; on cancel the existing project is untouched; on confirm it is replaced cleanly (no leftover files from the old project).

8.8 **[P0]** Import a non-zip file (rename a `.png` to `.zip`, or pick a `.pdf`). → A plain-language error message. **No crash, no blank screen, and the existing project survives.**

8.9 **[P1]** Import a zip containing an unsupported binary file plus valid sources. → Sources import and run; the binary is either skipped with a note or stored harmlessly. No crash.

8.10 **[P1]** Export the Python project and repeat 8.2/8.5. → `main.py` + `helpers/shapes.py`; `python3 main.py` runs on a desktop.

---

## 9. Narrow-screen usability (run in E2 = 768 px and E3 = 390 px)

9.1 **[P0]** Load the landing page. → All template choices reachable **without horizontal scrolling** and without pinch-zoom. No element clipped off-screen.

9.2 **[P0]** Confirm the page never scrolls horizontally anywhere in the app (landing, editor, console, dialogs). → Body horizontal scrollbar never appears; long code lines scroll **inside** the editor only.

9.3 **[P0]** Reach all three areas — Files, Editor, Console — and note how. → Each is reachable in **≤ 2 taps** (tabs, drawer, or stacked panes). No area is unreachable at 390 px.

9.4 **[P0]** Measure the primary controls (Run, Stop, Export) with the DevTools element inspector. → Each tappable target is **≥ 44 × 44 px** and not overlapping another target.

9.5 **[P0]** Run the Java project and read the output at 390 px. → At least ~8 lines of console visible at once; text is legible at default zoom (≥ 13 px effective); output wraps or scrolls without clipping.

9.6 **[P0]** Open a file with a long line (paste a 200-char comment). → The editor scrolls or wraps; the file tree and buttons do not shift or get pushed off-screen.

9.7 **[P0]** Locate the **mobile keyboard toolbar** and tap-insert each of: `Tab`, `{`, `}`, `(`, `)`, `;`, `"`, `[`, `]`. → Each inserts the literal character at the cursor. `Tab` indents rather than moving focus out of the editor.

9.8 **[P0]** Inspect the editor input element's attributes (DevTools). → `autocorrect="off"`, `autocapitalize="off"`, `spellcheck="false"` (or equivalent) are set on the code input. A student cannot get autocorrected identifiers.

9.9 **[P0]** With the on-screen keyboard simulated/shown in E4, tap into the editor near the bottom of the file. → The caret stays visible above the keyboard.

9.10 **[P0]** Rotate to landscape (E3, 844 × 390). → Layout adapts; Run and Console still reachable; nothing overlaps.

9.11 **[P1]** Increase OS/browser font size (Chrome zoom 150 %). → Layout survives; no overlapping text; buttons still tappable.

---

## 10. Student-panic cases

10.1 **[P0]** *"I accidentally closed the tab."* With unsaved-looking edits in three files, close the tab without any explicit save, reopen the URL. → All edits present. Nothing lost. No recovery wizard needed.

10.2 **[P0]** *"My phone died mid-typing."* Type a line, then kill the tab from Chrome's task/tab list (simulating a crash) within ~2 s, reopen. → At most the last keystroke is missing; the file is valid, not truncated or empty.

10.3 **[P0]** *"I ran the wrong file."* From `models/Person.java` (a class with no `main`), tap Run. → Either Warsha runs the project's designated entry point and **says which file it ran**, or it shows a plain-language message offering to pick an entry point. **Never** a raw `Main method not found in class models.Person` dump with no guidance, and never silence.

10.4 **[P0]** *"My program printed forever and the page froze."* Run `while(true){ System.out.println(...); }`, wait 20 s, then Stop. → Page never became unresponsive to taps; Stop worked; files intact (this is §6 re-verified as a user-facing story, and it is the most common real failure).

10.5 **[P0]** *"It's stuck and I don't know why."* Run the Java template and simply do **not** answer the `Scanner` prompt for 60 s. → The UI clearly indicates it is waiting for **input** (not "loading", not "running"), so the student knows what to do. This is the #1 support question in every browser IDE.

10.6 **[P0]** *"I deleted the wrong file."* Delete `models/Person.java` and confirm. → Deletion required a confirm that named the file. Run now → compile error naming the missing class, not a crash or a blank console.

10.7 **[P0]** *"I broke everything, I want to start over."* Use the reset/new-project path. → A confirm that names what will be lost, plus a visible reminder/offer to Export first. After confirming, a clean template project runs correctly.

10.8 **[P0]** *"Nothing happens when I press Run."* Simulate engine failure (DevTools → Network → Block request URL on the Java engine's main asset, then Run). → A plain-language failure message with a next step ("check your connection and try again"). **No infinite spinner, no blank console, no silent no-op.** Unblock afterwards and confirm Run recovers without a reload.

10.9 **[P0]** *"I'm on the bus and lost signal."* Go offline (DevTools → Network → Offline) **after** a successful Java run, then reload. → Project files still load from OPFS. Either the app works offline, or it states plainly that it needs a connection to run code. Never a browser error page as the only feedback.

10.10 **[P1]** *"I want to send my error to my friend."* Use Copy console output. → Full console text lands on the clipboard, plain text, newlines preserved.

10.11 **[P1]** *"My little brother used the iPad too."* With Warsha's multi-project support (if shipped), create a second project. → Both projects listed; switching between them preserves each one's files.

---

## 11. Release gate — record before shipping v0.1

11.1 **[P0]** All **[P0]** items above PASS in E1, E2 and E3.
11.2 **[P0]** §2, §4, §5, §6, §7 PASS in **E4** (a real phone). Record device and Android/Chrome versions.
11.3 **[P0]** Recorded numbers: TTFSR cold (4.2), loop latency (4.5), kill latency (6.2), reload survival count (7.6), and the Java engine's first-run transferred bytes (DevTools Network).
11.4 **[P0]** iPad/WebKit reality check (PRD §7 R1): the Java template was attempted on one real iPad, the outcome is written down, and the README's browser-support claim matches that outcome.
11.5 **[P0]** No console errors in DevTools during the happy path (landing → template → edit → run → stdin → export).
11.6 **[P1]** Every FAIL has a GitHub issue with device, viewport and steps.
