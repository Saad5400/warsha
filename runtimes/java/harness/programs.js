/* Scenarios the harness drives the module with.
 *
 * Paths are the ones a student would see in the editor, exactly as they are
 * handed to run(). Note in particular the `same-name` scenario: two classes both
 * called Item, in different packages. That combination is what breaks a runtime
 * that writes sources into CheerpJ's flat /str/ namespace, and it is entirely
 * plausible in a teaching project.
 */

export const PROGRAMS = {
  // (a) The language level itself. Every construct here is a compile error on
  // Java 8, so this scenario failing means the runtime has silently fallen back
  // to the old engine -- or that warsha.Platform stopped being able to show ECJ
  // the module image, which is the one genuinely fragile part of the Java 17
  // support (see bootstrap/Platform.java).
  'java17': {
    label: 'Java 17 language features',
    entry: 'app/Modern.java',
    files: [
      {
        path: 'app/Modern.java',
        content: `package app;

import java.util.List;

public class Modern {

    record Point(int x, int y) {
        int sum() { return x + y; }
    }

    sealed interface Shape permits Circle, Square {}
    record Circle(double radius) implements Shape {}
    record Square(double side) implements Shape {}

    enum Day { SAT, SUN, MON }

    static String describe(Shape shape) {
        if (shape instanceof Circle c) return "circle r=" + c.radius();
        if (shape instanceof Square s) return "square side=" + s.side();
        return "unknown";
    }

    static String kind(Day day) {
        return switch (day) {
            case SAT, SUN -> "weekend";
            case MON -> "weekday";
        };
    }

    public static void main(String[] args) {
        var point = new Point(3, 4);
        System.out.println("record    : " + point + " sum=" + point.sum());
        System.out.println("pattern   : " + describe(new Circle(2.5)));
        System.out.println("switch    : " + kind(Day.SAT) + ", " + kind(Day.MON));

        var names = List.of("Sara", "Omar", "Layla");
        System.out.println("var+List  : " + String.join(", ", names));

        String block = """
                text blocks
                really work""";
        System.out.println("textblock : " + block.replace("\\n", " / "));

        System.out.println("MODERN-TEST-OK " + System.getProperty("java.version"));
    }
}
`,
      },
    ],
  },

  // (b) Education's prompt-before-read criteria: a partial line with NO trailing
  // newline, immediately followed by a blocking read, three times, one of them a
  // token read (nextInt) and one built from three separate print calls.
  prompt: {
    label: 'prompt then read (x3)',
    entry: 'app/Prompt.java',
    files: [
      {
        path: 'app/Prompt.java',
        content: `package app;

import java.util.Scanner;

public class Prompt {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);

        // 1. partial line must be on screen BEFORE the read blocks
        System.out.print("Name: ");
        String name = input.nextLine();
        System.out.println("[echo] you typed: " + name);

        // 2. token-based read rather than a whole line
        System.out.print("Age: ");
        int age = input.nextInt();
        input.nextLine(); // consume the rest of the line
        System.out.println("[echo] age parsed as int: " + age);

        // 3. prompt, read and answer all on one visual line
        System.out.print("City: ");
        String city = input.nextLine();
        System.out.print("[echo] ");
        System.out.print(city);
        System.out.println(" <- three separate print calls, no newline until here");

        System.out.println("PROMPT-TEST-OK " + name + "/" + age + "/" + city);
    }
}
`,
      },
    ],
  },

  // (c) The same class name in two packages. Impossible to compile if sources
  // are written flat into /str/, which is why Build stages a real directory tree.
  'same-name': {
    label: 'same class name, two packages',
    entry: 'app/Main.java',
    files: [
      {
        path: 'app/Main.java',
        content: `package app;

import models.Item;

/** Uses BOTH app.Item and models.Item, which have the same simple name. */
public class Main {
    public static void main(String[] args) {
        app.Item local = new app.Item("cart entry");
        Item stored = new Item("database row");

        System.out.println("app.Item     -> " + local.describe());
        System.out.println("models.Item  -> " + stored.describe());

        // Comparing the Class objects with != would not even compile: their
        // types are unrelated, which is itself proof that these are two
        // different classes. Compare the names instead.
        String localName = local.getClass().getName();
        String storedName = stored.getClass().getName();
        System.out.println("loaded as " + localName + " and " + storedName);
        System.out.println("different classes? " + !localName.equals(storedName));
        System.out.println("SAME-NAME-OK");
    }
}
`,
      },
      {
        path: 'app/Item.java',
        content: `package app;

public class Item {
    private final String label;

    public Item(String label) {
        this.label = label;
    }

    public String describe() {
        return "app.Item(" + label + ")";
    }
}
`,
      },
      {
        path: 'models/Item.java',
        content: `package models;

public class Item {
    private final String label;

    public Item(String label) {
        this.label = label;
    }

    public String describe() {
        return "models.Item(" + label + ")";
    }
}
`,
      },
    ],
  },

  // (d) A compile error in a NESTED file, so the reported path has to survive
  // being staged under /files/warsha-run-<runId>/src/ and come back as "models/Broken.java".
  'compile-error': {
    label: 'compile error (path + line + caret)',
    entry: 'app/Main.java',
    files: [
      {
        path: 'app/Main.java',
        content: `package app;

import models.Broken;

public class Main {
    public static void main(String[] args) {
        System.out.println(Broken.twice(21));
    }
}
`,
      },
      {
        // Line numbers are asserted in harness.js -- keep this file's layout
        // stable, and note that line 7 is the one missing its semicolon.
        path: 'models/Broken.java',
        content: `package models;

/** Deliberately broken, to check the quality of compiler diagnostics. */
public class Broken {

    public static int twice(int n) {
        return n * 2
    }
}
`,
      },
    ],
  },

  // (e) An uncaught exception thrown two student frames deep, in a different
  // package from the entry, so frame filtering has something real to keep.
  crash: {
    label: 'uncaught exception (filtered trace)',
    entry: 'app/Crash.java',
    files: [
      {
        path: 'app/Crash.java',
        content: `package app;

import models.Calculator;

public class Crash {
    public static void main(String[] args) {
        System.out.println("about to divide by zero");
        System.out.println(Calculator.divide(42, 0));
        System.out.println("never reached");
    }
}
`,
      },
      {
        path: 'models/Calculator.java',
        content: `package models;

public class Calculator {
    public static int divide(int a, int b) {
        return a / b;
    }
}
`,
      },
    ],
  },

  // An explicitly thrown exception, to prove getMessage() survives CheerpJ. Only
  // IMPLICIT (VM-thrown) exceptions lose their message there, so a message the
  // student wrote must arrive intact -- the renderer restores "/ by zero" and
  // nothing else, and this is the other half of that claim.
  'throw-message': {
    label: 'explicit throw, with a message',
    entry: 'app/Refuse.java',
    files: [
      {
        path: 'app/Refuse.java',
        content: `package app;

public class Refuse {
    public static void main(String[] args) {
        System.out.println("about to refuse");
        throw new IllegalStateException("the tank is empty");
    }
}
`,
      },
    ],
  },

  // A wrapped-and-rethrown exception: "Caused by:" plus the "... N more"
  // collapsing real java does over the frames the two traces share.
  'caused-by': {
    label: 'cause chain (Caused by + ... N more)',
    entry: 'app/Order.java',
    files: [
      {
        path: 'app/Order.java',
        content: `package app;

import models.Repo;

public class Order {
    public static void main(String[] args) {
        System.out.println("looking up order 7");
        place(7);
    }

    /** Wraps the failure, exactly as a student is taught to. */
    static void place(int id) {
        try {
            Repo.find(id);
        } catch (RuntimeException cause) {
            throw new IllegalStateException("could not place order " + id, cause);
        }
    }
}
`,
      },
      {
        path: 'models/Repo.java',
        content: `package models;

public class Repo {
    public static String find(int id) {
        throw new IllegalArgumentException("no order with id " + id);
    }
}
`,
      },
    ],
  },

  // Two top-level classes in ONE file. Nothing but Build's source index gets
  // models.Shape's file right: the simple-name fallback would say "Shape.java",
  // which is not a file the student has.
  'two-classes-one-file': {
    label: 'second class in one file (SourceFile naming)',
    entry: 'app/Draw.java',
    files: [
      {
        path: 'app/Draw.java',
        content: `package app;

import models.Shapes;

public class Draw {
    public static void main(String[] args) {
        System.out.println("drawing");
        System.out.println(Shapes.area(-1));
    }
}
`,
      },
      {
        // Shape is NOT the public class here -- it cannot be, a public class
        // must match its file name. Its .class therefore records Shapes.java as
        // its source, and so must the stack trace.
        path: 'models/Shapes.java',
        content: `package models;

public class Shapes {
    public static int area(int side) {
        return Shape.area(side);
    }
}

class Shape {
    static int area(int side) {
        if (side < 0) throw new IllegalArgumentException("negative side: " + side);
        return side * side;
    }
}
`,
      },
    ],
  },

  // (f) A loop that performs no I/O and so never yields. Nothing but
  // worker.terminate() can stop this; a cooperative kill does not exist.
  'infinite-loop': {
    label: 'infinite loop (kill, then run again)',
    entry: 'app/Loop.java',
    files: [
      {
        path: 'app/Loop.java',
        content: `package app;

public class Loop {
    public static void main(String[] args) {
        System.out.println("still alive: entering a loop that never yields. Press Stop.");
        long i = 0;
        while (true) {
            i++;
        }
    }
}
`,
      },
    ],
  },

  // Extra: proves stdout is not swallowed when a program exits via System.exit,
  // and that the runtime notices the JVM went with it.
  'system-exit': {
    label: 'System.exit(3)',
    entry: 'app/Bye.java',
    files: [
      {
        path: 'app/Bye.java',
        content: `package app;

public class Bye {
    public static void main(String[] args) {
        System.out.println("EXIT-TEST leaving with status 3");
        System.exit(3);
    }
}
`,
      },
    ],
  },
}
