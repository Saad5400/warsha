// A module: other files import what it `export`s. The type travels across the
// import, so app.ts knows exactly what a Person is.

export interface Person {
  name: string;
  role: string;
}

export function greet(person: Person): string {
  return `Hello, ${person.name} — our ${person.role}.`;
}
