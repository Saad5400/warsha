package warsha;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;

/**
 * Runs the student's main method and reports what happened.
 *
 * Called by the resident Server rather than run as a main of its own: a
 * cheerpjRunMain per run would reload every class each time (see Server). The
 * student's classes load through a FRESH URLClassLoader over this run's out/
 * directory instead, which is what a fresh classpath used to provide: two runs
 * can never see each other's classes, and an edited class can never be shadowed
 * by a stale one.
 *
 * Never calls System.exit: one CheerpJ JVM serves every run in a session, so
 * exiting would strand all later runs. The exit status is returned to Server,
 * which reports it through Bridge.phaseDone.
 *
 * Uncaught throwables are rendered by Traces, in Java, where frames are still
 * structured objects. Doing it here rather than by pattern-matching text in JS
 * is what makes "Exception in thread ..." identical to a real JVM's: the
 * message restoration and the "... N more" collapsing both need the object
 * graph, not the string.
 */
public class Launcher {

    /**
     * The name a real JVM prints for the thread running main.
     *
     * Hardcoded rather than read from Thread.currentThread(): CheerpJ runs
     * cheerpjRunMain on a thread of its own choosing and we are not going to
     * show a student "Exception in thread "cheerpj-1"" for their own main
     * method. Threads the student starts themselves report their real names --
     * those go through the default handler installed below.
     */
    private static final String MAIN_THREAD = "main";

    /**
     * Runs the entry class of `runId` and returns its status: 0 for a clean
     * return, 1 for an uncaught throwable or a missing/invalid entry point.
     * The Bridge streams are already installed by Server, once per session.
     */
    static int launch(String runId) {
        final Traces traces = Traces.forRun(runId);
        installThreadHandler(traces);

        int status = 0;
        try {
            String mainClass = readMainClass(runId);
            URLClassLoader loader = new URLClassLoader(
                    new URL[] { Build.outDir(runId).toURI().toURL() },
                    Launcher.class.getClassLoader());
            Method main = Class.forName(mainClass, true, loader).getMethod("main", String[].class);
            try {
                main.invoke(null, (Object) new String[0]);
            } catch (InvocationTargetException e) {
                Throwable cause = e.getCause() == null ? e : e.getCause();
                System.err.print(traces.format(cause, MAIN_THREAD));
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
            System.err.print(traces.format(t, MAIN_THREAD));
            status = 1;
        }

        System.out.flush();
        System.err.flush();
        return status;
    }

    /**
     * Makes an exception on a thread the student started look like one on main.
     *
     * Without this the JVM's own handler prints the trace, which under CheerpJ
     * means bare "(Unknown Source)" frames and no "/ by zero" -- the output this
     * class exists to replace. It reports the thread's real name, as java does.
     *
     * Guarded: if CheerpJ ever refuses the call, a single-threaded program
     * (which is all the curriculum has) must not lose its own trace over it.
     */
    private static void installThreadHandler(final Traces traces) {
        try {
            Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
                @Override
                public void uncaughtException(Thread thread, Throwable problem) {
                    System.err.print(traces.format(problem, thread.getName()));
                    System.err.flush();
                }
            });
        } catch (Throwable ignored) {
            // The main path below does not depend on this.
        }
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
}
