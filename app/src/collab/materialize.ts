/**
 * The Y.Doc ↔ Project bridge (COLLAB-SYNC-CONTRACT §1, "source-of-truth shift").
 *
 * Once a project is collab-enabled the `Y.Doc` is authoritative, and this bridge
 * keeps the real OPFS-backed `Project` (what the runtimes read to Run) in step:
 *
 *   Y.Doc → Project (materialize):  observe `files`/`dirs` and each `Y.Text`;
 *      reflect adds/removes/edits into Project via createFile/remove/setContent.
 *      Project's own 350ms debounce then lands them in OPFS — eventually
 *      consistent and idempotent (contract edge #3).
 *
 *   Project → Y.Doc (mirror):  a *local* structural change (the student made a
 *      file in the explorer, still calling Project directly) is diffed against
 *      the doc and pushed through the Y.Doc mutators, so it reaches peers.
 *      Active-file *content* is NOT mirrored here — it flows editor→Y.Text via
 *      y-codemirror.next, and back to Project through the materialize direction.
 *
 * Both directions share one `applying` echo-guard so a write in one never
 * bounces straight back out the other. The mirror is additionally diff-based
 * (compare path sets), so even a mistimed guard cannot create a spurious echo:
 * the diff of "Project already matches Y.Doc" is empty.
 *
 * Two hard gates protect the room from the Project moving under the bridge:
 *
 *   - **Store epoch** (`Project.epoch`): captured at construction. If the Project
 *     has since been `switchStore`d to a DIFFERENT project, every handler bails —
 *     both directions. Without this, a project switch during a live session made
 *     the mirror diff the NEW project's files against the room doc: it uploaded
 *     unrelated files and `ydRemove`d every real room file, which then propagated
 *     to every guest's OPFS. Data loss, the worst kind.
 *
 *   - **Mirror gate** (`mirror` option / `enableMirror()`): a joining session's
 *     doc arrives ASYNC (IndexedDB, blob store, WebRTC). Until it has, the doc's
 *     file set is partial, and a mirror diff would "restore" files whose real
 *     Y.Text is still in flight — creating fresh Y.Texts that clobber the real
 *     ones on merge (duplicated/lost content). The session enables the mirror
 *     only after the initial sync, and `enableMirror()` runs one reconciliation
 *     pass to pick up anything that changed locally during the window.
 */
import * as Y from 'yjs'
import type { Project } from '../fs/project'
import { dirsMap, filesMap, ydCreateFile, ydCreateFolder, ydRemove } from './doc'

export interface ProjectBridgeOptions {
  /** Whether the Project→Y.Doc mirror starts enabled. Hosts of a fresh room: yes
   *  (their project IS the doc). Joining/rejoining sessions: no — call
   *  `enableMirror()` after the doc's initial sync. Defaults to true. */
  mirror?: boolean
}

export class ProjectBridge {
  private doc: Y.Doc
  private project: Project
  private files: Y.Map<Y.Text>
  private dirs: Y.Map<true>
  /** True while one side is writing the other — the reverse handler bails out. */
  private applying = false
  /** Project.epoch at construction — the project this bridge was created for. */
  private epoch: number
  /** Project→Y.Doc mirroring gate (see header). */
  private mirror: boolean
  private offStructure: (() => void) | null = null
  private destroyed = false

  constructor(doc: Y.Doc, project: Project, opts: ProjectBridgeOptions = {}) {
    this.doc = doc
    this.project = project
    this.files = filesMap(doc)
    this.dirs = dirsMap(doc)
    this.epoch = project.epoch
    this.mirror = opts.mirror ?? true

    this.files.observeDeep(this.onFilesDeep)
    this.dirs.observe(this.onDirs)
    this.offStructure = project.onStructureChange(this.onProjectStructure)

    // Initial reconcile: a joined room may already hold files (from persistence
    // or peers) before observers were attached. Idempotent, guarded.
    this.materializeAll()
  }

  /** The Project was re-pointed at a different project — this bridge is dead. */
  private stale(): boolean {
    return this.destroyed || this.project.epoch !== this.epoch
  }

  /** Opens the Project→Y.Doc mirror and runs one reconciliation diff, so local
   *  structural changes made during the pre-sync window still reach the doc. */
  enableMirror(): void {
    if (this.stale() || this.mirror) return
    this.mirror = true
    this.onProjectStructure()
  }

  // ---- Y.Doc → Project ----------------------------------------------------

  private materializeAll(): void {
    if (this.stale()) return
    this.applying = true
    try {
      for (const [path, text] of this.files) {
        const content = text.toString()
        if (this.project.has(path)) {
          this.project.setContent(path, content)
        } else {
          void this.project.createFile(path, content)
        }
      }
      for (const [path] of this.dirs) {
        if (!this.project.has(path) && !this.project.hasDir(path)) void this.project.createFolder(path)
      }
    } finally {
      this.applying = false
    }
  }

  private onFilesDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    if (this.applying || this.stale()) return
    this.applying = true
    try {
      for (const ev of events) {
        if (ev.target === this.files) {
          // Structure of the files map changed (a file was added or removed).
          const mev = ev as Y.YMapEvent<Y.Text>
          for (const [key, change] of mev.changes.keys) {
            if (change.action === 'delete') {
              if (this.project.has(key)) void this.project.remove(key)
            } else {
              const text = this.files.get(key)
              if (text) this.writeFile(key, text.toString())
            }
          }
        } else if (ev.target instanceof Y.Text) {
          // A file's contents changed (local yCollab edit or a remote one).
          const key = String(ev.path[ev.path.length - 1])
          const text = this.files.get(key)
          if (text) this.writeFile(key, text.toString())
        }
      }
    } finally {
      this.applying = false
    }
  }

  private writeFile(path: string, content: string): void {
    if (this.stale()) return
    if (this.project.has(path)) this.project.setContent(path, content)
    else void this.project.createFile(path, content)
  }

  private onDirs = (event: Y.YMapEvent<true>) => {
    if (this.applying || this.stale()) return
    this.applying = true
    try {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'delete') {
          // Only drop it if nothing lives under it — a file's ancestor dir is
          // implied, not an empty-dir record.
          const hasChild = [...this.files.keys()].some((f) => f.startsWith(key + '/'))
          if (!hasChild && this.project.hasDir(key)) void this.project.remove(key)
        } else if (!this.project.hasDir(key) && !this.project.has(key)) {
          void this.project.createFolder(key)
        }
      }
    } finally {
      this.applying = false
    }
  }

  // ---- Project → Y.Doc (local structural changes only) --------------------

  private onProjectStructure = () => {
    if (this.applying || this.stale() || !this.mirror) return
    this.applying = true
    try {
      const projectFiles = new Set(this.project.paths())
      const docFiles = new Set(this.files.keys())
      // Local adds → into the doc (new Y.Text seeded from the file's content).
      for (const path of projectFiles) {
        if (!docFiles.has(path)) ydCreateFile(this.doc, path, this.project.read(path) ?? '')
      }
      // Local deletes → out of the doc.
      for (const path of docFiles) {
        if (!projectFiles.has(path)) ydRemove(this.doc, path)
      }
      // Empty directories, same diff.
      const projectDirs = new Set(this.projectDirs())
      const docDirs = new Set(this.dirs.keys())
      for (const d of projectDirs) if (!docDirs.has(d)) ydCreateFolder(this.doc, d)
      for (const d of docDirs) {
        if (!projectDirs.has(d)) {
          const hasChild = [...projectFiles].some((f) => f.startsWith(d + '/')) || [...projectDirs].some((x) => x.startsWith(d + '/'))
          if (!hasChild) ydRemove(this.doc, d)
        }
      }
    } finally {
      this.applying = false
    }
  }

  /** Project exposes dirs only via its snapshot; pull the sorted list from there. */
  private projectDirs(): string[] {
    return this.project.snapshot().dirs
  }

  destroy(): void {
    this.destroyed = true
    this.files.unobserveDeep(this.onFilesDeep)
    this.dirs.unobserve(this.onDirs)
    this.offStructure?.()
    this.offStructure = null
  }
}
