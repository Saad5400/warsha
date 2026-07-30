# Python 01 — Hello and variables

**Goal:** Print your first lines of output, and store values in variables.
You will learn `print`, `input`, text, whole numbers, decimals, and `True` / `False`.

## Starter code

File: `main.py`

```python
print("Hello, Warsha!")
# Write your code below this line.
```

## Tasks

1. Press **Run** and check that `Hello, Warsha!` appears in the console.
2. Ask for a name and store it: `name = input("Your name: ")`
3. Create three more variables: `age = 17`, `gpa = 3.75`, `is_student = True`
4. Print four lines using f-strings: `Name: ...`, `Age: ...`, `GPA: ...`, `Student: ...`
5. Print one last line that joins the values together: `Omar (17), GPA 3.75`

## Expected output

You type `Omar` when the program asks.

```
Hello, Warsha!
Your name: Omar
Name: Omar
Age: 17
GPA: 3.75
Student: True
Omar (17), GPA 3.75
```

## Hint

An f-string starts with `f` and puts variables inside `{ }`:

```python
print(f"Age: {age}")
```

Python writes `True` with a capital T. Variable names in Python use `lower_case_with_underscores`.

## Stretch

Ask for the age too. `input()` always gives you text, so turn it into a number with
`age = int(input("Your age: "))`. Then print the year this person turns 20.
