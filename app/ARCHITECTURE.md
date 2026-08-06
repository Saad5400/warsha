# Warsha — architecture

A browser-only, static IDE for students: file explorer, editor tabs, CodeMirror 6 editor, console
with stdin, one Run/Stop control. No server, no backend, no accounts.

**Stack:** Vite + React 19 + TypeScript + Tailwind CSS v4 · CodeMirror 6 · fflate · OPFS.

```
npm install
npm run dev       # localhost:8083
npm run build     # tsc --noEmit && vite build  →  dist/ (fully static, deploy anywhere)
npm run preview   # serve dist/ on 8083

WARSHA_ORIGIN=https://example.org npm run build   # deploying to a new origin — see §7
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
| `src/editor/hoverDocs.ts` | Docs on hover: one VS Code-style card fed by the built-in dictionary (shared with completions.ts, so hover and autocomplete-info agree) plus the student's own Javadoc/docstrings scanned across the project (accessor registered from App). Mouse hover, long-press on touch, Ctrl/Cmd+K Ctrl/Cmd+I. |
| `src/ui/viewport.ts` | Keyboard-aware shell geometry: publishes `--app-h`, `--kb-inset`, `html[data-kb]`. |
| `src/runtime/types.ts` | **The runtime contract.** `SourceFile`, `LoadProgress`, `RunIO` (incl. `onRender`), `RunContext`, `RunSession`, `RuntimeKind`, `Runtime`. |
| `src/runtime/index.ts` | Runtime **registry** + entry-point resolution + `isPreviewEntry`. |
| `src/runtime/web.ts` | `WebRuntime` — the `kind: 'preview'` engine for a **page** (html/css entry). Assembles the project into one sandboxed document, inlining local `<link>`/`<script>` refs and bridging its console back. A `<script type="module">`/`.ts` that imports a project file is transpiled + bundled through `bundle.ts` first (a build error → Console + a red banner). A Tailwind CDN `<script>` is replaced by the first-party on-device build (`public/warsha-tailwind.js`), fetched same-origin and **inlined** — a linked `<script src>` would be cross-origin from the sandboxed preview's opaque origin and COEP would block it. A page entry that reaches for a framework — `main.tsx` importing React, or `main.js` importing a `.vue`/`.svelte` component — bundles that framework in first-party (via `bundle.ts`), so the preview stays self-contained. No worker; the bundler downloads once only when a page needs it. |
| `src/runtime/js.ts` | `JsRuntime` — the `kind: 'console'` engine for a **standalone script** (js/ts/mjs/tsx… entry). Runs it headless in a Web Worker (Node-like: a global, `console`, timers, `fetch`, **no DOM**), streaming `console.log`/errors as stdout/stderr and exiting when the event loop idles. Plain one-file JS runs raw (instant); TypeScript or a script that imports another file is bundled first (`bundle.ts`). JS *inside* a page is inlined by `WebRuntime` instead. |
| `src/runtime/bundle.ts` | **In-browser bundler** (esbuild-wasm, ~12 MB fetched once from `public/warsha-esbuild.wasm`, cached + offline). `bundleProject()` transpiles TS/TSX/JSX (`jsx: 'automatic'`) and resolves cross-file relative imports against the in-memory `SourceFile[]` via an onResolve/onLoad virtual-fs plugin; network refs stay external. When `needsReact()` fires it injects the first-party React bundle (`public/warsha-react.json`, one shared instance — see `tools/prebuild-react.mjs`) into the VFS so `react`/`react-dom/client`/`react/jsx-runtime` resolve and bundle in. `needsSvelte()`/`needsVue()` do the same for `public/warsha-{svelte,vue}.json` (prebuilt runtimes), and additionally an `onLoad` hook compiles `.svelte`/`.vue` single-file components to JS on the fly via lazily-imported `svelte/compiler` / `@vue/compiler-sfc` (which run here in the parent, so COEP never touches them — only the runtime is bundled into the output). Shared by `js.ts` (standalone scripts) and `web.ts` (a page's module scripts). |
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
| `TopBar` | ONE composition at every size (founder ruling 2026-08-05): `MenuBar` leading (it collapses itself to the ☰ `aria-label="Application Menu"` below 1050px), the centred `● file — project — Warsha` window title (hidden while the software keyboard compacts the bar), sidebar/panel toggles + install control trailing. No logo, no wordmark anywhere in it (LAYOUT-VSCODE §1b) — brand lives on the welcome panel, the favicon and the OG image only. |
| `MenuBar` | File / Edit / View / Run / Help, mapped to real app actions only. File owns every project-scoped job (New/Open Recent/Import/Export/Rename/Empty/Delete) — the old `ProjectSwitcher` component is deleted. |
| `ActivityBar` | The 48px icon rail, rendered at all widths; below 900px its Explorer item drives the sidebar as an overlay drawer. |
| `Explorer` | Pane header (project label + New file / New folder / Collapse trio, hover-revealed at desk, always visible on touch) over the tree; long-press/⋯ menu, create/rename/delete. |
| `Tabs` | Horizontal strip, dirty dot, close ×, plus the trailing editor-actions corner — `RunControl` and the ⋯ More menu — at every size. Run's only home. |
| `Breadcrumbs` | The path trail under the tab strip, all widths (`--bar-crumbs`: 28px touch / 22px desk). |
| `Editor` | ~40-line shell around `editor/setup.ts`. |
| `Console` | The transcript and the live stdin line inside it. (The old sticky status foot is gone — the status bar carries run state; see `RunBar`.) |
| `Preview` | The output pane's second face: one sandboxed iframe (`allow-scripts`, **no** `allow-same-origin`) that loads the Web runtime's assembled `srcdoc`. Shown for a web project; the Console shows the transcript for Java/Python. |
| `RunBar` | The panel header, one VS Code panel-toolbar composition at every size: PREVIEW/CONSOLE caps tabs leading, then entry picker, Copy, Clear, Maximize/Restore, collapse. NO Run — that lives in the tab strip. Also carries the kb-open-only `StatusPill`, shown only while the software keyboard hides the status bar. |
| `ConsoleDivider` | Drag-resize handle, all widths — visible grip bar on touch, VS Code's invisible sash at desk. |
| `StatusBar` | Bottom bar, all widths (30px touch / 22px desk); run state left, language/entry/cursor/font right. Hidden only while the software keyboard is open. |
| `QuickInput` | Ctrl+P / Ctrl+Shift+P quick open + command palette (`section[aria-label="Quick open"]`). |
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
  `Project.setContent()` → memory updates immediately, the file is marked dirty (the `.dot-dirty` dot
  in tab and tree), and the write flushes after a **350 ms debounce**. Structural changes (create/rename/delete/
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
drives `--app-h` and `--kb-inset`, and `html[data-kb="open"]` switches on the compact layout. While
the keyboard hides the status bar, the run state moves to the kb-open-only `StatusPill` in the panel
header (CSS-owned via `html[data-kb]`), so the state words are never under the keyboard; the live
stdin line — which lives inside the scrolling transcript — is kept in view by a `ResizeObserver` on
the transcript that re-sticks it to the bottom whenever the panel changes size. There is deliberately **no** `.console-lift`: `--app-h` is `visualViewport.height`,
which is already the height above the keyboard, so subtracting `--kb-inset` again double-counts it
(index.css says this at length, with the measurements).

---

## 4. Restyling guide

This app was built to be restyled without refactoring. The visual pass should not need to touch
component logic.

**One shell, pointer-adaptive density** (founder rulings, 2026-08-05 — `docs/design/DENSITY.md`):
the VS Code desktop chrome renders at EVERY size and pointer; structure never forks. One media
condition, `(min-width: 900px) and (hover: hover) and (pointer: fine)`, compacts the control tokens
(`--touch` 44→28, bars, UI type) to VSCode-grade metrics and is also exposed as the `desk:` Tailwind
variant; coarse pointers keep the §5.2 touch metrics on the same furniture. Before changing a size,
check whether it is one of the forked tokens in DENSITY.md's table — a literal px is probably wrong
at one of the two densities.

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
| the Dark Modern chrome families — `--titlebar-*`, `--statusbar-*`, `--ab-*`, `--tab-*`, `--menu-*`, `--list-*`, `--tree-guide*`, `--qi-*`, `--kbd-*`, `--badge-*`, `--btn-*`, `--input-*`, `--sash-hover`, `--toolbar-hover-bg`, `--ansi-*` (THEME-V4) | `bg-titlebar`, `text-ab-fg`, `bg-list-hover`, `bg-sash-hover`, … — every one mapped in the same `@theme` block |

To change a colour, size or radius: edit `docs/design/tokens.css`. Components carry **no colour
literals**, with two deliberate exceptions in `src/components/`: the `var(--logo-ink, #FAFAFA)`
fallback inside `Logo.tsx` (copied from Design's own `logo.svg` so the mark is still correct if the
custom property is ever missing — brand v3 dropped the second, `--logo-accent` fallback along with the
amber workpiece), and the per-language brand fills in `ui/LangIcons.tsx` (`#519aba`, `#e76f00`, … —
VS Code's Seti file-icon palette, which is *identity* colour, not theme colour, and must not follow
the accent). `editor/setup.ts` holds the third sanctioned hex pocket: the Dark+ syntax and completion-kind
colours, which live outside the token system for the same reason.

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
   padding reduction did nothing); CodeMirror mounts every theme as an unlayered `StyleModule`, which
   in the oneDark era made a whole `.cm-*` block in `index.css` inert except for its two `!important`
   rules. Editor chrome therefore lives in `editor/setup.ts`'s `chromeTheme`, where every selector is
   qualified with `&.cm-editor` — oneDark itself is gone (the Dark+ pass replaced it with an in-house
   `syntaxColors` highlight), but the rule stands: ordering does not help, because CodeMirror mounts
   collected modules in reverse, so `.cm-*` styling in `index.css` stays off-limits.
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
| `[3px]` | `CapabilityScreens.tsx` ×2, `ProgressBlock.tsx`, `StorageBanner.tsx` | the leading rule on note and progress blocks (§7.3) |
| `[3px]` / `top-[6px]` | `ConsoleDivider.tsx` | the touch drag-handle grip bar and its hairline (desk uses the sash instead) |
| `[6px]` | `StatusPill.tsx` | the running-state pulse dot |
| `[20px]` | `ui/Button.tsx` | icon-button glyph size (§5.2; the `.icon-btn` recipe drops it to 16px at desk) |
| `size={24}` | `ActivityBar.tsx` | the rail's glyph size — VS Code's own 24px codicons in the 48px column (was 22 pre-parity) |
| `size={16}` | `Tabs.tsx`, `RunBar.tsx` | the tab close × and the panel-toolbar glyphs (Run/Stop's 16px glyphs ride the tab-strip corner now) |
| `var(--pane-action)` (inline style) | `Explorer.tsx` | pane-header action boxes — 44px touch / 22px desk, token defined on `.sidebar-project-row` |
| `[28px]` | `Logo.tsx` | welcome lockup wordmark (§7.7) |
| `[1024px]` | `WelcomePanel.tsx` | breakpoint: start cards side by side |

Most of that table used to be longer. The badge sizes, the console-line rule, the dirty dots and the
toast glyph now live in `index.css` as `.badge--sm/md`, `.console-row`, `.note`, `.dot-dirty`,
`.icon-btn` and `.toast__glyph`, so components no longer carry them; the tab's close/dirty slot is the
`--tab-close` token (40px touch, VS Code's 20px at desk — it rides *inside* the larger tab target, the
one sanctioned sub-24px hit box). Two literals were also *wrong* against the spec and were raised to
the §3.2 floor: the language badge was 10px and the status-pill glyph 10px, where 12px (`--fs-micro`)
is the smallest type the app ships.

`app/index.html` carries three unavoidable colour literals, hand-synced to THEME-V4 — `#1F1F1F`
(first-paint background and `#boot` splash, equals `--surface-1`, the editor canvas the app resolves
to), `#181818` (the `theme-color` meta, equals `--surface-0`, the chrome the browser UI abuts) and
`#CCCCCC` (the splash mark, equals `--text-1`). They run before any stylesheet exists and must be
kept in sync by hand — a token sweep that skips them flashes the old palette on every cold load.
They sit **above** the
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
| `button[aria-label="Run"][data-state]` (or `"Stop"`) | same | the Run/Stop control, in the tab strip's trailing corner (its one home) |
| `[role="tab"][data-state]` | `active` / `inactive` | tab strip |
| `[role="treeitem"][data-state]` | `open` (the file being edited) | explorer row |
| `aside[data-state]` | `open` / `closed` | explorer / drawer |
| `[data-kind]` | `out` `err` `echo` `meta` | console row (the leading rule and row tint) |
| `[data-seg]` | `out` `err` `echo` `meta` | a styled span *within* a row — this is what makes `Your name: Saad` one line, two colours |
| `.stdin-row[data-waiting]` | `true` / `false` | the live line — `true` only while the program is blocked on a read |
| `[data-phase]` | `download` `unpack` `boot` `compile` | progress block |

**Shell handles added by the VS Code-parity waves**, equally load-bearing for `tools/qa`:

- **Quick open** (Ctrl+P): `section[aria-label="Quick open"]` is the widget root — in the DOM only
  while open, so its count is the open/closed assertion. Inside it, the input is
  `aria-label="Search files by name"` (a `role="combobox"` over
  `[aria-label="Quick open results"]`), and result rows are `role="option"`. In command mode (`>`
  prefix) each option's visible text is the verbatim **`Category: Title`** string ("Run: Stop",
  "View: Toggle Console") — future suites can drive any app action through these rows without new
  selectors.
- **Breadcrumbs**: the `.breadcrumbs` class and `aria-label="Breadcrumbs"` name the path row under
  the tab strip (`--bar-crumbs`: 28px touch / 22px desk). Renders at ALL widths — a touch viewport
  finds one, not zero.
- **Explorer rows**: every `[role="treeitem"]` carries `data-path` with the file's project-relative
  path — the one stable way to reach a *specific* row (labels repeat; `Main.java` can exist twice).
- **Menu system**: `aria-label="Application Menu"` names the menu root at EVERY size — the full
  `role="menubar"` when the window is wide, a single ☰ trigger (same label, titles as submenus)
  below 1050px, phones included. The old touch-only drawer hamburger labelled `Files` is deleted;
  `Files` now names only the `aside` itself, and the drawer is opened via the activity bar's
  Explorer item, the title-bar toggle, View > Toggle Explorer or Mod+B.
  `aria-label="Manage"` is the activity bar's gear.
- **Console maximize**: the panel-toolbar chevron's accessible names are **`Maximize output`** /
  **`Restore output`** verbatim, state told apart by name exactly like `Run` / `Stop`. Renders at
  every width (the desk-only gate is gone).
- **StatusPill**: the `.pill` contract class rides ONLY the panel-header capsule variant — which is
  in the DOM only while the software keyboard hides the status bar (`hidden kb-open:flex`). The
  status-bar `bar` variant renders the same words but must never carry `.pill` — suites read
  `document.querySelector('.pill')` unscoped, and a second match makes the assertion ambiguous.

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
- There is NO permanent chrome under the transcript — `.console-foot` is deleted. The state sentence
  lives in the status bar at every width, and while the software keyboard hides that bar, in the
  panel header's kb-open-only `StatusPill` — so §4.3 rule 1 still holds for the sentence that says
  the program is waiting.

The stable handles, all relied on by `tools/qa`: `aria-label="Program output"` (the scroller),
`aria-label="Program input"` (the live input), the placeholder string
**`Type your answer, then press Enter`** verbatim, `.stdin-row` / `.stdin-input` (kept from the old
input bar — it is the same thing, moved into the stream), `.console-transcript`,
`section[aria-label="Console"][data-state]`, and the exact button names `Run` / `Stop` (tab-strip
corner).

**Console keyboard and pointer behaviour**, also asserted: `Ctrl+L` clears (the handler is on the
console panel, so the browser's own Ctrl+L is untouched everywhere else); right-click with a
selection copies just that selection and suppresses the native menu, with nothing selected the
native menu opens as usual; a click anywhere in the console while it is waiting focuses the live
input (on `click`, not `pointerup` — the transcript is focusable for Ctrl+L, and the browser moves
focus to it on the mousedown that follows a tap). The transcript is `tabindex="0"`.

**Two rules from Design that the code obeys and a restyle must keep.** Text on `--accent` fills is
always `--accent-ink`, never a hardcoded white or a text token — THEME-V4's #FFFFFF-on-#0078D4 is
4.53:1, which passes AA only at the ≥13px UI sizes the app uses on accent; the pairing is audited as
a unit, so swapping either half alone breaks it. Never signal a state by surface colour alone —
THEME-V4 made this *stronger*: adjacent chrome surfaces are now identical by design (`--surface-0` ==
`--surface-2`) and separated by 1px borders, so a fill-only state is not merely faint but invisible.
The active tab, the open explorer row and stderr each carry an accent rule or border in addition to
any fill.

**Class strings** are plain template literals in each component, so they can be replaced wholesale.
There are no inline `style` attributes except where a value is computed at runtime (drawer transform,
console height, progress bar width, explorer indent, toast keyboard offset).

CodeMirror is the one place utilities cannot reach, **and its chrome is not in `index.css`** — see
§4.1 rule 2. It lives in `editor/setup.ts`'s `chromeTheme`, reading the same `--code-*` tokens;
syntax colours are that file's own `syntaxColors` (VS Code Dark+ hexes — a sanctioned literal
pocket, since they are theme identity, not chrome). Sizes that depend on the student's font-size preference (code
size, and the gutter leading that has to match it exactly or the gutter drifts) are computed there too,
because they are recomputed when the preference changes.

### 4.3 Verification

The design work is asserted, not eyeballed. Three Playwright suites drive local Chrome against the
built `dist/` (screenshots and scripts under the session scratchpad):

| Script | What it proves |
| --- | --- |
| `overlap.mjs` | The **overlap sweep**: 20 scenarios across 1280/1024/768/430/390px, console dragged to min and max plus live handle drags, collapsed/open, keyboard-open at two widths, long filenames, the 900px drawer breakpoint, live progress, and a toast with the keyboard up. Detects four classes — a child spilling a fixed-size parent, in-flow siblings overlapping within one stacking root, content lost to a non-scrollable `overflow: hidden`, and named invariants (transcript vs the panel header, drag handle vs the header controls, tabs vs top bar, everything vs `--kb-inset`) — some of its scenario prose predates the one-shell unification and is repaired with the rest of tools/qa. |
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

- Six runtimes are real, verified end-to-end: `python` → `PythonRuntime` (Pyodide 314.0.3 /
  CPython 3.14), `java` → `JavaRuntime` (CheerpJ 4.3 + ECJ 3.46, Java 17), `csharp` →
  `CSharpRuntime` (.NET 9 wasm + Roslyn — compiles and runs student C# in a module worker;
  ~13–15 MB brotli, blocking `Console.ReadLine()` over `SharedArrayBuffer`; see
  `runtimes/csharp/INTEGRATION.md`), `c` → `ClangRuntime` (the `@wasmer/sdk` `clang/clang`
  package — clang 16 — compiles student C in a module worker; the worker then runs the compiled
  WASIX `.wasm` *itself* under `@bjorn3/browser_wasi_shim`, so `scanf`/`getchar` block on a
  `SharedArrayBuffer` for true interactive input; ~47 MB one-time toolchain + ~24 s sysroot warm
  behind the loader; see `runtimes/clang/INTEGRATION.md`), `web` → `WebRuntime` (a **page** —
  html/css — in a sandboxed iframe), and `js` → `JsRuntime` (a **standalone script** — JavaScript or
  TypeScript — run headless in a Web Worker, Node-like).
  All but `web` are `kind: 'console'`; `web` is `kind: 'preview'` — see §2's runtime contract. The
  entry's extension picks the engine: `.cs` → `csharp`, `.c` → `c`, html/css → `web`,
  js/mjs/ts/tsx/… → `js`, and a `.js`/`.ts` *referenced from a page* is inlined by `web`, never run by
  `js`. `src/runtime/fake.ts` is unreferenced — kept as the fastest way to demo the shell without an
  engine, and it documents the console contract by example. **C++ stays a "soon" tile** — the same
  toolchain compiles it, but the first libc++ header compile is CPU-bound and impractical cold (6+ min);
  it needs a precompiled-header path first (see `runtimes/clang/M0-FINDINGS.md`).
- **A preview's iframe is its execution.** For a page project the `Preview` iframe stays MOUNTED
  while the output pane is open even when the Console face is on top (it is merely `display:none`),
  because a display:none iframe keeps running — so the page's `console.log` fills the Console
  whichever tab you are on. Unmounting it on the Console tab was a bug where a page (and a lone
  script, before it moved to `JsRuntime`) only ran once you visited Preview.
- **Web is a phased plan; Phases 2a and 2b (TypeScript + modules, standalone *and* in a page) are in.**
  A standalone script (`js` engine) runs **TypeScript** and can `import` other *project* files, and a
  **page** now does too: a `<script type="module">` that imports a project file, or any `<script src=…​.ts>`,
  is transpiled and bundled by `WebRuntime.assemble()` (async) through the same `bundle.ts` (esbuild-wasm)
  and inlined — `esm` keeps `type="module"`, a classic script that grew imports becomes an `iife`; an
  inline `type="module"` block that imports is bundled via a synthetic entry file. The bundler is fetched
  once (~12 MB) only when a page actually needs it (`pageNeedsBundle` decides at `load()` time so the
  progress bar shows), and a plain classic script — or a module with no project imports — still runs
  verbatim with nothing to download. A build error prints to the Console (via stderr) and shows as a red
  banner in the preview. TypeScript folds into the Web tile (no separate picker tile), with three starters
  (`web-ts`, `web-ts-modules`, `web-modules` — a page whose module script imports TS). **Phase 3
  (Tailwind) is in too:** a `<script>` pointing at `cdn.tailwindcss.com` or `@tailwindcss/browser` is
  replaced by Warsha's first-party build (`public/warsha-tailwind.js`, a verbatim copy of
  `@tailwindcss/browser`'s v4 global build, staged by `npm run assets`), fetched same-origin and
  **inlined** into the document. Inlining is required, not a nicety: the preview iframe is sandboxed
  without `allow-same-origin`, so it has an opaque origin, and a linked `<script src>` back to our own
  origin is *cross-origin* from its view — which COEP `require-corp` blocks unless the response carries
  `Cross-Origin-Resource-Policy` (production nginx does not add it). Inlining the bytes makes the document
  self-contained and works offline. Utility classes are identical to the CDN; a v3 `tailwind.config = {}` object does not
  apply (v4 config goes in a `<style type="text/tailwindcss">` `@theme` block). Starter `web-tailwind`.
  **Phase 4 (React) is in:** a page whose `main.tsx` imports `react`/`react-dom/client` bundles into one
  self-contained module through `bundle.ts` — React is served first-party and on-device (`public/warsha-react.json`,
  built by `tools/prebuild-react.mjs` from the installed react/react-dom, staged by `npm run assets`). The
  prebuild does one esbuild pass over react + react-dom + jsx-runtime so there is a **single shared react
  instance** (two copies would break hooks), exposes them as namespaces, and wraps them in thin shims that
  restore the bare specifiers' named exports. At bundle time `needsReact()` drops those shims into the
  virtual FS and the plugin resolves `react`/`react-dom`/`react-dom/client`/`react/jsx-runtime` to them, with
  `jsx: 'automatic'` on — so React ends up *bundled into* the student's output and inlined, never linked
  (same COEP/opaque-origin reason as Tailwind; also offline). Nothing is fetched for a project that never
  touches React. Starter `web-react` (index.html + styles.css + main.tsx + App.tsx, a `useState` counter).
  **Vue and Svelte are in too** (2026-08-06): same first-party pattern, plus an SFC *compiler* React did
  not need. Svelte's runtime is prebuilt with esbuild **code-splitting** (`tools/prebuild-svelte.mjs` →
  `warsha-svelte.json`: `svelte` + `svelte/internal/client` + `disclose-version` share one chunk = single
  instance, and reserved-word exports like `await` re-export natively — no hand-written shim); Vue's is one
  self-contained `vue` entry (`prebuild-vue.mjs` → `warsha-vue.json`). At bundle time `needsSvelte()`/`needsVue()`
  inject those into the VFS and an `onLoad` hook compiles `.svelte` (→ client JS, `css:'injected'`) and `.vue`
  (`compileScript` inline-template + `rewriteDefault` so `__scopeId` can be stamped — that is what makes scoped
  `[data-v-…]` CSS match — with scoped `<style>` compiled and injected at runtime). The compilers are lazy Vite
  chunks (~800 KB each, like the esbuild glue), fetched only when a project uses that framework. Verified
  end-to-end in the real preview: both render, scoped styles apply, and state is reactive (Svelte `$state`,
  Vue `ref`). Starters `web-svelte` / `web-vue` (index.html + styles.css + main.js + App.{svelte,vue}); the
  Web tile now reads "HTML · CSS · JS · TS · React · Vue · Svelte". Svelte/Vue with `lang="ts"` needs a
  preprocess pass (not wired). `JsRuntime` has no stdin yet. Local refs are
  inlined; other network refs (a non-Tailwind CDN) are left untouched, the seam those kits build on. The
  output pane reuses the console panel's bottom strip, so on a phone the preview is small — a larger,
  editor-adjacent preview is a follow-up.
- Java's runtime exceptions carry **no line numbers** (a CheerpJ limitation, not ours). The
  engine moved to **Java 17** on 2026-08-06; the in-browser bootstrap compile is gone with it
  (the bootstrap ships prebuilt in `warsha-boot.jar`), but the compiler's first compile of a
  session now costs ~15 s against Java 8's ~2 s, because on a modular runtime every platform
  type is read out of the packed module image on first touch. That cost runs in the background
  right after boot, and a re-run still takes well under a second.
  Details in `runtimes/java/INTEGRATION.md`.
- Visual implementation of DESIGN-SPEC is deliberately **not** done — this hand-off is
  plain-but-token-correct, and the design engineer owns the styling pass.
- Progress escalation covers 8s / 25s / 60s as console notes; the spec's separate `Cancel` /
  `Try again` buttons are not built (Stop serves as cancel).
- No multi-file find, no drag-and-drop in the tree, no git. (In-editor find/replace exists —
  `@codemirror/search`, styled as VS Code's top-right widget.)
- `content/exercises/` is not surfaced in the UI yet.

---

## 7. Deploy metadata: origin, robots, sitemap

The app is relative everywhere (`base: './'`) except four tags that cannot be: `<link rel=canonical>`,
`og:url`, `og:image`, `twitter:image`. A social scraper does not resolve a relative image URL against
the page it fetched — it drops the card — so index.html has to name its own origin.

That origin is owned by **one** thing: the `warsha:site-origin` plugin in `vite.config.ts`. It
substitutes the `__WARSHA_ORIGIN__` token in index.html (in dev *and* build) and emits `dist/robots.txt`
and `dist/sitemap.xml` with the same value. Default `https://warsha.sb.sa`; override with the
`WARSHA_ORIGIN` env var, which the root `Dockerfile` accepts as a build arg.

**Do not write a literal origin into index.html again.** It used to hold the placeholder
`https://warsha.example` behind a "DEPLOY STEP: replace this" comment. Nobody replaced it, and for as
long as that was live every link preview on every platform was blank, because `warsha.example` is
IANA-reserved and resolves to nothing. The generated-with-a-production-default design means a forgotten
env var yields a *correct* build rather than a placeholder one.

Robots and sitemap are generated rather than committed for the same reason — both must spell the
origin, and a second hand-maintained copy is a second thing to forget. Their previous absence was its
own bug: with neither file on disk, nginx's SPA catch-all answered `/robots.txt` and `/sitemap.xml` with
`200 text/html`. `deploy/nginx.conf` now pins both to `try_files $uri =404` so a build that stops
emitting them fails loudly instead of serving a React shell to a crawler.

**Three indexable URLs: `/`, `/en/`, `/ar/`.** The rendered DOM is IDE chrome ("Run", "New file",
"Console"), so the `<title>`, the meta description and the `SoftwareApplication` JSON-LD block are the
entire indexable surface of each — which is exactly why there has to be more than one of them. The
interface is bilingual (`src/i18n`); with a single URL a crawler sees one `<html lang>`, one title and
one description, and half of what Warsha ships is unreachable from an Arabic query.

`warsha:locale-entries` (also in `vite.config.ts`) emits `dist/en/index.html` and `dist/ar/index.html`
in `closeBundle`, by rewriting the *built* `dist/index.html` rather than re-templating a second copy of
the head — that is what stops the three pages drifting apart. Per copy it swaps `lang`/`dir`, title,
description, the og/twitter pair, `og:locale`(+`:alternate`), the self-canonical, the JSON-LD
(`url`/`name`/`description`/`inLanguage`, parsed and re-serialised, not regexed), and rewrites `="./`
to `="../`. The hreflang cluster is authored once in `index.html` and inherited verbatim, because it is
identical on all three pages by design — hreflang is only honoured when reciprocal, and a page missing
its own entry drops out of the set.

**They are entry points, not landing pages.** `/ar/` boots the same app from the same hashed bundle one
directory up (`base: './'` is what makes a path rewrite sufficient), and `src/i18n/locale.ts`'s
`fromPath()` reads the prefix to open in that language. No script is injected into the generated copy;
reading `location.pathname` also means `vite dev` gets the same behaviour free through its history
fallback. The prefix ranks with `?lang=` — above the stored preference, below nothing — and like
`?lang=` it is **not persisted**: a link that names a language describes the visit, not a new standing
choice, so a student who has explicitly picked English still has that choice waiting at `/`.

Two consequences worth knowing. The service worker keys cached navigations by their own pathname
(`public/coi-serviceworker.js`); it used to key every one under `./index.html`, which would now hand the
Arabic document to a later offline navigation to `/`. And the manifest is deliberately *not* per-locale
— `../manifest.webmanifest` with `id`/`start_url` of `./` keeps one PWA identity, so installing from
`/ar/` installs Warsha, not a second Arabic app, and the installed copy resolves its language the normal
way.
