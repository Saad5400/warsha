import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { undo, redo, selectAll } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { langOfEntry, track } from './analytics'
import { checkCapabilities, type CapabilityReport } from './capabilities'
import { ConsoleBuffer } from './console/buffer'
import { splitPath } from './fs/project'
import { forgetRoomsForProject, prefs, rememberOwnedRoom, rememberRoomMapping, setPrefs } from './fs/prefs'
import { nextProjectName } from './fs/projects'
import type { FsSnapshot } from './fs/types'
import { disposeRuntimes, entryCandidates, isPreviewEntry, langForPath, runtimeFor } from './runtime'
import { type Template } from './templates'
import { exportZip } from './zip'
import { buildShareUrl, clearShareHash, peekSharedFromUrl, type SharedProject } from './sharelink'
import { useProject } from './hooks/useProject'
import { useRunner } from './hooks/useRunner'
import { useCollab, useCloudSync, materializeCloudDoc, CollabControl, peekRoomFromUrl, type Peer, type CollabBinding } from './collab'
import { createApi, type DocListEntry, type DocRole } from './collab/api'
import { currentToken, useAuth, clearSession, setUser, setUsage } from './collab/auth'
import { useKeyboardOpen, useMedia } from './hooks/useMedia'
import { installViewport } from './ui/viewport'
import { chords, formatKeys, isMacLike, isModifierOnly, matchEvent, type Command } from './ui/keys'
import type { EditorController } from './editor/setup'
import { wordsInSource } from './editor/completions'
import { documentedWordAt, explainAt, setProjectDocsSource } from './editor/hoverDocs'
import { canFormat, formatFile, PythonNotLoadedError } from './actions/format'
import { analyzeForGenerate, canGenerate, type GenAnalysis } from './actions/generate'
import { shareFileAsImage } from './actions/shareImage'
import { shareProjectAsPdf } from './actions/sharePdf'
import { deliverFile, isCancelled, prefersShareSheet } from './actions/deliver'
import { ActivityBar, type SideView } from './components/ActivityBar'
import { SearchView } from './components/SearchView'
import { ExtensionsView } from './components/ExtensionsView'
import { isExtEnabled, setExtEnabled, type ExtId } from './extensions/registry'
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
import { Home, type CloudOnlyEntry } from './components/Home'
import { TutorialsPage } from './components/TutorialsPage'
import { Logo } from './components/Logo'
import type { IconLang } from './components/ui/LangIcons'
import { ImportZipDialog } from './components/ImportZipDialog'
import { AccountDialog } from './components/AccountDialog'
import { ShareDialog } from './components/ShareDialog'
import { QuickInput, type QuickCommand, type QuickInputMode } from './components/QuickInput'
import { TemplatePicker } from './components/TemplatePicker'
import { useDialogs } from './components/ui/DialogProvider'
import { useToast } from './components/ui/Toast'
import { GenerateMenu } from './components/GenerateMenu'
import { Menu, type MenuAnchor, type MenuItem } from './components/ui/Menu'
import {
  IconClear,
  IconClipboard,
  IconClock,
  IconCommand,
  IconCopy,
  IconExport,
  IconFileLines,
  IconFilePlus,
  IconFiles,
  IconFolderOpen,
  IconFolderPlus,
  IconGenerate,
  IconGlobe,
  IconImport,
  IconInfo,
  IconLightbulb,
  IconLink,
  IconMore,
  IconPencil,
  IconPlay,
  IconRedo,
  IconSave,
  IconScissors,
  IconSearch,
  IconSelectAll,
  IconShare,
  IconStop,
  IconSwap,
  IconTerminal,
  IconUser,
  IconTextBigger,
  IconTextSmaller,
  IconTrash,
  IconUndo,
  IconWand,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
} from './components/ui/Icons'
import { COPY } from './copy'
import { DirectionProvider } from '@radix-ui/react-direction'
import { LOCALES, LOCALE_NAMES, dirOf, locale, setLocale, useLocale } from './i18n/locale'
import pkg from '../package.json'

/** Below this, the sidebar becomes a drawer and keyboard compaction applies —
 *  the only layout change at any screen size. */
const NARROW = '(max-width: 899px)'

/** Applied via CSS `zoom` on #root, never transform:scale — zoom reflows
 *  layout, transform only rescales paint and breaks every measurement. */
const SCALE_MIN = 0.7
const SCALE_MAX = 1.3
const SCALE_STEP = 0.05
const clampScale = (v: number) =>
  Number.isFinite(v) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(v * 20) / 20)) : 1

/* VS Code's floor plan (docs/design/LAYOUT-VSCODE.md): same grid at every
 * width — rail and status bar render on phones too, by design. Placement is
 * explicit (col/row-start), not flow order, since both bars span two columns.
 * Sized from --app-h (ui/viewport.ts) so iOS can't scroll the page out from
 * under a focused input. */
const SHELL =
  // 100dvh fallback for the first paint, before ui/viewport.ts writes --app-h.
  // Both divide by --ui-scale: they're measured/resolved unzoomed but paint
  // inside the #root zoom, so undivided they'd render scaled.
  'app-shell fixed inset-0 h-[calc(var(--app-h,100dvh)/var(--ui-scale,1))] pb-[env(safe-area-inset-bottom)] overflow-hidden grid ' +
  'grid-cols-[auto_minmax(0,1fr)] grid-rows-[var(--bar-title)_minmax(0,1fr)_auto] ' +
  // Keyboard-open compaction (spec §4.3 rule 3) is phone-only: a software
  // keyboard only eats the viewport below 900px.
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

/** langForPath's id, narrowed to the five that own a LangIcon glyph (js folds into web). */
function toIconLang(l: ReturnType<typeof langForPath>): IconLang | null {
  return l === 'js' ? 'web' : l
}

export function App() {
  const report = useMemo(() => checkCapabilities(), [])
  useEffect(() => installViewport(), [])
  // Subscribed here, not in `Ide`, so the fatal capability screen is translated too.
  const locale = useLocale()
  // A missing hard requirement is a dead end — better to say so than spin forever.
  const body = report.level === 'fatal' ? <CapabilityFatalScreen report={report} /> : <Ide report={report} />

  /** Radix ignores `<html dir>` — without this, every portalled Menu/Dialog/
   *  Tooltip renders LTR regardless of locale (submenus can even open
   *  off-screen on a phone). Re-renders with `locale` to follow the switch. */
  return <DirectionProvider dir={dirOf(locale)}>{body}</DirectionProvider>
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
    adoptShared,
    openProject,
    renameProject,
    deleteProject,
    snapshotOf,
    duplicateProject,
  } = useProject()
  const dialogs = useDialogs()
  const notify = useToast()
  const narrow = useMedia(NARROW)
  const keyboardOpen = useKeyboardOpen()

  const bufferRef = useRef<ConsoleBuffer | null>(null)
  if (!bufferRef.current) bufferRef.current = new ConsoleBuffer()
  const buffer = bufferRef.current

  const editorRef = useRef<EditorController | null>(null)
  // The editor's touch actions button, anchored to editor chrome (never the
  // caret) so the native selection bar can't cover it.
  const fabRef = useRef<HTMLButtonElement>(null)
  // Which pointer opened the last context menu: a touch long-press must fall
  // through to the native selection callout, not our desktop right-click menu.
  const lastPointerType = useRef<string>('mouse')

  const initial = useMemo(() => prefs(), [])
  const [hydrated, setHydrated] = useState(false)
  const [tabs, setTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [entryPath, setEntryPath] = useState<string | null>(initial.entryPath)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  // Clamped on read — a bad localStorage value must not strand the app at an unusable zoom.
  const [uiScale, setUiScale] = useState(() => clampScale(initial.uiScale))
  const [consoleOpen, setConsoleOpen] = useState(!initial.consoleCollapsed)
  const [consoleHeight, setConsoleHeight] = useState(initial.consoleHeight)
  // VS Code's Maximize Panel Size — bounded by the editor's 96px floor, so not truly full height.
  // Restore height lives in a ref; dragging the divider clears the maximized flag.
  const [consoleMaximized, setConsoleMaximized] = useState(false)
  const consoleRestoreHeight = useRef(initial.consoleHeight)
  // Null means unset: the entry decides (page → Preview, script → Console) until picked.
  // Unused for Java/Python, which have no preview.
  const [outputView, setOutputView] = useState<OutputView | null>(null)
  const [hand, setHand] = useState<'right' | 'left'>(initial.hand)
  const [explorerDocked, setExplorerDocked] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // One sidebar, two views (Explorer/Search); visibility still tracked by explorerDocked/drawerOpen above.
  const [sideView, setSideView] = useState<SideView>('explorer')
  const [importOpen, setImportOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Phase-2 account + share dialogs (COLLAB-SYNC-CONTRACT §7.4).
  const [accountOpen, setAccountOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  // The "Generate…" surface — anchor is the caret's viewport point, analysis the
  // parsed class it reads from. Null while closed.
  const [genMenu, setGenMenu] = useState<{ anchor: MenuAnchor; analysis: GenAnalysis } | null>(null)
  // The editor's right-click menu (desktop) and its touch actions button share
  // one Menu render; `plain` drops the icon gutter for the right-click menu.
  const [editorActionsMenu, setEditorActionsMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[]; plain?: boolean } | null>(null)
  // Which QuickInput face is up: commands (Ctrl+Shift+P), files (Ctrl+P), goto (Ctrl+G), recent (Ctrl+R).
  const [quickPick, setQuickPick] = useState<QuickInputMode | null>(null)
  // Null until a file is open — a caret position for nothing on screen would be a lie.
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null)
  // The linter's running tally, for the status bar's problems item.
  const [problems, setProblems] = useState<{ errors: number; warnings: number }>({ errors: 0, warnings: 0 })

  const candidates = useMemo(() => entryCandidates(project.sourceFiles()), [project, revision])

  // Recomputed on `revision`, not per keystroke — the active buffer is scanned separately by the editor.
  // Bounded so a full re-tokenise can't stall typing on a big project; completions just get less complete instead.
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

  // Module-level source, not a prop — the editor is a singleton mount; `revision` keys its lazy re-scan cache.
  useEffect(() => {
    setProjectDocsSource(() => project.sourceFiles(), revision)
  }, [project, revision])

  const runner = useRunner(project, buffer, entryPath)

  // ---- live collaboration (collab/, COLLAB-SYNC-CONTRACT) ----
  // Keyed to the open project; owns the room lifecycle and presence. It reads a
  // #room= link and connects only from inside this (post-fatal-check) component,
  // never during boot (edge #4). Off by default — nothing connects until the
  // student runs "Start collaboration".
  const collab = useCollab({
    project,
    currentProjectId: currentProject?.id ?? null,
    currentProjectName: currentProject?.name,
    entryPath,
    whenReady,
    // Push the binding into the editor SYNCHRONOUSLY the instant a session is created,
    // before its doc materialises and the auto-open effect opens the entry file. The
    // `collab.binding` state effect below lands a render later — a window a fresh
    // guest's editor-open effect can beat, building the entry file writable before the
    // read-only facet applies (H1). With the binding present, the file's first
    // EditorState reads the guest's fail-closed `readOnly()` and paints read-only.
    onBinding: (binding) => editorRef.current?.setCollab(binding),
  })
  // The singleton editor is told about the binding whenever it changes or the
  // editor (re)mounts — setCollab rebuilds the open file's state around yCollab.
  const [editorReady, setEditorReady] = useState(false)
  useEffect(() => {
    editorRef.current?.setCollab(collab.binding)
    // `collab.readOnly` is a dep though the binding identity is stable across the
    // flip: when the server resolves a viewer role the open file must rebuild with
    // EditorState.readOnly (the binding reads readOnly live, but nothing re-renders
    // the CM state without this re-bind).
  }, [collab.binding, collab.readOnly, editorReady])

  // ---- Phase-2 accounts (collab/auth.ts, §7.1) ----
  // A separate api client for account/sharing calls (the collab hook keeps its
  // own for doc sync). Both resolve the bearer through `currentToken`, so a
  // sign-in swaps the header everywhere at once. Null offline (no VITE_WARSHA_API).
  const auth = useAuth()
  const authApi = useMemo(() => createApi(undefined, undefined, currentToken), [])
  // On boot, validate a stored session against /v1/me: a 401 means the token was
  // revoked/expired — drop it (back to the anonymous device principal); otherwise
  // refresh the cached user + usage. A network failure leaves the session intact
  // (offline is not signed-out). Runs once.
  useEffect(() => {
    if (!authApi) return
    let live = true
    // No device-token mint on boot (L1): a visitor who never collaborates and never
    // signs in must make ZERO /v1 calls and create no device row. The anonymous
    // device principal is now minted lazily on the FIRST collaborate action
    // (useCollab.begin, before its first authenticated sync call) or on sign-in
    // (AccountDialog → claim-device) — each awaits ensureDeviceToken first.
    // Validate a stored session against /v1/me: a 401 means the token was
    // revoked/expired — drop it (back to the device principal); otherwise refresh
    // the cached user + usage. A network failure leaves the session intact (offline
    // is not signed-out).
    if (prefs().sessionToken) {
      void authApi.me().then((me) => {
        if (!live) return
        if ('error' in me) {
          if (me.error === 'auth') clearSession()
          return
        }
        setUser(me.user)
        setUsage(me.usage)
      })
    }
    return () => {
      live = false
    }
  }, [authApi])

  // ---- Phase C: accounts-as-cloud auto-sync (collab/useCloudSync.ts) ----
  // While signed in, every project auto-backs-up to the cloud and the OPEN project
  // keeps a headless durable engine. No-op when signed out (anonymous work is
  // explicit-only, exactly as before). Gated on collab.active so the headless engine
  // and a live CollabSession never both own the open project's doc (single-engine
  // invariant); the imperative suspend/resume below close the start-window precisely.
  const cloud = useCloudSync({
    project,
    currentProjectId: currentProject?.id ?? null,
    projects,
    snapshotOf,
    whenReady,
    signedIn: auth.token !== null && auth.user !== null,
    collabActive: collab.active,
    onOutOfSpace: () => notify(COPY.cloudOutOfSpace, 'error'),
  })
  const cloudRef = useRef(cloud)
  cloudRef.current = cloud

  // A file opened before its room's doc has synced (a guest joins with the file
  // already on screen) gets a plain, non-collab EditorState: its Y.Text does not
  // exist yet, so `isCollab` is false and yCollab is never attached. Remote edits
  // then never render and local ones never propagate. Once the open file becomes a
  // tracked doc (its Y.Text synced in — `revision` bumps as the materializer runs),
  // rebind it. One-shot per path via the ref, so this is not a per-keystroke rebuild.
  const collabBoundPath = useRef<string | null>(null)
  // The binding object identity of the session collabBoundPath was last resolved
  // against. A new session hands us a NEW binding, at which point the old session's
  // collabBoundPath is meaningless — clearing it here, before any rebind decision,
  // is what makes a reused-room restart deterministic (H1): a stale "activePath is
  // already bound" from the torn-down session can no longer suppress the rebind,
  // regardless of React effect ordering around the `active` flag.
  const collabBoundBinding = useRef<CollabBinding | null>(null)
  useEffect(() => {
    if (!collab.active) {
      collabBoundPath.current = null
      collabBoundBinding.current = null
      return
    }
    if (collabBoundBinding.current !== collab.binding) {
      collabBoundBinding.current = collab.binding
      collabBoundPath.current = null
    }
    if (!collab.binding || !activePath) return
    if (collab.binding.isCollab(activePath) && collabBoundPath.current !== activePath) {
      collabBoundPath.current = activePath
      editorRef.current?.setCollab(collab.binding)
    }
    // `collab.readyRev` (H1) is the DETERMINISTIC trigger: it bumps once this
    // session's initial local+durable sync has settled with the mirror open, so
    // the open file's Y.Text is guaranteed to exist and `isCollab(activePath)` is
    // true — the reused-room restart rebinds here without racing any change event.
    // `collab.filesRev` stays a backstop for a guest's late-arriving files, and
    // `revision` covers a materialise that also bumped the Project.
  }, [collab.active, collab.binding, activePath, revision, collab.filesRev, collab.readyRev])

  // Which local project a room materialises into (persisted, per device). Both the
  // host (on start) and a guest (on first join) record it, so a reload rejoins the
  // same project rather than spawning a duplicate. See enterRoom below. Writes go
  // through rememberRoomMapping (both directions, cross-tab-safe fresh merge).
  const roomProjectId = useCallback((roomId: string): string | null => (prefs().roomProjects ?? {})[roomId] ?? null, [])
  const rememberRoomProject = useCallback((roomId: string, projectId: string) => {
    rememberRoomMapping(roomId, projectId)
  }, [])

  // Latest collab state behind a ref, so switch-path helpers and the tab-hide
  // flush handler can reach it without re-registering per render.
  const collabRef = useRef(collab)
  collabRef.current = collab
  // The open project's id, readable from long-lived async flows (enterRoom's boot
  // invocation) whose closures went stale. Without this, a boot-time
  // switchToProject(<already-open id>) missed the early-return and stopped the
  // just-joined session.
  const currentProjectIdRef = useRef<string | null>(null)
  currentProjectIdRef.current = currentProject?.id ?? null

  /** Ends any live session — flushing its durable store — BEFORE the workspace
   *  points at another project. Every project switch/delete path awaits this: a
   *  still-attached bridge would otherwise diff the NEW project's files against
   *  the room doc and wipe the room (and every guest's OPFS with it). */
  const stopCollabBeforeSwitch = useCallback(async () => {
    if (collabRef.current.active) {
      await collabRef.current.stop()
      // Clear any collab suspension so the ambient headless engine can re-attach to
      // whichever project the workspace lands on next (the reconcile keys on the new
      // currentProjectId). Also flush the open engine's last window before we move.
      cloudRef.current.resumeAfterCollab()
    }
    await cloudRef.current.flushOpen()
  }, [])

  /** Start/stop collaboration; on start the join link goes to the clipboard. */
  const toggleCollab = useCallback(async () => {
    if (collab.active) {
      await collab.stop()
      // Live session gone — let the ambient headless engine re-own the doc (§ single-engine).
      cloudRef.current.resumeAfterCollab()
      notify(COPY.collabStopped)
      return
    }
    // ★ Single-engine invariant: flush+destroy this project's headless cloud engine
    // BEFORE the live session opens its own IndexeddbPersistence+BlobSyncProvider on
    // the SAME docId (a re-collaborated project reuses its room id == cloud doc id).
    // suspendForCollab latches the engine off until resumeAfterCollab, so the reconcile
    // can't re-attach in the window before collab.active flips true.
    await cloudRef.current.suspendForCollab()
    const url = await collab.start()
    if (!url) {
      cloudRef.current.resumeAfterCollab()
      notify(COPY.collabStartFailed, 'error')
      return
    }
    // Bind this room to the project it was started from, so a host reload rejoins
    // that project (not a fresh empty one) and a later re-start reuses the same
    // room id. start() has just written the #room= hash.
    const startedRoom = peekRoomFromUrl()
    if (startedRoom && currentProject) rememberRoomProject(startedRoom, currentProject.id)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      /* clipboard blocked — the link is still in the address bar as #room= */
    }
    notify(COPY.collabStarted, 'success')
  }, [collab, notify, currentProject, rememberRoomProject])

  // Peer join/left toasts — a quiet status line, not a modal (fix: peers used to
  // come and go with no signal at all, including the host leaving).
  const prevPeersRef = useRef<Peer[]>([])
  useEffect(() => {
    if (!collab.active) {
      prevPeersRef.current = []
      return
    }
    const prev = prevPeersRef.current
    prevPeersRef.current = collab.peers
    const prevIds = new Set(prev.map((p) => p.clientId))
    const curIds = new Set(collab.peers.map((p) => p.clientId))
    for (const p of collab.peers) if (!prevIds.has(p.clientId)) notify(COPY.collabJoined(p.user.name))
    for (const p of prev) if (!curIds.has(p.clientId)) notify(COPY.collabLeft(p.user.name))
  }, [collab.active, collab.peers, notify])

  // Surface durable-sync failures once per state change: an oversized project or
  // a rejected token used to fail silently in an endless retry loop.
  const lastCollabStatus = useRef<string | null>(null)
  useEffect(() => {
    if (!collab.active) {
      lastCollabStatus.current = null
      return
    }
    if (collab.status === lastCollabStatus.current) return
    lastCollabStatus.current = collab.status
    if (collab.status === 'too-large') notify(COPY.collabTooLarge, 'error')
    else if (collab.status === 'out-of-space') notify(COPY.collabOutOfSpace, 'error')
    else if (collab.status === 'auth') notify(COPY.collabAuthFailed, 'error')
  }, [collab.active, collab.status, notify])

  // A guest sitting in an empty room (host offline, nothing persisted) gets a
  // non-blocking heads-up after ~15s instead of a blank project labeled "Live".
  useEffect(() => {
    if (!collab.active || collab.synced) return
    const timer = window.setTimeout(() => notify(COPY.collabNobodyYet), 15_000)
    return () => window.clearTimeout(timer)
  }, [collab.active, collab.synced, notify])

  // Host: propagate project rename and entry changes into the doc's meta map so
  // guests follow along mid-session (setMeta no-ops when nothing changed).
  useEffect(() => {
    if (!collab.active || !collab.isHost) return
    collabRef.current.setMeta({ name: currentProject?.name, entry: entryPath })
  }, [collab.active, collab.isHost, currentProject?.name, entryPath])

  // ---- a #share= link in the URL (sharelink.ts) ----
  // Funnels URL (fresh load) and hashchange (link pasted into an open tab) through `applyShared`.
  // The boot value gates workspace restore below, to avoid racing the project switch; hash clears only once import lands (see peekSharedFromUrl).
  const pendingShareRef = useRef<SharedProject | 'broken' | null | undefined>(undefined)
  if (pendingShareRef.current === undefined) pendingShareRef.current = peekSharedFromUrl()
  const [shareHandled, setShareHandled] = useState(pendingShareRef.current === null)
  const shareAdopted = useRef(false)

  // ---- a #room= live-collab invite in the URL (collab/room.ts) ----
  // The twin of #share=, but the payload is only a room id — the files arrive over
  // the session. Boot reads it once so the shell opens straight into the editor
  // (never stranded on Home); `enterRoom` below opens the room's project and joins.
  const pendingRoomRef = useRef<string | null | undefined>(undefined)
  if (pendingRoomRef.current === undefined) pendingRoomRef.current = peekRoomFromUrl()

  // Cold start lands on the projects Home (founder ruling); a #share= or #room=
  // link opens straight into the project instead. Entering/creating one flips to 'editor'.
  const [view, setView] = useState<'home' | 'editor' | 'tutorials'>(() =>
    (pendingShareRef.current && pendingShareRef.current !== 'broken') || pendingRoomRef.current ? 'editor' : 'home',
  )
  // Home's pinned projects (persisted). A per-device preference, so it lives in prefs, not the manifest.
  const [pinned, setPinned] = useState<string[]>(() => prefs().pinnedProjectIds ?? [])

  const shareBrokenNotice = useCallback(
    () => notify(COPY.noteShareBroken, 'error'),
    [notify],
  )

  /** Lands `shared` on this device: the untouched-copy project if one exists,
   *  a new one otherwise (adoptShared), then points the workspace at it. */
  const applyShared = useCallback(
    async (shared: SharedProject): Promise<boolean> => {
      await whenReady()
      if (runner.busy) runner.stop()
      // A live room must end before the workspace re-points — see stopCollabBeforeSwitch.
      await stopCollabBeforeSwitch()
      const before = currentProject?.id
      const leaving = tabs
      const result = await adoptShared(shared.name, shared.snapshot)
      if (!result) {
        notify(COPY.noteShareSaveFailed, 'error')
        return false
      }
      // Only a genuinely new copy counts — re-opening the same link on the same
      // device is one student returning, which the visit count already says.
      if (result.created) {
        const first = shared.entry ?? entryCandidates(shared.snapshot.files)[0] ?? null
        track('project_created', { source: 'share', lang: first ? langOfEntry(first) : 'none' })
      }
      // Skip re-pointing to a project already open: reopening identical [path, content] doesn't
      // remount Editor, leaving it detached and silently swallowing keystrokes. Boot case still adopts.
      if (result.meta.id !== before || tabs.length === 0) {
        // Same per-path eviction as any project switch — two projects can both have a "main.py".
        for (const path of leaving) editorRef.current?.closeFile(path)
        const entry = shared.entry ?? entryCandidates(shared.snapshot.files)[0] ?? shared.snapshot.files[0]?.path ?? null
        setTabs(entry ? [entry] : [])
        setActivePath(entry)
        setEntryPath(entry)
        buffer.clear()
      }
      notify(
        result.created
          ? COPY.noteProjectReady(result.meta.name, shared.snapshot.files.length)
          : COPY.noteShareDuplicate(result.meta.name),
        'success',
      )
      // A shared link is an instruction to open that project — never strand it behind Home.
      setView('editor')
      return true
    },
    [whenReady, runner, currentProject, tabs, adoptShared, notify, buffer, stopCollabBeforeSwitch],
  )

  useEffect(() => {
    const shared = pendingShareRef.current
    if (!shared) return
    pendingShareRef.current = null
    void (async () => {
      try {
        if (shared === 'broken') {
          shareBrokenNotice()
          clearShareHash()
          return
        }
        shareAdopted.current = await applyShared(shared)
        // Only a landed import retires the hash. A failed one keeps it, so a
        // reload retries instead of quietly losing what the link carried —
        // and the COOP/COEP service worker's own first-visit reload re-runs
        // the import off the still-present hash (see peekSharedFromUrl).
        if (shareAdopted.current) clearShareHash()
      } finally {
        setShareHandled(true)
      }
    })()
    // Mount-only: the boot payload exists exactly once; the first-render
    // applyShared (tabs = []) is the right one — no tabs are open yet.
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onHashChange = () => {
      const shared = peekSharedFromUrl()
      if (!shared) return
      if (shared === 'broken') {
        shareBrokenNotice()
        clearShareHash()
        return
      }
      void applyShared(shared).then((ok) => {
        if (ok) clearShareHash()
      })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [applyShared, shareBrokenNotice])

  // ---- a #room= live-collaboration invite (collab/, COLLAB-SYNC-CONTRACT §5) ----
  // Opening a room link must land the guest IN the session, not on Home. `enterRoom`
  // (defined lower — it needs the project-switch helpers, reached via this ref) opens
  // or creates the project the room materialises into; the gated effect then joins
  // once that project is current, so the session's bridge fills the right project.
  const enterRoomRef = useRef<(roomId: string) => void>(() => {})
  const roomEntered = useRef<Set<string>>(new Set())
  const joinedRoom = useRef<string | null>(null)
  const roomAdopted = useRef<string | null>(null)

  // Boot (link opened cold) + hashchange (link pasted into an already-open app).
  useEffect(() => {
    if (pendingRoomRef.current) enterRoomRef.current(pendingRoomRef.current)
    const onHashChange = () => {
      const roomId = peekRoomFromUrl()
      if (roomId) enterRoomRef.current(roomId)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Connect only once the room's project is the open one — the session's bridge
  // then materialises into it, never into whatever was open at boot.
  useEffect(() => {
    const roomId = peekRoomFromUrl()
    if (!roomId || collab.active || joinedRoom.current === roomId) return
    if (currentProject && roomProjectId(roomId) === currentProject.id) {
      joinedRoom.current = roomId
      void collab.join(roomId)
    }
  }, [currentProject, collab, roomProjectId])

  // Once a joined room's files + meta have synced in, adopt the host's project name
  // and open its entry file (a fresh guest project is otherwise filled but tab-less).
  useEffect(() => {
    const roomId = collab.roomId
    const meta = collab.roomMeta
    if (!roomId || !currentProject || roomAdopted.current === roomId) return
    if (roomProjectId(roomId) !== currentProject.id) return
    const files = project.sourceFiles()
    if (files.length === 0) return // wait for the first materialise
    roomAdopted.current = roomId
    if (meta?.name && meta.name !== currentProject.name) void renameProject(currentProject.id, meta.name)
    const entry = meta?.entry && project.has(meta.entry) ? meta.entry : (entryCandidates(files)[0] ?? project.paths()[0] ?? null)
    if (entry && tabs.length === 0) {
      setTabs([entry])
      setActivePath(entry)
      setEntryPath(entry)
    }
  }, [collab.roomId, collab.roomMeta, currentProject, project, revision, tabs.length, roomProjectId, renameProject])

  // …and KEEP adopting meta after that first pass: a host rename or entry change
  // mid-session writes the doc's meta map, and a guest follows it live (the
  // one-shot effect above only covers the join).
  useEffect(() => {
    if (!collab.active || collab.isHost || !collab.roomMeta || !currentProject) return
    if (roomAdopted.current !== collab.roomId) return // initial adoption owns the first pass
    const meta = collab.roomMeta
    if (meta.name && meta.name !== currentProject.name) void renameProject(currentProject.id, meta.name)
    if (meta.entry && meta.entry !== entryPath && project.has(meta.entry)) setEntryPath(meta.entry)
  }, [collab.active, collab.isHost, collab.roomId, collab.roomMeta, currentProject, entryPath, project, revision, renameProject])

  // ---- restore the workspace once the project has loaded ----
  // An empty project is not a special mode and does not open anything: the
  // editor area carries WelcomePanel until a file exists (see below).
  useEffect(() => {
    if (!ready || hydrated || !shareHandled) return
    if (shareAdopted.current) {
      // A share link just chose the workspace (its entry file is the one open
      // tab); restoring the previous session's tabs would undo the import.
      setHydrated(true)
      return
    }
    const open = initial.openTabs.filter((p) => project.has(p))
    const active = initial.activePath && open.includes(initial.activePath) ? initial.activePath : (open[0] ?? null)
    setTabs(open)
    setActivePath(active)
    // Nothing to run yet, so the console starts as a 44px header and the start
    // panel gets the room. It auto-opens on Run, as it always has.
    if (project.isEmpty()) setConsoleOpen(false)
    setHydrated(true)
  }, [ready, hydrated, shareHandled, project, initial])

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

  // On <html>, not the shell div — index.css's `#root { zoom: var(--ui-scale) }` and the SHELL height calc above both read this same var.
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

  // Java only: ECJ's ~12s cold JVM load is irreducible (see runtimes/java/INTEGRATION.md), so pre-warming
  // saves real wait time; its ~1MB+3MB engine is small, where Python/C# would pull tens of MB unasked.
  // 600ms delay balances not blocking first paint against finishing before the student reads their code.
  // Silent on purpose (progress UI belongs to an explicit run); load() is idempotent so Run's call just joins this one.
  useEffect(() => {
    if (!hydrated || !entryPath || langForPath(entryPath) !== 'java') return
    const timer = window.setTimeout(() => {
      runtimeFor(entryPath)
        ?.load(() => {})
        .catch(() => {
          // Swallowed: Run's own load() retries and is where a failure should surface.
        })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [hydrated, entryPath])

  // Per file, not per app: Run starts whatever file is active (if runnable), never the one you're not looking at.
  useEffect(() => {
    if (activePath && candidates.includes(activePath)) setEntryPath(activePath)
  }, [activePath, candidates])

  // Spec §4.3 rule 2 (drawer yields to typing) excludes typing into the drawer itself, or Search's
  // auto-focused query field would close on its own first letter.
  useEffect(() => {
    if (!(keyboardOpen && narrow)) return
    const aside = document.querySelector(`aside[aria-label="${COPY.a11yFiles}"]`)
    if (aside && aside.contains(document.activeElement)) return
    setDrawerOpen(false)
  }, [keyboardOpen, narrow])

  // ---- file operations ----
  /** Pending selection for Search's openAt (same deferred pattern as focusOnOpen).
   *  Cleared on any ordinary open so a stale range can't fire on the wrong doc. */
  const selectOnOpen = useRef<{ path: string; from: number; to: number } | null>(null)

  const openFile = useCallback(
    (path: string) => {
      if (project.read(path) === undefined) return
      selectOnOpen.current = null
      setTabs((cur) => (cur.includes(path) ? cur : [...cur, path]))
      setActivePath(path)
      if (narrow) setDrawerOpen(false)
    },
    [project, narrow],
  )

  /** DOM-reached (setup.ts is another package this wave). Range clamped to the doc's
   *  end; rAF covers a same-frame mount. No focus() on narrow — a search tap shouldn't open the keyboard. */
  const applySelection = useCallback(
    (from: number, to: number) => {
      requestAnimationFrame(() => {
        const dom = document.querySelector('.cm-editor')
        const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
        if (!view) return
        const len = view.state.doc.length
        view.dispatch({
          selection: { anchor: Math.min(from, len), head: Math.min(to, len) },
          scrollIntoView: true,
        })
        if (!narrow) view.focus()
      })
    },
    [narrow],
  )

  /** Search view's row tap: opens via the normal openFile flow, then selects now
   *  or via the effect below once the file is up. */
  const openAt = useCallback(
    (path: string, from: number, to: number) => {
      if (project.read(path) === undefined) return
      openFile(path)
      if (activePath === path) applySelection(from, to)
      else selectOnOpen.current = { path, from, to }
    },
    [project, openFile, activePath, applySelection],
  )

  // Same deferral as focusOnOpen — the editor for a file opened from Search may not exist yet.
  useEffect(() => {
    const wanted = selectOnOpen.current
    if (!wanted || activePath !== wanted.path) return
    selectOnOpen.current = null
    applySelection(wanted.from, wanted.to)
  }, [activePath, revision, applySelection])

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

  // Close-others / close-all: one state update for the whole batch. Looping
  // closeTab() would reschedule setTabs from the same stale `tabs` each pass, so
  // only the last close survived (the "close all leaves everything but one" bug).
  const closeTabs = useCallback(
    (paths: string[]) => {
      const removing = new Set(paths)
      if (removing.size === 0) return
      const next = tabs.filter((t) => !removing.has(t))
      setTabs(next)
      if (activePath && removing.has(activePath)) {
        const i = tabs.indexOf(activePath)
        setActivePath(
          tabs.slice(i + 1).find((t) => !removing.has(t)) ??
            tabs.slice(0, i).reverse().find((t) => !removing.has(t)) ??
            null,
        )
      }
      for (const t of paths) editorRef.current?.closeFile(t)
    },
    [tabs, activePath],
  )

  // Deferred: right after creating a file on an empty project, Editor isn't mounted yet —
  // record the target and focus once it's actually open.
  const focusOnOpen = useRef<string | null>(null)
  useEffect(() => {
    const wanted = focusOnOpen.current
    if (!wanted || activePath !== wanted) return
    focusOnOpen.current = null
    // One frame, so CodeMirror exists with its content set.
    requestAnimationFrame(() => editorRef.current?.focus())
  }, [activePath, revision])

  const validName = (name: string): string | null => {
    if (!name) return COPY.nameEmpty
    if (name.startsWith('/') || name.endsWith('/')) return COPY.nameSlashEnds
    if (name.split('/').some((s) => s === '' || s === '.' || s === '..')) return COPY.namePathInvalid
    if (/[\\:*?"<>|]/.test(name)) return COPY.nameBadCharacter
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(name)) return COPY.nameBadCharacter
    // Underlying filesystems cap names at 255 bytes; over that OPFS silently fails to save.
    if (new TextEncoder().encode(name).length > 240) return COPY.nameTooLong
    // ".java"/".py" alone would compile to an empty class/module name — caught here,
    // not as a compiler error the student can't connect to what they typed.
    const leaf = name.split('/').pop() ?? ''
    if (/^\.(java|py)$/i.test(leaf)) return COPY.nameNeedsStem(leaf)
    if (leaf.startsWith('.') && leaf.slice(1).includes('.')) return COPY.nameDotStart
    // Some filesystems strip trailing dots/spaces, so "Main.java " and "Main.java" would collide.
    if (/[ .]$/.test(leaf)) return COPY.nameDotEnd
    return null
  }

  /** In-dialog: answers under the field being looked at, not a toast after it closes. */
  const nameTaken = (dir: string, name: string): string | null => {
    const path = dir ? `${dir}/${name}` : name
    return project.has(path) || project.hasDir(path) ? COPY.nameTaken(name) : null
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
        title: COPY.dlgNewFileTitle,
        label: dir ? COPY.dlgInside(dir) : COPY.dlgInRoot,
        placeholder: COPY.dlgFilePlaceholder,
        okLabel: COPY.dlgCreate,
        validate: (v) => validName(v) ?? nameTaken(dir, v),
      }))
    if (!name) return
    const problem = validName(name)
    if (problem) return notify(problem, 'error')
    const path = dir ? `${dir}/${name}` : name
    if (project.has(path)) return notify(COPY.pathExists(path), 'error')
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
        title: COPY.dlgNewFolderTitle,
        label: dir ? COPY.dlgInside(dir) : COPY.dlgInRoot,
        placeholder: COPY.dlgFolderPlaceholder,
        okLabel: COPY.dlgCreate,
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
        title: isDir ? COPY.dlgRenameFolderTitle : COPY.dlgRenameFileTitle,
        value: name,
        okLabel: COPY.dlgRename,
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
      title: isDir ? COPY.dlgDeleteFolderTitle : COPY.dlgDeleteFileTitle,
      message: isDir ? COPY.dlgDeleteFolderBody(path) : COPY.dlgDeleteFileBody(path),
      okLabel: COPY.dlgDelete,
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

  /** Silent on success — dirty dots emptying is confirmation enough (VS Code does the same);
   *  a failed save still speaks. Runs the Format on Save extension first when it is on. */
  const saveAllQuiet = useCallback(() => {
    void (async () => {
      // Format on Save (extensions/registry.ts) — the active file only, and
      // dead silent when auto: it never boots Python (PythonNotLoadedError), and
      // a file it cannot format is left as written. The explicit Format action
      // is where a student hears about those; a save must never nag.
      if (isExtEnabled('format-on-save') && activePath && canFormat(activePath)) {
        try {
          const source = project.read(activePath) ?? ''
          const formatted = await formatFile(activePath, source)
          if (formatted !== source) editorRef.current?.applyEdit(formatted)
        } catch {
          /* silent by design — see above */
        }
      }
      const ok = await saveAll()
      if (!ok) notify(COPY.saveFailed, 'error')
    })()
  }, [saveAll, notify, activePath, project])

  /** Flip an extension on/off: persist the choice, then apply it live — the
   *  editor-kind ones reconfigure the view; behavior ones (Format on Save) are
   *  read straight from the store where they are used. */
  const toggleExtension = useCallback((id: ExtId, on: boolean) => {
    setExtEnabled(id, on)
    editorRef.current?.setExtensions()
  }, [])

  /** Shift+Alt+F (see actions/format.ts for the Java/Python split). Applied via the editor
   *  controller so it's one undo step through the normal onChange/dirty/save path. */
  const formatActiveFile = useCallback(async () => {
    const path = activePath
    if (!path || !canFormat(path)) return
    const source = project.read(path) ?? ''
    try {
      const formatted = await formatFile(path, source)
      if (formatted === source) {
        notify(COPY.noteAlreadyFormatted)
        return
      }
      editorRef.current?.applyEdit(formatted)
      notify(COPY.noteFormatted)
    } catch (e) {
      // Never boots Python just for this (a silent 11MB download) — see PythonNotLoadedError;
      // running the file once is the fix.
      if (e instanceof PythonNotLoadedError) notify(COPY.noteFormatNeedsPython)
      else notify(COPY.noteFormatFailed, 'error')
    }
  }, [activePath, project, notify])

  /** Alt+Insert (also the ⋯ and Run menus) — parse the class the cursor sits in,
   *  then open the generator menu at the caret. Parsing is lazy (the Java grammar
   *  wasm loads on first use), so this is async; a class that can't be read
   *  answers with a quiet, worded notice rather than an empty menu. */
  const openGenerate = useCallback(async () => {
    const path = activePath
    if (!path || !canGenerate(path)) return
    const dom = document.querySelector('.cm-editor')
    const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
    const source = project.read(path) ?? ''
    const cursor = view ? view.state.selection.main.head : 0
    let result: Awaited<ReturnType<typeof analyzeForGenerate>>
    try {
      result = await analyzeForGenerate(path, source, cursor)
    } catch {
      notify(COPY.noteGenerateFailed, 'error')
      return
    }
    if ('reason' in result) {
      notify(
        result.reason === 'syntaxError'
          ? COPY.noteGenerateSyntax
          : result.reason === 'noClass'
            ? COPY.noteGenerateNoClass
            : COPY.noteGenerateFailed,
        result.reason === 'unsupported' ? 'error' : 'info',
      )
      return
    }
    // A menu of all-disabled rows is dead UI — happens on Python/C# once every
    // generator's output already exists (Java is spared: Constructor is always
    // offerable). Say so instead of opening it.
    if (result.options.every((o) => !o.available)) {
      notify(COPY.noteGenerateExists)
      return
    }
    // Open at the caret (its bottom edge), like the tab menu opens at its button.
    const coords = view?.coordsAtPos(cursor)
    const anchor: MenuAnchor = coords
      ? { x: coords.left, y: coords.bottom }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    setGenMenu({ anchor, analysis: result })
  }, [activePath, project, notify])

  /** Renders the active file to PNG: share sheet on handhelds, clipboard/download on
   *  desktop (see actions/shareImage.ts, deliver.ts). */
  const shareActiveFile = useCallback(async () => {
    const path = activePath
    if (!path) return
    const source = project.read(path) ?? ''
    try {
      const result = await shareFileAsImage(path, source)
      if (result === 'copied') notify(COPY.noteImageCopied, 'success')
      else if (result === 'downloaded') notify(COPY.noteImageDownloaded)
    } catch {
      notify(COPY.noteImageFailed, 'error')
    }
  }, [activePath, project, notify])

  /** Saves one file to the device — the Explorer row's "Download". `project.read`
   *  is the on-screen text (edits land there per keystroke), so no save is needed
   *  first. deliverFile picks the surface: share sheet on touch, download at desk,
   *  and a cancelled share sheet is not a failure (see deliver.ts). */
  const downloadFile = useCallback(
    async (path: string) => {
      const { name } = splitPath(path)
      const file = new File([project.read(path) ?? ''], name, { type: 'text/plain' })
      try {
        const result = await deliverFile(file)
        if (result === 'downloaded') notify(COPY.noteFileDownloaded(name))
      } catch {
        notify(COPY.noteFileDownloadFailed, 'error')
      }
    },
    [project, notify],
  )

  /** Folds the project into a URL (sharelink.ts). Clipboard on desktop, not the share
   *  sheet — Windows Chrome/Edge's own Copy button in that dialog strands the link (see deliver.ts). */
  const shareLink = useCallback(async () => {
    const url = buildShareUrl(currentProject?.name ?? COPY.defaultSharedName, entryPath, project.snapshot())
    if (!url) {
      notify(COPY.noteLinkTooBig, 'error')
      return
    }
    // Counted once here rather than at each of the share-sheet / clipboard exits
    // below: the question is how often a link gets made, and the URL — which is
    // the project — is never part of the event.
    track('project_shared', { via: 'link' })
    if (prefersShareSheet() && navigator.canShare?.({ url })) {
      try {
        await navigator.share({ url, title: currentProject?.name })
        return
      } catch (e) {
        if (isCancelled(e)) return
        // Some browsers advertise canShare and then refuse — the clipboard path below covers it.
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      notify(COPY.noteLinkCopied, 'success')
    } catch {
      notify(COPY.noteLinkCopyFailed, 'error')
    }
  }, [currentProject, entryPath, project, notify])

  /** "Share as PDF…" (⋯ menu) — every file in the project, print-styled, for
   *  handing work in. See actions/sharePdf.ts. */
  const sharePdf = useCallback(async () => {
    if (project.isEmpty()) return
    const name = currentProject?.name ?? COPY.defaultProjectName
    // Rasterising a few pages takes seconds, and a click that answers with
    // seconds of nothing reads as a dead row.
    notify(COPY.notePdfMaking)
    try {
      const result = await shareProjectAsPdf(name, project.snapshot(), `${slug(name) || 'warsha-project'}.pdf`)
      track('project_shared', { via: 'pdf' })
      if (result === 'downloaded') notify(COPY.notePdfDownloaded)
    } catch {
      notify(COPY.notePdfFailed, 'error')
    }
  }, [project, currentProject, notify])

  // ---- starters + zip ----
  // A starter is an action on the current project, not a mode — nothing else about the app changes.
  const replaceProject = async (snapshot: FsSnapshot, entry: string | null, label: string) => {
    // Storage may still be opening when the start panel shows; wait rather than refuse,
    // so an early tap on a starter isn't a no-op.
    await whenReady()
    await project.replaceAll(snapshot)
    editorRef.current?.closeFile(editorRef.current.currentPath() ?? '')
    setTabs(entry ? [entry] : [])
    setActivePath(entry)
    setEntryPath(entry)
    // Caret only on a laptop — on a phone it would summon the keyboard over code the student just asked to read.
    if (entry && !narrow) focusOnOpen.current = entry
    buffer.clear()
    notify(label, 'success')
  }

  const confirmReplace = async (title: string, what: string, okLabel: string) => {
    // Guarded on FILES, not isEmpty() (also false for an empty folder or fresh manifest) —
    // a first starter tap must apply, never trigger a confirm about work that doesn't exist.
    if (project.paths().length === 0) return true
    return dialogs.confirm({
      title,
      message: COPY.dlgReplaceBody(what, project.paths().length),
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
    // Counted before the branch: every path below starts the same starter, and
    // which one ran is an implementation detail, not a fact about the student.
    track('project_created', { source: 'template', lang: t.lang })
    // Fill the open empty project and adopt the starter's name.
    if (project.isEmpty() && currentProject) {
      await replaceProject(t.snapshot, t.entry, COPY.noteTemplateReady(t.name, t.snapshot.files.length))
      await renameProject(currentProject.id, uniqueProjectName(t.name))
      return
    }
    // Fresh device (no project yet): create the first one straight from the starter, no name prompt.
    if (!currentProject) {
      stopIfRunning()
      const leaving = tabs
      const meta = await createProject(uniqueProjectName(t.name), t.snapshot)
      if (!meta) return notify(COPY.noteProjectCreateFailed, 'error')
      adoptProject(leaving)
      notify(COPY.noteProjectReady(meta.name, t.snapshot.files.length))
      return
    }
    // A non-empty project is open: make a new one instead — the non-destructive path.
    return newProject(t)
  }

  // Starter fills/creates via applyTemplate above; "blank" is the old New Project default —
  // name an empty project, or open a file if already in one.
  const pickStarter = (t: Template) => {
    setPickerOpen(false)
    setView('editor')
    void applyTemplate(t)
  }
  const startBlank = () => {
    setPickerOpen(false)
    setView('editor')
    track('project_created', { source: 'blank', lang: 'none' })
    // A blank file only lands in an EXISTING empty project; with none open (fresh device), make one first.
    if (project.isEmpty() && currentProject) void newFile('')
    else void newProject()
  }

  const startEmpty = async () => {
    if (!(await confirmReplace(COPY.dlgEmptyTitle, COPY.dlgEmptyWhat, COPY.dlgEmptyOk))) return
    await replaceProject({ files: [], dirs: [] }, null, COPY.noteProjectEmptied)
  }

  const onZipImported = async (snapshot: FsSnapshot, fileName: string) => {
    setImportOpen(false)
    const entry = entryCandidates(snapshot.files)[0] ?? snapshot.files[0]?.path ?? null
    // The zip's own name is the teacher's assignment title — not ours to count.
    // Only its entry file's language, and only as one of the fixed ids.
    track('project_created', { source: 'zip', lang: entry ? langOfEntry(entry) : 'none' })
    await replaceProject(snapshot, entry, COPY.imported(fileName, snapshot.files.length))
  }

  const exportProject = () => {
    const name = `${slug(currentProject?.name) || 'warsha-project'}.zip`
    exportZip(project.snapshot(), name)
    track('project_shared', { via: 'zip' })
    notify(COPY.exported(name, project.paths().length), 'success')
  }

  // ---- projects ----
  // Switch/create/delete all invalidate the workspace: tabs, console transcript, and
  // editor per-file state belong to the project being left.
  const adoptProject = (leavingTabs: string[]) => {
    // Old project's open paths are evicted from editor state by name — two projects can both have a "main.py".
    for (const path of leavingTabs) editorRef.current?.closeFile(path)
    const entry = entryCandidates(project.sourceFiles())[0] ?? project.paths()[0] ?? null
    setTabs(entry ? [entry] : [])
    setActivePath(entry)
    setEntryPath(entry)
    buffer.clear()
    // Empty project hands its room back to the start panel, as on first visit.
    if (project.isEmpty()) setConsoleOpen(false)
  }

  /** A program from the project being left must not outlive it. */
  const stopIfRunning = () => {
    if (runner.busy) runner.stop()
  }

  /** A deleted project takes its collab room state with it: both prefs mappings
   *  and the rooms' y-indexeddb databases (kept on a plain stop, so a reload
   *  rejoins fast — but a deleted project's rooms are garbage). */
  const forgetProjectRoomState = (projectId: string) => {
    for (const room of forgetRoomsForProject(projectId)) {
      try {
        indexedDB.deleteDatabase(room) // y-indexeddb names its DB after the doc/room id
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  /** Resets the editor to nothing — for when the last project is deleted and the app returns to Home. */
  const clearWorkspace = (leavingTabs: string[]) => {
    for (const path of leavingTabs) editorRef.current?.closeFile(path)
    setTabs([])
    setActivePath(null)
    setEntryPath(null)
    buffer.clear()
    setConsoleOpen(false)
  }

  const togglePin = (id: string) =>
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      setPrefs({ pinnedProjectIds: next })
      return next
    })

  /** Drops a deleted project's pin so it can't haunt the prefs. */
  const unpin = (id: string) =>
    setPinned((prev) => {
      if (!prev.includes(id)) return prev
      const next = prev.filter((x) => x !== id)
      setPrefs({ pinnedProjectIds: next })
      return next
    })

  const projectNameTaken = (name: string, exceptId?: string): string | null =>
    projects.some((p) => p.id !== exceptId && p.name.trim() === name.trim())
      ? COPY.noteProjectNameTaken
      : null

  const switchToProject = async (id: string) => {
    // Checked against the LIVE ref, not this closure's snapshot: enterRoom calls
    // this from a boot-time closure where currentProject was still null.
    if (id === currentProjectIdRef.current) return
    // Order matters: the live session (and its bridge) must be gone before
    // openProject's switchStore emits the new project's structure.
    await stopCollabBeforeSwitch()
    stopIfRunning()
    const leaving = tabs
    await openProject(id)
    adoptProject(leaving)
  }

  // Opens the project a #room= link joins into (contract §5): the one already mapped
  // to this room (host reload / returning guest) if it still exists, else a fresh
  // empty project the live session then fills. Runs once per room id; the gated
  // effect above does the actual join once the project is current.
  const enterRoom = async (roomId: string) => {
    if (roomEntered.current.has(roomId)) return
    roomEntered.current.add(roomId)
    await whenReady()
    // A second #room= link while a session is live: end the old room first, or
    // two sessions end up fighting over one project through their bridges.
    if (collabRef.current.roomId !== roomId) await stopCollabBeforeSwitch()
    const mappedId = roomProjectId(roomId)
    const exists = mappedId ? (await snapshotOf(mappedId)) !== null : false
    if (mappedId && exists) {
      await switchToProject(mappedId) // no-op if it is already the open one
    } else {
      // The mapped project was deleted out from under this room (L8): clear its
      // stale mappings (both directions) before minting a fresh project, or the
      // projectRooms[oldId]→roomId reverse entry lingers as cruft forever. This
      // does not touch the room's y-indexeddb — the room itself is still live.
      if (mappedId) forgetRoomsForProject(mappedId)
      stopIfRunning()
      await stopCollabBeforeSwitch()
      const leaving = tabs
      const meta = await createProject(COPY.collabRoomName)
      if (!meta) {
        notify(COPY.collabStartFailed, 'error')
        roomEntered.current.delete(roomId)
        return
      }
      rememberRoomProject(roomId, meta.id)
      adoptProject(leaving)
    }
    setView('editor')
  }
  enterRoomRef.current = enterRoom

  const newProject = async (template?: Template) => {
    const suggested = template ? template.name : nextProjectName(projects)
    const name = await dialogs.prompt({
      title: template ? COPY.dlgNewProjectFrom(template.name) : COPY.dlgNewProjectTitle,
      label: COPY.dlgProjectName,
      value: suggested,
      okLabel: COPY.dlgCreate,
      validate: (v) => (v.trim() ? projectNameTaken(v) : COPY.dlgProjectNameRequired),
    })
    if (!name) return
    stopIfRunning()
    await stopCollabBeforeSwitch()
    const leaving = tabs
    const meta = await createProject(name, template?.snapshot)
    if (!meta) return notify(COPY.noteProjectCreateFailed, 'error')
    adoptProject(leaving)
    notify(
      template ? COPY.noteProjectReady(meta.name, template.snapshot.files.length) : COPY.noteProjectReadyBare(meta.name),
      'success',
    )
  }

  const renameCurrentProject = async () => {
    if (!currentProject) return
    const name = await dialogs.prompt({
      title: COPY.dlgRenameProjectTitle,
      label: COPY.dlgProjectName,
      value: currentProject.name,
      okLabel: COPY.dlgRename,
      validate: (v) => (v.trim() ? projectNameTaken(v, currentProject.id) : COPY.dlgProjectNameRequired),
    })
    if (!name || name === currentProject.name) return
    await renameProject(currentProject.id, name)
  }

  const deleteCurrentProject = async () => {
    if (!currentProject) return
    const files = project.paths().length
    const ok = await dialogs.confirm({
      title: COPY.dlgDeleteProjectTitle(currentProject.name),
      message: COPY.dlgDeleteProjectBody(files),
      okLabel: COPY.dlgDelete,
      danger: true,
    })
    if (!ok) return
    stopIfRunning()
    await stopCollabBeforeSwitch()
    const leaving = tabs
    const gone = currentProject.name
    const goneId = currentProject.id
    const willBeEmpty = projects.length <= 1
    await deleteProject(goneId)
    forgetProjectRoomState(goneId)
    unpin(goneId)
    if (willBeEmpty) {
      // Last project gone — return to Home's empty state instead of auto-creating one.
      clearWorkspace(leaving)
      setView('home')
    } else {
      // useProject opened the next survivor — resync the workspace to it.
      adoptProject(leaving)
    }
    notify(COPY.noteProjectDeleted(gone))
  }

  // ---- the projects Home (components/Home.tsx) ----
  /** Language + file count for a Home card. The open project is read live; others via a snapshot. */
  const metaOf = useCallback(
    async (id: string): Promise<{ lang: IconLang | null; files: number }> => {
      if (id === currentProject?.id) {
        const files = project.sourceFiles()
        const entry = entryCandidates(files)[0] ?? files[0]?.path ?? null
        return { lang: entry ? toIconLang(langForPath(entry)) : null, files: project.paths().length }
      }
      const snap = await snapshotOf(id)
      if (!snap) return { lang: null, files: 0 }
      const entry = entryCandidates(snap.files)[0] ?? snap.files[0]?.path ?? null
      return { lang: entry ? toIconLang(langForPath(entry)) : null, files: snap.files.length }
    },
    [currentProject, project, snapshotOf],
  )

  const openFromHome = (id: string) => {
    void (async () => {
      await switchToProject(id)
      setView('editor')
    })()
  }

  /** Deduped against every project (unlike uniqueProjectName, which spares the open one). */
  const uniqueAllNames = (base: string): string => {
    let name = base
    for (let n = 2; projects.some((p) => p.name.trim() === name.trim()); n++) name = `${base} ${n}`
    return name
  }

  // ---- Chunk 4: the unified Home list (local + cloud) ----------------------------
  // The account's docs (owned + shared), for the "synced" glyph on local cards and the
  // cloud-only cards a different device can open. `null` = we don't know yet (never
  // fetched / offline / a failed GET) — the list then degrades to local-only, no crash.
  const [cloudDocs, setCloudDocs] = useState<DocListEntry[] | null>(null)
  const signedInNow = auth.token !== null && auth.user !== null

  /** GET /v1/docs and cache it. No-op (and clears) when signed out / no backend. */
  const refreshCloudDocs = useCallback(async () => {
    if (!authApi || !(auth.token && auth.user)) {
      setCloudDocs(null)
      return
    }
    const docs = await authApi.listDocs() // null on offline/failure → keep local-only
    setCloudDocs(docs)
  }, [authApi, auth.token, auth.user])

  // Fetch on Home mount, on sign-in, and as backfill lands (cloud.statuses ticks each
  // seed) so a freshly-mapped doc drops out of the cloud-only set. Only while on Home —
  // the editor never shows this list, so we don't poll listDocs behind it.
  useEffect(() => {
    if (view !== 'home') return
    void refreshCloudDocs()
  }, [view, signedInNow, cloud.statuses, refreshCloudDocs])

  // Reconcile local ⇄ cloud by docId (`prefs.projectRooms`). A local project whose
  // mapped docId matches a cloud entry renders ONCE (from its local card) with a
  // synced glyph; a cloud entry with no local mapping becomes a cloud-only card.
  const cloudView = useMemo(() => {
    const rooms = prefs().projectRooms ?? {}
    const cloudById = new Map((cloudDocs ?? []).map((d) => [d.id, d]))
    const mappedDocIds = new Set<string>()
    const cloudSyncedIds: string[] = []
    for (const p of projects) {
      const docId = rooms[p.id]
      if (!docId) continue
      mappedDocIds.add(docId)
      // Show the glyph when the mapping is confirmed present in the account — or, when
      // we couldn't fetch the list (offline), trust the local mapping rather than blank it.
      if (cloudDocs === null || cloudById.has(docId)) cloudSyncedIds.push(p.id)
    }
    const cloudOnly: CloudOnlyEntry[] = (cloudDocs ?? [])
      .filter((d) => !mappedDocIds.has(d.id))
      .map((d) => ({ id: d.id, name: d.name?.trim() || COPY.homeCloudUntitled, role: d.role }))
    return { cloudSyncedIds, cloudOnly }
    // `prefs().projectRooms` is read imperatively; `cloud.statuses` (a dep of the fetch
    // effect above) changing is what re-runs this after a backfill remaps a project.
  }, [projects, cloudDocs, cloud.statuses])

  /** Open a cloud-only project on THIS device: materialize its doc into a fresh local
   *  project, map it, claim ownership only if we own it, then enter the editor. Mirrors
   *  `newProject`'s create+adopt path (createProject already opens the new project) —
   *  the cloud-sync manager attaches its durable engine once the project is mapped. */
  const openCloudDoc = (docId: string, name: string, role: DocRole) => {
    void (async () => {
      if (!authApi) return
      const snap = await materializeCloudDoc(docId, authApi)
      if (!snap) return notify(COPY.noteCloudOpenFailed, 'error')
      stopIfRunning()
      await stopCollabBeforeSwitch()
      const leaving = tabs
      const meta = await createProject(uniqueAllNames(name), snap)
      if (!meta) return notify(COPY.noteProjectCreateFailed, 'error')
      // Map BOTH directions so the manager's reconcile attaches its engine; own the doc
      // only when the account is the owner (a shared editor/viewer must not claim it).
      rememberRoomMapping(docId, meta.id)
      if (role === 'owner') rememberOwnedRoom(docId)
      adoptProject(leaving)
      setView('editor')
      void refreshCloudDocs() // it's local now — drop it from the cloud-only set
    })()
  }

  const homeRename = async (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target) return
    const name = await dialogs.prompt({
      title: COPY.dlgRenameProjectTitle,
      label: COPY.dlgProjectName,
      value: target.name,
      okLabel: COPY.dlgRename,
      validate: (v) => (v.trim() ? projectNameTaken(v, id) : COPY.dlgProjectNameRequired),
    })
    if (!name || name === target.name) return
    await renameProject(id, name)
  }

  const homeDuplicate = async (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target) return
    const meta = await duplicateProject(id, uniqueAllNames(`${target.name} ${COPY.homeDupSuffix}`))
    if (meta) notify(COPY.noteProjectDuplicated(meta.name), 'success')
    else notify(COPY.noteProjectCreateFailed, 'error')
  }

  const homeDelete = async (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target) return
    const snap = await snapshotOf(id)
    const ok = await dialogs.confirm({
      title: COPY.dlgDeleteProjectTitle(target.name),
      message: COPY.dlgDeleteProjectBody(snap?.files.length ?? 0),
      okLabel: COPY.dlgDelete,
      danger: true,
    })
    if (!ok) return
    const wasOpen = id === currentProject?.id
    const willBeEmpty = projects.length <= 1
    if (wasOpen) {
      stopIfRunning()
      await stopCollabBeforeSwitch()
    }
    const leaving = tabs
    await deleteProject(id)
    forgetProjectRoomState(id)
    unpin(id)
    if (willBeEmpty) {
      // Last project gone — reset the editor and stay on Home's empty state.
      clearWorkspace(leaving)
      setView('home')
    } else if (wasOpen) {
      // useProject opened a survivor — resync the workspace to it.
      adoptProject(leaving)
    }
    notify(COPY.noteProjectDeleted(target.name))
  }

  const homeExport = (id: string) => {
    const target = projects.find((p) => p.id === id)
    if (!target) return
    void (async () => {
      const snap = id === currentProject?.id ? project.snapshot() : await snapshotOf(id)
      if (!snap) return
      const name = `${slug(target.name) || 'warsha-project'}.zip`
      exportZip(snap, name)
      track('project_shared', { via: 'zip' })
      notify(COPY.exported(name, snap.files.length), 'success')
    })()
  }

  // ---- keyboard shortcuts ----
  // One window keydown for the whole app; `defaultPrevented` arbitrates with CodeMirror
  // so a key its keymap claimed is never handled twice.
  // Exception: Mod+Enter is swallowed by CM (setup.ts, to protect insertBlankLine) but must
  // still reach run.run here, or Ctrl+Enter from the editor does nothing.
  // Table read via a ref so the listener registers once, but is rebuilt fresh every render.
  const runnerRef = useRef(runner)
  runnerRef.current = runner
  const commandsRef = useRef<Command[]>([])
  // First half of a two-chord binding ("Mod+K"), waiting up to 3s for its second half — VS Code's own timeout.
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
        // A second key that completes no binding is swallowed, not typed into whatever has focus.
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

  // Three events because none alone covers every way a tab can go away: visibilitychange
  // (iOS Home), pagehide (bfcache, often silent on iOS), freeze (Chrome discarding a
  // backgrounded tab). All call the same idempotent flush, so firing twice is free.
  // Async, so the page may vanish before OPFS finishes — unavoidable, hence the tight 350ms debounce.
  useEffect(() => {
    const flush = () => {
      void project.saveAll()
      // The room's durable snapshot mirrors project.saveAll() here — otherwise
      // closing the tab dropped up to a debounce-window of collab edits.
      void collabRef.current.flush()
      // Same for the ambient Phase-C headless engine (open project, signed-in).
      void cloudRef.current.flushOpen()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    // Engines hold a WASM JVM/CPython heap that shouldn't linger while iPadOS hunts for memory.
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

  // Said out loud so migrated files don't look like they moved by themselves; if the copy
  // couldn't be verified, keeping the original beats a tidy migration message.
  useEffect(() => {
    if (!migration) return
    if (migration.kind === 'migrated') {
      notify(COPY.noteMigrated(migration.files))
    } else if (migration.kind === 'migration-kept-original') {
      notify(COPY.noteMigrationKept, 'error')
    }
  }, [migration, notify])

  const empty = project.isEmpty()

  // Feeds File > Open Recent and QuickInput's recent face. Labels de-duped since
  // `Menu` keys rows by label and two projects can share a name.
  const projectRows: MenuItem[] = (() => {
    const used = new Set<string>()
    return projects.map((p) => {
      const isOpen = p.id === currentProject?.id
      let label = p.name
      for (let n = 2; used.has(label); n++) label = `${p.name} (${n})`
      used.add(label)
      return {
        // `id` keys the row for React; the label above is de-duped for the reader, not for reconciliation.
        id: `project:${p.id}`,
        label,
        // Every row gets a glyph (open/closed folder) — a blank slot on only some rows left the column ragged.
        icon: isOpen ? <IconFolderOpen size={18} /> : <IconFiles size={18} />,
        hint: isOpen ? COPY.menuProjectOpenHint : undefined,
        disabled: isOpen,
        onSelect: () => void switchToProject(p.id),
      }
    })
  })()

  // Each language name written in itself — naming «العربية» in English defeats the
  // point for the reader who needs the switch.
  const languageRows: MenuItem[] = LOCALES.map((l) => ({
    id: `locale:${l}`,
    label: LOCALE_NAMES[l],
    // Every row carries the same globe so the column never reads as ragged; the ✓ hint marks the active one.
    icon: <IconGlobe size={18} />,
    hint: l === locale() ? '✓' : undefined,
    disabled: l === locale(),
    onSelect: () => setLocale(l),
  }))

  const explorerVisible = narrow ? drawerOpen : explorerDocked
  /** One toggle behind every entry point (title bar, View menu, Mod+B) — docked pane ≥900px, drawer below. */
  const toggleExplorer = () => (narrow ? setDrawerOpen((v) => !v) : setExplorerDocked((v) => !v))
  /** VS Code's rail contract: selecting a view shows it; selecting the one already up closes the sidebar. */
  const showSideView = (view: SideView) => {
    if (explorerVisible && sideView === view) {
      toggleExplorer()
      return
    }
    setSideView(view)
    if (narrow) setDrawerOpen(true)
    else setExplorerDocked(true)
  }
  /** Always opens, never toggles — a menu item named "Find in Files" shouldn't close the search it names. */
  const openSearchView = () => {
    setSideView('search')
    if (narrow) setDrawerOpen(true)
    else setExplorerDocked(true)
  }
  const activeContent = activePath ? (project.read(activePath) ?? '') : ''

  // Single state object so Run/Stop in the tab strip (Tabs.tsx), the Run menu, and
  // F5/Shift+F5 all share the same handlers and can't drift apart.
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

  /** DOM-reached (`EditorView.findFromDOM`), not a controller method — setup.ts is another
   *  package this overhaul. Focuses first: a command on an unfocused editor would surprise whoever was focused. */
  const editorCommand = (command: (view: EditorView) => boolean) => {
    const dom = document.querySelector('.cm-editor')
    const view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
    if (!view) return
    view.focus()
    command(view)
  }

  /** The live editor view, or null — reached through the DOM, same as
   *  `editorCommand` (setup.ts is a separate package this overhaul). */
  const getEditorView = (): EditorView | null => {
    const dom = document.querySelector('.cm-editor')
    return dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null
  }

  /** "Explain '<word>'" — the docs card for the word at `pos`. `docked` is true
   *  from the touch button (bottom strip), false from right-click (tooltip). */
  const explainWord = (pos: number, docked: boolean) => {
    const view = getEditorView()
    if (!view) return
    view.focus()
    explainAt(view, pos, docked)
  }

  // Clipboard rows for the desktop right-click menu. execCommand acts on the
  // focused editor's live selection; paste reads the clipboard — all run inside
  // the menu-select user gesture, so the browser permits them.
  const clipboardCommand = (kind: 'cut' | 'copy') => {
    const view = getEditorView()
    if (!view) return
    view.focus()
    document.execCommand(kind)
  }
  const clipboardPaste = () => {
    const view = getEditorView()
    if (!view) return
    view.focus()
    void navigator.clipboard
      .readText()
      .then((text) => view.dispatch(view.state.replaceSelection(text)))
      .catch(() => {
        /* clipboard blocked — the keyboard's own Paste still works */
      })
  }

  /** Editor jobs shared by the right-click menu and the touch button. `touch`
   *  drops the clipboard rows (the OS bar owns them) and the keyboard hints, and
   *  docks Explain as a strip. Guards reuse the same canFormat/canGenerate. */
  const editorActionRows = (view: EditorView, pos: number, touch: boolean): MenuItem[] => {
    const word = documentedWordAt(view, pos)
    const rows: MenuItem[] = []
    if (word)
      rows.push({
        label: COPY.menuExplain(word),
        icon: <IconLightbulb size={18} />,
        hint: touch ? undefined : formatKeys('Mod+K Mod+I'),
        onSelect: () => explainWord(pos, touch),
      })
    if (!touch)
      rows.push(
        { label: COPY.menuCut, icon: <IconScissors size={18} />, hint: formatKeys('Mod+X'), onSelect: () => clipboardCommand('cut') },
        { label: COPY.menuCopy, icon: <IconCopy size={18} />, hint: formatKeys('Mod+C'), onSelect: () => clipboardCommand('copy') },
        { label: COPY.menuPaste, icon: <IconClipboard size={18} />, hint: formatKeys('Mod+V'), onSelect: clipboardPaste },
      )
    rows.push(
      {
        label: COPY.menuFormatFile,
        icon: <IconWand size={18} />,
        hint: touch ? undefined : formatKeys('Shift+Alt+F'),
        startsGroup: true,
        disabled: !canFormat(activePath),
        onSelect: () => void formatActiveFile(),
      },
      {
        label: COPY.menuGenerate,
        icon: <IconGenerate size={18} />,
        hint: touch ? undefined : formatKeys(isMacLike ? 'Ctrl+Alt+Enter' : 'Alt+Insert'),
        disabled: !canGenerate(activePath),
        onSelect: () => void openGenerate(),
      },
      {
        label: COPY.menuFind,
        icon: <IconSearch size={18} />,
        hint: touch ? undefined : formatKeys('Mod+F'),
        disabled: !activePath,
        onSelect: () => editorCommand(openSearchPanel),
      },
      {
        label: COPY.menuSelectAll,
        icon: <IconSelectAll size={18} />,
        hint: touch ? undefined : formatKeys('Mod+A'),
        startsGroup: true,
        disabled: !activePath,
        onSelect: () => editorCommand(selectAll),
      },
      {
        label: COPY.menuCommandPalette,
        icon: <IconCommand size={18} />,
        hint: touch ? undefined : formatKeys('Mod+Shift+P'),
        onSelect: () => setQuickPick('commands'),
      },
    )
    return rows
  }

  /** Right-click in the editor (desktop). A touch long-press is left to the OS
   *  callout (lastPointerType), and inputs/find keep their native menu. */
  const onEditorContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (lastPointerType.current === 'touch' || !activePath) return
    if ((e.target as HTMLElement).closest('.cm-panels, input, textarea')) return
    const view = getEditorView()
    if (!view) return
    e.preventDefault()
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
    // VS Code parity: a click outside the selection moves the caret there so
    // Paste/Explain act where it landed; inside it, keep the selection to act on.
    const sel = view.state.selection.main
    if (pos < sel.from || pos > sel.to) view.dispatch({ selection: { anchor: pos } })
    setEditorActionsMenu({ anchor: { x: e.clientX, y: e.clientY }, items: editorActionRows(view, pos, false) })
  }

  /** The touch actions button — opens the Menu (touch mode) anchored to the
   *  button, never the caret, so the native selection bar can't cover it. */
  const openEditorTouchActions = () => {
    const btn = fabRef.current
    const view = getEditorView()
    if (!btn || !view) return
    const r = btn.getBoundingClientRect()
    setEditorActionsMenu({
      anchor: { x: r.right, y: r.top, fromRight: true },
      items: editorActionRows(view, view.state.selection.main.head, true),
    })
  }

  /** A real alert (one OK), not the old confirm whose Cancel did nothing. Version is inlined at build time. */
  const showAbout = () =>
    void dialogs.alert({
      title: COPY.aboutTitle,
      message: (
        <>
          <p>{COPY.aboutBody}</p>
          <p className="mt-2 text-text-3">{COPY.aboutVersion(pkg.version)}</p>
        </>
      ),
    })

  // ---- the command table ----
  // Feeds both the central keydown (via commandsRef) and the command palette: disabled rows
  // are hidden from the palette, and their keys fall through to the browser (so Ctrl+W with
  // nothing open still closes the page). Rebuilt every render so closures stay fresh.
  const commands: Command[] = [
    // Escape order: quick input first (fallback for a stray focus; it normally swallows its own Escape), then drawer.
    {
      id: 'quickInput.close',
      title: COPY.cmdCloseQuickInput,
      keys: ['Escape'],
      inPalette: false,
      enabled: () => quickPick !== null,
      run: () => setQuickPick(null),
    },
    {
      id: 'drawer.close',
      title: COPY.cmdCloseDrawer,
      keys: ['Escape'],
      inPalette: false,
      enabled: () => narrow && drawerOpen,
      run: () => setDrawerOpen(false),
    },
    { id: 'file.newFile', title: COPY.cmdFileNewFile, run: () => void newFile('') },
    { id: 'file.saveAll', title: COPY.cmdFileSaveAll, keys: ['Mod+S'], run: saveAllQuiet },
    {
      id: 'file.format',
      title: COPY.cmdFileFormat,
      keys: ['Shift+Alt+F'],
      enabled: () => canFormat(activePath),
      run: () => void formatActiveFile(),
    },
    {
      id: 'edit.generate',
      title: COPY.cmdGenerate,
      // JetBrains' binding; Ctrl+Alt+Enter is its alias, and the one Macs can
      // reach (no Insert key). Not in the editor keymap (editor/setup.ts) — the
      // caret position it needs is read here, at dispatch. Ctrl+Alt+Enter is
      // also CodeMirror's Replace-All, but only while the Find/Replace panel
      // holds focus — a scoped overlap that never reaches this global binding.
      // skipWhenTyping keeps both chords out of dialog fields and console stdin;
      // the editor itself isn't "typing", so Alt+Insert still fires there.
      keys: ['Alt+Insert', 'Ctrl+Alt+Enter'],
      skipWhenTyping: true,
      enabled: () => canGenerate(activePath),
      run: () => void openGenerate(),
    },
    {
      id: 'file.share',
      title: COPY.cmdFileShareImage,
      enabled: () => activePath !== null,
      run: () => void shareActiveFile(),
    },
    { id: 'file.import', title: COPY.cmdFileImport, run: () => setImportOpen(true) },
    {
      id: 'file.closeEditor',
      title: COPY.cmdFileCloseEditor,
      keys: ['Mod+W'],
      enabled: () => activePath !== null,
      run: () => {
        if (activePath) closeTab(activePath)
      },
    },
    {
      id: 'edit.find',
      title: COPY.cmdEditFind,
      // In the editor CodeMirror's own searchKeymap claims Mod+F first (and
      // preventDefaults, so the guard skips this); this binding is for when
      // focus is elsewhere — VS Code web captures ⌘F everywhere too.
      keys: ['Mod+F'],
      enabled: () => activePath !== null,
      run: () => editorCommand(openSearchPanel),
    },
    {
      id: 'search.findInFiles',
      // VS Code's own binding. The sidebar's Search view, not the editor's
      // find panel — the same distinction VS Code draws for the same chord.
      title: COPY.cmdSearchInFiles,
      keys: ['Mod+Shift+F'],
      run: openSearchView,
    },
    {
      id: 'view.toggleSidebar',
      title: COPY.cmdViewToggleSideBar,
      keys: ['Mod+B'],
      skipWhenTyping: true,
      run: toggleExplorer,
    },
    {
      id: 'view.togglePanel',
      title: COPY.cmdViewTogglePanel,
      // Ctrl+` binds by physical position (e.code Backquote, like VS Code); plain backquote still types.
      // preventDefault stops Ctrl+J from opening Chrome's Downloads.
      keys: ['Mod+J', 'Ctrl+`'],
      run: () => setConsoleOpen((v) => !v),
    },
    {
      id: 'view.focusExplorer',
      title: COPY.cmdViewFocusExplorer,
      keys: ['Mod+Shift+E'],
      run: () => {
        setSideView('explorer')
        if (narrow) setDrawerOpen(true)
        else setExplorerDocked(true)
        // Waits for the open state to paint; prefers the active file's row, else the first.
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
      title: COPY.cmdViewNextEditor,
      keys: ['Ctrl+PageDown'],
      enabled: () => tabs.length > 1,
      run: () => {
        const i = tabs.indexOf(activePath ?? '')
        setActivePath(tabs[(i + 1 + tabs.length) % tabs.length])
      },
    },
    {
      id: 'view.previousEditor',
      title: COPY.cmdViewPrevEditor,
      keys: ['Ctrl+PageUp'],
      enabled: () => tabs.length > 1,
      run: () => {
        const i = tabs.indexOf(activePath ?? '')
        setActivePath(tabs[(i - 1 + tabs.length) % tabs.length])
      },
    },
    { id: 'view.biggerText', title: COPY.cmdViewBiggerText, run: () => setFontSize((s) => Math.min(26, s + 1)) },
    { id: 'view.smallerText', title: COPY.cmdViewSmallerText, run: () => setFontSize((s) => Math.max(11, s - 1)) },
    // Whole-shell zoom, distinct from the editor-only text size above. preventDefault
    // stops Ctrl+=/− from also zooming the browser.
    { id: 'view.zoomIn', title: COPY.cmdViewZoomIn, keys: ['Mod+='], run: () => changeScale(+SCALE_STEP) },
    { id: 'view.zoomOut', title: COPY.cmdViewZoomOut, keys: ['Mod+-'], run: () => changeScale(-SCALE_STEP) },
    { id: 'view.resetZoom', title: COPY.cmdViewResetZoom, keys: ['Mod+0'], run: () => setUiScale(1) },
    {
      id: 'view.language',
      title: COPY.cmdViewLanguage,
      run: () => setLocale(locale() === 'ar' ? 'en' : 'ar'),
    },
    {
      id: 'view.commandPalette',
      title: COPY.cmdViewPalette,
      // F1 is the always-works fallback: Firefox reserves Ctrl+Shift+P
      // uncancellably, the same reason VS Code web answers to both.
      keys: ['Mod+Shift+P', 'F1'],
      run: () => setQuickPick('commands'),
    },
    {
      id: 'run.run',
      title: COPY.cmdRunFile,
      // F5/Ctrl+F5 run (preventDefault cancels their normal browser-reload meaning); Mod+Enter is the
      // historic binding the console's idle line still quotes. Busy: same key stops instead.
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
      title: COPY.cmdRunStop,
      keys: ['Shift+F5'],
      enabled: () => runnerRef.current.busy,
      run: () => runnerRef.current.stop(),
    },
    { id: 'go.file', title: COPY.cmdGoToFile, keys: ['Mod+P'], run: () => setQuickPick('files') },
    {
      id: 'go.line',
      title: COPY.cmdGoToLine,
      // Literal Ctrl — VS Code keeps ⌃G on the Mac (⌘G is find-next).
      keys: ['Ctrl+G'],
      enabled: () => activePath !== null,
      run: () => setQuickPick('goto'),
    },
    {
      id: 'projects.openRecent',
      title: COPY.cmdProjectsOpenRecent,
      // Ctrl+R is literal on Mac too (⌘R is browser reload, blocked here on Windows/Linux).
      // Left to the browser with no other project to pick from.
      keys: ['Ctrl+R', 'Mod+K Mod+O'],
      enabled: () => projects.length > 1,
      run: () => setQuickPick('recent'),
    },
    { id: 'projects.new', title: COPY.cmdProjectsNew, run: () => setPickerOpen(true) },
    {
      id: 'projects.rename',
      title: COPY.cmdProjectsRename,
      enabled: () => Boolean(currentProject),
      run: () => void renameCurrentProject(),
    },
    { id: 'projects.export', title: COPY.cmdProjectsExport, enabled: () => !empty, run: exportProject },
    { id: 'projects.shareLink', title: COPY.cmdProjectsShareLink, enabled: () => !empty, run: () => void shareLink() },
    {
      // Live collaboration is a project-scoped share, so it sits with the other
      // share actions. Title flips with state; the "Live" pill is the other way out.
      id: 'collab.toggle',
      title: collab.active ? COPY.collabStop : COPY.collabStart,
      enabled: () => Boolean(currentProject),
      run: () => void toggleCollab(),
    },
    {
      // Manage who can open the live-room link (owner) / copy it (guest). Only
      // meaningful while a room is live — hidden from the palette otherwise.
      id: 'collab.share',
      title: COPY.menuShareRoom,
      inPalette: collab.active,
      enabled: () => collab.active,
      run: () => setShareOpen(true),
    },
    { id: 'projects.sharePdf', title: COPY.cmdProjectsSharePdf, enabled: () => !empty, run: () => void sharePdf() },
    // Danger last, the same rule every menu in the app follows.
    { id: 'projects.empty', title: COPY.cmdProjectsEmpty, enabled: () => !empty, run: () => void startEmpty() },
    {
      id: 'projects.delete',
      title: COPY.cmdProjectsDelete,
      enabled: () => Boolean(currentProject),
      run: () => void deleteCurrentProject(),
    },
  ]
  commandsRef.current = commands

  /** Palette-visible rows only, first binding formatted for the keycap chip. Disabled rows
   *  are passed so QuickInput can hide them, not grey them out. */
  const paletteCommands: QuickCommand[] = commands
    .filter((c) => c.inPalette !== false)
    .map((c) => ({
      id: c.id,
      label: c.title,
      hint: c.keys?.length ? formatKeys(c.keys[0]) : undefined,
      disabled: c.enabled ? !c.enabled() : false,
      run: c.run,
    }))

  // VS Code's menu bar (collapses to the ☰ button below 1050px). Every row calls the same
  // action its old home did; hints render from the command table so a shown shortcut always
  // works. File also holds every project-scoped job the old touch drawer switcher carried;
  // destructive rows sit last behind a divider, never near Save.
  const menuBarMenus: MenuBarMenu[] = [
    {
      label: COPY.menuFile,
      items: [
        { label: COPY.homeTitle, icon: <Logo size={16} />, onSelect: () => setView('home') },
        { label: COPY.menuNewFile, icon: <IconFilePlus size={18} />, startsGroup: true, onSelect: () => void newFile('') },
        // Opens the picker regardless of list size; language and starter are chosen there.
        { label: COPY.menuNewProject, icon: <IconFolderPlus size={18} />, onSelect: () => setPickerOpen(true) },
        // The relocated project switcher — projectRows exactly (most recent first, open one unselectable).
        { label: COPY.menuOpenRecent, icon: <IconClock size={18} />, items: projectRows },
        { label: COPY.menuImportZip, icon: <IconImport size={18} />, startsGroup: true, onSelect: () => setImportOpen(true) },
        { label: COPY.menuExportZip, icon: <IconExport size={18} />, disabled: empty, onSelect: exportProject },
        { label: COPY.menuShareLink, icon: <IconLink size={18} />, disabled: empty, onSelect: () => void shareLink() },
        { label: COPY.menuSharePdf, icon: <IconFileLines size={18} />, disabled: empty, onSelect: () => void sharePdf() },
        // Same share family; label flips Start/Stop with the room state.
        { label: collab.active ? COPY.collabStop : COPY.collabStart, icon: <IconShare size={18} />, disabled: !currentProject, onSelect: () => void toggleCollab() },
        // Sharing controls for the live room (link access / copy link) — only while a room is up.
        { label: COPY.menuShareRoom, icon: <IconLink size={18} />, disabled: !collab.active, onSelect: () => setShareOpen(true) },
        { label: COPY.menuSaveAll, icon: <IconSave size={18} />, hint: formatKeys('Mod+S'), startsGroup: true, onSelect: saveAllQuiet },
        {
          label: COPY.menuRenameProject,
          icon: <IconPencil size={18} />,
          startsGroup: true,
          disabled: !currentProject,
          onSelect: () => void renameCurrentProject(),
        },
        { label: COPY.menuEmptyProject, icon: <IconClear size={18} />, danger: true, disabled: empty, onSelect: () => void startEmpty() },
        { label: COPY.menuDeleteProject, icon: <IconTrash size={18} />, danger: true, disabled: !currentProject, onSelect: () => void deleteCurrentProject() },
      ],
    },
    {
      label: COPY.menuEdit,
      items: [
        { label: COPY.menuUndo, icon: <IconUndo size={18} />, hint: formatKeys('Mod+Z'), disabled: !activePath, onSelect: () => editorCommand(undo) },
        {
          label: COPY.menuRedo,
          icon: <IconRedo size={18} />,
          // CodeMirror's own bindings: ⇧⌘Z on the Mac, Ctrl+Y (Windows
          // muscle memory, which CM also maps) elsewhere.
          hint: formatKeys(isMacLike ? 'Shift+Mod+Z' : 'Ctrl+Y'),
          disabled: !activePath,
          onSelect: () => editorCommand(redo),
        },
        {
          label: COPY.menuFind,
          icon: <IconSearch size={18} />,
          hint: formatKeys('Mod+F'),
          startsGroup: true,
          disabled: !activePath,
          onSelect: () => editorCommand(openSearchPanel),
        },
        // The sidebar's cross-file search — VS Code's Edit > Find in Files.
        { label: COPY.menuFindInFiles, icon: <IconSearch size={18} />, hint: formatKeys('Mod+Shift+F'), onSelect: openSearchView },
      ],
    },
    {
      label: COPY.menuView,
      items: [
        { label: COPY.menuToggleExplorer, icon: <IconFiles size={18} />, hint: formatKeys('Mod+B'), onSelect: toggleExplorer },
        { label: COPY.menuToggleConsole, icon: <IconTerminal size={18} />, hint: formatKeys('Mod+J'), onSelect: () => setConsoleOpen((v) => !v) },
        { label: COPY.menuBiggerText, icon: <IconTextBigger size={18} />, startsGroup: true, onSelect: () => setFontSize((s) => Math.min(26, s + 1)) },
        { label: COPY.menuSmallerText, icon: <IconTextSmaller size={18} />, onSelect: () => setFontSize((s) => Math.max(11, s - 1)) },
        // Editor type above, whole shell below — two prefs, two groups.
        { label: COPY.menuZoomIn, icon: <IconZoomIn size={18} />, hint: formatKeys('Mod+='), startsGroup: true, onSelect: () => changeScale(+SCALE_STEP) },
        { label: COPY.menuZoomOut, icon: <IconZoomOut size={18} />, hint: formatKeys('Mod+-'), onSelect: () => changeScale(-SCALE_STEP) },
        { label: COPY.menuResetZoom, icon: <IconZoomReset size={18} />, hint: formatKeys('Mod+0'), disabled: uiScale === 1, onSelect: () => setUiScale(1) },
        {
          // Handedness (html[data-hand]) mirrors the console header's Run side — one
          // preference, one home, even though it matters most on touch.
          label: hand === 'right' ? COPY.menuRunOnLeft : COPY.menuRunOnRight,
          icon: <IconSwap size={18} />,
          startsGroup: true,
          onSelect: () => setHand((h) => (h === 'right' ? 'left' : 'right')),
        },
        { label: COPY.menuLanguage, icon: <IconGlobe size={18} />, items: languageRows },
      ],
    },
    {
      label: COPY.menuRun,
      items: [
        {
          label: runControl.entry ? COPY.menuRunEntry(runControl.entry) : COPY.menuRun,
          icon: <IconPlay size={18} />,
          hint: formatKeys('F5'),
          disabled: runControl.busy || !runControl.canRun,
          onSelect: runControl.onRun,
        },
        { label: COPY.menuStop, icon: <IconStop size={18} />, hint: formatKeys('Shift+F5'), disabled: !runControl.busy, onSelect: runControl.onStop },
        {
          label: COPY.menuFormatFile,
          icon: <IconWand size={18} />,
          hint: formatKeys('Shift+Alt+F'),
          startsGroup: true,
          disabled: !canFormat(activePath),
          onSelect: () => void formatActiveFile(),
        },
        {
          label: COPY.menuGenerate,
          icon: <IconGenerate size={18} />,
          // ⌥Insert names a key Macs lack — show them the reachable alias.
          hint: formatKeys(isMacLike ? 'Ctrl+Alt+Enter' : 'Alt+Insert'),
          disabled: !canGenerate(activePath),
          onSelect: () => void openGenerate(),
        },
      ],
    },
    {
      label: COPY.menuHelp,
      items: [{ label: COPY.menuAbout, icon: <IconInfo size={18} />, onSelect: showAbout }],
    },
  ]

  // VS Code keeps the app-scoped odds and ends behind the rail's own gear; every row here is an action that already exists.
  const manageItems: MenuItem[] = [
    { label: COPY.menuCommandPalette, icon: <IconCommand size={18} />, hint: formatKeys('Mod+Shift+P'), onSelect: () => setQuickPick('commands') },
    // Account: only when a backend is configured (authApi non-null). Label carries
    // the email once signed in; opens the sign-in form otherwise. The rail gear is
    // where the app's odds-and-ends live — no new nav pattern (§7.4).
    ...(authApi
      ? [
          {
            label: auth.user ? auth.user.email : COPY.menuSignIn,
            icon: <IconUser size={18} />,
            startsGroup: true,
            onSelect: () => setAccountOpen(true),
          } satisfies MenuItem,
        ]
      : []),
    {
      // Control row, not a command: `render` rows aren't Radix Items, so dragging the thumb never
      // closes the menu. Same pref as View > Zoom In/Out (not the editor's separate text-size stepper).
      id: 'view-scale',
      label: COPY.menuViewScale,
      startsGroup: true,
      render: (
        <div
          className="flex min-h-touch items-center gap-3 px-3 desk:min-h-[26px]"
          // Only arrow/paging keys are claimed here, so they reach the slider, not Radix's roving focus.
          onKeyDown={(e) => {
            if (/^(Arrow(Left|Right|Up|Down)|Home|End|Page(Up|Down))$/.test(e.key)) e.stopPropagation()
          }}
        >
          {/* Leading glyph matches the icon column of the sibling rows so the label lines up with them. */}
          <span aria-hidden="true" className="grid size-[20px] flex-none place-items-center text-text-3">
            <IconZoomIn size={18} />
          </span>
          <span className="flex-none text-row text-text-1 desk:text-[13px]">{COPY.menuViewScale}</span>
          <input
            type="range"
            aria-label={COPY.a11yViewScale}
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={SCALE_STEP}
            value={uiScale}
            onChange={(e) => setUiScale(clampScale(e.currentTarget.valueAsNumber))}
            // min-h-touch keeps a 44px hit band on touch; the track still paints centred.
            className="min-h-touch min-w-0 flex-1 cursor-pointer accent-(--accent) desk:min-h-0"
          />
          <span className="w-[4ch] flex-none text-end text-micro tabular-nums text-text-2 desk:text-[13px]">
            {Math.round(uiScale * 100)}%
          </span>
        </div>
      ),
    },
    { label: COPY.menuLanguage, icon: <IconGlobe size={18} />, items: languageRows, startsGroup: true },
    { label: COPY.tutorialsTitle, icon: <IconLightbulb size={18} />, startsGroup: true, onSelect: () => setView('tutorials') },
    { label: COPY.menuAbout, icon: <IconInfo size={18} />, onSelect: showAbout },
  ]

  // Tab-strip "⋯": file rows first, then the share family (image/link/PDF) grouped as
  // one job despite differing scopes. App-scoped rows live in the menu bar above.
  // "Share as image…" is a QA-clicked string — keep it stable.
  const deskMoreItems: MenuItem[] = [
    {
      label: COPY.menuFormatFileRow,
      icon: <IconWand size={18} />,
      hint: formatKeys('Shift+Alt+F'),
      disabled: !canFormat(activePath),
      onSelect: () => void formatActiveFile(),
    },
    {
      label: COPY.menuGenerate,
      icon: <IconGenerate size={18} />,
      // ⌥Insert names a key Macs lack — show them the reachable alias.
      hint: formatKeys(isMacLike ? 'Ctrl+Alt+Enter' : 'Alt+Insert'),
      disabled: !canGenerate(activePath),
      onSelect: () => void openGenerate(),
    },
    {
      label: COPY.menuShareImage,
      icon: <IconShare size={18} />,
      disabled: !activePath,
      onSelect: () => void shareActiveFile(),
    },
    {
      label: COPY.menuShareProjectLink,
      icon: <IconLink size={18} />,
      disabled: empty,
      onSelect: () => void shareLink(),
    },
    {
      label: COPY.menuShareProjectPdf,
      icon: <IconFileLines size={18} />,
      disabled: empty,
      onSelect: () => void sharePdf(),
    },
  ]

  // Two faces: a page project (html/css) can show Preview or switch to Console; a script
  // or Java/Python is console-only (no preview). Preview defaults for a page; choice overrides it.
  const previewActive = isPreviewEntry(runControl.entry)
  const outputFace: OutputView = previewActive ? (outputView ?? 'preview') : 'console'

  return (
    <>
      {view === 'home' ? (
        <Home
          projects={projects}
          currentId={currentProject?.id ?? null}
          pinnedIds={pinned}
          metaOf={metaOf}
          locale={locale()}
          onOpen={openFromHome}
          onNewProject={() => setPickerOpen(true)}
          onToggleLocale={() => setLocale(locale() === 'ar' ? 'en' : 'ar')}
          onTogglePin={togglePin}
          onRename={(id) => void homeRename(id)}
          onDuplicate={(id) => void homeDuplicate(id)}
          onDelete={(id) => void homeDelete(id)}
          onExport={homeExport}
          onOpenTutorials={() => setView('tutorials')}
          // Phase C accounts-as-cloud: the account affordance (gated on a configured
          // backend, `authApi != null`) + the unified local/cloud list.
          signedIn={signedInNow}
          email={auth.user?.email}
          onAccount={authApi ? () => setAccountOpen(true) : undefined}
          cloudSyncedIds={cloudView.cloudSyncedIds}
          cloudStatus={cloud.statuses}
          cloudOnly={cloudView.cloudOnly}
          onOpenCloud={authApi ? openCloudDoc : undefined}
        />
      ) : view === 'tutorials' ? (
        <TutorialsPage
          locale={locale()}
          onHome={() => setView('home')}
          onToggleLocale={() => setLocale(locale() === 'ar' ? 'en' : 'ar')}
        />
      ) : (
    <div className={SHELL}>
      {/* Icon column at every width; below 900px its Explorer item toggles the overlay drawer instead of docking. */}
      <ActivityBar
        // Active rule follows whichever view the sidebar shows; none while it's hidden.
        activeView={explorerVisible ? sideView : null}
        onHome={() => setView('home')}
        onShowExplorer={() => showSideView('explorer')}
        // Search is a VIEW now — the editor's own find panel stays on Mod+F / Edit > Find.
        onShowSearch={() => showSideView('search')}
        onShowExtensions={() => showSideView('extensions')}
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
        // A slot: each control renders itself away when idle — the "Live" pill only
        // while a room is active, Install only when the browser offers it.
        installSlot={
          <>
            <CollabControl active={collab.active} connecting={!collab.synced} peers={collab.peers} readOnly={collab.readOnly} onStop={() => void toggleCollab()} />
            <InstallControl />
          </>
        }
      />

      <div className={BODY}>
        {/* One sidebar: docked ≥900px, overlay drawer below. aria-label stays "Files"
            always — it's the QA suites' handle, and files are what both views operate on. */}
        <aside
          aria-label={COPY.a11yFiles}
          aria-hidden={!explorerVisible}
          data-state={explorerVisible ? 'open' : 'closed'}
          data-view={sideView}
          className={
            'z-20 shrink-0 border-e border-border-subtle ' +
            (narrow
              ? // `.drawer` owns transform/--dur transition — the Tailwind v4 utility form of both
                // compiled to invalid CSS, so it used to snap open with no animation.
                'drawer absolute inset-y-0 start-0 w-drawer shadow-raised'
              : explorerDocked
                ? 'w-explorer'
                : 'hidden')
          }
        >
          {sideView === 'search' ? (
            <SearchView project={project} revision={revision} onOpenMatch={openAt} />
          ) : sideView === 'extensions' ? (
            <ExtensionsView onToggle={toggleExtension} />
          ) : (
          <Explorer
            project={project}
            tree={tree}
            activePath={activePath}
            // Explorer renders its own VS Code pane header at every size now; the old
            // touch-only project switcher row is gone (File menu's Open Recent replaces it).
            projectName={projectName}
            onOpenFile={openFile}
            onNewFile={(dir, name) => void newFile(dir, name)}
            onNewFolder={(dir, name) => void newFolder(dir, name)}
            onRename={(p, isDir, name) => void renameEntry(p, isDir, name)}
            onDelete={(p, isDir) => void deleteEntry(p, isDir)}
            onDownload={(p) => void downloadFile(p)}
            onMove={(p, toDir) => void moveEntry(p, toDir)}
            // From a drawer, closing it reveals the starters already in the workspace;
            // docked, they're already visible so the button would be a no-op.
            onShowStarters={narrow ? () => setDrawerOpen(false) : undefined}
          />
          )}
        </aside>

        {narrow && drawerOpen ? (
          // `.scrim`, not the bare-bracket form — that compiles to `background-color:--scrim`
          // under Tailwind v4, which the browser drops, leaving no scrim at all.
          <div className="scrim absolute inset-0 z-10" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        ) : null}

        {/* overflow-hidden is a backstop, not decoration: an oversized persisted console-height
            pref used to push the transcript through the layout's bottom. `.console-panel--open`
            now also bounds itself in CSS — belt and braces. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-1">
          <CapabilityBanner report={report} />
          {/* Below the capability banner on purpose: "can't run your code" outranks
              "can't save it". Both are standing conditions, not toasts. */}
          <StorageBanner
            problem={storageProblem}
            quotaTight={quotaTight}
            isPrimaryTab={isPrimaryTab}
            migration={migration}
            onExportZip={exportProject}
          />

          {/* Empty project: editor area shows the start panel instead — the entire
              first-run experience (no gate/route/modal), gone once a file exists. */}
          {empty ? (
            <WelcomePanel
              onNewFile={() => void newFile('')}
              onNewProject={() => setPickerOpen(true)}
              onImportZip={() => setImportOpen(true)}
              // Same MRU ordering as projectRows; the open (empty) project is excluded as a dead link.
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
                onCloseMany={closeTabs}
                // Run + file-scoped "⋯" — VS Code's editor-actions corner; Run's one home now
                // (left the title bar and console header).
                runControl={runControl}
                moreItems={deskMoreItems}
              />

              {/* Breadcrumbs sit on the editor surface so the active tab reads into the code. */}
              <Breadcrumbs path={activePath} />

              {/* Relative host so the touch actions button docks to the editor's
                  bottom-inline-end corner, and right-click opens the editor menu.
                  onPointerDownCapture records the pointer kind so a touch long-press
                  (which also fires contextmenu) is left to the OS callout. */}
              <div
                // Carries the editor's 96px floor (spec §4.3) now that it, not
                // Editor, is the flex item <main> sizes.
                className="relative flex min-h-editor-min min-w-0 flex-1 flex-col"
                onPointerDownCapture={(e) => {
                  lastPointerType.current = e.pointerType
                }}
                onContextMenu={onEditorContextMenu}
              >
                <Editor
                  path={activePath}
                  content={activeContent}
                  fontSize={fontSize}
                  onChange={(p, c) => project.setContent(p, c)}
                  onSave={saveAllQuiet}
                  onController={(c) => {
                    editorRef.current = c
                    // Push the live binding SYNCHRONOUSLY the instant the controller
                    // exists, BEFORE the Editor's own file-open effect runs (mount
                    // effect precedes the open effect in declaration order). A fresh
                    // guest joins (binding set) BEFORE this editor mounts, so the
                    // `onBinding` push in begin found no controller and the setEditorReady
                    // effect below lands a render too late — the entry file opened with
                    // `collab == null` (writable) and briefly accepted a keystroke under
                    // latency (H1). Pushing here means the first EditorState reads the
                    // guest's fail-closed `readOnly()` and paints read-only.
                    if (c) c.setCollab(collabRef.current.binding)
                    // Flags the effect above to (re)push the collab binding once
                    // the singleton editor exists — covers a room joined before
                    // the first file opened the editor, and the read-only→writable
                    // flip when the server resolves role=editor.
                    setEditorReady(!!c)
                  }}
                  // Only offered behind a drawer — docked, the files are already visible.
                  onBrowseFiles={narrow ? () => setDrawerOpen(true) : undefined}
                  projectWords={projectWords}
                  onCursor={(line, col) => setCursor({ line, col })}
                  onDiagnostics={setProblems}
                />
                {/* Touch only (desk:hidden) — the desktop editor has the right-click
                    menu. Quiet at rest, semi-transparent, above the home indicator. */}
                {activePath ? (
                  <button
                    ref={fabRef}
                    type="button"
                    aria-label={COPY.a11yMoreActions}
                    onClick={openEditorTouchActions}
                    className={
                      'cm-actions-fab desk:hidden absolute z-10 inline-grid place-items-center size-icon-btn ' +
                      'rounded-full text-[20px] leading-none text-text-2 shadow-raised ' +
                      'border border-border-subtle bg-[color-mix(in_srgb,var(--surface-3)_82%,transparent)] ' +
                      'after:absolute after:-inset-1 after:content-[""] ' +
                      'touch-manipulation cursor-pointer transition-[background-color,color] duration-(--dur-fast) ease-standard ' +
                      'active:bg-surface-4 active:text-text-1'
                    }
                    style={{
                      insetInlineEnd: 'calc(env(safe-area-inset-right) + var(--sp-3))',
                      bottom: `calc(env(safe-area-inset-bottom) + var(--sp-3)${keyboardOpen ? ' + var(--sp-2)' : ''})`,
                    }}
                  >
                    <IconMore />
                  </button>
                ) : null}
              </div>
            </>
          )}

          {/* ConsoleDivider grows a 12px handle on a coarse pointer, so a thumb has something to grab. */}
          {consoleOpen ? (
            <ConsoleDivider
              height={consoleHeight}
              // A hand drag retires any standing maximize, or Restore would later jump to
              // a height the drag already replaced.
              onHeight={(px) => {
                setConsoleMaximized(false)
                setConsoleHeight(px)
              }}
            />
          ) : null}

          <section
            aria-label={COPY.a11yConsole}
            data-state={runner.status}
            // `.console-panel` holds fill/divider/stdin-floor/accent-rule. Its min-height used to be a
            // bare-custom-property utility, which Tailwind v4 compiles to invalid CSS, silently breaking
            // spec §4.3 rule 4's console floor. (Not spelled out literally here — that would make
            // Tailwind emit the class again.)
            className={'console-panel ' + (consoleOpen ? 'console-panel--open' : 'h-bar-top')}
            // Persisted height at every width (no more phone-only 40% hack). Suspended under an open
            // keyboard — a fixed height there would starve the transcript to ~33px — so CSS's
            // `--console-floor` takes over instead.
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
                  // Over-asks on purpose — flex-shrink + the editor's min-height floor decide the
                  // real max. Divided by uiScale since innerHeight is unzoomed while height is a
                  // zoomed #root px length; undivided, a 0.7 scale under-asked and left a third of
                  // the editor showing.
                  setConsoleHeight(window.innerHeight / uiScale)
                  setConsoleMaximized(true)
                }
              }}
            />
            {/* Preview iframe stays MOUNTED whenever the pane is open (merely hidden via `hidden`),
                even behind the Console face — a display:none iframe keeps running, so its
                console.log still fills the Console. Unmounting it was the bug where output only
                appeared after a Preview visit. `contents` lets its own flex sizing reach the pane when shown. */}
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
                // A run that never started has no engine/output for the transcript to show —
                // its own block with a retry button instead.
                failure={runner.failure}
                onRetry={runControl.onRun}
                onRun={runControl.onRun}
                onStop={runControl.onStop}
                onDismissFailure={runner.clearFailure}
                bindStdinFocus={runner.bindStdinFocus}
                onSubmitStdin={runner.submitStdin}
                onNotify={notify}
              />
            ) : null}
          </section>
        </main>

      </div>

      {/* LAYOUT-VSCODE §3, at every width — but hidden under an open keyboard, since
          §4.3 rule 4's console floor claims those pixels first. */}
      {keyboardOpen ? null : (
        <StatusBar
          status={runner.status}
          exitCode={runner.exitCode}
          activePath={activePath}
          entryPath={runControl.entry}
          cursor={empty || !activePath ? null : cursor}
          // Same gate as the caret: a problems count belongs to an open file.
          problems={empty || !activePath ? null : problems}
          onProblems={() => editorRef.current?.toggleProblems()}
          fontSize={fontSize}
          onFontSize={setFontSize}
          // Ln/Col opens Go to Line — the quick input's ':' face, VS Code's
          // own behaviour for that status item.
          onGotoLine={() => setQuickPick('goto')}
        />
      )}
    </div>
      )}

      {/* Overlays live outside the Home/editor branch — New project, import, and quick-switch work from both. */}
      {quickPick ? (
        <QuickInput
          mode={quickPick}
          // Open tabs lead (that's "recently opened" for the file picker), then the rest in explorer order.
          files={[...tabs, ...project.paths().filter((p) => !tabs.includes(p))]}
          commands={paletteCommands}
          // Same MRU ordering as WelcomePanel's Recent — excluded because a row for the current project is a dead link.
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

      {accountOpen ? <AccountDialog api={authApi} onClose={() => setAccountOpen(false)} notify={notify} /> : null}

      {shareOpen && collab.roomId ? (
        <ShareDialog
          api={authApi}
          roomId={collab.roomId}
          // The host owns the doc; a guest sees copy-link only.
          isOwner={collab.isHost}
          // H2: an owner's link-access change is ALSO published into the live doc
          // meta, so already-connected honest guests re-resolve their role and flip
          // read-only (the server PATCH stays the authoritative enforcement).
          onLinkAccess={(access) => collab.setLinkAccess(access)}
          onClose={() => setShareOpen(false)}
          notify={notify}
        />
      ) : null}

      {genMenu ? (
        <GenerateMenu
          anchor={genMenu.anchor}
          analysis={genMenu.analysis}
          // One edit through the controller — one undo step, normal dirty/save path.
          onApply={(source) => {
            editorRef.current?.applyEdit(source)
            notify(COPY.noteGenerated)
          }}
          onExists={() => notify(COPY.noteGenerateExists)}
          onError={() => notify(COPY.noteGenerateFailed, 'error')}
          onClose={() => setGenMenu(null)}
        />
      ) : null}

      {/* The editor's right-click menu (desktop) and touch actions button share one
          Menu; every row carries a leading icon, so the gutter stays (never `plain`). */}
      {editorActionsMenu ? (
        <Menu
          anchor={editorActionsMenu.anchor}
          items={editorActionsMenu.items}
          label={COPY.a11yMoreActions}
          plain={editorActionsMenu.plain}
          onClose={() => setEditorActionsMenu(null)}
        />
      ) : null}
    </>
  )
}
