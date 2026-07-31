package warsha;

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
        sb.append(prefix).append(t.toString()).append('\n');

        for (StackTraceElement frame : studentFrames(t.getStackTrace())) {
            sb.append("\tat ").append(frame.getClassName()).append('.')
              .append(frame.getMethodName()).append(" (line unknown)").append('\n');
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
