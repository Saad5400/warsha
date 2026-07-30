# Contributing to Warsha

Thanks for helping. Warsha is a small, deliberately plain codebase — Vite, TypeScript, no
UI framework — so most contributions need nothing more than Node and a browser.

By contributing you agree that your contribution is licensed under the project's
[Apache-2.0 license](LICENSE), and you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). There is no CLA.

## Dev setup

```bash
cd app
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit + vite build → app/dist
```

Run `npm run build` before opening a pull request; it type-checks as well as bundles, and a
type error is the most common reason a PR needs a second round.

Warsha has no backend and no test account. Everything you need to reproduce a bug is in
your own browser — if state matters, note whether the browser's site data for Warsha was
empty or already had projects in it.

## The runtime contract

Each language is one implementation of a single interface, `Runtime`, defined in
[`app/src/runtime/types.ts`](app/src/runtime/types.ts). It is intentionally three methods:
an `id`, an idempotent `load(onProgress)` that bootstraps the heavy WebAssembly engine, and
a `run(files, entryPath, io)` that returns a session you can write stdin to or kill. Output
comes back through the `RunIO` callbacks rather than a return value, so the console can
stream.

Everything else — the editor, the file explorer, storage — talks only to that interface and
knows nothing about CheerpJ or Pyodide. Keep it that way: if you find yourself needing a
language-specific branch outside `app/src/runtime/`, that is a sign the interface needs
extending instead. `app/src/runtime/index.ts` is the one registry mapping a file extension
to an engine, and `fake.ts` is a working stub you can develop UI against without waiting on
a real engine.

The broader design rationale lives in [`app/ARCHITECTURE.md`](app/ARCHITECTURE.md); read it
before proposing structural changes.

## Adding exercises

Exercises live in [`content/exercises/`](content/exercises/) and are data, not code — you
do not need to touch `app/` to add one. Follow the shape of the existing exercises in that
directory and the README there for the current format, keep starter code short enough to
read on a phone screen, and make sure the exercise actually runs in the app before
submitting it. Contributions of exercises in Arabic or English are equally welcome.

## Pull requests

- **One concern per PR.** A focused diff gets reviewed the same day; a 40-file refactor
  mixed with a bug fix does not.
- **Open an issue first for anything large** — a new language runtime, a storage format
  change, a dependency. It is cheaper to disagree about an approach in an issue than in a
  finished branch.
- **Match the surrounding code.** Existing naming, comment density, and formatting win over
  personal preference. Don't reformat files you aren't otherwise changing.
- **Say how you tested it.** "Ran a Java program with stdin on Chrome and on iOS Safari"
  tells a reviewer more than a screenshot.
- **New dependencies need a reason and a license check.** Anything that ships to users must
  be OSI-licensed and must be added to
  [`docs/legal/THIRD-PARTY.md`](docs/legal/THIRD-PARTY.md) in the same PR. Never commit
  vendor binaries whose redistribution terms you have not read — in particular, no Oracle
  JDK artifacts.
- **Remember who uses this.** Many users are minors on slow phone connections. Keep the
  bundle small, don't add anything that phones home, and don't add anything that would put
  user data on a server.
