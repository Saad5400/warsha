package warsha;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * Renders an uncaught throwable the way a real JVM does.
 *
 * The target is what `java` prints for classes carrying no line-number table,
 * character for character:
 *
 * <pre>
 * Exception in thread "main" java.lang.ArithmeticException: / by zero
 * 	at app.Main.main(Main.java)
 * </pre>
 *
 * Two things CheerpJ withholds have to be worked around. Both were measured
 * directly rather than read anywhere, and neither is a compiler flag we are
 * missing -- compiling with -g changes nothing:
 *
 *  1. Every frame reports getFileName() == null and getLineNumber() == 0,
 *     whatever the compiler was told. The file name is therefore reconstructed
 *     from an index Build writes; the line number is simply absent, exactly as
 *     it is for a real -g:none class. That is why frames end in "(Main.java)"
 *     and not "(Main.java:12)" -- both are shapes real java prints, so a
 *     student never sees an apology or a Warsha-ism.
 *  2. Implicitly thrown exceptions arrive with getMessage() == null, where a
 *     real JVM supplies one. Exactly one restoration is safe; see
 *     restoredMessage.
 *
 * The nesting, the "... N more" collapsing and the circular-reference guard
 * follow java.lang.Throwable.printStackTrace step for step, so a cause chain
 * reads the same here as it does in a terminal.
 */
final class Traces {

    /** Top-level binary name ("models.Person") -> source file ("Person.java"). */
    private final Map<String, String> sourceFiles;

    Traces(Map<String, String> sourceFiles) {
        this.sourceFiles = sourceFiles;
    }

    /**
     * Loads the class -> source-file index Build wrote for this run.
     *
     * Never throws: without the index every frame falls back to
     * &lt;SimpleName&gt;.java, which is already correct for the one-public-class-
     * per-file shape that almost all student code has.
     */
    static Traces forRun(String runId) {
        Map<String, String> index = new HashMap<String, String>();
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                    new FileInputStream(Build.sourceIndexFile(runId)), "UTF-8"));
            try {
                String line;
                while ((line = reader.readLine()) != null) {
                    int tab = line.indexOf('\t');
                    if (tab > 0) index.put(line.substring(0, tab), line.substring(tab + 1));
                }
            } finally {
                reader.close();
            }
        } catch (Throwable ignored) {
            // Fall back to simple names rather than lose the whole trace.
        }
        return new Traces(index);
    }

    // --- the whole block a student sees --------------------------------------

    /**
     * The complete uncaught-exception report, newline-terminated, ready for
     * System.err.print. `threadName` names the thread the throwable escaped
     * from -- "main" for the student's own main method.
     */
    String format(Throwable t, String threadName) {
        StringBuilder sb = new StringBuilder();
        sb.append("Exception in thread \"").append(threadName).append("\" ");

        Map<Throwable, Boolean> seen = new IdentityHashMap<Throwable, Boolean>();
        seen.put(t, Boolean.TRUE);

        List<StackTraceElement> frames = studentFrames(t.getStackTrace());
        sb.append(header(t)).append('\n');
        for (StackTraceElement frame : frames) {
            sb.append("\tat ").append(frameText(frame)).append('\n');
        }
        appendEnclosed(sb, t, frames, "", seen);
        return sb.toString();
    }

    /** Suppressed exceptions then the cause: Throwable's own order. */
    private void appendEnclosed(StringBuilder sb, Throwable t, List<StackTraceElement> frames,
                                String prefix, Map<Throwable, Boolean> seen) {
        for (Throwable suppressed : t.getSuppressed()) {
            appendNested(sb, suppressed, frames, "Suppressed: ", prefix + "\t", seen);
        }
        Throwable cause = t.getCause();
        if (cause != null) appendNested(sb, cause, frames, "Caused by: ", prefix, seen);
    }

    /**
     * One nested throwable, with the frames it shares with its enclosing trace
     * collapsed into "... N more".
     *
     * The comparison runs over the FILTERED traces, not the raw ones, so the
     * count matches the frames actually on screen. Frames are compared on class
     * and method alone: CheerpJ's file and line are null/0 for everything, so
     * StackTraceElement.equals would compare two fields that carry no
     * information anyway.
     */
    private void appendNested(StringBuilder sb, Throwable t, List<StackTraceElement> enclosing,
                              String caption, String prefix, Map<Throwable, Boolean> seen) {
        if (seen.containsKey(t)) {
            sb.append(prefix).append(caption)
              .append("[CIRCULAR REFERENCE: ").append(header(t)).append("]").append('\n');
            return;
        }
        seen.put(t, Boolean.TRUE);

        List<StackTraceElement> frames = studentFrames(t.getStackTrace());
        int mine = frames.size() - 1;
        int theirs = enclosing.size() - 1;
        while (mine >= 0 && theirs >= 0 && sameFrame(frames.get(mine), enclosing.get(theirs))) {
            mine--;
            theirs--;
        }
        int inCommon = frames.size() - 1 - mine;

        sb.append(prefix).append(caption).append(header(t)).append('\n');
        for (int i = 0; i <= mine; i++) {
            sb.append(prefix).append("\tat ").append(frameText(frames.get(i))).append('\n');
        }
        if (inCommon != 0) {
            sb.append(prefix).append("\t... ").append(inCommon).append(" more").append('\n');
        }

        appendEnclosed(sb, t, frames, prefix, seen);
    }

    private static boolean sameFrame(StackTraceElement a, StackTraceElement b) {
        return a.getClassName().equals(b.getClassName())
                && a.getMethodName().equals(b.getMethodName());
    }

    // --- the first line ------------------------------------------------------

    /** "java.lang.ArithmeticException: / by zero", or just the class name. */
    static String header(Throwable t) {
        String restored = restoredMessage(t);
        if (restored != null) return t.getClass().getName() + ": " + restored;
        try {
            // toString(), not getName() + getMessage(): a student who overrode
            // toString() on their own exception class should see their version,
            // which is what a real JVM prints.
            String text = t.toString();
            if (text != null) return text;
        } catch (Throwable broken) {
            // Their toString() threw. A real JVM would propagate; printing
            // which exception ended the program is more use to a beginner.
        }
        return t.getClass().getName();
    }

    /**
     * The message a real JVM would have carried, where that is deterministic.
     *
     * CheerpJ drops the message on every implicitly thrown exception, so
     * "java.lang.ArithmeticException" reaches us bare where a terminal shows
     * "java.lang.ArithmeticException: / by zero". Exactly one case can be
     * restored without guessing: the VM throws a message-less
     * ArithmeticException for integer division and remainder and for nothing
     * else, and real java says "/ by zero" for BOTH `/` and `%`.
     *
     * Nothing else is invented. A NullPointerException stays bare -- that is
     * not a compromise, it is what every JVM before 14 printed. Library
     * ArithmeticExceptions (BigDecimal's "Division by zero", Math.addExact's
     * "long overflow") are thrown from Java code, so their messages survive
     * CheerpJ and are returned by the getMessage() check below before this rule
     * is reached.
     *
     * The class is matched EXACTLY. A student's `class TooSmall extends
     * ArithmeticException` must not be handed a message it never had.
     */
    static String restoredMessage(Throwable t) {
        if (t.getMessage() != null) return null;
        if (t.getClass() == ArithmeticException.class) return "/ by zero";
        return null;
    }

    // --- frames --------------------------------------------------------------

    String frameText(StackTraceElement frame) {
        return frame.getClassName() + "." + frame.getMethodName()
                + "(" + sourceFileFor(frame.getClassName()) + ")";
    }

    /**
     * The file a class was declared in.
     *
     * Inner, local, anonymous and lambda classes all live in their outer
     * class's file, so everything from the first '$' on is dropped --
     * "app.Main$Helper" and "app.Main$$Lambda$1" both resolve through
     * "app.Main". Build's index then gives the real file name, which is the
     * only way to get "models/Shapes.java" right for a second, non-public class
     * declared there. Classes outside the project -- JDK frames sitting above
     * student code -- fall back to the simple name, which is what javac records
     * for them anyway.
     */
    String sourceFileFor(String className) {
        String topLevel = className;
        int dollar = topLevel.indexOf('$');
        if (dollar >= 0) topLevel = topLevel.substring(0, dollar);

        String known = sourceFiles.get(topLevel);
        if (known != null) return known;

        int dot = topLevel.lastIndexOf('.');
        String simple = dot >= 0 ? topLevel.substring(dot + 1) : topLevel;
        return simple.isEmpty() ? "Unknown Source" : simple + ".java";
    }

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
