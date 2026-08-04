using System;

/// <summary>A very small shapes library: one base class and two shapes.</summary>
class Shape
{
    // A read-only property: other classes can read Name, only this one sets it.
    public string Name { get; }

    // A constructor builds the object.
    public Shape(string name)
    {
        Name = name;
    }

    // virtual means a subclass may replace this method with its own version.
    public virtual double Area()
    {
        return 0.0;
    }

    public string Describe()
    {
        return $"{Name}: area = {Area():F2}";
    }
}

/// <summary>A Circle is a Shape. ": Shape" reuses everything Shape has.</summary>
class Circle : Shape
{
    private readonly double radius;

    public Circle(double radius) : base("Circle") // let Shape store the name
    {
        this.radius = radius;
    }

    // override takes over Area() for Circles.
    public override double Area()
    {
        return Math.PI * radius * radius;
    }
}

class Rectangle : Shape
{
    private readonly double width;
    private readonly double height;

    public Rectangle(double width, double height) : base("Rectangle")
    {
        this.width = width;
        this.height = height;
    }

    public override double Area()
    {
        return width * height;
    }
}
