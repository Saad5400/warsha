package warsha;

import java.io.File;
import java.io.FileOutputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

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

        topLevelTypes_findsEveryTypeInAFile();
        topLevelTypes_ignoresCommentsAndLiterals();
        topLevelTypes_ignoresNestedTypes();
        indexTypes_pairsBinaryNamesWithTheirFile();

        studentFrames_dropsReflectionAndLauncher();
        studentFrames_keepsPlatformAboveStudentCode();
        studentFrames_keepsLibraryFramesWhenNoStudentFrame();

        format_matchesARealJvmForDivideByZero();
        format_restoresNothingButDivideByZero();
        format_keepsAnExplicitMessage();
        format_namesTheFileEachClassWasDeclaredIn();
        format_collapsesSharedFramesInACauseChain();
        format_reportsTheRealThreadName();
        format_printsSuppressedExceptions();
        format_survivesCauseCycle();

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

    // --- warsha.Build.topLevelTypes / indexTypes -----------------------------

    /**
     * javac records the FILE in each class's SourceFile attribute, so the
     * second, non-public class in a file belongs to that file's name. Getting
     * this wrong sends a student looking for a source file that never existed.
     */
    private static void topLevelTypes_findsEveryTypeInAFile() {
        String source = "package models;\n"
            + "public class Shapes { }\n"
            + "class Circle { }\n"
            + "interface Drawable { }\n"
            + "enum Colour { RED }\n"
            + "@interface Marker { }\n";
        check("topLevelTypes: every top-level type, in order",
            "[Shapes, Circle, Drawable, Colour, Marker]",
            Build.topLevelTypes(source).toString());
    }

    /** A brace in a string literal must not shift the depth the scan relies on. */
    private static void topLevelTypes_ignoresCommentsAndLiterals() {
        String source = "package app;\n"
            + "// class Ghost { }\n"
            + "/* class AlsoGhost { } */\n"
            + "public class Main {\n"
            + "    String braces = \"} class Sneaky {\";\n"
            + "    char c = '}';\n"
            + "    String quote = \"\\\"} class Escaped {\";\n"
            + "}\n"
            + "class Real { }\n";
        check("topLevelTypes: comments and literals cannot invent a type",
            "[Main, Real]", Build.topLevelTypes(source).toString());
    }

    /** Inner classes are looked up through their outer name, so they need no entry. */
    private static void topLevelTypes_ignoresNestedTypes() {
        String source = "package app;\npublic class Main {\n  static class Helper { }\n  enum Mode { A }\n}\n";
        check("topLevelTypes: nested types are not top-level", "[Main]",
            Build.topLevelTypes(source).toString());
    }

    private static void indexTypes_pairsBinaryNamesWithTheirFile() {
        StringBuilder index = new StringBuilder();
        Build.indexTypes(index, "models/Shapes.java", "package models;\npublic class Shapes {}\nclass Circle {}\n");
        Build.indexTypes(index, "Root.java", "public class Root {}\n");
        check("indexTypes: package-qualified names against their own file",
            "models.Shapes\tShapes.java\nmodels.Circle\tShapes.java\nRoot\tRoot.java\n",
            index.toString());
    }

    // --- warsha.Traces.studentFrames ----------------------------------------

    /** The exact shape CheerpJ produced in the spike: 5 frames, 1 of them the student's. */
    private static void studentFrames_dropsReflectionAndLauncher() {
        StackTraceElement[] trace = {
            frame("app.Boom", "main"),
            frame("sun.reflect.NativeMethodAccessorImpl", "invoke"),
            frame("sun.reflect.DelegatingMethodAccessorImpl", "invoke"),
            frame("java.lang.reflect.Method", "invoke"),
            frame("warsha.Launcher", "main"),
        };
        List<StackTraceElement> kept = Traces.studentFrames(trace);
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
        List<StackTraceElement> kept = Traces.studentFrames(trace);
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
        List<StackTraceElement> kept = Traces.studentFrames(trace);
        check("studentFrames: no student frame -> keep the library frames", 2, kept.size());
    }

    // --- warsha.Traces.format -----------------------------------------------

    /** The project the format tests pretend to be running. */
    private static Traces traces() {
        Map<String, String> index = new HashMap<String, String>();
        index.put("app.Crash", "Crash.java");
        index.put("models.Calculator", "Calculator.java");
        // The case the simple-name fallback would get wrong: two top-level
        // classes in one file, so models.Circle lives in Shapes.java.
        index.put("models.Shapes", "Shapes.java");
        index.put("models.Circle", "Shapes.java");
        return new Traces(index);
    }

    /**
     * The whole point of this class, asserted as one exact string: what a real
     * `java` prints for the same program compiled without line numbers. Any
     * drift in spacing, punctuation or the restored message fails here.
     */
    private static void format_matchesARealJvmForDivideByZero() {
        ArithmeticException e = new ArithmeticException(); // CheerpJ: no message
        e.setStackTrace(new StackTraceElement[] {
            frame("models.Calculator", "divide"),
            frame("app.Crash", "main"),
            frame("sun.reflect.NativeMethodAccessorImpl", "invoke"),
            frame("java.lang.reflect.Method", "invoke"),
            frame("warsha.Launcher", "main"),
        });
        check("format: byte-for-byte a real JVM's divide-by-zero report",
            "Exception in thread \"main\" java.lang.ArithmeticException: / by zero\n"
                + "\tat models.Calculator.divide(Calculator.java)\n"
                + "\tat app.Crash.main(Crash.java)\n",
            traces().format(e, "main"));
    }

    /**
     * Restoration is one rule, not a habit. A bare NullPointerException is what
     * every JVM before 14 printed, so leaving it bare IS the faithful output;
     * inventing "cannot invoke method on null" would not be.
     */
    private static void format_restoresNothingButDivideByZero() {
        check("restoredMessage: implicit ArithmeticException", "/ by zero",
            Traces.restoredMessage(new ArithmeticException()));
        check("restoredMessage: NullPointerException stays bare", null,
            Traces.restoredMessage(new NullPointerException()));
        check("restoredMessage: ArrayIndexOutOfBounds stays bare", null,
            Traces.restoredMessage(new ArrayIndexOutOfBoundsException()));
        check("restoredMessage: a real message is never replaced", null,
            Traces.restoredMessage(new ArithmeticException("Non-terminating decimal expansion")));
        // A student's own subclass must not be handed a message it never had.
        check("restoredMessage: a subclass of ArithmeticException stays bare", null,
            Traces.restoredMessage(new TooSmall()));

        NullPointerException npe = new NullPointerException();
        npe.setStackTrace(new StackTraceElement[] { frame("app.Crash", "main") });
        check("format: bare NPE, with no ': null' bolted on",
            "Exception in thread \"main\" java.lang.NullPointerException\n"
                + "\tat app.Crash.main(Crash.java)\n",
            traces().format(npe, "main"));
    }

    private static void format_keepsAnExplicitMessage() {
        IllegalStateException e = new IllegalStateException("boom");
        e.setStackTrace(new StackTraceElement[] { frame("app.Crash", "main") });
        check("format: an explicitly thrown message survives verbatim",
            "Exception in thread \"main\" java.lang.IllegalStateException: boom\n"
                + "\tat app.Crash.main(Crash.java)\n",
            traces().format(e, "main"));
    }

    /**
     * Three naming paths: the index (Circle -> Shapes.java, which no fallback
     * could guess), an inner class resolving through its outer name, and a JDK
     * class the index has never heard of.
     */
    private static void format_namesTheFileEachClassWasDeclaredIn() {
        Traces t = traces();
        check("sourceFileFor: a second class in one file", "Shapes.java",
            t.sourceFileFor("models.Circle"));
        check("sourceFileFor: an inner class uses its outer file", "Shapes.java",
            t.sourceFileFor("models.Shapes$Inner"));
        check("sourceFileFor: a lambda uses its outer file", "Crash.java",
            t.sourceFileFor("app.Crash$$Lambda$1"));
        check("sourceFileFor: an unknown class falls back to its simple name", "Integer.java",
            t.sourceFileFor("java.lang.Integer"));
        check("sourceFileFor: default package", "Main.java", t.sourceFileFor("Main"));
    }

    /** The "... N more" arithmetic, which real java does over the shared tail. */
    private static void format_collapsesSharedFramesInACauseChain() {
        Exception root = new IllegalArgumentException("bad id");
        root.setStackTrace(new StackTraceElement[] {
            frame("models.Calculator", "lookup"),
            frame("models.Calculator", "divide"),
            frame("app.Crash", "main"),
        });
        RuntimeException wrapper = new RuntimeException("lookup failed", root);
        wrapper.setStackTrace(new StackTraceElement[] {
            frame("models.Calculator", "divide"),
            frame("app.Crash", "main"),
        });

        check("format: cause chain with the shared tail collapsed",
            "Exception in thread \"main\" java.lang.RuntimeException: lookup failed\n"
                + "\tat models.Calculator.divide(Calculator.java)\n"
                + "\tat app.Crash.main(Crash.java)\n"
                + "Caused by: java.lang.IllegalArgumentException: bad id\n"
                + "\tat models.Calculator.lookup(Calculator.java)\n"
                + "\t... 2 more\n",
            traces().format(wrapper, "main"));
    }

    private static void format_reportsTheRealThreadName() {
        RuntimeException e = new RuntimeException("off main");
        e.setStackTrace(new StackTraceElement[] { frame("app.Crash", "run") });
        checkContains("format: a student's own thread is named as java names it",
            traces().format(e, "Thread-0"),
            "Exception in thread \"Thread-0\" java.lang.RuntimeException: off main");
    }

    private static void format_printsSuppressedExceptions() {
        RuntimeException e = new RuntimeException("closing failed");
        e.setStackTrace(new StackTraceElement[] { frame("app.Crash", "main") });
        RuntimeException suppressed = new IllegalStateException("stream already shut");
        suppressed.setStackTrace(new StackTraceElement[] { frame("models.Calculator", "close") });
        e.addSuppressed(suppressed);

        check("format: suppressed exceptions are indented under their owner",
            "Exception in thread \"main\" java.lang.RuntimeException: closing failed\n"
                + "\tat app.Crash.main(Crash.java)\n"
                + "\tSuppressed: java.lang.IllegalStateException: stream already shut\n"
                + "\t\tat models.Calculator.close(Calculator.java)\n",
            traces().format(e, "main"));
    }

    /** A self-referential cause must not spin forever. */
    private static void format_survivesCauseCycle() {
        Throwable a = new RuntimeException("a");
        Throwable b = new RuntimeException("b", a);
        a.setStackTrace(new StackTraceElement[] { frame("app.Crash", "go") });
        b.setStackTrace(new StackTraceElement[] { frame("app.Crash", "main") });
        try {
            a.initCause(b); // a -> b -> a
        } catch (IllegalStateException ignored) {
            // initCause after a cause-taking constructor is refused on some JVMs;
            // the guard is still worth exercising with what we have.
        }
        String out = traces().format(b, "main");
        checkContains("format: a cause cycle still prints the head", out,
            "Exception in thread \"main\" java.lang.RuntimeException: b");
        checkContains("format: a cause cycle is reported, not followed", out,
            "[CIRCULAR REFERENCE: java.lang.RuntimeException: b]");
    }

    /** Stands in for a student writing their own exception type. */
    private static final class TooSmall extends ArithmeticException {
        private static final long serialVersionUID = 1L;
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
