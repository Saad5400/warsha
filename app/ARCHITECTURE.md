# Warsha — architecture

A browser-only, static IDE for students: file explorer, editor tabs, CodeMirror 6 editor, console
with stdin, one Run/Stop control. No server, no backend, no accounts.

**Stack:** Vite + React 19 + TypeScript + Tailwind CSS v4 · CodeMirror 6 · fflate · OPFS.

```
npm install
npm run dev       # localhost:8083
npm run build     # tsc --noEmit && vite build  →  dist/ (fully static, deploy anywhere)
npm run preview   # serve dist/ on 8083
```

---

## 1. Module map

| Path | Responsibility |
| --- | --- |
| `src/main.tsx` | Mounts React inside ToastProvider + DialogProvider. |
| `src/App.tsx` | The controller: owns tabs, active file, entry point, layout state, file operations, templates and zip. Wires everything; holds no presentation. |
| `src/capabilities.ts` | Startup feature detection (WebAssembly, Workers, OPFS, cross-origin isolation) → fatal / warn / ok. |
| `src/copy.ts` | Every student-facing string, from DESIGN-SPEC §8. Items marked PLACEHOLDER await Design's final wording. |
| `src/console/buffer.ts` | The transcript. Chunk-based (not line-based), batched notification, 5000-line head-dropping cap. Plain TS, no React. |
| `src/editor/setup.ts` | All CodeMirror wiring: per-file state cache, lazy grammars, compartments. Plain TS. |
| `src/ui/viewport.ts` | Keyboard-aware shell geometry: publishes `--app-h`, `--kb-inset`, `html[data-kb]`. |
| `src/runtime/types.ts` | **The runtime contract.** `SourceFile`, `LoadProgress`, `RunIO` (incl. `onRender`), `RunContext`, `RunSession`, `RuntimeKind`, `Runtime`. |
| `src/runtime/index.ts` | Runtime **registry** + entry-point resolution + `isPreviewEntry`. |
| `src/runtime/web.ts` | `WebRuntime` — the `kind: 'preview'` engine for a **page** (html/css entry). Assembles the project into one sandboxed document, inlining local `<link>`/`<script>` refs and bridging its console back. No download, no worker. |
| `src/runtime/js.ts` | `JsRuntime` — the `kind: 'console'` engine for a **standalone script** (js/ts/mjs/tsx… entry). Runs it headless in a Web Worker (Node-like: a global, `console`, timers, `fetch`, **no DOM**), streaming `console.log`/errors as stdout/stderr and exiting when the event loop idles. Plain one-file JS runs raw (instant); TypeScript or a script that imports another file is bundled first (`bundle.ts`). JS *inside* a page is inlined by `WebRuntime` instead. |
| `src/runtime/bundle.ts` | **In-browser bundler** (esbuild-wasm, ~12 MB fetched once from `public/warsha-esbuild.wasm`, cached + offline). `bundleProject()` transpiles TS/TSX/JSX and resolves cross-file relative imports against the in-memory `SourceFile[]` via an onResolve/onLoad virtual-fs plugin; network refs stay external. Shared by `js.ts` (and, later, `web.ts`'s module scripts). |
| `src/runtime/fake.ts` | `FakeRuntime` — fakes download/unpack/boot/run so the shell is demoable without an engine. |
| `src/fs/types.ts` | `ProjectStore` + `FsSnapshot`: the storage seam. |
| `src/fs/opfs.ts` | `OpfsStore` (default) and `MemoryStore` (fallback); `createStore()` picks. |
| `src/fs/project.ts` | `Project` — in-memory source of truth, tree building, debounced persistence, change events. |
| `src/fs/prefs.ts` | UI state in `localStorage` (font size, console height/collapsed, open tabs, entry, handedness). |
| `src/templates.ts` | **Generated** from `content/templates/` — see §5. Each starter carries a `level` (beginner / intermediate / advanced); a ready language owns one per level. |
| `src/languages.ts` | The language catalogue the picker projects: which languages exist, which are `ready` (an engine is wired in runtime/index.ts) vs `soon` (a dimmed, unpickable promise). Grows as engines land. |
| `src/zip.ts` | Export/import `.zip` via fflate. |
| `src/hooks/useProject.ts` | Binds `Project`'s events to a React revision counter. |
| `src/hooks/useRunner.ts` | The run state machine: status, progress, stdin buffering, kill, escalation timers. |
| `src/hooks/useMedia.ts` | `useMedia` (the <900px threshold) and `useKeyboardOpen` (reads `html[data-kb]`). |
| `src/index.css` | Token import + Tailwind theme mapping + the few things utilities cannot express. |
| `public/coi-serviceworker.js` | Vendored v0.1.7, **plus a Warsha offline caching layer**. Buys cross-origin isolation on a header-less static host, and serves the app shell + Python runtime offline (Java partially cached, not guaranteed offline) — see §2.5. |

### Components

Small and boring on purpose — roughly one file per box on screen.

| Component | Notes |
| --- | --- |
| `TopBar` | Docked (≥900px, explorer open): an empty leading spacer, sized to the sidebar column, purely so its trailing divider still lands on the sidebar/editor boundary. Collapsed (≥900px, explorer off): the project switcher takes that spot instead, since there is no sidebar to carry it. Phone: hamburger + file title + overflow menu. No logo, no wordmark anywhere in it (LAYOUT-VSCODE §1b) — brand lives on the welcome panel, the favicon and the OG image only. |
| `Explorer` | Tree, long-press/⋯ menu, create/rename/delete. |
| `Tabs` | Horizontal strip, dirty dot, close. |
| `Editor` | ~40-line shell around `editor/setup.ts`. |
| `Console` | The transcript, the live stdin line inside it, and the sticky status foot. |
| `Preview` | The output pane's second face: one sandboxed iframe (`allow-scripts`, **no** `allow-same-origin`) that loads the Web runtime's assembled `srcdoc`. Shown for a web project; the Console shows the transcript for Java/Python. |
| `RunBar` | The console header: Run/Stop, status pill, entry picker, Clear, collapse — plus the Preview \| Console toggle for a web project. |
| `ConsoleDivider` | Drag-resize handle (≥900px only). |
| `ProgressBlock` | First-run engine download (bar, byte counter, phase). |
| `StatusPill` | The seven run states. |
| `WelcomePanel` | The empty project's editor area, and the whole first-run experience: two start cards (New file / New from a starter → the picker) plus Import .zip, the first-run download note and the storage line. Rendered by `App` **instead of** `Tabs` + `Editor` while `project.isEmpty()`, so there is no welcome page, no route and no language gate — a starter is an action inside the IDE, and language comes from file extensions. |
| `TemplatePicker` | The one entry point for starting any project (WelcomePanel's card and the project menu's single "New project…" both open it): a grid of languages from `languages.ts` — ready above `soon` — then the chosen language's starters grouped by level. It resolves to a starter or to "blank" and leaves the create/fill decision to `App`. This is what keeps the project menu one row wide as the language list grows. |
| `ImportZipDialog` | One dialog for the whole import: drop zone or file picker, what the .zip contains, what it replaces, confirm. |
| `CapabilityScreens` | Fatal screen + dismissible warning banner. |
| `FileBadge`, `Logo` | Language badges; inlined logo that recolours via custom properties. |
| `ui/Button`, `ui/Dialog`, `ui/DialogProvider`, `ui/Menu`, `ui/Toast` | shadcn-style primitives, hand-rolled on Tailwind. Native `<dialog>` for focus trapping and Escape. |

---

## 2. Plugging in a real runtime

**Two files, and only one of them is required.**

1. **Write the engine** — a class that `implements Runtime` from `./types`. Both real engines live
   outside `app/`, under `runtimes/<lang>/src/`, each keeping its own mirror of the contract so it
   never imports from `app/`.
2. **Register it** — in `src/runtime/index.ts`, which is the whole seam:

```ts
const registry: Record<LangId, Runtime> = {
  java: new JavaRuntime({ workerUrl: new URL('warsha-jvm.worker.js', document.baseURI).href }),
  python: new PythonRuntime(),
}
```

Nothing in `src/components/` or `src/App.tsx` imports a concrete runtime — they only ever call
`runtimeFor(entryPath)`.

**The one cross-engine constraint:** Vite's `worker.format` is a single global setting, and the two
engines need opposite worker types — Pyodide needs a module worker, CheerpJ's loader only works as a
**classic** one. So `worker: { format: 'es' }` serves Python, and Java's worker sidesteps Vite's
worker pipeline entirely: `npm run assets` (wired to `prebuild`/`predev`) copies it into `public/`
and it is loaded from there by URL. That script also fetches `ecj.jar` into `public/`; both are
gitignored build products. See `runtimes/java/INTEGRATION.md` §2–§3.

### What the shell guarantees

- `load(onProgress)` runs before every run; make it **idempotent** — the shell relies on the second
  call being cheap, and on a cache hit reporting *nothing*, because the progress block must not appear
  twice (if a student sees the download UI on run #2, caching is broken).
- `run(files, entryPath, io)` gets **all** project files, saved first. Paths are project-relative,
  `/`-separated, no leading slash (`app/Main.java`, `helpers/shapes.py`).
- `onStdout`/`onStderr` take **raw chunks**; partial lines are expected and render immediately
  (`System.out.print("Your name: ")` puts the live input on the same visual line as the prompt).
- `onExit(code)`: `0`/`n` for a real exit, `null` for killed. The shell shows *Finished*, *Stopped
  early* or *Stopped by you* accordingly — and "stopped by you" is deliberately neutral, not an error.
- After `kill()`, send exactly one `onExit(null)`. Output from a superseded run is discarded by a run
  token, so you need not be perfect about it.

### Two rules that will bite you

**1. Arm your stdin reader before announcing the request.** A student can press Enter *before* the
program reads. The shell buffers that line and hands it over the moment `onStdinRequest()` fires:

> Your session must accept `writeStdin(line)` immediately after `onStdinRequest()` returns.

The shell also defers the buffered hand-off by one macrotask, so it never calls `writeStdin` *during*
your `onStdinRequest()` call. `FakeRuntime.askStdin()` shows the correct pattern — the resolver is
assigned inside the promise executor, before the request is announced.

**2. Progress is structured, and strings still work.** Per DESIGN-SPEC §7.6 the contract widened:

```ts
load(onProgress: (p: LoadProgress | string) => void): Promise<void>
// LoadProgress = { phase: 'download'|'unpack'|'boot'|'compile', message, loaded?, total? }
```

`loaded`/`total` are what make a determinate bar and a byte counter possible. An engine written
against the original `(msg: string)` signature keeps working untouched — `normalizeProgress()` wraps
it and the UI degrades to an indeterminate sweep. Report bytes whenever `Content-Length` is known.

### 2.5 Host prerequisites the engines depend on (already wired)

Three config items are in place so that dropping a real engine in does not turn into an afternoon of
misleading symptoms. All three come from `runtimes/python/INTEGRATION.md`, which verified them against
a real Vite build and a real dev server.

- **`worker: { format: 'es' }`** in `vite.config.ts`. The engines create their worker with
  `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`. Vite's default `iife`
  wraps the emitted worker chunk and rewrites `import.meta.url` inside it, which lands you on the
  classic-worker failure: `importScripts` fetches no-cors, coi-serviceworker passes the opaque
  response through untouched, and `COEP: require-corp` then blocks the loader. A module worker is
  mandatory here.
- **`server.fs.allow: ['..']`**. Needed twice over: `docs/design/tokens.css` is imported in place from
  outside `app/`, and `vite dev` otherwise returns 403 for the engines' `worker.js` under `runtimes/`
  — which surfaces to the user as `worker failed to start`, with `.ts` files still served fine, so
  the failure looks selective and misleading. Production builds are unaffected.
- **`public/coi-serviceworker.js`, loaded as the first thing in `<head>` as a plain synchronous
  `<script>`.** It reads `document.currentScript.src` to register itself, so `async`, `defer`,
  `type=module` and bundling all break it, and it must run before anything touches
  `SharedArrayBuffer`. It **must** live in `public/` — beside `index.html` Vite refuses to bundle it,
  leaves the tag in `dist/index.html` and does not copy the file, giving a 404 in production and no
  `SharedArrayBuffer`. Verified in this build: `dist/coi-serviceworker.js` is emitted and the tag
  survives unbundled.

  This same worker also carries **Warsha's offline caching layer** (added on top of upstream coi; the
  header transform is byte-identical). On `install` it precaches the app shell — the build-hashed
  JS/CSS, injected as `self.__WARSHA_PRECACHE__` by the `warsha:sw-precache` plugin in
  `vite.config.ts`, plus `index.html`, the manifest and the icons. Its `fetch` handler is cache-first
  for the shell and the two runtime CDNs (`cdn.jsdelivr.net/pyodide/`, `cjrtnc.leaningtech.com`) and
  network-first for navigations with a cached-`index.html` fallback, so after one online visit the
  app shell opens with **no network**. One carve-out is load-bearing: **requests carrying a `Range`
  header bypass the cache entirely** (network only, never stored). CheerpJ reads `/app/ecj.jar` — a
  same-origin GET, so otherwise cache-first — in many HTTP Range requests and needs a `206` +
  `Content-Range` on each; the Cache API ignores the `Range` header and would replay the full stored
  `200`, so a single cached full-body `ecj.jar` (CheerpJ's own whole-jar refetch after a flaky range
  leaves one) would poison every later range read and Java would stop starting. Range requests going
  straight to the network keep CheerpJ on the exact byte-range path it had before this layer existed;
  `tools/qa/sw-range.mjs` guards it. Cache Storage is kept from eviction by the same
  `requestPersistence()` (`fs/health.ts`) that protects OPFS. Runtime coverage differs by engine and
  is deliberate: **Python (Pyodide) works fully offline** — jsdelivr serves it over CORS, so every
  piece caches. **Java (CheerpJ) is not guaranteed offline**: it pulls its loader via a no-cors
  `importScripts()` (an opaque response we refuse to store — opaque entries are quota-padded by Chrome
  and would risk evicting OPFS) and lazily fetches runtime pieces it never touched on the first run.
  The bulk of CheerpJ (`cj3.wasm` et al., fetched CORS) still caches, so it is persisted, just not
  offline-complete. `tools/qa/offline-check.mjs` asserts the shell + Python offline; Java offline is a
  known limitation. Two departures
  from upstream: (a) it registers **even when the origin already sends the isolation headers**
  (production nginx), because the worker is now needed for offline, not only for headers; (b) the
  isolation *reload* is gated on `!crossOriginIsolated`, so a header-less host still reloads exactly
  once and an already-isolated page registers with none.

Effect, verified locally on `vite preview` (which sends no COOP/COEP headers of its own):
`crossOriginIsolated === true`, `SharedArrayBuffer` present, and the capability warning banner
disappears. A first visit costs one automatic reload while the service worker activates, so
`crossOriginIsolated` is legitimately `false` on the very first load — which is exactly why
`capabilities.ts` treats missing isolation as a **warning, never fatal**. HTTPS is non-negotiable in
production (localhost qualifies in dev); without a secure context the shim bails out silently.

### Entry-point resolution

`entryCandidates(files)` returns candidates best-first: Java files containing
`public static void main`, then `main.py` / `__main__.py`, then top-level `.py` files. The runtime is
chosen by the **entry file's extension**. With 2+ candidates a picker appears in the console header;
the choice persists. Zero candidates disables Run.

---

## 3. State and persistence

Two stores, deliberately separate:

- **Project files → OPFS** (`navigator.storage.getDirectory()`), under `warsha-project/`. `Project` is
  the in-memory source of truth; the store is write-behind. Editor keystrokes call
  `Project.setContent()` → memory updates immediately, the file is marked dirty (amber dot in tab and
  tree), and the write flushes after a **350 ms debounce**. Structural changes (create/rename/delete/
  import/template) write through immediately. `Run` calls `saveAll()` first, so an engine never sees
  stale bytes; `visibilitychange` flushes too. Swapping storage means implementing `ProjectStore` and
  changing `createStore()` — nothing else touches it.
- **UI state → `localStorage`** (`fs/prefs.ts`): font size, console height, collapsed, open tabs,
  active file, entry point, handedness. This is why a reload restores the exact workspace.

`Project` emits `onStructureChange` and `onDirtyChange` (both returning unsubscribers); `useProject`
turns them into a revision counter. Empty folders are real — `FsSnapshot.dirs` carries them, OPFS
stores them natively, and the zip round-trip preserves them as bare directory entries.

### The console buffer

`ConsoleBuffer` is chunk-based because a prompt without a newline must appear *before* the program
blocks on stdin — the engines emit one callback per write and deliberately do no buffering of their
own (a worker blocked in `runPython` cannot run a timer to flush later), so coalescing is the UI's
job. It notifies subscribers at most once per animation frame **with a 100 ms timer fallback** — a
backgrounded or occluded tab stops firing `requestAnimationFrame` entirely, and output that never
flushes reads to a student as a hang. `Console` reads it through `useSyncExternalStore`; each line is
a stable object with an `id`, so appending to the trailing line re-renders one row.

A line is a list of **styled segments**, not a single string, because the answer a student types has
to land on the same visual line as the prompt while still being coloured differently —
`Your name: Saad`, prompt in `--text-1` and answer in `--info` (DESIGN-SPEC §4.4, and the same
requirement independently in the runtime integration notes). `buffer.echo(line)` owns that decision:
it joins an open prompt, or starts its own line with the `› ` marker when the prompt already ended in
a newline. Row-level styling uses the line's kind, which becomes `err` if *any* segment is stderr.

### The keyboard

`ui/viewport.ts` is the whole answer to DESIGN-SPEC §4. `100dvh` is correct on Android and wrong on
iPadOS, where the layout viewport does not shrink for the software keyboard — so `visualViewport`
drives `--app-h` and `--kb-inset`, and `html[data-kb="open"]` switches on the compact layout. The
console's status foot is `position: sticky; bottom: 0` so the state sentence can never end up under
the keyboard, and the live stdin line — which now lives inside the scrolling transcript — is kept in
view by a `ResizeObserver` on the transcript that re-sticks it to the bottom whenever the panel
changes size. There is deliberately **no** `.console-lift`: `--app-h` is `visualViewport.height`,
which is already the height above the keyboard, so subtracting `--kb-inset` again double-counts it
(index.css says this at length, with the measurements).

---

## 4. Restyling guide

This app was built to be restyled without refactoring. The visual pass should not need to touch
component logic.

**Where the tokens live.** `docs/design/tokens.css` is canonical and is imported *in place* by
`src/index.css` (Vite's `server.fs.allow: ['..']` permits it) — there is no copy to drift.
`src/index.css` maps that file onto the Tailwind theme in one `@theme inline` block:

| Token family | Tailwind utilities |
| --- | --- |
| `--surface-0…4` | `bg-surface-2`, `border-surface-3`, … |
| `--text-1…3`, `--text-disabled` | `text-text-2`, … |
| `--accent*`, `--success*`, `--danger*`, `--warn*`, `--info*`, `--neutral-soft` | `bg-accent`, `text-accent-ink`, `bg-danger-soft`, … |
| `--border-subtle`, `--border-control` | `border-border-control` |
| `--font-ui`, `--font-code` | `font-ui`, `font-code` |
| `--fs-*` | `text-code`, `text-console`, `text-input`, `text-tab`, `text-row`, `text-btn`, `text-meta`, `text-micro`, `text-dlg-title` |
| `--sp-1…6`, `--pad-panel` | `p-1…p-6`, `px-panel` |
| `--touch`, `--touch-lg`, `--bar-top`, `--rail`, `--explorer-w`, `--drawer-w` | `size-touch`, `min-h-touch-lg`, `h-bar`, `border-l-rail`, `w-explorer`, `w-drawer` |
| `--r-sm/md/lg/pill` | `rounded-sm/md/lg/pill` |

To change a colour, size or radius: edit `docs/design/tokens.css`. Components carry **no colour
literals** — the only hex in `src/components/` is the `var(--logo-ink, #FAFAFA)` fallback inside
`Logo.tsx`, copied from Design's own `logo.svg` so the mark is still correct if the custom property is
ever missing. Brand v3 dropped the second, `--logo-accent` fallback along with the amber workpiece —
the mark is one colour now.

### 4.1 Three ways CSS silently does nothing here

Read this before debugging any style that "should work". Each of these has already cost real
regressions in this codebase, and all three fail **silently** — no build error, nothing struck through
in devtools.

1. **Tailwind v4 removed the bare `[--var]` custom-property shorthand.** `bg-[ --scrim ]` (without the
   spaces) compiles to `background-color:--scrim`, which is invalid CSS the browser discards. This is
   how the active-tab accent rule, the drawer scrim, the drawer transition, the 144px console floor and
   the modal backdrop all went missing while the source looked correct. Write `bg-(--scrim)`, or use a
   class. Note that spelling the bad form verbatim in a *comment* is enough for Tailwind to emit the
   dead class, so audit greps keep reporting hits after the real bug is fixed.
2. **Unlayered CSS beats every `@layer`, at any specificity.** `tokens.css` sets `--pad-panel` from an
   unlayered `@media` rule, so overriding it inside `@layer components` lost (§4.3's keyboard-open
   padding reduction did nothing); CodeMirror mounts oneDark as an unlayered `StyleModule`, which made
   a whole `.cm-*` block in `index.css` inert except for its two `!important` rules. Editor chrome
   therefore lives in `editor/setup.ts`'s `chromeTheme`, where every selector is qualified with
   `&.cm-editor` to outrank oneDark — and ordering does not help, because CodeMirror mounts collected
   modules in reverse.
3. **`focus:outline-none` outranks the global `:focus-visible` ring** and removes the keyboard focus
   indicator entirely. Never use it.

### 4.2 The design system's canonical recipes

`src/index.css` opens with the authoritative list — focus ring, hit targets, bars, buttons, surfaces,
borders, elevation, radii, motion, scrollbars, stacking, type. Read that header rather than
re-deriving an answer; four people write this UI and two near-identical answers is what "generic"
looks like. Highlights that are easy to get wrong:

- **A fixed-height bar draws its divider as an `inset` box-shadow, never a border.** With border-box a
  1px border comes out of the bar's own 44px, so its 44px child overflows by a pixel — which is how
  tabs measured 43px and Run's bottom edge landed 1px *under* the keyboard.
- **One stacking scale**, as tokens: `--z-scrim: 10`, `--z-drawer: 20`, `--z-raised: 30`,
  `--z-menu: 40`, `--z-toast: 50`; native `<dialog>` uses the browser top layer above all of them.
  Needing a number *between* two of these means a layout problem, not a new number.
- **A panel with a persisted pixel height must be able to shrink.** `.console-panel--open` pairs
  `min-height: var(--console-min-h-stdin)` with `flex-shrink: 1` rather than a hand-written
  `max-height` calc: flexbox already knows its siblings' heights, and a calc enumerating them goes
  stale the moment a row is added.

There is a short, deliberate list of **pixel literals** — values the spec states directly and for
which no token exists. If Design wants them tokenised, add the token and swap these:

| Value | Where | What it is |
| --- | --- | --- |
| `[3px]` | `Console.tsx`, `CapabilityScreens.tsx` ×2 | the leading rule on console lines and note blocks (§7.3) |
| `[6px]` | `Tabs.tsx`, `Explorer.tsx` | the dirty/modified dot (§7.1, §7.2) |
| `[20px]` | `ui/Button.tsx` | icon-button glyph size (§5.2) |
| `[14px]` | `Tabs.tsx` | the close × glyph (§7.2) |
| `[12px]` | `RunBar.tsx` | the Run/Stop play/square glyph |
| `[28px]` | `Logo.tsx` | welcome lockup wordmark (§7.7) |
| `[1024px]` / `[900px]` | `WelcomePanel.tsx`, `Tabs.tsx` | breakpoints: start cards side by side, close × on all tabs |

Most of that table used to be longer. The badge sizes, the console-line rule, the note blocks, the
dots, the glyph sizes and the toast glyph now live in `index.css` as `.badge--sm/md`, `.console-row`,
`.note`, `.dot-dirty`, `.icon-btn` and `.toast__glyph`, so components no longer carry them. Two
literals were also *wrong* against the spec and were raised to the §3.2 floor: the language badge was
10px and the status-pill glyph 10px, where 12px (`--fs-micro`) is the smallest type the app ships.

`app/index.html` carries two unavoidable colour literals — `#09090b` and `#FAFAFA` in the first-paint
style and the `#boot` splash mark. They run before any stylesheet exists, equal `--surface-0` and
`--text-1` (brand v3 also made `--accent` equal to `--text-1`, so one literal now covers both), and
must be kept in sync by hand. They sit **above** the
`coi-serviceworker` script deliberately: that script is parser-blocking, so anything after it is not
parsed until it has executed, and `color-scheme: dark` is what makes the UA paint its default canvas
dark in the meantime. Do not reorder that head without re-running a first-paint screencast.

**How state is exposed.** Every stateful surface publishes a `data-` attribute, so a stylesheet can
target states without reading component code:

| Selector | Values | Where |
| --- | --- | --- |
| `html[data-kb]` | `open` / `closed` | keyboard up or down |
| `html[data-hand]` | `right` / `left` | Run/Stop edge (§5.3 handedness) |
| `section[aria-label="Console"][data-state]` | `idle` `preparing` `running` `waiting` `ok` `failed` `stopped` | run status |
| `.console-header button[data-state]` | same | the Run/Stop control |
| `[role="tab"][data-state]` | `active` / `inactive` | tab strip |
| `[role="treeitem"][data-state]` | `open` (the file being edited) | explorer row |
| `aside[data-state]` | `open` / `closed` | explorer / drawer |
| `[data-kind]` | `out` `err` `echo` `meta` | console row (the leading rule and row tint) |
| `[data-seg]` | `out` `err` `echo` `meta` | a styled span *within* a row — this is what makes `Your name: Saad` one line, two colours |
| `.stdin-row[data-waiting]` | `true` / `false` | the live line — `true` only while the program is blocked on a read |
| `[data-phase]` | `download` `unpack` `boot` `compile` | progress block |

**The console has one surface, and no standing input.** This is a hard behavioural contract, not a
style choice, and re-adding an always-visible input bar is a regression:

- While the program is **not** reading stdin there is **no input in the DOM at all** — not a disabled
  one, not a greyed one. `[aria-label="Program input"]` has a count of zero at idle, while streaming,
  and after exit.
- When the program blocks on a read, an input appears **inside the transcript scroller**, at the
  position a terminal cursor would occupy. If the program left the last line open
  (`input("Your name: ")`), the input joins that row, so the prompt and the answer are one visual
  line; if the last line was closed, the live line opens with the same `› ` marker `buffer.echo()`
  will write a moment later. Either way it is a `.console-row`, on the transcript's own grid.
- It survives Enter by ~900 ms (`LIVE_GRACE_MS`). Two reads in a row (`input(); input()`) would
  otherwise unmount and remount the element between them, and the blur in that gap slams a phone's
  software keyboard shut and reopens it. During the grace the element carries no placeholder and
  `data-waiting="false"`; anything typed goes through the runner's type-ahead queue.
- The only permanent chrome under the transcript is `.console-foot`, which holds the status line —
  sticky, so §4.3 rule 1 still holds for the sentence that says the program is waiting.

The stable handles, all relied on by `tools/qa`: `aria-label="Program output"` (the scroller),
`aria-label="Program input"` (the live input), the placeholder string
**`Type your answer, then press Enter`** verbatim, `.stdin-row` / `.stdin-input` (kept from the old
input bar — it is the same thing, moved into the stream), `.console-foot`, `.console-transcript`,
`section[aria-label="Console"][data-state]`, and the exact button names `Run` / `Stop`.

**Console keyboard and pointer behaviour**, also asserted: `Ctrl+L` clears (the handler is on the
console panel, so the browser's own Ctrl+L is untouched everywhere else); right-click with a
selection copies just that selection and suppresses the native menu, with nothing selected the
native menu opens as usual; a click anywhere in the console while it is waiting focuses the live
input (on `click`, not `pointerup` — the transcript is focusable for Ctrl+L, and the browser moves
focus to it on the mousedown that follows a tap). The transcript is `tabindex="0"`.

**Two rules from Design that the code obeys and a restyle must keep.** Never put white text on
`--accent` (1.99:1 — amber fills take `--accent-ink`). Never signal a state by surface colour alone
(adjacent surfaces are ~1.1:1 apart and invisible on a phone) — the active tab, the open explorer row
and stderr each carry an accent rule or border in addition to any fill.

**Class strings** are plain template literals in each component, so they can be replaced wholesale.
There are no inline `style` attributes except where a value is computed at runtime (drawer transform,
console height, progress bar width, explorer indent, toast keyboard offset).

CodeMirror is the one place utilities cannot reach, **and its chrome is not in `index.css`** — see
§4.1 rule 2. It lives in `editor/setup.ts`'s `chromeTheme`, reading the same `--code-*` tokens;
oneDark supplies only syntax colours. Sizes that depend on the student's font-size preference (code
size, and the gutter leading that has to match it exactly or the gutter drifts) are computed there too,
because they are recomputed when the preference changes.

### 4.3 Verification

The design work is asserted, not eyeballed. Three Playwright suites drive local Chrome against the
built `dist/` (screenshots and scripts under the session scratchpad):

| Script | What it proves |
| --- | --- |
| `overlap.mjs` | The **overlap sweep**: 20 scenarios across 1280/1024/768/430/390px, console dragged to min and max plus live handle drags, collapsed/open, keyboard-open at two widths, long filenames, the 900px drawer breakpoint, live progress, and a toast with the keyboard up. Detects four classes — a child spilling a fixed-size parent, in-flow siblings overlapping within one stacking root, content lost to a non-scrollable `overflow: hidden`, and named invariants (transcript vs the console's status foot, drag handle vs Run, tabs vs top bar, everything vs `--kb-inset`). |
| `audit.mjs` | The DESIGN-SPEC numbers in the real DOM: fills, the type scale, gutter leading, 44px targets, the 16px input floor, the 12px floor, iPad content attributes, the 144px/96px floors, cold-boot progress ticking, stderr's three-way distinction, and the Python template end to end. |
| `motion.mjs` | `prefers-reduced-motion` at both settings, the drawer's 180ms transform, and the keyboard-open layout measured against a simulated 336px inset. |

`console-check.mjs` (the console end to end at 1280 and 390, against real CPython) and
`console-kb.mjs` (the 390px keyboard-open geometry) are the two suites that own the console contract
above; between them they assert the absence of an idle input, the prompt and input sharing a line,
the 44px/16px live input, Ctrl+L, right-click copy, tap-to-focus and the keyboard geometry.

Three lessons about the harness itself, all of which produced false results before being fixed:

1. Measure console-internal elements only with the console **open** — it starts collapsed on an empty
   project, so the subtree is unmounted and checks silently pass over it.
2. Scope any "dismiss" selector to the banner — a loose `/Dismiss|Close/` also matches a tab's
   "Close Main.java" button and quietly closes the tab later assertions depend on.
3. **Simulate the software keyboard at its source, by shadowing `visualViewport.height`, never by
   writing `--kb-inset` / `--app-h` / `data-kb` by hand.** Writing the variables is self-cancelling:
   shrinking the shell fires a visualViewport event, `ui/viewport.ts`'s `sync()` reads the real
   un-shrunk viewport and writes them all back, and React's `data-kb` observer follows — so the suite
   measures a half-reverted layout with the phone inline height still applied. `--app-h: <full window>`
   is wrong for the same reason it is wrong in the app. This cost a full false failure in
   `console-kb.mjs` and four in `motion.mjs` and `overlap.mjs`; all three now shadow the property.

---

## 5. Templates are generated, not authored

`src/templates.ts` is generated from `content/templates/` and the code strings inside it are
**byte-identical** to those files. Do not edit the strings by hand. To change a starter, edit it
under `content/templates/`, regenerate, and re-verify with a diff against the source. The blurbs,
ids, `level`s and entry paths are Warsha's own metadata and live only in the generated file.

Two review tiers coexist: the `advanced` starters (`java-oop`, `python-starter`) are Education's
reviewed, compiled, stdin-tested originals; the `beginner`/`intermediate` starters are later drafts
that compile and run with piped stdin but have not been through that review. Each `ready` language
(languages.ts) should own one starter per level so the picker's three groups are never empty.

---

## 6. Known gaps

- Five runtimes are real, verified end-to-end: `python` → `PythonRuntime` (Pyodide 314.0.3 /
  CPython 3.14), `java` → `JavaRuntime` (CheerpJ 4.3 + ECJ 3.26, Java 8 only), `csharp` →
  `CSharpRuntime` (.NET 9 wasm + Roslyn — compiles and runs student C# in a module worker;
  ~13–15 MB brotli, blocking `Console.ReadLine()` over `SharedArrayBuffer`; see
  `runtimes/csharp/INTEGRATION.md`), `web` → `WebRuntime` (a **page** — html/css — in a sandboxed
  iframe), and `js` → `JsRuntime` (a **standalone script** — JavaScript or TypeScript — run headless
  in a Web Worker, Node-like).
  All but `web` are `kind: 'console'`; `web` is `kind: 'preview'` — see §2's runtime contract. The
  entry's extension picks the engine: `.cs` → `csharp`, html/css → `web`, js/mjs/ts/tsx/… → `js`, and
  a `.js`/`.ts` *referenced from a page* is inlined by `web`, never run by `js`. `src/runtime/fake.ts` is
  unreferenced — kept as the fastest way to demo the shell without an engine, and it documents the
  console contract by example.
- **A preview's iframe is its execution.** For a page project the `Preview` iframe stays MOUNTED
  while the output pane is open even when the Console face is on top (it is merely `display:none`),
  because a display:none iframe keeps running — so the page's `console.log` fills the Console
  whichever tab you are on. Unmounting it on the Console tab was a bug where a page (and a lone
  script, before it moved to `JsRuntime`) only ran once you visited Preview.
- **Web is a phased plan; Phase 2a (TypeScript + standalone modules) is in, 2b is not.** A standalone
  script (`js` engine) now runs **TypeScript** and can `import` other *project* files — `bundle.ts`
  (esbuild-wasm) transpiles and bundles it, downloaded once on the first such run and reported on the
  progress bar; plain one-file JS keeps its zero-download instant path. TypeScript folds into the Web
  tile (no separate picker tile), with two starters (`web-ts`, `web-ts-modules`). **Still open (Phase
  2b):** a `<script type="module">` inside a *page* that imports another project file, or a `.ts`
  script referenced from HTML, is not yet bundled by `WebRuntime` — that is the next slice. `JsRuntime`
  has no stdin yet. Tailwind and the React/Vue/Svelte starter kits are later phases. Local refs are
  inlined; network refs (a CDN) are left untouched, the seam those phases build on. The output pane
  reuses the console panel's bottom strip, so on a phone the preview is small — a larger,
  editor-adjacent preview is a follow-up.
- Java's runtime exceptions carry **no line numbers** (a CheerpJ limitation, not ours) and its
  bootstrap compile costs 7–20 s on a fresh worker. Both are flagged for Product in
  `runtimes/java/INTEGRATION.md`.
- Visual implementation of DESIGN-SPEC is deliberately **not** done — this hand-off is
  plain-but-token-correct, and the design engineer owns the styling pass.
- Progress escalation covers 8s / 25s / 60s as console notes; the spec's separate `Cancel` /
  `Try again` buttons are not built (Stop serves as cancel).
- No editor search UI, no multi-file find, no drag-and-drop in the tree, no git.
- `content/exercises/` is not surfaced in the UI yet.
