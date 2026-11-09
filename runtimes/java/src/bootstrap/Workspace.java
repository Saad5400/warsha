package warsha;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The student program's working directory: the project's own files, so that
 * {@code new Scanner(new File("data.txt"))} reads the data.txt sitting beside
 * Main.java, and {@code new FileWriter("out.txt")} creates a file the student
 * then sees in the explorer.
 *
 * <p>It lives at /files/warsha-work -- /files/ is the only mount Java can write
 * -- and it is PERSISTENT rather than per-run, for cost: an IndexedDB create is
 * measured at over a second (INTEGRATION.md), so {@link #stage} only writes a
 * file whose bytes actually differ and only deletes what the project no longer
 * has. A project whose data files did not change costs reads, not writes.
 *
 * <p>Sources are compiled from Build's own staging tree; only the project's
 * other files are mirrored here, so editing Main.java never costs a write.
 *
 * <p>After the run, {@link #diff} compares the directory with what was staged
 * and the result goes back to the shell through the Bridge, which writes it
 * into the project. The project holds text only, so a binary or oversized file
 * is reported as skipped rather than mangled.
 *
 * <p>The pure parts (stage, diff, decode) take the root as a parameter so
 * BootstrapSelfTest can exercise them on a real disk.
 *
 * Never calls System.exit -- see Bridge.
 */
public final class Workspace {

    static final File ROOT = new File("/files/warsha-work");

    /** Larger files are reported as skipped: the editor is not a hex viewer. */
    static final int WRITE_BACK_LIMIT_BYTES = 1024 * 1024;

    private Workspace() {
    }

    /** True for a project path that is NOT compiled, i.e. belongs in the workspace. */
    static boolean isDataFile(String projectPath) {
        return !projectPath.endsWith(".java");
    }

    // --- staging --------------------------------------------------------------

    /**
     * Makes `root` hold exactly `files` (project path -> content): differing
     * files are written, missing ones created, and anything else deleted --
     * including whatever an earlier run's program left behind that the project
     * did not keep. Returns how many files were written (for the timing log).
     */
    static int stage(File root, Map<String, String> files) throws IOException {
        if (!root.mkdirs() && !root.isDirectory()) throw new IOException("cannot create " + root);

        List<String> present = new ArrayList<String>();
        list(root, "", present);
        for (String path : present) {
            if (!files.containsKey(path)) new File(root, path).delete();
        }
        pruneEmptyDirs(root);

        int writes = 0;
        for (Map.Entry<String, String> entry : files.entrySet()) {
            File target = new File(root, entry.getKey());
            byte[] wanted = entry.getValue().getBytes(StandardCharsets.UTF_8);
            if (target.isFile()) {
                byte[] have = readBytes(target, wanted.length + 1);
                if (have != null && Arrays.equals(have, wanted)) continue;
            }
            File parent = target.getParentFile();
            if (parent != null && !parent.mkdirs() && !parent.isDirectory()) {
                throw new IOException("cannot create " + parent);
            }
            if (target.isDirectory()) deleteTree(target);
            FileOutputStream out = new FileOutputStream(target);
            try {
                out.write(wanted);
            } finally {
                out.close();
            }
            writes++;
        }
        return writes;
    }

    // --- after the run ----------------------------------------------------------

    /** What a run did to its working directory. */
    static final class Changes {
        /** New or modified text files, project path -> content, in path order. */
        final Map<String, String> written = new LinkedHashMap<String, String>();
        /** Staged project paths the program removed. */
        final List<String> deleted = new ArrayList<String>();
        /** Files that cannot come back: binary, or over the size limit. */
        final List<String> skipped = new ArrayList<String>();

        boolean isEmpty() {
            return written.isEmpty() && deleted.isEmpty() && skipped.isEmpty();
        }
    }

    static Changes diff(File root, Map<String, String> staged) {
        Changes changes = new Changes();
        List<String> present = new ArrayList<String>();
        list(root, "", present);
        Collections.sort(present);
        for (String path : present) {
            String text = decodeText(readBytes(new File(root, path), WRITE_BACK_LIMIT_BYTES + 1));
            if (text == null) {
                changes.skipped.add(path);
            } else if (!text.equals(staged.get(path))) {
                changes.written.put(path, text);
            }
        }
        for (String path : staged.keySet()) {
            if (!present.contains(path)) changes.deleted.add(path);
        }
        return changes;
    }

    /**
     * Strict UTF-8, or null: invalid bytes, a NUL, or more than the limit. A
     * leading BOM is dropped -- Windows-minded code writes one, and it would
     * otherwise show up as a change to a file whose text did not change.
     */
    static String decodeText(byte[] bytes) {
        if (bytes == null || bytes.length > WRITE_BACK_LIMIT_BYTES) return null;
        String text;
        try {
            text = StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException e) {
            return null;
        }
        if (text.indexOf('\0') >= 0) return null;
        if (!text.isEmpty() && text.charAt(0) == '﻿') text = text.substring(1);
        return text;
    }

    // --- making it the working directory ------------------------------------------

    /**
     * Points the program's relative paths at `root`, as far as the JVM allows.
     *
     * <p>Three layers, each best effort:
     * <ol>
     * <li>the {@code user.dir} property, which is what programs print and what
     *     {@code Paths.get("").toAbsolutePath()} reports;</li>
     * <li>java.io's cached copy of it, which {@code File.getAbsolutePath()} uses;</li>
     * <li>NIO's default directory, plus its "resolve against the default
     *     directory" switch -- with that on, {@code Path.of("data.txt")} and every
     *     {@code Files.*} call resolve relative paths in Java before they reach the
     *     platform, so they land here whatever the underlying cwd is.</li>
     * </ol>
     * The cached fields are final and java.base does not open its packages, so
     * they are written through sun.misc.Unsafe, which ignores both.
     *
     * <p>Plain java.io streams opened with a relative name ({@code new
     * FileReader("data.txt")}) hand that name straight to the platform, so for
     * those the platform's own cwd decides; the run reports through
     * Bridge.writeInternal whether a relative probe actually landed here.
     *
     * @return a short report of which layers took, for the internal log
     */
    static String enter(File root) {
        String dir = root.getAbsolutePath();
        StringBuilder report = new StringBuilder("warsha-workdir: ").append(dir);
        try {
            System.setProperty("user.dir", dir);
            report.append(" prop=ok");
        } catch (Throwable t) {
            report.append(" prop=").append(t.getClass().getSimpleName());
        }
        // Named `fs` up to JDK 17 (CheerpJ's runtime) and `FS` from 21 on.
        String io = patch("java.io.File", "fs", "userDir", dir);
        if (!io.equals("ok")) io = patch("java.io.File", "FS", "userDir", dir);
        report.append(" io=").append(io);
        report.append(" nio=").append(patchNio(dir));
        return report.toString();
    }

    private static String patch(String holderClass, String holderField, String field, Object value) {
        try {
            Object unsafe = unsafe();
            Field holder = Class.forName(holderClass).getDeclaredField(holderField);
            Object owner = staticValue(unsafe, holder);
            Field target = owner.getClass().getDeclaredField(field);
            putObject(unsafe, owner, target, value);
            return "ok";
        } catch (Throwable t) {
            return t.getClass().getSimpleName();
        }
    }

    private static String patchNio(String dir) {
        try {
            Object unsafe = unsafe();
            Object fs = java.nio.file.FileSystems.getDefault();
            Class<?> type = fs.getClass();
            while (type != null && !type.getName().equals("sun.nio.fs.UnixFileSystem")) type = type.getSuperclass();
            if (type == null) return "not-unix";
            putObject(unsafe, fs, type.getDeclaredField("defaultDirectory"), dir.getBytes(StandardCharsets.UTF_8));
            Field flag = type.getDeclaredField("needToResolveAgainstDefaultDirectory");
            Class<?> u = unsafe.getClass();
            long offset = (Long) u.getMethod("objectFieldOffset", Field.class).invoke(unsafe, flag);
            u.getMethod("putBoolean", Object.class, long.class, boolean.class).invoke(unsafe, fs, offset, true);
            return "ok";
        } catch (Throwable t) {
            return t.getClass().getSimpleName();
        }
    }

    private static Object unsafe() throws Exception {
        Class<?> type = Class.forName("sun.misc.Unsafe");
        Field the = type.getDeclaredField("theUnsafe");
        the.setAccessible(true); // jdk.unsupported opens sun.misc, so this is allowed
        return the.get(null);
    }

    private static Object staticValue(Object unsafe, Field field) throws Exception {
        Class<?> u = unsafe.getClass();
        Object base = u.getMethod("staticFieldBase", Field.class).invoke(unsafe, field);
        long offset = (Long) u.getMethod("staticFieldOffset", Field.class).invoke(unsafe, field);
        return u.getMethod("getObject", Object.class, long.class).invoke(unsafe, base, offset);
    }

    private static void putObject(Object unsafe, Object owner, Field field, Object value) throws Exception {
        Class<?> u = unsafe.getClass();
        long offset = (Long) u.getMethod("objectFieldOffset", Field.class).invoke(unsafe, field);
        u.getMethod("putObject", Object.class, long.class, Object.class).invoke(unsafe, owner, offset, value);
    }

    /**
     * Whether a relative java.io name reaches `root`: checks that some staged
     * file is visible by its bare relative path. Read-only (a write would be an
     * IndexedDB create), so it says nothing when nothing is staged.
     */
    static String probeRelative(File root, Map<String, String> staged) {
        if (staged.isEmpty()) return "relative=unknown(no data files)";
        String any = staged.keySet().iterator().next();
        return "relative=" + (new File(any).isFile() ? "ok" : "MISSES " + any);
    }

    // --- filesystem helpers -------------------------------------------------------

    /** Project-relative paths of every regular file under `dir`. */
    static void list(File dir, String prefix, List<String> out) {
        File[] children = dir.listFiles();
        if (children == null) return;
        for (File child : children) {
            String rel = prefix.isEmpty() ? child.getName() : prefix + "/" + child.getName();
            if (child.isDirectory()) list(child, rel, out);
            else if (child.isFile()) out.add(rel);
        }
    }

    /** Reads at most `cap` bytes; null if unreadable. */
    static byte[] readBytes(File file, int cap) {
        try {
            InputStream in = new FileInputStream(file);
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while (out.size() < cap && (n = in.read(chunk, 0, Math.min(chunk.length, cap - out.size()))) > 0) {
                    out.write(chunk, 0, n);
                }
                return out.toByteArray();
            } finally {
                in.close();
            }
        } catch (IOException e) {
            return null;
        }
    }

    /** Removes directories left empty (a staged file's parent is recreated on write). */
    private static void pruneEmptyDirs(File root) {
        File[] children = root.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (!child.isDirectory()) continue;
            pruneEmptyDirs(child);
            String[] left = child.list();
            if (left != null && left.length == 0) child.delete();
        }
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }
}
