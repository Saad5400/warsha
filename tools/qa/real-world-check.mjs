/* Real-world run check: what students actually do, in every language, through
 * the real UI and the real engines.
 *
 * Each project is opened through a #share= link (lib/rw.mjs) — the same path a
 * teacher's link takes — so source arrives byte-exact with no typing into
 * CodeMirror, then run with the tab strip's Run button, stdin typed into the
 * console's input row, and judged on the transcript and the console panel's
 * data-state alone. Every scenario also asserts window.__warshaErrors (the
 * page's own unhandled-error tally) stays empty and no failure card appears:
 * an error "from the platform itself" is exactly what this suite hunts.
 *
 *   cd app && npx vite --port 8150 --strictPort --host 127.0.0.1
 *   cd tools/qa && WARSHA_URL=http://127.0.0.1:8150/ CHROME=... node real-world-check.mjs [section…]
 *
 * Sections (default: all): python java csharp c js web notebooks behaviour
 * projects environment debugger editor. One browser at a time; the C and Java engines
 * are memory-hungry, so never run this beside another browser suite.
 *
 * A dev server is fine for everything here (and needed for nothing special);
 * `environment` also exercises an offline run, which needs the service worker's
 * runtime cache and so is most faithful against `vite preview`.
 */
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import {
  END_LINE, STDIN, openProject, output, runButton, runToEnd, setEditorText, status, stopButton, tally, typeLine,
  waitRunnable, waitState, waitText,
} from './lib/rw.mjs'

const BASE = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8150/').replace(/\/?$/, '/') + '?lang=en'
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'
const SHOTS = process.env.WARSHA_SHOTS ?? join(import.meta.dirname, 'screenshots')
mkdirSync(SHOTS, { recursive: true })
const ALL = ['python', 'java', 'csharp', 'c', 'js', 'web', 'notebooks', 'behaviour', 'projects', 'environment', 'debugger', 'editor']
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ALL

const { check, results } = tally()

/** One persistent profile for the whole suite, so every engine downloads once. */
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-rw-')), {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 900 },
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
page.on('pageerror', (e) => console.log('      pageerror: ' + e.message))
// Mute Vite's HMR socket: an edit elsewhere in the tree would full-reload mid-scenario.
await page.routeWebSocket(/./, () => {})

const platformErrors = (p = page) => p.evaluate(() => window.__warshaErrors ?? []).catch(() => ['page gone'])
const failureCards = (p = page) => p.locator('[data-failure]').count()
/** A failure card's whole text, Details included — the raw engine error is the thing to report. */
async function failureDetail(p = page) {
  if (!(await failureCards(p))) return ''
  await p.locator('[data-failure]').getByRole('button', { name: /Details/ }).click().catch(() => {})
  return ' FAILURE CARD: ' + (await p.locator('[data-failure]').first().innerText()).replace(/\s+/g, ' ')
}
/** The things that must never show up in a student's console, whatever their program did. */
const PLATFORM_NOISE = /could not start|already running|stopped responding|wasm-function|blob:http|\[c runtime error\]|at System\.Reflection\./

async function scenario(name, fn) {
  try {
    await fn()
  } catch (e) {
    check(name, false, 'threw ' + String(e?.message ?? e).split('\n')[0])
    await page.screenshot({ path: join(SHOTS, `rw-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) }).catch(() => {})
  }
}

/**
 * Runs a table of programs: open, run (typing `stdin` at each prompt), then
 * expect the end state, every `expect` in the transcript and no `not`.
 */
async function programs(cases) {
  for (const c of cases) {
    await scenario(c.name, async () => {
      await openProject(page, BASE, c.name, c.files, c.entry ?? null)
      const r = await runToEnd(page, { stdin: c.stdin ?? [], timeout: c.timeout ?? 240000 })
      const missing = (c.expect ?? []).filter((e) => !(e instanceof RegExp ? e.test(r.text) : r.text.includes(e)))
      const present = [...(c.not ?? []), PLATFORM_NOISE].filter((e) => (e instanceof RegExp ? e.test(r.text) : r.text.includes(e)))
      const errs = await platformErrors()
      check(c.name, r.state === (c.state ?? 'ok') && !missing.length && !present.length && !errs.length && !(await failureCards()),
        `state=${r.state} missing=${JSON.stringify(missing.map(String))} unwanted=${JSON.stringify(present.map(String))} errors=${errs.length} :: ${r.text.slice(-400)}${await failureDetail()}`)
    })
  }
}

// ---------------------------------------------------------------------------- python
const PYTHON = [
  { name: 'python: input, loops, lists, dicts, strings', files: { 'main.py': `n = int(input("How many? "))
nums = []
for i in range(n):
    nums.append(int(input(f"#{i+1}: ")))
print("sum", sum(nums), "avg", sum(nums)/n)
d = {}
for w in "the cat the dog".split():
    d[w] = d.get(w, 0) + 1
print(sorted(d.items()))
s = "Hello World"
print(s.upper(), s[::-1], s.count("o"), s.replace("World", "عالم"))
` }, stdin: ['3', '1', '2', '3'], expect: ['sum 6 avg 2.0', "[('cat', 1), ('dog', 1), ('the', 2)]", 'HELLO WORLD dlroW olleH 2 Hello عالم'] },
  { name: 'python: modules in folders + classes', files: { 'main.py': 'from shapes import Circle, Square\nfrom util.mathx import twice\nfor s in [Circle(1), Square(2)]:\n    print(s)\nprint(twice(21))\n',
    'shapes.py': 'import math\nclass Shape:\n    def area(self): raise NotImplementedError\n    def __str__(self): return f"{type(self).__name__} {self.area():.2f}"\nclass Circle(Shape):\n    def __init__(self, r): self.r = r\n    def area(self): return math.pi * self.r ** 2\nclass Square(Shape):\n    def __init__(self, s): self.s = s\n    def area(self): return self.s * self.s\n',
    'util/mathx.py': 'def twice(x):\n    return 2 * x\n' }, expect: ['Circle 3.14', 'Square 4.00', '42'] },
  { name: 'python: read a project file, write one back', files: { 'main.py': 'with open("data.txt") as f:\n    lines = [l.strip() for l in f]\nprint(lines)\nwith open("report.txt", "w") as f:\n    f.write("total=%d\\n" % len(lines))\nprint(open("report.txt").read().strip())\n', 'data.txt': 'a\nb\nc\n' },
    expect: ["['a', 'b', 'c']", 'total=3', /saved report\.txt/] },
  { name: 'python: traceback names the file and line', files: { 'main.py': 'def f(x):\n    return 10 / x\nprint("before")\nf(0)\n' }, state: 'failed', expect: ['before', 'line 2', 'ZeroDivisionError'] },
  { name: 'python: syntax error', files: { 'main.py': 'print("a"\nx = 1\n' }, state: 'failed', expect: ['SyntaxError'] },
  { name: 'python: sys.exit(3)', files: { 'main.py': 'import sys\nprint("x")\nsys.exit(3)\n' }, state: 'failed', expect: [/exit code 3/] },
  { name: 'python: 100k lines of output', files: { 'main.py': 'for i in range(100000):\n    print("line", i)\nprint("END")\n' }, expect: ['END'] },
  { name: 'python: numpy', files: { 'main.py': 'import numpy as np\na = np.arange(6).reshape(2, 3)\nprint(a.sum(), a.T.shape)\n' }, expect: ['15 (3, 2)'] },
  { name: 'python: pandas reads a csv', files: { 'main.py': 'import pandas as pd\ndf = pd.read_csv("grades.csv")\nprint(df["score"].mean())\n', 'grades.csv': 'name,score\nali,90\nsara,80\nali,70\n' }, expect: ['80.0'] },
  { name: 'python: Arabic identifiers and output', files: { 'main.py': 'اسم = input("الاسم: ")\nprint(f"أهلا {اسم}")\n' }, stdin: ['سعد'], expect: ['أهلا سعد'] },
]

// ------------------------------------------------------------------------------ java
const J = (body, imports = 'import java.util.*;') => `${imports}\npublic class Main {\n  public static void main(String[] args) throws Exception {\n${body}\n  }\n}\n`
const JAVA = [
  { name: 'java: Scanner nextInt/nextLine/nextDouble mix', files: { 'Main.java': J('Scanner in = new Scanner(System.in);\nSystem.out.print("Age: ");\nint age = in.nextInt();\nin.nextLine();\nSystem.out.print("Name: ");\nString name = in.nextLine();\nSystem.out.print("GPA: ");\ndouble g = in.nextDouble();\nSystem.out.printf("%s is %d, gpa %.2f%n", name, age, g);') },
    stdin: ['20', 'سعد بتوا', '3.75'], expect: ['سعد بتوا is 20, gpa 3.75'] },
  { name: 'java: arrays and String methods', files: { 'Main.java': J('int[] a = {5, 3, 9, 1};\nArrays.sort(a);\nSystem.out.println(Arrays.toString(a));\nString s = "Hello, Java";\nSystem.out.println(s.length() + " " + s.toUpperCase() + " " + s.indexOf("Java") + " " + s.substring(7) + " " + new StringBuilder(s).reverse());') },
    expect: ['[1, 3, 5, 9]', '11 HELLO, JAVA 7 Java avaJ ,olleH'] },
  { name: 'java: OOP across files (interface, abstract, inheritance)', files: {
    'Main.java': J('List<Shape> shapes = new ArrayList<>(List.of(new Circle(1), new Rect(2, 3)));\nfor (Shape s : shapes) System.out.println(s.name() + " " + String.format("%.2f", s.area()));\nAnimal d = new Dog("Rex");\nd.speak();'),
    'Shape.java': 'public interface Shape {\n  double area();\n  default String name() { return getClass().getSimpleName(); }\n}\n',
    'Circle.java': 'public class Circle implements Shape {\n  private final double r;\n  public Circle(double r) { this.r = r; }\n  public double area() { return Math.PI * r * r; }\n}\n',
    'Rect.java': 'public class Rect implements Shape {\n  private final double w, h;\n  public Rect(double w, double h) { this.w = w; this.h = h; }\n  public double area() { return w * h; }\n}\n',
    'Animal.java': 'public abstract class Animal {\n  protected String name;\n  public Animal(String name) { this.name = name; }\n  public abstract void speak();\n}\n',
    'Dog.java': 'public class Dog extends Animal {\n  public Dog(String n) { super(n); }\n  public void speak() { System.out.println(name + " says woof"); }\n}\n',
  }, expect: ['Circle 3.14', 'Rect 6.00', 'Rex says woof'] },
  { name: 'java: packages in folders', files: {
    'src/com/school/Main.java': 'package com.school;\nimport com.school.model.Student;\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println(new Student("Lina", 95));\n  }\n}\n',
    'src/com/school/model/Student.java': 'package com.school.model;\npublic class Student {\n  private String name; private int grade;\n  public Student(String n, int g) { name = n; grade = g; }\n  public String toString() { return name + ":" + grade; }\n}\n',
  }, expect: ['Lina:95'] },
  { name: 'java: ArrayList, HashMap, streams', files: { 'Main.java': J('ArrayList<String> names = new ArrayList<>(List.of("b", "a", "c"));\nCollections.sort(names);\nMap<String, Integer> m = new TreeMap<>();\nfor (String w : "a b a".split(" ")) m.merge(w, 1, Integer::sum);\nSystem.out.println(names + " " + m + " " + names.stream().map(String::toUpperCase).toList());') },
    expect: ['[a, b, c] {a=2, b=1} [A, B, C]'] },
  { name: 'java: custom exception caught, finally', files: { 'Main.java': J('try { withdraw(5, 10); } catch (Insufficient e) { System.out.println("caught: " + e.getMessage()); } finally { System.out.println("finally"); }\n}\nstatic void withdraw(int b, int a) throws Insufficient { if (a > b) throw new Insufficient("need " + (a - b)); }\nstatic class Insufficient extends Exception { Insufficient(String m) { super(m); }') },
    expect: ['caught: need 5', 'finally'] },
  { name: 'java: uncaught exception', files: { 'Main.java': J('System.out.println("start");\nString s = null;\nSystem.out.println(s.length());') }, state: 'failed', expect: ['start', 'NullPointerException'] },
  { name: 'java: compile errors name file and line', files: { 'Main.java': J('int x = "hello";\nSystem.out.println(y);') }, state: 'failed', expect: ['Main.java (at line 4)', 'y cannot be resolved'] },
  // The regression this suite was written around: relative java.io names used to resolve to /files/.
  { name: 'java: Scanner(File) reads a project file, FileWriter writes one', files: { 'Main.java': J('try (FileWriter w = new FileWriter("out.txt")) { w.write("line1\\n"); }\nScanner f = new Scanner(new File("data.txt"));\nint sum = 0; while (f.hasNextInt()) sum += f.nextInt();\nSystem.out.println("sum=" + sum);\nBufferedReader br = new BufferedReader(new FileReader("out.txt"));\nSystem.out.println(br.readLine() + " " + new File("data.txt").exists());\nbr.close();', 'import java.util.*;\nimport java.io.*;'), 'data.txt': '1 2 3\n4\n' },
    expect: ['sum=10', 'line1 true', /saved out\.txt/] },
  { name: 'java: Java 17 (record, switch expression, text block)', files: { 'Main.java': J('record P(int x, int y) {}\nString day = switch (3) { case 1 -> "Mon"; case 3 -> "Wed"; default -> "?"; };\nSystem.out.println(new P(1, 2) + " " + day);') }, expect: ['P[x=1, y=2] Wed'] },
  { name: 'java: System.exit(2)', files: { 'Main.java': J('System.out.println("bye"); System.exit(2);') }, state: 'failed', expect: [/exit code 2/] },
]

// ---------------------------------------------------------------------------- csharp
const CSHARP = [
  { name: 'csharp: ReadLine, int.Parse, interpolation', files: { 'Program.cs': 'Console.Write("Name: ");\nstring name = Console.ReadLine();\nConsole.Write("Age: ");\nint age = int.Parse(Console.ReadLine());\nConsole.WriteLine($"Hi {name}, next year {age + 1}");\n' }, stdin: ['سعد', '20'], expect: ['Hi سعد, next year 21'] },
  { name: 'csharp: classes across files + LINQ', files: { 'Program.cs': 'using System.Linq;\nvar people = new List<Person> { new Student("Ali", 3.5), new Student("Sara", 3.9) };\nforeach (var p in people) Console.WriteLine(p.Describe());\nConsole.WriteLine("best " + people.OfType<Student>().OrderByDescending(s => s.Gpa).First().Name);\n',
    'Person.cs': 'abstract class Person { public string Name { get; } protected Person(string n) { Name = n; } public abstract string Describe(); }\nclass Student : Person { public double Gpa { get; } public Student(string n, double g) : base(n) { Gpa = g; } public override string Describe() => $"{Name} gpa {Gpa:F1}"; }\n' },
    expect: ['Ali gpa 3.5', 'Sara gpa 3.9', 'best Sara'] },
  { name: 'csharp: unhandled exception reads like dotnet run', files: { 'Program.cs': 'Console.WriteLine("before");\nint[] a = new int[2];\na[3] = 1;\n' }, state: 'failed', expect: ['before', 'Unhandled exception. System.IndexOutOfRangeException'] },
  { name: 'csharp: compile error', files: { 'Program.cs': 'int x = "s";\n' }, state: 'failed', expect: ['Program.cs(1,9): error CS0029'] },
  { name: 'csharp: files', files: { 'Program.cs': 'var lines = File.ReadAllLines("data.txt");\nFile.WriteAllText("out.txt", "ok\\n");\nConsole.WriteLine(lines.Length);\n', 'data.txt': 'a\nb\n' }, expect: ['2', /saved out\.txt/] },
  { name: 'csharp: Environment.Exit(3)', files: { 'Program.cs': 'Console.WriteLine("bye");\nEnvironment.Exit(3);\n' }, state: 'failed', expect: ['bye', /exit code 3/] },
]

// --------------------------------------------------------------------------------- c
const C = [
  { name: 'c: printf + scanf', files: { 'main.c': '#include <stdio.h>\nint main(void) {\n  int a, b;\n  printf("Two numbers: ");\n  scanf("%d %d", &a, &b);\n  char name[50];\n  printf("Name: ");\n  scanf("%49s", name);\n  printf("%s: %d\\n", name, a + b);\n  return 0;\n}\n' }, stdin: ['3 4', 'Saad'], expect: ['Saad: 7'] },
  { name: 'c: structs, malloc, header + second .c', files: { 'main.c': '#include <stdio.h>\n#include <stdlib.h>\n#include "stack.h"\nint main(void) {\n  Stack *s = stack_new(2);\n  for (int i = 1; i <= 5; i++) push(s, i * i);\n  while (s->len) printf("%d ", pop(s));\n  printf("\\n");\n  return 0;\n}\n',
    'stack.h': '#ifndef STACK_H\n#define STACK_H\ntypedef struct { int *data; int len, cap; } Stack;\nStack *stack_new(int cap);\nvoid push(Stack *s, int v);\nint pop(Stack *s);\n#endif\n',
    'stack.c': '#include <stdlib.h>\n#include "stack.h"\nStack *stack_new(int cap) { Stack *s = malloc(sizeof *s); s->data = malloc(cap * sizeof(int)); s->len = 0; s->cap = cap; return s; }\nvoid push(Stack *s, int v) { if (s->len == s->cap) { s->cap *= 2; s->data = realloc(s->data, s->cap * sizeof(int)); } s->data[s->len++] = v; }\nint pop(Stack *s) { return s->data[--s->len]; }\n' },
    expect: ['25 16 9 4 1'] },
  { name: 'c: fopen read + write', files: { 'main.c': '#include <stdio.h>\nint main(void) {\n  FILE *f = fopen("data.txt", "r");\n  int x, sum = 0;\n  while (fscanf(f, "%d", &x) == 1) sum += x;\n  fclose(f);\n  FILE *o = fopen("out.txt", "w");\n  fprintf(o, "sum=%d\\n", sum);\n  fclose(o);\n  printf("sum=%d\\n", sum);\n  return 0;\n}\n', 'data.txt': '1 2 3\n' }, expect: ['sum=6', /saved out\.txt/] },
  { name: 'c: compile error names main.c, not the mount', files: { 'main.c': '#include <stdio.h>\nint main(void) {\n  int x = 1\n  return 0;\n}\n' }, state: 'failed', expect: [/^main\.c:3:/m], not: ['/project/'] },
  { name: 'c: NULL dereference is a crash sentence, not a wasm stack', files: { 'main.c': '#include <stdio.h>\nint main(void) {\n  printf("before\\n");\n  int *p = 0;\n  *p = 5;\n  printf("%d\\n", *p);\n  return 0;\n}\n' }, state: 'failed', expect: ['before', 'Your program crashed'] },
  { name: 'c: integer division by zero', files: { 'main.c': '#include <stdio.h>\nint main(void) { int b; scanf("%d", &b); printf("%d\\n", 5 / b); return 0; }\n' }, stdin: ['0'], state: 'failed', expect: ['division by zero'] },
  { name: 'c: exit(4)', files: { 'main.c': '#include <stdio.h>\n#include <stdlib.h>\nint main(void) { puts("bye"); exit(4); }\n' }, state: 'failed', expect: [/exit code 4/] },
]

// -------------------------------------------------------------------------------- js
const JS = [
  { name: 'js: console.log prints values the way Node does', files: { 'main.js': 'console.log(0/0, [1, undefined, 3], {a: 1, b: "x"}, new Map([["k", 1]]), new Set([1, 2]), () => 1)\nconsole.table([{a: 1}, {a: 2}])\n' },
    expect: ["NaN [ 1, undefined, 3 ] { a: 1, b: 'x' } Map(1) { 'k' => 1 } Set(2) { 1, 2 } [Function (anonymous)]", '(index)'] },
  { name: 'js: a fetch().then() chain prints before the run ends', files: { 'main.js': 'fetch("data:application/json,%7B%22ok%22%3A1%7D").then((r) => r.json()).then((d) => console.log("got", d.ok))\n' }, expect: ['got 1'] },
  { name: 'js: code after await sleep() runs', files: { 'main.js': 'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))\nasync function main() { console.log("a"); await sleep(300); console.log("b") }\nmain()\n' }, expect: [/a\nb/] },
  { name: 'js: an error names main.js and the real line', files: { 'main.js': 'console.log("before")\nnull.x\n' }, state: 'failed', expect: ['before', 'TypeError', 'main.js:2:'] },
  { name: 'js: an error in a timer fails the run', files: { 'main.js': 'setTimeout(() => { throw new Error("boom") }, 10)\n' }, state: 'failed', expect: ['boom'] },
  { name: 'ts: modules + types', files: { 'main.ts': 'import { add } from "./math"\nconst n: number = add(2, 3)\nconsole.log(`n=${n}`)\n', 'math.ts': 'export function add(a: number, b: number): number { return a + b }\n' }, expect: ['n=5'] },
]


// --------------------------------------------------------------------------- notebooks
const nbJson = (cells) => JSON.stringify({
  nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3' } },
  cells: cells.map((source, i) => ({ cell_type: 'code', id: `c${i}`, metadata: {}, execution_count: null, outputs: [], source })),
})
const codeCell = (i, p = page) => p.locator('[data-cell-type="code"]').nth(i)
const cellOutput = (i, p = page) => codeCell(i, p).locator('[aria-label="Cell output"]').innerText().catch(() => '')
const runCell = (i, p = page) => codeCell(i, p).getByRole('button', { name: 'Run cell' }).click()
const nbButton = (name, p = page) => p.locator('[data-notebook] [role="toolbar"]').getByRole('button', { name, exact: true }).first()
const kernelIdle = (timeout = 240000, p = page) => p.waitForFunction(
  () => ![...document.querySelectorAll('[data-cell-type="code"]')].some((c) => /running|queued/.test(c.getAttribute('data-state') ?? '')),
  null, { timeout }).then(() => true).catch(() => false)
async function openNotebook(name, files, file, p = page) {
  await openProject(p, BASE, name, files).catch(() => {}) // a notebook-only project has no Run entry
  // A project whose only file is the notebook opens it; otherwise open it from the
  // explorer (a drawer on a phone). The notebook view is a lazy chunk: allow for it.
  if (!(await p.waitForSelector(`[data-notebook="${file}"]`, { timeout: 15000 }).then(() => true).catch(() => false))) {
    if (!(await p.locator('[role="treeitem"]').first().isVisible().catch(() => false))) {
      await p.getByRole('button', { name: 'Explorer', exact: true }).first().click()
    }
    await p.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^\\s*${file.replace('.', '\\.')}\\s*$`) }).first().click()
  }
  await p.waitForSelector(`[data-notebook="${file}"]`, { timeout: 60000 })
}

// ---------------------------------------------------------------------------- helpers
/**
 * The page preview's frame once `selector` is on its page. A sandboxed srcdoc
 * iframe has no URL to find it by, and the element is replaced between runs, so
 * look it up afresh until the rendered document holds `selector`.
 */
async function previewFrame(selector, timeout = 120000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const el = await page.locator('iframe[title="Preview"]').last().elementHandle({ timeout: 2000 }).catch(() => null)
    const frame = el && (await el.contentFrame())
    if (frame && (await frame.$(selector).catch(() => null))) return frame
    await page.waitForTimeout(250)
  }
  throw new Error(`the preview never showed ${selector}`)
}
async function clickRun() {
  await waitRunnable(page)
  await page.waitForTimeout(300) // the shell ignores a Run within 250 ms of the control swapping role
  await runButton(page).click()
}
/** A file's context-menu action (right-click: the row's ⋯ button exists only on touch layouts). */
async function rowAction(file, action) {
  await page.locator('[role="treeitem"]').filter({ hasText: new RegExp(`^\\s*${file.replace('.', '\\.')}\\s*$`) }).first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: action }).first().click()
}
const clean = async (name) => {
  const errs = await platformErrors()
  check(`${name}: no platform errors`, !errs.length && !(await failureCards()) && !PLATFORM_NOISE.test(await output(page)), JSON.stringify(errs))
}

// ----------------------------------------------------------------------------- sections
const sections = {
  python: () => programs(PYTHON),
  java: () => programs(JAVA),
  async csharp() {
    await programs(CSHARP)
    await scenario('csharp: the same tab runs again after Environment.Exit', async () => {
      // Exit shuts that worker's .NET runtime down; the engine must replace it.
      await openProject(page, BASE, 'cs exit', { 'Program.cs': 'Console.WriteLine("first");\nEnvironment.Exit(3);\n' })
      await runToEnd(page)
      await setEditorText(page, 'Console.WriteLine("alive again");\n')
      const r = await runToEnd(page)
      check('csharp: the same tab runs again after Environment.Exit', r.state === 'ok' && /alive again/.test(r.text), r.text + (await failureDetail()))
    })
  },
  async c() {
    await programs(C)
  },
  js: () => programs(JS),

  async web() {
    await scenario('web: page + css + js, clicks and console', async () => {
      await openProject(page, BASE, 'web page', {
        'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 id="t">Hi</h1><button id="b">+</button><span id="n">0</span><script src="app.js"></script></body></html>\n',
        'style.css': 'h1 { color: rgb(255, 0, 0); }\n',
        'app.js': 'let n = 0\ndocument.getElementById("b").addEventListener("click", () => { n++; document.getElementById("n").textContent = n; console.log("clicked", n, { n }) })\nconsole.log("loaded", 0/0)\n',
      })
      await clickRun()
      await waitState(page, 'running', 60000)
      await page.getByRole('tab', { name: /Preview/i }).first().click()
      const f = await previewFrame('#b')
      // The listener is attached by the script at the end of the body: wait for it to have run.
      await f.waitForFunction(() => document.readyState === 'complete')
      await f.locator('#b').click()
      await f.locator('#b').click()
      const color = await f.evaluate(() => getComputedStyle(document.getElementById('t')).color)
      const n = await f.evaluate(() => document.getElementById('n').textContent)
      check('web: css applies, js runs, clicks update the page', color === 'rgb(255, 0, 0)' && n === '2', `${color} ${n}`)
      await page.getByRole('tab', { name: /Console/i }).first().click().catch(() => {})
      check('web: page console.log reaches the Console, formatted', await waitText(page, /loaded NaN[\s\S]*clicked 2 \{ n: 2 \}/, 5000), await output(page))
      await stopButton(page).click()
      await waitState(page, 'stopped', 5000)
      await clean('web page')
    })
    for (const name of ['React counter', 'Vue counter', 'Svelte counter']) {
      await scenario(`web: ${name} template`, async () => {
        await page.getByRole('button', { name: 'Home', exact: true }).first().click()
        await page.getByRole('button', { name: 'New project', exact: true }).first().click()
        await page.locator('dialog[open]').getByRole('button', { name: /^Web/ }).click()
        await page.locator('.template-card').filter({ hasText: name }).first().click()
        const nameBox = page.locator('dialog[open] input')
        if (await nameBox.count()) { await nameBox.first().fill(`${name} ${Date.now()}`); await nameBox.first().press('Enter') }
        await page.waitForSelector('.cm-content', { timeout: 30000 })
        await clickRun()
        await waitState(page, 'running', 120000)
        // The output view is remembered per session: an earlier scenario left Console on top.
        await page.getByRole('tab', { name: /Preview/i }).first().click()
        const f = await previewFrame('button')
        const before = await f.evaluate(() => document.body.innerText)
        await f.locator('button').first().click()
        await page.waitForTimeout(400)
        const after = await f.evaluate(() => document.body.innerText)
        check(`web: ${name} renders and reacts to a click`, before.trim().length > 0 && before !== after, `${JSON.stringify(before.slice(0, 60))} -> ${JSON.stringify(after.slice(0, 60))}`)
        await stopButton(page).click()
        await waitState(page, 'stopped', 5000)
        await clean(`web ${name}`)
      })
    }
  },

  async notebooks() {
    await scenario('notebooks: a Colab export, Run all', async () => {
      const colab = readFileSync(join(import.meta.dirname, '../../app/tests/notebook/fixtures/colab-export.ipynb'), 'utf8')
      await openNotebook('colab', { 'lab3.ipynb': colab }, 'lab3.ipynb')
      await nbButton('Run all').click()
      await page.waitForTimeout(2000)
      check('notebooks: Run all finishes (with !pip install, pandas, matplotlib)', await kernelIdle(300000))
      const states = await page.locator('[data-cell-type="code"]').evaluateAll((cs) => cs.map((c) => c.getAttribute('data-state')))
      check('notebooks: every cell ran; only 1 / 0 errored', JSON.stringify(states.slice(0, 4)) === JSON.stringify(['ok', 'ok', 'ok', 'error']), JSON.stringify(states))
      check('notebooks: a DataFrame renders as a table', (await codeCell(1).locator('table, iframe').count()) > 0)
      check('notebooks: the traceback names the cell', /ZeroDivisionError/.test(await cellOutput(3)), await cellOutput(3))
      await clean('colab run all')
    })
    await scenario('notebooks: input(), interrupt, state survives', async () => {
      await openNotebook('nb io', { 'n.ipynb': nbJson(['name = input("Name? ")\nprint("hi", name)', 'import time\nfor i in range(100):\n    print(i, flush=True)\n    time.sleep(0.2)', 'print("after", name)']) }, 'n.ipynb')
      await runCell(0)
      const box = page.getByLabel('Cell input')
      await box.waitFor({ timeout: 180000 })
      await box.fill('Sara')
      await box.press('Enter')
      await kernelIdle(60000)
      check('notebooks: input() in a cell takes typed input', /hi Sara/.test(await cellOutput(0)), await cellOutput(0))
      await runCell(1)
      await page.waitForTimeout(2500)
      await nbButton('Interrupt').click()
      check('notebooks: Interrupt stops a long cell with KeyboardInterrupt', (await kernelIdle(10000)) && /KeyboardInterrupt/.test(await cellOutput(1)), (await cellOutput(1)).slice(-120))
      await runCell(2)
      await kernelIdle(30000)
      check('notebooks: variables survive an interrupt', /after Sara/.test(await cellOutput(2)), await cellOutput(2))
      await clean('notebook io')
    })
    await scenario('notebooks: a cell and a Python Run at the same time', async () => {
      await openNotebook('nb mixed', { 'n.ipynb': nbJson(['import time\nfor i in range(30):\n    print("nb", i, flush=True)\n    time.sleep(0.2)']), 'main.py': 'print("script ok", 6 * 7)\n' }, 'n.ipynb')
      await runCell(0)
      await page.waitForTimeout(1500)
      await page.locator('[role="treeitem"]').filter({ hasText: /^\s*main\.py\s*$/ }).first().click()
      const r = await runToEnd(page, { timeout: 120000 })
      check('notebooks: the script runs while a cell is running', r.state === 'ok' && /script ok 42/.test(r.text), r.text)
      await page.locator('[role="treeitem"]').filter({ hasText: /^\s*n\.ipynb\s*$/ }).first().click()
      await kernelIdle(30000)
      check('notebooks: and the cell still completes', /nb 29/.test(await cellOutput(0)), (await cellOutput(0)).slice(-60))
      // Switch projects with the cell running: no error, nothing bleeds over.
      await runCell(0)
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Home', exact: true }).first().click()
      await page.getByRole('button', { name: /Open — colab/ }).first().click()
      await page.waitForTimeout(2500)
      check('notebooks: switching projects mid-cell leaves no output behind', !/nb \d/.test(await output(page)), await output(page))
      await clean('notebook mixed')
    })
    await scenario('notebooks: phone viewport', async () => {
      const phone = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-rw-nbphone-')), {
        executablePath: CHROME, headless: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
      })
      try {
        const p = phone.pages()[0] ?? (await phone.newPage())
        await openNotebook('nb phone', { 'n.ipynb': nbJson(['print(sum(range(10)))']) }, 'n.ipynb', p)
        await codeCell(0, p).getByRole('button', { name: 'Run cell' }).tap()
        await kernelIdle(240000, p)
        check('notebooks: phone — tap Run cell, see the output', /45/.test(await cellOutput(0, p)), await cellOutput(0, p))
        check('notebooks: phone — no platform errors', !(await platformErrors(p)).length)
      } finally {
        await phone.close()
      }
    })
  },

  async behaviour() {
    await scenario('behaviour: hammering Run', async () => {
      await openProject(page, BASE, 'rapid', { 'main.py': 'import time\nprint("start")\ntime.sleep(1)\nprint("end")\n' })
      await runToEnd(page)
      await page.waitForTimeout(400)
      // A student hammering the button: whatever it is at each moment (Run, then Stop).
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: /^(Run|Stop) \S+\.\w+$/ }).first().click({ force: true }).catch(() => {})
        await page.waitForTimeout(60)
      }
      await waitState(page, ['ok', 'failed', 'stopped'], 30000)
      await page.waitForTimeout(400)
      await page.locator('.cm-content').click()
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Control+Enter'); await page.waitForTimeout(30) }
      await waitState(page, ['ok', 'failed', 'stopped'], 30000)
      await waitText(page, END_LINE, 8000)
      await clean('hammering Run')
    })
    await scenario('behaviour: infinite loop, Stop, Run again', async () => {
      await openProject(page, BASE, 'loop', { 'main.py': 'i = 0\nwhile True:\n    i += 1\n    if i % 100000 == 0: print(i)\n' })
      await clickRun()
      await waitText(page, '300000', 60000)
      const t0 = Date.now()
      await stopButton(page).click()
      check('behaviour: Stop ends an infinite loop', await waitState(page, 'stopped', 5000), `${Date.now() - t0} ms`)
      await clickRun()
      await waitText(page, '100000', 30000)
      await stopButton(page).click()
      check('behaviour: the loop runs and stops a second time', await waitState(page, 'stopped', 5000))
    })
    await scenario('behaviour: typing before the program asks', async () => {
      await openProject(page, BASE, 'typeahead', { 'main.py': 'import time\ntime.sleep(2)\na = input("A: ")\nb = input("B: ")\nprint("got", a, b)\n' })
      await clickRun()
      await waitState(page, 'running', 60000)
      const box = page.locator(STDIN)
      await box.fill('one'); await box.press('Enter')
      await box.fill('two'); await box.press('Enter')
      check('behaviour: lines typed ahead arrive in order', await waitText(page, 'got one two', 30000), await output(page))
    })
    // The killed worker used to share its stdin buffer with its replacement and
    // steal the next run's first line; every engine with a shared-memory stdin.
    const prompts = [
      { lang: 'python', files: { 'main.py': 'x = input("Name: ")\nprint("hi", x)\n' } },
      { lang: 'c', files: { 'main.c': '#include <stdio.h>\nint main(void) { char x[20]; printf("Name: "); scanf("%19s", x); printf("hi %s\\n", x); return 0; }\n' } },
      { lang: 'csharp', files: { 'Program.cs': 'Console.Write("Name: ");\nConsole.WriteLine("hi " + Console.ReadLine());\n' } },
    ]
    for (const { lang, files } of prompts) {
      await scenario(`behaviour: ${lang} — Stop at the input prompt, then run again`, async () => {
        await openProject(page, BASE, `stopwait ${lang}`, files)
        await clickRun()
        await waitState(page, 'waiting', 180000)
        await stopButton(page).click()
        await waitState(page, 'stopped', 5000)
        const r = await runToEnd(page, { stdin: ['Ali'], timeout: 60000 })
        check(`behaviour: ${lang} — the next run gets the line typed for it`, r.state === 'ok' && /hi Ali/.test(r.text), `state=${r.state} ${r.text}${await failureDetail()}`)
      })
    }
    await scenario('behaviour: reload mid-run', async () => {
      await openProject(page, BASE, 'reload', { 'main.py': 'import time\nfor i in range(100):\n    print(i)\n    time.sleep(0.1)\n' })
      await clickRun()
      await waitText(page, '\n5', 60000)
      await page.reload({ waitUntil: 'load' })
      await page.waitForSelector('.cm-content', { timeout: 30000 })
      await clickRun()
      const ran = await waitText(page, '\n3', 60000)
      await stopButton(page).click()
      check('behaviour: the page reloaded mid-run runs again', ran && (await waitState(page, 'stopped', 5000)))
      await clean('reload mid-run')
    })
  },

  async projects() {
    await scenario('projects: switch project mid-run', async () => {
      await openProject(page, BASE, 'Proj B', { 'main.py': 'print("B ran")\n' })
      await openProject(page, BASE, 'Proj A', { 'main.py': 'import time\nfor i in range(60):\n    print("A-tick", i)\n    time.sleep(0.1)\nopen("fromA.txt", "w").write("x")\n' })
      await clickRun()
      await waitText(page, 'A-tick 3', 60000)
      await page.getByRole('button', { name: 'Home', exact: true }).first().click()
      await page.getByRole('button', { name: /Open — Proj B/ }).first().click()
      await page.waitForTimeout(1500)
      const t1 = await output(page)
      await page.waitForTimeout(1000)
      const t2 = await output(page)
      check('projects: the old program stops printing into the new project', t1 === t2 && !/A-tick/.test(t2), JSON.stringify([t1.slice(-120), t2.slice(-120)]))
      const r = await runToEnd(page)
      check('projects: the new project runs its own code', r.state === 'ok' && /B ran/.test(r.text) && !/A-tick/.test(r.text), r.text)
      check('projects: the old program wrote nothing into the new project', (await page.locator('[role="treeitem"]').filter({ hasText: 'fromA.txt' }).count()) === 0)
      await clean('switch project mid-run')
    })
    await scenario('projects: delete the entry file mid-run', async () => {
      await openProject(page, BASE, 'Del', { 'main.py': 'import time\nfor i in range(40):\n    print("tick", i)\n    time.sleep(0.1)\n', 'other.py': 'print("other ok")\n' })
      await clickRun()
      await waitText(page, 'tick 3', 60000)
      await rowAction('main.py', 'Delete')
      await page.locator('dialog[open]').getByRole('button', { name: 'Delete', exact: true }).click()
      await waitState(page, ['ok', 'failed', 'stopped'], 10000)
      // The program outlives its file, as it would on a real machine; the tab
      // strip's Run then needs an open file, so open the one that is left.
      await page.locator('[role="treeitem"]').filter({ hasText: /^\s*other\.py\s*$/ }).first().click()
      const r = await runToEnd(page)
      check('projects: after deleting the entry, Run starts the file that is left', r.state === 'ok' && /other ok/.test(r.text), r.text)
      await clean('delete entry mid-run')
    })
    await scenario('projects: rename the entry file mid-run', async () => {
      await openProject(page, BASE, 'Ren', { 'main.py': 'import time\nfor i in range(20):\n    print("tick", i)\n    time.sleep(0.1)\nprint("done")\n' })
      await clickRun()
      await waitText(page, 'tick 3', 60000)
      await rowAction('main.py', /^Rename/)
      const box = page.getByLabel('Rename main.py')
      await box.fill('app.py')
      await box.press('Enter')
      await waitState(page, ['ok', 'failed', 'stopped'], 20000)
      const r = await runToEnd(page)
      check('projects: Run works on the renamed entry', r.state === 'ok' && /done/.test(r.text), r.text.slice(-120))
      await clean('rename entry mid-run')
    })
    await scenario('projects: switching languages back to back', async () => {
      const a = await (async () => { await openProject(page, BASE, 'L-py', { 'main.py': 'print("from py")\n' }); return runToEnd(page) })()
      const b = await (async () => { await openProject(page, BASE, 'L-c', { 'main.c': '#include <stdio.h>\nint main(void){puts("from c");return 0;}\n' }); return runToEnd(page) })()
      const cDetail = await failureDetail()
      const c = await (async () => { await openProject(page, BASE, 'L-js', { 'main.js': 'console.log("from js")\n' }); return runToEnd(page) })()
      check('projects: Python, then C, then JS each run', [a, b, c].every((r) => r.state === 'ok') && /from py/.test(a.text) && /from c/.test(b.text) && /from js/.test(c.text), [a, b, c].map((r) => r.state).join(',') + cDetail)
    })
    await scenario('projects: two tabs, Java in both', async () => {
      await openProject(page, BASE, 'TabA', {
        'Main.java': 'import java.util.*;\nimport java.io.*;\npublic class Main {\n  public static void main(String[] a) throws Exception {\n    Scanner in = new Scanner(System.in);\n    System.out.print("go? ");\n    in.nextLine();\n    System.out.println(new Later().hi());\n    System.out.println(new Scanner(new File("data.txt")).nextLine());\n  }\n}\n',
        'Later.java': 'public class Later {\n  String hi() { return "later-A"; }\n}\n', 'data.txt': 'AAA\n' })
      await clickRun()
      await waitState(page, 'waiting', 180000)
      const other = await ctx.newPage()
      await openProject(other, BASE, 'TabB', { 'Main.java': 'import java.util.*;\nimport java.io.*;\npublic class Main {\n  public static void main(String[] a) throws Exception {\n    System.out.println("B " + new Scanner(new File("data.txt")).nextLine());\n  }\n}\n', 'data.txt': 'BBB\n' })
      const rb = await runToEnd(other)
      await other.close()
      await page.bringToFront()
      await typeLine(page, 'yes')
      await waitState(page, ['ok', 'failed'], 60000)
      await waitText(page, END_LINE, 8000)
      const ta = await output(page)
      check('projects: the second tab runs its own data file', /B BBB/.test(rb.text), rb.text.slice(-160))
      check('projects: the first tab still finds its classes and data after the second ran', /later-A/.test(ta) && /AAA/.test(ta), ta.slice(-240))
    })
  },

  async environment() {
    await scenario('environment: a long session (25 runs)', async () => {
      await openProject(page, BASE, 'long', { 'main.py': 'import random\nxs = [random.random() for _ in range(20000)]\nprint("run ok", len(xs))\n' })
      const heap = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0)
      let ok = 0
      let h5 = 0
      for (let i = 1; i <= 25; i++) {
        const r = await runToEnd(page, { timeout: 60000 })
        if (r.state === 'ok' && /run ok 20000/.test(r.text)) ok++
        if (i === 5) h5 = await heap()
      }
      const h25 = await heap()
      check('environment: 25 runs in one tab all finish', ok === 25, `${ok}/25`)
      check('environment: main-thread heap does not grow with every run', !h5 || h25 < h5 * 1.5 + 20e6, `${(h5 / 1e6).toFixed(1)} MB at run 5 -> ${(h25 / 1e6).toFixed(1)} MB at run 25`)
      await clean('long session')
    })
    await scenario('environment: phone viewport with touch', async () => {
      const phone = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-rw-phone-')), {
        executablePath: CHROME, headless: true, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
      })
      try {
        const p = phone.pages()[0] ?? (await phone.newPage())
        await openProject(p, BASE, 'phone', { 'main.py': 'n = input("Name: ")\nprint("hello", n)\n' })
        await p.waitForTimeout(300)
        await runButton(p).tap()
        await waitState(p, 'waiting', 180000)
        await p.locator(STDIN).tap()
        await p.locator(STDIN).fill('phone')
        await p.locator(STDIN).press('Enter')
        await waitState(p, ['ok', 'failed'], 30000)
        check('environment: phone — tap Run, answer input(), finish', await waitText(p, 'hello phone', 8000), await output(p))
        const errs = await platformErrors(p)
        check('environment: phone — no platform errors', !errs.length, JSON.stringify(errs))
      } finally {
        await phone.close()
      }
    })
    await scenario('environment: cold Java on a slow link', async () => {
      // A throttling CONNECT proxy, not CDP: Network.emulateNetworkConditions only
      // reaches the page, and the engines download from their workers. All CDN
      // traffic shares RATE bytes/s; the dev server (loopback) is not proxied.
      const RATE = 1_000_000
      let budget = RATE / 10
      const tick = setInterval(() => { budget = RATE / 10 }, 100)
      const proxy = net.createServer((client) => {
        client.once('data', (head) => {
          const m = /^CONNECT ([^:]+):(\d+)/.exec(head.toString())
          if (!m) return client.destroy()
          const up = net.connect(Number(m[2]), m[1], () => { client.write('HTTP/1.1 200 OK\r\n\r\n'); client.pipe(up) })
          up.on('data', (chunk) => {
            up.pause()
            const send = () => { if (budget > 0) { budget -= chunk.length; client.write(chunk); up.resume() } else setTimeout(send, 20) }
            send()
          })
          up.on('error', () => client.destroy()); client.on('error', () => up.destroy())
          up.on('close', () => client.end()); client.on('close', () => up.destroy())
        })
      })
      await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
      const slow = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-rw-slow-')), {
        executablePath: CHROME, headless: true, viewport: { width: 1280, height: 900 },
        args: [`--proxy-server=http://127.0.0.1:${proxy.address().port}`],
      })
      try {
        const p = slow.pages()[0] ?? (await slow.newPage())
        await openProject(p, BASE, 'slow java', { 'Main.java': 'public class Main { public static void main(String[] a) { System.out.println("slow java ok"); } }\n' })
        await p.evaluate(() => { window.__bytes = 0; setInterval(() => { const t = document.querySelector('[data-phase]')?.innerText ?? ''; if (/\d MB/.test(t)) window.__bytes++ }, 250) })
        const r = await runToEnd(p, { timeout: 300000 })
        check('environment: slow link — a cold Java run finishes instead of timing out as "offline"', r.state === 'ok' && /slow java ok/.test(r.text), r.text + (await failureDetail(p)))
        check('environment: slow link — the progress shows the download in MB', (await p.evaluate(() => window.__bytes)) > 4)
        check('environment: slow link — no platform errors', !(await platformErrors(p)).length)
      } finally {
        await slow.close()
        proxy.close()
        clearInterval(tick)
      }
    })
    await scenario('environment: offline after the first load', async () => {
      await openProject(page, BASE, 'offline', { 'main.py': 'print("offline", 6 * 7)\n' })
      await runToEnd(page)
      await ctx.setOffline(true)
      try {
        await setEditorText(page, 'print("still offline", 6 * 7)\n')
        const r = await runToEnd(page, { timeout: 60000 })
        check('environment: Python runs again with the network off', r.state === 'ok' && /still offline 42/.test(r.text), r.text)
      } finally {
        await ctx.setOffline(false)
      }
    })
  },

  async debugger() {
    const flows = [
      { lang: 'python', file: 'main.py', line: 3, files: { 'main.py': 'total = 0\nfor x in [3, 1, 2]:\n    total += x\nprint("total", total)\n' }, sees: /x: 3/ },
      { lang: 'java', file: 'Main.java', line: 5, files: { 'Main.java': 'public class Main {\n  public static void main(String[] args) {\n    int total = 0;\n    for (int x : new int[]{3, 1, 2}) {\n      total += x;\n    }\n    System.out.println("total " + total);\n  }\n}\n' }, sees: /x: 3/ },
      { lang: 'csharp', file: 'Program.cs', line: 4, files: { 'Program.cs': 'int total = 0;\nforeach (var x in new[] { 3, 1, 2 })\n{\n    total += x;\n}\nConsole.WriteLine("total " + total);\n' }, sees: /x: 3/ },
      { lang: 'c', file: 'main.c', line: 5, files: { 'main.c': '#include <stdio.h>\nint main(void) {\n  int xs[] = {3, 1, 2}, total = 0;\n  for (int i = 0; i < 3; i++)\n    total += xs[i];\n  printf("total %d\\n", total);\n  return 0;\n}\n' }, sees: /i: 0/ },
      { lang: 'js', file: 'main.js', line: 3, files: { 'main.js': 'let total = 0\nfor (const x of [3, 1, 2]) {\n  total += x\n}\nconsole.log("total", total)\n' }, sees: /x: 3/ },
    ]
    for (const f of flows) {
      await scenario(`debugger: ${f.lang} breakpoint`, async () => {
        await openProject(page, BASE, `dbg ${f.lang}`, f.files)
        await page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: new RegExp(`^${f.line}$`) }).click()
        await page.waitForTimeout(300)
        await page.keyboard.press('F5')
        const stopped = await page.waitForFunction(() => document.querySelectorAll('.cm-debug-stop-line').length === 1, null, { timeout: 240000 }).then(() => true).catch(() => false)
        const vars = await page.locator('section[data-section="variables"]').innerText().catch(() => '')
        check(`debugger: ${f.lang} stops on the breakpoint with locals`, stopped && f.sees.test(vars), vars.replace(/\s+/g, ' ').slice(0, 160))
        // Clear it and continue to the end.
        await page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: new RegExp(`^${f.line}$`) }).click()
        await page.keyboard.press('F5')
        await waitState(page, ['ok', 'failed', 'stopped'], 60000)
        check(`debugger: ${f.lang} continues to the end`, await waitText(page, 'total 6', 10000), (await output(page)).slice(-160))
        await clean(`debugger ${f.lang}`)
      })
    }
  },

  async editor() {
    // Typing course code key by key through IntelliSense must never throw (C#/C completions are new).
    const typed = [
      { file: 'Program.cs', files: { 'Program.cs': '' }, text: 'using System;\nclass Program {\nstatic void Main() {\nConsole.Write("Name: ");\nstring name = Console.ReadLine();\nint n = int.Parse(Console.ReadLine());\nConsole.WriteLine($"Hi {name} {n * 2}");\n' },
      { file: 'main.c', files: { 'main.c': '' }, text: '#include <stdio.h>\nstruct point { int x; int y; };\nint main(void) {\nstruct point p;\nscanf("%d %d", &p.x, &p.y);\nprintf("%d\\n", p.x + p.y);\nreturn 0;\n' },
    ]
    for (const t of typed) {
      await scenario(`editor: typing ${t.file}`, async () => {
        await openProject(page, BASE, `type ${t.file}`, t.files)
        await page.locator('.cm-content').click()
        for (const ch of t.text) {
          if (ch === '\n') await page.keyboard.press('Enter')
          else await page.keyboard.type(ch)
          if (Math.random() < 0.05) await page.keyboard.press('Escape') // dismiss a completion now and then, as students do
        }
        await page.waitForTimeout(800)
        const errs = await platformErrors()
        const doc = await page.locator('.cm-content').innerText()
        check(`editor: typing ${t.file} key by key throws nothing`, !errs.length && /return 0|n \* 2/.test(doc), JSON.stringify(errs).slice(0, 200))
      })
    }
  },
}

for (const name of wanted) {
  if (!sections[name]) { console.log(`unknown section ${name}; known: ${ALL.join(' ')}`); continue }
  console.log(`\n=== ${name} ===`)
  await sections[name]()
}

await ctx.close()
const passed = results.filter((r) => r.ok).length
console.log(`\nreal-world-check: ${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
