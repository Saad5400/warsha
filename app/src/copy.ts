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

  // ---- run lifecycle (§8) ----
  running: (entry: string) => `Running ${entry}…`,
  runOk: 'Finished. (exit code 0)',
  runFailed: (code: number) =>
    `Your program stopped early — exit code ${code}. The red lines above say why.`,
  runStopped: 'Stopped. Your files are all saved.',

  // ---- console (§8) ----
  stdinHint: 'Your program is waiting for something — type below and press Enter.',
  consoleEmpty: 'Output will appear here when you run your code.',
  /** PLACEHOLDER */
  editorEmpty: 'Pick a file from the explorer to start editing.',
  truncated: 'Earlier output hidden (5000-line limit).',
  /** PLACEHOLDER — for a line typed before the program asked for it. */
  stdinQueued: 'Saved — your program has not asked for input yet.',
  /** PLACEHOLDER — for typing with nothing running. */
  stdinIdle: 'Nothing is running yet. Tap Run first.',

  // ---- entry point ----
  /** PLACEHOLDER */
  noEntry:
    'Warsha could not find a place to start. Add a main.py, or a Java class with a main method, then tap Run.',
  /** PLACEHOLDER */
  cannotRun: (entry: string) => `Warsha does not know how to run ${entry} yet.`,

  // ---- storage (§8) ----
  storageLocal: 'Your files are saved in this browser on this device.',

  // ---- welcome (§7.7) ----
  welcomePurpose: 'Write and run Java or Python. In your browser, on your phone.',
  welcomeFirstRunNote:
    'First time you run, Warsha downloads the language you picked — about 38 MB for Java, less for Python. It happens once per device, then it works offline.',
  welcomeEmptyFolder: 'Start from an empty folder',
  welcomeImport: 'Import a .zip',
} as const
