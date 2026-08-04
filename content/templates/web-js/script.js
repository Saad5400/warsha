// JavaScript on its own — there is no page to show, so everything you print
// with console.log appears in the Console. Press Run.

console.log("=== Warsha starter ===");

// A variable stores a value you can use again by name.
const language = "JavaScript";
console.log("You are writing " + language + ".");

// A loop repeats. This counts 1, 2, 3.
for (let n = 1; n <= 3; n++) {
  console.log("Line " + n);
}

// A function is a named piece of code you can call as many times as you like.
function greet(name) {
  return "Hello, " + name + "!";
}

console.log(greet("world"));
console.log("Now change a line above and Run again.");
