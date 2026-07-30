# Spike: interactive Python in the browser (Pyodide) — findings

**Verdict: VIABLE-WITH-CAVEATS.** All four required behaviours work in a real browser
with no server, no build step, and no COOP/COEP headers from the host: multi-file
imports, progressively streamed stdout, blocking `input()`, and a Stop button that
kills an infinite loop without reloading the page. The caveats are payload size
(~11.6 MiB cold), one forced page reload on a visitor's first ever visit, and the
fact that **no actual iPad was tested** — verification was Chrome on Linux.

The three Education acceptance criteria (output visible before a read blocks,
`input()` blocks rather than hitting EOF, inline echo) **all pass** — see
[Prompt-before-read acceptance criteria](#prompt-before-read-acceptance-criteria).

Files: `index.html` (page + main-thread wiring), `worker.js` (Pyodide worker),
`coi-serviceworker.js` (vendored, v0.1.7, unmodified). Serve the directory over
HTTP and open `index.html`. The page carries four selectable programs:
`multi-file + input`, `prompt-before-read` (the acceptance tests),
`traceback`, and `infinite loop`. `screenshot-working.jpg` shows a full session;
`screenshot-prompt-before-read.jpg` shows the acceptance tests passing.

## Pyodide version and loader

Pyodide has switched to a version scheme that tracks CPython. The current release
is **314.0.3** (published 2026-07-24) and it ships **Python 3.14**. The old
`0.2x.y` line still exists on the CDN (`0.29.4` was the last of it), so don't
assume `0.28.x` is newer than `314.x` — it isn't.

```
https://cdn.jsdelivr.net/pyodide/v314.0.3/full/pyodide.mjs
```

Loaded with `loadPyodide({ indexURL })`, where `indexURL` is that same
`.../v314.0.3/full/` directory so the wasm and stdlib resolve next to the loader.
Pin the version explicitly; there is no `latest` alias worth relying on.

## The single most important wiring decision: use a *module* worker

`new Worker("worker.js", { type: "module" })`, and pull the loader in with
`await import(...)`. **Do not use a classic worker with `importScripts()`** — it
fails, and the failure is subtle enough to lose a day to.

`importScripts()` fetches in `no-cors` mode. `coi-serviceworker` intercepts every
fetch and re-issues it, and a cross-origin `no-cors` response comes back *opaque*
(`type: "opaque"`, `status: 0`). The shim explicitly passes opaque responses
through untouched, so the browser never gets to see jsDelivr's CORP header, and
under `COEP: require-corp` it blocks the script:

```
NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope':
The script at 'https://cdn.jsdelivr.net/pyodide/v314.0.3/full/pyodide.js' failed to load.
```

Module script fetches are always CORS-mode, so the shim receives a real response,
rewrites the headers, and the load succeeds. This matters because the shim lands
in **either** COEP mode depending on its own degrade heuristic — both
`credentialless` and `require-corp` were observed in a single test session on one
browser. Only the module-worker variant works in both.

Helpfully, jsDelivr already sends `access-control-allow-origin: *` **and**
`cross-origin-resource-policy: cross-origin` on the Pyodide assets, so the CDN is
cross-origin-isolation compatible and does not need to be self-hosted. Self-hosting
is still the more robust long-term choice (removes a third party from the critical
path and makes everything same-origin), at the cost of ~11.6 MiB in the repo.

## Blocking `input()` — SharedArrayBuffer + Atomics

The mechanism that makes this work is that **Pyodide's `stdin` handler is
synchronous**. `pyodide.setStdin({ stdin })` takes a zero-argument function that
returns a full line as a string (Pyodide appends a newline if missing; return
`undefined` for EOF, which surfaces in Python as `EOFError`). Because Pyodide
calls it synchronously and we run Python with the synchronous `runPython`, the
handler can simply refuse to return until a line is available — and in a worker,
blocking the thread is fine.

Layout of the one `SharedArrayBuffer` (`8 + 65536` bytes):

| region | type | meaning |
| --- | --- | --- |
| offset 0 | `Int32Array[0]` | state: `0` = no data (worker parks here), `1` = line ready, `2` = EOF |
| offset 4 | `Int32Array[1]` | byte length of the pending line |
| offset 8 | `Uint8Array` | the UTF-8 line bytes |

Worker side, inside the `stdin` handler: store `0` into the state slot, `postMessage`
a `stdin-request` to the page, then loop on `Atomics.wait(ctrl, 0, 0, 250)` until the
state changes. Read the length, copy the bytes out of the shared buffer *before*
decoding, reset the state to `0`, return `text + "\n"`.

Main-thread side, when the user submits a line: `TextEncoder` into the shared byte
region, `Atomics.store` the length then the state, then `Atomics.notify(ctrl, 0)`.

Two details worth keeping:

- The `Atomics.wait` uses a 250 ms timeout in a loop rather than parking
  indefinitely. Functionally identical here, but it is the documented place to call
  `pyodide.checkInterrupt()` if we later add cooperative interrupts.
- Return `text + "\n"` explicitly rather than relying on Pyodide's newline
  fixup, so that an empty line stays an empty line instead of looking like EOF.

Verified: three sequential `input()` calls in one program, mid-execution, with real
keystrokes into the page.

## stdout/stderr — use a `write` handler, not `batched`

```js
pyodide.setStdout({ isatty: false, write(buf) { post(decode(buf)); return buf.length; } });
```

`batched` is the convenient option but it hands you a string with no indication of
whether it was a complete line or a flushed partial, so `print(x, end="")` and
`input()` prompts get mangled into separate lines. The `write` handler receives the
exact bytes and is what a console pane wants.

Streaming was verified to be genuinely progressive, not a dump at the end: a loop
of five unflushed `print()`s spaced by `time.sleep(0.4)` arrived one at a time
(output length measured growing across 400 ms samples), and a `print(..., end="",
flush=True)` partial line rendered before the rest of its line existed.
`time.sleep()` blocks properly inside a worker.

### `isatty` changes which stream `input()` prompts go to

This cost real debugging time, so: with `isatty: true`, CPython takes its readline
path and writes the `input()` prompt to **stderr**. A console that colours stderr
red will paint every student prompt red. With `isatty: false` the prompt goes to
stdout, where it belongs.

Output streams progressively in **both** modes, so `isatty: false` is a free win
and is the default here. `?isatty=1` on the page URL flips it if you want to
compare. (Note: `isatty: true` cannot be combined with a `batched` handler at all.)

## Prompt-before-read acceptance criteria

All three hold, verified in the browser with the `prompt-before-read` program. The
test method matters: for each read, the page waits for the input box to appear,
then records what is **already on screen while still blocked with nothing sent**,
and only then submits a line. Every case deliberately omits `flush=True`.

| case | source | last line on screen *while blocked* |
| --- | --- | --- |
| A | `input("A) ... -> ")` | `A) input('prompt: ') -> ` |
| B | `print("B) ... -> ", end="")` then bare `input()` | `B) print(end='') then bare input() -> ` |
| C | `sys.stdout.write("C) ... -> ")` then bare `input()` | `C) sys.stdout.write() then bare input() -> ` |
| D | three chained `print(..., end="")` then `input(" -> ")` | `D) partials: one two -> ` |
| E | bare `input()` on an empty screen | (blocks; see below) |

**(1) Output appears before the read blocks — yes, with no flush needed.** This
holds for the `input()` prompt argument, for `print(..., end="")`, for a direct
`sys.stdout.write()`, and for several chained partial writes. Nothing is stranded
in a buffer. Two independent reasons it works: the `write` handler is byte-level
(no line buffering in our layer at all), and CPython's `input()` flushes stdout
before reading. **No workaround is required**, and in particular there is no need
to force `flush` or reconfigure the stream. If a future Pyodide changes this, the
fix would be `sys.stdout.reconfigure(write_through=True)` in the runner, or
flushing from the stdin handler before parking.

**(2) `input()` blocks, never EOF.** Verified with a bare `input()` as the entire
program: after 4 s with nothing sent the worker was still parked, no traceback and
no `EOFError`, and the program had not finished — then it accepted the line
normally. This is structural, not luck: the handler only returns `undefined` (the
EOF signal) when the page explicitly stores state `2`, which nothing but the
dedicated EOF button does. An exhausted-input EOF is impossible by construction.

*(Caveat on my own testing: an earlier version of this check searched the console
for the substring `EOFError`, which matched the test program's own printed text
and produced a false positive. The rerun above greps for `Traceback` and checks
the not-finished state instead.)*

**(3) Inline echo — yes.** The page echoes the submitted line at the current
cursor position, so a prompt and its answer share one line:
`A) input('prompt: ') -> alpha`. The echo is written by the main thread the moment
the user submits, not round-tripped through the worker, so it appears instantly
and cannot be reordered against subsequent program output. It is wrapped in its
own span, which is what makes user input renderable in a distinct colour (blue in
the screenshot).

## What an uncaught traceback looks like

Clean, and indistinguishable from local CPython. Runtime error through a helper
module:

```
about to fail
area is 12
Traceback (most recent call last):
  File "main.py", line 6, in <module>
    r.scale(0)          # raises inside helpers/shapes.py
    ~~~~~~~^^^
  File "helpers/shapes.py", line 11, in scale
    raise ValueError(f"factor must be positive, got {factor}")
ValueError: factor must be positive, got 0
```

Both user frames appear with correct line numbers, in the student's own relative
paths, including Python 3.14's fine-grained `~~~~~~~^^^` carets. Getting there took
three fixes in the runner, all of which need to survive into the real IDE:

1. **Drop the runner's `exec` frame** (`e.__traceback__.tb_next`), or every error is
   topped with `File "<exec>", line 22, in <module>`.
2. **Strip the FS prefix** from the formatted text, or helper frames read
   `File "/home/pyodide/project/helpers/shapes.py"` while the entry file reads
   `File "main.py"` — inconsistent and noisy.
3. **Compile outside the `exec` try-block.** A `SyntaxError` is raised in the
   *runner's* frame, so it has no useful traceback and `tb_next` is `None`; the
   generic path then re-exposed the `<exec>` frame. Handled separately with
   `format_exception_only`, syntax errors now match `python main.py` exactly — no
   spurious `Traceback` header:

```
  File "main.py", line 2
    for i in range(3)
                     ^
SyntaxError: expected ':'
```

`IndentationError` behaves the same way. Note that with a syntax error nothing in
the file executes, so an earlier `print()` correctly produces no output.
`NameError` and `ZeroDivisionError` were also checked and render with correct
carets.

## Multi-file user programs

Write the files into the in-worker Emscripten FS, then execute the entry point:

```js
pyodide.FS.mkdirTree(dir);
pyodide.FS.writeFile(`${PROJECT_DIR}/${path}`, contents, { encoding: "utf8" });
```

The runner (`RUNNER` in `worker.js`) puts the project dir on `sys.path`, `chdir`s
into it, and `exec`s `main.py` with `__name__ = "__main__"`. One thing it has to do
that is easy to miss:

- **Purge `sys.modules` of anything whose `__file__` is under the project dir**
  before each run. Without this, a re-run after editing `helpers/shapes.py` keeps
  the stale cached module. Verified: editing a class's `__repr__` between runs and
  seeing the change take effect.

The runner's error handling is the other subtle part — see
[What an uncaught traceback looks like](#what-an-uncaught-traceback-looks-like).

**Maintenance trap:** the runner is a Python program embedded in a JS
`` String.raw`...` `` template, so a backtick anywhere in it (even inside a Python
comment) silently ends the template and breaks the whole worker. The symptom is
unhelpful — the page just shows `worker error: undefined` and hangs on "booting",
because a module worker that fails to parse fires an `ErrorEvent` with no message.
`node --check worker.js` catches it instantly and is worth wiring into CI, along
with extracting the runner and `compile()`-ing it as Python.

The demo program imports a class from `helpers/shapes.py` (with a base class and
two subclasses) into `main.py` — confirmed via `Rectangle.__module__` printing
`helpers.shapes`.

## Stop / kill, and what it costs

`worker.terminate()` then immediately spawn a replacement worker. Verified in both
of the states that matter:

- killing a CPU-bound `while True:` loop (mid-`print` at ~20M iterations), and
- killing a worker **parked in `Atomics.wait`** waiting for `input()`.

Both die instantly and the page keeps working — three further programs ran to
completion on the same page load with no reload.

Cost: **~1.2–2.0 s from Stop to runnable again**, entirely the fresh Pyodide boot
(worker-measured boot was 1.4–1.8 s; the rest is worker spawn plus message
latency). `terminate()` itself returns in ~1 ms.

There is no way to preserve the interpreter's state across a kill — the new worker
is a clean Python. Also note the FS is per-worker, so user files must be re-written
into the new worker before the next run (this spike writes them on every run, so it
is already handled).

**Recommended follow-up:** wire `pyodide.setInterruptBuffer(new Int32Array(sab))`
and call `pyodide.checkInterrupt()` from the stdin wait loop. That gives a graceful
`KeyboardInterrupt` path that costs nothing instead of ~1.5 s, keeping
`terminate()` as the guaranteed fallback for code that ignores interrupts. Not
implemented here.

One bug this spike hit and fixed, worth carrying into the real IDE: the Run button
must stay disabled while the replacement worker boots. Re-enabling it as soon as
the old worker dies lets a fast user post a `run` message to a worker whose
`pyodide` is still `null`.

## coi-serviceworker behaviour

`crossOriginIsolated === true` and a working `SharedArrayBuffer` were achieved with
**`python3 -m http.server` sending no COOP/COEP headers at all**, which is the
whole point — it proves deployability to any static host.

Observed behaviour, measured rather than assumed:

- **Exactly one automatic reload on a genuine first visit.** After unregistering the
  service worker and navigating fresh, the settled document reported
  `performance.getEntriesByType("navigation")[0].type === "reload"`. Subsequent
  visits report `"navigate"` with no reload. Users see one flash; anything the page
  had in memory at that moment is lost, so don't do work before isolation is
  confirmed.
- The shim sets `COOP: same-origin` plus `COEP: credentialless` *or*
  `require-corp` — it degrades between them on its own. Both modes were seen on the
  same browser in one session, which is why the module worker is mandatory (above).
- **Requires a secure context.** `localhost`/`127.0.0.1` qualifies; in production
  this means HTTPS is non-negotiable. The shim bails out silently otherwise.
- It must load before anything that touches `SharedArrayBuffer`, as a plain
  synchronous `<script>` in `<head>` (it reads `document.currentScript.src` to
  register itself, so it cannot be `async`/`defer`/bundled).
- If the host *can* set real COOP/COEP headers, the shim no-ops itself — keeping it
  in is harmless and removes the first-visit reload.

## Load times and payload

Measured on Chrome/Linux over a fast connection; treat as a floor, not a promise.

| | time |
| --- | --- |
| Cold boot (empty HTTP cache) | **2238 ms** (loader 120 ms) |
| Warm boot (assets cached) | **1228–1772 ms** (loader 6–8 ms) |
| Respawn after Stop | 1426–1772 ms worker-internal; ~2000 ms to Run re-enabled |

Payload, fetched with cache-busting to isolate transfer from compile:

| asset | size | uncached transfer |
| --- | --- | --- |
| `pyodide.asm.wasm` | 9.15 MiB | 852 ms |
| `python_stdlib.zip` | 2.43 MiB | 347 ms |
| `pyodide.mjs` / `pyodide.js` | ~19 KiB | negligible |

So ~11.6 MiB and ~1.2 s of download, with the remaining ~1 s being wasm compile
plus Python init. Warm boot is entirely compile + init; the download is
HTTP-cacheable and jsDelivr serves it with long-lived caching.

## iPad-relevant caveats

**Not verified on an iPad.** Everything above was Chrome on Linux. The specific
things I would expect to bite, in rough order of risk:

1. **Memory.** ~11.6 MiB of assets become a considerably larger wasm heap plus
   Python heap. iPadOS is aggressive about reclaiming memory from background tabs,
   and a reclaimed tab means a full 2 s+ re-boot. Older/base-model iPads are the
   risk case. This needs measuring on the real target before committing.
2. **`COEP: credentialless` is Chromium-only.** Chrome on iPad is WebKit
   underneath, so it will use `require-corp` — the mode in which `importScripts`
   broke. The module worker handles this, and jsDelivr's `CORP: cross-origin`
   header is what makes the CDN usable at all under `require-corp`. Any *other*
   cross-origin asset we add later must also send CORP or be same-origin.
3. **Backgrounding.** iPadOS throttles and can suspend workers in background tabs.
   A program parked in `Atomics.wait` for input while the student switches apps may
   stall; on resume it should continue, but this is untested and worth a timeout or
   a visible "waiting for input" state.
4. **Software keyboard.** The input row must stay visible above the on-screen
   keyboard. The spike uses a plain `<input>` with `autocapitalize`/`autocorrect`
   disabled — both are essential, since iOS would otherwise capitalise and
   autocorrect Python input. Needs `visualViewport`-aware layout in the real IDE.
5. **`SharedArrayBuffer` needs Safari 15.2+** with COOP/COEP, which is old enough
   not to be a practical concern in 2026, but the page does degrade gracefully: it
   shows a red banner and explains that blocking `input()` is unavailable rather
   than throwing.
6. **Cold download on school wifi.** 11.6 MiB is the number to design around —
   consider a loading screen with real progress, and self-hosting so the assets sit
   behind the same cache/CDN as the app.

## Known rough edges in this spike (deliberate, not blockers)

- One `postMessage` per `write` call. Fine for teaching-sized output, but a program
  printing in a tight loop will flood the main thread. The real IDE should coalesce
  writes in the worker on a short timer or a size threshold.
- stdin lines are capped at 64 KiB by the shared buffer; longer input is rejected
  with a message rather than chunked.
- No `micropip` / third-party package loading was tested — only the stdlib.
- Nothing enforces a stdout rate limit, so `while True: print(x)` floods the
  console until Stop is pressed. Needs a cap in the real IDE.
- No interrupt buffer (see the Stop section), so every Stop pays the re-warm.
- The editor is three plain `<textarea>`s; file set is fixed per demo program.
