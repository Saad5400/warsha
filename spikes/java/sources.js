// Warsha spike — the hardcoded Java project, plus the small Warsha runtime that
// is compiled alongside it.
//
// IMPORTANT: keys are FLAT filenames, not paths. cheerpOSAddStringFile("/str/a/b.java")
// creates an entry Java cannot see (javac: "file not found") — /str/ has no
// directories. javac does not require sources to sit in package-shaped folders,
// only that the file basename matches the public class name, so flat works as
// long as basenames are unique. For real projects the fix is to copy sources into
// package-shaped directories under /files/ from inside Java (see SPIKE.md).

// --- the "student project": 3 files, 2 packages, inheritance across packages --
const STUDENT_SOURCES = {
  "Person.java": `package models;

public class Person {
    protected String name;
    protected int age;

    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    public String getName() { return name; }
    public int getAge() { return age; }

    public String describe() {
        return "Person " + name + " (" + age + ")";
    }
}
`,
  "Student.java": `package models;

public class Student extends Person {
    private String major;

    public Student(String name, int age, String major) {
        super(name, age);
        this.major = major;
    }

    public String getMajor() { return major; }

    @Override
    public String describe() {
        return "Student " + name + " (" + age + ") majoring in " + major;
    }
}
`,
  "Main.java": `package app;

import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;
import models.Person;
import models.Student;

public class Main {
    public static void main(String[] args) {
        System.out.println("=== Warsha Java spike (worker) === build-token=WORKER-1");
        System.out.println("java.version = " + System.getProperty("java.version"));

        List<Person> people = new ArrayList<Person>();
        people.add(new Person("Layla", 41));
        people.add(new Student("Omar", 20, "Computer Science"));

        for (Person p : people) {
            System.out.println("  -> " + p.describe());
            System.out.println("     instanceof Student? " + (p instanceof Student));
        }

        Scanner sc = new Scanner(System.in);

        System.out.print("Enter your name: ");
        String name = sc.nextLine();
        System.out.println("Hello, " + name + "!");

        System.out.print("Enter your age: ");
        String ageLine = sc.nextLine();
        int age;
        try {
            age = Integer.parseInt(ageLine.trim());
        } catch (NumberFormatException e) {
            System.err.println("(stderr) not a number: '" + ageLine + "', defaulting to 0");
            age = 0;
        }

        Student you = new Student(name, age, "Warsha 101");
        System.out.println("Created: " + you.describe());
        System.out.println("Superclass method getName() -> " + you.getName());
        System.out.println("=== done, exit 0 ===");
    }
}
`,
  "Loop.java": `package app;

public class Loop {
    public static void main(String[] args) {
        System.out.println("Loop: entering a loop that never yields. Press Stop.");
        long i = 0;
        while (true) {
            i++;
        }
    }
}
`,
  // The exact beginner shape Education cares about: System.out.print with NO
  // trailing newline, immediately followed by a blocking read.
  "Prompt.java": `package app;

import java.util.Scanner;

public class Prompt {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);

        // 1. partial line (no newline) must be on screen BEFORE the read blocks
        System.out.print("Name: ");
        String name = sc.nextLine();
        System.out.println("[echo] you typed: " + name);

        // 2. same again, token-based read (nextInt) rather than nextLine
        System.out.print("Age: ");
        int age = sc.nextInt();
        sc.nextLine(); // consume the rest of the line
        System.out.println("[echo] age parsed as int: " + age);

        // 3. inline echo: prompt, read, and answer all on one visual line
        System.out.print("City: ");
        String city = sc.nextLine();
        System.out.print("[echo] ");
        System.out.print(city);
        System.out.println(" <- printed with three separate calls, no newline until here");

        System.out.println("PROMPT-TEST-OK " + name + "/" + age + "/" + city);
    }
}
`,
  "Env.java": `package app;

public class Env {
    public static void main(String[] args) {
        System.out.println("java.version      = " + System.getProperty("java.version"));
        System.out.println("java.home         = " + System.getProperty("java.home"));
        System.out.println("java.class.path   = " + System.getProperty("java.class.path"));
        System.out.println("sun.boot.class.path = " + System.getProperty("sun.boot.class.path"));
        System.out.println("os.name           = " + System.getProperty("os.name"));
        System.out.println("file.encoding     = " + System.getProperty("file.encoding"));
    }
}
`,
  "Boom.java": `package app;

public class Boom {
    public static void main(String[] args) {
        StackTraceElement here = new Throwable().getStackTrace()[0];
        System.out.println("probe: file=" + here.getFileName() + " line=" + here.getLineNumber());
        try {
            int x = 0;
            System.out.println(42 / x);
        } catch (ArithmeticException ex) {
            System.out.println("caught: " + ex + " | getMessage()=" + ex.getMessage());
            StackTraceElement st = ex.getStackTrace()[0];
            System.out.println("st[0]: class=" + st.getClassName() + " method=" + st.getMethodName()
                + " file=" + st.getFileName() + " line=" + st.getLineNumber());
            throw ex;
        }
    }
}
`
};

// --- Warsha runtime, compiled together with the student's code --------------
const RUNTIME_SOURCES = {
  "Bridge.java": `package warsha;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;

/** JS <-> Java bridge. All three natives are implemented in jvm.worker.js. */
public class Bridge {

    /** Blocks until the user submits a line; null means EOF. */
    public static native String readLine();

    public static native void writeOut(String s);
    public static native void writeErr(String s);

    public static void installStdin() {
        System.setIn(new InputStream() {
            private byte[] buf = new byte[0];
            private int pos = 0;

            private boolean fill() throws IOException {
                while (pos >= buf.length) {
                    String line = readLine();
                    if (line == null) return false; // EOF
                    buf = (line + "\\n").getBytes("UTF-8");
                    pos = 0;
                }
                return true;
            }

            @Override
            public int read() throws IOException {
                if (!fill()) return -1;
                return buf[pos++] & 0xFF;
            }

            /**
             * MUST be overridden. InputStream's default bulk read keeps calling
             * read() until it has len bytes or hits EOF, so Scanner's 1024-byte
             * request would block forever asking for more lines. Returning only
             * what is buffered is the real console semantic.
             */
            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                if (len == 0) return 0;
                if (!fill()) return -1;
                int n = Math.min(len, buf.length - pos);
                System.arraycopy(buf, pos, b, off, n);
                pos += n;
                return n;
            }

            @Override
            public int available() { return buf.length - pos; }
        });
    }

    /** A worker has no DOM, so CheerpJ's #console element is unavailable. */
    public static void installStdout() throws UnsupportedEncodingException {
        System.setOut(new PrintStream(new NativeOut(false), true, "UTF-8"));
        System.setErr(new PrintStream(new NativeOut(true), true, "UTF-8"));
    }

    private static final class NativeOut extends OutputStream {
        private final boolean err;
        private final StringBuilder sb = new StringBuilder();
        NativeOut(boolean err) { this.err = err; }

        @Override
        public void write(int b) { sb.append((char) (b & 0xFF)); flushIfAny(); }

        @Override
        public void write(byte[] b, int off, int len) {
            try {
                sb.append(new String(b, off, len, "UTF-8"));
            } catch (UnsupportedEncodingException e) {
                sb.append(new String(b, off, len));
            }
            flushIfAny();
        }

        // Emit on every write so that prompts without a trailing newline
        // (System.out.print("Enter name: ")) reach the page immediately.
        private void flushIfAny() {
            if (sb.length() == 0) return;
            String s = sb.toString();
            sb.setLength(0);
            if (err) writeErr(s); else writeOut(s);
        }
    }
}
`,
  "Launcher.java": `package warsha;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

public class Launcher {
    public static void main(String[] args) throws Exception {
        Bridge.installStdout();
        Bridge.installStdin();

        String mainClass = args[0];
        String[] rest = new String[args.length - 1];
        System.arraycopy(args, 1, rest, 0, rest.length);

        Method m = Class.forName(mainClass).getMethod("main", String[].class);
        try {
            m.invoke(null, (Object) rest);
        } catch (InvocationTargetException e) {
            // Unwrap so students see their own stack trace, not ours.
            Throwable cause = e.getCause() == null ? e : e.getCause();
            cause.printStackTrace();
            System.out.flush();
            System.err.flush();
            System.exit(1);
        }
        System.out.flush();
        System.err.flush();
    }
}
`,
  "Bench.java": `package warsha;

public class Bench {
    public static void main(String[] args) {
        int n = 2000;
        long t0 = System.nanoTime();
        for (int i = 0; i < n; i++) {
            System.out.println("line " + i + " of " + n);
        }
        long ms = (System.nanoTime() - t0) / 1000000L;
        System.out.println("BENCH: " + n + " println in " + ms + " ms = "
            + String.format("%.2f", (ms * 1000.0 / n)) + " us/line");
    }
}
`
};

const WARSHA_SOURCES = Object.assign({}, RUNTIME_SOURCES, STUDENT_SOURCES);

// A deliberately broken Main, to inspect the quality of javac diagnostics
// (do they carry file + line so we can map them back to the editor?).
const BROKEN_SOURCES = Object.assign({}, WARSHA_SOURCES, {
  "Main.java": `package app;

import models.Student;

public class Main {
    public static void main(String[] args) {
        Student s = new Student("Omar", 20, "CS");
        int n = s.getName();          // incompatible types: String -> int
        s.noSuchMethod();             // cannot find symbol
        System.out.println(n)         // ';' expected
    }
}
`
});
