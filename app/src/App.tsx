import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkCapabilities, type CapabilityReport } from './capabilities'
import { ConsoleBuffer } from './console/buffer'
import { splitPath } from './fs/project'
import { prefs, setPrefs } from './fs/prefs'
import { nextProjectName } from './fs/projects'
import type { FsSnapshot } from './fs/types'
import { entryCandidates } from './runtime'
import { templates, type Template } from './templates'
import { exportZip } from './zip'
import { useProject } from './hooks/useProject'
import { useRunner } from './hooks/useRunner'
import { useKeyboardOpen, useMedia } from './hooks/useMedia'
import { installViewport } from './ui/viewport'
import type { EditorController } from './editor/setup'
import { wordsInSource } from './editor/completions'
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
  IconFileLines,
  IconFiles,
  IconFolderOpen,
  IconFolderPlus,
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
    revision,
    tree,
    projects,
    current: currentProject,
    migration,
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
  const [consoleOpen, setConsoleOpen] = useState(!initial.consoleCollapsed)
  const [consoleHeight, setConsoleHeight] = useState(initial.consoleHeight)
  const [hand, setHand] = useState<'right' | 'left'>(initial.hand)
  const [explorerDocked, setExplorerDocked] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const candidates = useMemo(() => entryCandidates(project.sourceFiles()), [project, revision])

  // Identifiers from every file, for editor completion. Recomputed on `revision`
  // (structure or dirty changes) rather than per keystroke — the editor scans the
  // buffer being typed in on its own, so this only has to cover the other files.
  const projectWords = useMemo(() => {
    const words = new Set<string>()
    for (const file of project.sourceFiles()) for (const word of wordsInSource(file.content)) words.add(word)
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
  const mod = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

  // Grouped, glyphed and 44px per row (spec §5.2). Destructive items sit last
  // behind a divider (Menu enforces that) and never near Save.
  //
  // The projects come first: this is the menu the top bar labels "Project menu",
  // and switching between projects is now its main job.
  const projectActions: MenuItem[] = [
    {
      label: 'New project…',
      icon: <IconFolderPlus size={18} />,
      startsGroup: true,
      onSelect: () => void newProject(),
    },
    ...templates.map((t) => ({
      label: `New ${t.name} project…`,
      icon: <IconFolderPlus size={18} />,
      onSelect: () => void newProject(t),
    })),
    {
      label: 'Rename this project…',
      icon: <IconFileLines size={18} />,
      disabled: !currentProject,
      onSelect: () => void renameCurrentProject(),
    },
    {
      label: 'Delete this project…',
      icon: <IconTrash size={18} />,
      danger: true,
      disabled: !currentProject,
      onSelect: () => void deleteCurrentProject(),
    },
  ]

  const fileActions: MenuItem[] = [
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

  // One row per project, most recently opened first, with the open one marked
  // and unselectable. Labels are made unique because `Menu` keys its rows by
  // label, and a project may be named anything — including the same thing as
  // another project, or as one of the actions above.
  const projectRows: MenuItem[] = (() => {
    const used = new Set([...projectActions, ...fileActions].map((i) => i.label))
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

  const menuItems: MenuItem[] = [...projectRows, ...projectActions, ...fileActions]

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
                projectWords={projectWords}
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
            // `.console-panel` carries the fill, the top divider, the stdin floor
            // and the accent rule that marks a running process. The min-height
            // here used to be a bare-custom-property utility, which Tailwind v4
            // compiles to invalid CSS — so the floor from spec §4.3 rule 4 ("the
            // single most important number in this section") was doing nothing at
            // all. (Spelling that class name out in a comment is enough for
            // Tailwind to emit it again, so it stays paraphrased.)
            className={'console-panel ' + (consoleOpen ? 'console-panel--open' : 'h-bar')}
            // No inline height while a software keyboard is up on a narrow screen.
            // 40% of a keyboard-shrunk viewport is ~160px, and once the panel's own
            // 44px header and its 83px stdin block are inside that, the transcript
            // is ~33px — one and a half output lines, against the four rule 4 asks
            // for. Handing the height to CSS lets `--console-floor-stdin` claim what
            // the panel actually needs; the editor keeps its own floor and yields
            // the rest. The panel being typed into should win the space, not hold a
            // fixed fraction.
            style={
              consoleOpen && !(narrow && keyboardOpen)
                ? { height: narrow ? '40%' : `${consoleHeight}px` }
                : undefined
            }
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
                // The console's status line names the exit code in plain English
                // ("Finished — exit code 0"); without this it falls back to the
                // vaguer wording. Requested by ui-console, who cannot reach here.
                exitCode={runner.exitCode}
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
