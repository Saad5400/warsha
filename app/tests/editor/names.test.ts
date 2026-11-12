/**
 * Variable-name suggestions (names.ts), JetBrains-style.
 * Run with: `npm run test:editor`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { javaMain, offered } from './helpers.ts'
import { plural, singular, words } from '../../src/editor/names.ts'

const first = (lang: 'java' | 'python', doc: string, n = 4) => offered(lang, doc).labels.slice(0, n)

test('helpers: words / plural / singular', () => {
  assert.deepEqual(words('BufferedReader'), ['Buffered', 'Reader'])
  assert.deepEqual(words('IOException'), ['IO', 'Exception'])
  assert.equal(plural('Student'), 'Students')
  assert.equal(plural('city'), 'cities')
  assert.equal(plural('box'), 'boxes')
  assert.equal(singular('students'), 'student')
  assert.equal(singular('cities'), 'city')
  assert.equal(singular('boxes'), 'box')
  assert.equal(singular('class'), null)
})

test('java: names from the declared type', () => {
  assert.deepEqual(first('java', javaMain('    Scanner ‸'), 3), ['scanner', 'sc', 'input'])
  assert.deepEqual(first('java', javaMain('    BufferedReader ‸'), 2), ['bufferedReader', 'reader'])
  assert.deepEqual(first('java', javaMain('    ArrayList<Student> ‸'), 2), ['students', 'studentList'])
  assert.deepEqual(first('java', javaMain('    ArrayList<City> ‸'), 1), ['cities'])
  assert.deepEqual(first('java', javaMain('    Student[] ‸'), 2), ['students', 'studentArray'])
  assert.deepEqual(first('java', javaMain('    Map<String, Integer> ‸'), 2), ['stringIntegerMap', 'map'])
  assert.deepEqual(first('java', javaMain('    int ‸'), 2), ['i', 'n'])
  assert.deepEqual(first('java', javaMain('    Class ‸'), 1), ['aClass'])
})

test('java: catch, for-each, parameters, fields, and taken names', () => {
  assert.deepEqual(first('java', javaMain('    try {} catch (IOException ‸'), 2), ['e', 'ex'])
  assert.equal(first('java', javaMain('    for (String ‸ : names) {}'), 1)[0], 'name')
  assert.equal(first('java', javaMain('  }\n  static void f(Scanner ‸'), 1)[0], 'scanner')
  assert.equal(first('java', javaMain('  }\n  private Random ‸'), 1)[0], 'random')
  assert.equal(first('java', javaMain('    Scanner scanner = null;\n    Scanner ‸'), 1)[0], 'scanner2')
  // Typing filters the names like any completion.
  assert.deepEqual(first('java', javaMain('    Scanner sc‸'), 2), ['scanner', 'sc'])
})

test('java: no names (and no snippets) where a name does not go', () => {
  const ret = offered('java', javaMain('    return ‸')).labels
  assert.ok(!ret.includes('scanner2') && !ret.includes('i'))
  const named = offered('java', javaMain('    Scanner ‸')).labels
  assert.ok(!named.includes('sout') && !named.includes('class'), named.slice(0, 10).join(', '))
})

test('python: for / with / except', () => {
  assert.equal(first('python', 'students = []\nfor ‸ in students:\n    pass', 1)[0], 'student')
  assert.equal(first('python', 'for ‸ in range(10):\n    pass', 1)[0], 'i')
  assert.deepEqual(first('python', 'with open("a.txt") as ‸', 2), ['f', 'file'])
  assert.deepEqual(first('python', 'try:\n    pass\nexcept ValueError as ‸', 2), ['e', 'error'])
})

test('java: comparisons are not generics, conditions are not declarations', () => {
  const range = offered('java', javaMain('    int n = 3;\n    if (n < 1 || n > Ma‸')).labels
  assert.ok(range.includes('Math.max'), range.slice(0, 10).join(', '))
  const loop = offered('java', javaMain('    int[] arr = {1};\n    int n = 1;\n    for (int i = 0; i < n && arr[i] > ‸')).labels
  assert.ok(!loop.includes('i2'), loop.slice(0, 10).join(', '))
  const cond = offered('java', javaMain('    if (Integer ‸')).labels
  assert.ok(!cond.includes('integer'), cond.slice(0, 10).join(', '))
})

test('java: a member header in a class body keeps the dictionary (it may be a method name)', () => {
  const doc = 'class Student {\n  private String name;\n  public String toS‸\n}\n'
  assert.ok(offered('java', doc).labels.includes('toString'))
  // A field still gets names.
  assert.equal(offered('java', 'class Box {\n  private Scanner ‸\n}\n').labels[0], 'scanner')
})
