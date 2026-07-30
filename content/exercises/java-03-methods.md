# Java 03 — Methods

**Goal:** Move work out of `main` into small methods that take parameters and return values.
Each method should do one job and have a clear name.

## Starter code

File: `app/Main.java`

```java
package app;

import java.util.Scanner;

public class Main {

    // Write your methods here.

    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);

        System.out.print("How many numbers? ");
        int count = Integer.parseInt(input.nextLine());
        // Write your code below this line.
    }
}
```

## Tasks

1. Write `static boolean isEven(int n)` that returns `true` when `n` divides by 2 with no rest.
2. Write `static int max(int a, int b)` that returns the larger of the two numbers.
3. Write `static double average(int sum, int count)` that returns the average as a decimal.
4. In `main`, use a `for` loop that runs `count` times. Each round: print `Number 1: `, read a number, add it to a `sum` variable, keep the biggest one using `max`, and print `4 is even` or `7 is odd` using `isEven`.
5. After the loop, print the sum, the biggest number, and the average with two decimals.

## Expected output

You type `3`, then `4`, `7`, `10`.

```
How many numbers? 3
Number 1: 4
4 is even
Number 2: 7
7 is odd
Number 3: 10
10 is even
Sum = 21
Biggest = 10
Average = 7.00
```

## Hint

Methods called from `main` must be `static` in this exercise. `return` sends a value back to
whoever called the method.

For two decimals, use `printf` instead of `println`. `%n` ends the line:

```java
System.out.printf("Average = %.2f%n", average(sum, count));
```

Careful with `average`: `sum / count` on two `int` values throws away the decimals. Write
`return (double) sum / count;` instead.

## Stretch

Add `static int min(int a, int b)` and print the smallest number too. Then move the whole
"read the numbers" loop into its own method that returns the sum.
