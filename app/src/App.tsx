import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { undo, redo } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { checkCapabilities, type CapabilityReport } from './capabilities'
import { ConsoleBuffer } from './console/buffer'
import { splitPath } from './fs/project'
import { prefs, setPrefs } from './fs/prefs'
import { nextProjectName } from './fs/projects'
import type { FsSnapshot } from './fs/types'
import { disposeRuntimes, entryCandidates, isPreviewEntry } from './runtime'
import { type Template } from './templates'
import { exportZip } from './zip'
import { useProject } from './hooks/useProject'
import { useRunner } from './hooks/useRunner'
import { useKeyboardOpen, useMedia } from './hooks/useMedia'
import { installViewport } from './ui/viewport'
import { chords, formatKeys, isMacLike, isModifierOnly, matchEvent, type Command } from './ui/keys'
import type { EditorController } from './editor/setup'
import { wordsInSource } from './editor/completions'
import { canFormat, formatFile, PythonNotLoadedError } from './actions/format'
import { shareFileAsImage } from './actions/shareImage'
import { ActivityBar } from './components/ActivityBar'
import { Breadcrumbs } from './components/Breadcrumbs'
import { CapabilityBanner, CapabilityFatalScreen } from './components/CapabilityScreens'
import { StorageBanner } from './components/StorageBanner'
import { Console } from './components/Console'
import { Preview } from './components/Preview'
import { ConsoleDivider } from './components/ConsoleDivider'
import { Editor } from './components/Editor'
import { Explorer } from './components/Explorer'
import { InstallControl } from './components/InstallControl'
import { RunBar, type OutputView } from './components/RunBar'
import { resolveEntry, type RunControlState } from './components/RunControl'
import { StatusBar } from './components/StatusBar'
import { Tabs } from './components/Tabs'
import { TopBar } from './components/TopBar'
import type { MenuBarMenu } from './components/MenuBar'
import { WelcomePanel } from './components/WelcomePanel'
import { ImportZipDialog } from './components/ImportZipDialog'
import { QuickInput, type QuickCommand, type QuickInputMode } from './components/QuickInput'
import { TemplatePicker } from './components/TemplatePicker'
import { useDialogs } from './components/ui/DialogProvider'
import { useToast } from './components/ui/Toast'
import type { MenuItem } from './components/ui/Menu'
import { IconFiles, IconFolderOpen, IconShare, IconWand } from './components/ui/Icons'
import { COPY, count } from './copy'
import pkg from '../package.json'

/** The one structural adjustment small screens keep (founder ruling: ONE
 *  layout — the VS Code desktop shell at every size and pointer): below 900px
 *  the sidebar overlays as a drawer instead of docking, and the software-
 *  keyboard compaction applies. Everything else is the same chrome restyled
 *  by tokens, never a different composition. */
const NARROW = '(max-width: 899px)'

/** View-scale bounds (prefs.uiScale — the founder's "everything feels really
 *  zoomed in" slider). CSS `zoom` on #root, NEVER transform:scale — zoom
 *  reflows real layout (Chromium/WebKit/FF126+), transform only paints it
 *  smaller and breaks every measurement. Snapped to the 0.05 notch so the
 *  slider, Zoom In/Out and the persisted value always agree. */
const SCALE_MIN = 0.7
const SCALE_MAX = 1.3
const SCALE_STEP = 0.05
const clampScale = (v: number) =>
  Number.isFinite(v) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 20) / 20)) : 1

/* VSCode's floor plan (docs/design/LAYOUT-VSCODE.md, the ASCII drawing): a
 * FULL-WIDTH title bar over an activity-bar column beside the body, with a
 * full-width status bar underneath (the title bar spans both columns —
 * `col-span-2` in TopBar — and the rail starts under it, VS Code's own
 * stacking). ONE floor plan at every width and pointer (founder ruling): the
 * rail and the status bar render on phones too — 48px of rail is the price of
 * the same shell everywhere, and the body column is minmax(0,1fr) so the
 * editor keeps the rest. The `auto` tracks still collapse to 0 when a child
 * stands down (the status bar while the software keyboard is up).
 *
 * Placement is explicit (`col-start`/`row-start`/`row-span`) rather than by flow
 * order, because the title bar spans two columns while the status bar does too —
 * auto-placement cannot express that. Fixed and sized from --app-h
 * (written by ui/viewport.ts) so iOS cannot scroll the document out from under a
 * focused input. */
const SHELL =
  // The dvh fallback is load-bearing: --app-h is written by JS on first sync, so
  // the very first paint has nothing to read.
  //
  // The height divides by --ui-scale (the #root zoom, index.css): --app-h is
  // measured in UNZOOMED viewport px by ui/viewport.ts, and inside a zoomed
  // subtree a px length renders multiplied by the zoom — without the division
  // a 0.8 scale left the bottom fifth of the viewport blank, and 1.3 pushed
  // the status bar off-screen. (Viewport UNITS need no such correction — the
  // spec divides them by the effective zoom already — so the 100dvh fallback
  // over-corrects for the one pre-hydration frame where --ui-scale is also
  // still unset/1, i.e. never in practice.)
  'app-shell fixed inset-0 h-[calc(var(--app-h,100dvh)/var(--ui-scale,1))] pb-[env(safe-area-inset-bottom)] overflow-hidden grid ' +
  'grid-cols-[auto_minmax(0,1fr)] grid-rows-[var(--bar-title)_minmax(0,1fr)_auto] ' +
  // Keyboard-open compaction (spec §4.3 rule 3) is a PHONE behaviour and stays
  // scoped to below 900px: that is where a software keyboard actually eats the
  // viewport, and the compacted tokens (--bar-top-kb, --touch-kb) are tuned
  // for exactly that bar.
  'max-[899px]:kb-open:grid-rows-[var(--bar-top-kb)_minmax(0,1fr)_auto]'

const BODY = 'app-body col-start-2 row-start-2 relative flex min-h-0 min-w-0 overflow-hidden'

/** A project name as a file name: "My first project" → "my-first-project". */
function slug(name: string | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function App() {
  const report = useMemo(() => checkCapabilities(), [])
  useEffect(() => installViewport(), [])
  // A missing hard requirement is a dead end, and saying so beats a spinner
  // that never finishes.
  if (report.level === 'fatal') return <CapabilityFatalScreen report={report} />
  return <Ide report={report} />
}

function Ide({ report }: { report: CapabilityReport }) {
  const {
    project,
    ready,
    whenReady,
    revision,
    tree,
    projects,
    current: currentProject,
    migration,
    storageProblem,
    quotaTight,
    isPrimaryTab,
    createProject,
    openProject,
    renameProject,
    deleteProject,
  } = useProject()
  const dialogs = useDialogs()
  const notify = useToast()
  const narrow = useMedia(NARROW)
  const keyboardOpen = useKeyboardOpen()

  const bufferRef = useRef<ConsoleBuffer | null>(null)
  if (!bufferRef.current) bufferRef.current = new ConsoleBuffer()
  const buffer = bufferRef.current

  const editorRef = useRef<EditorController | null>(null)

  const initial = useMemo(() => prefs(), [])
  const [hydrated, setHydrated] = useState(false)
  const [tabs, setTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [entryPath, setEntryPath] = useState<string | null>(initial.entryPath)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  // Whole-shell zoom. Clamped on read: a hand-edited localStorage value must
  // not be able to open the app at zoom 5 (or NaN) with no way back to the menu.
  const [uiScale, setUiScale] = useState(() => clampScale(initial.uiScale))
  const [consoleOpen, setConsoleOpen] = useState(!initial.consoleCollapsed)
  const [consoleHeight, setConsoleHeight] = useState(initial.consoleHeight)
  // VS Code's Maximize Panel Size (RunBar's chevron). "Maximized" is
  // an over-asked height the flex layout then bounds — the editor keeps its
  // 96px floor (.console-panel--open shrinks, index.css), which is as far as a
  // maximize can honestly go while the tab strip and editor floor exist. The
  // pre-maximize height lives in a ref so Restore has somewhere to go back to;
  // a hand drag of the divider re-takes ownership and drops the flag.
  const [consoleMaximized, setConsoleMaximized] = useState(false)
  const consoleRestoreHeight = useRef(initial.consoleHeight)
  // Which face the output pane shows for a web project — or null for "not chosen
  // yet", in which case the entry decides (a page opens to the Preview, a lone
  // script to its Console log). Once the student picks, that sticks. Ignored
  // entirely for a Java/Python project, which has no preview.
  const [outputView, setOutputView] = useState<OutputView | null>(null)
  const [hand, setHand] = useState<'right' | 'left'>(initial.hand)
  const [explorerDocked, setExplorerDocked] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Which QuickInput face is up, or none: 'commands' is the palette
  // (Ctrl+Shift+P / F1), 'files' is Go to File (Ctrl+P), 'goto' is Go to Line
  // (Ctrl+G, and the status bar's Ln/Col item), 'recent' is Open Recent on the
  // keyboard (Ctrl+R, Ctrl+K Ctrl+O).
  const [quickPick, setQuickPick] = useState<QuickInputMode | null>(null)
  // Ln:Col for the status bar. Null until a file is open, because a caret
  // position for a document nobody is looking at is a small lie.
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null)

  const candidates = useMemo(() => entryCandidates(project.sourceFiles()), [project, revision])

  // Identifiers from every file, for editor completion. Recomputed on `revision`
  // (structure or dirty changes) rather than per keystroke — the editor scans the
  // buffer being typed in on its own, so this only has to cover the other files.
  //
  // Bounded, because `revision` bumps twice per edited file per debounce window
  // and this is a full re-tokenise of the whole project each time. At a few
  // dozen files that is free; at five hundred it is the difference between an
  // editor that keeps up with typing and one that does not. Past the budget we
  // stop early — the completions get less complete, which a student will never
  // notice, rather than the editor getting slow, which they will.
  const projectWords = useMemo(() => {
    const words = new Set<string>()
    let budget = 2_000_000
    for (const file of project.sourceFiles()) {
      budget -= file.content.length
      if (budget < 0) break
      for (const word of wordsInSource(file.content)) words.add(word)
    }
    return [...words]
  }, [project, revision])
  const runner = useRunner(project, buffer, entryPath)

  // ---- restore the workspace once the project has loaded ----
  // An empty project is not a special mode and does not open anything: the
  // editor area carries WelcomePanel until a file exists (see below).
  useEffect(() => {
    if (!ready || hydrated) return
    const open = initial.openTabs.filter((p) => project.has(p))
    const active = initial.activePath && open.includes(initial.activePath) ? initial.activePath : (open[0] ?? null)
    setTabs(open)
    setActivePath(active)
    // Nothing to run yet, so the console starts as a 44px header and the start
    // panel gets the room. It auto-opens on Run, as it always has.
    if (project.isEmpty()) setConsoleOpen(false)
    setHydrated(true)
  }, [ready, hydrated, project, initial])

  // ---- persist UI state (only after restore, or we'd overwrite it with blanks)
  useEffect(() => {
    if (!hydrated) return
    setPrefs({
      openTabs: tabs,
      activePath,
      entryPath,
      fontSize,
      uiScale,
      consoleCollapsed: !consoleOpen,
      // Never persist the maximized over-ask: a session that ends maximized
      // should reopen at the height the student actually chose.
      consoleHeight: consoleMaximized ? consoleRestoreHeight.current : consoleHeight,
      hand,
    })
  }, [hydrated, tabs, activePath, entryPath, fontSize, uiScale, consoleOpen, consoleHeight, consoleMaximized, hand])

  useEffect(() => {
    document.documentElement.dataset.hand = hand
  }, [hand])

  // The view scale, as a CSS var on <html> rather than a style on the shell
  // div: `#root { zoom: var(--ui-scale) }` (index.css) applies it, and the
  // same var is what the shell's height and the kb-open top rule divide their
  // unzoomed-viewport px back out by.
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
  }, [uiScale])

  /** Zoom In/Out (menu, palette, Mod+=/-). Same pref as the Manage slider. */
  const changeScale = useCallback((delta: number) => setUiScale((s) => clampScale(s + delta)), [])

  // Keep the chosen entry point valid as files come and go.
  useEffect(() => {
    if (candidates.length === 0) return
    if (!entryPath || !candidates.includes(entryPath)) setEntryPath(candidates[0])
  }, [candidates, entryPath])

  // Language is per file, never per app: the file you are looking at is the file
  // Run starts, as long as it is runnable. Otherwise the last choice stands.
  // Without this, a student with Main.java and main.py both open could press Run
  // and have Warsha start the one they are not looking at. (ui-console's request.)
  useEffect(() => {
    if (activePath && candidates.includes(activePath)) setEntryPath(activePath)
  }, [activePath, candidates])

  // The drawer is never the thing being typed into (spec §4.3 rule 2).
  useEffect(() => {
    if (keyboardOpen && narrow) setDrawerOpen(false)
  }, [keyboardOpen, narrow])

  // ---- file operations ----
  const openFile = useCallback(
    (path: string) => {
      if (project.read(path) === undefined) return
      setTabs((cur) => (cur.includes(path) ? cur : [...cur, path]))
      setActivePath(path)
      if (narrow) setDrawerOpen(false)
    },
    [project, narrow],
  )

  const closeTab = useCallback(
    (path: string) => {
      const i = tabs.indexOf(path)
      if (i === -1) return
      const next = tabs.filter((t) => t !== path)
      setTabs(next)
      if (activePath === path) setActivePath(next[i] ?? next[i - 1] ?? null)
      editorRef.current?.closeFile(path)
    },
    [tabs, activePath],
  )

  // Focusing the editor cannot be done at the moment a file is created: on an
  // empty project the Editor is not even mounted yet (the start panel holds that
  // slot), so `editorRef` is still null, and after a template the mount happens a
  // render later. So we record what to focus and do it once that file is actually
  // the open one.
  const focusOnOpen = useRef<string | null>(null)
  useEffect(() => {
    const wanted = focusOnOpen.current
    if (!wanted || activePath !== wanted) return
    focusOnOpen.current = null
    // One frame, so CodeMirror has been created and had its content set.
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [activePath, revision])

  const validName = (name: string): string | null => {
    if (!name) return 'That name is empty.'
    if (name.startsWith('/') || name.endsWith('/')) return 'A name cannot start or end with "/".'
    if (name.split('/').some((s) => s === '' || s === '.' || s === '..')) return 'That path is not valid.'
    if (/[\\:*?"<>|]/.test(name)) return 'That name uses a character files cannot have.'
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(name)) return 'That name uses a character files cannot have.'
    // OPFS itself has no documented limit, but the filesystems underneath it cap
    // a name at 255 bytes and reject the write, which surfaced as a save that
    // silently never happened.
    if (new TextEncoder().encode(name).length > 240) return 'That name is too long.'
    // ".java" is a valid file name and an invalid Java file: the class name would
    // be empty, so `public class  {` never compiles, and CheerpJ requires the
    // public class to match the file name. Caught here rather than as a compiler
    // error the student cannot connect to what they typed. Same for ".py", whose
    // module name would be empty.
    const leaf = name.split('/').pop() ?? ''
    if (/^\.(java|py)$/i.test(leaf)) return `Give the file a name before the "${leaf}".`
    if (leaf.startsWith('.') && leaf.slice(1).includes('.')) return 'A name cannot start with a dot.'
    // Trailing dots and spaces are silently stripped by some filesystems, so
    // "Main.java " and "Main.java" become the same file and one of them is lost.
    if (/[ .]$/.test(leaf)) return 'A name cannot end with a space or a dot.'
    return null
  }

  /** In-dialog validation, so a bad name is answered under the field the
   *  student is already looking at rather than by a toast after it closes. */
  const nameTaken = (dir: string, name: string): string | null => {
    const path = dir ? `${dir}/${name}` : name
    return project.has(path) || project.hasDir(path) ? `There is already a “${name}” here.` : null
  }

  const starterContent = (path: string): string => {
    const { dir, name } = splitPath(path)
    if (name.endsWith('.java')) {
      const cls = name.slice(0, -5)
      const pkg = dir ? `package ${dir.replace(/\//g, '.')};\n\n` : ''
      return `${pkg}public class ${cls} {\n\n}\n`
    }
    if (name.endsWith('.py')) return `"""${name}"""\n\n`
    return ''
  }

  // `presetName` arrives from the explorer's inline create row; without one we
  // fall back to the prompt dialog. Validation stays here either way.
  const newFile = async (dir: string, presetName?: string) => {
    const name =
      presetName ??
      (await dialogs.prompt({
        title: 'New file',
        label: dir ? `Inside ${dir}/` : 'In the project root',
        placeholder: 'Main.java',
        okLabel: 'Create',
        validate: (v) => validName(v) ?? nameTaken(dir, v),
      }))
    if (!name) return
    const problem = validName(name)
    if (problem) return notify(problem, 'error')
    const path = dir ? `${dir}/${name}` : name
    if (project.has(path)) return notify(`${path} already exists.`, 'error')
    try {
      // Same startup race as `replaceProject` — the explorer's New file is also
      // reachable before the store is attached.
      await whenReady()
      await project.createFile(path, starterContent(path))
      // Creating a file is the start of typing in it, so the caret goes there
      // rather than leaving the student to tap the canvas. Deferred, because on
      // the first file of an empty project the editor does not exist yet.
      focusOnOpen.current = path
      openFile(path)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const newFolder = async (dir: string, presetName?: string) => {
    const name =
      presetName ??
      (await dialogs.prompt({
        title: 'New folder',
        label: dir ? `Inside ${dir}/` : 'In the project root',
        placeholder: 'models',
        okLabel: 'Create',
        validate: (v) => validName(v) ?? nameTaken(dir, v),
      }))
    if (!name) return
    const problem = validName(name)
    if (problem) return notify(problem, 'error')
    try {
      await project.createFolder(dir ? `${dir}/${name}` : name)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const renameEntry = async (path: string, isDir: boolean, presetName?: string) => {
    const { dir, name } = splitPath(path)
    const next =
      presetName ??
      (await dialogs.prompt({
        title: isDir ? 'Rename folder' : 'Rename file',
        value: name,
        okLabel: 'Rename',
        validate: (v) => validName(v) ?? (v === name ? null : nameTaken(dir, v)),
      }))
    if (!next || next === name) return
    const problem = validName(next)
    if (problem) return notify(problem, 'error')
    try {
      const mapping = await project.move(path, dir ? `${dir}/${next}` : next)
      for (const [from, to] of mapping) editorRef.current?.renamePath(from, to)
      setTabs((cur) => cur.map((t) => mapping.get(t) ?? t))
      setActivePath((cur) => (cur ? (mapping.get(cur) ?? cur) : cur))
      setEntryPath((cur) => (cur ? (mapping.get(cur) ?? cur) : cur))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  // Drag-and-drop in the explorer: move `path` into folder `toDir` ('' = root),
  // reusing project.move and its rename bookkeeping exactly as renameEntry does.
  const moveEntry = async (path: string, toDir: string) => {
    const { name } = splitPath(path)
    const to = toDir ? `${toDir}/${name}` : name
    if (to === path) return
    try {
      const mapping = await project.move(path, to)
      for (const [from, dest] of mapping) editorRef.current?.renamePath(from, dest)
      setTabs((cur) => cur.map((t) => mapping.get(t) ?? t))
      setActivePath((cur) => (cur ? (mapping.get(cur) ?? cur) : cur))
      setEntryPath((cur) => (cur ? (mapping.get(cur) ?? cur) : cur))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const deleteEntry = async (path: string, isDir: boolean) => {
    const ok = await dialogs.confirm({
      title: isDir ? 'Delete this folder?' : 'Delete this file?',
      message: isDir
        ? `${path} and everything inside it will be removed. This cannot be undone.`
        : `${path} will be removed. This cannot be undone.`,
      okLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const affected = tabs.filter((t) => t === path || t.startsWith(path + '/'))
    await project.remove(path)
    const next = tabs.filter((t) => !affected.includes(t))
    setTabs(next)
    if (activePath && affected.includes(activePath)) setActivePath(next[0] ?? null)
    for (const t of affected) editorRef.current?.closeFile(t)
  }

  /** Resolves false when something could not be written. Never rejects. */
  const saveAll = useCallback(async () => project.saveAll(), [project])

  /** Ctrl+S and every "Save all" row: silent on success — the dirty dots
   *  emptying IS the confirmation, and a toast on every save is noise (VS Code
   *  says nothing either) — but a save that did NOT land still speaks. */
  const saveAllQuiet = useCallback(() => {
    void saveAll().then((ok) => {
      if (!ok) notify(COPY.saveFailed, 'error')
    })
  }, [saveAll, notify])

  /** "Format file" (⋯ menu, Shift+Alt+F) — see actions/format.ts for the
   *  Java/Python split. Applied through the editor controller so it lands as
   *  one undo step and flows through the normal onChange/dirty/save path. */
  const formatActiveFile = useCallback(async () => {
    const path = activePath
    if (!path || !canFormat(path)) return
    const source = project.read(path) ?? ''
    try {
      const formatted = await formatFile(path, source)
      if (formatted === source) {
        notify('Already formatted.')
        return
      }
      editorRef.current?.applyEdit(formatted)
      notify('Formatted.')
    } catch (e) {
      // Booting Python just to format a file would be a silent 11 MB download
      // behind a menu click, so it never happens (see PythonNotLoadedError) —
      // the fix is to run the file once, which the student was already about
      // to do anyway.
      if (e instanceof PythonNotLoadedError) notify('Run this file once to load Python, then Format will work.')
      else notify('Could not format this file.', 'error')
    }
  }, [activePath, project, notify])

  /** "Share as image…" (⋯ menu) — renders the active file to a PNG and hands
   *  it to the OS share sheet, or downloads it. See actions/shareImage.ts. */
  const shareActiveFile = useCallback(async () => {
    const path = activePath
    if (!path) return
    const source = project.read(path) ?? ''
    try {
      const result = await shareFileAsImage(path, source)
      if (result === 'downloaded') notify('Image downloaded.')
    } catch {
      notify('Could not create an image of this file.', 'error')
    }
  }, [activePath, project, notify])

  // ---- starters + zip ----
  // A starter populates the project you are already in. It is an action, not a
  // mode: nothing about the app changes afterwards except which files exist.
  const replaceProject = async (snapshot: FsSnapshot, entry: string | null, label: string) => {
    // The start panel is on screen before storage has finished opening, and a
    // tap in that window used to write the starter into the throwaway store
    // that `switchStore` then loaded over — leaving an open tab for a file that
    // was not there. Wait rather than refuse: a tap that does nothing is the
    // "dead card" complaint this panel exists to answer.
    await whenReady()
    await project.replaceAll(snapshot)
    editorRef.current?.closeFile(editorRef.current.currentPath() ?? '')
    setTabs(entry ? [entry] : [])
    setActivePath(entry)
    setEntryPath(entry)
    // Put the caret in the entry file on a laptop, but NOT on a phone: a starter
    // is something you read and then Run, and focusing CodeMirror there summons
    // the on-screen keyboard over the code the student just asked to see.
    if (entry && !narrow) focusOnOpen.current = entry
    buffer.clear()
    notify(label, 'success')
  }

  const confirmReplace = async (title: string, what: string, okLabel: string) => {
    // Guarded on FILES, not on `isEmpty()` (which is also false for a project
    // holding nothing but an empty folder or a freshly migrated manifest). A
    // first-time student's very first tap on a starter must apply it, never open
    // a destructive confirm about work that does not exist — that reads as "the
    // card is dead", which is the single loudest complaint we have had.
    if (project.paths().length === 0) return true
    return dialogs.confirm({
      title,
      message: `${what} removes the ${count(project.paths().length, 'file')} now in Warsha. Export a .zip first if you want to keep them.`,
      okLabel,
      danger: true,
    })
  }

  /** "Python starter", then "Python starter 2" if that name is already used. */
  const uniqueProjectName = (base: string): string => {
    let name = base
    for (let n = 2; projects.some((p) => p.name === name && p.id !== currentProject?.id); n++) name = `${base} ${n}`
    return name
  }

  const applyTemplate = async (t: Template) => {
    // The start panel only ever shows on an empty project, and a starter picked
    // there fills *that* project in and takes its name, rather than creating a
    // second project beside it — otherwise a first visit always leaves an empty
    // "My project" behind, which is exactly the clutter multi-project is meant to
    // avoid. Either way the student ends up with a named project they can switch
    // back to, which is the point.
    if (project.isEmpty()) {
      await replaceProject(t.snapshot, t.entry, `${t.name} ready — ${count(t.snapshot.files.length, 'file')}.`)
      if (currentProject) await renameProject(currentProject.id, uniqueProjectName(t.name))
      return
    }
    // Reached only if a starter is ever offered from a project that has files:
    // making a new project is the non-destructive answer.
    return newProject(t)
  }

  // The template picker resolves to a starter or to "blank". A starter goes
  // through applyTemplate (fill this empty project, or make a new one). Blank is
  // the old "New project…" default: an empty project you name, unless you are
  // already sitting in one — then there is nothing to create, so open a file.
  const pickStarter = (t: Template) => {
    setPickerOpen(false)
    void applyTemplate(t)
  }
  const startBlank = () => {
    setPickerOpen(false)
    if (project.isEmpty()) void newFile('')
    else void newProject()
  }

  const startEmpty = async () => {
    if (!(await confirmReplace('Empty this project?', 'Emptying this project', 'Empty it'))) return
    await replaceProject({ files: [], dirs: [] }, null, 'Project emptied.')
  }

  const onZipImported = async (snapshot: FsSnapshot, fileName: string) => {
    setImportOpen(false)
    const entry = entryCandidates(snapshot.files)[0] ?? snapshot.files[0]?.path ?? null
    await replaceProject(snapshot, entry, COPY.imported(fileName, snapshot.files.length))
  }

  const exportProject = () => {
    const name = `${slug(currentProject?.name) || 'warsha-project'}.zip`
    exportZip(project.snapshot(), name)
    notify(COPY.exported(name, project.paths().length), 'success')
  }

  // ---- projects ----
  // Switching, creating or deleting a project is the one operation that
  // invalidates the whole workspace, because tabs, the console transcript and the
  // editor's per-file state all belong to the project being left.
  const adoptProject = (leavingTabs: string[]) => {
    // Every path the old project had open is dropped from the editor's state
    // cache by name. Two projects can both contain a "main.py", and without this
    // the cached document from the old one is shown for the new one's file.
    for (const path of leavingTabs) editorRef.current?.closeFile(path)
    const entry = entryCandidates(project.sourceFiles())[0] ?? project.paths()[0] ?? null
    setTabs(entry ? [entry] : [])
    setActivePath(entry)
    setEntryPath(entry)
    buffer.clear()
    // An empty project gives its room back to the start panel, exactly as on a
    // first visit.
    if (project.isEmpty()) setConsoleOpen(false)
  }

  /** A program from the project being left must not outlive it. */
  const stopIfRunning = () => {
    if (runner.busy) runner.stop()
  }

  const projectNameTaken = (name: string, exceptId?: string): string | null =>
    projects.some((p) => p.id !== exceptId && p.name.trim() === name.trim())
      ? 'You already have a project with that name.'
      : null

  const switchToProject = async (id: string) => {
    if (id === currentProject?.id) return
    stopIfRunning()
    const leaving = tabs
    await openProject(id)
    adoptProject(leaving)
  }

  const newProject = async (template?: Template) => {
    const suggested = template ? template.name : nextProjectName(projects)
    const name = await dialogs.prompt({
      title: template ? `New project from “${template.name}”` : 'New project',
      label: 'Project name',
      value: suggested,
      okLabel: 'Create',
      validate: (v) => (v.trim() ? projectNameTaken(v) : 'Give the project a name.'),
    })
    if (!name) return
    stopIfRunning()
    const leaving = tabs
    const meta = await createProject(name, template?.snapshot)
    if (!meta) return notify('Warsha could not create that project.', 'error')
    adoptProject(leaving)
    notify(
      template
        ? `“${meta.name}” ready — ${count(template.snapshot.files.length, 'file')}.`
        : `“${meta.name}” ready.`,
      'success',
    )
  }

  const renameCurrentProject = async () => {
    if (!currentProject) return
    const name = await dialogs.prompt({
      title: 'Rename project',
      label: 'Project name',
      value: currentProject.name,
      okLabel: 'Rename',
      validate: (v) => (v.trim() ? projectNameTaken(v, currentProject.id) : 'Give the project a name.'),
    })
    if (!name || name === currentProject.name) return
    await renameProject(currentProject.id, name)
  }

  const deleteCurrentProject = async () => {
    if (!currentProject) return
    const files = project.paths().length
    const ok = await dialogs.confirm({
      title: `Delete “${currentProject.name}”?`,
      message: `${
        files ? `The ${count(files, 'file')} in it will be removed. ` : ''
      }This cannot be undone. Export a .zip first if you want to keep them.`,
      okLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    stopIfRunning()
    const leaving = tabs
    const gone = currentProject.name
    // The last project cannot be deleted into nothing: the hook opens the next
    // most recent one, or a fresh empty project if that was the only one.
    await deleteProject(currentProject.id)
    adoptProject(leaving)
    notify(`“${gone}” deleted.`)
  }

  // ---- keyboard shortcuts ----
  // ONE window keydown for the whole app (W3-A): every binding lives in the
  // command table (below, near the menus) and is matched here. The
  // `defaultPrevented` early-return is the arbitration with CodeMirror — any
  // key the editor's own keymap claimed is never handled twice. The ONE
  // exception is Mod+Enter: setup.ts swallows it purely to keep
  // defaultKeymap's insertBlankLine out of Run's way, and preventDefault is
  // how a CM binding swallows — so that key must still fall through to
  // run.run here, or Ctrl+Enter from the editor runs nothing at all. The
  // table is read through a ref so the listener registers once; the table
  // itself is rebuilt every render and so never goes stale.
  const runnerRef = useRef(runner)
  runnerRef.current = runner
  const commandsRef = useRef<Command[]>([])
  // A chord in flight: the first half of a two-chord binding ("Mod+K"),
  // waiting up to 3s for its second half, VS Code's own patience.
  const pendingChord = useRef<{ spec: string; timer: number } | null>(null)
  useEffect(() => {
    const clearPending = () => {
      if (!pendingChord.current) return
      clearTimeout(pendingChord.current.timer)
      pendingChord.current = null
    }
    // The editor (contenteditable) is deliberately NOT "typing" here — VS Code
    // toggles the sidebar from the editor. Real fields (dialogs, quick input,
    // the console's stdin) are.
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    const onKey = (e: KeyboardEvent) => {
      // Mod+Enter FROM THE EDITOR excepted — see the arbitration note above
      // the effect. Editor-scoped because the console's stdin field also
      // preventDefaults its Enters, and those really are claimed: Ctrl+Enter
      // there submits the line and must not ALSO toggle the run.
      if (
        e.defaultPrevented &&
        !(
          matchEvent(e, 'Mod+Enter') &&
          e.target instanceof Element &&
          e.target.closest('.cm-editor')
        )
      )
        return
      // A modifier alone is a chord being formed, not a key: holding Ctrl on
      // the way to the O of Ctrl+K Ctrl+O must not consume the pending chord.
      if (isModifierOnly(e)) return
      const pending = pendingChord.current
      if (pending) {
        clearPending()
        for (const cmd of commandsRef.current) {
          if (cmd.enabled && !cmd.enabled()) continue
          for (const spec of cmd.keys ?? []) {
            const seq = chords(spec)
            if (seq.length === 2 && seq[0] === pending.spec && matchEvent(e, seq[1])) {
              e.preventDefault()
              cmd.run()
              return
            }
          }
        }
        // The first chord announced a sequence, so a second key that finishes
        // no binding is swallowed rather than typed into whatever has focus.
        e.preventDefault()
        return
      }
      for (const cmd of commandsRef.current) {
        if (cmd.enabled && !cmd.enabled()) continue
        if (cmd.skipWhenTyping && isTyping(e.target)) continue
        for (const spec of cmd.keys ?? []) {
          const seq = chords(spec)
          if (seq.length === 1) {
            if (matchEvent(e, seq[0])) {
              e.preventDefault()
              cmd.run()
              return
            }
          } else if (matchEvent(e, seq[0])) {
            e.preventDefault()
            const timer = window.setTimeout(() => {
              pendingChord.current = null
            }, 3000)
            pendingChord.current = { spec: seq[0], timer }
            return
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearPending()
    }
  }, [])

  // Three events, not one, because no single one of them fires everywhere the
  // tab can go away:
  //
  //  - `visibilitychange` covers switching apps and switching tabs, and is the
  //    only one iOS Safari reliably fires when the student presses Home.
  //  - `pagehide` covers navigating away and being put into the bfcache, which
  //    on iOS often happens with no `visibilitychange` at all.
  //  - `freeze` covers Chrome discarding a backgrounded tab.
  //
  // All three call the same idempotent flush, so firing twice costs nothing.
  // The flush is async and the page may be gone before OPFS finishes; that is
  // unavoidable (there is no synchronous write) and is exactly why the debounce
  // is 350 ms rather than something more comfortable.
  useEffect(() => {
    const flush = () => void project.saveAll()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    // Engines hold a WASM JVM and a CPython heap. A page that is being unloaded
    // should not still be holding them while iPadOS looks for memory.
    const onPageHide = (e: PageTransitionEvent) => {
      flush()
      if (!e.persisted) disposeRuntimes()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('freeze', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('freeze', flush)
    }
  }, [project])

  // Files from a single-workspace build become a real project on first load. Said
  // out loud, because otherwise the student's work appears to have moved by
  // itself — and if the copy could not be verified, that they still have the
  // original matters far more than tidiness.
  useEffect(() => {
    if (!migration) return
    if (migration.kind === 'migrated') {
      notify(`Your ${count(migration.files, 'file')} are now in a project you can name and switch between.`)
    } else if (migration.kind === 'migration-kept-original') {
      notify('Warsha could not finish moving your files into a project, so it left them exactly where they were.', 'error')
    }
  }, [migration, notify])

  const empty = project.isEmpty()

  // One row per project — File > Open Recent and QuickInput's recent face,
  // most recently opened first, with the open one marked and unselectable.
  // Labels are made unique because `Menu` keys its rows by label, and two
  // projects may be named the same thing.
  const projectRows: MenuItem[] = (() => {
    const used = new Set<string>()
    return projects.map((p) => {
      const isOpen = p.id === currentProject?.id
      let label = p.name
      for (let n = 2; used.has(label); n++) label = `${p.name} (${n})`
      used.add(label)
      return {
        // `id` keys the row, so two projects a student names the same thing
        // cannot collide in React's reconciliation. The label is still made
        // unique above, for the reader rather than for React.
        id: `project:${p.id}`,
        label,
        // Every row carries a glyph, open or not: a closed folder for the ones
        // you can switch to, an open one for the project you are in. A blank slot
        // on some rows and not others left the column ragged.
        icon: isOpen ? <IconFolderOpen size={18} /> : <IconFiles size={18} />,
        hint: isOpen ? 'Open' : undefined,
        disabled: isOpen,
        onSelect: () => void switchToProject(p.id),
      }
    })
  })()

  const explorerVisible = narrow ? drawerOpen : explorerDocked
  /** ONE sidebar toggle behind every entry point (activity bar, title-bar
   *  toggle, View menu, Mod+B): the docked pane at ≥900px, the overlay drawer
   *  below — same control, different docking. */
  const toggleExplorer = () => (narrow ? setDrawerOpen((v) => !v) : setExplorerDocked((v) => !v))
  const activeContent = activePath ? (project.read(activePath) ?? '') : ''

  // One state object for Run/Stop. Its one rendered home at every size is the
  // tab strip's trailing group (Tabs.tsx — VS Code's play corner); the Run
  // menu and the F5/Shift+F5 bindings call the same handlers, so none can
  // drift from the others because there is only one of it.
  const runControl: RunControlState = {
    status: runner.status,
    busy: runner.busy,
    canRun: candidates.length > 0,
    entry: resolveEntry(entryPath, candidates),
    onRun: () => {
      setConsoleOpen(true)
      void runner.run()
    },
    onStop: runner.stop,
  }

  const projectName = currentProject?.name ?? ''

  /** Run a CodeMirror command (Undo/Redo/Find) from a menu row. The view is
   *  reached through the DOM (`EditorView.findFromDOM`) rather than through a
   *  controller method because editor/setup.ts belongs to another package this
   *  overhaul — and focusing first matters: an editor command on an unfocused
   *  editor is a surprise to whoever WAS focused. */
  const editorCommand = (command: (view: EditorView) => boolean) => {
    const dom = document.querySelector('.cm-editor')
    const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
    if (!view) return
    view.focus()
    command(view)
  }

  /** Help > About, and the Manage gear's row. A real alert — one OK — rather
   *  than the confirm it used to ride on, whose Cancel button cancelled
   *  nothing. The version is the package's own, inlined at build time. */
  const showAbout = () =>
    void dialogs.alert({
      title: 'Warsha',
      message: (
        <>
          <p>
            A workshop for code — Java, Python, C# and the web, running entirely in your browser. Your files live on
            this device.
          </p>
          <p className="mt-2 text-text-3">Version {pkg.version}</p>
        </>
      ),
    })

  // ---- the command table (W3-A) ----
  // One list feeds both the central keydown (through commandsRef) and the
  // command palette (QuickInput's `>` face): what you can press is exactly
  // what the palette lists, minus rows whose enabled() says the moment is
  // wrong — a palette row that would do nothing is not shown at all, and a
  // binding whose enabled() answers false leaves its key to the browser
  // (Ctrl+W with nothing open must still close the page — the guard Tabs.tsx
  // used to carry). Rebuilt every render, so the closures never go stale.
  const commands: Command[] = [
    // Escape, in order: the quick input first (it normally swallows its own
    // Escape — this row is the fallback for a stray focus), then the drawer.
    {
      id: 'quickInput.close',
      title: 'Close Quick Input',
      keys: ['Escape'],
      inPalette: false,
      enabled: () => quickPick !== null,
      run: () => setQuickPick(null),
    },
    {
      id: 'drawer.close',
      title: 'Close File Drawer',
      keys: ['Escape'],
      inPalette: false,
      enabled: () => narrow && drawerOpen,
      run: () => setDrawerOpen(false),
    },
    { id: 'file.newFile', title: 'File: New File…', run: () => void newFile('') },
    { id: 'file.saveAll', title: 'File: Save All', keys: ['Mod+S'], run: saveAllQuiet },
    {
      id: 'file.format',
      title: 'File: Format Document',
      keys: ['Shift+Alt+F'],
      enabled: () => canFormat(activePath),
      run: () => void formatActiveFile(),
    },
    {
      id: 'file.share',
      title: 'File: Share as Image…',
      enabled: () => activePath !== null,
      run: () => void shareActiveFile(),
    },
    { id: 'file.import', title: 'File: Import .zip…', run: () => setImportOpen(true) },
    {
      id: 'file.closeEditor',
      title: 'File: Close Editor',
      keys: ['Mod+W'],
      enabled: () => activePath !== null,
      run: () => {
        if (activePath) closeTab(activePath)
      },
    },
    {
      id: 'edit.find',
      title: 'Edit: Find',
      // In the editor CodeMirror's own searchKeymap claims Mod+F first (and
      // preventDefaults, so the guard skips this); this binding is for when
      // focus is elsewhere — VS Code web captures ⌘F everywhere too.
      keys: ['Mod+F'],
      enabled: () => activePath !== null,
      run: () => editorCommand(openSearchPanel),
    },
    {
      id: 'view.toggleSidebar',
      title: 'View: Toggle Primary Side Bar',
      keys: ['Mod+B'],
      skipWhenTyping: true,
      run: toggleExplorer,
    },
    {
      id: 'view.togglePanel',
      title: 'View: Toggle Panel',
      // Ctrl+` binds by physical position (keys.ts matches e.code Backquote),
      // exactly as VS Code does, and Ctrl is literal on the Mac too. Plain
      // backquote is typing and is never intercepted. preventDefault (the
      // dispatcher's) is what keeps Ctrl+J from opening Chrome's Downloads.
      keys: ['Mod+J', 'Ctrl+`'],
      run: () => setConsoleOpen((v) => !v),
    },
    {
      id: 'view.focusExplorer',
      title: 'View: Focus Explorer',
      keys: ['Mod+Shift+E'],
      run: () => {
        if (narrow) setDrawerOpen(true)
        else setExplorerDocked(true)
        // Focus lands after the open state has painted; the active file's row
        // is preferred, the first row is the fallback.
        requestAnimationFrame(() => {
          const row = activePath
            ? document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${CSS.escape(activePath)}"]`)
            : null
          ;(row ?? document.querySelector<HTMLElement>('[role="treeitem"]'))?.focus()
        })
      },
    },
    {
      id: 'view.nextEditor',
      title: 'View: Next Editor',
      keys: ['Ctrl+PageDown'],
      enabled: () => tabs.length > 1,
      run: () => {
        const i = tabs.indexOf(activePath ?? '')
        setActivePath(tabs[(i + 1 + tabs.length) % tabs.length])
      },
    },
    {
      id: 'view.previousEditor',
      title: 'View: Previous Editor',
      keys: ['Ctrl+PageUp'],
      enabled: () => tabs.length > 1,
      run: () => {
        const i = tabs.indexOf(activePath ?? '')
        setActivePath(tabs[(i - 1 + tabs.length) % tabs.length])
      },
    },
    { id: 'view.biggerText', title: 'View: Bigger Text', run: () => setFontSize((s) => Math.min(26, s + 1)) },
    { id: 'view.smallerText', title: 'View: Smaller Text', run: () => setFontSize((s) => Math.max(11, s - 1)) },
    // Whole-shell zoom — a different pref from the text size above (which is
    // editor type only). VS Code's own bindings; the dispatcher's
    // preventDefault is what keeps Ctrl+=/− from ALSO zooming the browser.
    { id: 'view.zoomIn', title: 'View: Zoom In', keys: ['Mod+='], run: () => changeScale(+SCALE_STEP) },
    { id: 'view.zoomOut', title: 'View: Zoom Out', keys: ['Mod+-'], run: () => changeScale(-SCALE_STEP) },
    { id: 'view.resetZoom', title: 'View: Reset Zoom', keys: ['Mod+0'], run: () => setUiScale(1) },
    {
      id: 'view.commandPalette',
      title: 'View: Command Palette…',
      // F1 is the always-works fallback: Firefox reserves Ctrl+Shift+P
      // uncancellably, the same reason VS Code web answers to both.
      keys: ['Mod+Shift+P', 'F1'],
      run: () => setQuickPick('commands'),
    },
    {
      id: 'run.run',
      title: 'Run: Run File',
      // F5 and Ctrl+F5 both run (the dispatcher's preventDefault is what
      // cancels the browser reload they normally mean); Mod+Enter is the
      // historic binding the console's idle line still quotes. While a run is
      // busy the same key stops it — the toggle Mod+Enter always was.
      keys: ['F5', 'Ctrl+F5', 'Mod+Enter'],
      enabled: () => runControl.canRun,
      run: () => {
        const r = runnerRef.current
        if (r.busy) r.stop()
        else {
          setConsoleOpen(true)
          void r.run()
        }
      },
    },
    {
      id: 'run.stop',
      title: 'Run: Stop',
      keys: ['Shift+F5'],
      enabled: () => runnerRef.current.busy,
      run: () => runnerRef.current.stop(),
    },
    { id: 'go.file', title: 'Go: Go to File…', keys: ['Mod+P'], run: () => setQuickPick('files') },
    {
      id: 'go.line',
      title: 'Go: Go to Line/Column…',
      // Literal Ctrl — VS Code keeps ⌃G on the Mac (⌘G is find-next).
      keys: ['Ctrl+G'],
      enabled: () => activePath !== null,
      run: () => setQuickPick('goto'),
    },
    {
      id: 'projects.openRecent',
      title: 'Projects: Open Recent…',
      // Ctrl+R is literal on the Mac too (VS Code's own spelling — ⌘R belongs
      // to the browser reload, which the preventDefault here blocks on
      // Windows/Linux). With no other project the picker would be an empty
      // list, so the key is left to the browser instead.
      keys: ['Ctrl+R', 'Mod+K Mod+O'],
      enabled: () => projects.length > 1,
      run: () => setQuickPick('recent'),
    },
    { id: 'projects.new', title: 'Projects: New Project…', run: () => setPickerOpen(true) },
    {
      id: 'projects.rename',
      title: 'Projects: Rename Project…',
      enabled: () => Boolean(currentProject),
      run: () => void renameCurrentProject(),
    },
    { id: 'projects.export', title: 'Projects: Export as .zip', enabled: () => !empty, run: exportProject },
    // Danger last, the same rule every menu in the app follows.
    { id: 'projects.empty', title: 'Projects: Empty Project…', enabled: () => !empty, run: () => void startEmpty() },
    {
      id: 'projects.delete',
      title: 'Projects: Delete Project…',
      enabled: () => Boolean(currentProject),
      run: () => void deleteCurrentProject(),
    },
  ]
  commandsRef.current = commands

  /** The palette's rows: the same table, palette-visible entries only, with
   *  the first binding platform-formatted for the keycap chips. Disabled rows
   *  are passed so QuickInput can hide them — its contract, not a grey-out. */
  const paletteCommands: QuickCommand[] = commands
    .filter((c) => c.inPalette !== false)
    .map((c) => ({
      id: c.id,
      label: c.title,
      hint: c.keys?.length ? formatKeys(c.keys[0]) : undefined,
      disabled: c.enabled ? !c.enabled() : false,
      run: c.run,
    }))

  // VS Code's menu bar, at every size (below 1050px MenuBar collapses itself
  // to the ☰ "Application Menu" — the same menus behind one button). Every row
  // calls the same action its old home called; the labels are VS Code's, and
  // every hint is rendered by formatKeys from a binding the command table
  // actually serves — a menu that names a shortcut that does not work is worse
  // than none. The File menu is also the one home of every project-scoped job
  // the touch drawer's project switcher used to carry: switch (Open Recent),
  // new, rename, export, import, empty, delete. Destructive rows sit last
  // behind a divider (Menu enforces that) and never near Save.
  const menuBarMenus: MenuBarMenu[] = [
    {
      label: 'File',
      items: [
        { label: 'New File…', onSelect: () => void newFile('') },
        // One row, whatever the language list grows to: it opens the picker,
        // where language and starter are chosen (languages.ts, TemplatePicker).
        { label: 'New Project…', onSelect: () => setPickerOpen(true) },
        // The relocated project switcher (global dedupe #6): most recent
        // first, the open one marked and unselectable — projectRows exactly.
        { label: 'Open Recent', items: projectRows },
        { label: 'Import .zip…', startsGroup: true, onSelect: () => setImportOpen(true) },
        { label: 'Export as .zip', disabled: empty, onSelect: exportProject },
        { label: 'Save All', hint: formatKeys('Mod+S'), startsGroup: true, onSelect: saveAllQuiet },
        {
          label: 'Rename Project…',
          startsGroup: true,
          disabled: !currentProject,
          onSelect: () => void renameCurrentProject(),
        },
        { label: 'Empty Project…', danger: true, disabled: empty, onSelect: () => void startEmpty() },
        { label: 'Delete Project…', danger: true, disabled: !currentProject, onSelect: () => void deleteCurrentProject() },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', hint: formatKeys('Mod+Z'), disabled: !activePath, onSelect: () => editorCommand(undo) },
        {
          label: 'Redo',
          // CodeMirror's own bindings: ⇧⌘Z on the Mac, Ctrl+Y (Windows
          // muscle memory, which CM also maps) elsewhere.
          hint: formatKeys(isMacLike ? 'Shift+Mod+Z' : 'Ctrl+Y'),
          disabled: !activePath,
          onSelect: () => editorCommand(redo),
        },
        {
          label: 'Find…',
          hint: formatKeys('Mod+F'),
          startsGroup: true,
          disabled: !activePath,
          onSelect: () => editorCommand(openSearchPanel),
        },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle Explorer', hint: formatKeys('Mod+B'), onSelect: toggleExplorer },
        { label: 'Toggle Console', hint: formatKeys('Mod+J'), onSelect: () => setConsoleOpen((v) => !v) },
        { label: 'Bigger Text', startsGroup: true, onSelect: () => setFontSize((s) => Math.min(26, s + 1)) },
        { label: 'Smaller Text', onSelect: () => setFontSize((s) => Math.max(11, s - 1)) },
        // Editor type above, whole shell below — two prefs, two groups.
        { label: 'Zoom In', hint: formatKeys('Mod+='), startsGroup: true, onSelect: () => changeScale(+SCALE_STEP) },
        { label: 'Zoom Out', hint: formatKeys('Mod+-'), onSelect: () => changeScale(-SCALE_STEP) },
        { label: 'Reset Zoom', hint: formatKeys('Mod+0'), disabled: uiScale === 1, onSelect: () => setUiScale(1) },
        {
          // Handedness (html[data-hand]) mirrors the console header's Run side.
          // Relocated from the retired touch "⋯" menu; it matters most on touch
          // but is one preference, so it has one home.
          label: hand === 'right' ? 'Run Button on Left' : 'Run Button on Right',
          startsGroup: true,
          onSelect: () => setHand((h) => (h === 'right' ? 'left' : 'right')),
        },
      ],
    },
    {
      label: 'Run',
      items: [
        {
          label: runControl.entry ? `Run ${runControl.entry}` : 'Run',
          hint: formatKeys('F5'),
          disabled: runControl.busy || !runControl.canRun,
          onSelect: runControl.onRun,
        },
        { label: 'Stop', hint: formatKeys('Shift+F5'), disabled: !runControl.busy, onSelect: runControl.onStop },
        {
          label: 'Format File',
          hint: formatKeys('Shift+Alt+F'),
          startsGroup: true,
          disabled: !canFormat(activePath),
          onSelect: () => void formatActiveFile(),
        },
      ],
    },
    {
      label: 'Help',
      items: [{ label: 'About Warsha', onSelect: showAbout }],
    },
  ]

  // The rail's gear (ActivityBar) — VS Code keeps the app-scoped odds and ends
  // behind its own gear, and every row here is an action that already exists.
  const manageItems: MenuItem[] = [
    { label: 'Command Palette…', hint: formatKeys('Mod+Shift+P'), onSelect: () => setQuickPick('commands') },
    {
      // The View-scale slider — a CONTROL row, not a command: `render` rows
      // are not Radix Items (Menu.tsx), so dragging the thumb never
      // select-and-closes the menu, and the % label answers live. Same pref
      // as View > Zoom In/Out; the editor A−/A+ stepper is the other pref
      // (editor type) and stays out of this row.
      id: 'view-scale',
      label: 'View scale',
      startsGroup: true,
      render: (
        <div
          className="flex min-h-touch items-center gap-3 px-3 desk:min-h-[26px]"
          // The slider's own keys must reach the slider, not Radix's roving
          // focus. ONLY those — Escape still bubbles, so the menu closes.
          onKeyDown={(e) => {
            if (/^(Arrow(Left|Right|Up|Down)|Home|End|Page(Up|Down))$/.test(e.key)) e.stopPropagation()
          }}
        >
          <span className="flex-none text-row text-text-1 desk:text-[13px]">View scale</span>
          <input
            type="range"
            aria-label="View scale"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={uiScale}
            onChange={(e) => setUiScale(clampScale(e.currentTarget.valueAsNumber))}
            // accent-color from the one accent token; min-h-touch keeps the
            // 44px hit band on touch (the track paints centred regardless).
            className="min-h-touch min-w-0 flex-1 cursor-pointer accent-(--accent) desk:min-h-0"
          />
          <span className="w-[4ch] flex-none text-right text-micro tabular-nums text-text-2 desk:text-[13px]">
            {Math.round(uiScale * 100)}%
          </span>
        </div>
      ),
    },
    { label: 'About Warsha', startsGroup: true, onSelect: showAbout },
  ]

  // The tab-strip "⋯" (every size, with the trailing group) carries only what
  // is scoped to the FILE — the app-scoped rows live in the menu bar above.
  // "Share as image…" is a QA-clicked string.
  const deskMoreItems: MenuItem[] = [
    {
      label: 'Format file',
      icon: <IconWand size={18} />,
      hint: formatKeys('Shift+Alt+F'),
      disabled: !canFormat(activePath),
      onSelect: () => void formatActiveFile(),
    },
    {
      label: 'Share as image…',
      icon: <IconShare size={18} />,
      disabled: !activePath,
      onSelect: () => void shareActiveFile(),
    },
  ]

  // The output pane has two faces. A page project (html/css) drives the preview
  // iframe and may switch to the Console (its log); a standalone script (.js) is
  // a headless console program with no preview, and everything else (Java,
  // Python) is console-only too. Preview is the default face for a page; the
  // student's own choice overrides it.
  const previewActive = isPreviewEntry(runControl.entry)
  const outputFace: OutputView = previewActive ? (outputView ?? 'preview') : 'console'

  return (
    <div className={SHELL}>
      {/* VSCode's icon column, at every width (one shell). Below 900px its
          Explorer item toggles the overlay drawer — same control, same place,
          different docking. */}
      <ActivityBar
        explorerOpen={explorerVisible}
        onToggleExplorer={toggleExplorer}
        // The rail's Search opens find in the open file — the same action as
        // Edit > Find, disabled under the same condition.
        searchEnabled={activePath !== null}
        onSearch={() => editorCommand(openSearchPanel)}
        manageItems={manageItems}
      />

      <TopBar
        menus={menuBarMenus}
        title={activePath}
        projectName={projectName}
        // The ● prefix on the window title. `revision` bumps on dirty
        // changes, so this stays honest without extra wiring.
        dirty={activePath ? project.isDirty(activePath) : false}
        onToggleSidebar={toggleExplorer}
        onTogglePanel={() => setConsoleOpen((v) => !v)}
        // A slot because the control renders itself away when there is
        // nothing to install (which is most sessions, at every width).
        installSlot={<InstallControl />}
      />

      <div className={BODY}>
        {/* Explorer: docked at ≥900px, an overlay drawer below that. */}
        <aside
          aria-label="Files"
          aria-hidden={!explorerVisible}
          data-state={explorerVisible ? 'open' : 'closed'}
          className={
            'z-20 shrink-0 border-r border-border-subtle ' +
            (narrow
              ? // `.drawer` owns the transform and the --dur transition: the
                // utility form of both compiled to invalid CSS under Tailwind v4,
                // so the drawer used to snap open with no animation at all.
                'drawer absolute inset-y-0 left-0 w-drawer shadow-raised'
              : explorerDocked
                ? 'w-explorer'
                : 'hidden')
          }
        >
          <Explorer
            project={project}
            tree={tree}
            activePath={activePath}
            // The pane header's bold label. The Explorer renders its own VS
            // Code pane header at every size now — the touch-only project
            // switcher row is gone, and every project-scoped job lives in the
            // menu bar's File menu (Open Recent switches).
            projectName={projectName}
            onOpenFile={openFile}
            onNewFile={(dir, name) => void newFile(dir, name)}
            onNewFolder={(dir, name) => void newFolder(dir, name)}
            onRename={(p, isDir, name) => void renameEntry(p, isDir, name)}
            onDelete={(p, isDir) => void deleteEntry(p, isDir)}
            onMove={(p, toDir) => void moveEntry(p, toDir)}
            // The starters live in the workspace itself now, so from a drawer
            // the useful move is to get out of the way and show them. Docked,
            // they are already on screen and the button would be a no-op.
            onShowStarters={narrow ? () => setDrawerOpen(false) : undefined}
          />
        </aside>

        {narrow && drawerOpen ? (
          // `.scrim`, not the bare-bracket custom-property form: that utility
          // compiles to
          // `background-color:--scrim` under Tailwind v4 and the browser drops
          // it, which left the open drawer with no scrim behind it at all.
          <div className="scrim absolute inset-0 z-10" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        ) : null}

        {/* overflow-hidden is a layout guard, not decoration: it is the backstop
            that stops any panel inside from painting outside the work area. The
            console's height comes from a persisted pixel pref, and an oversized
            one used to push its own transcript straight through the bottom of the
            layout. `.console-panel--open` now bounds itself in CSS as well —
            belt and braces, because this is the collision the founder saw. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
          <CapabilityBanner report={report} />
          {/* Below the capability banner deliberately: "this browser cannot run
              your code" outranks "this browser cannot save it". Both are
              standing conditions, so neither is a toast. */}
          <StorageBanner
            problem={storageProblem}
            quotaTight={quotaTight}
            isPrimaryTab={isPrimaryTab}
            migration={migration}
            onExportZip={exportProject}
          />

          {/* An empty project has nothing to tab through and nothing to edit, so
              the editor area carries the start panel instead. This is Warsha's
              entire first-run experience: no gate, no route, no modal, and it is
              gone for good the moment a file exists. */}
          {empty ? (
            <WelcomePanel
              onNewFile={() => void newFile('')}
              onNewProject={() => setPickerOpen(true)}
              onImportZip={() => setImportOpen(true)}
              // Same MRU ordering as projectRows; the open (empty) project is
              // excluded — a link to where you already are is a dead link.
              recent={projects.filter((p) => p.id !== currentProject?.id).map((p) => ({ id: p.id, name: p.name }))}
              onOpenProject={(id) => void switchToProject(id)}
            />
          ) : (
            <>
              <Tabs
                project={project}
                tabs={tabs}
                activePath={activePath}
                onSelect={(p) => setActivePath(p)}
                onClose={closeTab}
                // The strip's trailing group: Run + the file-scoped "⋯" —
                // VS Code's editor-actions corner, Run's one home at every
                // size (it left the title bar and the console header).
                runControl={runControl}
                moreItems={deskMoreItems}
              />

              {/* VS Code's breadcrumbs row, static v1 (W2-A). Sits on the
                  editor surface so the active tab reads into the code. */}
              <Breadcrumbs path={activePath} />

              <Editor
                path={activePath}
                content={activeContent}
                fontSize={fontSize}
                onChange={(p, c) => project.setContent(p, c)}
                onSave={saveAllQuiet}
                onController={(c) => {
                  editorRef.current = c
                }}
                // Only offered where the explorer is hidden behind a drawer;
                // docked, the files are already on screen and the button would be
                // a no-op.
                onBrowseFiles={narrow ? () => setDrawerOpen(true) : undefined}
                projectWords={projectWords}
                onCursor={(line, col) => setCursor({ line, col })}
              />
            </>
          )}

          {/* The console sash, at every width — ConsoleDivider itself grows a
              visible 12px handle on a coarse pointer, so a thumb has something
              to grab (one shell, touch-sized adjustments only). */}
          {consoleOpen ? (
            <ConsoleDivider
              height={consoleHeight}
              // A hand drag is the student choosing a height, so it retires any
              // standing maximize — otherwise Restore would later jump to a
              // pre-maximize height the drag already replaced.
              onHeight={(px) => {
                setConsoleMaximized(false)
                setConsoleHeight(px)
              }}
            />
          ) : null}

          <section
            aria-label="Console"
            data-state={runner.status}
            // `.console-panel` carries the fill, the top divider, the stdin floor
            // and the accent rule that marks a running process. The min-height
            // here used to be a bare-custom-property utility, which Tailwind v4
            // compiles to invalid CSS — so the floor from spec §4.3 rule 4 ("the
            // single most important number in this section") was doing nothing at
            // all. (Spelling that class name out in a comment is enough for
            // Tailwind to emit it again, so it stays paraphrased.)
            className={'console-panel ' + (consoleOpen ? 'console-panel--open' : 'h-bar-top')}
            // The dragged, persisted pixel height at every width (one shell —
            // the old fixed 40% below 900px was a second layout). The panel's
            // own CSS bounds an oversized pref. EXCEPT while a software
            // keyboard is up on a narrow screen: a fixed height of a
            // keyboard-shrunk viewport leaves the transcript ~33px — one and a
            // half output lines, against the four rule 4 asks for. Handing the
            // height to CSS lets `--console-floor` claim what the panel
            // actually needs; the editor keeps its own floor and yields the
            // rest. The panel being typed into should win the space.
            style={consoleOpen && !(narrow && keyboardOpen) ? { height: `${consoleHeight}px` } : undefined}
          >
            <RunBar
              status={runner.status}
              exitCode={runner.exitCode}
              candidates={candidates}
              entryPath={entryPath}
              consoleOpen={consoleOpen}
              previewActive={previewActive}
              view={outputFace}
              onView={setOutputView}
              onEntryChange={setEntryPath}
              onClear={() => buffer.clear()}
              onToggleConsole={() => setConsoleOpen((v) => !v)}
              maximized={consoleMaximized}
              onToggleMaximize={() => {
                if (consoleMaximized) {
                  setConsoleHeight(consoleRestoreHeight.current)
                  setConsoleMaximized(false)
                } else {
                  consoleRestoreHeight.current = consoleHeight
                  // Over-ask on purpose; the panel's flex-shrink + the editor's
                  // min-height floor decide what "maximized" actually is.
                  setConsoleHeight(window.innerHeight)
                  setConsoleMaximized(true)
                }
              }}
            />
            {/* Two faces share this pane. A page project shows the live page
                (Preview) with the Console one tap away for its log; a script and
                the Java/Python engines have only the Console.

                The preview iframe IS the page's execution — so for a page project
                it stays MOUNTED whenever the pane is open, even while the Console
                face is on top, and is merely hidden (`hidden`, display:none). A
                display:none iframe keeps running, so the page's `console.log` fills
                the Console whichever tab you are looking at. Unmounting it on the
                Console tab was the bug where output only appeared after a visit to
                Preview. `contents` lets the iframe's own flex sizing reach the
                pane when it is the shown face. */}
            {consoleOpen && previewActive ? (
              <div className={outputFace === 'preview' ? 'contents' : 'hidden'}>
                <Preview srcdoc={runner.previewDoc} />
              </div>
            ) : null}
            {consoleOpen && outputFace === 'console' ? (
              <Console
                buffer={buffer}
                status={runner.status}
                progress={runner.progress}
                // A run that never started — no engine, no output, nothing the
                // transcript can say. Its own block, with the one button that
                // does something about it.
                failure={runner.failure}
                onRetry={runControl.onRun}
                onDismissFailure={runner.clearFailure}
                bindStdinFocus={runner.bindStdinFocus}
                onSubmitStdin={runner.submitStdin}
                onNotify={notify}
              />
            ) : null}
          </section>
        </main>

      </div>

      {/* The bottom bar (LAYOUT-VSCODE §3), at every width (one shell) — but
          never while a software keyboard is up, because §4.3 rule 4's console
          floor gets its pixels before any decoration does. */}
      {keyboardOpen ? null : (
        <StatusBar
          status={runner.status}
          exitCode={runner.exitCode}
          activePath={activePath}
          entryPath={runControl.entry}
          cursor={empty || !activePath ? null : cursor}
          fontSize={fontSize}
          onFontSize={setFontSize}
          // Ln/Col opens Go to Line — the quick input's ':' face, VS Code's
          // own behaviour for that status item.
          onGotoLine={() => setQuickPick('goto')}
        />
      )}

      {quickPick ? (
        <QuickInput
          mode={quickPick}
          // Open tabs lead — they are what "recently opened" means for the
          // file picker — then the rest of the project in explorer order.
          files={[...tabs, ...project.paths().filter((p) => !tabs.includes(p))]}
          commands={paletteCommands}
          // Same MRU ordering and same exclusion as WelcomePanel's Recent: a
          // row for the project you are already in is a dead link.
          recent={projects.filter((p) => p.id !== currentProject?.id).map((p) => ({ id: p.id, name: p.name }))}
          currentLine={cursor?.line ?? null}
          lineCount={activePath ? activeContent.split('\n').length : null}
          onOpenFile={openFile}
          // The controller's gotoLine is line-only; a ":12,4" column is
          // accepted by the widget and the line half honoured.
          onGotoLine={(line) => editorRef.current?.gotoLine(line)}
          onOpenProject={(id) => void switchToProject(id)}
          onClose={() => setQuickPick(null)}
        />
      ) : null}

      {importOpen ? (
        <ImportZipDialog
          currentFileCount={project.paths().length}
          onCancel={() => setImportOpen(false)}
          onImport={(snapshot, name) => void onZipImported(snapshot, name)}
        />
      ) : null}

      {pickerOpen ? (
        <TemplatePicker
          onPick={pickStarter}
          onBlank={startBlank}
          onCancel={() => setPickerOpen(false)}
        />
      ) : null}
    </div>
  )
}
