/**
 * Student-facing strings, in one place (DESIGN-SPEC §8).
 *
 * Tone rules that make these what they are: say what happened then what to do;
 * blame nobody; no "Error:" / "Invalid" / "Failed to"; no internals (no exit-code
 * jargon without a plain gloss); second person for what the student did, third
 * person for what the program did.
 *
 * Strings marked PLACEHOLDER are mine, awaiting Design's final wording.
 */
export const COPY = {
  // ---- runtime bootstrap (§7.6, §8) ----
  // One progress voice (founder ruling 2026-08-05): the console's ProgressBlock
  // is the only place system loading speaks — a phase headline, the bar, and a
  // line of numbers. This is its one auxiliary sentence, shown only while a
  // first-run download has gone on long enough to worry about (a cached engine
  // never lingers there). Nothing about loading is ever a transcript row.
  runtimeFirstRunNote: 'First-time download — next run starts instantly, even offline.',

  // ---- engine failures the student can act on (see useRunner's RunFailure) ----
  // Each is a headline plus one hint. The engine's own text is kept out of both:
  // "TypeError: Failed to fetch" told a student nothing and looked like their
  // fault. It is still shown, once, behind "Details".
  engineOffline: (lang: string) => `Warsha could not download ${lang}. It needs the internet the first time.`,
  engineOfflineHint:
    'Check your Wi-Fi and try again. On a school network this download is sometimes blocked — ask your teacher.',
  engineIsolation: 'This browser will not let Warsha run programs that ask you questions.',
  engineIsolationHint:
    'Reload the page once. If it still will not work, use Chrome on Android or on a computer.',
  engineBroken: (lang: string) => `Warsha could not start ${lang}.`,
  engineBrokenHint: 'Try again. If it keeps happening, reload the page.',
  /** The engine stopped answering — a worker the browser took away, usually
   * memory. A single red line in the transcript, no failure card: it is not the
   * student's fault and the one next step is to press Run. */
  engineLost: 'The language engine stopped responding, so Warsha shut it down.',
  engineRetry: 'Try again',
  engineDetails: 'Details',
  /** Run went ahead on what is on screen because a save did not land. */
  runUnsaved:
    'Warsha could not save to this device, so it ran what is on screen. Export a .zip to keep a copy.',

  // ---- run lifecycle (§8) ----
  // No "Running <entry>…" transcript row (founder ruling 2026-08-05): the status
  // line and pill already say the program is running, and system text in the
  // transcript is what students mistook for their program's own output.
  runOk: 'Finished. (exit code 0)',
  runFailed: (code: number) =>
    `Your program stopped early — exit code ${code}. The red lines above say why.`,
  runStopped: 'Stopped. Your files are all saved.',

  // ---- console (§8) ----
  // "type below" was true when the console had an input bar under the transcript.
  // The cursor is now in the transcript, at the end of the output, so the sentence
  // points at the answer rather than at a place on the screen.
  stdinHint: 'Your program is waiting for something — type your answer and press Enter.',
  /** The same message, short enough for one line on a 390px phone. */
  stdinHintShort: 'Waiting for you — type your answer, then Enter.',
  consoleEmpty: 'Output will appear here when you run your code.',
  consoleCleared: 'Cleared.',

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
  // The live line's placeholder, and the ONLY one left: there is no idle input to
  // put an idle placeholder in, and no type-ahead bar to invite typing early.
  // Asserted verbatim by verify.mjs, verify-java.mjs and console-check.mjs.
  stdinWaitingPlaceholder: 'Type your answer, then press Enter',

  // ---- console status line: the current state, in words (§7.3 states) ----
  // No 'preparing' sentence, on purpose: while the engine loads, the transcript's
  // ProgressBlock is the one progress voice (founder ruling 2026-08-05) and the
  // status line keeps only its pulsing glyph.
  statusIdle: 'Ready when you are — press Run.',
  statusIdleShortcut: (shortcut: string) => `Ready when you are — press Run, or ${shortcut}.`,
  statusRunning: 'Your program is running.',
  statusOk: 'Finished — exit code 0.',
  statusFailed: (code: number) => `Stopped early — exit code ${code}. The red lines say why.`,
  statusFailedShort: (code: number) => `Stopped early — exit code ${code}.`,
  statusFailedNoCode: 'Stopped early — the red lines say why.',
  statusStopped: 'You stopped it. Your files are saved.',

  // ---- transcript controls ----
  copyOutput: 'Copy output',
  copyOutputDone: 'Copied',
  copyOutputFailed: 'Could not copy — select the text instead.',
  clearOutput: 'Clear output',
  newLines: (n: number) => `${n > 999 ? '999+' : n} new line${n === 1 ? '' : 's'}`,
  jumpToLatest: 'Jump to latest',
  showEarlier: (n: number) => `Show ${n.toLocaleString('en')} earlier lines`,

  // ---- status bar (LAYOUT-VSCODE §3) ----
  // The version is part of the label because it is the answer to the question a
  // student actually has ("which Java is this?") and because both engines are
  // pinned: CheerpJ runs Java 17, Pyodide is CPython 3.14 (ARCHITECTURE §6).
  langJava: 'Java 17',
  langPython: 'Python 3.14',
  langPlain: 'Plain text',
  /** Nothing is open, so there is no language to name. */
  langNone: 'No file',
  statusBarNoEntry: 'No entry point',
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
  // Warsha opens straight into the workspace. When the project is empty, the
  // editor area carries this instead of a blank canvas — so a starter is an
  // action inside the IDE, never a gate in front of it, and the app never asks
  // "which language?" (the file extension answers that). The starter is the
  // primary way in (founder ruling 2026-08-05): "New file" and "Import a .zip"
  // are quiet secondary actions wherever the empty project offers them.
  welcomeNewFile: 'New file',
  welcomeNewProject: 'New from a starter',
  welcomeNewProjectBlurb: 'Pick a language, then a starter for your level.',
  welcomeImport: 'Import a .zip',

  // ---- the New-project template picker (languages.ts + TemplatePicker) ----
  // One entry point for every starter, so the project menu holds a single "New
  // project…" however many languages Warsha grows to. Step one is the language;
  // step two is that language's starters, grouped beginner → advanced.
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
  // The control is icon-only, so this string is its accessible name and its
  // tooltip both. "Install Warsha", not "Install app": the student is looking at
  // a title bar with two other unlabelled glyphs in it, and the product name is
  // what tells them which app is being offered.
  installAction: 'Install Warsha',
  /**
   * iOS and iPadOS only, where no button can ever work — Safari's WebKit fires
   * no install event, so the Share sheet is the whole mechanism and naming it is
   * all we can do. Says what it gets them, not just what to tap.
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
} as const

/** "1 file" / "3 files" — a plural, not a "file(s)". */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}
