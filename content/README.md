# Warsha content

Everything students and teachers read, plus the two starter projects that ship inside the app.

```
templates/       the projects the app offers on first open
exercises/       exercise pack 1, eight exercises
TEACHER-GUIDE.md how a teacher with no setup budget runs a lesson
CURRICULUM.md    where the content goes after v0.1
```

## templates/

Two projects, meant to be copied into the app verbatim:

- `templates/java-oop/` — `app/Main.java`, `models/Person.java`, `models/Student.java`.
  Entry point `app/Main.java`. Teaches packages, a base class, one `@Override`, one `Scanner` read.
- `templates/python-starter/` — `main.py`, `helpers/shapes.py`.
  Entry point `main.py`. Teaches a module import, a base class, one override, one `input()`.

Both were compiled and run before being committed. The Java files compile clean under
`javac --release 8 -Xlint:all`.

## What the templates assume of the runtime

These are requirements, not preferences. Each one is load-bearing for the code as written.

- **Java 8 language level is enough.** The templates use no `var`, no records, no text blocks, and no
  `List.of`, so they work on a browser JVM that stops at Java 8. Keep future content inside that
  limit until we know what the engine really supports.
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
