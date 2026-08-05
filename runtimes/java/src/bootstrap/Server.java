package warsha;

import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * The resident command loop: one Server.main outlives every run in a session.
 *
 * Why residency matters: each cheerpjRunMain gets a FRESH classloader, so
 * anything run through its own main -- the old per-run Build and Launcher --
 * reloads ECJ and re-pays its warm-up on every single compile (~1.7s of the
 * ~2.1s a "warm" compile used to cost, measured 2026-08-05). One long-lived
 * main keeps ECJ's classes loaded and JIT-warmed, and gives Build a place to
 * keep state between runs (the compiled-output reuse cache).
 *
 * Server.main is also the bootstrap-cache gate. /files/ is IndexedDB-backed
 * and persists across page loads, so the compiled warsha.* classes from an
 * earlier session are usually already there. Starting this class IS the cache
 * probe:
 *
 *  - classes missing or unlinkable -> main never gets going, the worker's
 *    cheerpjRunMain settles, and the worker recompiles the bootstrap;
 *  - classes present but compiled from other sources -> Stamp.VALUE (compiled
 *    into the cache, see Stamp) disagrees with the hash the worker passed in,
 *    main reports phase "server" code 2 and returns, and the worker
 *    recompiles;
 *  - classes present and stamped -> the 5-10s in-browser bootstrap compile is
 *    skipped entirely.
 *
 * Commands arrive through Bridge.nextCommand, tab-separated. The loop is
 * single-threaded on purpose: the worker serializes commands, so one compile
 * or one student program runs at a time, exactly as before.
 *
 * Never calls System.exit -- see Bridge.
 */
public class Server {

    public static void main(String[] args) {
        String expectedStamp = args.length > 0 ? args[0] : "";

        // Force-load the whole bootstrap now. A half-written cache (a compile
        // interrupted mid-write) must fail HERE, where the worker's answer is
        // "recompile", not later inside a student's run where the answer would
        // be a broken session with a valid-looking cache.
        try {
            Class.forName("warsha.Bridge");
            Class.forName("warsha.Build");
            Class.forName("warsha.Launcher");
            Class.forName("warsha.Traces");
            Class.forName("warsha.Stamp");
        } catch (Throwable t) {
            // Bridge itself may be the broken class, so report nothing: the
            // settling of main is the signal the worker acts on.
            return;
        }

        if (!Stamp.VALUE.equals(expectedStamp)) {
            Bridge.phaseDone("server", "2");
            return;
        }

        try {
            Bridge.installStdout();
            Bridge.installStdin();
        } catch (Throwable t) {
            Bridge.writeInternal("warsha-server: stream install failed: " + t);
            Bridge.phaseDone("server", "3");
            return;
        }

        Bridge.phaseDone("server", "0");

        while (true) {
            String command = Bridge.nextCommand();
            if (command == null) return; // worker shutting the loop down
            try {
                handle(command);
            } catch (Throwable t) {
                // A failure here is ours, not the student's; label it as such
                // and keep the loop alive for the next run.
                StringWriter sw = new StringWriter();
                t.printStackTrace(new PrintWriter(sw));
                Bridge.writeDiag("warsha: internal command failure\n" + sw);
                Bridge.phaseDone(kindOf(command), "70");
            }
        }
    }

    /** "run\t&lt;runId&gt;\t&lt;entryPath&gt;" or "warm\t&lt;runId&gt;\t&lt;entryPath&gt;". */
    private static void handle(String command) {
        String[] parts = command.split("\t", 3);
        String kind = parts[0];
        String runId = parts[1];
        String entryPath = parts[2];

        if (kind.equals("warm")) {
            // Compile-only, never cached for reuse and never launched: its one
            // job is paying ECJ's first-compile warm-up before the student's
            // first Run has to.
            Build.Result result = Build.buildOrReuse(runId, entryPath, false);
            Bridge.phaseDone("warm", String.valueOf(result.code));
            return;
        }

        Build.Result result = Build.buildOrReuse(runId, entryPath, true);
        Bridge.phaseDone("compile", String.valueOf(result.code));
        if (result.code != 0) return;

        // result.runId, not runId: an unchanged project reuses the previous
        // run's compiled output, and the launcher must read main.txt and
        // classes.tsv from the directory that actually exists.
        int status = Launcher.launch(result.runId);
        Bridge.phaseDone("run", String.valueOf(status));
    }

    private static String kindOf(String command) {
        int tab = command.indexOf('\t');
        String kind = tab > 0 ? command.substring(0, tab) : command;
        return kind.equals("warm") ? "warm" : "compile";
    }
}
