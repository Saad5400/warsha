package warsha;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

/**
 * Makes ECJ able to see the Java 17 platform classes on CheerpJ.
 *
 * ============================ WHY THIS EXISTS ============================
 * CheerpJ ships a JRE, not a JDK: there is no javac in the image
 * (com.sun.tools.javac.Main is absent, ToolProvider.getSystemJavaCompiler()
 * returns null), which is why Warsha carries ECJ. On Java 8 that was the end of
 * the story -- ECJ read the platform out of rt.jar, a plain zip, and
 * sun.boot.class.path pointed straight at it.
 *
 * Java 9 replaced rt.jar with a packed module image, and ECJ cannot read one
 * directly. It asks the JVM to open the image for it, and that request goes
 * through two checks CheerpJ's image fails:
 *
 *  1. org.eclipse.jdt.internal.compiler.util.Jdk identifies a JDK by reading
 *     <java.home>/release. CheerpJ has no release file, so ECJ reports
 *     "invalid location for system libraries: /lt/17" before compiling a line.
 *
 *  2. The JDK's OWN JrtFileSystemProvider demands <java.home>/lib/jrt-fs.jar
 *     whenever it is handed a java.home other than the running JVM's -- which
 *     is exactly what ECJ hands it. CheerpJ has no jrt-fs.jar either, so this
 *     fails with "IOException: /lt/17/lib/jrt-fs.jar not exist".
 *
 * /lt/ is read-only, so neither file can be supplied where they are wanted.
 * Both checks are avoidable anyway, because the running JVM's own image opens
 * with no jrt-fs.jar at all -- FileSystems.getFileSystem("jrt:/") just works,
 * and reads all 50 modules and ~20 000 classes. So:
 *
 *  1. Build a java.home under /files/ (the one mount Java can write) holding
 *     nothing but a release file, and point ECJ at it with --system. Check one
 *     is satisfied by a file we control.
 *
 *  2. Seed ECJ's own jrt-filesystem cache, keyed by that path, with the running
 *     image. JRTUtil.getJrtFileSystem does a computeIfAbsent on that map, so a
 *     pre-seeded entry means the provider call that wants jrt-fs.jar is never
 *     made at all. Check two never runs.
 *
 * After that, stock unmodified ECJ compiles at -17 against the real image.
 * Verified in a browser: records, var, sealed types, pattern matching, switch
 * expressions and text blocks all compile and run.
 *
 * ================================ CAUTION ===============================
 * Step 2 reaches into an ECJ internal (JRT_FILE_SYSTEMS, added in the 3.4x
 * series -- ECJ 3.33 has no such field). fetch-compiler.sh pins the ECJ version
 * by sha256 for exactly this reason. If that pin is ever moved, re-run
 * tools/qa's java suite: prepare() below fails loudly rather than silently
 * degrading, so a bad bump surfaces as a clear error and not as a mysterious
 * "invalid location for system libraries".
 */
public final class Platform {

    /**
     * The java.home handed to ECJ via --system. It only ever holds a release
     * file; the actual classes come from the running image (see the header).
     * Under /files/ because that is the only Java-writable mount.
     */
    static final String SYSTEM_HOME = "/files/warsha-jdk";

    private static final String JRT_UTIL = "org.eclipse.jdt.internal.compiler.util.JRTUtil";
    private static final String JRT_CACHE_FIELD = "JRT_FILE_SYSTEMS";

    private static boolean prepared;

    private Platform() {
    }

    /**
     * Idempotent; safe to call before every compile. Must run before ECJ
     * resolves any platform type, which in practice means before the first
     * BatchCompiler.compile of the session.
     *
     * @return the path to pass to ECJ as --system
     */
    static synchronized String prepare() {
        if (prepared) return SYSTEM_HOME;
        writeReleaseFile();
        seedJrtCache();
        prepared = true;
        return SYSTEM_HOME;
    }

    /**
     * ECJ reads JAVA_VERSION out of this to decide the JDK's level, and that is
     * the file's whole purpose -- nothing reads the classes from here. The value
     * is the running JVM's own version so the two can never drift.
     */
    private static void writeReleaseFile() {
        File home = new File(SYSTEM_HOME);
        if (!home.mkdirs() && !home.isDirectory()) {
            throw new IllegalStateException("warsha: cannot create the compiler's system home at " + SYSTEM_HOME);
        }
        String version = System.getProperty("java.version", "17");
        String content = "JAVA_VERSION=\"" + version + "\"\n";
        File release = new File(home, "release");
        try (OutputStream out = new FileOutputStream(release)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new IllegalStateException("warsha: cannot write " + release, e);
        }
    }

    /**
     * Puts the running JVM's jrt: filesystem into ECJ's cache under the key it
     * will look up, so ECJ never asks the JDK to open a foreign java.home.
     */
    @SuppressWarnings("unchecked")
    private static void seedJrtCache() {
        FileSystem running;
        try {
            running = FileSystems.getFileSystem(URI.create("jrt:/"));
        } catch (RuntimeException e) {
            throw new IllegalStateException(
                    "warsha: this JVM exposes no jrt: filesystem, so the compiler cannot read the "
                            + "Java platform classes. This is a Warsha/CheerpJ problem, not a problem "
                            + "with your program.", e);
        }

        // getJrtFileSystem normalises before looking up; match it exactly.
        Path key = Paths.get(SYSTEM_HOME).toAbsolutePath().normalize();
        try {
            Field field = Class.forName(JRT_UTIL).getDeclaredField(JRT_CACHE_FIELD);
            field.setAccessible(true);
            ((Map<Path, FileSystem>) field.get(null)).put(key, running);
        } catch (ReflectiveOperationException | RuntimeException e) {
            throw new IllegalStateException(
                    "warsha: could not seed " + JRT_UTIL + "." + JRT_CACHE_FIELD + ". The bundled "
                            + "compiler is not the version this runtime was built against -- see "
                            + "fetch-compiler.sh and Platform's header.", e);
        }
    }
}
