# Curriculum direction

Warsha teaches one path: from a first `print` to comfortable object-oriented code, then to the data
structures and algorithms of a first university course. Everything must be teachable with console
output and typed input only, in both Java and Python.

## v0.1 — shipped (this folder)

| Unit | Java | Python |
|------|------|--------|
| Templates | `templates/java-oop/` — packages, base class, override, `Scanner` | `templates/python-starter/` — module import, base class, override, `input()` |
| Pack 1 | `exercises/java-01..04` | `exercises/python-01..04` |

Pack 1 covers: output and variables, `if` / loops, methods and functions, then two classes with a
package or module of the student's own. That is roughly weeks 1 to 5 of a first course, and it lands
exactly where the two templates start, so a student who finishes the pack can read the template code
they began with.

## Next — pack 2, "objects for real" (v0.2)

Where an intro-OOP course actually goes: collections (`ArrayList` / list and dict), a class with a
list of other objects inside it, `equals` and `toString`, and one interface or abstract class. Also
the first pack with a **multi-class project brief** rather than single exercises — a student manages a
library, a class register, or a small shop across four or five files. This is where Warsha's real
file tree stops being decoration.

## Then — pack 3, data structures and algorithms (v0.3)

The reason console-only is not a limitation for long. All of it prints its work:

- Search and sort: linear and binary search, bubble and insertion sort, then merge sort. Print the
  array after each pass, so the algorithm is visible without any graphics.
- Recursion: factorial, Fibonacci, then reversing a string.
- Built by hand: a linked list, a stack, and a queue as the student's own classes, in both languages.
- Big-O as counting: have the program print how many comparisons it made, then compare the counts for
  10, 100, and 1000 items. Complexity taught as a number the student watched grow.

This pack needs one product feature we do not have yet: exercises where the expected output is long,
which is painful to check by eye. It is the natural first customer for an autograder.

## Alongside — Arabic localization

Many of our students are Arabic speakers. The plan, in order:

1. **Interface in Arabic**, with right-to-left layout. The editor and the console stay
   left-to-right — code is left-to-right, and mixing the two inside the editor causes more confusion
   than it removes.
2. **Exercise text in Arabic**, as `exercises/ar/` files beside the English ones. Same starter code,
   same expected output, translated prose. Keyword and identifier names stay English, because that is
   what the student will meet in every real codebase and every exam.
3. **Arabic text in program output.** Students will print Arabic strings on day one and they must not
   see broken characters. Worth an early test in the console panel, before anyone translates a word.

English content stays the source of truth. A translated exercise that drifts from the English one is
worse than no translation.

## Rules for contributing content

- Console only: stdout, stderr, and typed input. No graphics, no files, no libraries beyond the
  standard one.
- Every exercise ships with the exact expected output, produced by actually running a solution. Not
  from memory.
- Simple international English. Short sentences, no idioms, no cultural references a 15-year-old in
  Riyadh or Rabat would have to look up.
- Java and Python versions of a unit teach the same idea, and never the same program twice — the
  student who does both should see two languages, not one exercise translated.
