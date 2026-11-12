/**
 * Member completion after a dot — the patterns university Java 1/2 and Python
 * 1/2 course material actually uses (arrays, parameters, catch variables, the
 * student's own classes, inheritance, chains, numpy/pandas/csv…).
 *
 * `member()` insists the option came from the member source itself, not from
 * the plain-words fallback — a word already written in the test document would
 * otherwise pass for a resolved member. Fallback words carry no `detail`; every
 * member row does.
 * Run with: `npm run test:editor`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { java } from '@codemirror/lang-java'
import { javaMain, offered, withProjectFiles } from './helpers.ts'
import { memberAt } from '../../src/editor/members.ts'
import { memberCard } from '../../src/editor/completions.ts'
import { unresolvedImportables } from '../../src/editor/imports.ts'

type Lang = 'java' | 'python'
const member = (lang: Lang, doc: string, ...want: string[]) => {
  const { labels, byLabel } = offered(lang, doc)
  for (const w of want) {
    assert.ok(labels.includes(w), `expected "${w}" in [${labels.slice(0, 25).join(', ')}]`)
    assert.ok(byLabel.get(w)?.detail !== undefined, `"${w}" came from the word fallback, not a resolved member`)
  }
}
const has = (lang: Lang, doc: string, ...want: string[]) => {
  const { labels } = offered(lang, doc)
  for (const w of want) assert.ok(labels.includes(w), `expected "${w}" in [${labels.slice(0, 25).join(', ')}]`)
}
const lacks = (lang: Lang, doc: string, ...unwanted: string[]) => {
  const { labels } = offered(lang, doc)
  for (const w of unwanted) assert.ok(!labels.includes(w), `did not expect "${w}" in [${labels.slice(0, 25).join(', ')}]`)
}

/* ------------------------------------------------------------------ Java */

test('java: array length — local, new, args, 2-D row, varargs', () => {
  member('java', javaMain('    int[] arr = {1, 2, 3};\n    for (int i = 0; i < arr.le‸'), 'length')
  member('java', javaMain('    int[] nums = new int[5];\n    nums.le‸'), 'length')
  member('java', javaMain('    args.le‸'), 'length')
  member('java', javaMain('    int[][] m = new int[3][3];\n    m[0].le‸'), 'length')
  member('java', javaMain('  }\n  static int sum(int... nums) {\n    return nums.le‸'), 'length')
  lacks('java', javaMain('    int[] arr = {1};\n    arr.‸'), 'charAt', 'sout', 'class')
})

test('java: parameters and declare-then-assign', () => {
  member('java', javaMain('  }\n  static int count(String s) {\n    return s.ch‸'), 'charAt')
  member('java', javaMain('  }\n  static void show(ArrayList<String> list) {\n    list.si‸'), 'size')
  member('java', javaMain('    String name;\n    name = "x";\n    name.le‸'), 'length')
})

test('java: a name is typed by the declaration in scope, not one in another method', () => {
  const doc =
    'import java.util.*;\npublic class Main {\n  static Scanner input = new Scanner(System.in);\n' +
    '  static void a() {\n    String input = "x";\n  }\n  public static void main(String[] args) {\n    input.next‸\n  }\n}\n'
  member('java', doc, 'nextInt')
  const lambda =
    'import java.util.*;\npublic class Main {\n  static void a() { int[] x = {1}; }\n' +
    '  static void b(ArrayList<String> l) {\n    l.forEach(x -> x.‸);\n  }\n}\n'
  lacks('java', lambda, 'clone')
})

test('java: catch variable offers Throwable members', () => {
  member('java', javaMain('    try {\n      int x = 1 / 0;\n    } catch (ArithmeticException e) {\n      e.getM‸'), 'getMessage')
  member('java', javaMain('    try {\n    } catch (InputMismatchException | NumberFormatException ex) {\n      ex.pr‸'), 'printStackTrace')
})

test('java: chains follow return types and generics', () => {
  member('java', javaMain('    Scanner sc = new Scanner(System.in);\n    char c = sc.next().ch‸'), 'charAt')
  member('java', javaMain('    ArrayList<String> names = new ArrayList<>();\n    names.get(0).toU‸'), 'toUpperCase')
  member('java', javaMain('    HashMap<String, Integer> m = new HashMap<>();\n    m.get("a").int‸'), 'intValue')
  member('java', javaMain('    "hello".le‸'), 'length')
  member('java', javaMain('    new Scanner(System.in).nextL‸'), 'nextLine')
  member('java', javaMain('    ArrayList<String> l = new ArrayList<>();\n    Iterator<String> it = l.iterator();\n    it.hasN‸'), 'hasNext')
  member('java', javaMain('    var sc = new Scanner(System.in);\n    sc.nextI‸'), 'nextInt')
  member('java', javaMain('    HashMap<String, Integer> m = new HashMap<>();\n    for (Map.Entry<String, Integer> e : m.entrySet()) {\n      e.getK‸'), 'getKey')
  // After a call there is no `sout`/`class` — a dot context belongs to members.
  lacks('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.next().‸'), 'sout', 'class', 'psvm')
})

test('java: a bracket inside a string never breaks the chain', () => {
  member('java', javaMain('    String s = "a(b";\n    s.replace("(", "").toU‸'), 'toUpperCase')
  member('java', javaMain('    String s = "a(b";\n    s.split("\\\\(")[0].tri‸'), 'trim')
  lacks('java', javaMain('    String s = "x";\n    s.replace(")", "").‸'), 'sout', 'psvm', 'class')
})

test('java: the student’s own classes, inheritance, this/super, enums, statics', () => {
  const animals =
    'class Animal {\n  protected String name;\n  void makeSound() {}\n  public String toString() { return name; }\n}\n' +
    'class Dog extends Animal {\n  void bark() {}\n  void makeSound() {\n    super.‸\n  }\n}\n'
  member('java', javaMain('', animals), 'makeSound', 'toString', 'name')
  lacks('java', javaMain('', animals), 'bark')
  const shapes =
    'interface Shape { double area(); }\nclass Circle implements Shape {\n  private double radius;\n  private int other;\n' +
    '  Circle(double radius) { this.rad‸ }\n  public double area() { return 1; }\n}\n'
  member('java', javaMain('', shapes), 'radius')
  const account =
    'class Account {\n  double balance;\n  void deposit(double d) {}\n  double getBalance() { return balance; }\n' +
    '  public String toString() { return ""; }\n  void add(int x) {}\n  int size() { return 0; }\n}\n'
  // Members that share a dictionary name (toString, add, size) are not dropped.
  member('java', javaMain('    Account a = new Account();\n    a.‸', account), 'deposit', 'getBalance', 'toString', 'add', 'size', 'balance', 'equals', 'hashCode')
  lacks('java', javaMain('    Account a = new Account();\n    String unrelated = "";\n    a.‸', account), 'nextInt', 'sout', 'unrelated')
  const zoo = 'class Animal { void makeSound() {} }\nclass Dog extends Animal { void bark() {} }\n'
  member('java', javaMain('    Animal a = new Dog();\n    a.make‸', zoo), 'makeSound')
  member('java', javaMain('    Dog d = new Dog();\n    d.‸', zoo), 'makeSound', 'bark')
  member('java', javaMain('    Day.‸', 'enum Day { MONDAY, TUESDAY; }\n'), 'MONDAY', 'TUESDAY', 'values', 'valueOf')
  member('java', javaMain('    Day d = Day.MONDAY;\n    d.‸', 'enum Day { MONDAY, TUESDAY }\n'), 'ordinal', 'name')
  member('java', javaMain('    Day d = Day.MONDAY;\n    d.name().toL‸', 'enum Day { MONDAY, TUESDAY }\n'), 'toLowerCase')
  member('java', javaMain('    Calculator.‸', 'class Calculator {\n  static int add(int a, int b) { return a + b; }\n  int memory;\n}\n'), 'add')
  member('java', javaMain('    Object o = new Object();\n    o.toS‸'), 'toString')
  member('java', javaMain('    Object o = "x";\n    ((String) o).len‸'), 'length')
})

test('java: a nested class is not a field of its outer class', () => {
  const list =
    'class MyList {\n  private static class Node { int value; Node next; }\n  private Node head;\n  void f() {\n    this.‸\n  }\n}\n'
  member('java', javaMain('', list), 'head', 'f')
  lacks('java', javaMain('', list), 'Node')
})

test('java: a class defined in another project file', () => {
  withProjectFiles([{ path: 'Rectangle.java', content: 'public class Rectangle {\n  private int w, h;\n  public int getArea() { return w * h; }\n}\n' }], () => {
    member('java', javaMain('    Rectangle r = new Rectangle();\n    r.getAr‸'), 'getArea')
  })
})

test('java: static access offers statics, a value offers its own members', () => {
  member('java', javaMain('    String s = String.‸'), 'format', 'valueOf', 'join')
  lacks('java', javaMain('    String s = String.‸'), 'charAt', 'length')
  lacks('java', javaMain('    String s = "x";\n    s.‸'), 'format', 'valueOf')
  member('java', javaMain('    Integer n = 5;\n    n.‸'), 'intValue', 'compareTo')
  lacks('java', javaMain('    Integer n = 5;\n    n.‸'), 'parseInt')
})

test('java: library names the courses use', () => {
  member('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.next‸'), 'nextBoolean', 'nextFloat', 'nextLong', 'nextShort', 'nextByte')
  member('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.useD‸'), 'useDelimiter')
  member('java', javaMain('    Vector<Integer> v = new Vector<>();\n    v.‸'), 'add', 'get', 'set', 'remove', 'elementAt')
  member('java', javaMain('    Collections.‸'), 'disjoint', 'rotate', 'replaceAll', 'swap', 'frequency')
  member('java', javaMain('    Locale.‸'), 'US', 'setDefault')
  member('java', javaMain('    System.out.pri‸'), 'println', 'print', 'printf')
  has('java', javaMain('    ArrayList<Integ‸'), 'Integer')
  has('java', javaMain('    Obje‸'), 'Object')
  has('java', javaMain('    try {} catch (InputMis‸'), 'InputMismatchException')
  has('java', javaMain('    try {} catch (ClassCa‸'), 'ClassCastException')
})

test('java: every auto-importable class resolves to a fully-qualified name', () => {
  assert.deepEqual(unresolvedImportables(), [])
})

test('java: a decimal point is not a member access', () => {
  lacks('java', javaMain('    double d = 3.‸'), 'length', 'toString')
})

/* ---------------------------------------------------------------- Python */

test('python: the student’s own classes, self, inheritance, super(), properties', () => {
  const car = 'class Car:\n    def __init__(self, speed):\n        self.speed = speed\n    def drive(self):\n        pass\n    def count(self):\n        pass\n'
  member('python', car + '    def go(self):\n        self.‸', 'speed', 'drive', 'count')
  member('python', car + '\nc = Car(3)\nc.‸', 'speed', 'drive', 'count')
  lacks('python', car + '\nc = Car(3)\nc.‸', 'append', 'upper')
  member('python', 'class A:\n    def hello(self):\n        pass\nclass B(A):\n    pass\n\nb = B()\nb.‸', 'hello')
  member('python', 'class A:\n    def __init__(self):\n        pass\n    def ping(self):\n        pass\nclass B(A):\n    def __init__(self):\n        super().‸', '__init__', 'ping')
  member('python', 'class Bat:\n    @property\n    def voltage(self):\n        return self._v\n    @voltage.set‸', 'setter')
  member('python', 'class Broke(Exception):\n    pass\n\ntry:\n    pass\nexcept Broke as e:\n    e.‸', 'args')
})

test('python: rebinding a name to an expression of itself', () => {
  member('python', 'with open("data.txt") as f:\n    for line in f:\n        line = line.strip()\n        line.up‸', 'upper')
  member('python', 'name = input()\nname = name.lower()\nname.up‸', 'upper')
  // No binding before it at all: unknown, but never a throw.
  assert.doesNotThrow(() => offered('python', 'x = x.upper()\nx.‸'))
  assert.doesNotThrow(() => offered('java', javaMain('    var a = b.trim();\n    var b = a.trim();\n    a.‸')))
})

test('python: a name is typed by its own function’s binding', () => {
  const doc = 'def load():\n    data = open("x.txt").read()\n    return data\n\ndef total(data):\n    return data.‸'
  lacks('python', doc, 'upper', 'splitlines')
})

test('python: with/for/chains/annotations', () => {
  member('python', 'with open("data.txt") as f:\n    f.read‸', 'read', 'readline', 'readlines')
  member('python', 'line = "a b"\nparts = line.split()\nparts.app‸', 'append')
  member('python', 'words = ["a", "b"]\nfor w in words:\n    w.upp‸', 'upper')
  member('python', 'names = ["a"]\nnames[0].upp‸', 'upper')
  member('python', 'def f(s: str):\n    return s.upp‸', 'upper')
  member('python', 's = "hi"\ns.upper().low‸', 'lower')
  member('python', 's = "a(b"\ns.replace("(", "").up‸', 'upper')
  member('python', 'try:\n    pass\nexcept ValueError as e:\n    e.arg‸', 'args')
  lacks('python', 's = "hi"\ns.upper().‸', 'def', 'class', 'main')
})

test('python: numpy, pandas, csv, io, os', () => {
  member('python', 'import numpy as np\narr = np.ar‸', 'array', 'arange')
  member('python', 'import numpy as np\na = np.array([1, 2])\na.resh‸', 'reshape')
  member('python', 'import numpy as np\na = np.arange(6).reshape(2, 3)\na.‸', 'shape', 'sum', 'T')
  member('python', 'import pandas as pd\ndf = pd.DataF‸', 'DataFrame')
  member('python', 'import pandas as pd\ndf = pd.read_csv("a.csv")\ndf.dropna().‸', 'head', 'fillna', 'to_csv')
  member('python', 'import csv\nf = open("a.csv", "w")\nw = csv.writer(f)\nw.writer‸', 'writerow', 'writerows')
  member('python', 'import csv\nr = csv.DictReader(open("a.csv"))\nr.‸', 'fieldnames')
  member('python', 'from io import StringIO\ns = StringIO()\ns.getv‸', 'getvalue')
  member('python', 'import os\nos.fsy‸', 'fsync')
  has('python', 'from math import sq‸', 'sqrt')
  has('python', 'from collections import Coun‸', 'Counter')
})

test('python: builtins, keywords and exceptions the courses name', () => {
  has('python', 'try:\n    pass\nexcept Value‸', 'ValueError')
  has('python', 'try:\n    pass\nexcept ZeroDiv‸', 'ZeroDivisionError')
  has('python', 'raise TypeE‸', 'TypeError')
  has('python', 'x = eva‸', 'eval')
  has('python', 'match x:\n    cas‸', 'case')
  has('python', 'x = 0\ndef f():\n    glo‸', 'global')
})

test('java: private members only from inside their own class', () => {
  const student = 'class Student {\n  private String name;\n  private double gpa;\n  public String getName() { return name; }\n  void f(Student o) { o.‸ }\n}\n'
  member('java', javaMain('', student), 'name', 'gpa', 'getName')
  const outside = 'class Student {\n  private String name;\n  public String getName() { return name; }\n}\n'
  member('java', javaMain('    Student s = new Student();\n    s.‸', outside), 'getName')
  lacks('java', javaMain('    Student s = new Student();\n    s.‸', outside), 'name')
  const py = 'class Account:\n    def __init__(self):\n        self.__balance = 0\n        self.owner = "x"\n\na = Account()\na.‸'
  member('python', py, 'owner')
  lacks('python', py, '__balance')
})

test("java: a type's own members rank above Object's", () => {
  const { labels } = offered('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.‸'))
  assert.ok(labels.indexOf('nextInt') < labels.indexOf('equals'), labels.slice(0, 12).join(', '))
})

test('python: a module in the project, and a pandas column', () => {
  withProjectFiles([{ path: 'helper.py', content: 'class Student:\n    def average(self):\n        return 0\n\ndef greet(name):\n    pass\n' }], () => {
    member('python', 'import helper\nhelper.‸', 'Student', 'greet')
    member('python', 'import helper\ns = helper.Student()\ns.‸', 'average')
  })
  member('python', 'import pandas as pd\ndf = pd.read_csv("a.csv")\ndf["score"].‸', 'mean', 'value_counts')
})

test('hover: a member card follows the receiver’s real type', () => {
  const doc = javaMain('    int[] nums = {1};\n    int n = nums.length;')
  const state = EditorState.create({ doc, extensions: [java()] })
  const from = doc.indexOf('length')
  const hit = memberAt('java', state, from, from + 'length'.length, {})
  assert.ok(hit, 'resolved')
  const card = memberCard('java', hit.owner, hit.member)
  assert.match(card.doc, /slots/)
  assert.doesNotMatch(card.doc, /characters/)
})

test('typing on past a dot ends a dictionary result (no Character.getNumericValue on e.getM)', async () => {
  const { completionSources } = await import('../../src/editor/completions.ts')
  const { CompletionContext } = await import('@codemirror/autocomplete')
  const { ensureSyntaxTree } = await import('@codemirror/language')
  const doc = javaMain('    try {} catch (Exception e) {\n      System.out.println(ex')
  const at = doc.indexOf('(ex') + 3
  const state = EditorState.create({ doc, selection: { anchor: at }, extensions: [java()] })
  ensureSyntaxTree(state, doc.length, 5000)
  const results = completionSources('java', () => [])
    .map((s) => s(new CompletionContext(state, at, false)))
    .filter((r): r is Exclude<typeof r, null | Promise<unknown>> => !!r && !(r instanceof Promise))
  for (const r of results) {
    const valid = r.validFor
    const stillValid = typeof valid === 'function' ? valid('ex.getM', 0, 0, state) : valid instanceof RegExp ? valid.test('ex.getM') : false
    assert.equal(stillValid, false, `a source kept its result past the dot: ${r.options.slice(0, 3).map((o) => o.label)}`)
  }
  // While the text could still be a dotted label, the result stays (no flicker on `System.ou`).
  const sys = javaMain('    Sys')
  const sysAt = sys.indexOf('Sys') + 3
  const s2 = EditorState.create({ doc: sys, selection: { anchor: sysAt }, extensions: [java()] })
  ensureSyntaxTree(s2, sys.length, 5000)
  const kept = completionSources('java', () => [])
    .map((s) => s(new CompletionContext(s2, sysAt, false)))
    .some((r) => r && !(r instanceof Promise) && typeof r.validFor === 'function' && r.validFor('System.ou', 0, 0, s2))
  assert.ok(kept)
})
