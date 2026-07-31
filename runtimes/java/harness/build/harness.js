// src/bootstrap.generated.ts
var BOOTSTRAP_SOURCES = {
  "Bridge.java": 'package warsha;\n\nimport java.io.IOException;\nimport java.io.InputStream;\nimport java.io.OutputStream;\nimport java.io.PrintStream;\nimport java.io.UnsupportedEncodingException;\n\n/**\n * The JS <-> Java bridge. Every native here is implemented in jvm.worker.js as\n * Java_warsha_Bridge_<name>; CheerpJ awaits async natives, so a native that\n * returns a pending promise genuinely parks the Java thread.\n *\n * Nothing in this class may call System.exit(). One CheerpJ JVM serves many\n * runs (the worker is reused), and exiting it would strand every later run in\n * the same session. Status is reported through natives instead.\n */\npublic class Bridge {\n\n    /** Blocks until the UI submits a line. Returns null for EOF. */\n    public static native String readLine();\n\n    /** Program output. One call per write, no buffering -- see installStdout. */\n    public static native void writeOut(String s);\n\n    public static native void writeErr(String s);\n\n    /**\n     * Compiler output. A separate channel from writeErr so the runtime can\n     * rewrite compiler paths without touching anything the program printed.\n     */\n    public static native void writeDiag(String s);\n\n    /**\n     * Terminal status of a bootstrap phase. `phase` is "compile" or "run",\n     * `code` is "0" for success or a non-zero exit code. Reported through a\n     * native rather than a process exit code, because a real exit would kill\n     * the shared JVM.\n     */\n    public static native void phaseDone(String phase, String code);\n\n    public static void installStdin() {\n        System.setIn(new InputStream() {\n            private byte[] buf = new byte[0];\n            private int pos = 0;\n            private boolean eof = false;\n\n            /** True if a byte is available; false at end of input. */\n            private boolean fill() throws IOException {\n                while (pos >= buf.length) {\n                    if (eof) return false;\n                    String line = readLine();\n                    if (line == null) {\n                        eof = true;\n                        return false;\n                    }\n                    buf = (line + "\\n").getBytes("UTF-8");\n                    pos = 0;\n                }\n                return true;\n            }\n\n            @Override\n            public int read() throws IOException {\n                if (!fill()) return -1;\n                return buf[pos++] & 0xFF;\n            }\n\n            /**\n             * MUST be overridden. InputStream\'s default bulk read loops on\n             * read() until it has len bytes or hits EOF, so Scanner\'s 1024-byte\n             * request would keep asking the student for more lines and the\n             * program would never advance past its first prompt. Returning only\n             * what is already buffered is the real console semantic.\n             */\n            @Override\n            public int read(byte[] b, int off, int len) throws IOException {\n                if (len == 0) return 0;\n                if (!fill()) return -1;\n                int n = Math.min(len, buf.length - pos);\n                System.arraycopy(buf, pos, b, off, n);\n                pos += n;\n                return n;\n            }\n\n            @Override\n            public int available() {\n                return buf.length - pos;\n            }\n        });\n    }\n\n    /**\n     * A worker has no DOM, so CheerpJ\'s #console element trick is unavailable.\n     * Re-pointing the streams at natives is better anyway: it gives real\n     * out/err separation and lets us control flushing precisely.\n     */\n    public static void installStdout() throws UnsupportedEncodingException {\n        System.setOut(new PrintStream(new NativeOut(false), true, "UTF-8"));\n        System.setErr(new PrintStream(new NativeOut(true), true, "UTF-8"));\n    }\n\n    /**\n     * Unbuffered on purpose, and load-bearing for the acceptance criterion that\n     * a student sees `System.out.print("Name: ")` before the following\n     * nextLine() blocks. PrintStream\'s autoflush only triggers on a newline, so\n     * a partial-line prompt would otherwise sit in the buffer until the next\n     * println -- which usually arrives after the read has already returned, and\n     * the student types blind.\n     *\n     * If anyone ever wraps this in a BufferedOutputStream for throughput, they\n     * must flush before every blocking read or that criterion regresses\n     * silently. The harness has a test for exactly this.\n     */\n    private static final class NativeOut extends OutputStream {\n        private final boolean err;\n        /** Bytes of a multi-byte character that has not arrived in full yet. */\n        private byte[] partial = new byte[0];\n\n        NativeOut(boolean err) {\n            this.err = err;\n        }\n\n        /**\n         * PrintStream reaches this only for a raw System.out.write(int); text\n         * goes through the byte-array path below. A single byte of a multi-byte\n         * character cannot be decoded on its own, so hold it until the sequence\n         * completes rather than emitting a replacement character.\n         */\n        @Override\n        public void write(int b) {\n            byte[] next = new byte[partial.length + 1];\n            System.arraycopy(partial, 0, next, 0, partial.length);\n            next[partial.length] = (byte) b;\n            int hold = incompleteTail(next, next.length);\n            emit(next, 0, next.length - hold);\n            partial = new byte[hold];\n            System.arraycopy(next, next.length - hold, partial, 0, hold);\n        }\n\n        /**\n         * OutputStreamWriter never splits one character across two calls, so\n         * whatever arrives here decodes cleanly on its own.\n         */\n        @Override\n        public void write(byte[] b, int off, int len) {\n            if (len == 0) return;\n            if (partial.length > 0) {\n                write(b[off] & 0xFF);\n                off++;\n                len--;\n                if (len == 0) return;\n            }\n            emit(b, off, len);\n        }\n\n        private void emit(byte[] b, int off, int len) {\n            if (len <= 0) return;\n            String s;\n            try {\n                s = new String(b, off, len, "UTF-8");\n            } catch (UnsupportedEncodingException e) {\n                s = new String(b, off, len);\n            }\n            if (s.isEmpty()) return;\n            if (err) writeErr(s);\n            else writeOut(s);\n        }\n\n        /** Length of the trailing bytes that form a started-but-unfinished character. */\n        private static int incompleteTail(byte[] b, int len) {\n            // Walk back over continuation bytes (10xxxxxx) to the lead byte.\n            int i = len - 1;\n            int continuations = 0;\n            while (i >= 0 && (b[i] & 0xC0) == 0x80) {\n                continuations++;\n                i--;\n            }\n            if (i < 0) return 0; // all continuations: not something we produced\n            int lead = b[i] & 0xFF;\n            int expected;\n            if (lead < 0x80) expected = 1;\n            else if ((lead & 0xE0) == 0xC0) expected = 2;\n            else if ((lead & 0xF0) == 0xE0) expected = 3;\n            else if ((lead & 0xF8) == 0xF0) expected = 4;\n            else return 0; // invalid lead byte; let the decoder deal with it\n            int have = continuations + 1;\n            return have < expected ? have : 0;\n        }\n    }\n}\n',
  "Build.java": `package warsha;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.eclipse.jdt.core.compiler.batch.BatchCompiler;

/**
 * Stages the student's sources and compiles them.
 *
 * Two constraints of CheerpJ's filesystem shape this class (SPIKE.md \xA74):
 *
 *  1. /str/ -- the only mount JS can write -- is a FLAT namespace. Writing
 *     "/str/models/Person.java" appears to succeed but Java cannot open it, and
 *     writing everything flat breaks the moment a project has models/Item.java
 *     and app/Item.java. So JS writes each source under an opaque unique name
 *     and lists the real relative paths in a manifest; this class replays that
 *     manifest into a real directory tree under /files/, which Java *can* mkdir.
 *
 *  2. The compiler will not create its own -d directory, and /files/ is
 *     read-only from JS. Only Java can prepare it, which is the other half of
 *     why this class exists.
 *
 * The tree is per-run (/files/warsha-run-<runId>/) rather than a fixed path that gets
 * wiped. IndexedDB backs /files/, so a stale .class from an earlier run can
 * make a broken project look like it still works; a fresh directory makes that
 * structurally impossible instead of relying on a delete that we would have to
 * trust. Older run directories are removed on a best-effort basis afterwards.
 *
 * Never calls System.exit -- see Bridge.
 */
public class Build {

    /**
     * Where a run's staged sources and .class output live.
     *
     * The prefix is deliberately distinctive. /files/ is shared with anything
     * else Warsha may one day persist there, and gcOldRuns deletes directories
     * it believes are old runs -- a loose prefix like "r" would happily eat a
     * future /files/results.
     */
    private static final String RUN_PREFIX = "warsha-run-";

    /** Matches exactly what runDir produces, and nothing else. */
    private static final Pattern RUN_DIR = Pattern.compile("^" + RUN_PREFIX + "[A-Za-z0-9]+$");

    static File runDir(String runId) {
        return new File("/files/" + RUN_PREFIX + runId);
    }

    static File srcDir(String runId) {
        return new File(runDir(runId), "src");
    }

    static File outDir(String runId) {
        return new File(runDir(runId), "out");
    }

    /** Written by this class, read by Launcher: the entry's fully-qualified name. */
    static File mainClassFile(String runId) {
        return new File(runDir(runId), "main.txt");
    }

    public static void main(String[] args) {
        String runId = args[0];
        String entryPath = args[1];
        try {
            Bridge.phaseDone("compile", String.valueOf(build(runId, entryPath)));
        } catch (Throwable t) {
            // A failure here is ours, not the student's; label it as such.
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            Bridge.writeDiag("warsha: internal build failure\\n" + sw);
            Bridge.phaseDone("compile", "70");
        }
    }

    /** Returns 0 on success, 1 if the student's code did not compile. */
    private static int build(String runId, String entryPath) throws IOException {
        gcOldRuns(runId);

        File src = srcDir(runId);
        File out = outDir(runId);
        if (!src.mkdirs() && !src.isDirectory()) throw new IOException("cannot create " + src);
        if (!out.mkdirs() && !out.isDirectory()) throw new IOException("cannot create " + out);

        List<String[]> manifest = readManifest(runId);
        List<String> sourcePaths = new ArrayList<String>();
        String entrySource = null;

        for (String[] entry : manifest) {
            String flatName = entry[0];
            String relativePath = entry[1];
            String content = readAll(new File("/str/" + flatName));

            File target = new File(src, relativePath);
            File parent = target.getParentFile();
            if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                throw new IOException("cannot create " + parent);
            }
            writeAll(target, content);
            sourcePaths.add(target.getPath());

            if (relativePath.equals(entryPath)) entrySource = content;
        }

        if (entrySource == null) throw new IOException("entry " + entryPath + " not in the manifest");
        writeAll(mainClassFile(runId), mainClassOf(entryPath, entrySource));

        return compile(sourcePaths, out) ? 0 : 1;
    }

    /**
     * Invokes ECJ through its documented programmatic entry point rather than
     * its main(). Going through main() means diagnostics land on the JS console
     * (a worker has no #console element for CheerpJ to write into), which then
     * has to be scraped and de-noised. Here the diagnostics come back in a
     * writer we own, and CheerpJ's own console chatter stays where it is.
     */
    private static boolean compile(List<String> sourcePaths, File out) {
        List<String> argv = new ArrayList<String>(sourcePaths);
        argv.add("-d");
        argv.add(out.getPath());
        argv.add("-1.8");           // CheerpJ's runtime is Java 8; see INTEGRATION.md
        argv.add("-g");             // buys no line numbers under CheerpJ, but is correct
        argv.add("-encoding");
        argv.add("UTF-8");
        argv.add("-proc:none");     // no annotation processing
        argv.add("-nowarn");        // beginners do not need ECJ's warnings

        StringWriter outText = new StringWriter();
        StringWriter errText = new StringWriter();
        PrintWriter outWriter = new PrintWriter(outText);
        PrintWriter errWriter = new PrintWriter(errText);

        boolean ok = BatchCompiler.compile(
                argv.toArray(new String[argv.size()]), outWriter, errWriter, null);

        outWriter.flush();
        errWriter.flush();
        String diagnostics = errText.toString();
        if (diagnostics.isEmpty()) diagnostics = outText.toString();
        if (!diagnostics.isEmpty()) Bridge.writeDiag(diagnostics);
        return ok;
    }

    // --- the entry class's real name -----------------------------------------

    private static final Pattern PACKAGE =
            Pattern.compile("^\\\\s*package\\\\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\\\\s*\\\\.\\\\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\\\\s*;",
                    Pattern.MULTILINE);

    /**
     * "app/Main.java" + "package app;" -> "app.Main".
     *
     * Derived from the package declaration rather than from the directory,
     * because the two need not agree: the compiler only insists that a public
     * class match its *file name*. A student whose file sits at the project
     * root with \`package app;\` at the top still gets a class the launcher can
     * find.
     */
    static String mainClassOf(String entryPath, String source) {
        String fileName = entryPath;
        int slash = fileName.lastIndexOf('/');
        if (slash >= 0) fileName = fileName.substring(slash + 1);
        if (fileName.endsWith(".java")) fileName = fileName.substring(0, fileName.length() - 5);

        Matcher m = PACKAGE.matcher(stripComments(source));
        if (!m.find()) return fileName;
        return m.group(1).replaceAll("\\\\s+", "") + "." + fileName;
    }

    /** Enough comment stripping that a commented-out package line is ignored. */
    private static String stripComments(String source) {
        StringBuilder sb = new StringBuilder(source.length());
        int i = 0;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '/' && i + 1 < source.length() && source.charAt(i + 1) == '/') {
                while (i < source.length() && source.charAt(i) != '\\n') i++;
            } else if (c == '/' && i + 1 < source.length() && source.charAt(i + 1) == '*') {
                i += 2;
                while (i + 1 < source.length() && !(source.charAt(i) == '*' && source.charAt(i + 1) == '/')) i++;
                i = Math.min(i + 2, source.length());
                sb.append(' ');
            } else {
                sb.append(c);
                i++;
            }
        }
        return sb.toString();
    }

    // --- manifest -------------------------------------------------------------

    /** Lines of "<flat name in /str/>\\t<relative path in the project>". */
    private static List<String[]> readManifest(String runId) throws IOException {
        String text = readAll(new File("/str/warsha-manifest-" + runId + ".tsv"));
        List<String[]> entries = new ArrayList<String[]>();
        for (String line : text.split("\\n")) {
            if (line.isEmpty()) continue;
            int tab = line.indexOf('\\t');
            if (tab < 0) throw new IOException("malformed manifest line: " + line);
            entries.add(new String[] { line.substring(0, tab), line.substring(tab + 1) });
        }
        if (entries.isEmpty()) throw new IOException("empty manifest");
        return entries;
    }

    // --- filesystem helpers ---------------------------------------------------

    private static String readAll(File file) throws IOException {
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(new java.io.FileInputStream(file), "UTF-8"));
        try {
            StringBuilder sb = new StringBuilder();
            char[] chunk = new char[8192];
            int n;
            while ((n = reader.read(chunk)) > 0) sb.append(chunk, 0, n);
            return sb.toString();
        } finally {
            reader.close();
        }
    }

    private static void writeAll(File file, String content) throws IOException {
        FileOutputStream stream = new FileOutputStream(file);
        try {
            stream.write(content.getBytes("UTF-8"));
        } finally {
            stream.close();
        }
    }

    /**
     * Best effort: /files/ is IndexedDB-backed and persists across sessions, so
     * without this every run a student ever makes would accumulate there. A
     * failure to delete is not fatal -- correctness comes from the fresh
     * per-run directory, not from the cleanup.
     *
     * Whether delete() even works on CheerpJ's IndexedDB mount is not something
     * the spike established, so the outcome is printed. During Build,
     * System.out is still CheerpJ's own console (only Launcher redirects the
     * streams), which the worker forwards on its internal channel -- so this
     * line never reaches a student, and the harness can assert on it.
     */
    private static void gcOldRuns(String runId) {
        File[] children = new File("/files").listFiles();
        if (children == null) {
            System.out.println("warsha-gc: cannot list /files");
            return;
        }
        String keep = runDir(runId).getName();
        int deleted = 0;
        int failed = 0;
        for (File child : children) {
            String name = child.getName();
            if (name.equals(keep) || !RUN_DIR.matcher(name).matches()) continue;
            deleteTree(child);
            if (child.exists()) failed++;
            else deleted++;
        }
        System.out.println("warsha-gc: deleted=" + deleted + " failed=" + failed);
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }
}
`,
  "Launcher.java": `package warsha;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * Runs the student's main method and reports what happened.
 *
 * Never calls System.exit: one CheerpJ JVM serves every run in a session, so
 * exiting would strand all later runs. The exit status goes out through
 * Bridge.phaseDone instead.
 */
public class Launcher {

    public static void main(String[] args) {
        String runId = args[0];
        String[] programArgs = new String[Math.max(0, args.length - 1)];
        if (args.length > 1) System.arraycopy(args, 1, programArgs, 0, programArgs.length);

        int status = 0;
        try {
            Bridge.installStdout();
            Bridge.installStdin();
        } catch (Throwable t) {
            Bridge.writeDiag("warsha: could not install the console streams: " + t);
            Bridge.phaseDone("run", "70");
            return;
        }

        try {
            String mainClass = readMainClass(runId);
            Method main = Class.forName(mainClass).getMethod("main", String[].class);
            try {
                main.invoke(null, (Object) programArgs);
            } catch (InvocationTargetException e) {
                Throwable cause = e.getCause() == null ? e : e.getCause();
                System.err.print(render(cause));
                status = 1;
            }
        } catch (ClassNotFoundException e) {
            System.err.println("Error: could not find or load main class " + e.getMessage());
            status = 1;
        } catch (NoSuchMethodException e) {
            System.err.println("Error: no main method found. A Java program starts with:");
            System.err.println("    public static void main(String[] args)");
            status = 1;
        } catch (Throwable t) {
            System.err.print(render(t));
            status = 1;
        }

        System.out.flush();
        System.err.flush();
        Bridge.phaseDone("run", String.valueOf(status));
    }

    private static String readMainClass(String runId) throws java.io.IOException {
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(new FileInputStream(Build.mainClassFile(runId)), "UTF-8"));
        try {
            String line = reader.readLine();
            if (line == null || line.trim().isEmpty()) throw new java.io.IOException("no main class recorded");
            return line.trim();
        } finally {
            reader.close();
        }
    }

    // --- stack trace rendering ------------------------------------------------

    /**
     * Frames that are ours or the reflection plumbing we use to reach main().
     * Launcher invokes the student's main reflectively, so every uncaught
     * exception arrives with four frames the student cannot act on: three
     * reflection frames and warsha.Launcher itself. Switching to a
     * URLClassLoader would not help -- reaching main() still needs reflection --
     * so they get filtered rather than eliminated.
     */
    private static boolean isInfrastructure(String className) {
        return className.startsWith("warsha.")
                || className.startsWith("sun.reflect.")
                || className.startsWith("jdk.internal.reflect.")
                || className.startsWith("java.lang.reflect.");
    }

    /** Runtime library classes: kept when they sit above student code, never below it. */
    private static boolean isPlatform(String className) {
        return className.startsWith("java.")
                || className.startsWith("javax.")
                || className.startsWith("sun.")
                || className.startsWith("com.sun.")
                || className.startsWith("jdk.");
    }

    /**
     * Formats a throwable the way the student needs to read it.
     *
     * CheerpJ's stack walker reports no file and no line for any frame
     * (getFileName() == null, getLineNumber() == 0, regardless of -g), so
     * pretending otherwise would be a lie. Each frame is labelled
     * "(line unknown)" instead of the usual "(Main.java:12)".
     */
    static String render(Throwable t) {
        StringBuilder sb = new StringBuilder();
        renderInto(sb, t, "", new IdentityHashMap<Throwable, Boolean>());
        return sb.toString();
    }

    private static void renderInto(StringBuilder sb, Throwable t, String prefix,
                                   Map<Throwable, Boolean> seen) {
        if (t == null || seen.containsKey(t)) return;
        seen.put(t, Boolean.TRUE);

        // Throwable.toString() is already right: "java.lang.ArithmeticException"
        // with no trailing ": null" when the message is absent, which is the
        // common case here because CheerpJ omits implicit messages such as
        // "/ by zero".
        sb.append(prefix).append(t.toString()).append('\\n');

        for (StackTraceElement frame : studentFrames(t.getStackTrace())) {
            sb.append("\\tat ").append(frame.getClassName()).append('.')
              .append(frame.getMethodName()).append(" (line unknown)").append('\\n');
        }

        Throwable cause = t.getCause();
        if (cause != null && cause != t) renderInto(sb, cause, "Caused by: ", seen);
    }

    /**
     * Drops infrastructure frames, then everything below the deepest frame that
     * is actually the student's. Platform frames above student code survive --
     * "at java.lang.Integer.parseInt" is the useful part of a bad-input crash.
     */
    static List<StackTraceElement> studentFrames(StackTraceElement[] frames) {
        List<StackTraceElement> kept = new ArrayList<StackTraceElement>();
        for (StackTraceElement frame : frames) {
            if (!isInfrastructure(frame.getClassName())) kept.add(frame);
        }
        int lastStudent = -1;
        for (int i = 0; i < kept.size(); i++) {
            if (!isPlatform(kept.get(i).getClassName())) lastStudent = i;
        }
        // No student frame at all (a crash entirely inside the library): keep
        // what is left rather than showing an exception with no location.
        if (lastStudent < 0) return kept;
        return kept.subList(0, lastStudent + 1);
    }
}
`
};

// src/javaRuntime.ts
var JavaRuntime = class {
  id = "java";
  /** Language level students get. Fixed by CheerpJ's Java 8 runtime. */
  javaVersion = "1.8";
  workerUrl;
  compilerJarPath;
  cdnBase;
  onInternalLog;
  worker = null;
  /** In-flight or settled boot of the current worker. null = no worker yet. */
  booting = null;
  bootSettle = null;
  progressListeners = /* @__PURE__ */ new Set();
  lastProgress = null;
  active = null;
  runCounter = 0;
  /** A run() that has been accepted but has not reached the worker yet. */
  starting = false;
  /**
   * True when the JVM in this worker can no longer be trusted -- the student's
   * own code called System.exit(), which takes the shared JVM down with it. The
   * next run() replaces the worker first.
   */
  tainted = false;
  /** Timings of the most recent run, for diagnostics and the harness. */
  lastRun = null;
  /** Timings of the most recent engine boot. */
  lastBoot = null;
  constructor(options = {}) {
    this.workerUrl = String(options.workerUrl ?? DEFAULT_WORKER_URL);
    this.compilerJarPath = options.compilerJarPath ?? "/app/ecj.jar";
    this.cdnBase = options.cdnBase;
    this.onInternalLog = options.onInternalLog;
  }
  /**
   * Start the JVM and warm the compiler. Idempotent: concurrent and repeated
   * calls share one boot, and calling it when already warm resolves
   * immediately. Every caller gets the progress of whichever boot is in flight,
   * including the silent respawn started by `kill()`.
   */
  async load(onProgress) {
    this.progressListeners.add(onProgress);
    if (this.booting && this.lastProgress) onProgress(this.lastProgress);
    const boot = this.booting ?? (this.booting = this.spawn());
    try {
      await boot;
    } catch (error) {
      if (this.booting === boot) this.booting = null;
      throw error;
    } finally {
      this.progressListeners.delete(onProgress);
    }
  }
  async run(files, entryPath, io2) {
    if (this.starting || this.active && !this.active.ended) {
      throw new Error("A Java program is already running; kill() it before running another.");
    }
    this.starting = true;
    try {
      return await this.startRun(files, entryPath, io2);
    } finally {
      this.starting = false;
    }
  }
  async startRun(files, entryPath, io2) {
    const entry = normalizePath(entryPath);
    const payload = files.map((file) => ({ path: normalizePath(file.path), content: file.content }));
    if (!payload.some((file) => file.path === entry)) {
      throw new Error(`Entry file ${entryPath} is not in the file set.`);
    }
    if (!entry.endsWith(".java")) {
      throw new Error(`Entry file ${entryPath} is not a .java file.`);
    }
    const sources = payload.filter((file) => file.path.endsWith(".java"));
    if (this.tainted) this.replaceWorker();
    await this.load(() => {
    });
    const worker = this.worker;
    if (!worker) throw new Error("Java runtime is not ready.");
    const runId = `${Date.now().toString(36)}${(this.runCounter++).toString(36)}`;
    const active = { io: io2, runId, ended: false, awaitingStdin: false };
    this.active = active;
    this.lastRun = null;
    worker.postMessage({ type: "run", runId, files: sources, entryPath: entry });
    const session2 = {
      kill: () => this.killSession(active),
      writeStdin: (line) => this.writeStdin(active, line),
      writeEof: () => this.writeEof(active)
    };
    return session2;
  }
  /**
   * Give up this runtime's JVM for good: the page is closing, or the shell is
   * switching to another language.
   *
   * A live session is reported as killed first, then the worker is terminated
   * WITHOUT a replacement -- unlike kill(), which respawns because the student is
   * expected to press Run again. Respawning here would leave a fresh JVM booting
   * behind a runtime nobody is using. A later load() or run() spawns one again.
   */
  dispose() {
    this.finish(null);
    this.teardown();
  }
  // --- worker lifecycle -----------------------------------------------------
  spawn() {
    this.lastProgress = null;
    this.tainted = false;
    const worker = new Worker(this.workerUrl);
    this.worker = worker;
    worker.onmessage = (event) => {
      if (this.worker === worker) this.onMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      const text = event.message || `worker failed to start from ${this.workerUrl} (no message; check the console). It must be reachable and served as JavaScript.`;
      this.failBoot(new Error(text));
      this.finish(1, text);
    };
    const promise = new Promise((resolve, reject) => {
      this.bootSettle = { resolve, reject };
    });
    worker.postMessage({
      type: "init",
      compilerJarPath: this.compilerJarPath,
      cdnBase: this.cdnBase,
      bootstrapSources: BOOTSTRAP_SOURCES
    });
    return promise;
  }
  onMessage(message) {
    switch (message.type) {
      case "progress": {
        const report2 = {
          phase: message.phase,
          message: message.message,
          loaded: message.loaded,
          total: message.total
        };
        this.lastProgress = report2;
        for (const listener of this.progressListeners) listener(report2);
        return;
      }
      case "ready":
        this.lastBoot = { initMs: message.initMs, warmMs: message.warmMs };
        this.lastProgress = null;
        this.bootSettle?.resolve();
        this.bootSettle = null;
        return;
      case "stdout":
        this.active?.io.onStdout(message.text);
        return;
      case "stderr":
        this.active?.io.onStderr(message.text);
        return;
      case "diag":
        this.active?.io.onStderr(studentPaths(message.text, this.active.runId));
        return;
      case "stdin-request":
        if (this.active && !this.active.ended) {
          this.active.awaitingStdin = true;
          this.active.io.onStdinRequest();
        }
        return;
      case "compile-failed":
        this.lastRun = { compileMs: message.compileMs, runMs: 0 };
        this.finish(message.code === 0 ? 1 : message.code);
        return;
      case "done":
        this.lastRun = { compileMs: message.compileMs, runMs: message.runMs };
        if (message.tainted) this.tainted = true;
        this.finish(message.exit);
        return;
      case "fatal":
        if (message.duringBoot) {
          this.failBoot(new Error(message.text));
          this.finish(1, message.text);
          return;
        }
        this.tainted = true;
        this.finish(1, `
[java runtime error] ${message.text}
`);
        return;
      case "internal":
        this.onInternalLog?.({ level: message.level, text: message.text, noise: message.noise });
        return;
    }
  }
  failBoot(error) {
    const settle2 = this.bootSettle;
    this.bootSettle = null;
    this.booting = null;
    this.worker?.terminate();
    this.worker = null;
    settle2?.reject(error);
  }
  teardown() {
    this.worker?.terminate();
    this.worker = null;
    this.booting = null;
    this.bootSettle = null;
    this.active = null;
  }
  /** Throw away the current JVM and start a fresh one booting immediately. */
  replaceWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.bootSettle = null;
    this.booting = this.spawn();
    this.booting.catch(() => {
    });
  }
  /** End the current session exactly once. `code` null means killed. */
  finish(code, stderrNote) {
    const active = this.active;
    if (!active || active.ended) return;
    active.ended = true;
    active.awaitingStdin = false;
    this.active = null;
    if (stderrNote) active.io.onStderr(stderrNote);
    active.io.onExit(code);
  }
  // --- session operations ---------------------------------------------------
  killSession(active) {
    if (active.ended) return;
    this.finish(null);
    this.replaceWorker();
  }
  writeStdin(active, line) {
    if (active.ended || !active.awaitingStdin) return;
    active.awaitingStdin = false;
    this.worker?.postMessage({ type: "stdin", line: line.replace(/\r?\n$/, "") });
  }
  writeEof(active) {
    if (active.ended || !active.awaitingStdin) return;
    active.awaitingStdin = false;
    this.worker?.postMessage({ type: "stdin", line: null });
  }
};
var DEFAULT_WORKER_URL = new URL("./jvm.worker.js", import.meta.url).href;
function studentPaths(text, runId) {
  return text.split(`/files/warsha-run-${runId}/src/`).join("").replace(/\/files\/warsha-run-[A-Za-z0-9]+\/src\//g, "").replace(/\/str\//g, "");
}
function normalizePath(path) {
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.some((part) => part === "..")) throw new Error(`Unsupported file path: ${path}`);
  return parts.join("/");
}

// harness/programs.js
var PROGRAMS = {
  // (b) Education's prompt-before-read criteria: a partial line with NO trailing
  // newline, immediately followed by a blocking read, three times, one of them a
  // token read (nextInt) and one built from three separate print calls.
  prompt: {
    label: "prompt then read (x3)",
    entry: "app/Prompt.java",
    files: [
      {
        path: "app/Prompt.java",
        content: `package app;

import java.util.Scanner;

public class Prompt {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);

        // 1. partial line must be on screen BEFORE the read blocks
        System.out.print("Name: ");
        String name = input.nextLine();
        System.out.println("[echo] you typed: " + name);

        // 2. token-based read rather than a whole line
        System.out.print("Age: ");
        int age = input.nextInt();
        input.nextLine(); // consume the rest of the line
        System.out.println("[echo] age parsed as int: " + age);

        // 3. prompt, read and answer all on one visual line
        System.out.print("City: ");
        String city = input.nextLine();
        System.out.print("[echo] ");
        System.out.print(city);
        System.out.println(" <- three separate print calls, no newline until here");

        System.out.println("PROMPT-TEST-OK " + name + "/" + age + "/" + city);
    }
}
`
      }
    ]
  },
  // (c) The same class name in two packages. Impossible to compile if sources
  // are written flat into /str/, which is why Build stages a real directory tree.
  "same-name": {
    label: "same class name, two packages",
    entry: "app/Main.java",
    files: [
      {
        path: "app/Main.java",
        content: `package app;

import models.Item;

/** Uses BOTH app.Item and models.Item, which have the same simple name. */
public class Main {
    public static void main(String[] args) {
        app.Item local = new app.Item("cart entry");
        Item stored = new Item("database row");

        System.out.println("app.Item     -> " + local.describe());
        System.out.println("models.Item  -> " + stored.describe());

        // Comparing the Class objects with != would not even compile: their
        // types are unrelated, which is itself proof that these are two
        // different classes. Compare the names instead.
        String localName = local.getClass().getName();
        String storedName = stored.getClass().getName();
        System.out.println("loaded as " + localName + " and " + storedName);
        System.out.println("different classes? " + !localName.equals(storedName));
        System.out.println("SAME-NAME-OK");
    }
}
`
      },
      {
        path: "app/Item.java",
        content: `package app;

public class Item {
    private final String label;

    public Item(String label) {
        this.label = label;
    }

    public String describe() {
        return "app.Item(" + label + ")";
    }
}
`
      },
      {
        path: "models/Item.java",
        content: `package models;

public class Item {
    private final String label;

    public Item(String label) {
        this.label = label;
    }

    public String describe() {
        return "models.Item(" + label + ")";
    }
}
`
      }
    ]
  },
  // (d) A compile error in a NESTED file, so the reported path has to survive
  // being staged under /files/warsha-run-<runId>/src/ and come back as "models/Broken.java".
  "compile-error": {
    label: "compile error (path + line + caret)",
    entry: "app/Main.java",
    files: [
      {
        path: "app/Main.java",
        content: `package app;

import models.Broken;

public class Main {
    public static void main(String[] args) {
        System.out.println(Broken.twice(21));
    }
}
`
      },
      {
        // Line numbers are asserted in harness.js -- keep this file's layout
        // stable, and note that line 7 is the one missing its semicolon.
        path: "models/Broken.java",
        content: `package models;

/** Deliberately broken, to check the quality of compiler diagnostics. */
public class Broken {

    public static int twice(int n) {
        return n * 2
    }
}
`
      }
    ]
  },
  // (e) An uncaught exception thrown two student frames deep, in a different
  // package from the entry, so frame filtering has something real to keep.
  crash: {
    label: "uncaught exception (filtered trace)",
    entry: "app/Crash.java",
    files: [
      {
        path: "app/Crash.java",
        content: `package app;

import models.Calculator;

public class Crash {
    public static void main(String[] args) {
        System.out.println("about to divide by zero");
        System.out.println(Calculator.divide(42, 0));
        System.out.println("never reached");
    }
}
`
      },
      {
        path: "models/Calculator.java",
        content: `package models;

public class Calculator {
    public static int divide(int a, int b) {
        return a / b;
    }
}
`
      }
    ]
  },
  // (f) A loop that performs no I/O and so never yields. Nothing but
  // worker.terminate() can stop this; a cooperative kill does not exist.
  "infinite-loop": {
    label: "infinite loop (kill, then run again)",
    entry: "app/Loop.java",
    files: [
      {
        path: "app/Loop.java",
        content: `package app;

public class Loop {
    public static void main(String[] args) {
        System.out.println("still alive: entering a loop that never yields. Press Stop.");
        long i = 0;
        while (true) {
            i++;
        }
    }
}
`
      }
    ]
  },
  // Extra: proves stdout is not swallowed when a program exits via System.exit,
  // and that the runtime notices the JVM went with it.
  "system-exit": {
    label: "System.exit(3)",
    entry: "app/Bye.java",
    files: [
      {
        path: "app/Bye.java",
        content: `package app;

public class Bye {
    public static void main(String[] args) {
        System.out.println("EXIT-TEST leaving with status 3");
        System.exit(3);
    }
}
`
      }
    ]
  }
};

// harness/template.generated.js
var TEMPLATE = {
  label: "java-oop template",
  entry: "app/Main.java",
  files: [
    {
      "path": "app/Main.java",
      "content": `package app;

import java.util.Scanner;

import models.Person;
import models.Student;

/** Java always starts here, in main(). Press Run. */
public class Main {
    public static void main(String[] args) {
        // Two objects. A Student is a Person, plus a major.
        Person teacher = new Person("Layla", 34);
        Student student = new Student("Omar", 20, "Computer Science");

        System.out.println("=== Warsha starter ===");
        System.out.println(teacher.describe());
        System.out.println(student.describe()); // Student's version runs, not Person's

        // Scanner reads one line that you type into the console.
        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println("Hello, " + name + "! Now open models/Person.java.");
    }
}
`
    },
    {
      "path": "models/Person.java",
      "content": 'package models; // this file lives in the models/ folder\n\n/** A person with a name and an age. Other classes can extend this one. */\npublic class Person {\n\n    // private means: only this class touches these values directly.\n    private String name;\n    private int age;\n\n    /** A constructor builds the object. this.name is the field, name is the parameter. */\n    public Person(String name, int age) {\n        this.name = name;\n        this.age = age;\n    }\n\n    // Getters let other classes read a private field.\n    public String getName() {\n        return name;\n    }\n\n    public int getAge() {\n        return age;\n    }\n\n    /** A subclass may replace this method with its own version. */\n    public String describe() {\n        return name + ", age " + age;\n    }\n}\n'
    },
    {
      "path": "models/Student.java",
      "content": 'package models;\n\n/** A Student is a Person with a major. extends reuses everything Person has. */\npublic class Student extends Person {\n\n    private String major;\n\n    public Student(String name, int age, String major) {\n        super(name, age); // let Person store the name and the age first\n        this.major = major;\n    }\n\n    /** Same name as Person.describe(), so it takes over for Students. */\n    @Override\n    public String describe() {\n        return getName() + ", age " + getAge() + ", studies " + major;\n    }\n}\n'
    }
  ]
};

// harness/harness.js
var SCENARIOS = { template: TEMPLATE, ...PROGRAMS };
var runtime = new JavaRuntime({
  // CheerpJ's console chatter, including the JIT-failure noise it emits on every
  // ECJ compile. Kept visible here so the self-test can prove the noise really
  // occurs and really stays out of the student's output.
  onInternalLog: (entry) => {
    internal.push(entry);
    if (entry.noise) state.noiseSeen++;
    renderInternal();
  }
});
var el = (id) => document.getElementById(id);
var state = {
  scenario: "template",
  running: false,
  awaitingStdin: false,
  exitCode: void 0,
  /** Visual mirror of the console, including harness [notes]. */
  output: "",
  /** ONLY what the program and compiler wrote: what a student would see. */
  io: "",
  progress: [],
  noiseSeen: 0
};
var internal = [];
var session = null;
var waiters = { stdin: [], exit: [], output: [] };
function settle(kind, value) {
  const list = waiters[kind];
  waiters[kind] = [];
  for (const waiter of list) {
    clearTimeout(waiter.timer);
    waiter.resolve(value);
  }
}
function waitFor(kind, ms, label) {
  return new Promise((resolve, reject) => {
    const waiter = { resolve };
    waiter.timer = setTimeout(() => {
      waiters[kind] = waiters[kind].filter((x) => x !== waiter);
      reject(new Error(`timed out after ${ms}ms waiting for ${label || kind}`));
    }, ms);
    waiters[kind].push(waiter);
  });
}
function waitForOutput(needle, ms) {
  if (state.io.includes(needle)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const waiter = { needle, resolve };
    waiter.timer = setTimeout(() => {
      waiters.output = waiters.output.filter((x) => x !== waiter);
      reject(new Error(`timed out after ${ms}ms waiting for output ${JSON.stringify(needle)}`));
    }, ms);
    waiters.output.push(waiter);
  });
}
function checkOutputWaiters() {
  const hits = waiters.output.filter((waiter) => state.io.includes(waiter.needle));
  if (!hits.length) return;
  waiters.output = waiters.output.filter((waiter) => !hits.includes(waiter));
  for (const waiter of hits) {
    clearTimeout(waiter.timer);
    waiter.resolve();
  }
}
function log(text, cls) {
  state.output += text;
  if (cls !== "sys" && cls !== "in") state.io += text;
  const out = el("out");
  const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
  if (cls) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    out.appendChild(span);
  } else {
    out.appendChild(document.createTextNode(text));
  }
  if (atBottom) out.scrollTop = out.scrollHeight;
  checkOutputWaiters();
}
function setStatus(text) {
  el("stat").textContent = text;
}
function showProgress(report2) {
  const p = typeof report2 === "string" ? { phase: "boot", message: report2 } : report2;
  let text = `${p.phase}: ${p.message}`;
  if (typeof p.loaded === "number") {
    const mib = (n) => (n / 1024 / 1024).toFixed(2);
    text += p.total ? ` ${mib(p.loaded)}/${mib(p.total)} MiB` : ` ${mib(p.loaded)} MiB`;
  }
  el("prog").textContent = text;
  return p;
}
function showTimings() {
  const boot = runtime.lastBoot;
  const run2 = runtime.lastRun;
  const parts = [];
  if (boot) parts.push(`boot ${Math.round(boot.initMs)}ms + warm ${Math.round(boot.warmMs)}ms`);
  if (run2) parts.push(`compile ${Math.round(run2.compileMs)}ms + run ${Math.round(run2.runMs)}ms`);
  el("timing").textContent = parts.join("  |  ");
}
function syncButtons() {
  el("run").disabled = state.running;
  el("stop").disabled = !state.running;
  el("selftest").disabled = state.running;
  el("inrow").hidden = !state.awaitingStdin;
}
var io = {
  onStdout(text) {
    log(text);
  },
  onStderr(text) {
    log(text, "err");
  },
  onStdinRequest() {
    state.awaitingStdin = true;
    syncButtons();
    el("stdin").value = "";
    el("stdin").focus();
    settle("stdin");
  },
  onExit(code) {
    state.running = false;
    state.awaitingStdin = false;
    state.exitCode = code;
    session = null;
    log(`
[exit ${code === null ? "null (killed)" : code}]
`, "sys");
    setStatus(`exit ${code === null ? "null (killed)" : code}`);
    showTimings();
    syncButtons();
    settle("exit", code);
  }
};
async function load() {
  setStatus("loading\u2026");
  await runtime.load((report2) => {
    const p = showProgress(report2);
    state.progress.push(p);
    const previous = state.progress[state.progress.length - 2];
    if (!previous || previous.message !== p.message) log(`[${p.message}]
`, "sys");
  });
  el("prog").textContent = `Java ${runtime.javaVersion} ready`;
  showTimings();
  setStatus("ready");
}
async function run(name = state.scenario) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw new Error(`unknown scenario ${name}`);
  state.scenario = name;
  renderScenarios();
  state.running = true;
  state.exitCode = void 0;
  syncButtons();
  setStatus(`running ${name}\u2026`);
  log(`
[run ${name} -> ${scenario.entry}]
`, "sys");
  await load();
  session = await runtime.run(scenario.files, scenario.entry, io);
  return session;
}
function stop() {
  if (session) session.kill();
}
function send(line) {
  if (!session || !state.awaitingStdin) return false;
  log(line + "\n", "in");
  state.awaitingStdin = false;
  session.writeStdin(line);
  syncButtons();
  return true;
}
function renderScenarios() {
  const box = el("scenarios");
  box.textContent = "";
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const button = document.createElement("button");
    button.className = "tab";
    button.id = "s-" + name;
    button.textContent = scenario.label;
    button.setAttribute("aria-selected", String(name === state.scenario));
    button.onclick = () => {
      state.scenario = name;
      renderScenarios();
      renderFiles();
    };
    box.appendChild(button);
  }
}
function renderFiles() {
  const scenario = SCENARIOS[state.scenario];
  const box = el("files");
  box.textContent = "";
  for (const file of scenario.files) {
    const heading = document.createElement("div");
    heading.className = "fname";
    heading.textContent = file.path + (file.path === scenario.entry ? "  (entry)" : "");
    const body = document.createElement("pre");
    body.className = "fbody";
    body.textContent = file.content;
    box.append(heading, body);
  }
}
function renderInternal() {
  const box = el("internal");
  if (!box) return;
  const noise = internal.filter((entry) => entry.noise).length;
  el("noise").textContent = `CheerpJ console: ${internal.length} lines, ${noise} filtered as noise`;
  box.textContent = internal.slice(-40).map((entry) => `${entry.noise ? "[noise] " : ""}${entry.text}`).join("\n");
}
var report = [];
function check(name, ok, detail = "") {
  report.push({ name, ok, detail });
  renderReport();
  return ok;
}
function renderReport() {
  const box = el("report");
  box.textContent = "";
  for (const row of report) {
    const div = document.createElement("div");
    div.className = "row " + (row.ok ? "pass" : "fail");
    div.textContent = `${row.ok ? "PASS" : "FAIL"}  ${row.name}${row.detail ? "  -- " + row.detail : ""}`;
    box.appendChild(div);
  }
  const failed = report.filter((row) => !row.ok).length;
  el("summary").textContent = report.length ? `${report.length - failed}/${report.length} checks passed` : "";
  el("summary").className = failed ? "bad" : "ok";
}
function lastLine() {
  const lines = state.io.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines[lines.length - 1] : "";
}
function firstMatch(re) {
  const m = state.io.match(re);
  return m ? m[0] : "(not found)";
}
function freshConsole() {
  el("out").textContent = "";
  state.output = "";
  state.io = "";
}
var LOAD_MS = 24e4;
var COMPILE_MS = 18e4;
async function selfTest() {
  report.length = 0;
  renderReport();
  const timings = {};
  try {
    freshConsole();
    const coldStart = performance.now();
    await run("template");
    await waitFor("stdin", LOAD_MS, "template Scanner read");
    timings.coldToFirstPrompt = Math.round(performance.now() - coldStart);
    check("1a template: ran and printed its banner", state.io.includes("=== Warsha starter ==="));
    check(
      "1b template: Person.describe()",
      state.io.includes("Layla, age 34"),
      firstMatch(/Layla[^\n]*/)
    );
    check(
      "1c template: Student overrides describe() (polymorphism across files)",
      state.io.includes("Omar, age 20, studies Computer Science"),
      firstMatch(/Omar[^\n]*/)
    );
    check(
      "1d template: prompt visible while blocked, with no flush and no newline",
      lastLine() === "Your name: ",
      JSON.stringify(lastLine())
    );
    send("Warsha");
    let code = await waitFor("exit", COMPILE_MS, "template exit");
    check("1e template: exit code 0", code === 0, `got ${code}`);
    check(
      "1f template: used the line we typed",
      state.io.includes("Hello, Warsha! Now open models/Person.java."),
      firstMatch(/Hello[^\n]*/)
    );
    freshConsole();
    const warmStart = performance.now();
    await run("prompt");
    await waitFor("stdin", COMPILE_MS, "first prompt");
    timings.warmToFirstPrompt = Math.round(performance.now() - warmStart);
    check('2a partial line "Name: " before the read blocks', lastLine() === "Name: ", JSON.stringify(lastLine()));
    send("Sara");
    await waitFor("stdin", COMPILE_MS, "second prompt");
    check('2b partial line "Age: " before nextInt() blocks', lastLine() === "Age: ", JSON.stringify(lastLine()));
    send("19");
    await waitFor("stdin", COMPILE_MS, "third prompt");
    check('2c partial line "City: " before the read blocks', lastLine() === "City: ", JSON.stringify(lastLine()));
    send("Riyadh");
    code = await waitFor("exit", COMPILE_MS, "prompt exit");
    check("2d nextInt() parsed the token", state.io.includes("[echo] age parsed as int: 19"));
    check(
      "2e three separate print calls stayed on one line",
      state.io.includes("[echo] Riyadh <- three separate print calls, no newline until here"),
      firstMatch(/\[echo\] Riyadh[^\n]*/)
    );
    check("2f all three reads completed", state.io.includes("PROMPT-TEST-OK Sara/19/Riyadh"));
    check("2g exit code 0", code === 0, `got ${code}`);
    freshConsole();
    await run("same-name");
    code = await waitFor("exit", COMPILE_MS, "same-name exit");
    check("3a app.Item resolved", state.io.includes("app.Item     -> app.Item(cart entry)"));
    check("3b models.Item resolved", state.io.includes("models.Item  -> models.Item(database row)"));
    check(
      "3c both loaded under their own fully-qualified names",
      state.io.includes("loaded as app.Item and models.Item"),
      firstMatch(/loaded as[^\n]*/)
    );
    check("3d genuinely two distinct classes", state.io.includes("different classes? true"));
    check("3e exit code 0 (flat /str/ namespace solved)", code === 0 && state.io.includes("SAME-NAME-OK"), `got ${code}`);
    freshConsole();
    await run("compile-error");
    code = await waitFor("exit", COMPILE_MS, "compile-error exit");
    check(
      "4a diagnostic names the student's own path",
      /(^|\s)models\/Broken\.java/.test(state.io),
      firstMatch(/[^\s]*Broken\.java[^\n]*/)
    );
    check("4b no /files/ path leaked", !state.io.includes("/files/"), firstMatch(/\/files\/[^\s]*/));
    check("4c no /str/ path leaked", !state.io.includes("/str/"), firstMatch(/\/str\/[^\s]*/));
    check("4d diagnostic carries a line number", /\(at line \d+\)/.test(state.io), firstMatch(/\(at line \d+\)/));
    check(
      "4e diagnostic carries a caret",
      state.io.split("\n").some((line) => line.trim() === "^")
    );
    check("4f exit code non-zero and non-null", code !== null && code !== 0, `got ${code}`);
    check("4g nothing ran", !state.io.includes("42"), firstMatch(/42/));
    freshConsole();
    const noiseBefore = state.noiseSeen;
    await run("crash");
    code = await waitFor("exit", COMPILE_MS, "crash exit");
    check("5a the program ran up to the throw", state.io.includes("about to divide by zero"));
    check("5b execution stopped at the throw", !state.io.includes("never reached"));
    check(
      '5c exception class named, with no ": null" for a missing message',
      /^java\.lang\.ArithmeticException\s*$/m.test(state.io),
      firstMatch(/java\.lang\.ArithmeticException[^\n]*/)
    );
    check(
      "5d deepest student frame kept, labelled honestly",
      state.io.includes("at models.Calculator.divide (line unknown)"),
      firstMatch(/at models\.Calculator[^\n]*/)
    );
    check(
      "5e caller frame kept",
      state.io.includes("at app.Crash.main (line unknown)"),
      firstMatch(/at app\.Crash[^\n]*/)
    );
    check("5f warsha.* frames filtered out", !state.io.includes("warsha."), firstMatch(/[^\s]*warsha\.[^\n]*/));
    check(
      "5g reflection frames filtered out",
      !state.io.includes("sun.reflect.") && !state.io.includes("java.lang.reflect."),
      firstMatch(/[^\s]*reflect\.[^\n]*/)
    );
    check("5h no JIT-failure noise in the student's output", !/JIT failure|please report a bug/.test(state.io));
    check(
      "5i ...and that noise really did occur (so the filter is doing work)",
      state.noiseSeen > noiseBefore,
      `${state.noiseSeen - noiseBefore} noise lines this scenario, ${state.noiseSeen} total`
    );
    check("5j exit code non-zero and non-null", code !== null && code !== 0, `got ${code}`);
    freshConsole();
    await run("infinite-loop");
    await waitForOutput("still alive", COMPILE_MS);
    const killed = waitFor("exit", 1e4, "kill exit");
    const killStart = performance.now();
    stop();
    code = await killed;
    timings.killMs = Math.round(performance.now() - killStart);
    check("6a kill() ends the session with exit null", code === null, `got ${code}`);
    check("6b kill() is immediate", performance.now() - killStart < 1e3, `${timings.killMs}ms`);
    freshConsole();
    const rewarmStart = performance.now();
    await run("same-name");
    code = await waitFor("exit", LOAD_MS, "exit after kill");
    timings.rewarmMs = Math.round(performance.now() - rewarmStart);
    check(
      "6c run() works again after kill()",
      code === 0 && state.io.includes("SAME-NAME-OK"),
      `re-warm to finished run ${timings.rewarmMs}ms`
    );
    freshConsole();
    await run("system-exit");
    code = await waitFor("exit", COMPILE_MS, "system-exit exit");
    check("7a output before System.exit survived", state.io.includes("EXIT-TEST leaving with status 3"));
    check("7b System.exit(3) surfaces as exit 3", code === 3, `got ${code}`);
    freshConsole();
    await run("prompt");
    await waitFor("stdin", LOAD_MS, "prompt after System.exit");
    send("After");
    await waitFor("stdin", COMPILE_MS, "second prompt after System.exit");
    send("7");
    await waitFor("stdin", COMPILE_MS, "third prompt after System.exit");
    send("Jeddah");
    code = await waitFor("exit", COMPILE_MS, "exit after System.exit run");
    check(
      "7c a run after System.exit still works (JVM replaced)",
      code === 0 && state.io.includes("PROMPT-TEST-OK After/7/Jeddah"),
      `got ${code}`
    );
    const gc = internal.map((entry) => /warsha-gc: deleted=(\d+) failed=(\d+)/.exec(entry.text)).filter(Boolean);
    check("8a Build reported on its cleanup", gc.length > 0, `${gc.length} reports`);
    check(
      "8b old run directories are really deleted (delete() works on /files/)",
      gc.some((m) => Number(m[1]) > 0) && gc.every((m) => Number(m[2]) === 0),
      gc.length ? gc.map((m) => `deleted=${m[1]} failed=${m[2]}`).join(", ") : "no reports"
    );
  } catch (error) {
    check("self-test completed without error", false, String(error && error.message || error));
  }
  const failed = report.filter((row) => !row.ok).length;
  setStatus(failed ? `SELF-TEST FAILED (${failed})` : "SELF-TEST PASSED");
  el("timing").textContent = `cold->prompt ${timings.coldToFirstPrompt}ms | warm->prompt ${timings.warmToFirstPrompt}ms | kill ${timings.killMs}ms | after-kill run ${timings.rewarmMs}ms`;
  return { passed: report.length - failed, failed, timings, report };
}
el("run").onclick = () => {
  run().catch((error) => log(`
[harness error] ${error}
`, "err"));
};
el("stop").onclick = stop;
el("clear").onclick = freshConsole;
el("selftest").onclick = () => selfTest();
el("send").onclick = () => send(el("stdin").value);
el("eof").onclick = () => {
  if (session && state.awaitingStdin) {
    log("[EOF]\n", "sys");
    state.awaitingStdin = false;
    session.writeEof();
    syncButtons();
  }
};
el("stdin").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    send(el("stdin").value);
  }
});
renderScenarios();
renderFiles();
renderInternal();
syncButtons();
setStatus("idle");
window.harness = { state, report, internal, run, stop, send, selfTest, load, waitFor, waitForOutput, runtime };
