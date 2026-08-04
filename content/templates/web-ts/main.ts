// TypeScript is JavaScript with types. The types are checked, then removed
// before your code runs. There is no page to show, so everything you print with
// console.log appears in the Console. Press Run.

// A type says which values are allowed. TypeScript flags a mismatch as you type.
type Grade = "pass" | "retry";

// An interface describes the shape of an object.
interface Student {
  name: string;
  score: number;
}

// The ": Grade" after the parameters is the return type.
function verdict(score: number): Grade {
  return score >= 7 ? "pass" : "retry";
}

const students: Student[] = [
  { name: "Layla", score: 8 },
  { name: "Omar", score: 6 },
];

console.log("=== Warsha starter ===");
for (const student of students) {
  console.log(`${student.name}: ${student.score} -> ${verdict(student.score)}`);
}

// Try changing a score to a string above — TypeScript will underline it.
console.log("Now change a line and Run again.");
