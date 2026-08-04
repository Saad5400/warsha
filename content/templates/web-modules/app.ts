// This runs inside the page as a module, so it can both import another file and
// touch the page. Warsha transpiles the TypeScript and bundles the import — on
// your device — then the page runs it. Press Run and watch the list fill in.

import { greet, type Person } from "./greeting";

const people: Person[] = [
  { name: "Layla", role: "student" },
  { name: "Omar", role: "teacher" },
];

const list = document.querySelector<HTMLUListElement>("#people");
for (const person of people) {
  const item = document.createElement("li");
  item.textContent = greet(person);
  list?.appendChild(item);
  console.log(greet(person)); // also shows in the Console tab
}

// Open greeting.ts, add a field to Person, then use it here and Run again.
