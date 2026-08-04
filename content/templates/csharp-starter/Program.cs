using System;
using System.Collections.Generic;

/// <summary>Warsha starter: objects from another file, inheritance, and input.</summary>
class Program
{
    static void Main()
    {
        // One list can hold different kinds of objects.
        List<Shape> shapes = new List<Shape> { new Circle(2), new Rectangle(3, 4) };

        Console.WriteLine("=== Warsha starter ===");
        foreach (Shape shape in shapes)
        {
            Console.WriteLine(shape.Describe()); // each class answers in its own way
        }

        double total = 0;
        foreach (Shape shape in shapes)
        {
            total += shape.Area();
        }
        Console.WriteLine($"Total area = {total:F2}");

        // Console.ReadLine waits for you to type one line into the console.
        Console.Write("Your name: ");
        string? name = Console.ReadLine();

        Console.WriteLine($"Hello, {name}! Now open Shapes.cs and add a Square.");
    }
}
