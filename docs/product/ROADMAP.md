# Warsha — Roadmap (one page)

Principle for every release: **a student with only a phone must be able to finish and hand in real coursework.** Anything that does not serve that waits.

---

## v0.1 — today (MVP: "I can do my Java homework on my phone")
**Ship criteria:** ACCEPTANCE.md §1–§10 P0 items pass at 1280 px, 768 px and 390 px, plus §11 on one real Android phone.

- Template picker: Java OOP starter (`app/Main.java` + `models/Person.java` + `models/Student.java`), Python starter, Import .zip.
- Multi-file tree with folders; CodeMirror 6 editing with a mobile keyboard toolbar (`Tab { } ( ) ; " [ ]`) and autocorrect/autocapitalise off.
- Java via CheerpJ: real packages, cross-file compile, inheritance. Python via Pyodide: local module imports.
- Streaming stdout/stderr, interactive stdin, Stop that kills within 2 s and leaves the app usable.
- OPFS persistence with no Save button; zip export with project-relative paths that `javac`-compiles on a laptop; zip import with wrapper-folder stripping.
- Honest first-run loading state (engine name, size, "one time only") and a plain-language failure screen when a runtime cannot start.
- README states the true browser support matrix, including the iPad/WebKit outcome.

**Cut list if the day runs out:** entry-point picker, copy-console, multiple projects, font-size control, single-file import, offline caching. Ship without them; do not ship without Stop, persistence, or zip export.

---

## v0.2 — the next two weeks ("the classroom actually survives a week of use")
Driven by the intervention log from the first real assignment (PRD §5 metric 9). Fixed scope, no new pillars.

- **iPad/WebKit resolution** — whatever v0.1 discovered, close it: either Java works on WebKit and the persona is served, or Python-only on iPad is documented and Java shows a clear explanation. Highest-priority item in this release.
- **Offline-capable** — service-worker cache of shell + engines, so a second run costs no data and works on the bus. Directly serves the prepaid-data student.
- **Multiple projects** per device (shared family tablet) + rename project.
- **Entry-point picker** ("Run which file?") and **copy console output** — the two panic mitigations cut from v0.1.
- **Errors made readable** — map compiler/traceback output to a tappable "jump to file:line". Not an LSP; just navigation.
  - *Java runtime line numbers — an investigation, not a commitment.* Java crashes now print exactly what a real JVM prints (`Exception in thread "main" java.lang.ArithmeticException: / by zero` / `at app.Main.main(Main.java)`), but with no `:12` on the end: CheerpJ's stack walker returns `getLineNumber() == 0` for every frame whatever the compiler is told, so the number does not exist to be shown. Recovering it means putting it there ourselves — rewriting student bytecode after compilation to track a current-line variable. Timebox this before promising it; without a line number, "jump to file:line" only works for *compile* errors on the Java side, and those already carry file, line and caret.
- **Data-loss guardrails** — post-run nudge to export, and a warning before anything destructive.
- **Data structures & algorithms — first landing:** ships here as **starter templates only** (LinkedList, Stack, BST, sorting comparison, Big-O printout), one per template, in both languages. No new UI. This is the cheapest way to serve the DS&A course, and it validates demand before we build content infrastructure.

---

## v1.0 — the term after ("a teacher can run a course on it")
Each item below is a real feature area, not a template. Ordered by leverage.

- **Sharing links** — a project encoded in a URL (compressed fragment for small projects; a plain "open this gist/raw URL" importer for bigger ones). Still no server, still no accounts. Unlocks: teacher posts the assignment as a link, student taps it and is coding; student pastes a link to ask for help. This is the single highest-leverage v1.0 feature and it is where **sharing lands**.
- **Teacher features** (the minimum that is genuinely useful without a backend):
  - *Assignment link*: starter files + instructions pane + designated entry point, all in one link.
  - *Instructions pane* rendering Markdown alongside the code.
  - *Student-side self-check*: teacher-authored expected-output tests the student can run before handing in ("3/4 checks passing"). Local, honest, not grading.
  - *Submission zip with a manifest* (project name, student-typed name, timestamp, file list) so a stack of 32 zips is sortable.
  - Explicitly **not** in v1.0: accounts, a class dashboard, server-side collection, autograding, plagiarism checks. All require a backend, which contradicts the product.
- **DS&A — full landing:** a structured, in-app lesson track (ordered exercises, each with starter code + self-check tests + a visualiser for arrays/lists/trees), built on the v1.0 instructions-pane and self-check machinery. Content lives in the repo as data, so teachers can fork and translate it.
- **Editor quality of life** earned by then: find/replace in project, multiple open files, adjustable font size, a second theme.
- **Localisation** — Arabic UI and RTL layout, given the initial classrooms.

---

## Beyond v1.0 (not promised)
Lightweight autocompletion (symbol-scrape, not a real LSP). Java `.jar` library import. A `pip`-style allow-listed package picker for Pyodide. Desktop-Chrome-only extras (split panes, keyboard shortcuts) once the phone experience is unambiguously good — never before.
