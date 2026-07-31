/* GENERATED FROM content/templates/ — DO NOT EDIT THE CODE STRINGS BY HAND.
 * Education reviewed, compiled and ran these files with piped stdin. Copy them
 * verbatim; if a starter needs changing, change it under content/templates/ and
 * regenerate (see ARCHITECTURE.md).
 */

import type { FsSnapshot } from './fs/types'

export interface Template {
  id: string
  name: string
  lang: 'java' | 'python'
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

export const templates: Template[] = [
  {
    id: 'java-oop',
    name: 'Java (OOP starter)',
    lang: 'java',
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
    name: 'Python starter',
    lang: 'python',
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
