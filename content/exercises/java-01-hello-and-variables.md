# Java 01 — Hello and variables

**Goal:** Print your first lines of output, and store values in variables.
You will learn `System.out.println`, `String`, `int`, `double`, `boolean`, and `Scanner`.

## Starter code

File: `app/Main.java`

```java
package app;

import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, Warsha!");
        // Write your code below this line.
    }
}
```

## Tasks

1. Press **Run** and check that `Hello, Warsha!` appears in the console.
2. Ask for a name and store it: use `Scanner input = new Scanner(System.in);`, then `System.out.print("Your name: ");`, then `String name = input.nextLine();`
3. Create three more variables: `int age = 17;`, `double gpa = 3.75;`, `boolean isStudent = true;`
4. Print four lines: `Name: ...`, `Age: ...`, `GPA: ...`, `Student: ...`
5. Print one last line that joins the values together: `Omar (17), GPA 3.75`

## Expected output

You type `Omar` when the program asks.

```
Hello, Warsha!
Your name: Omar
Name: Omar
Age: 17
GPA: 3.75
Student: true
Omar (17), GPA 3.75
```

## Hint

The `+` sign joins text and numbers into one line:
`System.out.println("Age: " + age);`
Use `System.out.print` (no `ln`) for the question, so your answer appears on the same line.

## Stretch

Ask for the age too. `input.nextLine()` always gives you text, so turn it into a number with
`int age = Integer.parseInt(input.nextLine());` Then print the year this person turns 20.
