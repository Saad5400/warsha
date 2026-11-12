/**
 * Member completion after a dot — the patterns university Java 1/2 and Python
 * 1/2 course material actually uses (arrays, parameters, catch variables, the
 * student's own classes, inheritance, chains, numpy/pandas/csv…).
 * Run with: `npm run test:editor`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { javaMain, offered, useProjectFiles } from './helpers.ts'

const has = (lang: 'java' | 'python', doc: string, ...want: string[]) => {
  const { labels } = offered(lang, doc)
  for (const w of want) assert.ok(labels.includes(w), `expected "${w}" in [${labels.slice(0, 25).join(', ')}]`)
}
const lacks = (lang: 'java' | 'python', doc: string, ...unwanted: string[]) => {
  const { labels } = offered(lang, doc)
  for (const w of unwanted) assert.ok(!labels.includes(w), `did not expect "${w}" in [${labels.slice(0, 25).join(', ')}]`)
}

/* ------------------------------------------------------------------ Java */

test('java: array length — local, new, args, 2-D row', () => {
  has('java', javaMain('    int[] arr = {1, 2, 3};\n    for (int i = 0; i < arr.le‸'), 'length')
  has('java', javaMain('    int[] nums = new int[5];\n    nums.le‸'), 'length')
  has('java', javaMain('    args.le‸'), 'length')
  has('java', javaMain('    int[][] m = new int[3][3];\n    m[0].le‸'), 'length')
  lacks('java', javaMain('    int[] arr = {1};\n    arr.‸'), 'charAt', 'sout', 'class')
})

test('java: parameters and declare-then-assign', () => {
  has('java', javaMain('  }\n  static int count(String s) {\n    return s.ch‸'), 'charAt')
  has('java', javaMain('  }\n  static void show(ArrayList<String> list) {\n    list.si‸'), 'size')
  has('java', javaMain('    String name;\n    name = "x";\n    name.le‸'), 'length')
})

test('java: catch variable offers Throwable members', () => {
  has('java', javaMain('    try {\n      int x = 1 / 0;\n    } catch (ArithmeticException e) {\n      e.getM‸'), 'getMessage')
  has('java', javaMain('    try {\n    } catch (InputMismatchException | NumberFormatException ex) {\n      ex.pr‸'), 'printStackTrace')
})

test('java: chains follow return types and generics', () => {
  has('java', javaMain('    Scanner sc = new Scanner(System.in);\n    char c = sc.next().ch‸'), 'charAt')
  has('java', javaMain('    ArrayList<String> names = new ArrayList<>();\n    names.get(0).toU‸'), 'toUpperCase')
  has('java', javaMain('    HashMap<String, Integer> m = new HashMap<>();\n    m.get("a").int‸'), 'intValue')
  has('java', javaMain('    "hello".le‸'), 'length')
  has('java', javaMain('    new Scanner(System.in).nextL‸'), 'nextLine')
  has('java', javaMain('    ArrayList<String> l = new ArrayList<>();\n    Iterator<String> it = l.iterator();\n    it.hasN‸'), 'hasNext')
  has('java', javaMain('    var sc = new Scanner(System.in);\n    sc.nextI‸'), 'nextInt')
  // After a call there is no `sout`/`class` — a dot context belongs to members.
  lacks('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.next().‸'), 'sout', 'class', 'psvm')
})

test('java: the student’s own classes, inheritance, this/super, enums, statics', () => {
  const classes =
    'class Animal {\n  protected String name;\n  void makeSound() {}\n  public String toString() { return name; }\n}\n' +
    'class Dog extends Animal {\n  void bark() {}\n  void makeSound() {\n    super.make‸\n  }\n}\n'
  has('java', javaMain('', classes), 'makeSound')
  const shapes = 'interface Shape { double area(); }\nclass Circle implements Shape {\n  private double radius;\n  Circle(double radius) { this.rad‸ }\n  public double area() { return 1; }\n}\n'
  has('java', javaMain('', shapes), 'radius')
  const account =
    'class Account {\n  double balance;\n  void deposit(double d) {}\n  double getBalance() { return balance; }\n  public String toString() { return ""; }\n  void add(int x) {}\n  int size() { return 0; }\n}\n'
  // Members that share a dictionary name (toString, add, size) are not dropped.
  has('java', javaMain('    Account a = new Account();\n    a.‸', account), 'deposit', 'getBalance', 'toString', 'add', 'size', 'balance', 'equals', 'hashCode')
  lacks('java', javaMain('    Account a = new Account();\n    a.‸', account), 'nextInt', 'sout')
  has('java', javaMain('    Animal a = new Dog();\n    a.make‸', 'class Animal { void makeSound() {} }\nclass Dog extends Animal { void bark() {} }\n'), 'makeSound')
  has('java', javaMain('    Dog d = new Dog();\n    d.‸', 'class Animal { void makeSound() {} }\nclass Dog extends Animal { void bark() {} }\n'), 'makeSound', 'bark')
  has('java', javaMain('    Day.‸', 'enum Day { MONDAY, TUESDAY; }\n'), 'MONDAY', 'TUESDAY', 'values', 'valueOf')
  has('java', javaMain('    Day d = Day.MONDAY;\n    d.ord‸', 'enum Day { MONDAY, TUESDAY }\n'), 'ordinal')
  has('java', javaMain('    Calculator.ad‸', 'class Calculator { static int add(int a, int b) { return a + b; } }\n'), 'add')
  has('java', javaMain('    Object o = new Object();\n    o.toS‸'), 'toString')
  has('java', javaMain('    Object o = "x";\n    ((String) o).len‸'), 'length')
})

test('java: a class defined in another project file', () => {
  useProjectFiles([{ path: 'Rectangle.java', content: 'public class Rectangle {\n  private int w, h;\n  public int getArea() { return w * h; }\n}\n' }])
  has('java', javaMain('    Rectangle r = new Rectangle();\n    r.getAr‸'), 'getArea')
  useProjectFiles([])
})

test('java: library names the courses use', () => {
  has('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.next‸'), 'nextBoolean', 'nextFloat', 'nextLong', 'nextShort', 'nextByte')
  has('java', javaMain('    Scanner sc = new Scanner(System.in);\n    sc.useD‸'), 'useDelimiter')
  has('java', javaMain('    String s = String.‸'), 'format', 'valueOf', 'join')
  has('java', javaMain('    Vector<Integer> v = new Vector<>();\n    v.‸'), 'add', 'get', 'set', 'remove', 'elementAt')
  has('java', javaMain('    Collections.‸'), 'disjoint', 'rotate', 'replaceAll', 'swap', 'frequency')
  has('java', javaMain('    Locale.‸'), 'US', 'setDefault')
  has('java', javaMain('    Integer n = 5;\n    n.int‸'), 'intValue')
  has('java', javaMain('    ArrayList<Integ‸'), 'Integer')
  has('java', javaMain('    Obje‸'), 'Object')
  has('java', javaMain('    try {} catch (InputMis‸'), 'InputMismatchException')
  has('java', javaMain('    try {} catch (ClassCa‸'), 'ClassCastException')
  has('java', javaMain('    System.out.pri‸'), 'println', 'print', 'printf')
})

test('java: a decimal point is not a member access', () => {
  lacks('java', javaMain('    double d = 3.‸'), 'length', 'toString')
})

/* ---------------------------------------------------------------- Python */

test('python: the student’s own classes, self, inheritance, super(), properties', () => {
  const car = 'class Car:\n    def __init__(self, speed):\n        self.speed = speed\n    def drive(self):\n        pass\n    def count(self):\n        pass\n'
  has('python', car + '    def go(self):\n        self.‸', 'speed', 'drive', 'count')
  has('python', car + '\nc = Car(3)\nc.‸', 'speed', 'drive', 'count')
  lacks('python', car + '\nc = Car(3)\nc.‸', 'append', 'upper')
  has('python', 'class A:\n    def hello(self):\n        pass\nclass B(A):\n    pass\n\nb = B()\nb.hel‸', 'hello')
  has('python', 'class A:\n    def __init__(self):\n        pass\nclass B(A):\n    def __init__(self):\n        super().__in‸', '__init__')
  has('python', 'class Bat:\n    @property\n    def voltage(self):\n        return self._v\n    @voltage.set‸', 'setter')
})

test('python: with/for/chains/annotations', () => {
  has('python', 'with open("data.txt") as f:\n    f.read‸', 'read', 'readline', 'readlines')
  has('python', 'line = "a b"\nparts = line.split()\nparts.app‸', 'append')
  has('python', 'words = ["a", "b"]\nfor w in words:\n    w.upp‸', 'upper')
  has('python', 'names = ["a"]\nnames[0].upp‸', 'upper')
  has('python', 'def f(s: str):\n    return s.upp‸', 'upper')
  has('python', 's = "hi"\ns.upper().low‸', 'lower')
  has('python', 'try:\n    pass\nexcept ValueError as e:\n    e.arg‸', 'args')
  lacks('python', 's = "hi"\ns.upper().‸', 'def', 'class', 'main')
})

test('python: numpy, pandas, csv, io, os', () => {
  has('python', 'import numpy as np\narr = np.ar‸', 'array', 'arange')
  has('python', 'import numpy as np\na = np.array([1, 2])\na.resh‸', 'reshape')
  has('python', 'import numpy as np\na = np.arange(6).reshape(2, 3)\na.‸', 'shape', 'sum', 'T')
  has('python', 'import pandas as pd\ndf = pd.DataF‸', 'DataFrame')
  has('python', 'import pandas as pd\ndf = pd.read_csv("a.csv")\ndf.dropna().‸', 'head', 'fillna', 'to_csv')
  has('python', 'import csv\nf = open("a.csv", "w")\nw = csv.writer(f)\nw.writer‸', 'writerow', 'writerows')
  has('python', 'import csv\nr = csv.DictReader(open("a.csv"))\nr.‸', 'fieldnames')
  has('python', 'from io import StringIO\ns = StringIO()\ns.getv‸', 'getvalue')
  has('python', 'import os\nos.fsy‸', 'fsync')
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
