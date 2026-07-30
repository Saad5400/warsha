"""A very small shapes library: one base class and two shapes."""

import math


class Shape:
    """Base class. Every shape has a name and can report its area."""

    def __init__(self, name):
        self.name = name

    def area(self):
        # Each subclass gives its own answer.
        return 0.0

    def describe(self):
        return f"{self.name}: area = {self.area():.2f}"


class Circle(Shape):
    def __init__(self, radius):
        super().__init__("Circle")  # let Shape store the name
        self.radius = radius

    def area(self):
        return math.pi * self.radius**2


class Rectangle(Shape):
    def __init__(self, width, height):
        super().__init__("Rectangle")
        self.width = width
        self.height = height

    def area(self):
        return self.width * self.height
