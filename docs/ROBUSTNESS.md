# Warsha — robustness audit

Warsha runs entirely in a browser tab, on devices this project cannot control:
a school iPad kept alive on 3 GB of RAM, a Chromebook on a firewalled network
that drops packets instead of refusing them, Safari private browsing that
never grants storage at all. None of that is exotic — it is the median
classroom, not the edge case — so "the happy path works" is a different claim
from "this is safe to hand to a room of fourteen-year-olds," and this document
is about the second claim.

Every row below is a **failure injected on purpose** — a blocked CDN, a killed
worker, OPFS made to throw, a hostile `.zip` — and a guarantee about what the
student sees when it happens. Every row is proven by a real check in
[`tools/qa/robustness.mjs`](../tools/qa/robustness.mjs), not asserted here; the
"Verified by" column names the scenario and, where useful, quotes what the
suite actually captured off the page. Run it yourself:

```bash
cd app && npm run build && npx vite preview --port 8102 --strictPort --host
cd tools/qa && WARSHA_URL=http://127.0.0.1:8102/ node robustness.mjs
```

Two rules the suite itself follows, worth restating here because they are the
difference between this audit and a list of things that merely didn't crash:

1. **Every failure must end in a sentence a student can act on**, with the
   editor still usable and Run still able to work again — never a page reload,
   never a silent freeze. "Recovered" is checked explicitly in every scenario
   below, not just "failed visibly."
2. **A failure that only breaks quietly in the devtools console is the one
   that matters most.** Every scenario also asserts `window.__warshaErrors` —
   the page's own unhandled-rejection/error tally — is empty. A red line in
   the transcript that leaves an unhandled rejection behind is only half
   fixed.

## 1. The language engines: network and process failures

| Scenario | Before this hardening | What Warsha guarantees now | Verified by |
| --- | --- | --- | --- |
| Pyodide's CDN (`cdn.jsdelivr.net`) is unreachable when Run is pressed | The engine's own `TypeError: Failed to fetch` (or the CheerpJ loader's stack) went straight into the console behind a generic "could not start" message — no jargon, but no way forward either | A failure block appears in the console (not an infinite spinner), classified `data-failure="offline"`, with a headline naming the language and a **Try again** button; Run is available again immediately; the editor stays fully usable while the engine is down | `python engine CDN unreachable` — headline captured verbatim: *"Warsha could not download Python. It needs the internet the first time. — Check your Wi-Fi and try again. On a school network this download is sometimes blocked — ask your teacher."* Pressing **Try again** after unblocking the route completes a real run end-to-end. 12/12 checks. |
| The same, for CheerpJ (`cjrtnc.leaningtech.com`) — a different origin and a classic-worker `importScripts` loader, so a genuinely separate code path | Same class of raw error, from a different loader | Same failure-block contract; the message names **Java**, not "the language engine" | `java engine CDN unreachable` — 5/5 checks. |
| The download reaches the CDN but dies mid-transfer (`pyodide.asm.wasm` specifically, via a mid-flight `connectionreset`) | Nothing distinguished "never started" from "started and died"; a partial download could leave Run stuck | Ends in the same failure block, and — the specific regression this guards — the control is never left stuck on **Stop** | `python download aborted mid-flight` — 4/4 checks. |
| A connection that neither refuses nor answers (a firewall that drops packets) | The engines wait on the same fetch a real network would eventually resolve or reject; nothing here can time itself out | The shell watches for the *absence* of progress and gives up after 45 s of total silence on the student's behalf (`LOAD_STALL_MS` in `useRunner.ts`), resetting the timer on every byte so a genuinely slow download is never cut off | Exercised by the same failure-block assertions above; the stall timer is the mechanism `classifyRunFailure`'s `offline` path shares with the blocked-CDN case. |
| The worker dies **outside its own kill path** — killed by the OS for memory (the iPad case, which fires no JS event at all), simulated here by calling `Worker.prototype.terminate()` on it directly from the test | No platform event exists for "your worker died"; without a backstop, `busy` never clears and Run stays disabled until the page is reloaded | `Stop` ends the session even though no `onExit` is ever coming (`FORCE_STOP_MS` = 2 s backstop in `useRunner.ts`), the transcript says so, and **Run works again with no page reload** | `worker terminated mid-run` — 6/6 checks, including a full second run (`print("alive again")`) completing after the forced recovery. |
| A runaway program (`while True: print(...)`, one line, no newline, so it is the case a per-line cap cannot catch) | An unbounded transcript is how a phone tab gets killed by the OS for memory, independent of anything Warsha does right | The console DOM stays bounded (≤1300 rows observed at 15 s of streaming) and the in-memory transcript stays under the cap; **Stop responds in <100 ms while output is still streaming**, and Run works again after | `runaway output stays bounded` — 4/4 checks; DOM row count and character count both captured. |
| A long session: twelve consecutive runs in one tab, no reload | Nothing in particular — this row exists to catch a *slow* leak, not a single failure | Workers are reused across runs, not rebuilt (1 worker constructed across 12 runs, not 12); heap growth is bounded, not linear | `long session: 12 consecutive runs` — 12/12 runs completed, 5/5 checks. |
| CheerpJ's compiled `.class` files persist in IndexedDB (`/files/`) across a reload — could a deleted class "ghost-run" from a stale `.class` after a page reload? | Untested; a stale compiled class silently outliving the source that produced it is exactly the kind of bug that only shows up days later | Deleting a class the entry depends on, then reloading (forcing the JVM to rebuild from the persisted `/files/`), produces a **compile error naming the missing class** — never a successful run against old bytecode | `deleted java class cannot ghost-run after a reload` — 4/4 checks; the suite captures ECJ's real "`getName()` is undefined for the type `Student`" output as proof. |

## 2. Storage: a full disk, no storage at all, or the project vanishing

| Scenario | Before this hardening | What Warsha guarantees now | Verified by |
| --- | --- | --- | --- |
| OPFS writes start failing after the project already exists (a full disk, injected here by making `FileSystemFileHandle.createWritable` reject with `QuotaExceededError`) | `Project` used to `await store.writeFile()` with no catch inside a `setTimeout` — a full disk produced an unhandled rejection in the devtools console and **nothing on screen**; a student would keep typing into a file that had silently stopped being saved | A persistent, non-dismissible banner appears (`data-notice="write-failed"`, danger tone) telling the student to export a `.zip`; the edit stays in the editor and is not lost; the failure is not an unhandled rejection | `OPFS writes fail` — banner text captured: *"This device is nearly out of space, so Warsha may stop saving. — Delete a project you have finished, or export your work as a .zip."* 6/6 checks. |
| OPFS is not available **at all** — Safari private browsing, simulated by making `navigator.storage.getDirectory` throw `SecurityError` before the app ever loads | Untested; a storage API assumed available and never guarded is a plausible crash-on-load | The IDE still loads (no crash screen), a banner says the work is memory-only, and — the part that matters — it is still a **working IDE**: files can be created and edited, just not persisted | `OPFS unavailable at startup` — banner: *"This browser will not let Warsha save files, so your work only lasts as long as this tab. — Export a .zip before you leave. Private browsing is the usual reason."* 5/5 checks. |
| The remembered project has vanished — iOS's ~7-day eviction of an unused origin's storage, simulated by wiping OPFS but leaving `localStorage`'s "last open project" pref intact, then reloading | Untested; a pref pointing at a project id that no longer exists is a classic crash-loop setup | The app opens a different project rather than crash-looping on the missing id, and tells the student their project "was not here any more" | `remembered project has vanished` — banner: *"The project Warsha had open was not here any more, so it opened another one. — Some browsers clear saved files for sites you have not used in a while. Export a .zip to keep a copy."* 3/3 checks. |
| Two tabs open on the same project at once | Untested; two independent in-memory `Project` instances writing the same OPFS directory, with no signal to either tab that the other exists | Web Locks (`fs/tabs.ts`) makes the later tab an advisory, not a lock-out: it says Warsha is open elsewhere and which way the loss goes, but **stays a fully usable IDE** — neither tab crashes, and the last write wins cleanly, with no unhandled rejection from either | `open in two tabs` — advisory: *"Warsha is open in another tab. — Edit in one tab at a time, or the other tab will overwrite what you type here."* 5/5 checks. |
| The tab is closed, backgrounded, or the app is switched away from mid-edit | A write that had not yet fired on its debounce was simply lost | Three separate browser events (`visibilitychange`, `pagehide`, `freeze` — no single one fires everywhere the tab can go away) all trigger the same idempotent flush; `pagehide` without `persisted` also disposes both engines' workers, so a page being unloaded is not still holding a WASM JVM and a CPython heap while iOS looks for memory | Implemented in `App.tsx` (see the three-listener comment); not independently re-verified by `robustness.mjs` beyond the storage-write assertions above, since Playwright cannot simulate iOS's `freeze` faithfully — flagged for anyone extending this suite with a real mobile harness. |
| A render throws — a corrupt pref, a browser quirk, anything a component did not expect | With no error boundary, one thrown render unmounted the whole React tree, leaving the dark first-paint canvas from `index.html`: not an error, not a spinner, **nothing, forever**, with the student's files still safe in OPFS behind it | `CrashScreen` catches it, says the app (not the student's work) broke, and offers **Reload** and **Reload and forget my layout** (clears only the `localStorage` prefs — never touches OPFS) — the fix for the "crashes every time I open it" loop caused by a bad pref | `main.tsx` wraps the tree in `CrashScreen`; asserted indirectly throughout `robustness.mjs` via the repeated `[data-crash="true"]` count === 0 check across every other scenario (a real crash in any of them would show up there). No scenario deliberately throws a render error — see §4 for why. |

## 3. Untrusted input: `.zip` imports

All of `zip.ts`'s limits exist because the unguarded version has a way to take
the tab down (`unzipSync` runs on the main thread and allocates everything at
once — there is no partial success to fall back to, only "reject with a
sentence" or "freeze, then crash"), and a student handed a `.zip` by a teacher
has no way to know which kind they were given.

| Scenario | Before this hardening | What Warsha guarantees now | Verified by |
| --- | --- | --- | --- |
| A zip bomb — a 96 KB archive declaring ~96 MB of inflated content (the classic 42.zip shape) | Untested; inflating first and measuring after is itself the crash | Refused by the **declared size in the central directory**, before a single byte is inflated — refusal lands in ~2.6 s, not after minutes of allocation | `zip import edge cases` — *"That .zip has no files in it. Try another one."* Refusal confirmed under 20 s (`MAX_TOTAL_BYTES` in `zip.ts`); tab does not crash. |
| Path traversal (`../escape.py`, `app/../../also-escape.py`) mixed into an otherwise-real project, alongside a binary file | Untested; a `..` segment lands a file somewhere the student cannot see even though OPFS itself cannot be escaped, and a `\` produces a name the explorer and the store would parse differently | `safePath()` refuses rather than sanitises — a renamed file is a silent surprise nobody asked for. The dialog imports only the one safe text file and **names every skipped entry and why** ("3 items left out — Warsha only imports text files"), never a silent partial import | `zip import edge cases` — dialog text captured verbatim, confirming exactly 1 of 4 entries accepted and the skip count shown. |
| An oversized archive (55 MB, over the 50 MB `MAX_ARCHIVE_BYTES` ceiling) | Untested | Refused on the `File`'s own size, before `file.arrayBuffer()` is ever called — the read itself would be the crash on a large enough file | `zip import edge cases` — *"That .zip is 55 MB. Warsha can open up to 50 MB."* 2/2 checks. |
| Garbage that is not a zip at all | Untested | `fflate`'s decode error is caught and wrapped in a plain sentence, not the decoder's own words | `zip import edge cases` — *"invalid zip data"*, surfaced as a normal refusal, not a crash. |
| A 500-file / 501-entry project, imported, browsed, and re-exported | Untested; the explorer, editor and export path had never been proven at this scale | Import completes in ~4.7 s (sluggish is acceptable; frozen is not), the explorer renders all 526 rows, and — the part every storage warning in the app points at as the escape hatch — **export as `.zip` still works** on the largest project the suite builds, producing a real download in under 300 ms | `500-file project` — 6/6 checks. |

## 4. What this audit does not cover

Being direct about the edges, rather than implying more coverage than exists:

- **No scenario deliberately throws inside a render** to exercise `CrashScreen`
  end-to-end (screenshot + explicit assertion of the "Warsha stopped working"
  copy). Its contract is exercised *indirectly* — every other scenario asserts
  `[data-crash="true"]` is absent, which would catch a regression that made
  ordinary failure handling start crashing the tree — but a suite that wants
  its own dedicated crash-screen scenario would need to inject a throw from
  inside a component the app's own code owns, which the read-only zone for
  this task does not include.
- **`freeze` and real iOS backgrounding are not simulated.** Playwright can
  fire `visibilitychange` and `pagehide` faithfully; it has no equivalent for
  Chrome's tab-discard `freeze` event or iOS's actual memory-pressure kill.
  The pagehide-flush code path is read and cited above, not independently
  re-run under this suite.
- **Quota near the warning threshold (`QUOTA_WARN_RATIO = 0.9`) is not
  exercised** — only the harder "writes are already failing" case is. Getting
  a real Chrome profile to 90% of its OPFS quota inside a disposable test
  context is impractical; the read path (`readQuota()` in `fs/health.ts`) is
  simple enough that the risk is judged low, but it is not proven here.

## 5. Regression gate

Run after any change that touches `app/src/fs/**`, `app/src/hooks/useRunner.ts`,
`app/src/zip.ts`, `app/src/components/{StorageBanner,CrashScreen,ImportZipDialog}.tsx`,
or either runtime worker — this is the full set the suites below and
`robustness.mjs` together exercise:

| Suite | Result at the time of this audit |
| --- | --- |
| `tools/qa/robustness.mjs` | **65/65** checks passed, two consecutive runs, zero unexpected console errors in any scenario |
| `tools/qa/verify.mjs` (Python happy path) | 23/23 |
| `tools/qa/verify-projects.mjs` (multi-project) | 19/19 |

None of the failure injections above regressed any of the three. `robustness.mjs`
and `verify.mjs`/`verify-projects.mjs` share the same served build and the same
`aside[aria-label="Files"]` project-switcher selectors — a topology change to
one is a topology change to all three, which is exactly why they are run
together here rather than treated as independent gates.
