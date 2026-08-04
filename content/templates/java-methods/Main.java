import java.util.Scanner;

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
