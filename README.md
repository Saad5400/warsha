# Warsha

**A browser-only IDE for students learning Java and Python. No install, no account, no server.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Status](https://img.shields.io/badge/status-v0.1%20MVP-orange.svg)](#status)

Warsha ("ورشة", *workshop*) is a website that turns a supported browser into a working
Java and Python environment. You open a URL and start writing code. Your files are saved
on your device, your programs compile and run on your device, and nothing you write is
ever uploaded anywhere.

Which browsers count as supported is a short and specific list right now — see
[Browser support](#browser-support) before recommending Warsha to a class.

## Why

A great deal of programming education assumes every student has a laptop they can install
a JDK on. Many don't. They have a phone, or a shared tablet, or a school computer they
cannot install software on — and the alternative, a cloud IDE, means an account, an email
address, a queue for a container, and a working internet connection for every keystroke.

Warsha targets exactly that student. The entire toolchain is downloaded once and then runs
locally, so an Android phone is already enough to compile a Java class and see the output.
Reaching the iPad half of that audience is a stated goal, not yet a finished one.

## Status

**v0.1 MVP.** Both language engines are wired in and verified in a real browser: you can
write Java or Python across multiple files, run it, type into stdin, and kill a runaway
loop. The editor, file explorer, tabs, multi-project storage, and zip import/export work.

Treat this as pre-release. The storage format may still change, so export anything you
care about, and see [Browser support](#browser-support) for where it is actually proven.

## What's in it

- **Multiple projects.** Each project is its own tree in the browser's private file
  system (`warsha/projects/<id>/`), with a switcher in the project menu. Projects created
  before multi-project support are migrated on first open.
- **A real editor.** Java and Python syntax highlighting, search, indent guides, and
  completion that includes the snippet abbreviations students already see teachers type —
  `sout`, `psvm`, `fori` — plus a hand-written dictionary of the API names from the first
  weeks of a course, each with a plain-English description. It is a word list, not type
  analysis; real type-aware completion is a later version.
- **A console that behaves like a terminal.** Partial writes appear immediately, so a
  `print("Name: ")` prompt shows up before the newline that never comes; what you type
  lands on the same line as the prompt; output auto-scrolls with a jump-to-bottom pill
  when you scroll away; and long output is capped at 1200 rows and says so when it drops
  the head.
- **Import and export.** Any project round-trips through a zip file, so work moves
  between devices without an account.
- **Nothing leaves the device.** No backend, no account, no telemetry.

## Browser support

This table reflects what we have actually tested, not what we expect to work. It will grow
as we verify more platforms.

| Platform | Python | Java |
|---|---|---|
| **Chrome on Android** | Supported | Supported |
| **Chrome on desktop** (Linux, Windows, macOS) | Supported | Supported |
| **iPad / iPhone** (any browser) | Targeted — under active validation; expected to work | **Experimental** — unverified on-device |
| Firefox, Safari on macOS, other browsers | Untested | Untested |

Chrome on Android and desktop is where we develop and test today, so it is the only
configuration we will vouch for.

**On iPadOS, every browser — including Chrome and Firefox — runs on Apple's WebKit engine**,
which Apple requires. So "use Chrome instead" is not a workaround there; you get WebKit
either way. Warsha's engines lean on `SharedArrayBuffer`, OPFS, and large WebAssembly
modules, and WebKit's behaviour and memory limits around those differ enough from Chrome's
that we will not claim iPad support until someone has run it on real hardware. Python is the
lighter of the two runtimes and we expect it to work; Java is heavier and remains
experimental until verified. If you have an iPad and try Warsha, a bug report either way is
genuinely useful.

Untested does not mean broken — it means nobody has checked, so please don't build a lesson
plan on it yet.

## How it works

Everything happens in the browser tab. There is no backend — Warsha deploys as a folder of
static files.

| Piece | What runs it |
|---|---|
| **Editor** | [CodeMirror 6](https://codemirror.net/) — syntax highlighting, autocomplete, search |
| **Java** | [CheerpJ](https://cheerpj.com/) — a full JVM compiled to WebAssembly, loaded from Leaning Technologies' CDN — plus [ECJ](https://mvnrepository.com/artifact/org.eclipse.jdt/ecj), the Eclipse batch compiler, which runs *inside* that JVM to compile the student's code |
| **Python** | [Pyodide](https://pyodide.org/) — CPython and the standard library compiled to WebAssembly |
| **Files** | OPFS, the browser's own private file system, plus [fflate](https://github.com/101arrowz/fflate) for zip import/export |
| **UI** | React 19 and Tailwind CSS 4, bundled by Vite |

**Java is Java 8.** CheerpJ's runtime is a Java 8 JVM, so Warsha pins ECJ to 3.26.0 — the
last release whose own class files are Java 8 bytecode and can therefore run on it. Newer
language features (`var`, records, switch expressions, text blocks) are not available.
That is a limitation of the runtime, not a choice; it is unlikely to bite an introductory
course, but check it against your syllabus before adopting Warsha. The compiler jar is
fetched from Maven Central and checksum-verified at
build time by [`runtimes/java/fetch-compiler.sh`](runtimes/java/fetch-compiler.sh); it is
never committed, because `*.jar` is gitignored repo-wide for licensing reasons.

Every language sits behind one small interface (`Runtime` in
[`app/src/runtime/types.ts`](app/src/runtime/types.ts)): load the engine, run a set of
files, stream stdout/stderr back to the console. There are three implementations of it —
[`runtimes/java/`](runtimes/java/) and [`runtimes/python/`](runtimes/python/), each an
independent package with its own browser harness and `INTEGRATION.md`, plus
[`app/src/runtime/fake.ts`](app/src/runtime/fake.ts), a stub the UI can be developed
against without waiting on a 20-second engine download. Adding a fourth language means
implementing that interface and adding one line to the registry.

The engines are downloaded from third-party CDNs on first run, which is the one thing that
touches the network. No code, file names, or user data are sent with those requests. See
[docs/legal/PRIVACY.md](docs/legal/PRIVACY.md).

## Quick start

**As a user:** open the site in a [supported browser](#browser-support). That's the whole
setup. It works offline afterwards for editing; running a language needs its engine
downloaded at least once.

**As a developer:**

```bash
cd app
npm install
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # type-check (tsc --noEmit) + static build into app/dist
```

Both commands run `npm run assets` first, which copies the Java worker into `public/` and
fetches the checksum-verified ECJ compiler jar from Maven Central. So the **first** `dev`
or `build` on a fresh clone needs network access; after that the jar is cached and the
step is a no-op.

There is also a browser QA suite in [`tools/qa/`](tools/qa/) — Chrome-driven checks that
boot the real engines against a served production build and assert what a student would
actually see, rather than what type-checks. See [`tools/qa/README.md`](tools/qa/README.md);
everything in it is configurable by environment variable and defaults to `127.0.0.1`.

`app/dist` is the entire deployable artifact — put it on any static host (GitHub Pages,
Netlify, an S3 bucket, a school's own web server). One hosting note: the WebAssembly
runtimes need cross-origin isolation, which normally means setting COOP/COEP response
headers. On hosts where you cannot set headers, the bundled
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) supplies them from a
service worker instead.

## Project layout

```
app/              the IDE itself (Vite + React + TypeScript)
  src/components/ editor, explorer, tabs, console, dialogs, toolbars
  src/editor/     CodeMirror setup, completions, snippets, indent guides
  src/fs/         OPFS-backed project storage, multi-project, preferences
  src/runtime/    the Runtime interface, the language registry, the dev stub
  src/hooks/      project and runner state
runtimes/java/    JavaRuntime — CheerpJ + ECJ, its own harness and build
runtimes/python/  PythonRuntime — Pyodide, its own harness and build
content/          exercises, templates, and the teacher guide
tools/qa/         Chrome-driven browser verification suites
docs/design/      design spec, tokens, review checklist
docs/engineering/ the runtime spikes that decided the architecture
docs/legal/       licensing and privacy
docs/product/     PRD, roadmap, acceptance criteria
```

## Screenshots

Not yet — a screenshot of the app belongs here and there isn't an honest one to publish
while the interface is still moving. Until then, the visual design is specified in
[`docs/design/DESIGN-SPEC.md`](docs/design/DESIGN-SPEC.md), with the palette and type
scale in [`docs/design/tokens.css`](docs/design/tokens.css).

## Contributing

Bug reports and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md)
for dev setup and the runtime contract, and note that this project follows a
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

Warsha's own code is licensed under the **Apache License 2.0** — see [LICENSE](LICENSE),
and [NOTICE](NOTICE) for the attributions that ship with it. Copyright Warsha
contributors.

**A note on CheerpJ.** Warsha's Java support depends on CheerpJ, which is **proprietary
software** from [Leaning Technologies](https://leaningtech.com/), not open source. Their
Community License makes it free for individuals and for free/open-source projects like
this one, on the condition that it is loaded from their CDN rather than self-hosted, and
that credit is given — which this section does. **If you fork Warsha for a business or
for a private, non-open-source deployment, that free license may not extend to you** and
you should check [cheerpj.com/licensing](https://cheerpj.com/licensing/) yourself.
Everything else Warsha uses is open source (MIT, MPL-2.0, or EPL-2.0). Full details,
obligations, and citations are in
[docs/legal/THIRD-PARTY.md](docs/legal/THIRD-PARTY.md), with the shipped attributions in
[NOTICE](NOTICE).

## Roadmap

Beyond the MVP: on-device validation on iPadOS so the table above can promise it, a built-in
exercise library with automatic checking, better mobile ergonomics for the editor and
console, shareable project links that stay device-local, and a path to self-hosting the
Python runtime so more of Warsha works with no network at all.
