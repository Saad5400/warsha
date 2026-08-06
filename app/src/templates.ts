/* GENERATED FROM content/templates/ — DO NOT EDIT THE CODE STRINGS BY HAND.
 * Copy them verbatim; if a starter needs changing, change it under
 * content/templates/ and regenerate (see ARCHITECTURE.md).
 *
 * The `advanced` starters (java-oop, python-starter) are Education's reviewed,
 * compiled, stdin-tested originals. The `beginner`/`intermediate` starters are
 * later drafts: each compiles and runs with piped stdin, but is pending the
 * same review — hold them to that bar before treating them as final.
 *
 * Every language in languages.ts that is `ready` should own one starter per
 * level here; a `soon` language owns none, and the picker shows it as a dimmed
 * tile until an engine and its starters land together.
 */

import type { FsSnapshot } from './fs/types'

/** Beginner → intermediate → advanced. The picker groups a language's starters
 *  by this, and orders the groups in this order. */
export type TemplateLevel = 'beginner' | 'intermediate' | 'advanced'

export interface Template {
  id: string
  /**
   * The language tile this starter lives under in the picker (languages.ts). For
   * `web` the starter is multi-language by nature — its files are html/css/js —
   * so this is the *category*, not a per-file language; each file's own badge and
   * editor grammar still come from its extension.
   */
  name: string
  lang: 'java' | 'python' | 'web' | 'csharp' | 'c'
  level: TemplateLevel
  blurb: string
  entry: string
  snapshot: FsSnapshot
}

const JAVA_APP_MAIN_JAVA = `package app;

import java.util.Scanner;

import models.Person;
import models.Student;

/** Java always starts here, in main(). Press Run. */
public class Main {
    public static void main(String[] args) {
        // Two objects. A Student is a Person, plus a major.
        Person teacher = new Person("Layla", 34);
        Student student = new Student("Omar", 20, "Computer Science");

        System.out.println("=== Warsha starter ===");
        System.out.println(teacher.describe());
        System.out.println(student.describe()); // Student's version runs, not Person's

        // Scanner reads one line that you type into the console.
        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println("Hello, " + name + "! Now open models/Person.java.");
    }
}
`

const JAVA_MODELS_PERSON_JAVA = `package models; // this file lives in the models/ folder

/** A person with a name and an age. Other classes can extend this one. */
public class Person {

    // private means: only this class touches these values directly.
    private String name;
    private int age;

    /** A constructor builds the object. this.name is the field, name is the parameter. */
    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    // Getters let other classes read a private field.
    public String getName() {
        return name;
    }

    public int getAge() {
        return age;
    }

    /** A subclass may replace this method with its own version. */
    public String describe() {
        return name + ", age " + age;
    }
}
`

const JAVA_MODELS_STUDENT_JAVA = `package models;

/** A Student is a Person with a major. extends reuses everything Person has. */
public class Student extends Person {

    private String major;

    public Student(String name, int age, String major) {
        super(name, age); // let Person store the name and the age first
        this.major = major;
    }

    /** Same name as Person.describe(), so it takes over for Students. */
    @Override
    public String describe() {
        return getName() + ", age " + getAge() + ", studies " + major;
    }
}
`

const PY_HELPERS_SHAPES_PY = `"""A very small shapes library: one base class and two shapes."""

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
`

const PY_MAIN_PY = `"""Warsha starter: a program that uses classes from another folder."""

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
`

const JAVA_BASICS_MAIN_JAVA = `import java.util.Scanner;

/** Your first Java program. Java always starts in main(). Press Run. */
public class Main {
    public static void main(String[] args) {
        // System.out.println shows a line in the console.
        System.out.println("=== Warsha starter ===");

        // A variable stores a value. Java needs its type: String, int.
        String language = "Java";
        int year = 2026;
        System.out.println("You are writing " + language + ".");

        // A loop repeats. This counts 1, 2, 3.
        for (int number = 1; number <= 3; number++) {
            System.out.println("Line " + number);
        }

        // Scanner reads one line that you type into the console.
        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println("Hello, " + name + "! Now change a line above and Run again.");
    }
}
`

const JAVA_METHODS_MAIN_JAVA = `import java.util.Scanner;

/** Methods and an array — the next step after the basics. */
public class Main {

    // A method is a named piece of code you can call with different values.
    // static means it belongs to the class, so main() can call it directly.
    static String greet(String name) {
        return "Hello, " + name + "!";
    }

    static double average(int[] numbers) {
        int total = 0;
        for (int n : numbers) {
            total += n;
        }
        // Cast to double so 31 / 4 is 7.75, not 7.
        return (double) total / numbers.length;
    }

    public static void main(String[] args) {
        System.out.println("=== Warsha starter ===");

        // An array holds many values of one type, in order.
        int[] scores = { 8, 6, 10, 7 };
        System.out.println("Average: " + average(scores));

        // Loop over the array and decide something for each value.
        for (int score : scores) {
            String verdict = score >= 7 ? "pass" : "retry";
            System.out.println("Score " + score + " -> " + verdict);
        }

        Scanner input = new Scanner(System.in);
        System.out.print("Your name: ");
        String name = input.nextLine();

        System.out.println(greet(name) + " Now add a score to the array and Run again.");
    }
}
`

const PY_BASICS_MAIN_PY = `# Your first Python program. Press Run.

# print() shows a line in the console.
print("=== Warsha starter ===")

# A variable stores a value you can use again by name.
language = "Python"
year = 2026
print("You are writing " + language + ".")

# A loop repeats. This counts 1, 2, 3.
for number in range(1, 4):
    print("Line", number)

# input() waits for you to type one line into the console.
name = input("Your name: ")
print("Hello, " + name + "! Now change a line above and Run again.")
`

const PY_FUNCTIONS_MAIN_PY = `"""Functions and a list — the next step after the basics."""


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
`

const WEB_PAGE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My web page</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <!-- HTML is the structure. These tags are headings, paragraphs and a list. -->
    <h1>Hello from Warsha</h1>
    <p>This page is written in HTML and styled with CSS. Press Run to see it.</p>

    <ul>
      <li>HTML gives the page its structure.</li>
      <li>CSS gives it its look.</li>
      <li>Open <code>styles.css</code> and change a colour, then Run again.</li>
    </ul>
  </body>
</html>
`

const WEB_PAGE_STYLES_CSS = `/* CSS is the look: colours, spacing, fonts. Change a value and press Run. */

body {
  font-family: system-ui, sans-serif;
  line-height: 1.6;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
  color: #1a1a1a;
  background: #fafafa;
}

h1 {
  color: #b45309; /* try changing this colour */
}

code {
  background: #eaeaea;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}

li {
  margin: 0.25em 0;
}
`

const WEB_INTERACTIVE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Interactive page</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>Click counter</h1>
    <p>JavaScript makes a page respond to what you do.</p>

    <button id="count">Clicked 0 times</button>

    <p class="hint">Every click also prints to the Console tab.</p>

    <script src="script.js"></script>
  </body>
</html>
`

const WEB_INTERACTIVE_STYLES_CSS = `/* The look of the page. The button gets a hover and a pressed state. */

body {
  font-family: system-ui, sans-serif;
  line-height: 1.6;
  max-width: 40rem;
  margin: 2rem auto;
  padding: 0 1rem;
  color: #1a1a1a;
}

button {
  font: inherit;
  padding: 0.6em 1.2em;
  color: #fff;
  background: #b45309;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

button:hover {
  background: #92400e;
}

button:active {
  transform: translateY(1px);
}

.hint {
  color: #666;
  font-size: 0.9em;
}
`

const WEB_INTERACTIVE_SCRIPT_JS = `// JavaScript runs in the page. This finds the button and reacts to each click.

const button = document.querySelector("#count");
let clicks = 0;

button.addEventListener("click", () => {
  clicks += 1;
  button.textContent = "Clicked " + clicks + " time" + (clicks === 1 ? "" : "s");

  // console.log shows up in the Console tab, right beside the Preview.
  console.log("click number", clicks);
});

console.log("Page ready — click the button.");
`

const WEB_JS_SCRIPT_JS = `// JavaScript on its own — there is no page to show, so everything you print
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
`

const WEB_TS_MAIN_TS = `// TypeScript is JavaScript with types. The types are checked, then removed
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
  console.log(\`\${student.name}: \${student.score} -> \${verdict(student.score)}\`);
}

// Try changing a score to a string above — TypeScript will underline it.
console.log("Now change a line and Run again.");
`

const WEB_TS_MODULES_SHAPES_TS = `// A module: other files import what it \`export\`s. The types travel across the
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
`

const WEB_TS_MODULES_MAIN_TS = `// Warsha starter: a program split across files. main.ts imports the shapes from
// shapes.ts, and TypeScript checks the whole project together. Press Run.

import { Circle, Rectangle, type Shape } from "./shapes";

// One list can hold different kinds of Shape.
const shapes: Shape[] = [new Circle(2), new Rectangle(3, 4)];

console.log("=== Warsha starter ===");
for (const shape of shapes) {
  console.log(\`\${shape.name}: area = \${shape.area().toFixed(2)}\`);
}

const total = shapes.reduce((sum, shape) => sum + shape.area(), 0);
console.log(\`Total area = \${total.toFixed(2)}\`);

// Open shapes.ts, add a Square class, then use it here and Run again.
console.log("Now open shapes.ts and add a Square.");
`

const WEB_MODULES_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Modules in a page</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>People</h1>
    <ul id="people"></ul>

    <!-- A module script can import other files and can be TypeScript. -->
    <script type="module" src="app.ts"></script>
  </body>
</html>
`

const WEB_MODULES_STYLES_CSS = `/* Plain CSS for the page. Warsha inlines it into the preview for you. */
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  max-width: 34rem;
  margin: 2rem auto;
  padding: 0 1rem;
  color: #1f2937;
  line-height: 1.6;
}

h1 {
  font-size: 1.5rem;
}

#people {
  list-style: none;
  padding: 0;
}

#people li {
  padding: 0.6rem 0.8rem;
  margin: 0.4rem 0;
  background: #f3f4f6;
  border-radius: 0.5rem;
}
`

const WEB_MODULES_GREETING_TS = `// A module: other files import what it \`export\`s. The type travels across the
// import, so app.ts knows exactly what a Person is.

export interface Person {
  name: string;
  role: string;
}

export function greet(person: Person): string {
  return \`Hello, \${person.name} — our \${person.role}.\`;
}
`

const WEB_MODULES_APP_TS = `// This runs inside the page as a module, so it can both import another file and
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
`

const WEB_TAILWIND_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tailwind card</title>

    <!-- Tailwind, served on your device. Write utility classes and press Run. -->
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="flex min-h-screen items-center justify-center bg-slate-100 p-6">
    <div class="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow-lg">
      <span class="text-xs font-semibold uppercase tracking-wide text-indigo-600">Warsha</span>
      <h1 class="text-2xl font-bold text-slate-800">Styled with Tailwind</h1>
      <p class="leading-relaxed text-slate-600">
        Every class here is a Tailwind utility. Change one — say
        <code class="rounded bg-slate-100 px-1 text-indigo-700">bg-white</code> to
        <code class="rounded bg-slate-100 px-1 text-indigo-700">bg-amber-50</code> —
        then press Run.
      </p>
      <button
        id="cheer"
        class="w-full rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-700"
      >
        Cheer me on
      </button>
      <p id="count" class="text-center text-sm text-slate-500">No cheers yet</p>
    </div>

    <script>
      // Plain JavaScript still runs alongside Tailwind. This counts clicks.
      let cheers = 0;
      const count = document.getElementById("count");
      document.getElementById("cheer").addEventListener("click", () => {
        cheers += 1;
        count.textContent = cheers === 1 ? "1 cheer 🎉" : \`\${cheers} cheers 🎉\`;
        console.log("cheers:", cheers); // also shows in the Console tab
      });
    </script>
  </body>
</html>
`

const WEB_REACT_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>React counter</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <!-- React renders into this element. The markup itself lives in App.tsx. -->
    <div id="root"></div>

    <!-- A module written in TypeScript + JSX. Warsha bundles it — and React,
         served on your device — into the page each time you press Run. -->
    <script type="module" src="main.tsx"></script>
  </body>
</html>
`

const WEB_REACT_MAIN_TSX = `// The entry point. It finds the #root element in index.html and hands it to
// React, which renders your <App /> into it.
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
`

const WEB_REACT_APP_TSX = `// A component is a function that returns markup (JSX). \`useState\` gives it
// memory: each click updates \`count\`, and React re-renders only what changed.
import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main className="card">
      <h1>Hello from React</h1>
      <p>
        You clicked {count} time{count === 1 ? "" : "s"}.
      </p>
      <button onClick={() => setCount(count + 1)}>Click me</button>
      <p className="hint">
        Change this text in <code>App.tsx</code>, then press Run.
      </p>
    </main>
  );
}
`

const WEB_REACT_STYLES_CSS = `/* Plain CSS, inlined into the preview for you. React builds the markup; the
   look still comes from here. */
:root {
  color-scheme: light dark;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
}
.card {
  text-align: center;
  padding: 2rem 2.5rem;
  border-radius: 1rem;
  background: #1e293b;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.card h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}
button {
  margin-top: 0.5rem;
  padding: 0.5rem 1.25rem;
  font: inherit;
  color: #fff;
  background: #6366f1;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
}
button:hover {
  background: #4f46e5;
}
.hint {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: #94a3b8;
}
`

const WEB_SVELTE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Svelte counter</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <!-- Svelte renders into this element. The markup lives in App.svelte. -->
    <div id="app"></div>

    <!-- main.js mounts your component. Warsha compiles App.svelte — and Svelte,
         served on your device — into the page each time you press Run. -->
    <script type="module" src="main.js"></script>
  </body>
</html>
`

const WEB_SVELTE_MAIN_JS = `// The entry point. It mounts your <App> into the #app element in index.html.
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (target) mount(App, { target });
`

const WEB_SVELTE_APP_SVELTE = `<script>
  // \`$state\` makes a value reactive: when \`count\` changes, Svelte updates only
  // the parts of the page that use it.
  let count = $state(0);
</script>

<main class="card">
  <h1>Hello from Svelte</h1>
  <p>You clicked {count} time{count === 1 ? "" : "s"}.</p>
  <button onclick={() => count++}>Click me</button>
  <p class="hint">Change this text in <code>App.svelte</code>, then press Run.</p>
</main>

<style>
  /* Scoped to this component — Svelte rewrites these selectors so they only
     touch App.svelte's own markup. */
  .card {
    text-align: center;
    padding: 2rem 2.5rem;
    border-radius: 1rem;
    background: #1e293b;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .card h1 {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
  }
  button {
    margin-top: 0.5rem;
    padding: 0.5rem 1.25rem;
    font: inherit;
    color: #fff;
    background: #ff3e00;
    border: none;
    border-radius: 0.5rem;
    cursor: pointer;
  }
  button:hover {
    background: #e63700;
  }
  .hint {
    margin-top: 1rem;
    font-size: 0.85rem;
    color: #94a3b8;
  }
</style>
`

const WEB_SVELTE_STYLES_CSS = `/* Page-level styles, inlined into the preview. The card itself is styled inside
   App.svelte with Svelte's scoped <style>. */
:root {
  color-scheme: light dark;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
}
`

const WEB_VUE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vue counter</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <!-- Vue mounts into this element. The markup lives in App.vue. -->
    <div id="app"></div>

    <!-- main.js creates the app. Warsha compiles App.vue — and Vue, served on
         your device — into the page each time you press Run. -->
    <script type="module" src="main.js"></script>
  </body>
</html>
`

const WEB_VUE_MAIN_JS = `// The entry point. It creates the Vue app from your <App> component and mounts
// it into the #app element in index.html.
import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
`

const WEB_VUE_APP_VUE = `<script setup>
// \`ref\` makes a value reactive: when \`count.value\` changes, Vue updates the
// parts of the template that use it. In the template you just write \`count\`.
import { ref } from "vue";

const count = ref(0);
</script>

<template>
  <main class="card">
    <h1>Hello from Vue</h1>
    <p>You clicked {{ count }} time{{ count === 1 ? "" : "s" }}.</p>
    <button @click="count++">Click me</button>
    <p class="hint">Change this text in <code>App.vue</code>, then press Run.</p>
  </main>
</template>

<style scoped>
/* \`scoped\` means these styles apply only to this component's markup. */
.card {
  text-align: center;
  padding: 2rem 2.5rem;
  border-radius: 1rem;
  background: #1e293b;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
}
.card h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}
button {
  margin-top: 0.5rem;
  padding: 0.5rem 1.25rem;
  font: inherit;
  color: #fff;
  background: #42b883;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
}
button:hover {
  background: #369870;
}
.hint {
  margin-top: 1rem;
  font-size: 0.85rem;
  color: #94a3b8;
}
</style>
`

const WEB_VUE_STYLES_CSS = `/* Page-level styles, inlined into the preview. The card itself is styled inside
   App.vue with Vue's scoped <style>. */
:root {
  color-scheme: light dark;
}
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, sans-serif;
  background: #0f172a;
  color: #e2e8f0;
}
`

const CSHARP_BASICS_PROGRAM_CS = `using System;

// Your first C# program. C# starts running at the top. Press Run.

// Console.WriteLine shows a line in the console.
Console.WriteLine("=== Warsha starter ===");

// A variable stores a value. C# needs its type: string, int.
string language = "C#";
int year = 2026;
Console.WriteLine("You are writing " + language + ".");

// A loop repeats. This counts 1, 2, 3.
for (int number = 1; number <= 3; number++)
{
    Console.WriteLine("Line " + number);
}

// Console.ReadLine reads one line that you type into the console.
Console.Write("Your name: ");
string? name = Console.ReadLine();

Console.WriteLine("Hello, " + name + "! Now change a line above and Run again.");
`

const CSHARP_METHODS_PROGRAM_CS = `using System;

/// <summary>Methods and an array — the next step after the basics.</summary>
class Program
{
    // A method is a named piece of code you can call with different values.
    // static means it belongs to the class, so Main() can call it directly.
    static string Greet(string name)
    {
        return "Hello, " + name + "!";
    }

    static double Average(int[] numbers)
    {
        int total = 0;
        foreach (int n in numbers)
        {
            total += n;
        }
        // Cast to double so 31 / 4 is 7.75, not 7.
        return (double)total / numbers.Length;
    }

    static void Main()
    {
        Console.WriteLine("=== Warsha starter ===");

        // An array holds many values of one type, in order.
        int[] scores = { 8, 6, 10, 7 };
        Console.WriteLine("Average: " + Average(scores));

        // Loop over the array and decide something for each value.
        foreach (int score in scores)
        {
            string verdict = score >= 7 ? "pass" : "retry";
            Console.WriteLine("Score " + score + " -> " + verdict);
        }

        Console.Write("Your name: ");
        string? name = Console.ReadLine();

        Console.WriteLine(Greet(name ?? "") + " Now add a score to the array and Run again.");
    }
}
`

const CSHARP_STARTER_PROGRAM_CS = `using System;
using System.Collections.Generic;

/// <summary>Warsha starter: objects from another file, inheritance, and input.</summary>
class Program
{
    static void Main()
    {
        // One list can hold different kinds of objects.
        List<Shape> shapes = new List<Shape> { new Circle(2), new Rectangle(3, 4) };

        Console.WriteLine("=== Warsha starter ===");
        foreach (Shape shape in shapes)
        {
            Console.WriteLine(shape.Describe()); // each class answers in its own way
        }

        double total = 0;
        foreach (Shape shape in shapes)
        {
            total += shape.Area();
        }
        Console.WriteLine($"Total area = {total:F2}");

        // Console.ReadLine waits for you to type one line into the console.
        Console.Write("Your name: ");
        string? name = Console.ReadLine();

        Console.WriteLine($"Hello, {name}! Now open Shapes.cs and add a Square.");
    }
}
`

const CSHARP_STARTER_SHAPES_CS = `using System;

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
`

const C_BASICS_MAIN_C = `#include <stdio.h>

/* C starts here, in main(). Press Run. */
int main(void) {
    printf("=== Warsha C starter ===\\n");

    // Typed variables: C needs a type for each one.
    int year = 2026;
    double pi = 3.14159;
    printf("year = %d, pi = %.2f\\n", year, pi);

    // A loop.
    printf("Counting: ");
    for (int i = 1; i <= 5; i++) {
        printf("%d ", i);
    }
    printf("\\n");

    // scanf reads what you type into the console.
    char name[64];
    printf("Your name: ");
    if (scanf("%63s", name) == 1) {
        printf("Hello, %s! Now edit main.c and press Run again.\\n", name);
    }
    return 0;
}
`

const C_METHODS_MAIN_C = `#include <stdio.h>

// A function you call from main. C needs it defined (or prototyped) before use.
double average(const int *values, int count) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += values[i];
    }
    return count > 0 ? (double) sum / count : 0.0;
}

const char *grade(double score) {
    if (score >= 90) return "excellent";
    if (score >= 60) return "passing";
    return "needs work";
}

int main(void) {
    int scores[] = {72, 88, 95, 51, 64};
    int n = (int) (sizeof scores / sizeof scores[0]);

    double avg = average(scores, n);
    printf("Average of %d scores: %.1f (%s)\\n", n, avg, grade(avg));

    // Decide per value.
    for (int i = 0; i < n; i++) {
        printf("  %d -> %s\\n", scores[i], grade(scores[i]));
    }

    // One number from you, graded the same way.
    int yours;
    printf("Enter a score: ");
    if (scanf("%d", &yours) == 1) {
        printf("You scored %d: %s\\n", yours, grade(yours));
    }
    return 0;
}
`

const C_STARTER_MAIN_C = `#include <stdio.h>
#include "shapes.h"

int main(void) {
    // An array of rectangles — a loop over "objects", each its own struct.
    Rectangle shapes[] = {
        {3.0, 4.0},
        {5.0, 5.0},
        {2.5, 8.0},
    };
    int n = (int) (sizeof shapes / sizeof shapes[0]);

    printf("=== rectangles ===\\n");
    for (int i = 0; i < n; i++) {
        Rectangle r = shapes[i];
        printf("%.1f x %.1f  area=%.1f  perimeter=%.1f\\n",
               r.width, r.height, rectangle_area(r), rectangle_perimeter(r));
    }

    // Build one from your input, then reuse the same functions.
    Rectangle mine;
    printf("Width and height: ");
    if (scanf("%lf %lf", &mine.width, &mine.height) == 2) {
        printf("Your rectangle: area=%.1f  perimeter=%.1f\\n",
               rectangle_area(mine), rectangle_perimeter(mine));
    }
    return 0;
}
`

const C_STARTER_SHAPES_H = `#ifndef SHAPES_H
#define SHAPES_H

// A rectangle: its data (width, height) and the operations on it, declared here
// and defined in shapes.c. main.c includes this header to use them.
typedef struct {
    double width;
    double height;
} Rectangle;

double rectangle_area(Rectangle r);
double rectangle_perimeter(Rectangle r);

#endif
`

const C_STARTER_SHAPES_C = `#include "shapes.h"

double rectangle_area(Rectangle r) {
    return r.width * r.height;
}

double rectangle_perimeter(Rectangle r) {
    return 2 * (r.width + r.height);
}
`

export const templates: Template[] = [
  {
    id: 'python-basics',
    name: 'Python basics',
    lang: 'python',
    level: 'beginner',
    blurb: 'Print, variables, a loop, and input() — one file, nothing else.',
    entry: 'main.py',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.py', content: PY_BASICS_MAIN_PY }],
    },
  },
  {
    id: 'python-functions',
    name: 'Python functions',
    lang: 'python',
    level: 'intermediate',
    blurb: 'Define functions, work through a list, and decide per value.',
    entry: 'main.py',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.py', content: PY_FUNCTIONS_MAIN_PY }],
    },
  },
  {
    id: 'java-basics',
    name: 'Java basics',
    lang: 'java',
    level: 'beginner',
    blurb: 'Print, typed variables, a loop, and a Scanner — one class, no packages.',
    entry: 'Main.java',
    snapshot: {
      dirs: [],
      files: [{ path: 'Main.java', content: JAVA_BASICS_MAIN_JAVA }],
    },
  },
  {
    id: 'java-methods',
    name: 'Java methods',
    lang: 'java',
    level: 'intermediate',
    blurb: 'Write static methods, average an array, and decide per value.',
    entry: 'Main.java',
    snapshot: {
      dirs: [],
      files: [{ path: 'Main.java', content: JAVA_METHODS_MAIN_JAVA }],
    },
  },
  {
    id: 'java-oop',
    name: 'Java (OOP starter)',
    lang: 'java',
    level: 'advanced',
    blurb:
      'Two classes in packages, inheritance, and a Scanner that reads what you type.',
    entry: 'app/Main.java',
    snapshot: {
      dirs: ['app', 'models'],
      files: [
        { path: 'app/Main.java', content: JAVA_APP_MAIN_JAVA },
        { path: 'models/Person.java', content: JAVA_MODELS_PERSON_JAVA },
        { path: 'models/Student.java', content: JAVA_MODELS_STUDENT_JAVA },
      ],
    },
  },
  {
    id: 'python',
    name: 'Python (OOP starter)',
    lang: 'python',
    level: 'advanced',
    blurb:
      'A shapes module with classes, a loop over objects, and input().',
    entry: 'main.py',
    snapshot: {
      dirs: ['helpers'],
      files: [
        { path: 'helpers/shapes.py', content: PY_HELPERS_SHAPES_PY },
        { path: 'main.py', content: PY_MAIN_PY },
      ],
    },
  },
  {
    id: 'web-page',
    name: 'Web page',
    lang: 'web',
    level: 'beginner',
    blurb: 'HTML for the structure, CSS for the look — and a live preview.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [
        { path: 'index.html', content: WEB_PAGE_INDEX_HTML },
        { path: 'styles.css', content: WEB_PAGE_STYLES_CSS },
      ],
    },
  },
  {
    id: 'web-js',
    name: 'JavaScript basics',
    lang: 'web',
    level: 'beginner',
    blurb: 'JavaScript on its own — a loop, a function, output in the Console.',
    entry: 'script.js',
    snapshot: {
      dirs: [],
      files: [{ path: 'script.js', content: WEB_JS_SCRIPT_JS }],
    },
  },
  {
    id: 'web-interactive',
    name: 'Interactive page',
    lang: 'web',
    level: 'intermediate',
    blurb: 'A button that reacts to clicks — HTML, CSS and JavaScript together.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [
        { path: 'index.html', content: WEB_INTERACTIVE_INDEX_HTML },
        { path: 'styles.css', content: WEB_INTERACTIVE_STYLES_CSS },
        { path: 'script.js', content: WEB_INTERACTIVE_SCRIPT_JS },
      ],
    },
  },
  {
    id: 'web-ts',
    name: 'TypeScript basics',
    lang: 'web',
    level: 'beginner',
    blurb: 'Types, an interface, and a typed function — output in the Console.',
    entry: 'main.ts',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.ts', content: WEB_TS_MAIN_TS }],
    },
  },
  {
    id: 'web-ts-modules',
    name: 'TypeScript modules',
    lang: 'web',
    level: 'intermediate',
    blurb: 'Split a typed program across files with import and export.',
    entry: 'main.ts',
    snapshot: {
      dirs: [],
      files: [
        { path: 'main.ts', content: WEB_TS_MODULES_MAIN_TS },
        { path: 'shapes.ts', content: WEB_TS_MODULES_SHAPES_TS },
      ],
    },
  },
  {
    id: 'web-tailwind',
    name: 'Tailwind card',
    lang: 'web',
    level: 'intermediate',
    blurb: 'Tailwind utility classes, served on your device — a styled card, no build step.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [{ path: 'index.html', content: WEB_TAILWIND_INDEX_HTML }],
    },
  },
  {
    id: 'web-modules',
    name: 'Modules in a page',
    lang: 'web',
    level: 'advanced',
    blurb: 'A page whose module script imports TypeScript — bundled live, then rendered.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [
        { path: 'index.html', content: WEB_MODULES_INDEX_HTML },
        { path: 'styles.css', content: WEB_MODULES_STYLES_CSS },
        { path: 'app.ts', content: WEB_MODULES_APP_TS },
        { path: 'greeting.ts', content: WEB_MODULES_GREETING_TS },
      ],
    },
  },
  {
    id: 'web-react',
    name: 'React counter',
    lang: 'web',
    level: 'advanced',
    blurb: 'A React component with state — TSX and React, bundled on your device.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [
        { path: 'index.html', content: WEB_REACT_INDEX_HTML },
        { path: 'styles.css', content: WEB_REACT_STYLES_CSS },
        { path: 'main.tsx', content: WEB_REACT_MAIN_TSX },
        { path: 'App.tsx', content: WEB_REACT_APP_TSX },
      ],
    },
  },
  {
    id: 'web-svelte',
    name: 'Svelte counter',
    lang: 'web',
    level: 'advanced',
    blurb: 'A Svelte component with runes and scoped styles — compiled on your device.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [
        { path: 'index.html', content: WEB_SVELTE_INDEX_HTML },
        { path: 'styles.css', content: WEB_SVELTE_STYLES_CSS },
        { path: 'main.js', content: WEB_SVELTE_MAIN_JS },
        { path: 'App.svelte', content: WEB_SVELTE_APP_SVELTE },
      ],
    },
  },
  {
    id: 'web-vue',
    name: 'Vue counter',
    lang: 'web',
    level: 'advanced',
    blurb: 'A Vue single-file component with a ref and scoped styles — compiled on your device.',
    entry: 'index.html',
    snapshot: {
      dirs: [],
      files: [
        { path: 'index.html', content: WEB_VUE_INDEX_HTML },
        { path: 'styles.css', content: WEB_VUE_STYLES_CSS },
        { path: 'main.js', content: WEB_VUE_MAIN_JS },
        { path: 'App.vue', content: WEB_VUE_APP_VUE },
      ],
    },
  },
  {
    id: 'csharp-basics',
    name: 'C# basics',
    lang: 'csharp',
    level: 'beginner',
    blurb: 'Print, typed variables, a loop, and Console.ReadLine — one file, top to bottom.',
    entry: 'Program.cs',
    snapshot: {
      dirs: [],
      files: [{ path: 'Program.cs', content: CSHARP_BASICS_PROGRAM_CS }],
    },
  },
  {
    id: 'csharp-methods',
    name: 'C# methods',
    lang: 'csharp',
    level: 'intermediate',
    blurb: 'Write static methods, average an array, and decide per value.',
    entry: 'Program.cs',
    snapshot: {
      dirs: [],
      files: [{ path: 'Program.cs', content: CSHARP_METHODS_PROGRAM_CS }],
    },
  },
  {
    id: 'csharp-starter',
    name: 'C# (OOP starter)',
    lang: 'csharp',
    level: 'advanced',
    blurb: 'A shapes class in its own file, inheritance, a loop over objects, and input.',
    entry: 'Program.cs',
    snapshot: {
      dirs: [],
      files: [
        { path: 'Program.cs', content: CSHARP_STARTER_PROGRAM_CS },
        { path: 'Shapes.cs', content: CSHARP_STARTER_SHAPES_CS },
      ],
    },
  },
  {
    id: 'c-basics',
    name: 'C basics',
    lang: 'c',
    level: 'beginner',
    blurb: 'Print, typed variables, a loop, and scanf — one file, top to bottom.',
    entry: 'main.c',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.c', content: C_BASICS_MAIN_C }],
    },
  },
  {
    id: 'c-methods',
    name: 'C functions',
    lang: 'c',
    level: 'intermediate',
    blurb: 'Write functions, average an array, and decide per value.',
    entry: 'main.c',
    snapshot: {
      dirs: [],
      files: [{ path: 'main.c', content: C_METHODS_MAIN_C }],
    },
  },
  {
    id: 'c-starter',
    name: 'C (structs starter)',
    lang: 'c',
    level: 'advanced',
    blurb: 'A struct and its functions across a header and source file, a loop, and input.',
    entry: 'main.c',
    snapshot: {
      dirs: [],
      files: [
        { path: 'main.c', content: C_STARTER_MAIN_C },
        { path: 'shapes.h', content: C_STARTER_SHAPES_H },
        { path: 'shapes.c', content: C_STARTER_SHAPES_C },
      ],
    },
  },
]
