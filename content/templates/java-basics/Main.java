import java.util.Scanner;

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
