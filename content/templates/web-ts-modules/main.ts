// Warsha starter: a program split across files. main.ts imports the shapes from
// shapes.ts, and TypeScript checks the whole project together. Press Run.

import { Circle, Rectangle, type Shape } from "./shapes";

// One list can hold different kinds of Shape.
const shapes: Shape[] = [new Circle(2), new Rectangle(3, 4)];

console.log("=== Warsha starter ===");
for (const shape of shapes) {
  console.log(`${shape.name}: area = ${shape.area().toFixed(2)}`);
}

const total = shapes.reduce((sum, shape) => sum + shape.area(), 0);
console.log(`Total area = ${total.toFixed(2)}`);

// Open shapes.ts, add a Square class, then use it here and Run again.
console.log("Now open shapes.ts and add a Square.");
