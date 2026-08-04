"""Functions and a list — the next step after the basics."""


# A function is a named piece of code you can call as many times as you like.
def greet(name):
    return "Hello, " + name + "!"


# Parameters can have a default, used when you leave the argument out.
def average(numbers):
    if not numbers:  # an empty list has no average
        return 0
    return sum(numbers) / len(numbers)


def main():
    print("=== Warsha starter ===")

    # A list holds many values in order.
    scores = [8, 6, 10, 7]
    print("Scores:", scores)
    print("Average:", average(scores))

    # Loop over the list and decide something for each value.
    for score in scores:
        verdict = "pass" if score >= 7 else "retry"
        print("Score", score, "->", verdict)

    name = input("Your name: ")
    print(greet(name), "Now add a score to the list and Run again.")


# Runs main() only when you run this file directly.
if __name__ == "__main__":
    main()
