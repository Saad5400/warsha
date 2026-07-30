# Java 02 — Conditionals and loops

**Goal:** Make the program choose between answers with `if` / `else if` / `else`.
Then repeat work with a `for` loop and a `while` loop.

## Starter code

File: `app/Main.java`

```java
package app;

import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);

        System.out.print("Score (0-100): ");
        int score = Integer.parseInt(input.nextLine());
        // Write your code below this line.
    }
}
```

## Tasks

1. Print the letter grade with `if` / `else if` / `else`: 90+ is `A`, 80+ is `B`, 70+ is `C`, 60+ is `D`, anything lower is `F`. Print it as `Grade: B`.
2. On the next line print `Passed` when the score is 60 or more, otherwise `Failed`.
3. Draw a bar with a `for` loop: print one `#` for every full 10 points. A score of 84 gives `########`.
4. Wrap all of it in a `while (true)` loop so the program keeps asking for scores.
5. When the user types `-1`, leave the loop with `break;` and print `Bye.`

## Expected output

You type `84`, then `45`, then `-1`.

```
Score (0-100): 84
Grade: B
Passed
########
Score (0-100): 45
Grade: F
Failed
####
Score (0-100): -1
Bye.
```

## Hint

Build the bar as one string, then print it once:

```java
String bar = "";
for (int i = 0; i < score / 10; i++) {
    bar = bar + "#";
}
System.out.println(bar);
```

Integer division throws away the rest, so `84 / 10` is `8`. That is exactly what you want here.

## Stretch

Count how many scores were entered and add up their total. When the user types `-1`, print the
average before `Bye.`, like `Average: 64.5`.
