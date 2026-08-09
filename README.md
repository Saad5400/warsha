# Warsha

**A browser-only IDE for students. No install, no account, no server.**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE) [![Status](https://img.shields.io/badge/status-v0.1%20MVP-orange.svg)](#status)

Warsha (*workshop*) is a website that turns a supported browser into a working programming
environment for **Java, Python, C#, C, and the Web** (HTML, CSS, JavaScript, TypeScript, React,
Vue, and Svelte). You open a URL and start writing code. Your files are saved on your device,
your programs compile and run on your device, and nothing you write is ever uploaded anywhere.

Which browsers count as supported is a short and specific list right now — see
[Browser support](#browser-support) before recommending Warsha to a class.

## Why

A great deal of programming education assumes every student has a laptop they can install a
JDK, an SDK, or a compiler toolchain on. Many don't. They have a phone, or a shared tablet, or a
school computer they cannot install software on — and the alternative, a cloud IDE, means an
account, an email address, a queue for a container, and a working internet connection for every
keystroke.

Warsha targets exactly that student. Each toolchain is downloaded once and then runs locally, so
an Android phone is already enough to compile a Java class and see the output. Reaching the iPad
half of that audience is a stated goal, not yet a finished one.

## Status

**v0.1 MVP.** All five languages are wired in and verified in a real browser: you can write
Java, Python, C#, C, or a Web project across multiple files, run it, type into stdin where the
language has one, and kill a runaway loop. The editor, file explorer, tabs, multi-project
storage, and zip import/export work across all of them. Automated QA coverage is not even across
all five yet — Python, Java, and C# each have a Chrome-driven suite in
[`tools/qa/`](tools/qa/); C and Web are verified by hand today (see
[Browser support](#browser-support)).

Treat this as pre-release. The storage format may still change, so export anything you
care about.

## What's in it

- **Multiple projects.** Each project is its own tree in the browser's private file
  system (`warsha/projects/<id>/`), with a switcher in the project menu. Projects created
  before multi-project support are migrated on first open.
- **A real editor.** Syntax highlighting, search, indent guides, and completion for every
  language Warsha runs, including the snippet abbreviations students already see teachers
  type — `sout`, `psvm`, `fori` — plus a hand-written dictionary of the API names from the
  first weeks of a course, each with a plain-English description. It is a word list, not type
  analysis; real type-aware completion is a later version.
- **A console that behaves like a terminal.** Partial writes appear immediately, so a
  `print("Name: ")` prompt shows up before the newline that never comes; what you type
  lands on the same line as the prompt; output auto-scrolls with a jump-to-bottom pill
  when you scroll away; and long output is capped and says so when it drops the head.
- **A live preview for Web projects.** HTML/CSS/JS/TS/React/Vue/Svelte render directly in a
  sandboxed iframe beside the console. Plain HTML/CSS/JS needs nothing downloaded; TypeScript,
  cross-file imports, and the supported frameworks pull an in-browser bundler the first time a
  project needs one.
- **Import and export.** Any project round-trips through a zip file, so work moves
  between devices without an account.
- **Your code never leaves the device.** No backend, no account, no sign-in. Anonymous
  page visits are counted with a self-hosted, cookieless Umami instance; nothing about
  what you write, run, or see is measured. See [PRIVACY](docs/legal/PRIVACY.md).

## Browser support

This table reflects what we have actually tested, not what we expect to work. It will grow
as we verify more platforms.

| Language | Chrome on Android | Chrome on desktop (Linux, Windows, macOS) | iPad / iPhone (any browser) | Firefox, Safari on macOS, other browsers |
|---|---|---|---|---|
| **Python** | Supported | Supported | Targeted — under active validation; expected to work | Untested |
| **Java** | Supported | Supported | **Experimental** — unverified on-device | Untested |
| **C#** | Not yet run on a phone | Supported | Untested | Untested |
| **C** | Not yet run on a phone | Supported | Untested | Untested |
| **Web** | Not yet run on a phone | Supported | Untested | Untested |

Chrome on desktop is where every language is developed and verified today — Python, Java, and
C# through the automated suites in [`tools/qa/`](tools/qa/), C and Web by hand. Real-hardware
testing on an Android phone has so far covered Python and Java only, the two engines the original
MVP shipped with; C#, C, and Web have not yet had a phone put in front of them.

**On iPadOS, every browser — including Chrome and Firefox — runs on Apple's WebKit engine**,
which Apple requires. So "use Chrome instead" is not a workaround there; you get WebKit
either way. Warsha's engines lean on `SharedArrayBuffer`, OPFS, and large WebAssembly
modules, and WebKit's behaviour and memory limits around those differ enough from Chrome's
that we will not claim iPad support until someone has run it on real hardware. Python is the
lighter of the two original runtimes and we expect it to work; Java is heavier and remains
experimental until verified. C#, C, and Web have not been evaluated on iPad at all yet — treat
them as untested there, the same as any other unverified browser.

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
| **C#** | The [.NET 9 WebAssembly runtime](https://github.com/dotnet/runtime) (Mono, single-threaded) hosting [Roslyn](https://github.com/dotnet/roslyn), which compiles the student's `.cs` files into an assembly and runs it, all in a module worker |
| **C** | [clang 16](https://wasmer.io/wasmer/clang) (via [`@wasmer/sdk`](https://github.com/wasmerio/wasmer-js)) compiles student C to WebAssembly; Warsha then runs that module itself under [`@bjorn3/browser_wasi_shim`](https://github.com/bjorn3/browser_wasi_shim) so `scanf`/`getchar` can block on a `SharedArrayBuffer` for real interactive input |
| **Web preview & bundler** | A student's HTML/CSS/JS/TS is assembled into one document and rendered in a sandboxed iframe; [esbuild-wasm](https://esbuild.github.io/) bundles TypeScript and cross-file imports, and — fetched only when a project uses them — first-party, on-device builds of React, Vue, and Svelte, plus Tailwind CSS |
| **Files** | OPFS, the browser's own private file system, plus [fflate](https://github.com/101arrowz/fflate) for zip import/export |
| **UI** | React 19 and Tailwind CSS 4, bundled by Vite |

**Java is Java 17.** `var`, records, sealed types, pattern matching, switch expressions
and text blocks all work. Getting there took more than a version flag: CheerpJ ships a JRE
with no compiler in it, and on a modular runtime ECJ cannot find the platform classes by
itself, so `runtimes/java/src/bootstrap/Platform.java` shows them to it and the Warsha
bootstrap ships prebuilt as `warsha-boot.jar`. One cost is worth knowing before you adopt
Warsha: the first Run of a session pays a background compiler warm-up (~15 s on a modest
laptop) that Java 8 did not; every run after it is well under a second. The compiler jar is
fetched from Maven Central and checksum-verified at
build time by [`runtimes/java/fetch-compiler.sh`](runtimes/java/fetch-compiler.sh); it is
never committed, because `*.jar` is gitignored repo-wide for licensing reasons.

**C# compiles with a real Roslyn, not a subset.** The .NET 9 WebAssembly runtime and Roslyn's
assemblies are staged into the app's own build (`runtimes/csharp/build.sh`) and served
same-origin — nothing is fetched from a third-party CDN at runtime, at the cost of a ~13–15 MB
brotli-compressed download the first time a student runs C#. `Console.ReadLine()` blocks on a
`SharedArrayBuffer` the same way Java's `Scanner` and Python's `input()` do. Details in
[`runtimes/csharp/INTEGRATION.md`](runtimes/csharp/INTEGRATION.md).

**C compiles with a real clang.** The toolchain — clang 16, `wasm-ld`, and a WASI sysroot — is
currently loaded from Wasmer's CDN and registry (self-hosting it is a tracked follow-up), a
one-time ~47 MB download with a further ~24 s warming the sysroot before the first compile.
Warsha runs the compiled WASIX output itself, rather than through the SDK's own runner,
specifically so an interactive `scanf` or `getchar` can block for input instead of reading
end-of-file immediately. Details in
[`runtimes/clang/INTEGRATION.md`](runtimes/clang/INTEGRATION.md).

Every language sits behind one small interface (`Runtime` in
[`app/src/runtime/types.ts`](app/src/runtime/types.ts)): load the engine, run a set of
files, stream stdout/stderr back to the console. Six implementations of it exist today —
[`runtimes/java/`](runtimes/java/), [`runtimes/python/`](runtimes/python/),
[`runtimes/csharp/`](runtimes/csharp/) and [`runtimes/clang/`](runtimes/clang/), each an
independent package with its own browser harness and `INTEGRATION.md`; plus
[`app/src/runtime/web.ts`](app/src/runtime/web.ts) (a rendered page) and
[`app/src/runtime/js.ts`](app/src/runtime/js.ts) (a standalone script, run headless like Node)
for the first-party JavaScript/TypeScript stack — alongside
[`app/src/runtime/fake.ts`](app/src/runtime/fake.ts), a stub the UI can be developed against
without waiting on a real engine download. Adding another language means implementing that
interface, adding its starters under `content/templates/`, and adding one line to the registry.

Python and Java's engines, and C's toolchain today, are downloaded from third-party CDNs on
first run; the .NET/Roslyn bundle and the Web tile's bundler and framework assets are built into
Warsha itself and served from the same origin. Either way, no code, file names, or user data are
sent with those requests. See [docs/legal/PRIVACY.md](docs/legal/PRIVACY.md).

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

Both commands run `npm run assets` first, which stages what every language needs: the Java
worker and the checksum-verified ECJ compiler jar (fetched from Maven Central), the C worker,
the C# `.NET` + Roslyn bundle (built by [`runtimes/csharp/build.sh`](runtimes/csharp/build.sh)),
and the Web tile's on-device bundler and framework assets (esbuild-wasm, Tailwind, and the
prebuilt React/Vue/Svelte runtimes). So the **first** `dev` or `build` on a fresh clone needs
network access; after that everything is cached and the step is a no-op.

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
  src/runtime/    the Runtime interface, the language registry, the Web/JS engines, the dev stub
  src/hooks/      project and runner state
runtimes/java/    JavaRuntime — CheerpJ + ECJ, its own harness and build
runtimes/python/  PythonRuntime — Pyodide, its own harness and build
runtimes/csharp/  CSharpRuntime — .NET 9 + Roslyn, its own harness and build
runtimes/clang/   ClangRuntime — clang 16 compiling to WebAssembly, its own harness and build
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
Everything else Warsha uses is open source (MIT, MPL-2.0, EPL-2.0, or Apache-2.0 with the
LLVM exception). Full details, obligations, and citations are in
[docs/legal/THIRD-PARTY.md](docs/legal/THIRD-PARTY.md), with the shipped attributions in
[NOTICE](NOTICE).

## Roadmap

Beyond the MVP: on-device validation on iPadOS so the table above can promise it, phone
verification for C#, C, and Web so they can be promised on Android too, a built-in exercise
library with automatic checking, better mobile ergonomics for the editor and console,
shareable project links that stay device-local, and self-hosting the engines that still load
from a third-party CDN (Python, and C's toolchain) so more of Warsha works with no network at
all.
