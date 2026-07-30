# Privacy

**Short version: your code stays on your device. We don't have accounts, we don't have a
server that stores your work, and we don't collect anything about you.**

This page is written to be readable by students and parents, not just lawyers. Last
updated 2026-07-30.

## What Warsha is

Warsha is a website that turns your browser into a place to write and run Java and Python
programs. Everything — the editor, the compiler, the program you run — works inside the
browser tab on your own phone, tablet, or computer. Warsha is free and open source, and
anyone can read every line of the code that does this.

## What we collect

Nothing.

- **No accounts.** There is no sign-up, no email address, no password, no profile.
- **No analytics.** No Google Analytics, no tracking pixels, no telemetry, no
  fingerprinting, no advertising or marketing cookies.
- **No code uploads.** Your programs are never sent to us. There is no "us" to send them
  to — Warsha is a set of static files, with no server that receives your work.
- **No teacher dashboard, no grades, no submissions.** Warsha does not report your
  activity to anyone: not to us, not to a school, not to a parent.

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

## Two things we want to be honest about

We could have written "nothing ever leaves your device" and stopped. That would not be
quite true, so here are the two nuances.

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

Because we collect no personal data at all, the concerns that privacy laws such as the
**GDPR** (Europe), **COPPA** (United States), and Saudi Arabia's **PDPL** exist to
address — collecting children's data, profiling, advertising to minors, transferring
personal information, obtaining parental consent for data collection — do not arise in
Warsha's own operation. **We are not claiming a formal certification, audit, or
compliance approval from any authority**, and nothing here is legal advice to a school. If
your school or district needs a formal privacy assessment before adopting Warsha, the
answer is easier than usual: point them at this page, at
[THIRD-PARTY.md](./THIRD-PARTY.md), and at the source code, which they are free to read
and to host themselves. A school that wants to eliminate even the two nuances above can
review its own hosting and network arrangements against them.

## Changes

If Warsha ever starts collecting anything — it currently has no plans to — this page will
say so before that version ships, and the change will be visible in the project's public
commit history like everything else.

## Questions

Warsha is developed in the open. Open an issue in the project's repository and it will be
answered in public.
