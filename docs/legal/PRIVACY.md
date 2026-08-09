# Privacy

**Short version: your code stays on your device. We don't have accounts, and we don't
have a server that stores your work. We count anonymous visits, and a short list of
anonymous actions — which language was started, whether a program ran. Never what you
wrote.**

This page is written to be readable by students and parents, not just lawyers. Last
updated 2026-08-09.

## What Warsha is

Warsha is a website that turns your browser into a place to write and run Java and Python
programs. Everything — the editor, the compiler, the program you run — works inside the
browser tab on your own device. Warsha is free and open source, and anyone can read every
line of the code that does this. (Which devices and browsers are supported today is a
separate, shorter list — see the [README](../../README.md#browser-support).)

## What we collect

Anonymous counts. Never your work.

- **No accounts.** There is no sign-up, no email address, no password, no profile.
- **Anonymous visit counts.** Warsha counts how many people open the site. It uses
  [Umami](https://umami.is), an open-source analytics tool that we run ourselves on our
  own server — not Google Analytics, and not an advertising network. It sets **no
  cookies**, does no fingerprinting, and has no advertising or marketing purpose. What it
  records is the page address, the page that linked you here, and your rough country,
  browser, operating system and screen size. Your IP address is used to work out the
  country and is then discarded — it is never written down. Nothing identifies you between
  visits, so we cannot tell whether today's visitor and yesterday's are the same person.
- **A short, fixed list of anonymous actions.** Alongside the visit count, Warsha counts a
  handful of things happening — never what they contained. The complete list is below, and
  it is the *whole* list: the code that sends these can only send an action from this
  list, with a value from this list.

  | We count | With | We never send |
  |---|---|---|
  | A project was started | `template`, `blank`, `zip` or `share`, and the language | the project's name, the zip's name |
  | Run was pressed | the language | the file, the code |
  | A program finished | the language, and `ok` / `error` / `stopped` | the error, the output, the exit code |
  | A program couldn't start | the language, and why (`offline`, `engine`…) | the technical failure text |
  | You exported or shared | `zip`, `pdf` or `link` | the files, the link |
  | A "Soon" language was tapped | which one | — |

  "The language" means one of a fixed set of names — `java`, `python`, `html` and so on.
  Nothing else about a file reaches it: not its name, not its size, not a line of it.
  Because nothing identifies you between visits, these counts cannot be assembled into a
  history of one student's work — they are only ever totals. See
  [Why we count these](#why-we-count-these) below.
- **No code uploads.** Your programs are never sent to us. Warsha itself is a set of
  static files, and no server ever receives your work. What you type, what your program
  prints, and the errors you get are never transmitted anywhere.
- **No teacher dashboard, no grades, no submissions.** Warsha does not report your
  activity to anyone: not to us, not to a school, not to a parent. The counts above cannot
  be broken down to an individual student, because nothing distinguishes one.

## Why we count these

Warsha is free, has no adverts and sells nothing, so the only way to know whether it is
worth continuing to build is to know whether anyone opens it, and whether it works when
they do.

That second half is why the list above is not just a page count. Warsha's real risk is
that a student opens it on a phone or a school tablet, presses Run, and the Java engine
never starts — and we would never hear about it, because there is no account, no support
inbox and no error report. A count of "Run pressed" against "a program finished" is the
only way we can see that happening. The same goes for the roadmap: which of the greyed-out
"Soon" languages gets tapped is the difference between building C++ next and building it
third.

Everything on that list is a count of *something happening*. None of it is a copy of
anything you made. The line is deliberate and it holds in both directions: we count that a
program failed, and we do not send the error; we count that a zip was imported, and we do
not send its name.

## Where your work is stored

On your device, by your browser, in two places:

- **Your files and projects** are stored in your browser's private storage for this site
  (a browser feature called OPFS — the Origin Private File System). Only this website, in
  this browser, on this device, can read it.
- **Your settings** (such as theme and font size) are stored the same way.

Two practical consequences worth knowing:

- If you clear your browser's site data for Warsha, or use "private/incognito" browsing,
  or uninstall the browser, **your projects are deleted and we cannot recover them.** We
  never had a copy.
- Your work does **not** follow you to another device or another browser. Use **Export**
  to download a `.zip` if you want to move it or keep a backup.

## Two more things we want to be honest about

Besides the counts described above, we could have written "nothing ever leaves your
device" and stopped. That would not be quite true either, so here are two more nuances.

**1. The Java and Python engines are downloaded from other companies' servers.**

Warsha does not include the Java and Python engines itself. Your browser downloads them
when you first run a program:

- The Java engine (**CheerpJ**, by Leaning Technologies) is downloaded from
  `cjrtnc.leaningtech.com`.
- The Python engine (**Pyodide**) is downloaded from `cdn.jsdelivr.net`.

Downloading a file means those servers see your IP address, which browser you use, and
roughly when — exactly the same information any website sees when it loads an image or a
font. That is unavoidable for any website. What they do **not** receive is your code, your
file names, or anything you typed: your programs are compiled and run locally in your
browser after the engine has finished downloading. See
[THIRD-PARTY.md](./THIRD-PARTY.md) for the details and the vendors' own statements.

**2. Files you export are yours to look after.**

When you use **Export**, Warsha writes a `.zip` into your device's normal Downloads
folder. From that moment it is an ordinary file: if you email it, put it in a shared
folder, or hand in the device, whoever has the file has your code. Warsha has no control
over it and no way to take it back.

## Children and students

Warsha is intended for use by students, including children. That is exactly why it is
built this way: there is no account to create, no personal information to enter, and
nothing for us to store, lose, or misuse. Warsha never asks for a name, age, email
address, school, or location, and it has no chat, comments, uploads, or any other way for
users to contact each other or be contacted.

Warsha asks for no personal information, stores no identifier that follows a user between
visits, and keeps no record that can be traced back to one student. So the concerns that
privacy laws such as the **GDPR** (Europe), **COPPA** (United States), and Saudi Arabia's
**PDPL** exist to address — collecting children's data, profiling, advertising to minors,
transferring personal information, obtaining parental consent for data collection — do not
arise in Warsha's own operation. The counts described above are anonymous and cookieless,
which is the category of measurement those laws treat most leniently, and none of them
carry anything a student wrote, but we would rather describe them to you plainly than
leave them unmentioned. **We are not claiming a formal certification, audit, or
compliance approval from any authority**, and nothing here is legal advice to a school. If
your school or district needs a formal privacy assessment before adopting Warsha, the
answer is easier than usual: point them at this page, at
[THIRD-PARTY.md](./THIRD-PARTY.md), and at the source code, which they are free to read
and to host themselves. A school that wants to eliminate even the two nuances above can
review its own hosting and network arrangements against them.

## Changes

Anonymous visit counting was added on 2026-08-09. This page was updated the same day, but
shortly *after* that version shipped rather than before it — which is not the order
promised here, and is recorded plainly rather than quietly corrected.

The short list of anonymous actions ("What we collect", second bullet) was added on
2026-08-09 as well. This time the page went live first and the measuring shipped after it,
which is the order this section promises.

If Warsha ever starts collecting anything further, this page will say so before that
version ships, and the change will be visible in the project's public commit history like
everything else.

## Questions

Warsha is developed in the open. Open an issue in the project's repository and it will be
answered in public.
