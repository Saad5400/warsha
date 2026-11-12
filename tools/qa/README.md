# Browser QA suites

Nine suites that drive **local Chrome against a served production build** and assert
what a student would actually see. They are not unit tests: they boot the real
engines, download real Pyodide, real CheerpJ and the real .NET-wasm runtime, type
into the real console, and read the real DOM. A pass here means the feature works
in a browser; a pass in `tsc` means only that it compiles.

```bash
# 1. build and serve the app (from repo root)
cd app && npm run build && npx vite preview --port 8086 --strictPort --host

# 2. run the suites (from this directory)
cd tools/qa && npm install
npm run all          # python + java + csharp + projects + migration + robustness + sw-range
npm run python       # or one at a time
npm run java
npm run csharp       # needs the .NET bundle staged (app/public/warsha-dotnet/)
npm run projects
npm run migration
npm run robustness
npm run offline
npm run sw-range
npm run timings      # progress-continuity + cold/warm Java numbers, not pass/fail

# three suites aren't wired into package.json — invoke node directly
node share-check.mjs           # 11 checks: share-as-link + share-as-PDF (same WARSHA_URL/WARSHA_SHOTS/CHROME env vars as above)
node menus-check.mjs           # 38 checks: where every action lives (engine-free, ~15s — reads WARSHA_URL/CHROME)
CHROME=/usr/bin/google-chrome node measure-java-startup.mjs   # cold Run + reload->Run cache timings, not pass/fail (reads APP_URL, not WARSHA_URL)
```

Each suite exits non-zero if any check fails, prints `PASS`/`FAIL` per check and a
tally, and writes screenshots to `screenshots/`.

## Configuration

| Variable | Default | Why you would change it |
| --- | --- | --- |
| `WARSHA_URL` | `http://127.0.0.1:8086/` | A different port, or a deployed URL over HTTPS. |
| `WARSHA_SHOTS` | `tools/qa/screenshots` | Collect evidence somewhere else. |
| `CHROME` | `/usr/bin/google-chrome` | Chrome installed elsewhere. |

**`127.0.0.1`, not `localhost`** — deliberate. `vite preview` without `--host` binds
IPv4 only, and Chrome resolving `localhost` to `::1` first then fails to connect
with an error that looks like the app is broken. Cost an hour once.

**The URL must be a secure context** (`127.0.0.1`, `localhost` or HTTPS). Python
needs `SharedArrayBuffer`, which needs cross-origin isolation, which
`coi-serviceworker` can only obtain in a secure context. Over a plain-HTTP LAN
address the Python suite fails with the runtime's "needs cross-origin isolation"
error, correctly. Java has no such requirement.

## What each suite covers

| Suite | Checks | Covers |
| --- | --- | --- |
| `verify.mjs` | 23 | Python: coi bootstrap and its one automatic first-visit reload, real Pyodide boot with a determinate byte counter, template output, `input()` prompt painted *before* the read blocks, stdin round-trip, infinite loop → Stop → Run again, OPFS persistence, CPython version. |
| `verify-java.mjs` | 31 | Java: CheerpJ boot with progress never blank or frozen >2s, Scanner round-trip, compile error naming the student's nested file and line, infinite loop → Stop → Run again, persistence — **plus a Python regression in the same build**, because both engines share one page. |
| `verify-csharp.mjs` | 34 | C#: real .NET-wasm + Roslyn boot with progress never blank or frozen >2s (the ~37 MB cold download), the OOP starter's polymorphic output and interpolated F2 areas, `Console.ReadLine()` prompt painted *before* the blocking read, stdin round-trip, warm run faster than cold, Roslyn compile error naming `Program.cs(line,col)` with its `CSxxxx` code and nothing running, infinite loop → Stop → Run again, OPFS persistence — **plus a Python regression in the same build**. Needs the staged bundle at `app/public/warsha-dotnet/`. |
| `verify-projects.mjs` | 19 | Multi-project: create from a starter, run, second project, run, switch back with files and edits intact, last-opened reopens, delete, rename — each persistence claim re-checked after a reload. |
| `share-check.mjs` | 11 | Share as link + PDF: the ⋯ row copies a `#share=` URL; opening your own link back opens the untouched copy instead of duplicating; after an edit the same link creates a name-deduped second project; a third open finds *that* copy; a fresh profile opens the link cold (surviving the first-visit COOP/COEP reload) with the entry file open; a damaged payload is refused with a sentence; the PDF row downloads a real multi-page `%PDF` covering every file. |
| `verify-migration.mjs` | 12 | The upgrade path: seeds the pre-multi-project flat OPFS root on a stub page (so the app has never run), then proves every file arrives byte-identical, the manifest is well-formed, the legacy root is retired only after the copy verifies, the migrated project runs, and the migration does not repeat. |
| `measure-java.mjs` | — | Timings and progress continuity. Prints cold/warm/second-run numbers and the longest stretch with a blank or unchanging progress block. |
| `measure-java-startup.mjs` | — | The two startup cases the founder flagged on 2026-08-06: a cold first Run (asserting the console never falls back to its empty-state placeholder) and a page **reload** followed by Run with no edits, which must hit `Build`'s persistent compile cache and skip ECJ entirely. |
| `robustness.mjs` | 65 | Failure injection, 13 scenarios: blocked/dropped engine CDNs, a worker killed outside its own kill path, OPFS writes failing or unavailable at startup, a vanished remembered project, two tabs at once, hostile `.zip` imports (bomb, path traversal, oversize, garbage), a 500-file project, runaway output, a 12-run session, a deleted Java class that must not ghost-run from a stale `.class`. See `docs/ROBUSTNESS.md` for the full before/after audit. |
| `offline-check.mjs` | 10 | Offline PWA: after one online visit, the service worker precache + runtime cache let the app shell boot and **Python run with the network switched off** (`context.setOffline`), cross-origin isolation still held from the cached shell. Java offline is a documented limitation, not asserted. |
| `deploy-upgrade-check.mjs` | — | A real deploy, through the production nginx config in docker: two builds (`WARSHA_V1_DIST`, `WARSHA_V2_DIST`), v1 visited and every language run, v2 deployed, then (A) the same profile returns and runs every language — twice, since a poisoned cache bites on the visit after — (B) a tab left open across the deploy runs every language (one self-heal reload allowed, an error is not), (C) the upgraded app runs Python offline. Asserts the output, that the page is v2, that every cached runtime file served is byte-identical to v2 on disk, and that no HTML sits in the cache under a script URL. Not in `npm run all`: it needs docker and two builds. |
| `sw-range.mjs` | 5 | The caching service worker vs. CheerpJ's HTTP Range reads of `/app/ecj.jar`. Deliberately **poisons** the cache with a full-body `200 ecj.jar` (what a whole-jar refetch leaves behind), then proves a range request through the SW still returns `206` + `Content-Range` (not the poisoned full body) **and** real CheerpJ Java boots and runs to a clean exit despite the poison. Guards the regression where cache-first served a `200` for a Range request and Java died with "could not start Java". |

## Real-world run check

`real-world-check.mjs` is the broad "what students actually do" sweep, one section per area:
course programs in every language (Scanner/input, files read and written, OOP across files,
compile errors, crashes, exit codes, huge output, Arabic), web pages and the React/Vue/Svelte
templates, notebooks (a Colab export, `input()` in a cell, interrupt, a cell beside a Run, a
phone), behaviour (hammering Run, Stop on loops and at input prompts in each stdin engine,
typing ahead, reloading mid-run), project changes (switching mid-run, deleting or renaming the
entry, two tabs running Java), environment (a 25-run session, a phone, a cold Java start through a
throttling proxy, offline), a breakpoint flow per language, and typing C#/C key by key. Every
scenario also asserts no `window.__warshaErrors` entry, no failure card and none of the
engine-internal strings a student must never see. It uses the **dev server** and opens
projects through `#share=` links, so it needs no seeding:

```bash
cd app && npx vite --port 8150 --strictPort --host 127.0.0.1
cd tools/qa && WARSHA_URL=http://127.0.0.1:8150/ node real-world-check.mjs [section…]
```

Keep `TMPDIR` on a real disk: Chrome profiles on a small tmpfs fail large cache writes with a
false "network error".

## Two habits worth keeping

**Assert on what the student sees, then re-check it after a reload.** "The file is
in the explorer" and "the file is really in OPFS" are different claims, and only
the second one survives closing the tab.

**Treat known noise explicitly, never with a blanket ignore.** The suites tolerate
exactly two things and say so: the `/favicon.ico` 404 (the app declares no favicon)
and ~38 `Network error for null` console errors per Java session, which are CheerpJ
probing optional JVM paths absent from its CDN. Anything else fails the run.

## Notebook suite

`notebook-check.mjs` (dev server, the same `__warshaRuntime` seam) drives the notebook kernel
directly (K: namespace, rich display, magics, shell, tracebacks, interrupt, restart, per-cell
debugging, pip) and then the notebook UI (U: template picker, Run all, IntelliSense across cells,
`input()`, command-mode keys, debug a cell from the gutter, Format cell, download, phone/RTL
geometry), saving screenshots as `notebook-*.png`. `ONLY=K` / `ONLY=U` runs one half; `PIP=0` skips
the two checks that need PyPI.

## Debugger suites

`debug-{js,python,java,csharp,c}.mjs` drive each engine's `DebugSession` directly; `debug-ui.mjs`
covers the gutter, toolbar, sidebar and keys. They need the **dev server** (`npm run dev`), because
they use the dev-only `window.__warshaRuntime` seam. Same `WARSHA_URL`/`CHROME`/`WARSHA_SHOTS` env
vars. Run them one at a time — the C engine is memory-hungry.
