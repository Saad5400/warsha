# Python 02 — Conditionals and loops

**Goal:** Collect a list of names until the user is finished, then report on the list.
You will learn `while`, `break`, `continue`, `if`, a list, and `for`.

## Starter code

File: `main.py`

```python
names = []

while True:
    answer = input("Name (or 'done'): ")
    # Write your code below this line.
```

## Tasks

1. Leave the loop with `break` when the user types `done`.
2. When the user types nothing (an empty line), print `Please type something.` and go back to the question with `continue`.
3. Otherwise add the name to the list with `names.append(answer)`, then print the number and the name, like `1. Omar`.
4. After the loop, print `Total: 2`, then print every name on its own line as `- Omar`.
5. Find the longest name with a `for` loop and print `Longest: Layla`.

## Expected output

You type `Omar`, then `Layla`, then an empty line, then `done`.

```
Name (or 'done'): Omar
1. Omar
Name (or 'done'): Layla
2. Layla
Name (or 'done'): 
Please type something.
Name (or 'done'): done
Total: 2
- Omar
- Layla
Longest: Layla
```

## Hint

`len(names)` gives how many names are in the list, so after `append` it is also the number of the
name you just added.

For the longest name, start with an empty answer and replace it whenever you find something longer:

```python
longest = ""
for name in names:
    if len(name) > len(longest):
        longest = name
```

## Stretch

Refuse a name that is already in the list: print `Already added.` and `continue`.
Use `if answer in names:`.
