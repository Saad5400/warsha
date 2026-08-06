# Warsha content

Everything students and teachers read, plus the starter projects that ship inside the app.

```
templates/       the projects the app offers on first open
exercises/       exercise pack 1, eight exercises
TEACHER-GUIDE.md how a teacher with no setup budget runs a lesson
CURRICULUM.md    where the content goes after v0.1
```

## templates/

22 starter projects across five languages — Python, Java, Web (HTML/CSS/JS/TS/React/Vue/Svelte),
C#, and C — each meant to be copied into the app verbatim and each with a matching entry in
[`app/src/templates.ts`](../app/src/templates.ts), which is generated from this directory (see
[`app/ARCHITECTURE.md`](../app/ARCHITECTURE.md) §5 — never hand-edit the code strings there; change
the starter here and regenerate).

Two of them are different from the rest: `templates/java-oop/` and `templates/python-starter/` are
Education's reviewed, compiled, stdin-tested originals, and the exercise pack below is written
against them.

- `templates/java-oop/` — `app/Main.java`, `models/Person.java`, `models/Student.java`.
  Entry point `app/Main.java`. Teaches packages, a base class, one `@Override`, one `Scanner` read.
- `templates/python-starter/` — `main.py`, `helpers/shapes.py`.
  Entry point `main.py`. Teaches a module import, a base class, one override, one `input()`.

Both were compiled and run before being committed. The Java files compile clean under
`javac --release 8 -Xlint:all`.

The other twenty — `java-basics`, `java-methods`, `python-basics`, `python-functions`, the ten
`web-*` starters, `csharp-basics`, `csharp-methods`, `csharp-starter`, `c-basics`, `c-methods`, and
`c-starter` — are later drafts: each compiles and runs with piped stdin, but is pending the same
review. Hold them to that bar before treating them as final.

## What the templates assume of the runtime

These are requirements, not preferences. Each one is load-bearing for the code as written.

- **The templates stay on plain, classical Java.** The engine is Java 17 and `var`, records and
  text blocks all compile, but the starter content deliberately avoids them: a first-week student
  reading a template should meet ordinary classes and methods, not language features their course
  has not reached. Use the modern constructs in later content, not in the starters.
- **A partial line must reach the console before a read blocks.** The templates print
  `System.out.print("Your name: ")` and then read. If stdout is only flushed on a newline, the
  student sees the cursor waiting with no question on screen, types blindly, and the prompt appears
  afterwards. Every exercise in the pack depends on this ordering.
- **Interactive stdin must block, not end.** The templates call `input.nextLine()` and `input()`
  directly, with no guard, because that is what a beginner writes and what a teacher teaches. If the
  runtime answers a read with end-of-input instead of waiting, Java throws
  `NoSuchElementException` and Python raises `EOFError`, and the starter project appears broken on
  first Run. Please do not ask content to add defensive guards; that would mean teaching students to
  write code they will never see in a textbook.
- **`from helpers.shapes import ...` must resolve with no `__init__.py`.** The Python template has no
  `__init__.py`, on purpose: it is an unexplainable file for a beginner. This works on Python 3.3 and
  later as long as the project root is the working directory, or is on `sys.path`.
- **Typed input is echoed into the console.** Expected-output blocks in the exercises show the
  student's answer on the same line as the question, which is what a real terminal does.

## exercises/

See `exercises/README.md`. Every expected-output block in the pack was produced by writing a full
solution and running it, not from memory. When you add an exercise, do the same.
