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
 * Two constraints of CheerpJ's filesystem shape this class (SPIKE.md §4):
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
            Bridge.writeDiag("warsha: internal build failure\n" + sw);
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
        String fileName = entryPath;
        int slash = fileName.lastIndexOf('/');
        if (slash >= 0) fileName = fileName.substring(slash + 1);
        if (fileName.endsWith(".java")) fileName = fileName.substring(0, fileName.length() - 5);

        Matcher m = PACKAGE.matcher(stripComments(source));
        if (!m.find()) return fileName;
        return m.group(1).replaceAll("\\s+", "") + "." + fileName;
    }

    /** Enough comment stripping that a commented-out package line is ignored. */
    private static String stripComments(String source) {
        StringBuilder sb = new StringBuilder(source.length());
        int i = 0;
        while (i < source.length()) {
            char c = source.charAt(i);
            if (c == '/' && i + 1 < source.length() && source.charAt(i + 1) == '/') {
                while (i < source.length() && source.charAt(i) != '\n') i++;
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
