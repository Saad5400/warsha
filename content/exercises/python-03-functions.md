# Python 03 — Functions

**Goal:** Write small functions that take arguments and return values, then use them together.
You will also meet a default argument.

## Starter code

File: `main.py`

```python
# Write your functions here.


count = int(input("How many numbers? "))
numbers = []
# Write your code below this line.
```

## Tasks

1. Write `def shout(text):` that returns the text in capitals with a `!` at the end. Use `text.upper()`.
2. Write `def is_even(n):` that returns `True` when `n` divides by 2 with no rest.
3. Write `def average(numbers):` that returns the average of a list. Return `0` when the list is empty.
4. Write `def greet(name, greeting="Hello"):` that returns `Hello, Omar`. The second argument has a default, so `greet("Omar")` is enough.
5. Use them: read `count` numbers in a `for` loop, add each to the list, print `4 is even` or `7 is odd`, then print the average with two decimals and `print(shout(greet("Omar")))`.

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
Average = 7.00
HELLO, OMAR!
```

## Hint

`range(1, count + 1)` counts `1, 2, 3` — it stops **before** the second number, which is why you
add 1.

Two decimals inside an f-string: `print(f"Average = {average(numbers):.2f}")`

The last line calls two functions at once. Python runs the inside one first: `greet("Omar")` becomes
`"Hello, Omar"`, and `shout` turns that into `"HELLO, OMAR!"`.

## Stretch

Add `def biggest(numbers):` without using the built-in `max`. Then call `greet` with a second
argument, such as `greet("Omar", "Welcome")`, and see the output change.
