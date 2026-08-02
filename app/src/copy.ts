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
  runtimeFirstRun: (lang: string, mb: number) =>
    `Getting ${lang} ready — this happens once (about ${mb} MB). Next time it starts instantly, even offline.`,
  runtimeNextInstant: 'Next time this is instant, even offline.',
  runtimeSlow: 'Still going — a big first download can take a minute on slow Wi-Fi.',
  runtimeKeepEditing: 'You can keep editing while this finishes.',
  /** PLACEHOLDER — Design to confirm the 60s escalation wording. */
  runtimeVerySlow: 'Still downloading. You can tap Stop and try again; the download picks up where it left off.',
  /** PLACEHOLDER — shown when the engine itself throws. */
  runtimeBroken: (detail: string) =>
    `Warsha could not start the language engine. Check your connection, then tap Run to try again. (${detail})`,

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
  /** The engine stopped answering — a worker the browser took away, usually memory. */
  engineLost: 'The language engine stopped responding, so Warsha shut it down.',
  engineLostHint: 'Your files are safe. Press Run to start a fresh one.',
  engineRetry: 'Try again',
  engineDetails: 'Details',
  /** Run went ahead on what is on screen because a save did not land. */
  runUnsaved:
    'Warsha could not save to this device, so it ran what is on screen. Export a .zip to keep a copy.',

  // ---- run lifecycle (§8) ----
  running: (entry: string) => `Running ${entry}…`,
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
  statusIdle: 'Ready when you are — press Run.',
  statusIdleShortcut: (shortcut: string) => `Ready when you are — press Run, or ${shortcut}.`,
  statusPreparing: 'Getting the language ready — the console will fill up shortly.',
  statusPreparingShort: 'Getting the language ready…',
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
  // pinned: CheerpJ is Java 8 only, Pyodide is CPython 3.14 (ARCHITECTURE §6).
  langJava: 'Java 8',
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

  // ---- storage (§8) ----
  storageLocal: 'Your files are saved in this browser on this device.',
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
  // "which language?" (the file extension answers that).
  welcomePurpose: 'Write and run Java or Python. In your browser, on your phone.',
  welcomeFirstRunNote:
    'First time you run, Warsha downloads the language you picked — about 38 MB for Java, less for Python. It happens once per device, then it works offline.',
  welcomeNewFile: 'New file',
  welcomeNewFileBlurb: 'One empty file, named by you. Warsha reads the language from the name.',
  welcomeNewFileManifest: '1 file · Main.java, main.py, anything',
  welcomeImport: 'Import a .zip',

  // ---- zip import / export ----
  importIntro: 'Pick a .zip of a project — one you exported from Warsha, or one a teacher gave you.',
  importDropHint: 'Drop a .zip here, or',
  importReplaces: (n: number) =>
    `This replaces the ${count(n, 'file')} you have now. Export a .zip first if you want to keep them.`,
  importNothingToReplace: 'Your project is empty, so nothing of yours gets replaced.',
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
