/* GENERATED FROM content/templates/ — DO NOT EDIT THE CODE STRINGS BY HAND.
 * Copy them verbatim; if a starter needs changing, change it under
 * content/templates/ and regenerate (see ARCHITECTURE.md).
 *
 * The `advanced` starters (java-oop, python-starter) are Education's reviewed,
 * compiled, stdin-tested originals. The `beginner`/`intermediate` starters are
 * later drafts: each compiles and runs with piped stdin, but is pending the
 * same review — hold them to that bar before treating them as final.
 *
 * Every language in languages.ts that is `ready` should own one starter per
 * level here; a `soon` language owns none, and the picker shows it as a dimmed
 * tile until an engine and its starters land together.
 */

import type { FsSnapshot } from './fs/types'

/** Beginner → intermediate → advanced. The picker groups a language's starters
 *  by this, and orders the groups in this order. */
export type TemplateLevel = 'beginner' | 'intermediate' | 'advanced'

export interface Template {
  id: string
  name: string
  /** The language's id in languages.ts. Also its file-badge glyph. */
  lang: 'java' | 'python'
  level: TemplateLevel
  blurb: string
  entry: string
  snapshot: FsSnapshot
}

const JAVA_APP_MAIN_JAVA = `package app;

import java.util.Scanner;

import models.Person;
import models.Student;

/** Java always starts here, in main(). Press Run. */
public class Main {
    public static void main(String[] args) {
        // Two objects. A Student is a Person, plus a major.
        Person teacher = new Person("Layla", 34);
        Student student = new Student("Omar", 20, "Computer Science");

        System.out.println("=== Warsha starter ===");
        System.out.println(teacher.describe());
        System.out.println(student.describe()); // Student's version runs, not Person's

        // Scanner reads one line that you type into the console.
        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println("Hello, " + name + "! Now open models/Person.java.");
    }
}
`

const JAVA_MODELS_PERSON_JAVA = `package models; // this file lives in the models/ folder

/** A person with a name and an age. Other classes can extend this one. */
public class Person {

    // private means: only this class touches these values directly.
    private String name;
    private int age;

    /** A constructor builds the object. this.name is the field, name is the parameter. */
    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    // Getters let other classes read a private field.
    public String getName() {
        return name;
    }

    public int getAge() {
        return age;
    }

    /** A subclass may replace this method with its own version. */
    public String describe() {
        return name + ", age " + age;
    }
}
`

const JAVA_MODELS_STUDENT_JAVA = `package models;

/** A Student is a Person with a major. extends reuses everything Person has. */
public class Student extends Person {

    private String major;

    public Student(String name, int age, String major) {
        super(name, age); // let Person store the name and the age first
        this.major = major;
    }

    /** Same name as Person.describe(), so it takes over for Students. */
    @Override
    public String describe() {
        return getName() + ", age " + getAge() + ", studies " + major;
    }
}
`

const PY_HELPERS_SHAPES_PY = `"""A very small shapes library: one base class and two shapes."""

import math


class Shape:
    """Base class. Every shape has a name and can report its area."""

    def __init__(self, name):
        self.name = name

    def area(self):
        # Each subclass gives its own answer.
        return 0.0

    def describe(self):
        return f"{self.name}: area = {self.area():.2f}"


class Circle(Shape):
    def __init__(self, radius):
        super().__init__("Circle")  # let Shape store the name
        self.radius = radius

    def area(self):
        return math.pi * self.radius**2


class Rectangle(Shape):
    def __init__(self, width, height):
        super().__init__("Rectangle")
        self.width = width
        self.height = height

    def area(self):
        return self.width * self.height
`

const PY_MAIN_PY = `"""Warsha starter: a program that uses classes from another folder."""

from helpers.shapes import Circle, Rectangle


def main():
    # One list can hold different kinds of objects.
    shapes = [Circle(2), Rectangle(3, 4)]

    print("=== Warsha starter ===")
    for shape in shapes:
        print(shape.describe())  # each class answers in its own way

    total = sum(shape.area() for shape in shapes)
    print(f"Total area = {total:.2f}")

    # input() waits for you to type one line into the console.
    name = input("Your name: ")
    print(f"Hello, {name}! Now open helpers/shapes.py and add a Square.")


# Runs main() only when you run this file directly.
if __name__ == "__main__":
    main()
`

const JAVA_BASICS_MAIN_JAVA = `import java.util.Scanner;

/** Your first Java program. Java always starts in main(). Press Run. */
public class Main {
    public static void main(String[] args) {
        // System.out.println shows a line in the console.
        System.out.println("=== Warsha starter ===");

        // A variable stores a value. Java needs its type: String, int.
        String language = "Java";
        int year = 2026;
        System.out.println("You are writing " + language + ".");

        // A loop repeats. This counts 1, 2, 3.
        for (int number = 1; number <= 3; number++) {
            System.out.println("Line " + number);
        }

        // Scanner reads one line that you type into the console.
        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println("Hello, " + name + "! Now change a line above and Run again.");
    }
}
`

const JAVA_METHODS_MAIN_JAVA = `import java.util.Scanner;

/** Methods and an array — the next step after the basics. */
public class Main {

    // A method is a named piece of code you can call with different values.
    // static means it belongs to the class, so main() can call it directly.
    static String greet(String name) {
        return "Hello, " + name + "!";
    }

    static double average(int[] numbers) {
        int total = 0;
        for (int n : numbers) {
            total += n;
        }
        // Cast to double so 31 / 4 is 7.75, not 7.
        return (double) total / numbers.length;
    }

    public static void main(String[] args) {
        System.out.println("=== Warsha starter ===");

        // An array holds many values of one type, in order.
        int[] scores = { 8, 6, 10, 7 };
        System.out.println("Average: " + average(scores));

        // Loop over the array and decide something for each value.
        for (int score : scores) {
            String verdict = score >= 7 ? "pass" : "retry";
            System.out.println("Score " + score + " -> " + verdict);
        }

        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println(greet(name) + " Now add a score to the array and Run again.");
    }
}
`

const PY_BASICS_MAIN_PY = `# Your first Python program. Press Run.

# print() shows a line in the console.
print("=== Warsha starter ===")

# A variable stores a value you can use again by name.
language = "Python"
year = 2026
print("You are writing " + language + ".")

# A loop repeats. This counts 1, 2, 3.
for number in range(1, 4):
    print("Line", number)

# input() waits for you to type one line into the console.
name = input("Your name: ")
print("Hello, " + name + "! Now change a line above and Run again.")
`

const PY_FUNCTIONS_MAIN_PY = `"""Functions and a list — the next step after the basics."""


# A function is a named piece of code you can call as many times as you like.
def greet(name):
    return "Hello, " + name + "!"


# Parameters can have a default, used when you leave the argument out.
def average(numbers):
    if not numbers:  # an empty list has no average
        return 0
    return sum(numbers) / len(numbers)


def main():
    print("=== Warsha starter ===")

    # A list holds many values in order.
    scores = [8, 6, 10, 7]
    print("Scores:", scores)
    print("Average:", average(scores))

    # Loop over the list and decide something for each value.
    for score in scores:
        verdict = "pass" if score >= 7 else "retry"
        print("Score", score, "->", verdict)

    name = input("Your name: ")
    print(greet(name), "Now add a score to the list and Run again.")


# Runs main() only when you run this file directly.
if __name__ == "__main__":
    main()
`

export const templates: Template[] = [
  {
    id: 'python-basics',
    name: 'Python basics',
    lang: 'python',
    level: 'beginner',
    blurb: 'Print, variables, a loop, and input() — one file, nothing else.',
    entry: 'main.py',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.py', content: PY_BASICS_MAIN_PY }],
    },
  },
  {
    id: 'python-functions',
    name: 'Python functions',
    lang: 'python',
    level: 'intermediate',
    blurb: 'Define functions, work through a list, and decide per value.',
    entry: 'main.py',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.py', content: PY_FUNCTIONS_MAIN_PY }],
    },
  },
  {
    id: 'java-basics',
    name: 'Java basics',
    lang: 'java',
    level: 'beginner',
    blurb: 'Print, typed variables, a loop, and a Scanner — one class, no packages.',
    entry: 'Main.java',
    snapshot: {
      dirs: [],
      files: [{ path: 'Main.java', content: JAVA_BASICS_MAIN_JAVA }],
    },
  },
  {
    id: 'java-methods',
    name: 'Java methods',
    lang: 'java',
    level: 'intermediate',
    blurb: 'Write static methods, average an array, and decide per value.',
    entry: 'Main.java',
    snapshot: {
      dirs: [],
      files: [{ path: 'Main.java', content: JAVA_METHODS_MAIN_JAVA }],
    },
  },
  {
    id: 'java-oop',
    name: 'Java (OOP starter)',
    lang: 'java',
    level: 'advanced',
    blurb:
      'Two classes in packages, inheritance, and a Scanner that reads what you type.',
    entry: 'app/Main.java',
    snapshot: {
      dirs: ['app', 'models'],
      files: [
        { path: 'app/Main.java', content: JAVA_APP_MAIN_JAVA },
        { path: 'models/Person.java', content: JAVA_MODELS_PERSON_JAVA },
        { path: 'models/Student.java', content: JAVA_MODELS_STUDENT_JAVA },
      ],
    },
  },
  {
    id: 'python',
    name: 'Python (OOP starter)',
    lang: 'python',
    level: 'advanced',
    blurb:
      'A shapes module with classes, a loop over objects, and input().',
    entry: 'main.py',
    snapshot: {
      dirs: ['helpers'],
      files: [
        { path: 'helpers/shapes.py', content: PY_HELPERS_SHAPES_PY },
        { path: 'main.py', content: PY_MAIN_PY },
      ],
    },
  },
]
