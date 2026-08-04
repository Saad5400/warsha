# Browser QA suites

Seven suites that drive **local Chrome against a served production build** and assert
what a student would actually see. They are not unit tests: they boot the real
engines, download real Pyodide and real CheerpJ, type into the real console, and
read the real DOM. A pass here means the feature works in a browser; a pass in
`tsc` means only that it compiles.

```bash
# 1. build and serve the app (from repo root)
cd app && npm run build && npx vite preview --port 8086 --strictPort --host

# 2. run the suites (from this directory)
cd tools/qa && npm install
npm run all          # python + java + projects + migration
npm run python       # or one at a time
npm run java
npm run projects
npm run migration
npm run timings      # progress-continuity + cold/warm Java numbers, not pass/fail
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
| `verify-projects.mjs` | 19 | Multi-project: create from a starter, run, second project, run, switch back with files and edits intact, last-opened reopens, delete, rename — each persistence claim re-checked after a reload. |
| `verify-migration.mjs` | 12 | The upgrade path: seeds the pre-multi-project flat OPFS root on a stub page (so the app has never run), then proves every file arrives byte-identical, the manifest is well-formed, the legacy root is retired only after the copy verifies, the migrated project runs, and the migration does not repeat. |
| `measure-java.mjs` | — | Timings and progress continuity. Prints cold/warm/second-run numbers and the longest stretch with a blank or unchanging progress block. |
| `robustness.mjs` | 65 | Failure injection, 13 scenarios: blocked/dropped engine CDNs, a worker killed outside its own kill path, OPFS writes failing or unavailable at startup, a vanished remembered project, two tabs at once, hostile `.zip` imports (bomb, path traversal, oversize, garbage), a 500-file project, runaway output, a 12-run session, a deleted Java class that must not ghost-run from a stale `.class`. See `docs/ROBUSTNESS.md` for the full before/after audit. |
| `offline-check.mjs` | 10 | Offline PWA: after one online visit, the service worker precache + runtime cache let the app shell boot and **Python run with the network switched off** (`context.setOffline`), cross-origin isolation still held from the cached shell. Java offline is a documented limitation, not asserted. |

## Two habits worth keeping

**Assert on what the student sees, then re-check it after a reload.** "The file is
in the explorer" and "the file is really in OPFS" are different claims, and only
the second one survives closing the tab.

**Treat known noise explicitly, never with a blanket ignore.** The suites tolerate
exactly two things and say so: the `/favicon.ico` 404 (the app declares no favicon)
and ~38 `Network error for null` console errors per Java session, which are CheerpJ
probing optional JVM paths absent from its CDN. Anything else fails the run.
