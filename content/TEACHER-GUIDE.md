# Teacher guide — Warsha in a class with no setup budget

Warsha is a programming environment that runs inside the browser. Nothing is installed. If your
students can open a web page, they can write and run Java and Python.

## The lesson, start to finish

1. **Share the URL.** Write it on the board. Students open it in any modern browser, on a phone, an
   iPad, or a shared computer. No account, no login, no email.
2. **Pick a template.** Each student chooses *Java (OOP starter)* or *Python starter*. It opens as a
   small working project, not an empty page. Tell them to press **Run** first, before changing
   anything, so they see output in the first minute.
3. **Work.** Give them an exercise from `exercises/`. They edit files in the tree on the left, press
   **Run**, read the console, and fix what is wrong. When the program asks a question, they type the
   answer into the console panel and press Enter.
4. **Export.** When finished, the student exports the project as a `.zip` file, which lands in the
   device's Downloads.
5. **Submit.** They send you that zip the way they already send homework: your LMS, a shared drive
   folder, email, or a messaging group. You open it on your own machine.

Work stays in the browser's own storage on that device. It survives closing the tab and reloading.
It does **not** follow a student to a different device, so anything they want to keep must be
exported before they walk away.

## Classroom problems this solves

- **Shared iPads and phones.** Warsha is the only option some students have. There is no Java or
  Python for iPad, and a phone is enough here.
- **No admin rights.** School computers usually block installers. Warsha needs no installation, so
  the IT department is not part of the lesson plan.
- **Lab machines that get wiped.** Nothing to reinstall each term.
- **Every student on the same version.** No "it works on my computer". The same code produces the
  same output for everyone in the room.
- **Zero setup time.** A first lesson that used to lose 40 minutes to installing a JDK now starts
  with students writing code.

## Honest limitations

Please plan around these. They are real.

- **The first load is heavy.** The language engine is downloaded the first time a student runs code,
  and it is large. On slow school Wi-Fi this takes patience. Ask the class to press **Run** all at
  once at the start of the lesson, then explain the exercise while it loads. After that first load
  it is cached on the device and later runs start quickly.
- **Internet is needed to open Warsha.** Once loaded it runs offline, but do not promise an offline
  lesson unless the students loaded it before.
- **Console programs only.** No windows, no graphics, no drawing, no reading or writing files, and
  no downloading libraries. This covers the whole first course, but a student who wants to build a
  game with pictures has outgrown v1.
- **No autograder.** Warsha does not mark work. Grading is you reading exported zips, or students
  comparing their console output to the expected output printed in each exercise. Design tasks with
  exact expected output so students can check themselves.
- **Small screens are cramped.** On a phone, typing code with an on-screen keyboard is slow and the
  console and the editor compete for space. Phones work for reading, fixing, and short exercises.
  For a long lab session, a tablet or a keyboard is much better.
- **Nothing is stored on a server.** If a student clears their browser data, the work is gone. Say
  this out loud on day one, and make exporting the zip the last step of every lesson.

## Two habits worth teaching in week one

- **Export before you leave.** Every lesson, every time.
- **Read the error, then the line number.** The console shows exactly which file and line broke. The
  fastest students are not the ones who write fewer mistakes; they are the ones who read the message.
