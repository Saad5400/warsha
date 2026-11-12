/**
 * C# and C IntelliSense — the same engine as Java's (receiver typing, user
 * classes, ranking), fed by csharpApi.ts / cApi.ts. `member()` insists a hit
 * came from the member source (it carries a `detail`), not the word fallback.
 * Run with: `npm run test:editor`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { offered } from './helpers.ts'
import { maskCode, declaredNames, type TextLang } from '../../src/editor/codeText.ts'
import { directiveFor, includeInsertion, usingInsertion } from '../../src/editor/imports.ts'

const member = (lang: TextLang, doc: string, ...want: string[]) => {
  const { labels, byLabel } = offered(lang, doc)
  for (const w of want) {
    assert.ok(labels.includes(w), `expected "${w}" in [${labels.slice(0, 30).join(', ')}]`)
    assert.ok(byLabel.get(w)?.detail !== undefined, `"${w}" came from the word fallback, not a resolved member`)
  }
}
const has = (lang: TextLang, doc: string, ...want: string[]) => {
  const { labels } = offered(lang, doc)
  for (const w of want) assert.ok(labels.includes(w), `expected "${w}" in [${labels.slice(0, 30).join(', ')}]`)
}
const lacks = (lang: TextLang, doc: string, ...unwanted: string[]) => {
  const { labels } = offered(lang, doc)
  for (const w of unwanted) assert.ok(!labels.includes(w), `did not expect "${w}" in [${labels.slice(0, 30).join(', ')}]`)
}

/** Program.cs as the "C# (empty)" template writes it, with `body` inside Main and `classes` after Program. */
const csMain = (body: string, classes = '') =>
  `using System;\n\nclass Program\n{\n    static void Main()\n    {\n${body}\n    }\n}\n${classes}`
/** main.c as the "C (empty)" template writes it. */
const cMain = (body: string, before = '') => `#include <stdio.h>\n\n${before}int main(void) {\n${body}\n    return 0;\n}\n`

/* -------------------------------------------------------------------- C# */

test('c#: Console — the dictionary before the dot, its members after', () => {
  has('csharp', csMain('        Cons‸'), 'Console.WriteLine', 'Console.ReadLine', 'Console')
  member('csharp', csMain('        Console.Wr‸'), 'WriteLine', 'Write')
  member('csharp', csMain('        Console.‸'), 'ReadLine', 'Clear')
  lacks('csharp', csMain('        Console.‸'), 'cw', 'class', 'Length')
})

test('c#: statics — Math, int.Parse, string.Join, DateTime.Now', () => {
  member('csharp', csMain('        double r = Math.Sq‸'), 'Sqrt')
  member('csharp', csMain('        Math.‸'), 'PI', 'Pow', 'Ceiling')
  member('csharp', csMain('        int n = int.Pa‸'), 'Parse')
  member('csharp', csMain('        int.‸'), 'TryParse', 'MaxValue')
  member('csharp', csMain('        string.‸'), 'Join', 'IsNullOrEmpty')
  lacks('csharp', csMain('        string.‸'), 'Length', 'ToUpper')
  member('csharp', csMain('        String.Is‸'), 'IsNullOrWhiteSpace')
  member('csharp', csMain('        DateTime.Now.‸'), 'Year', 'AddDays')
  member('csharp', csMain('        Convert.To‸'), 'ToInt32', 'ToDouble')
})

test('c#: a string offers Length / ToUpper, and its statics stay on the type', () => {
  member('csharp', csMain('        string s = "hi";\n        s.‸'), 'Length', 'ToUpper', 'Split', 'Substring')
  lacks('csharp', csMain('        string s = "hi";\n        s.‸'), 'Join', 'IsNullOrEmpty', 'length', 'charAt')
  member('csharp', csMain('        string? line = Console.ReadLine();\n        line.Tr‸'), 'Trim')
  member('csharp', csMain('        var name = Console.ReadLine();\n        name.ToU‸'), 'ToUpper')
  member('csharp', csMain('        "abc".Le‸'), 'Length')
  member('csharp', csMain('        string s = "a b";\n        s.Trim().ToLower().‸'), 'Split')
})

test('c#: collections — List, Dictionary, Queue, Stack, HashSet, StringBuilder, Random', () => {
  member('csharp', csMain('        List<int> xs = new List<int>();\n        xs.‸'), 'Add', 'Count', 'RemoveAt', 'Sum', 'Where')
  member('csharp', csMain('        var xs = new List<string>();\n        xs.Fi‸'), 'Find', 'FindAll')
  member('csharp', csMain('        List<string> names = new();\n        names[0].ToU‸'), 'ToUpper')
  member('csharp', csMain('        List<string> names = new();\n        names.Find(n => n == "a").Len‸'), 'Length')
  member('csharp', csMain('        var ages = new Dictionary<string, int>();\n        ages.‸'), 'ContainsKey', 'TryGetValue', 'Keys', 'Count')
  member('csharp', csMain('        var q = new Queue<int>();\n        q.‸'), 'Enqueue', 'Dequeue', 'Peek')
  member('csharp', csMain('        Stack<int> st = new Stack<int>();\n        st.‸'), 'Push', 'Pop')
  member('csharp', csMain('        var seen = new HashSet<int>();\n        seen.‸'), 'Add', 'Contains')
  member('csharp', csMain('        var sb = new StringBuilder();\n        sb.App‸'), 'Append', 'AppendLine')
  member('csharp', csMain('        Random rnd = new Random();\n        int d = rnd.‸'), 'Next', 'NextDouble')
  // A user-written interface type reads as its table.
  member('csharp', csMain('        IList<int> xs = new List<int>();\n        xs.‸'), 'Add')
})

test('c#: arrays, foreach and LINQ chains', () => {
  member('csharp', csMain('        int[] nums = { 3, 1, 2 };\n        nums.‸'), 'Length', 'Sum', 'Max', 'OrderBy')
  member('csharp', csMain('        string[] parts = "a,b".Split(\',\');\n        parts[0].Tr‸'), 'Trim')
  member('csharp', csMain('        string[] words = { "a" };\n        foreach (var w in words)\n        {\n            w.ToU‸'), 'ToUpper')
  member('csharp', csMain('        var ages = new Dictionary<string, int>();\n        foreach (var pair in ages)\n        {\n            pair.‸'), 'Key', 'Value')
  member('csharp', csMain('        List<string> names = new();\n        foreach (string n in names)\n        {\n            n.Len‸'), 'Length')
  member('csharp', csMain('        List<string> names = new();\n        names.Where(n => n != "").ToList().‸'), 'Add', 'Count')
})

test('c#: the student\u2019s own class — fields, properties, methods, inheritance, statics', () => {
  const classes =
    'class Account\n{\n    private decimal balance;\n    public string Owner { get; set; }\n    public const decimal Fee = 1m;\n' +
    '    public Account(string owner) { Owner = owner; }\n    public void Deposit(decimal amount) { balance += amount; }\n' +
    '    public decimal GetBalance() => balance;\n    public static Account Open(string who) => new Account(who);\n}\n' +
    'class Savings : Account\n{\n    public Savings(string o) : base(o) { }\n    public void AddInterest() { }\n}\n'
  member('csharp', csMain('        var acc = new Account("Sara");\n        acc.‸', classes), 'Deposit', 'GetBalance', 'Owner', 'ToString')
  lacks('csharp', csMain('        var acc = new Account("Sara");\n        acc.‸', classes), 'balance')
  member('csharp', csMain('        Account a = Account.Open("x");\n        a.Owner.ToU‸', classes), 'ToUpper')
  member('csharp', csMain('        Account.‸', classes), 'Open', 'Fee')
  member('csharp', csMain('        Savings s = new Savings("x");\n        s.‸', classes), 'AddInterest', 'Deposit')
  // `this.` inside the class sees its own private field.
  const inside = csMain('', 'class Box\n{\n    private int size;\n    public void Grow()\n    {\n        this.‸\n    }\n}\n')
  member('csharp', inside, 'size', 'Grow')
  // A positional record's parameters are its properties.
  member('csharp', csMain('        var p = new Point(1, 2);\n        p.‸', 'record Point(int X, int Y);\n'), 'X', 'Y')
})

test('c#: catch variable, snippets, keywords', () => {
  member('csharp', csMain('        try { }\n        catch (FormatException ex)\n        {\n            ex.Mes‸'), 'Message')
  has('csharp', csMain('        cw‸'), 'cw')
  has('csharp', 'class Program\n{\n    sv‸\n}\n', 'svm')
  has('csharp', csMain('        fore‸'), 'foreach')
  has('csharp', csMain('        rea‸'), 'readline')
  has('csharp', csMain('        stri‸'), 'string')
  has('csharp', csMain('        for‸'), 'foreach', 'for', 'forr')
  const cw = offered('csharp', csMain('        cw‸')).byLabel.get('cw')
  assert.equal(cw?.type, 'snippet')
})

test('c#: no Java names leak in, and no C# into Java', () => {
  lacks('csharp', csMain('        sou‸'), 'sout', 'System.out.println')
  lacks('csharp', csMain('        Sys‸'), 'System.out.println')
  lacks('csharp', csMain('        string s = "x";\n        s.‸'), 'length', 'charAt', 'equalsIgnoreCase')
  lacks('java', 'public class Main {\n  public static void main(String[] args) {\n    cw‸\n  }\n}\n', 'cw')
  lacks('java', 'public class Main {\n  public static void main(String[] args) {\n    Cons‸\n  }\n}\n', 'Console.WriteLine')
  lacks('java', 'public class Main {\n  public static void main(String[] args) {\n    String s = "";\n    s.‸\n  }\n}\n', 'ToUpper', 'Length')
})

test('c# / c: no popup inside a string or a comment', () => {
  lacks('csharp', csMain('        Console.WriteLine("Cons‸");'), 'Console.WriteLine', 'Console')
  lacks('csharp', csMain('        // Cons‸'), 'Console.WriteLine')
  lacks('c', cMain('    printf("pri‸");'), 'printf')
  lacks('c', cMain('    /* str‸ */'), 'strlen')
})

test('c#: names — a declaration suggests names, not keywords', () => {
  has('csharp', csMain('        StringBuilder ‸'), 'stringBuilder', 'sb')
  has('csharp', csMain('        List<Student> ‸'), 'students')
  has('csharp', csMain('        string ‸'), 's', 'str')
  lacks('csharp', csMain('        string ‸'), 'class', 'cw')
  has('csharp', csMain('        List<string> names = new();\n        foreach (var ‸ in names)'), 'name')
})

test('c#: masking — a verbatim string never runs on', () => {
  const src = 'string p = @"C:\\";\nstring q = "x";'
  const m = maskCode('csharp', src)
  assert.equal(m.length, src.length)
  assert.ok(m.includes('string q = " ";'), m)
  // A doubled quote stays inside the verbatim literal.
  assert.ok(maskCode('csharp', 'var s = @"say ""hi"""; s.').endsWith('; s.'))
  // Java keeps treating backslash as an escape.
  assert.ok(!maskCode('java', 'String p = "C:\\" + x;').includes('+ x'))
  // …and so does a regular (non-verbatim) C# string.
  assert.ok(!maskCode('csharp', 'string p = "C:\\" + x;').includes('+ x'))
  // The member source works after a verbatim path.
  member('csharp', csMain('        string path = @"C:\\temp\\";\n        path.‸'), 'Length')
})

test('c#: usings — only what the runtime does not already import', () => {
  assert.equal(directiveFor('csharp', 'List'), null) // System.Collections.Generic is an implicit using
  assert.ok(directiveFor('csharp', 'StringBuilder')?.note.includes('System.Text'))
  const doc = 'using System;\n\nConsole.WriteLine(1);\n'
  assert.deepEqual(usingInsertion(EditorState.create({ doc }), 'System.Text'), { from: 13, to: 13, insert: '\nusing System.Text;' })
  assert.equal(usingInsertion(EditorState.create({ doc: 'using System.Text;\n' }), 'System.Text'), null)
  has('csharp', 'using Sys‸', 'System.Text', 'System.Collections.Generic')
  lacks('csharp', 'using Sys‸', 'string', 'Console.WriteLine')
})

/* --------------------------------------------------------------------- C */

test('c: the dictionary — stdio, string.h, stdlib, math, ctype', () => {
  has('c', cMain('    pri‸'), 'printf')
  has('c', cMain('    str‸'), 'strlen', 'strcpy', 'strcmp')
  has('c', cMain('    mal‸'), 'malloc')
  has('c', cMain('    double r = sq‸'), 'sqrt')
  has('c', cMain('    if (isd‸'), 'isdigit')
  const strlen = offered('c', cMain('    n = strl‸')).byLabel.get('strlen')
  assert.equal(strlen?.type, 'function')
  assert.ok(strlen?.detail?.includes('#include <string.h>'))
  assert.ok(directiveFor('c', 'printf')?.note.includes('stdio.h'))
})

test('c: keywords and snippets', () => {
  has('c', cMain('    stru‸'), 'struct')
  has('c', cMain('    typ‸'), 'typedef')
  has('c', cMain('    size‸'), 'sizeof')
  has('c', cMain('    uns‸'), 'unsigned')
  has('c', cMain('    NU‸'), 'NULL')
  has('c', 'ma‸', 'main')
  has('c', cMain('    pf‸'), 'pf')
  has('c', cMain('    fori‸'), 'fori')
  has('c', 'inc‸', 'inc', 'include')
  // `main(void)`: `void` is offered mid-expression in C.
  has('c', 'int main(vo‸', 'void')
  const main = offered('c', 'ma‸').byLabel.get('main')
  assert.equal(main?.type, 'snippet')
})

test('c: no Java / C# names leak in', () => {
  lacks('c', cMain('    sou‸'), 'sout', 'System.out.println')
  lacks('c', cMain('    Cons‸'), 'Console.WriteLine')
  lacks('c', cMain('    cw‸'), 'cw')
  lacks('c', cMain('    cla‸'), 'class')
  lacks('java', 'public class Main {\n  public static void main(String[] args) {\n    strl‸\n  }\n}\n', 'strlen')
  lacks('python', 'pri‸', 'printf')
})

test('c: struct fields through `.` and `->`', () => {
  const point = 'struct Point {\n    int x, y;\n    char name[20];\n    struct Point *next;\n};\n\n'
  member('c', cMain('    struct Point p;\n    p.‸', point), 'x', 'y', 'name', 'next')
  member('c', cMain('    struct Point *pp = NULL;\n    pp->‸', point), 'x', 'next')
  member('c', cMain('    struct Point *pp = NULL;\n    pp->next->‸', point), 'y')
  member('c', cMain('    struct Point pts[3];\n    pts[0].‸', point), 'x')
  const typedef = 'typedef struct {\n    char name[50];\n    float gpa;\n} Student;\n\n'
  member('c', cMain('    Student s;\n    s.g‸', typedef), 'gpa')
  member('c', cMain('    Student *sp = &s;\n    sp->na‸', typedef), 'name')
  // A parameter.
  member('c', `${point}void show(struct Point *p) {\n    printf("%d", p->‸);\n}\n`, 'x')
  lacks('c', cMain('    struct Point p;\n    p.‸', point), 'printf', 'main')
})

test('c: a declaration suggests names', () => {
  has('c', cMain('    int ‸'), 'i', 'n')
  has('c', cMain('    FILE *‸'), 'fp')
  has('c', cMain('    char *‸'), 's', 'str')
  lacks('c', cMain('    int ‸'), 'printf', 'int')
  has('c', cMain('    return ‸'), 'printf') // `return |` is not a declaration: the dictionary stays
})

test('c: declared names and includes', () => {
  const names = declaredNames('c', 'struct Point { int x; };\nint count = 0;\nchar *name;\nvoid show(int n) {}\n')
  assert.equal(names.get('count'), 'variable')
  assert.equal(names.get('name'), 'variable')
  assert.equal(names.get('show'), 'function')
  assert.equal(names.get('Point'), 'class')
  assert.equal(includeInsertion(EditorState.create({ doc: '#include <stdio.h>\nint main(void) {}\n' }), 'stdio.h'), null)
  assert.deepEqual(includeInsertion(EditorState.create({ doc: '#include <stdio.h>\nint main(void) {}\n' }), 'string.h'), {
    from: 18,
    to: 18,
    insert: '\n#include <string.h>',
  })
  assert.deepEqual(includeInsertion(EditorState.create({ doc: 'int main(void) {}\n' }), 'stdio.h'), { from: 0, to: 0, insert: '#include <stdio.h>\n' })
  has('c', '#include <st‸', 'stdio.h', 'stdlib.h', 'string.h')
  lacks('c', '#include <st‸', 'strlen', 'struct')
})
