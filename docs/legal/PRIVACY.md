# Privacy

**Short version: your code stays on your device. We don't have accounts, and we don't have
a server that stores your work. We count anonymous page visits, and nothing else.**

This page is written to be readable by students and parents, not just lawyers. Last
updated 2026-08-09.

## What Warsha is

Warsha is a website that turns your browser into a place to write and run Java and Python
programs. Everything — the editor, the compiler, the program you run — works inside the
browser tab on your own device. Warsha is free and open source, and anyone can read every
line of the code that does this. (Which devices and browsers are supported today is a
separate, shorter list — see the [README](../../README.md#browser-support).)

## What we collect

A count of page visits. Nothing else.

- **No accounts.** There is no sign-up, no email address, no password, no profile.
- **Anonymous visit counts.** Warsha counts how many people open the site. It uses
  [Umami](https://umami.is), an open-source analytics tool that we run ourselves on our
  own server — not Google Analytics, and not an advertising network. It sets **no
  cookies**, does no fingerprinting, and has no advertising or marketing purpose. What it
  records is the page address, the page that linked you here, and your rough country,
  browser, operating system and screen size. Your IP address is used to work out the
  country and is then discarded — it is never written down. Nothing identifies you between
  visits, so we cannot tell whether today's visitor and yesterday's are the same person.
  See [Why we count visits](#why-we-count-visits) below.
- **No code uploads.** Your programs are never sent to us. Warsha itself is a set of
  static files, and no server ever receives your work.
- **No teacher dashboard, no grades, no submissions.** Warsha does not report your
  activity to anyone: not to us, not to a school, not to a parent. The visit count above
  cannot be broken down to an individual student, because nothing distinguishes one.

## Why we count visits

Warsha is free, has no adverts and sells nothing, so the only way to know whether it is
worth continuing to build is to know whether anyone opens it. That is the whole reason,
and it is why the measurement stops at a page count rather than following what you do
inside the editor. Which language you choose, which files you create, whether your program
compiled, what the error said — none of that is measured or sent anywhere.

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

Besides the visit count described above, we could have written "nothing ever leaves your
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
arise in Warsha's own operation. The visit count is anonymous and cookieless, which is the
category of measurement those laws treat most leniently, but we would rather describe it
to you plainly than leave it unmentioned. **We are not claiming a formal certification, audit, or
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

If Warsha ever starts collecting anything further, this page will say so before that
version ships, and the change will be visible in the project's public commit history like
everything else.

## Questions

Warsha is developed in the open. Open an issue in the project's repository and it will be
answered in public.
