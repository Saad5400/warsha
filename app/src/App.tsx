import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkCapabilities, type CapabilityReport } from './capabilities'
import { ConsoleBuffer } from './console/buffer'
import { splitPath } from './fs/project'
import { prefs, setPrefs } from './fs/prefs'
import type { FsSnapshot } from './fs/types'
import { entryCandidates } from './runtime'
import type { Template } from './templates'
import { exportZip } from './zip'
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
import { WelcomePanel } from './components/WelcomePanel'
import { ImportZipDialog } from './components/ImportZipDialog'
import { useDialogs } from './components/ui/DialogProvider'
import { useToast } from './components/ui/Toast'
import type { MenuItem } from './components/ui/Menu'
import {
  IconExport,
  IconImport,
  IconPlus,
  IconSave,
  IconSwapSides,
  IconTextBigger,
  IconTextSmaller,
  IconTrash,
} from './components/ui/Icons'
import { COPY, count } from './copy'

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
  const [importOpen, setImportOpen] = useState(false)

  const candidates = useMemo(() => entryCandidates(project.sourceFiles()), [project, revision])
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
      await project.createFile(path, starterContent(path))
      openFile(path)
      // Creating a file is the start of typing in it, so the caret goes there
      // rather than leaving the student to tap the canvas.
      editorRef.current?.focus()
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

  // ---- starters + zip ----
  // A starter populates the project you are already in. It is an action, not a
  // mode: nothing about the app changes afterwards except which files exist.
  const replaceProject = async (snapshot: FsSnapshot, entry: string | null, label: string) => {
    await project.replaceAll(snapshot)
    editorRef.current?.closeFile(editorRef.current.currentPath() ?? '')
    setTabs(entry ? [entry] : [])
    setActivePath(entry)
    setEntryPath(entry)
    buffer.clear()
    notify(label, 'success')
  }

  const confirmReplace = async (title: string, what: string, okLabel: string) => {
    if (project.isEmpty()) return true
    return dialogs.confirm({
      title,
      message: `${what} removes the ${count(project.paths().length, 'file')} now in Warsha. Export a .zip first if you want to keep them.`,
      okLabel,
      danger: true,
    })
  }

  const applyTemplate = async (t: Template) => {
    if (!(await confirmReplace('Replace what you have?', `Starting “${t.name}”`, 'Replace'))) return
    await replaceProject(t.snapshot, t.entry, `${t.name} ready — ${count(t.snapshot.files.length, 'file')}.`)
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
    const name = 'warsha-project.zip'
    exportZip(project.snapshot(), name)
    notify(COPY.exported(name, project.paths().length), 'success')
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

  const empty = project.isEmpty()
  const mod = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

  // Grouped, glyphed and 44px per row (spec §5.2). "Empty this project" is the
  // only destructive item, so it sits last behind a divider and never near Save.
  const menuItems: MenuItem[] = [
    { label: 'New file…', icon: <IconPlus size={18} />, onSelect: () => void newFile('') },
    { label: 'Save all', icon: <IconSave size={18} />, hint: `${mod} S`, onSelect: () => void saveAll() },
    { label: 'Import .zip…', icon: <IconImport size={18} />, startsGroup: true, onSelect: () => setImportOpen(true) },
    {
      label: 'Export as .zip',
      icon: <IconExport size={18} />,
      disabled: empty,
      onSelect: exportProject,
    },
    {
      label: 'Bigger text',
      icon: <IconTextBigger size={18} />,
      startsGroup: true,
      onSelect: () => setFontSize((s) => Math.min(26, s + 1)),
    },
    {
      label: 'Smaller text',
      icon: <IconTextSmaller size={18} />,
      onSelect: () => setFontSize((s) => Math.max(11, s - 1)),
    },
    {
      label: hand === 'right' ? 'Run button on left' : 'Run button on right',
      icon: <IconSwapSides size={18} />,
      onSelect: () => setHand((h) => (h === 'right' ? 'left' : 'right')),
    },
    {
      label: 'Empty this project…',
      icon: <IconTrash size={18} />,
      danger: true,
      disabled: empty,
      onSelect: () => void startEmpty(),
    },
  ]

  const explorerVisible = narrow ? drawerOpen : explorerDocked
  const activeContent = activePath ? (project.read(activePath) ?? '') : ''

  return (
    <div className="app-shell">
      <TopBar
        onToggleExplorer={() => (narrow ? setDrawerOpen((v) => !v) : setExplorerDocked((v) => !v))}
        menuItems={menuItems}
        title={activePath}
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
            onOpenFile={openFile}
            onNewFile={(dir, name) => void newFile(dir, name)}
            onNewFolder={(dir, name) => void newFolder(dir, name)}
            onRename={(p, isDir, name) => void renameEntry(p, isDir, name)}
            onDelete={(p, isDir) => void deleteEntry(p, isDir)}
            // The starters live in the workspace itself now, so from a drawer
            // the useful move is to get out of the way and show them. Docked,
            // they are already on screen and the button would be a no-op.
            onUseTemplate={narrow ? () => setDrawerOpen(false) : undefined}
          />
        </aside>

        {narrow && drawerOpen ? (
          // `.scrim`, not `bg-[--scrim]`: the utility form compiles to
          // `background-color:--scrim` under Tailwind v4 and the browser drops
          // it, which left the open drawer with no scrim behind it at all.
          <div className="scrim absolute inset-0 z-10" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1">
          <CapabilityBanner report={report} />

          {/* An empty project has nothing to tab through and nothing to edit, so
              the editor area carries the start panel instead. This is Warsha's
              entire first-run experience: no gate, no route, no modal, and it is
              gone for good the moment a file exists. */}
          {empty ? (
            <WelcomePanel
              onNewFile={() => void newFile('')}
              onPickTemplate={(t) => void applyTemplate(t)}
              onImportZip={() => setImportOpen(true)}
            />
          ) : (
            <>
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
                // Only offered where the explorer is hidden behind a drawer;
                // docked, the files are already on screen and the button would be
                // a no-op.
                onBrowseFiles={narrow ? () => setDrawerOpen(true) : undefined}
              />
            </>
          )}

          {/* Dragging a divider with a thumb on a 390px screen is not worth
              building, so resize is a ≥900px affordance only (spec §6). */}
          {consoleOpen && !narrow ? (
            <ConsoleDivider height={consoleHeight} onHeight={setConsoleHeight} />
          ) : null}

          <section
            aria-label="Console"
            data-state={runner.status}
            // `.console-panel` carries the fill, the top divider, the 144px
            // stdin floor and the accent rule that marks a running process. The
            // min-height here used to be a bare-custom-property utility, which
            // Tailwind v4 compiles to invalid CSS — so the floor from spec §4.3
            // rule 4 ("the single most important number in this section") was
            // doing nothing at all. (Spelling that class name out in a comment
            // is enough for Tailwind to emit it again, so it stays paraphrased.)
            className={'console-panel console-lift ' + (consoleOpen ? 'console-panel--open' : 'h-bar')}
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

      </div>

      {importOpen ? (
        <ImportZipDialog
          currentFileCount={project.paths().length}
          onCancel={() => setImportOpen(false)}
          onImport={(snapshot, name) => void onZipImported(snapshot, name)}
        />
      ) : null}
    </div>
  )
}
