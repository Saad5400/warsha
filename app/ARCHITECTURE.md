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
| `src/runtime/types.ts` | **The runtime contract.** `SourceFile`, `LoadProgress`, `RunIO`, `RunSession`, `Runtime`. |
| `src/runtime/index.ts` | Runtime **registry** + entry-point resolution. |
| `src/runtime/fake.ts` | `FakeRuntime` — fakes download/unpack/boot/run so the shell is demoable without an engine. |
| `src/fs/types.ts` | `ProjectStore` + `FsSnapshot`: the storage seam. |
| `src/fs/opfs.ts` | `OpfsStore` (default) and `MemoryStore` (fallback); `createStore()` picks. |
| `src/fs/project.ts` | `Project` — in-memory source of truth, tree building, debounced persistence, change events. |
| `src/fs/prefs.ts` | UI state in `localStorage` (font size, console height/collapsed, open tabs, entry, handedness). |
| `src/templates.ts` | **Generated** from `content/templates/` — see §5. |
| `src/zip.ts` | Export/import `.zip` via fflate. |
| `src/hooks/useProject.ts` | Binds `Project`'s events to a React revision counter. |
| `src/hooks/useRunner.ts` | The run state machine: status, progress, stdin buffering, kill, escalation timers. |
| `src/hooks/useMedia.ts` | `useMedia` (the <900px threshold) and `useKeyboardOpen` (reads `html[data-kb]`). |
| `src/index.css` | Token import + Tailwind theme mapping + the few things utilities cannot express. |
| `public/coi-serviceworker.js` | Vendored v0.1.7, unmodified. Buys cross-origin isolation on a header-less static host — see §2.5. |

### Components

Small and boring on purpose — roughly one file per box on screen.

| Component | Notes |
| --- | --- |
| `TopBar` | Hamburger, logo, overflow menu. |
| `Explorer` | Tree, long-press/⋯ menu, create/rename/delete. |
| `Tabs` | Horizontal strip, dirty dot, close. |
| `Editor` | ~40-line shell around `editor/setup.ts`. |
| `Console` | Transcript + sticky stdin row. |
| `RunBar` | The console header: Run/Stop, status pill, entry picker, Clear, collapse. |
| `ConsoleDivider` | Drag-resize handle (≥900px only). |
| `ProgressBlock` | First-run engine download (bar, byte counter, phase). |
| `StatusPill` | The seven run states. |
| `WelcomePanel` | The empty project's editor area, and the whole first-run experience: three start cards (New file / the two starters from `templates.ts`) plus Import .zip, the first-run download note and the storage line. Rendered by `App` **instead of** `Tabs` + `Editor` while `project.isEmpty()`, so there is no welcome page, no route and no language gate — a starter is an action inside the IDE, and language comes from file extensions. |
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
  (`System.out.print("Your name: ")` puts the input row on the same visual line).
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
console carries `.console-lift` (`margin-bottom: var(--kb-inset)`) and its stdin row is
`position: sticky; bottom: 0`, so the input can never end up under the keyboard.

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
literals** — the only hex in `src/components/` is the two `var(--logo-ink, #FFFFFF)` /
`var(--logo-accent, #F2A94B)` fallbacks inside `Logo.tsx`, copied from Design's own `logo.svg` so the
mark is still correct if the custom properties are ever missing.

There is a short, deliberate list of **pixel literals** — values the spec states directly and for
which no token exists. If Design wants them tokenised, add the token and swap these:

| Value | Where | What it is |
| --- | --- | --- |
| `[3px]` | `Console.tsx`, `CapabilityScreens.tsx` ×2, `WelcomeScreen.tsx` | the leading rule on console lines and note blocks (§7.3) |
| `[6px]` | `Tabs.tsx`, `Explorer.tsx` | the dirty/modified dot (§7.1, §7.2) |
| `[20px]` | `ui/Button.tsx` | icon-button glyph size (§5.2) |
| `[14px]` | `Tabs.tsx` | the close × glyph (§7.2) |
| `[12px]` | `RunBar.tsx` | the Run/Stop play/square glyph |
| `[10px]` / `[11px]` | `FileBadge.tsx`, `WelcomeScreen.tsx` | two-letter language badge type |
| `[28px]` / `[15px]` | `Logo.tsx` | welcome lockup wordmark and the Arabic line (§7.7) |
| `[720px]` / `[900px]` | `WelcomeScreen.tsx`, `Tabs.tsx` | breakpoints: side-by-side cards, close × on all tabs |

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
| `[data-phase]` | `download` `unpack` `boot` `compile` | progress block |

**Two rules from Design that the code obeys and a restyle must keep.** Never put white text on
`--accent` (1.99:1 — amber fills take `--accent-ink`). Never signal a state by surface colour alone
(adjacent surfaces are ~1.1:1 apart and invisible on a phone) — the active tab, the open explorer row
and stderr each carry an accent rule or border in addition to any fill.

**Class strings** are plain template literals in each component, so they can be replaced wholesale.
There are no inline `style` attributes except where a value is computed at runtime (drawer transform,
console height, progress bar width, explorer indent, toast keyboard offset).

CodeMirror is the one place utilities cannot reach: its chrome is styled by `.cm-*` rules at the
bottom of `src/index.css`, all reading `--code-*` tokens. oneDark supplies only syntax colours.

---

## 5. Templates are generated, not authored

`src/templates.ts` is generated from `content/templates/` (Education's reviewed, compiled,
stdin-tested starters) and the code strings inside it are **byte-identical** to those files. Do not
edit the strings by hand. To change a starter, edit it under `content/templates/`, regenerate, and
re-verify with a diff against the source. The blurbs, ids and entry paths are Warsha's own metadata
and live only in the generated file.

---

## 6. Known gaps

- Both runtimes are real and verified end-to-end against the built `dist/`: `python` →
  `PythonRuntime` (Pyodide 314.0.3 / CPython 3.14), `java` → `JavaRuntime` (CheerpJ 4.3 + ECJ 3.26,
  Java 8 only). `src/runtime/fake.ts` is now unreferenced — kept because it is the fastest way to
  demo or test the shell without an engine, and it documents the contract by example.
- Java's runtime exceptions carry **no line numbers** (a CheerpJ limitation, not ours) and its
  bootstrap compile costs 7–20 s on a fresh worker. Both are flagged for Product in
  `runtimes/java/INTEGRATION.md`.
- Visual implementation of DESIGN-SPEC is deliberately **not** done — this hand-off is
  plain-but-token-correct, and the design engineer owns the styling pass.
- Progress escalation covers 8s / 25s / 60s as console notes; the spec's separate `Cancel` /
  `Try again` buttons are not built (Stop serves as cancel).
- No editor search UI, no multi-file find, no drag-and-drop in the tree, no git.
- `content/exercises/` is not surfaced in the UI yet.
