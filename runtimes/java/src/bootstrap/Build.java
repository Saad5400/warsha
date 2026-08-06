package warsha;

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
 * Two constraints of CheerpJ's filesystem shape this class, both measured
 * rather than documented anywhere:
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

    /**
     * Written by this class, read by Traces: "&lt;binary name&gt;\t&lt;source file&gt;"
     * for every top-level type in the project.
     *
     * This is the SourceFile attribute that CheerpJ's stack walker refuses to
     * give back, rebuilt from the only place that still knows
     * it -- the sources, while we have them in hand.
     */
    static File sourceIndexFile(String runId) {
        return new File(runDir(runId), "classes.tsv");
    }

    /** What a build produced: an exit code, and the run directory to launch from. */
    static final class Result {
        /** 0 compiled (or reused), 1 compile errors, 70 internal failure. */
        final int code;
        /** The run whose out/, main.txt and classes.tsv the launcher must use. */
        final String runId;

        Result(int code, String runId) {
            this.code = code;
            this.runId = runId;
        }
    }

    /** Key + directory of the last successful compile in this JVM. */
    private static String lastGoodKey = null;
    private static String lastGoodRunId = null;

    /**
     * Compiles the staged project -- unless it is byte-for-byte the project the
     * last successful compile in this session already compiled, in which case
     * that run's output directory is reused and ECJ is not invoked at all.
     *
     * The reuse test is exact: same entry path, same set of relative paths,
     * same content hash per file. Any edit, added file or deleted file misses
     * the cache and takes the full-compile path, which builds into a fresh
     * per-run directory exactly as before -- so a stale .class can no more
     * resurrect here than it could when every run compiled. The cache also
     * dies with this JVM (a kill() or System.exit replaces the worker), and is
     * bypassed when the reused directory has vanished from /files/.
     *
     * `allowReuse` is false for the boot-time warm-up compile, which must
     * neither seed the cache (its synthetic source is not the student's
     * project) nor short-circuit.
     */
    static Result buildOrReuse(String runId, String entryPath, boolean allowReuse) {
        try {
            String key = null;
            try {
                key = projectKey(runId, entryPath);
            } catch (Throwable ignored) {
                // A hashing failure must never block a build; it only costs the reuse.
            }

            if (allowReuse && key != null && key.equals(lastGoodKey)
                    && lastGoodRunId != null && outDir(lastGoodRunId).isDirectory()) {
                Bridge.writeInternal("warsha-reuse: sources unchanged, skipping the compile");
                return new Result(0, lastGoodRunId);
            }
            if (allowReuse) {
                // The directory this pointed at is about to be gc'd by build().
                lastGoodKey = null;
                lastGoodRunId = null;
            }

            long started = System.currentTimeMillis();
            int code = build(runId, entryPath);
            Bridge.writeInternal(
                    "warsha-timing: build " + (System.currentTimeMillis() - started) + "ms code=" + code);
            if (allowReuse && code == 0 && key != null) {
                lastGoodKey = key;
                lastGoodRunId = runId;
            }
            return new Result(code, runId);
        } catch (Throwable t) {
            // A failure here is ours, not the student's; label it as such.
            StringWriter sw = new StringWriter();
            t.printStackTrace(new PrintWriter(sw));
            Bridge.writeDiag("warsha: internal build failure\n" + sw);
            return new Result(70, runId);
        }
    }

    /**
     * Digest of everything that could change what a compile produces: the
     * entry path, and every staged file's project path and content. Manifest
     * order is normalized away so the worker enumerating files differently can
     * never fake a hit or force a miss.
     */
    private static String projectKey(String runId, String entryPath) throws IOException {
        java.security.MessageDigest digest;
        try {
            digest = java.security.MessageDigest.getInstance("MD5");
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException("MD5 unavailable", e);
        }
        digest.update(entryPath.getBytes("UTF-8"));
        digest.update((byte) 0);

        List<String[]> manifest = readManifest(runId);
        java.util.Collections.sort(manifest, new java.util.Comparator<String[]>() {
            @Override
            public int compare(String[] a, String[] b) {
                return a[1].compareTo(b[1]);
            }
        });
        for (String[] entry : manifest) {
            digest.update(entry[1].getBytes("UTF-8"));
            digest.update((byte) 0);
            digest.update(readAll(new File("/str/" + entry[0])).getBytes("UTF-8"));
            digest.update((byte) 0);
        }

        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
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
        StringBuilder sourceIndex = new StringBuilder();
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
            indexTypes(sourceIndex, relativePath, content);

            if (relativePath.equals(entryPath)) entrySource = content;
        }

        if (entrySource == null) throw new IOException("entry " + entryPath + " not in the manifest");
        writeAll(mainClassFile(runId), mainClassOf(entryPath, entrySource));
        writeAll(sourceIndexFile(runId), sourceIndex.toString());

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
        // Must precede the first compile of the session: without it ECJ cannot
        // see the Java 17 platform classes at all. See Platform's header.
        String systemHome = Platform.prepare();

        List<String> argv = new ArrayList<String>(sourcePaths);
        argv.add("-d");
        argv.add(out.getPath());
        argv.add("--system");       // where ECJ looks for the platform classes
        argv.add(systemHome);
        argv.add("-17");            // CheerpJ's runtime is Java 17; see INTEGRATION.md
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
            Pattern.compile("^\\s*package\\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\\s*\\.\\s*[A-Za-z_$][A-Za-z0-9_$]*)*)\\s*;",
                    Pattern.MULTILINE);

    /**
     * "app/Main.java" + "package app;" -> "app.Main".
     *
     * Derived from the package declaration rather than from the directory,
     * because the two need not agree: the compiler only insists that a public
     * class match its *file name*. A student whose file sits at the project
     * root with `package app;` at the top still gets a class the launcher can
     * find.
     */
    static String mainClassOf(String entryPath, String source) {
        String fileName = simpleFileName(entryPath);
        if (fileName.endsWith(".java")) fileName = fileName.substring(0, fileName.length() - 5);
        String pkg = packageOf(source);
        return pkg.isEmpty() ? fileName : pkg + "." + fileName;
    }

    /** The declared package, or "" for the default package. */
    static String packageOf(String source) {
        Matcher m = PACKAGE.matcher(blankNonCode(source));
        if (!m.find()) return "";
        return m.group(1).replaceAll("\\s+", "");
    }

    private static String simpleFileName(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    // --- the class -> source-file index --------------------------------------

    /**
     * Appends "&lt;binary name&gt;\t&lt;file&gt;" for every top-level type in one source.
     *
     * Every type gets a line, not just the public one, because javac records
     * the FILE in each class's SourceFile attribute: a package-private
     * `class Circle` declared in Shapes.java belongs to Shapes.java, and a
     * trace that claimed "Circle.java" would send a student looking for a file
     * that does not exist. Inner classes need no entries -- Traces strips
     * everything from the '$' on before looking a frame up.
     */
    static void indexTypes(StringBuilder into, String relativePath, String source) {
        String pkg = packageOf(source);
        String file = simpleFileName(relativePath);
        for (String type : topLevelTypes(source)) {
            into.append(pkg.isEmpty() ? type : pkg + "." + type).append('\t').append(file).append('\n');
        }
    }

    /**
     * The names of the types declared at the top level of a source file, in
     * declaration order.
     *
     * Deliberately a scanner and not a parser: it tracks brace depth and takes
     * the identifier after `class`, `interface` or `enum` at depth 0. Comments
     * and literals are blanked first, so neither `// class Ghost` nor
     * `"}"` can move the depth or invent a type. Anything it misses costs a
     * frame the simple-name fallback, never a wrong compile.
     */
    static List<String> topLevelTypes(String source) {
        String s = blankNonCode(source);
        List<String> found = new ArrayList<String>();
        int depth = 0;
        int i = 0;
        int n = s.length();
        while (i < n) {
            char c = s.charAt(i);
            if (c == '{') {
                depth++;
                i++;
            } else if (c == '}') {
                if (depth > 0) depth--;
                i++;
            } else if (Character.isJavaIdentifierStart(c)
                    && (i == 0 || !Character.isJavaIdentifierPart(s.charAt(i - 1)))) {
                int end = i;
                while (end < n && Character.isJavaIdentifierPart(s.charAt(end))) end++;
                String word = s.substring(i, end);
                if (depth == 0 && (word.equals("class") || word.equals("interface") || word.equals("enum"))) {
                    int start = end;
                    while (start < n && Character.isWhitespace(s.charAt(start))) start++;
                    int stop = start;
                    while (stop < n && Character.isJavaIdentifierPart(s.charAt(stop))) stop++;
                    if (stop > start) found.add(s.substring(start, stop));
                }
                i = end;
            } else {
                i++;
            }
        }
        return found;
    }

    /**
     * Comments and literals replaced by spaces; length, newlines outside block
     * comments, and every other character left alone.
     *
     * Two callers need it and for different reasons: packageOf must not be
     * fooled by a commented-out `package` line (which would stage the class
     * under a name nothing can load, surfacing much later as an unrelated
     * "cannot find symbol"), and topLevelTypes must not let a brace inside a
     * string literal shift its depth.
     */
    static String blankNonCode(String source) {
        char[] out = source.toCharArray();
        int i = 0;
        int n = out.length;
        while (i < n) {
            char c = out[i];
            if (c == '/' && i + 1 < n && out[i + 1] == '/') {
                while (i < n && out[i] != '\n') out[i++] = ' ';
            } else if (c == '/' && i + 1 < n && out[i + 1] == '*') {
                out[i++] = ' ';
                out[i++] = ' ';
                while (i < n && !(out[i] == '*' && i + 1 < n && out[i + 1] == '/')) out[i++] = ' ';
                if (i < n) out[i++] = ' ';
                if (i < n) out[i++] = ' ';
            } else if (c == '"' || c == '\'') {
                out[i++] = ' ';
                while (i < n && out[i] != c) {
                    // A backslash escape consumes the next character, so a
                    // literal quote inside the literal does not end it.
                    if (out[i] == '\\' && i + 1 < n) out[i++] = ' ';
                    if (i < n) out[i++] = ' ';
                }
                if (i < n) out[i++] = ' ';
            } else {
                i++;
            }
        }
        return new String(out);
    }

    // --- manifest -------------------------------------------------------------

    /** Lines of "<flat name in /str/>\t<relative path in the project>". */
    private static List<String[]> readManifest(String runId) throws IOException {
        String text = readAll(new File("/str/warsha-manifest-" + runId + ".tsv"));
        List<String[]> entries = new ArrayList<String[]>();
        for (String line : text.split("\n")) {
            if (line.isEmpty()) continue;
            int tab = line.indexOf('\t');
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
     * the spike established, so the outcome is reported -- through
     * Bridge.writeInternal, because the resident Server installs the Bridge
     * streams before any build runs, so System.out here would land in the
     * STUDENT's console. The internal channel is where the harness asserts on
     * this line.
     */
    private static void gcOldRuns(String runId) {
        File[] children = new File("/files").listFiles();
        if (children == null) {
            Bridge.writeInternal("warsha-gc: cannot list /files");
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
        Bridge.writeInternal("warsha-gc: deleted=" + deleted + " failed=" + failed);
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }
}
