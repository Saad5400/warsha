/**
 * Every student-facing string, in English (DESIGN-SPEC §8).
 *
 * This file is the shape of the interface: `ar.ts` is typed against it, so a
 * string added here without an Arabic twin is a compile error, not a sentence
 * that quietly stays English on an Arabic phone.
 *
 * Tone rules that make these what they are: say what happened then what to do;
 * blame nobody; no "Error:" / "Invalid" / "Failed to"; no internals (no exit-code
 * jargon without a plain gloss); second person for what the student did, third
 * person for what the program did.
 *
 * What must NOT be translated in ar.ts — see the header of locale.ts for why:
 * language names (Java, Python), keywords and API names (main, class, package),
 * file extensions (.java, .zip), and the terms a student will meet in their
 * textbook and in a stack trace (stdin, exit code). Arabic carries the sentence
 * around them.
 *
 * Strings marked PLACEHOLDER are mine, awaiting Design's final wording.
 */

/** "1 file" / "3 files" — a plural, not a "file(s)". English only; Arabic has
 *  six plural forms and ar.ts brings its own helper. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export const EN = {
  // ---- runtime bootstrap (§7.6, §8) ----
  // One progress voice (founder ruling 2026-08-05): ProgressBlock is the only
  // place loading speaks. This is its one auxiliary sentence, shown only once
  // a first-run download runs long; nothing about loading is ever a transcript row.
  runtimeFirstRunNote: 'First-time download — next run starts instantly, even offline.',

  // ---- engine failures the student can act on (see useRunner's RunFailure) ----
  // Headline plus one hint; the engine's raw error ("TypeError: Failed to
  // fetch") told a student nothing and looked like their fault — still shown
  // once, behind "Details".
  engineOffline: (lang: string) => `Warsha could not download ${lang}. It needs the internet the first time.`,
  engineOfflineHint:
    'Check your Wi-Fi and try again. On a school network this download is sometimes blocked — ask your teacher.',
  engineIsolation: 'This browser will not let Warsha run programs that ask you questions.',
  engineIsolationHint:
    'Reload the page once. If it still will not work, use Chrome on Android or on a computer.',
  engineBroken: (lang: string) => `Warsha could not start ${lang}.`,
  engineBrokenHint: 'Try again. If it keeps happening, reload the page.',
  /** Worker the browser killed, usually for memory. A single red transcript
   * line, no failure card — not the student's fault, and Run is the only next step. */
  engineLost: 'The language engine stopped responding, so Warsha shut it down.',
  engineRetry: 'Try again',
  engineDetails: 'Details',
  /** Run went ahead on what is on screen because a save did not land. */
  runUnsaved:
    'Warsha could not save to this device, so it ran what is on screen. Export a .zip to keep a copy.',

  // ---- run lifecycle (§8) ----
  // No "Running <entry>…" row (founder ruling 2026-08-05) — the status
  // line/pill already say so, and students mistook system text here for their
  // program's own output.
  runOk: 'Finished. (exit code 0)',
  runFailed: (code: number) =>
    `Your program stopped early — exit code ${code}. The red lines above say why.`,
  runStopped: 'Stopped. Your files are all saved.',

  // ---- console (§8) ----
  consoleEmpty: 'Output will appear here when you run your code.',
  consoleCleared: 'Cleared.',
  consoleActionsMenu: 'Console actions',

  // ---- preview surface (web projects) ----
  // The iframe that renders a web project. `console.log` and errors still land in
  // the Console tab beside it, so the two views are the page and its log.
  previewTitle: 'Preview',
  previewEmpty: 'Your page will appear here when you run it.',
  /** The output pane's two faces, for a web project's tab toggle. */
  viewPreview: 'Preview',
  viewConsole: 'Console',
  /** PLACEHOLDER */
  editorEmpty: 'Pick a file from the explorer to start editing.',
  truncated: 'Earlier output hidden (5000-line limit).',
  /** PLACEHOLDER — for a line typed before the program asked for it. */
  stdinQueued: 'Saved — your program has not asked for input yet.',
  /** PLACEHOLDER — for typing with nothing running. */
  stdinIdle: 'Nothing is running yet. Tap Run first.',
  // The only placeholder left — no idle input exists to hold one. Asserted
  // verbatim by verify.mjs, verify-java.mjs and console-check.mjs (no ?lang=
  // override, so they read exactly this).
  stdinWaitingPlaceholder: 'Type your answer, then press Enter',

  // ---- transcript controls ----
  copyOutput: 'Copy output',
  copyOutputDone: 'Copied',
  copyOutputFailed: 'Could not copy — select the text instead.',
  clearOutput: 'Clear output',
  copySelection: 'Copy',
  newLines: (n: number) => `${n > 999 ? '999+' : n} new line${n === 1 ? '' : 's'}`,
  jumpToLatest: 'Jump to latest',
  showEarlier: (n: number) => `Show ${n.toLocaleString('en')} earlier lines`,

  // ---- status bar (LAYOUT-VSCODE §3) ----
  // Version is part of the label — answers "which Java is this?" — because
  // both engines are pinned: CheerpJ on Java 17, Pyodide on CPython 3.14 (ARCHITECTURE §6).
  langJava: 'Java 17',
  langPython: 'Python 3.14',
  langPlain: 'Plain text',
  /** Nothing is open, so there is no language to name. */
  langNone: 'No file',
  statusBarNoEntry: 'No entry point',
  /** The indentation indicator. The number is not a setting yet. */
  statusBarIndent: 'Spaces: 4',
  cursorAt: (line: number, col: number) => `Ln ${line}, Col ${col}`,

  // ---- entry point ----
  /** PLACEHOLDER */
  noEntry:
    'Warsha could not find a place to start. Add a main.py, or a Java class with a main method, then tap Run.',
  /** PLACEHOLDER */
  cannotRun: (entry: string) => `Warsha does not know how to run ${entry} yet.`,

  // ---- cross-file search (SearchView — the activity bar's Search view) ----
  // The placeholder is VS Code's own one-word "Search"; everything else keeps
  // the house voice: what happened, then what to do.
  searchPlaceholder: 'Search',
  searchHint: 'Type to search every file in this project.',
  /** Accessible names for the two filter toggles (VS Code's Aa / ab). */
  searchMatchCase: 'Match case',
  searchWholeWord: 'Whole word',
  searchNoResults: 'No results',
  searchNoResultsHint: 'Try different words, or turn off the Aa and ab filters.',
  /** "12 results in 3 files" — the line above the results (VS Code's own
   *  phrasing, and "result" pluralises where "match" defeats count()). */
  searchSummary: (matches: number, files: number) => `${count(matches, 'result')} in ${count(files, 'file')}`,
  /** The stop-at-500 note. The cap keeps a one-letter query from freezing the tab. */
  searchCapped: (n: number) => `Showing the first ${n} results — narrow the search to see the rest.`,

  // ---- storage (§8) ----
  /** The persistent banner. Never a toast: this condition does not go away. */
  storageQuotaTitle: 'This device is nearly out of space, so Warsha may stop saving.',
  storageQuotaHint: 'Delete a project you have finished, or export your work as a .zip.',
  storageFailedTitle: 'Warsha cannot save your files on this device right now.',
  storageFailedHint: 'Keep working — nothing is lost yet — but export a .zip before you close this tab.',
  storageMemoryTitle: 'This browser will not let Warsha save files, so your work only lasts as long as this tab.',
  storageMemoryHint: 'Export a .zip before you leave. Private browsing is the usual reason.',
  storageEvictedTitle: 'The project Warsha had open was not here any more, so it opened another one.',
  storageEvictedHint:
    'Some browsers clear saved files for sites you have not used in a while. Export a .zip to keep a copy.',
  storageExportNow: 'Export .zip',
  saveFailed: 'Warsha could not save to this device. Export a .zip to keep a copy.',
  /** Advisory only — both tabs keep working. */
  multiTabTitle: 'Warsha is open in another tab.',
  multiTabHint: 'Edit in one tab at a time, or the other tab will overwrite what you type here.',

  // ---- the start panel (§7.7, adapted: there is no welcome page) ----
  // Empty project shows this instead of a blank canvas — starter is the
  // primary way in (founder ruling 2026-08-05); New file / Import .zip stay
  // secondary, and the app never asks "which language?" (the extension answers that).
  welcomeNewFile: 'New file',
  welcomeNewProject: 'New from a starter',
  welcomeNewProjectBlurb: 'Pick a language, then a starter for your level.',
  welcomeImport: 'Import a .zip',
  welcomeStartProject: 'Start a project',
  welcomeRecent: 'Recent',
  welcomeRecentEmpty: 'Projects you create appear here.',
  welcomeLanguagesReady: (n: number) => `${n} languages ready · more soon`,

  // ---- the Home / projects screen (components/Home.tsx) ----
  homeTitle: 'Your projects',
  homeContinue: 'Continue where you left off',
  homeAll: 'All projects',
  homeOpen: 'Open',
  homeDuplicate: 'Duplicate',
  // Appended to a copy's name: "Bank accounts" → "Bank accounts copy".
  homeDupSuffix: 'copy',
  a11yHome: 'Home',
  noteProjectDuplicated: (name: string) => `Copied to “${name}”.`,
  homeSearchPlaceholder: 'Search projects',
  homeNoMatches: (q: string) => `No projects match “${q}”.`,
  homeSortBy: 'Sort',
  homeSortRecent: 'Recent',
  homeSortName: 'Name',
  homeSortCreated: 'Created',
  homePin: 'Pin to top',
  homeUnpin: 'Unpin',
  a11yPinned: 'Pinned',

  // ---- the New-project template picker (languages.ts + TemplatePicker) ----
  // One entry point for every starter — step one picks the language, step two
  // its starters, grouped beginner → advanced.
  pickerTitle: 'New project',
  pickerLangIntro: 'Pick a language to see its starters. You can rename the project after.',
  pickerReadyHeading: 'Ready to run',
  pickerSoonHeading: 'Coming soon',
  // Said once, plainly: these are not broken, they are unbuilt. Warsha runs
  // every language on the device, so each needs its own engine before it works.
  pickerSoonNote: 'Warsha runs everything on your device, so each language needs its own engine. These are on the way.',
  pickerSoonBadge: 'Soon',
  /** The accessible name for a dimmed tile — the badge alone is silent. */
  pickerSoonLabel: (lang: string) => `${lang} — coming soon`,
  pickerBack: 'All languages',
  pickerChooseTemplate: (lang: string) => `Choose a ${lang} starter`,
  // Blank is still one tap from the picker — the old "New project…" default,
  // folded in rather than kept as a second menu row.
  pickerBlank: 'Start with an empty file instead',
  levelBeginner: 'Beginner',
  levelIntermediate: 'Intermediate',
  levelAdvanced: 'Advanced',
  /** A starter's one-line manifest: "1 file · main.py". */
  templateManifest: (files: number, entry: string) => `${count(files, 'file')} · ${entry}`,

  // ---- install to the home screen (ui/install.ts) ----
  // Icon-only control — this string is both its accessible name and tooltip.
  // "Install Warsha" not "Install app": among unlabelled title-bar glyphs,
  // the product name is what identifies it.
  installAction: 'Install Warsha',
  /**
   * iOS/iPadOS only — WebKit fires no install event, so the Share sheet is the
   * whole mechanism; this just names it. Says what it gets them, not only what to tap.
   */
  installIos:
    'On iPhone and iPad: tap Share, then Add to Home Screen. Warsha then opens like any other app.',

  // ---- zip import / export ----
  importIntro: 'Pick a .zip of a project — one you exported from Warsha, or one a teacher gave you.',
  importDropHint: 'Drop a .zip here, or',
  importReplaces: (n: number) =>
    `This replaces the ${count(n, 'file')} you have now. Export a .zip first if you want to keep them.`,
  importEmptyZip: 'That .zip has no files in it. Try another one.',
  importNotZip: 'That one is not a .zip. Pick a file whose name ends in .zip.',
  importUnreadable: (detail: string) => `That .zip could not be opened. (${detail})`,
  /** Pictures, .class files, anything oversized, anything with a strange path. */
  importSkipped: (n: number) => `${count(n, 'item')} left out — Warsha only imports text files.`,
  imported: (name: string, n: number) => `Imported ${name} — ${count(n, 'file')}.`,
  exported: (name: string, n: number) => `Exported ${name} — ${count(n, 'file')}.`,
  importReading: 'Reading…',
  importChooseZip: 'Choose a .zip',
  importReplaceFiles: 'Replace files',
  importAction: 'Import',
  /** Follows the picked file's name: "starter.zip — 4 files ready to import." */
  importPicked: (n: number) => `${count(n, 'file')} ready to import.`,

  // ---- accessible names for the chrome (LAYOUT-VSCODE) ----
  // Icon-only controls and landmarks — read aloud, never seen, and easy to
  // leave in English by accident. Listed here so they can't be.
  a11yActivityBar: 'Activity bar',
  a11yExplorer: 'Explorer',
  a11ySearch: 'Search',
  a11yExtensions: 'Extensions',
  a11yManage: 'Manage',
  a11yBreadcrumbs: 'Breadcrumbs',
  a11yDismiss: 'Dismiss',
  a11yToggleSidebar: 'Toggle Primary Side Bar',
  a11yTogglePanel: 'Toggle Panel',
  /** The "⋯" on the explorer header and the tab strip. */
  a11yMoreActions: 'More actions',
  a11yResizeOutput: 'Resize output',
  a11yProgramOutput: 'Program output',
  a11yProgramInput: 'Program input',
  a11yProjectFiles: 'Project files',
  a11yUnsavedChanges: 'Unsaved changes',
  a11yAppMenu: 'Application Menu',
  a11yQuickOpen: 'Quick open',
  a11yQuickOpenResults: 'Quick open results',
  a11ySearchFilesByName: 'Search files by name',
  a11ySearchResults: 'Search results',
  a11yFileToRun: 'File to run',
  a11yFileToRunHint: 'Choose which file Run starts',
  a11yOutputView: 'Output view',
  a11yStatusBar: 'Status bar',
  a11yOpenFiles: 'Open files',
  a11yFiles: 'Files',
  a11yConsole: 'Console',
  a11yViewScale: 'View scale',
  a11yGoToLine: 'Go to line',
  a11ySmallerText: 'Smaller text',
  a11yBiggerText: 'Bigger text',

  // ---- explorer ----
  explorerTitle: 'Explorer',
  explorerEmpty: 'No files yet',
  explorerNewFile: 'New file…',
  explorerNewFolder: 'New folder…',
  explorerOpen: 'Open',
  explorerRename: 'Rename…',
  explorerDownload: 'Download',
  explorerDelete: 'Delete',
  explorerCopyPath: 'Copy path',
  explorerCollapse: 'Collapse folders',
  explorerNewFilePlaceholder: 'New file name',
  explorerNewFolderPlaceholder: 'New folder name',
  /** The icon buttons and the empty state's two rows — no ellipsis, because
   *  these create inline rather than opening the prompt dialog. */
  explorerNewFolderAction: 'New folder',
  explorerShowStarters: 'Show starters',
  explorerEmptyBody: 'Create a file to start. A name ending in .py or .java is all Warsha needs to know how to run it.',
  explorerActionsMenu: 'Explorer actions',
  explorerRowActions: (name: string) => `Actions for ${name}`,

  // ---- editor ----
  editorNoFile: 'No file open',
  editorBrowseFiles: 'Browse files',

  // ---- static analysis / diagnostics (editor/lint.ts) ----
  // Tone as everywhere: name what the code does, then what to do; blame nobody,
  // no "Error:"/"Invalid". Code tokens (==, .equals(), print) stay literal —
  // the sentence carries the meaning around them.
  /** The grammar could not parse this span. */
  lintSyntax: "Something here is unfinished or out of place, so this part can't be read yet.",
  /** Java `a == "b"` — compiles, but compares identity, not the text. */
  lintJavaStringEquals:
    '== checks whether two pieces of text are the very same object, which they usually are not. Use .equals() to compare what they say.',
  /** JavaScript `==` / `!=`. */
  lintJsLooseEquals:
    '== converts the two sides before comparing, which can surprise you. === compares the value and the type together.',
  /** Python 2 `print "x"` — a SyntaxError in Python 3. */
  lintPyPrint2:
    "In Python 3, print is a function, so what you print goes inside print( ). Written this way the line won't run.",
  /** Python `x == None`. */
  lintPyEqNone: 'Check for None with is, not ==. That is the question you actually mean here.',
  /** Fix labels — short, they sit on a button. */
  lintFixEquals: 'Use .equals()',
  lintFixStrictEquals: (op: string) => `Use ${op}`,
  lintFixIsNone: (keyword: string) => `Use ${keyword}`,
  lintFixPrintCall: 'Rewrite as print( )',
  // ---- structural scan (editor/structuralScan.ts, the Beginner helper) ----
  /** An opener with no matching closer — named so the student can find it. */
  lintBracketUnclosed: (open: string, close: string) =>
    `${open} opens here but nothing closes it. Add the matching ${close} where this should end.`,
  lintFixAddBracket: (close: string) => `Add ${close}`,
  /** A closer with no opener before it. */
  lintBracketStray: (ch: string) =>
    `This ${ch} has no opener to match. Remove it, or add the bracket it should close.`,
  lintFixRemove: (ch: string) => `Remove ${ch}`,
  /** A closer of the wrong kind for the bracket still open. */
  lintBracketMismatch: (ch: string) =>
    `This ${ch} closes a different kind of bracket than the one still open. Check the pairs line up.`,
  /** A string with no closing quote on its line. */
  lintStringUnterminated: 'This text has no closing quote, so it runs to the end of the line. Add the quote that ends it.',
  lintFixCloseString: 'Add closing quote',
  /** Java `'ab'` — single quotes are one character; text needs double quotes. */
  lintCharLiteral: 'Single quotes hold one character in Java. For a word or a sentence, use double quotes " ".',
  lintFixDoubleQuotes: 'Use " "',
  /** A Python block header (`if`, `for`, `def`, …) with no trailing colon. */
  lintMissingColon: 'A block like this opens with a colon. Add : at the end of the line, before its indented body.',
  lintFixAddColon: 'Add :',
  /** A known class in the wrong case — `system` for `System`. Java is case-sensitive. */
  lintCaseTypo: (wrong: string, right: string) =>
    `Java tells ${wrong} and ${right} apart by their capitals. The class you want is ${right}.`,
  lintFixUseCase: (right: string) => `Use ${right}`,
  /** A Java statement with no `;` at its end. */
  lintMissingSemicolon: 'This line finishes a statement, and a Java statement ends with a ; — add one here.',
  lintFixAddSemicolon: 'Add ;',
  /** The status bar's problems item and its accessible name. */
  statusBarProblems: (errors: number, warnings: number) => {
    const parts: string[] = []
    if (errors) parts.push(count(errors, 'error'))
    if (warnings) parts.push(count(warnings, 'warning'))
    return parts.join(', ')
  },
  a11yProblems: 'Show problems',

  // ---- the two "this went badly" screens ----
  capabilityTitle: 'Warsha cannot run in this browser',
  capabilityStillDo: 'What you can still do here',
  capabilityWhatToTry: 'What to try',
  capabilityTryBody:
    'Open Warsha in Chrome on an Android phone or tablet, or in Chrome, Edge or Safari on a computer. Those can run Java and Python.',
  capabilityReload: 'Reload and check again',
  /** One per Capability id in capabilities.ts — kept here rather than beside
   *  the check so the check stays a boolean and the sentence stays translated. */
  capWasm: 'This browser cannot run WebAssembly, which Warsha needs to run Java and Python. Warsha will not work here.',
  capWorkers: 'This browser cannot run background tasks, which Warsha needs to run your code.',
  capOpfs:
    'This browser cannot save files on your device, so your work will be lost when you close the tab. Export a .zip before you leave.',
  capIsolation:
    'Java/Python interactive input may not work in this browser yet. Try reloading the page once; if a program still will not accept typed input, use Chrome on Android or on a computer.',
  /** What survives a fatal check — the fatal screen's short list. */
  capStillWorks: [
    'Reading and writing code in the editor',
    'Creating, renaming and deleting files',
    'Exporting your project as a .zip',
  ] as string[],
  crashTitle: 'Warsha stopped working',
  crashBody:
    'Something in Warsha broke. Your files are still saved on this device — reloading the page should bring them back.',
  crashReload: 'Reload Warsha',
  crashForgetLayout: 'Reload and forget my layout',
  crashWhatWentWrong: 'What went wrong',

  // ---- the engine's loading phases (ProgressBlock) ----
  phaseDownloading: 'Downloading the language',
  phaseUnpacking: 'Unpacking',
  phaseStarting: 'Starting up',
  phaseCompiling: 'Compiling your code',

  // ---- quick input (Mod+P, Mod+Shift+P, Ctrl+G) ----
  quickCommandsPlaceholder: 'Type the name of a command to run',
  quickLinePlaceholder: 'Type a line number to go to',
  quickProjectsPlaceholder: 'Search recent projects by name',
  quickOpenFileFirst: 'Open a file first, then type a line number.',
  quickNoResults: 'No matching results',
  quickFilesPlaceholder: 'Search files by name (append : to go to a line, > to run a command)',
  quickLineRange: (lines: number, current: number | null) =>
    `Type a line number between 1 and ${lines} to go to${current != null ? ` (now at line ${current})` : ''}.`,

  // ---- run bar / run control ----
  runAction: 'Run',
  stopAction: 'Stop',
  runPreparing: 'Preparing…',
  outputRestore: 'Restore output',
  outputMaximize: 'Maximize output',
  outputHide: 'Hide output',
  outputShow: 'Show output',
  /** Away from the console the control names what it acts on. */
  runWhat: (what: string) => `Run ${what}`,
  stopWhat: (what: string) => `Stop ${what}`,
  runTipRun: (what: string, shortcut: string) => `Run ${what} (${shortcut})`,
  runTipStop: (shortcut: string) => `Stop the program (${shortcut})`,
  runTipStopPreparing: (shortcut: string) => `Stop getting the language ready (${shortcut})`,
  statusBarRunStarts: (entry: string) => `Run starts ${entry}`,

  // ---- the status pill's seven states (§7.3) ----
  pillReady: 'Ready',
  pillPreparing: 'Preparing',
  pillRunning: 'Running',
  pillWaiting: 'Waiting for you',
  pillFinished: 'Finished',
  pillFailed: 'Stopped early',
  pillStopped: 'Stopped by you',

  // ---- tabs ----
  tabsCloseOthers: 'Close others',
  tabsCloseAll: 'Close all',
  tabsClose: (name: string) => `Close ${name}`,
  tabsCloseUnsaved: (name: string) => `Close ${name} (unsaved)`,
  /** The tab strip's own "⋯", distinct from a row's More actions. */
  tabsMore: 'More',

  // ---- file and folder names the student types (App.validName) ----
  // Each one names the rule that was broken, never "invalid".
  nameEmpty: 'That name is empty.',
  nameSlashEnds: 'A name cannot start or end with "/".',
  namePathInvalid: 'That path is not valid.',
  nameBadCharacter: 'That name uses a character files cannot have.',
  nameTooLong: 'That name is too long.',
  /** ".java" is a valid file name and an invalid Java file. */
  nameNeedsStem: (ext: string) => `Give the file a name before the "${ext}".`,
  nameDotStart: 'A name cannot start with a dot.',
  nameDotEnd: 'A name cannot end with a space or a dot.',
  nameTaken: (name: string) => `There is already a “${name}” here.`,
  pathExists: (path: string) => `${path} already exists.`,

  // ---- dialogs (DialogProvider) ----
  dlgNewFileTitle: 'New file',
  dlgNewFolderTitle: 'New folder',
  dlgInside: (dir: string) => `Inside ${dir}/`,
  dlgInRoot: 'In the project root',
  dlgFilePlaceholder: 'Main.java',
  dlgFolderPlaceholder: 'models',
  dlgCreate: 'Create',
  dlgOk: 'OK',
  dlgCancel: 'Cancel',
  dlgClose: 'Close',
  dlgDone: 'Done',
  dlgRenameFileTitle: 'Rename file',
  dlgRenameFolderTitle: 'Rename folder',
  dlgRename: 'Rename',
  dlgDeleteFileTitle: 'Delete this file?',
  dlgDeleteFolderTitle: 'Delete this folder?',
  dlgDeleteFileBody: (path: string) => `${path} will be removed. This cannot be undone.`,
  dlgDeleteFolderBody: (path: string) => `${path} and everything inside it will be removed. This cannot be undone.`,
  dlgDelete: 'Delete',
  dlgEmptyTitle: 'Empty this project?',
  dlgEmptyWhat: 'Emptying this project',
  dlgEmptyOk: 'Empty it',
  /** "<What> removes the 4 files now in Warsha. …" */
  dlgReplaceBody: (what: string, files: number) =>
    `${what} removes the ${count(files, 'file')} now in Warsha. Export a .zip first if you want to keep them.`,
  dlgNewProjectTitle: 'New project',
  dlgNewProjectFrom: (template: string) => `New project from “${template}”`,
  dlgProjectName: 'Project name',
  dlgProjectNameRequired: 'Give the project a name.',
  dlgRenameProjectTitle: 'Rename project',
  dlgDeleteProjectTitle: (name: string) => `Delete “${name}”?`,
  dlgDeleteProjectBody: (files: number) =>
    `${files ? `The ${count(files, 'file')} in it will be removed. ` : ''}This cannot be undone. Export a .zip first if you want to keep them.`,
  aboutTitle: 'Warsha',
  aboutBody: 'A workshop for code — Java, Python, C# and the web, running entirely in your browser. Your files live on this device.',
  aboutVersion: (version: string) => `Version ${version}`,

  // ---- toasts ----
  noteShareBroken: 'That share link arrived damaged or cut short — ask for a fresh one.',
  noteShareSaveFailed: 'Warsha could not save the shared project to this device.',
  noteProjectReady: (name: string, files: number) => `“${name}” ready — ${count(files, 'file')}.`,
  noteProjectReadyBare: (name: string) => `“${name}” ready.`,
  noteShareDuplicate: (name: string) => `You already have this project, unchanged — opened “${name}”.`,
  noteAlreadyFormatted: 'Already formatted.',
  noteFormatted: 'Formatted.',
  noteFormatNeedsPython: 'Run this file once to load Python, then Format will work.',
  noteFormatFailed: 'Could not format this file.',

  // ---- Extensions view (sidebar: enable/disable built-in editor features) ----
  extensionsTitle: 'Extensions',
  extCategoryAppearance: 'Appearance',
  extCategoryFormatting: 'Formatting',
  extCategoryLearning: 'Learning',
  extBeginnerHelperName: 'Beginner Helper',
  extBeginnerHelperDesc:
    'Spot common beginner mistakes as you type — unmatched brackets, a missing colon, an unclosed quote — and explain each with a one-tap fix.',
  extRainbowBracketsName: 'Rainbow Brackets',
  extRainbowBracketsDesc:
    'Colour each pair of brackets by depth so you can see which closing bracket matches which opening one.',
  extIndentGuidesName: 'Indent Guides',
  extIndentGuidesDesc: 'Draw a thin line at each indentation level to keep blocks aligned as you read.',
  extIndentRainbowName: 'Indent Rainbow',
  extIndentRainbowDesc:
    'Tint each level of indentation in a rotating colour — useful for deeply nested code.',
  extFormatOnSaveName: 'Format on Save',
  extFormatOnSaveDesc:
    'Reformat the file automatically every time you save. Files it cannot format yet are skipped quietly.',
  /** Accessible label for a row's on/off switch. */
  extEnableLabel: (name: string) => `Enable ${name}`,
  noteGenerated: 'Generated.',
  noteGenerateExists: 'That code is already in this class.',
  noteGenerateNoClass: 'Put the cursor inside a class first.',
  noteGenerateSyntax: 'Fix the syntax errors first, then Generate.',
  noteGenerateFailed: 'Could not generate code for this file.',
  noteImageCopied: 'Image copied — paste it anywhere.',
  noteImageDownloaded: 'Image downloaded.',
  noteImageFailed: 'Could not create an image of this file.',
  noteFileDownloaded: (name: string) => `${name} downloaded.`,
  noteFileDownloadFailed: 'Could not download this file.',
  noteLinkTooBig: 'This project is too big to fit in a link — Export as .zip instead.',
  noteLinkCopied: 'Link copied — opening it recreates this project.',
  noteLinkCopyFailed: 'Warsha could not copy the link.',
  notePdfMaking: 'Making the PDF…',
  notePdfDownloaded: 'PDF downloaded.',
  notePdfFailed: 'Could not create the PDF.',
  noteProjectEmptied: 'Project emptied.',
  noteProjectNameTaken: 'You already have a project with that name.',
  noteProjectCreateFailed: 'Warsha could not create that project.',
  noteProjectDeleted: (name: string) => `“${name}” deleted.`,
  noteTemplateReady: (name: string, files: number) => `${name} ready — ${count(files, 'file')}.`,
  noteMigrated: (files: number) =>
    `Your ${count(files, 'file')} are now in a project you can name and switch between.`,
  noteMigrationKept:
    'Warsha could not finish moving your files into a project, so it left them exactly where they were.',
  /** Fallback project names, used when nothing has been named yet. */
  defaultSharedName: 'Shared project',
  defaultProjectName: 'Warsha project',

  // ---- the menu bar ----
  menuFile: 'File',
  menuNewFile: 'New File…',
  menuNewProject: 'New Project…',
  menuOpenRecent: 'Open Recent',
  menuImportZip: 'Import .zip…',
  menuExportZip: 'Export as .zip',
  menuShareLink: 'Share as link…',
  menuSharePdf: 'Share as PDF…',
  menuSaveAll: 'Save All',
  menuRenameProject: 'Rename Project…',
  menuEmptyProject: 'Empty Project…',
  menuDeleteProject: 'Delete Project…',
  menuEdit: 'Edit',
  menuUndo: 'Undo',
  menuRedo: 'Redo',
  menuFind: 'Find…',
  menuFindInFiles: 'Find in Files…',
  menuView: 'View',
  menuToggleExplorer: 'Toggle Explorer',
  menuToggleConsole: 'Toggle Console',
  menuBiggerText: 'Bigger Text',
  menuSmallerText: 'Smaller Text',
  menuZoomIn: 'Zoom In',
  menuZoomOut: 'Zoom Out',
  menuResetZoom: 'Reset Zoom',
  /** Names the edge Run would MOVE to (DESIGN-SPEC §5.3) — "left" stays
   *  literal in RTL too: the screen's left, whichever way the text runs. */
  menuRunOnLeft: 'Run Button on Left',
  menuRunOnRight: 'Run Button on Right',
  menuRun: 'Run',
  menuRunEntry: (entry: string) => `Run ${entry}`,
  menuStop: 'Stop',
  menuFormatFile: 'Format File',
  menuGenerate: 'Generate…',
  menuCut: 'Cut',
  menuCopy: 'Copy',
  menuPaste: 'Paste',
  menuSelectAll: 'Select All',
  menuExplain: (word: string) => `Explain '${word}'`,
  menuHelp: 'Help',
  menuAbout: 'About Warsha',
  menuCommandPalette: 'Command Palette…',
  menuViewScale: 'View scale',
  menuFormatFileRow: 'Format file',
  menuShareImage: 'Share as image…',
  menuShareProjectLink: 'Share project as link…',
  menuShareProjectPdf: 'Share project as PDF…',
  /** Marks the project you are already in, in Open Recent. */
  menuProjectOpenHint: 'Open',
  /** The language switch — a row per locale, each in its own language. */
  menuLanguage: 'Language',
  /** The drill menu's "go up one level" row. The chevron is drawn separately
   *  so it can mirror; this is the word only. */
  menuBack: 'Back',

  // ---- the command palette (Mod+Shift+P) ----
  // "Category: Command", VS Code's own shape, so the category is a search term.
  cmdCloseQuickInput: 'Close Quick Input',
  cmdCloseDrawer: 'Close File Drawer',
  cmdFileNewFile: 'File: New File…',
  cmdFileSaveAll: 'File: Save All',
  cmdFileFormat: 'File: Format Document',
  cmdFileShareImage: 'File: Share as Image…',
  cmdFileImport: 'File: Import .zip…',
  cmdFileCloseEditor: 'File: Close Editor',
  cmdEditFind: 'Edit: Find',
  cmdSearchInFiles: 'Search: Find in Files',
  cmdViewToggleSideBar: 'View: Toggle Primary Side Bar',
  cmdViewTogglePanel: 'View: Toggle Panel',
  cmdViewFocusExplorer: 'View: Focus Explorer',
  cmdViewNextEditor: 'View: Next Editor',
  cmdViewPrevEditor: 'View: Previous Editor',
  cmdViewBiggerText: 'View: Bigger Text',
  cmdViewSmallerText: 'View: Smaller Text',
  cmdViewZoomIn: 'View: Zoom In',
  cmdViewZoomOut: 'View: Zoom Out',
  cmdViewResetZoom: 'View: Reset Zoom',
  cmdViewPalette: 'View: Command Palette…',
  cmdRunFile: 'Run: Run File',
  cmdRunStop: 'Run: Stop',
  cmdGoToFile: 'Go: Go to File…',
  cmdGoToLine: 'Go: Go to Line/Column…',
  cmdProjectsOpenRecent: 'Projects: Open Recent…',
  cmdProjectsNew: 'Projects: New Project…',
  cmdProjectsRename: 'Projects: Rename Project…',
  cmdProjectsExport: 'Projects: Export as .zip',
  cmdProjectsShareLink: 'Projects: Share as Link',
  cmdProjectsSharePdf: 'Projects: Share as PDF',
  cmdProjectsEmpty: 'Projects: Empty Project…',
  cmdProjectsDelete: 'Projects: Delete Project…',
  cmdViewLanguage: 'View: Switch Language',
  cmdGenerate: 'Generate…',

  // ---- Generate… (Alt+Insert) ----
  // Menu wording tracks IntelliJ's Generate popup, where each term already exists.
  genMenuLabel: 'Generate',
  genConstructor: 'Constructor',
  genGetter: 'Getter',
  genSetter: 'Setter',
  genGetterSetter: 'Getter and Setter',
  genToString: 'toString()',
  genEqualsHashCode: 'equals() and hashCode()',
  genPyRepr: '__repr__()',
  genPyEq: '__eq__()',
  genCsConstructor: 'Constructor',
  genCsProperties: 'Auto-properties',
  /** The checkbox field-picker (shown when a class has more than one field). */
  genFieldsTitle: 'Choose fields',
  genFieldsIntro: (name: string) => `Fields from ${name} to include.`,
  genSelectAll: 'Select all',
  genGenerate: 'Generate',

  // ---- live collaboration (collab/, COLLAB-SYNC-CONTRACT) ----
  // Opt-in and quiet: there is no collab UI until the student starts it, and the
  // only standing indicator is the "Live" pill, which is also the way out.
  collabStart: 'Start collaboration',
  collabStop: 'Stop collaboration',
  /** The standing pill while a room is live; clicking it ends the session. */
  collabLive: 'Live',
  collabStarted: 'Collaboration on — the invite link is on your clipboard.',
  collabStopped: 'Collaboration ended.',
  collabStartFailed: 'Collaboration could not start.',
  /** Peer-presence toasts: someone else arrived / left this room. */
  collabJoined: (name: string) => `${name} joined the session.`,
  collabLeft: (name: string) => `${name} left the session.`,
  /** The pill while a joined room has no data yet (host offline / nothing persisted). */
  collabConnecting: 'Connecting…',
  /** Non-blocking notice after ~15s in a room with no data and no peers. */
  collabNobodyYet: 'Nobody here yet — keep this tab open; the project appears when the host connects.',
  /** The doc exceeds the sync size cap; local editing and live peers still work. */
  collabTooLarge: 'This project is too large to sync online — edits stay on this device and with connected peers.',
  /** The backend rejected our token — durable backup is off for this session. */
  collabAuthFailed: 'Online sync sign-in failed — changes are not being backed up to the server.',
  /** Placeholder name for a guest's project before the host's own name syncs in. */
  collabRoomName: 'Shared session',
  a11yCollab: 'Collaboration',
  /** The badge beside the Live pill when the local participant is a viewer. */
  collabViewOnly: 'View only',
  collabViewOnlyHint: 'The room owner shared this with you as a viewer — editing is off.',

  // ---- accounts (collab/auth.ts, §7.1) ----
  /** Account entry point in the Manage (gear) menu — label flips with sign-in state. */
  menuSignIn: 'Sign in…',
  menuAccount: 'Account',
  authSignInTitle: 'Sign in',
  authSignUpTitle: 'Create an account',
  authAccountTitle: 'Your account',
  authIntro: 'Sign in to raise your sync limits and share your work across devices.',
  authEmailLabel: 'Email',
  authPasswordLabel: 'Password',
  authPasswordHint: 'At least 8 characters.',
  authEmailInvalid: 'Enter a valid email address.',
  authPasswordWeak: 'Use at least 8 characters.',
  authPasswordRequired: 'Enter your password.',
  authSignInAction: 'Sign in',
  authSignUpAction: 'Create account',
  authWorking: 'Working…',
  authSwitchToSignUp: 'New here? Create an account',
  authSwitchToSignIn: 'Already have an account? Sign in',
  authErrorTaken: 'That email is already registered — sign in instead.',
  authErrorInvalid: 'Email or password is incorrect.',
  authErrorNetwork: 'Could not reach the server. Check your connection and try again.',
  authSignedIn: 'Signed in.',
  authSignedUp: 'Account created — you are signed in.',
  authSignedOut: 'Signed out.',
  /** Toast after login when anonymous docs are re-owned to the account. */
  authClaimed: (n: number) => (n === 1 ? '1 project moved to your account.' : `${n} projects moved to your account.`),
  authSignedInAs: 'Signed in as',
  authSignOut: 'Sign out',
  authUsageTitle: 'Usage',
  authUsageDocs: 'Projects',
  authUsageStorage: 'Storage',

  // ---- share dialog (components/ShareDialog.tsx, §7.2) ----
  /** The "Share room…" entry — enabled only while a room is live. */
  menuShareRoom: 'Share room…',
  shareTitle: 'Share this session',
  shareIntro: 'Choose who can open the invite link.',
  shareLinkAccessLabel: 'Link access',
  shareLinkEditor: 'Anyone with the link can edit',
  shareLinkEditorDesc: 'They join and edit the project with you.',
  shareLinkViewer: 'Anyone with the link can view',
  shareLinkViewerDesc: 'They can follow along, but not make changes.',
  shareLinkOff: 'Link off',
  shareLinkOffDesc: 'No new people can join with the link.',
  shareCopyLink: 'Copy link',
  shareLinkCopied: 'Invite link copied to your clipboard.',
  shareUpdated: 'Link access updated.',
  shareUpdateFailed: 'Could not update link access.',
  shareGuestNote: 'Copy the link to invite others. Only the session owner can change who may join.',
  shareEmailTitle: 'Invite people by email',
  shareComingSoon: 'Coming soon',
  shareEmailNote: 'Per-person sharing arrives in a later update.',

  // ---- tutorials (components/TutorialsPage.tsx, src/tutorials/) ----
  /** The rail/Home entry and the page heading. */
  tutorialsTitle: 'Tutorials',
  tutorialsSubtitle: 'Short, illustrated walkthroughs of everything you can do in Warsha.',
  tutorialsSearchPlaceholder: 'Search tutorials',
  tutorialsNoMatches: (q: string) => `No tutorials match “${q}”.`,
  /** "1 step" / "5 steps" — the count on a lesson card. */
  tutorialsSteps: (n: number) => (n === 1 ? '1 step' : `${n} steps`),
  /** Back from a lesson to the index. */
  tutorialsBackToAll: 'All tutorials',
  /** "Step 3 of 5" — Western digits. */
  tutorialsStepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  tutorialsPrev: 'Back',
  tutorialsNext: 'Next',
  tutorialsFinish: 'Finish',
  /** Open a lesson from its card. */
  tutorialsOpen: 'Open',
  a11yTutorials: 'Tutorials',
  a11yTutorialImage: 'Screenshot for this step',

  /**
   * Starter names and blurbs, by Template id (templates.ts).
   *
   * EMPTY ON PURPOSE — the English name/blurb already live next to each
   * starter in templates.ts; duplicating them here would give them two homes
   * to go stale. `ar.ts` fills this in; TemplatePicker falls back to
   * templates.ts for any id a locale hasn't covered.
   */
  templates: {} as Record<string, { name: string; blurb: string }>,
}

/** The contract `ar.ts` must satisfy — every key, same arity, same types. */
export type Bundle = typeof EN
