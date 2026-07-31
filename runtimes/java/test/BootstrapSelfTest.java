package warsha;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;

import org.eclipse.jdt.core.compiler.batch.BatchCompiler;

/**
 * Offline checks for the parts of the bootstrap that do not need CheerpJ.
 *
 * Bridge's natives cannot link outside the browser, so anything that prints
 * through them has to be verified in the harness instead (tasks #4/#5). What can
 * be checked here is the pure logic, and it is the logic most likely to break
 * quietly: entry-point naming, and the stack-trace filtering that Education's
 * "how many frames does a student see" requirement rests on.
 *
 * Run via validate.sh. Exits non-zero on the first failure count > 0.
 */
public final class BootstrapSelfTest {

    private static int failures = 0;

    public static void main(String[] args) throws Exception {
        mainClassOf_usesPackageDeclaration();
        mainClassOf_defaultPackage();
        mainClassOf_ignoresCommentedOutPackage();
        mainClassOf_toleratesOddSpacing();

        studentFrames_dropsReflectionAndLauncher();
        studentFrames_keepsPlatformAboveStudentCode();
        studentFrames_keepsLibraryFramesWhenNoStudentFrame();

        render_labelsLinesUnknown();
        render_includesMessageWhenPresent();
        render_followsCauseChain();
        render_survivesCauseCycle();

        ecj_reportsDiagnosticsOnAKnownChannel();
        ecj_compilesTwoPackagesWithInheritance();

        if (failures > 0) {
            System.out.println("FAIL: " + failures + " check(s) failed");
            // No System.exit inside the bootstrap classes themselves; this is a
            // test driver, so exiting is how validate.sh learns the result.
            System.exit(1);
        }
        System.out.println("OK: all bootstrap self-tests passed");
    }

    // --- warsha.Build.mainClassOf --------------------------------------------

    private static void mainClassOf_usesPackageDeclaration() {
        check("mainClassOf: package + path",
            "app.Main",
            Build.mainClassOf("app/Main.java", "package app;\npublic class Main {}"));
    }

    private static void mainClassOf_defaultPackage() {
        check("mainClassOf: default package",
            "Main",
            Build.mainClassOf("Main.java", "public class Main {}"));
    }

    /**
     * A commented-out package line deciding where a class is staged would surface
     * later as an unrelated "cannot find symbol", which is why Build strips
     * comments before matching.
     */
    private static void mainClassOf_ignoresCommentedOutPackage() {
        check("mainClassOf: // commented package ignored",
            "Main",
            Build.mainClassOf("Main.java", "// package wrong;\npublic class Main {}"));
        check("mainClassOf: /* commented */ package ignored",
            "Main",
            Build.mainClassOf("Main.java", "/* package wrong; */\npublic class Main {}"));
        check("mainClassOf: real package after a comment still found",
            "app.Main",
            Build.mainClassOf("app/Main.java", "/* header */\npackage app;\npublic class Main {}"));
    }

    private static void mainClassOf_toleratesOddSpacing() {
        check("mainClassOf: spaces around dots",
            "com.example.app.Main",
            Build.mainClassOf("Main.java", "package com . example . app ;\npublic class Main {}"));
    }

    // --- warsha.Launcher.studentFrames --------------------------------------

    /** The exact shape CheerpJ produced in the spike: 5 frames, 1 of them the student's. */
    private static void studentFrames_dropsReflectionAndLauncher() {
        StackTraceElement[] trace = {
            frame("app.Boom", "main"),
            frame("sun.reflect.NativeMethodAccessorImpl", "invoke"),
            frame("sun.reflect.DelegatingMethodAccessorImpl", "invoke"),
            frame("java.lang.reflect.Method", "invoke"),
            frame("warsha.Launcher", "main"),
        };
        List<StackTraceElement> kept = Launcher.studentFrames(trace);
        check("studentFrames: 5 frames -> 1", 1, kept.size());
        if (kept.size() == 1) {
            check("studentFrames: keeps the student's frame", "app.Boom", kept.get(0).getClassName());
        }
    }

    /** "at java.lang.Integer.parseInt" is the useful half of a bad-input crash. */
    private static void studentFrames_keepsPlatformAboveStudentCode() {
        StackTraceElement[] trace = {
            frame("java.lang.NumberFormatException", "forInputString"),
            frame("java.lang.Integer", "parseInt"),
            frame("app.Main", "main"),
            frame("sun.reflect.NativeMethodAccessorImpl", "invoke"),
            frame("warsha.Launcher", "main"),
        };
        List<StackTraceElement> kept = Launcher.studentFrames(trace);
        check("studentFrames: keeps platform frames above student code", 3, kept.size());
        if (kept.size() == 3) {
            check("studentFrames: deepest kept frame is the student's",
                "app.Main", kept.get(2).getClassName());
        }
    }

    private static void studentFrames_keepsLibraryFramesWhenNoStudentFrame() {
        StackTraceElement[] trace = {
            frame("java.util.Scanner", "throwFor"),
            frame("java.util.Scanner", "nextInt"),
            frame("warsha.Launcher", "main"),
        };
        List<StackTraceElement> kept = Launcher.studentFrames(trace);
        check("studentFrames: no student frame -> keep the library frames", 2, kept.size());
    }

    // --- warsha.Launcher.render ---------------------------------------------

    private static void render_labelsLinesUnknown() {
        RuntimeException e = new ArithmeticException();
        e.setStackTrace(new StackTraceElement[] {
            frame("app.Boom", "main"),
            frame("warsha.Launcher", "main"),
        });
        String out = Launcher.render(e);
        checkContains("render: exception header", out, "java.lang.ArithmeticException");
        checkContains("render: frame with unknown line", out, "\tat app.Boom.main (line unknown)");
        checkAbsent("render: launcher frame hidden", out, "warsha.Launcher");
        // CheerpJ omits implicit messages, so a bare header must not gain ": null".
        checkAbsent("render: no ': null' for a message-less throwable", out, ": null");
    }

    private static void render_includesMessageWhenPresent() {
        IllegalStateException e = new IllegalStateException("tank empty");
        e.setStackTrace(new StackTraceElement[] { frame("app.Main", "run") });
        checkContains("render: keeps the message", Launcher.render(e),
            "java.lang.IllegalStateException: tank empty");
    }

    private static void render_followsCauseChain() {
        Exception root = new IllegalArgumentException("bad id");
        root.setStackTrace(new StackTraceElement[] { frame("app.Repo", "find") });
        RuntimeException wrapper = new RuntimeException("lookup failed", root);
        wrapper.setStackTrace(new StackTraceElement[] { frame("app.Main", "main") });

        String out = Launcher.render(wrapper);
        checkContains("render: wrapper", out, "java.lang.RuntimeException: lookup failed");
        checkContains("render: cause header", out, "Caused by: java.lang.IllegalArgumentException: bad id");
        checkContains("render: cause frame", out, "\tat app.Repo.find (line unknown)");
    }

    /** A self-referential cause must not spin forever. */
    private static void render_survivesCauseCycle() {
        Throwable a = new RuntimeException("a");
        Throwable b = new RuntimeException("b", a);
        a.setStackTrace(new StackTraceElement[] { frame("app.A", "go") });
        b.setStackTrace(new StackTraceElement[] { frame("app.B", "go") });
        try {
            a.initCause(b); // a -> b -> a
        } catch (IllegalStateException ignored) {
            // initCause after a cause-taking constructor is refused on some JVMs;
            // the guard is still worth exercising with what we have.
        }
        String out = Launcher.render(b);
        checkContains("render: cycle still prints the head", out, "java.lang.RuntimeException: b");
    }

    // --- ECJ behaviour that Build depends on --------------------------------

    /**
     * Build sends errText if it is non-empty and otherwise outText. That rule is
     * only correct if ECJ actually puts problems on one of those two writers, so
     * pin the behaviour down here rather than discovering it in a browser.
     */
    private static void ecj_reportsDiagnosticsOnAKnownChannel() throws Exception {
        File dir = tempDir("ecj-bad");
        File src = new File(dir, "Bad.java");
        write(src, "public class Bad { void x() { int i = \"nope\"; } }\n");

        StringWriter out = new StringWriter();
        StringWriter err = new StringWriter();
        PrintWriter outW = new PrintWriter(out);
        PrintWriter errW = new PrintWriter(err);
        boolean ok = BatchCompiler.compile(
            new String[] { src.getPath(), "-d", new File(dir, "out").getPath(),
                           "-1.8", "-g", "-proc:none", "-nowarn", "-encoding", "UTF-8" },
            outW, errW, null);
        outW.flush();
        errW.flush();

        check("ecj: broken source fails the compile", false, ok);

        String chosen = err.toString().isEmpty() ? out.toString() : err.toString();
        checkContains("ecj: Build's channel rule yields the error text", chosen, "ERROR");
        checkContains("ecj: diagnostic names the file", chosen, "Bad.java");
        checkContains("ecj: diagnostic carries a line number", chosen, "at line 1");
        System.out.println("  note: ECJ wrote problems to "
            + (err.toString().isEmpty() ? "the OUT writer" : "the ERR writer")
            + " (out=" + out.toString().length() + " bytes, err=" + err.toString().length() + " bytes)");
    }

    /**
     * The shape the product actually ships: two packages, inheritance across
     * them, compiled from a package-shaped tree the way Build stages it.
     */
    private static void ecj_compilesTwoPackagesWithInheritance() throws Exception {
        File dir = tempDir("ecj-ok");
        File src = new File(dir, "src");
        File out = new File(dir, "out");
        File models = new File(src, "models");
        File app = new File(src, "app");
        if (!models.mkdirs() || !app.mkdirs() || !out.mkdirs()) {
            throw new IllegalStateException("cannot create fixture dirs");
        }
        write(new File(models, "Person.java"),
            "package models;\npublic class Person {\n"
            + "  protected String name;\n"
            + "  public Person(String n) { name = n; }\n"
            + "  public String describe() { return \"Person \" + name; }\n}\n");
        write(new File(models, "Student.java"),
            "package models;\npublic class Student extends Person {\n"
            + "  public Student(String n) { super(n); }\n"
            + "  @Override public String describe() { return \"Student \" + name; }\n}\n");
        write(new File(app, "Main.java"),
            "package app;\nimport models.Person;\nimport models.Student;\n"
            + "public class Main { public static void main(String[] a) {\n"
            + "  Person p = new Student(\"Omar\");\n"
            + "  System.out.println(p.describe());\n} }\n");

        StringWriter o = new StringWriter();
        StringWriter e = new StringWriter();
        PrintWriter oW = new PrintWriter(o);
        PrintWriter eW = new PrintWriter(e);
        boolean ok = BatchCompiler.compile(
            new String[] {
                new File(app, "Main.java").getPath(),
                new File(models, "Person.java").getPath(),
                new File(models, "Student.java").getPath(),
                "-d", out.getPath(), "-1.8", "-g", "-proc:none", "-nowarn", "-encoding", "UTF-8" },
            oW, eW, null);
        oW.flush();
        eW.flush();

        check("ecj: two packages + inheritance compile", true, ok);
        if (!ok) System.out.println("  compiler said: " + o + e);
        check("ecj: app/Main.class produced", true, new File(out, "app/Main.class").isFile());
        check("ecj: models/Student.class produced", true, new File(out, "models/Student.class").isFile());

        // The entry name Build would hand to Launcher for this project.
        check("build+ecj agree on the binary name", "app.Main",
            Build.mainClassOf("app/Main.java", read(new File(app, "Main.java"))));
    }

    // --- tiny assertion helpers ---------------------------------------------

    private static StackTraceElement frame(String cls, String method) {
        // File null / line 0 is exactly what CheerpJ reports for every frame.
        return new StackTraceElement(cls, method, null, 0);
    }

    private static void check(String what, Object expected, Object actual) {
        if (expected == null ? actual == null : expected.equals(actual)) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what + "\n       expected: " + expected + "\n       actual:   " + actual);
            failures++;
        }
    }

    private static void checkContains(String what, String haystack, String needle) {
        if (haystack != null && haystack.contains(needle)) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what + "\n       missing: " + needle + "\n       in:      " + haystack);
            failures++;
        }
    }

    private static void checkAbsent(String what, String haystack, String needle) {
        if (haystack == null || !haystack.contains(needle)) {
            System.out.println("ok   " + what);
        } else {
            System.out.println("FAIL " + what + "\n       should not contain: " + needle
                + "\n       in: " + haystack);
            failures++;
        }
    }

    private static File tempDir(String name) throws Exception {
        File base = File.createTempFile("warsha-" + name, "");
        if (!base.delete() || !base.mkdirs()) throw new IllegalStateException("cannot create " + base);
        return base;
    }

    private static void write(File f, String text) throws Exception {
        FileOutputStream s = new FileOutputStream(f);
        try {
            s.write(text.getBytes("UTF-8"));
        } finally {
            s.close();
        }
    }

    private static String read(File f) throws Exception {
        java.io.InputStream in = new java.io.FileInputStream(f);
        try {
            java.io.ByteArrayOutputStream buf = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[4096];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            return new String(buf.toByteArray(), "UTF-8");
        } finally {
            in.close();
        }
    }
}
