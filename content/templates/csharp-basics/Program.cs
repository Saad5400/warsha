using System;

// Your first C# program. C# starts running at the top. Press Run.

// Console.WriteLine shows a line in the console.
Console.WriteLine("=== Warsha starter ===");

// A variable stores a value. C# needs its type: string, int.
string language = "C#";
int year = 2026;
Console.WriteLine("You are writing " + language + ".");

// A loop repeats. This counts 1, 2, 3.
for (int number = 1; number <= 3; number++)
{
    Console.WriteLine("Line " + number);
}

// Console.ReadLine reads one line that you type into the console.
Console.Write("Your name: ");
string? name = Console.ReadLine();

Console.WriteLine("Hello, " + name + "! Now change a line above and Run again.");
