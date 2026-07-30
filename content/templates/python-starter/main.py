"""Warsha starter: a program that uses classes from another folder."""

from helpers.shapes import Circle, Rectangle


def main():
    # One list can hold different kinds of objects.
    shapes = [Circle(2), Rectangle(3, 4)]

    print("=== Warsha starter ===")
    for shape in shapes:
        print(shape.describe())  # each class answers in its own way

    total = sum(shape.area() for shape in shapes)
    print(f"Total area = {total:.2f}")

    # input() waits for you to type one line into the console.
    name = input("Your name: ")
    print(f"Hello, {name}! Now open helpers/shapes.py and add a Square.")


# Runs main() only when you run this file directly.
if __name__ == "__main__":
    main()
