// A module: other files import what it `export`s. The types travel across the
// import, so main.ts knows exactly what each shape can do.

export interface Shape {
  name: string;
  area(): number;
}

// "implements Shape" is a promise this class has everything a Shape needs.
export class Circle implements Shape {
  name = "Circle";

  // A "private" constructor parameter also becomes a field — no extra line.
  constructor(private radius: number) {}

  area(): number {
    return Math.PI * this.radius ** 2;
  }
}

export class Rectangle implements Shape {
  name = "Rectangle";

  constructor(
    private width: number,
    private height: number,
  ) {}

  area(): number {
    return this.width * this.height;
  }
}
