import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkCapabilities, type CapabilityReport } from './capabilities'
import { ConsoleBuffer } from './console/buffer'
import { splitPath } from './fs/project'
import { prefs, setPrefs } from './fs/prefs'
import type { FsSnapshot } from './fs/types'
import { entryCandidates } from './runtime'
import type { Template } from './templates'
import { exportZip, importZip } from './zip'
import { useProject } from './hooks/useProject'
import { useRunner } from './hooks/useRunner'
import { useKeyboardOpen, useMedia } from './hooks/useMedia'
import { installViewport } from './ui/viewport'
import type { EditorController } from './editor/setup'
import { CapabilityBanner, CapabilityFatalScreen } from './components/CapabilityScreens'
import { Console } from './components/Console'
import { ConsoleDivider } from './components/ConsoleDivider'
import { Editor } from './components/Editor'
import { Explorer } from './components/Explorer'
import { RunBar } from './components/RunBar'
import { Tabs } from './components/Tabs'
import { TopBar } from './components/TopBar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useDialogs } from './components/ui/DialogProvider'
import { useToast } from './components/ui/Toast'
import type { MenuItem } from './components/ui/Menu'

const NARROW = '(max-width: 899px)'

export function App() {
  const report = useMemo(() => checkCapabilities(), [])
  useEffect(() => installViewport(), [])
  // A missing hard requirement is a dead end, and saying so beats a spinner
  // that never finishes.
  if (report.level === 'fatal') return <CapabilityFatalScreen report={report} />
  return <Ide report={report} />
}

function Ide({ report }: { report: CapabilityReport }) {
  const { project, ready, revision, tree } = useProject()
  const dialogs = useDialogs()
  const notify = useToast()
  const narrow = useMedia(NARROW)
  const keyboardOpen = useKeyboardOpen()

  const bufferRef = useRef<ConsoleBuffer | null>(null)
  if (!bufferRef.current) bufferRef.current = new ConsoleBuffer()
  const buffer = bufferRef.current

  const editorRef = useRef<EditorController | null>(null)
  const zipInputRef = useRef<HTMLInputElement>(null)

  const initial = useMemo(() => prefs(), [])
  const [hydrated, setHydrated] = useState(false)
  const [tabs, setTabs] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [entryPath, setEntryPath] = useState<string | null>(initial.entryPath)
  const [fontSize, setFontSize] = useState(initial.fontSize)
  const [consoleOpen, setConsoleOpen] = useState(!initial.consoleCollapsed)
  const [consoleHeight, setConsoleHeight] = useState(initial.consoleHeight)
  const [hand, setHand] = useState<'right' | 'left'>(initial.hand)
  const [explorerDocked, setExplorerDocked] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [welcomeOpen, setWelcomeOpen] = useState(false)

  const candidates = useMemo(() => entryCandidates(project.sourceFiles()), [project, revision])
  const runner = useRunner(project, buffer, entryPath)

  // ---- restore the workspace once the project has loaded ----
  useEffect(() => {
    if (!ready || hydrated) return
    if (project.isEmpty()) {
      setWelcomeOpen(true)
    } else {
      const open = initial.openTabs.filter((p) => project.has(p))
      const active = initial.activePath && open.includes(initial.activePath) ? initial.activePath : (open[0] ?? null)
      setTabs(open)
      setActivePath(active)
    }
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
      consoleCollapsed: !consoleOpen,
      consoleHeight,
      hand,
    })
  }, [hydrated, tabs, activePath, entryPath, fontSize, consoleOpen, consoleHeight, hand])

  useEffect(() => {
    document.documentElement.dataset.hand = hand
  }, [hand])

  // Keep the chosen entry point valid as files come and go.
  useEffect(() => {
    if (candidates.length === 0) return
    if (!entryPath || !candidates.includes(entryPath)) setEntryPath(candidates[0])
  }, [candidates, entryPath])

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

  const validName = (name: string): string | null => {
    if (!name) return 'That name is empty.'
    if (name.startsWith('/') || name.endsWith('/')) return 'A name cannot start or end with "/".'
    if (name.split('/').some((s) => s === '' || s === '.' || s === '..')) return 'That path is not valid.'
    if (/[\\:*?"<>|]/.test(name)) return 'That name uses a character files cannot have.'
    return null
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

  const newFile = async (dir: string) => {
    const name = await dialogs.prompt({
      title: 'New file',
      label: dir ? `Inside ${dir}/` : 'In the project root',
      placeholder: 'Main.java',
      okLabel: 'Create',
    })
    if (!name) return
    const problem = validName(name)
    if (problem) return notify(problem, 'error')
    const path = dir ? `${dir}/${name}` : name
    if (project.has(path)) return notify(`${path} already exists.`, 'error')
    try {
      await project.createFile(path, starterContent(path))
      openFile(path)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const newFolder = async (dir: string) => {
    const name = await dialogs.prompt({
      title: 'New folder',
      label: dir ? `Inside ${dir}/` : 'In the project root',
      placeholder: 'models',
      okLabel: 'Create',
    })
    if (!name) return
    const problem = validName(name)
    if (problem) return notify(problem, 'error')
    try {
      await project.createFolder(dir ? `${dir}/${name}` : name)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  const renameEntry = async (path: string, isDir: boolean) => {
    const { dir, name } = splitPath(path)
    const next = await dialogs.prompt({
      title: isDir ? 'Rename folder' : 'Rename file',
      value: name,
      okLabel: 'Rename',
    })
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

  const saveAll = useCallback(async () => {
    await project.saveAll()
  }, [project])

  // ---- templates + zip ----
  const replaceProject = async (snapshot: FsSnapshot, entry: string | null, label: string) => {
    await project.replaceAll(snapshot)
    editorRef.current?.closeFile(editorRef.current.currentPath() ?? '')
    setTabs(entry ? [entry] : [])
    setActivePath(entry)
    setEntryPath(entry)
    setWelcomeOpen(false)
    buffer.clear()
    notify(label)
  }

  const confirmReplace = async (what: string) => {
    if (project.isEmpty()) return true
    return dialogs.confirm({
      title: 'Replace what you have?',
      message: `${what} removes the files now in Warsha. Export a .zip first if you want to keep them.`,
      okLabel: 'Replace',
      danger: true,
    })
  }

  const applyTemplate = async (t: Template) => {
    if (!(await confirmReplace(`Starting "${t.name}"`))) return
    await replaceProject(t.snapshot, t.entry, `${t.name} created`)
  }

  const startEmpty = async () => {
    if (!(await confirmReplace('Starting an empty folder'))) return
    await replaceProject({ files: [], dirs: [] }, null, 'Empty project ready')
  }

  const onZipPicked = async (file: File) => {
    try {
      const snapshot = await importZip(file)
      if (snapshot.files.length === 0) return notify('That .zip has no files in it.', 'error')
      const ok = await dialogs.confirm({
        title: 'Import this project?',
        message: `${file.name} has ${snapshot.files.length} file(s). Importing replaces the files now in Warsha.`,
        okLabel: 'Import',
        danger: true,
      })
      if (!ok) return
      const entry = entryCandidates(snapshot.files)[0] ?? snapshot.files[0]?.path ?? null
      await replaceProject(snapshot, entry, `Imported ${snapshot.files.length} file(s)`)
    } catch (e) {
      notify(`That .zip could not be opened. (${(e as Error).message})`, 'error')
    }
  }

  // ---- keyboard shortcuts ----
  const runnerRef = useRef(runner)
  runnerRef.current = runner
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveAll()
        notify('Saved')
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        const r = runnerRef.current
        if (r.busy) r.stop()
        else {
          setConsoleOpen(true)
          void r.run()
        }
      } else if (e.key === 'Escape') {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveAll, notify])

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void project.saveAll()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [project])

  const menuItems: MenuItem[] = [
    { label: 'New project…', onSelect: () => setWelcomeOpen(true) },
    {
      label: 'Export as .zip',
      onSelect: () => {
        exportZip(project.snapshot())
        notify(`Exported ${project.paths().length} file(s)`)
      },
    },
    { label: 'Import .zip…', onSelect: () => zipInputRef.current?.click() },
    { label: 'Save all', onSelect: () => void saveAll() },
    { label: 'Bigger text', onSelect: () => setFontSize((s) => Math.min(26, s + 1)) },
    { label: 'Smaller text', onSelect: () => setFontSize((s) => Math.max(11, s - 1)) },
    {
      label: hand === 'right' ? 'Run button on left' : 'Run button on right',
      onSelect: () => setHand((h) => (h === 'right' ? 'left' : 'right')),
    },
  ]

  const explorerVisible = narrow ? drawerOpen : explorerDocked
  const activeContent = activePath ? (project.read(activePath) ?? '') : ''

  return (
    <div className="app-shell">
      <TopBar
        onToggleExplorer={() => (narrow ? setDrawerOpen((v) => !v) : setExplorerDocked((v) => !v))}
        menuItems={menuItems}
      />

      <div className="relative flex min-h-0 min-w-0 overflow-hidden">
        {/* Explorer: docked at ≥900px, an overlay drawer below that. */}
        <aside
          aria-label="Files"
          aria-hidden={!explorerVisible}
          data-state={explorerVisible ? 'open' : 'closed'}
          className={
            'z-20 shrink-0 border-r border-border-subtle ' +
            (narrow
              ? 'absolute inset-y-0 left-0 w-drawer shadow-raised transition-transform duration-[--dur] ' +
                (drawerOpen ? 'translate-x-0' : '-translate-x-[102%]')
              : explorerDocked
                ? 'w-explorer'
                : 'hidden')
          }
        >
          <Explorer
            project={project}
            tree={tree}
            activePath={activePath}
            onOpenFile={openFile}
            onNewFile={(dir) => void newFile(dir)}
            onNewFolder={(dir) => void newFolder(dir)}
            onRename={(p, isDir) => void renameEntry(p, isDir)}
            onDelete={(p, isDir) => void deleteEntry(p, isDir)}
          />
        </aside>

        {narrow && drawerOpen ? (
          <div className="absolute inset-0 z-10 bg-[--scrim]" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1">
          <CapabilityBanner report={report} />

          <Tabs
            project={project}
            tabs={tabs}
            activePath={activePath}
            onSelect={(p) => setActivePath(p)}
            onClose={closeTab}
          />

          <Editor
            path={activePath}
            content={activeContent}
            fontSize={fontSize}
            onChange={(p, c) => project.setContent(p, c)}
            onSave={() => void saveAll()}
            onController={(c) => {
              editorRef.current = c
            }}
          />

          {/* Dragging a divider with a thumb on a 390px screen is not worth
              building, so resize is a ≥900px affordance only (spec §6). */}
          {consoleOpen && !narrow ? (
            <ConsoleDivider height={consoleHeight} onHeight={setConsoleHeight} />
          ) : null}

          <section
            aria-label="Console"
            data-state={runner.status}
            className={
              'console-lift flex shrink-0 flex-col border-t border-border-subtle bg-surface-2 ' +
              (consoleOpen ? 'min-h-[--console-min-h-stdin]' : 'h-bar')
            }
            style={consoleOpen ? { height: narrow ? '40%' : `${consoleHeight}px` } : undefined}
          >
            <RunBar
              status={runner.status}
              exitCode={runner.exitCode}
              busy={runner.busy}
              candidates={candidates}
              entryPath={entryPath}
              consoleOpen={consoleOpen}
              canRun={candidates.length > 0}
              onEntryChange={setEntryPath}
              onRun={() => {
                setConsoleOpen(true)
                void runner.run()
              }}
              onStop={runner.stop}
              onClear={() => buffer.clear()}
              onToggleConsole={() => setConsoleOpen((v) => !v)}
            />
            {consoleOpen ? (
              <Console
                buffer={buffer}
                status={runner.status}
                progress={runner.progress}
                bindStdinFocus={runner.bindStdinFocus}
                onSubmitStdin={runner.submitStdin}
                onNotify={notify}
              />
            ) : null}
          </section>
        </main>

        {welcomeOpen ? (
          <WelcomeScreen
            onPickTemplate={(t) => void applyTemplate(t)}
            onEmptyFolder={() => void startEmpty()}
            onImportZip={() => zipInputRef.current?.click()}
            onDismiss={project.isEmpty() ? undefined : () => setWelcomeOpen(false)}
          />
        ) : null}
      </div>

      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void onZipPicked(file)
        }}
      />
    </div>
  )
}
