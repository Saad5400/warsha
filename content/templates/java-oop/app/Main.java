package app;

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
