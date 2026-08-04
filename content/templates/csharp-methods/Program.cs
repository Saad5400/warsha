using System;

/// <summary>Methods and an array — the next step after the basics.</summary>
class Program
{
    // A method is a named piece of code you can call with different values.
    // static means it belongs to the class, so Main() can call it directly.
    static string Greet(string name)
    {
        return "Hello, " + name + "!";
    }

    static double Average(int[] numbers)
    {
        int total = 0;
        foreach (int n in numbers)
        {
            total += n;
        }
        // Cast to double so 31 / 4 is 7.75, not 7.
        return (double)total / numbers.Length;
    }

    static void Main()
    {
        Console.WriteLine("=== Warsha starter ===");

        // An array holds many values of one type, in order.
        int[] scores = { 8, 6, 10, 7 };
        Console.WriteLine("Average: " + Average(scores));

        // Loop over the array and decide something for each value.
        foreach (int score in scores)
        {
            string verdict = score >= 7 ? "pass" : "retry";
            Console.WriteLine("Score " + score + " -> " + verdict);
        }

        Console.Write("Your name: ");
        string? name = Console.ReadLine();

        Console.WriteLine(Greet(name ?? "") + " Now add a score to the array and Run again.");
    }
}
