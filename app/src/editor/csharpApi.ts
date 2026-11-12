import type { BuiltinDoc } from './completions'

/**
 * C# IntelliSense data — what a first-year .NET course (a `Program.cs` console
 * app, top-level statements or `class Program { static void Main() … }`) reaches
 * for. Pure data, no CodeMirror: completions.ts turns the rows into snippets and
 * dictionary entries, members.ts into the tables `x.` offers. The engine itself
 * (receiver typing, user classes, ranking) is Java's, shared — see codeText.ts.
 *
 * Member details follow the Java tables' shape, `ReturnType, (params) — gloss`
 * or `ReturnType — gloss`: chains read the leading return type (`s.Trim().` is
 * a string because `Trim` says so). `T` / `TKey` / `TValue` are substituted
 * from the declared type (`List<string>` makes `Find` a string).
 */

/** `[label, template, detail]` — a snippet before completions.ts wraps it. */
export type SnippetRow = readonly [label: string, template: string, detail: string]
/** `[label, detail, type?]` — a dictionary name; the type is inferred from the label when omitted. */
export type ApiRow = readonly [label: string, detail: string, type?: string]
/** `[label, detail, kind?]` — a member row; a method unless it says property or constant. */
export type MemberRow = readonly [label: string, detail: string, kind?: 'property' | 'constant']

const d = (signature: string, doc: string, example?: string): BuiltinDoc => ({ signature, doc, example })

/* ------------------------------------------------------------------ snippets */

/** Visual Studio's own abbreviations (`cw`, `svm`, `prop`, `ctor`…), Allman braces like its templates. */
export const CSHARP_SNIPPETS: readonly SnippetRow[] = [
  ['cw', 'Console.WriteLine(${});', 'print a line'],
  ['svm', 'static void Main(string[] args)\n{\n\t${}\n}', 'the Main method'],
  ['main', 'static void Main(string[] args)\n{\n\t${}\n}', 'the Main method'],
  ['for', 'for (int ${i} = 0; ${i} < ${length}; ${i}++)\n{\n\t${}\n}', 'count from 0'],
  ['forr', 'for (int ${i} = ${length} - 1; ${i} >= 0; ${i}--)\n{\n\t${}\n}', 'count down to 0'],
  ['foreach', 'foreach (var ${item} in ${items})\n{\n\t${}\n}', 'loop over a list or array'],
  ['while', 'while (${condition})\n{\n\t${}\n}', 'repeat while true'],
  ['do', 'do\n{\n\t${}\n} while (${condition});', 'do / while'],
  ['if', 'if (${condition})\n{\n\t${}\n}', 'if'],
  ['else', 'else\n{\n\t${}\n}', 'else'],
  ['switch', 'switch (${value})\n{\n\tcase ${1}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', 'match a value'],
  ['try', 'try\n{\n\t${}\n}\ncatch (${Exception} ex)\n{\n\tConsole.WriteLine(ex.Message);\n}', 'try / catch'],
  ['tryf', 'try\n{\n\t${}\n}\nfinally\n{\n\t\n}', 'try / finally'],
  ['class', 'class ${Name}\n{\n\t${}\n}', 'a class'],
  ['ctor', 'public ${ClassName}(${})\n{\n\t${}\n}', 'a constructor'],
  ['prop', 'public ${int} ${MyProperty} { get; set; }', 'a property'],
  ['propfull', 'private ${int} ${myVar};\n\npublic ${int} ${MyProperty}\n{\n\tget { return ${myVar}; }\n\tset { ${myVar} = value; }\n}', 'a property with its own field'],
  ['method', 'static ${void} ${Name}(${})\n{\n\t${}\n}', 'a method'],
  ['interface', 'interface ${IName}\n{\n\t${}\n}', 'an interface'],
  ['enum', 'enum ${Name}\n{\n\t${Values}\n}', 'a fixed set of named values'],
  ['struct', 'struct ${Name}\n{\n\t${}\n}', 'a small value type'],
  ['record', 'record ${Name}(${string Value});', 'a short data-holding type'],
  ['readline', 'string? ${line} = Console.ReadLine();', 'read a line the user types'],
  ['parseint', 'int ${n} = int.Parse(Console.ReadLine()!);', 'read a whole number'],
  ['tryparse', 'if (int.TryParse(Console.ReadLine(), out int ${n}))\n{\n\t${}\n}', 'read a number, safely'],
  ['lambda', '(${x}) => ${}', 'a lambda'],
]

/* ------------------------------------------------------------ dictionary */

/** Top-level names. Qualified ones (`Console.WriteLine`) end at the dot: past it, the member table owns the popup. */
export const CSHARP_API: readonly ApiRow[] = [
  ['Console.WriteLine', 'print a line'],
  ['Console.Write', 'print with no line break'],
  ['Console.ReadLine', 'read a line the user types'],
  ['Console.ReadKey', 'wait for a key press'],
  ['Console.Clear', 'clear the console'],
  ['Console', 'the console: print and read', 'class'],
  ['Math.Sqrt', 'square root'],
  ['Math.Pow', 'a number to a power'],
  ['Math.Abs', 'distance from zero'],
  ['Math.Max', 'the larger of two'],
  ['Math.Min', 'the smaller of two'],
  ['Math.Round', 'round to the nearest'],
  ['Math.Floor', 'round down'],
  ['Math.Ceiling', 'round up'],
  ['Math.PI', 'π, 3.14159…', 'constant'],
  ['Math.E', 'e, 2.71828…', 'constant'],
  ['Math', 'square roots, powers, rounding', 'class'],
  ['int.Parse', 'text to a whole number'],
  ['int.TryParse', 'try text to a whole number'],
  ['double.Parse', 'text to a decimal number'],
  ['double.TryParse', 'try text to a decimal number'],
  ['Convert.ToInt32', 'turn into a whole number'],
  ['Convert.ToDouble', 'turn into a decimal number'],
  ['Convert.ToString', 'turn into text'],
  ['Convert', 'turn one type into another', 'class'],
  ['string.Join', 'glue values together with a separator'],
  ['string.IsNullOrEmpty', 'is it null or ""?'],
  ['string.IsNullOrWhiteSpace', 'is it null, "" or only spaces?'],
  ['string.Format', 'fill {0} {1} slots in text'],
  ['string.Concat', 'join texts end to end'],
  ['string.Empty', 'the empty string ""', 'constant'],
  ['Random', 'make random numbers', 'class'],
  ['List', 'a list that grows', 'class'],
  ['Dictionary', 'look up values by key', 'class'],
  ['HashSet', 'a set with no duplicates', 'class'],
  ['Queue', 'first in, first out', 'class'],
  ['Stack', 'last in, first out', 'class'],
  ['StringBuilder', 'build text piece by piece', 'class'],
  ['DateTime.Now', 'the current date and time', 'property'],
  ['DateTime', 'a date and a time of day', 'class'],
  ['Array.Sort', 'sort an array, smallest first'],
  ['Array.Reverse', 'reverse an array'],
  ['Array.IndexOf', 'where a value is, or -1'],
  ['Array', 'sort and search arrays', 'class'],
  ['File.ReadAllText', 'the whole file as text'],
  ['File.ReadAllLines', 'every line of a file'],
  ['File.WriteAllText', 'write text, replacing the file'],
  ['File.AppendAllText', 'add text to the end of a file'],
  ['File.Exists', 'is the file there?'],
  ['File', 'read and write files', 'class'],
  ['Enumerable.Range', 'a run of whole numbers'],
  ['Enumerable', 'LINQ: make sequences', 'class'],
  ['Exception', 'something went wrong', 'class'],
]

/** The namespace a dictionary class lives in — accepting it adds the `using` if the file lacks it. */
export const CSHARP_USINGS: Readonly<Record<string, string>> = {
  List: 'System.Collections.Generic',
  Dictionary: 'System.Collections.Generic',
  HashSet: 'System.Collections.Generic',
  Queue: 'System.Collections.Generic',
  Stack: 'System.Collections.Generic',
  StringBuilder: 'System.Text',
  File: 'System.IO',
  Enumerable: 'System.Linq',
}

/**
 * The runtime compiles every project with these as global usings (the same set
 * `dotnet new console` turns on — runtimes/csharp/harness/Program.cs), so they
 * never need writing out and are never auto-added. Remove one here to have it
 * inserted again.
 */
export const CSHARP_IMPLICIT_USINGS: ReadonlySet<string> = new Set([
  'System', 'System.Collections.Generic', 'System.IO', 'System.Linq', 'System.Threading', 'System.Threading.Tasks',
])

/** What `using |` offers. */
export const CSHARP_NAMESPACES: readonly (readonly [string, string])[] = [
  ['System', 'Console, Math, Random, DateTime'],
  ['System.Collections.Generic', 'List, Dictionary, HashSet, Queue, Stack'],
  ['System.Linq', 'Where, Select, OrderBy, Sum…'],
  ['System.Text', 'StringBuilder'],
  ['System.IO', 'File, StreamReader, StreamWriter'],
  ['System.Threading.Tasks', 'Task, async work'],
]

/* -------------------------------------------------------------- members */

/** LINQ — what every list, array and sequence offers (System.Linq, an implicit using). Ranked under a type's own members. */
export const LINQ: readonly MemberRow[] = [
  ['Where', 'IEnumerable<T>, (x => test) — keep the ones that pass'],
  ['Select', 'IEnumerable, (x => value) — turn each into something else'],
  ['OrderBy', 'IEnumerable<T>, (x => key) — sort by a key'],
  ['OrderByDescending', 'IEnumerable<T>, (x => key) — sort by a key, largest first'],
  ['Sum', 'T — add them all up'],
  ['Max', 'T — the largest'],
  ['Min', 'T — the smallest'],
  ['Average', 'double — the mean'],
  ['Count', 'int, (x => test) — how many (that pass)'],
  ['Contains', 'bool, (T) — is this value in it?'],
  ['First', 'T — the first item'],
  ['FirstOrDefault', 'T, (x => test) — the first (that passes), or default'],
  ['Last', 'T — the last item'],
  ['Any', 'bool, (x => test) — does any pass?'],
  ['All', 'bool, (x => test) — do all pass?'],
  ['Distinct', 'IEnumerable<T> — without duplicates'],
  ['Skip', 'IEnumerable<T>, (int) — all but the first n'],
  ['Take', 'IEnumerable<T>, (int) — just the first n'],
  ['ToList', 'List<T> — copy into a List'],
  ['ToArray', 'T[] — copy into an array'],
]

/** Every value has these (System.Object) — offered under a type's own members. */
export const CSHARP_OBJECT: readonly MemberRow[] = [
  ['ToString', 'string — as text'],
  ['Equals', 'bool, (object) — are these equal?'],
  ['GetHashCode', 'int — a number for hashing'],
  ['GetType', 'Type — the type it really is'],
]

const NUMBER = (t: string): MemberRow[] => [
  ['Parse', `${t}, (string) — text to a ${t}`],
  ['TryParse', `bool, (string, out ${t}) — try text to a ${t}`],
  ['MaxValue', `${t} — the largest ${t}`, 'constant'],
  ['MinValue', `${t} — the smallest ${t}`, 'constant'],
  ['ToString', 'string, (format) — as text'],
  ['CompareTo', `int, (${t}) — negative, zero or positive`],
  ['Equals', `bool, (${t}) — the same value?`],
]

export const CSHARP_MEMBERS: Readonly<Record<string, readonly MemberRow[]>> = {
  Console: [
    ['WriteLine', 'void, (value) — print a line'],
    ['Write', 'void, (value) — print with no line break'],
    ['ReadLine', 'string — read a line the user types'],
    ['ReadKey', 'ConsoleKeyInfo — wait for a key press'],
    ['Read', 'int — read one character code'],
    ['Clear', 'void — clear the console'],
    ['ForegroundColor', 'ConsoleColor — the text colour', 'property'],
    ['BackgroundColor', 'ConsoleColor — the background colour', 'property'],
    ['ResetColor', 'void — back to the normal colours'],
  ],
  Math: [
    ['Sqrt', 'double, (double) — square root'],
    ['Pow', 'double, (double, double) — x to the power y'],
    ['Abs', 'double, (number) — distance from zero'],
    ['Max', 'double, (a, b) — the larger of two'],
    ['Min', 'double, (a, b) — the smaller of two'],
    ['Round', 'double, (double, digits) — round to the nearest'],
    ['Floor', 'double, (double) — round down'],
    ['Ceiling', 'double, (double) — round up'],
    ['Truncate', 'double, (double) — drop the decimals'],
    ['Clamp', 'double, (value, min, max) — keep inside a range'],
    ['Sin', 'double, (radians) — sine'],
    ['Cos', 'double, (radians) — cosine'],
    ['Tan', 'double, (radians) — tangent'],
    ['Log', 'double, (double) — natural logarithm'],
    ['Log10', 'double, (double) — base-10 logarithm'],
    ['PI', 'double — π, 3.14159…', 'constant'],
    ['E', 'double — e, 2.71828…', 'constant'],
  ],
  Convert: [
    ['ToInt32', 'int, (value) — turn into a whole number'],
    ['ToDouble', 'double, (value) — turn into a decimal number'],
    ['ToDecimal', 'decimal, (value) — turn into a decimal (money)'],
    ['ToString', 'string, (value) — turn into text'],
    ['ToBoolean', 'bool, (value) — turn into true / false'],
    ['ToChar', 'char, (value) — turn into a character'],
  ],
  int: NUMBER('int'),
  long: NUMBER('long'),
  decimal: NUMBER('decimal'),
  double: [
    ...NUMBER('double'),
    ['IsNaN', 'bool, (double) — is it "not a number"?'],
    ['NaN', 'double — "not a number"', 'constant'],
    ['PositiveInfinity', 'double — +∞', 'constant'],
  ],
  float: NUMBER('float'),
  bool: [
    ['Parse', 'bool, (string) — "true" / "false" to a bool'],
    ['TryParse', 'bool, (string, out bool) — try text to a bool'],
    ['ToString', 'string — "True" or "False"'],
  ],
  char: [
    ['IsDigit', 'bool, (char) — is it 0-9?'],
    ['IsLetter', 'bool, (char) — is it a letter?'],
    ['IsLetterOrDigit', 'bool, (char) — a letter or a digit?'],
    ['IsUpper', 'bool, (char) — is it a capital?'],
    ['IsLower', 'bool, (char) — is it lower case?'],
    ['IsWhiteSpace', 'bool, (char) — a space, tab or newline?'],
    ['ToUpper', 'char, (char) — the capital version'],
    ['ToLower', 'char, (char) — the lower-case version'],
    ['ToString', 'string — as text'],
    ['CompareTo', 'int, (char) — negative, zero or positive'],
  ],
  string: [
    ['Length', 'int — how many characters', 'property'],
    ['ToUpper', 'string — ALL CAPITALS'],
    ['ToLower', 'string — all lower case'],
    ['Trim', 'string — remove spaces at both ends'],
    ['TrimStart', 'string — remove spaces at the start'],
    ['TrimEnd', 'string — remove spaces at the end'],
    ['Split', 'string[], (char) — break text into pieces'],
    ['Substring', 'string, (int, int) — a piece of the text'],
    ['Contains', 'bool, (string) — does it contain this?'],
    ['IndexOf', 'int, (string) — where this appears, or -1'],
    ['LastIndexOf', 'int, (string) — where it last appears, or -1'],
    ['Replace', 'string, (string, string) — swap one piece for another'],
    ['StartsWith', 'bool, (string) — does it start with this?'],
    ['EndsWith', 'bool, (string) — does it end with this?'],
    ['ToCharArray', 'char[] — the characters, as an array'],
    ['Equals', 'bool, (string) — are these the same?'],
    ['CompareTo', 'int, (string) — which comes first A to Z'],
    ['PadLeft', 'string, (int) — pad on the left to a width'],
    ['PadRight', 'string, (int) — pad on the right to a width'],
    ['Insert', 'string, (int, string) — put text in at a position'],
    ['Remove', 'string, (int, int) — cut out a piece'],
    ['ToString', 'string — the text itself'],
    // Static — reached as `string.Join(…)` (see CSHARP_STATICS).
    ['Join', 'string, (separator, values) — glue values together'],
    ['IsNullOrEmpty', 'bool, (string) — is it null or ""?'],
    ['IsNullOrWhiteSpace', 'bool, (string) — null, "" or only spaces?'],
    ['Format', 'string, (format, values) — fill {0} {1} slots'],
    ['Concat', 'string, (a, b) — join texts end to end'],
    ['Compare', 'int, (string, string) — which comes first A to Z'],
    ['Empty', 'string — the empty string ""', 'constant'],
  ],
  '[]': [
    ['Length', 'int — how many elements', 'property'],
    ...LINQ,
  ],
  Array: [
    ['Sort', 'void, (array) — sort, smallest first'],
    ['Reverse', 'void, (array) — reverse the order'],
    ['IndexOf', 'int, (array, value) — where it is, or -1'],
    ['Fill', 'void, (array, value) — set every element'],
    ['Copy', 'void, (from, to, length) — copy elements across'],
    ['Resize', 'void, (ref array, int) — change its size'],
    ['Exists', 'bool, (array, x => test) — does any pass?'],
    ['Find', 'T, (array, x => test) — the first that passes'],
    ['Clear', 'void, (array) — set every element to default'],
  ],
  File: [
    ['ReadAllText', 'string, (path) — the whole file as text'],
    ['ReadAllLines', 'string[], (path) — every line of the file'],
    ['WriteAllText', 'void, (path, text) — write text, replacing the file'],
    ['WriteAllLines', 'void, (path, lines) — write lines, replacing the file'],
    ['AppendAllText', 'void, (path, text) — add text to the end'],
    ['Exists', 'bool, (path) — is the file there?'],
    ['Delete', 'void, (path) — delete the file'],
  ],
  DateTime: [
    ['Now', 'DateTime — the current date and time', 'property'],
    ['Today', 'DateTime — today, at midnight', 'property'],
    ['Parse', 'DateTime, (string) — text to a date'],
    ['Year', 'int — the year', 'property'],
    ['Month', 'int — the month, 1 to 12', 'property'],
    ['Day', 'int — the day of the month', 'property'],
    ['Hour', 'int — the hour, 0 to 23', 'property'],
    ['Minute', 'int — the minute', 'property'],
    ['Second', 'int — the second', 'property'],
    ['DayOfWeek', 'DayOfWeek — Monday, Tuesday…', 'property'],
    ['ToString', 'string, (format) — as text, e.g. "yyyy-MM-dd"'],
    ['ToShortDateString', 'string — just the date, as text'],
    ['AddDays', 'DateTime, (double) — a date n days later'],
    ['AddHours', 'DateTime, (double) — n hours later'],
    ['AddMonths', 'DateTime, (int) — n months later'],
    ['AddYears', 'DateTime, (int) — n years later'],
  ],
  Random: [
    ['Next', 'int, (min, max) — a random whole number, max left out'],
    ['NextDouble', 'double — a random decimal from 0 to 1'],
    ['Shared', 'Random — a ready-made Random to share', 'property'],
  ],
  List: [
    ['Add', 'void, (T) — add to the end'],
    ['AddRange', 'void, (items) — add many to the end'],
    ['Remove', 'bool, (T) — remove the first match'],
    ['RemoveAt', 'void, (int) — remove at a position'],
    ['RemoveAll', 'int, (x => test) — remove all that pass'],
    ['Insert', 'void, (int, T) — put in at a position'],
    ['Contains', 'bool, (T) — is it in the list?'],
    ['IndexOf', 'int, (T) — where it is, or -1'],
    ['Count', 'int — how many items', 'property'],
    ['Clear', 'void — remove everything'],
    ['Sort', 'void — sort, smallest first'],
    ['Reverse', 'void — reverse the order'],
    ['Find', 'T, (x => test) — the first that passes'],
    ['FindAll', 'List<T>, (x => test) — every one that passes'],
    ['Exists', 'bool, (x => test) — does any pass?'],
    ['ForEach', 'void, (x => …) — run code on each item'],
    ['ToArray', 'T[] — copy into an array'],
    ...LINQ,
  ],
  Dictionary: [
    ['Add', 'void, (TKey, TValue) — add a key and its value'],
    ['ContainsKey', 'bool, (TKey) — is this key there?'],
    ['ContainsValue', 'bool, (TValue) — is this value there?'],
    ['Remove', 'bool, (TKey) — remove a key and its value'],
    ['TryGetValue', 'bool, (TKey, out TValue) — look up, safely'],
    ['GetValueOrDefault', 'TValue, (TKey) — the value, or a default'],
    ['Count', 'int — how many keys', 'property'],
    ['Keys', 'IEnumerable<TKey> — all the keys', 'property'],
    ['Values', 'IEnumerable<TValue> — all the values', 'property'],
    ['Clear', 'void — remove everything'],
  ],
  KeyValuePair: [
    ['Key', 'TKey — the key', 'property'],
    ['Value', 'TValue — the value', 'property'],
  ],
  HashSet: [
    ['Add', 'bool, (T) — add, unless already there'],
    ['Remove', 'bool, (T) — take it out'],
    ['Contains', 'bool, (T) — is it in the set?'],
    ['Count', 'int — how many items', 'property'],
    ['Clear', 'void — remove everything'],
    ['UnionWith', 'void, (items) — add all of these'],
    ['IntersectWith', 'void, (items) — keep only the shared ones'],
    ['ExceptWith', 'void, (items) — remove all of these'],
    ...LINQ,
  ],
  Queue: [
    ['Enqueue', 'void, (T) — add to the back'],
    ['Dequeue', 'T — take from the front'],
    ['Peek', 'T — look at the front'],
    ['Count', 'int — how many items', 'property'],
    ['Contains', 'bool, (T) — is it in the queue?'],
    ['Clear', 'void — remove everything'],
  ],
  Stack: [
    ['Push', 'void, (T) — put on top'],
    ['Pop', 'T — take from the top'],
    ['Peek', 'T — look at the top'],
    ['Count', 'int — how many items', 'property'],
    ['Contains', 'bool, (T) — is it in the stack?'],
    ['Clear', 'void — remove everything'],
  ],
  StringBuilder: [
    ['Append', 'StringBuilder, (value) — add to the end'],
    ['AppendLine', 'StringBuilder, (value) — add a line'],
    ['Insert', 'StringBuilder, (int, value) — put in at a position'],
    ['Remove', 'StringBuilder, (int, int) — cut out a piece'],
    ['Replace', 'StringBuilder, (old, new) — swap one piece for another'],
    ['Clear', 'StringBuilder — empty it'],
    ['Length', 'int — how many characters', 'property'],
    ['ToString', 'string — the finished text'],
  ],
  IEnumerable: LINQ,
  Enumerable: [
    ['Range', 'IEnumerable<int>, (start, count) — count up from start'],
    ['Repeat', 'IEnumerable, (value, count) — one value, n times'],
  ],
  Exception: [
    ['Message', 'string — what went wrong', 'property'],
    ['StackTrace', 'string — where it happened', 'property'],
    ['InnerException', 'Exception — the error that caused it', 'property'],
  ],
}

/** The members of a mixed table that belong to the type, not its values: what `string.` offers and `s.` leaves out. */
export const CSHARP_STATICS: Readonly<Record<string, ReadonlySet<string>>> = {
  string: new Set(['Join', 'IsNullOrEmpty', 'IsNullOrWhiteSpace', 'Format', 'Concat', 'Compare', 'Empty']),
  int: new Set(['Parse', 'TryParse', 'MaxValue', 'MinValue']),
  long: new Set(['Parse', 'TryParse', 'MaxValue', 'MinValue']),
  decimal: new Set(['Parse', 'TryParse', 'MaxValue', 'MinValue']),
  float: new Set(['Parse', 'TryParse', 'MaxValue', 'MinValue']),
  double: new Set(['Parse', 'TryParse', 'MaxValue', 'MinValue', 'IsNaN', 'NaN', 'PositiveInfinity']),
  bool: new Set(['Parse', 'TryParse']),
  char: new Set(['IsDigit', 'IsLetter', 'IsLetterOrDigit', 'IsUpper', 'IsLower', 'IsWhiteSpace', 'ToUpper', 'ToLower']),
  DateTime: new Set(['Now', 'Today', 'Parse']),
  Random: new Set(['Shared']),
}

/** Another spelling of the same type → its table: `String` is `string`, `IList<T>` reads as a List. */
export const CSHARP_ALIAS: Readonly<Record<string, string>> = {
  String: 'string', Int32: 'int', Int64: 'long', Double: 'double', Single: 'float', Decimal: 'decimal', Boolean: 'bool',
  Char: 'char', Object: 'object',
  IList: 'List', ICollection: 'List', IReadOnlyList: 'List', SortedList: 'List', LinkedList: 'List',
  IDictionary: 'Dictionary', SortedDictionary: 'Dictionary', IReadOnlyDictionary: 'Dictionary',
  ISet: 'HashSet', SortedSet: 'HashSet',
}

/** Type parameter names per generic table, so `List<string>.Find` returns a string. */
export const CSHARP_TYPE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  List: ['T'], HashSet: ['T'], Queue: ['T'], Stack: ['T'], IEnumerable: ['T'],
  Dictionary: ['TKey', 'TValue'], KeyValuePair: ['TKey', 'TValue'],
}

/* ----------------------------------------------------------------- docs */

export const CSHARP_DOCS: Record<string, BuiltinDoc> = {
  'Console.WriteLine': d('Console.WriteLine(value)', 'Prints the value, then moves to a new line. With no value it prints an empty line.', 'Console.WriteLine("Hello, " + name);'),
  'Console.Write': d('Console.Write(value)', 'Prints the value and stays on the same line — handy before reading an answer.', 'Console.Write("Your age: ");'),
  'Console.ReadLine': d('Console.ReadLine() → string?', 'Waits for the user to type a line and press Enter, and gives it back as text. Turn it into a number with int.Parse.', 'string? name = Console.ReadLine();'),
  'Console.ReadKey': d('Console.ReadKey() → ConsoleKeyInfo', 'Waits for one key press. Often used to keep the window open at the end.'),
  'Console.Clear': d('Console.Clear()', 'Wipes everything printed so far.'),
  'Math.Sqrt': d('Math.Sqrt(double x) → double', 'The square root of x.', 'double r = Math.Sqrt(16); // 4'),
  'Math.Pow': d('Math.Pow(double x, double y) → double', 'x multiplied by itself y times. Always a double.', 'double area = Math.Pow(side, 2);'),
  'Math.Abs': d('Math.Abs(x)', 'The distance from zero: the number without its minus sign.', 'Math.Abs(-7) // 7'),
  'Math.Max': d('Math.Max(a, b)', 'The larger of two numbers.', 'int best = Math.Max(a, b);'),
  'Math.Min': d('Math.Min(a, b)', 'The smaller of two numbers.'),
  'Math.Round': d('Math.Round(double x, int digits = 0) → double', 'Rounds to the nearest whole number, or to that many decimal places. Halves round to the even neighbour (2.5 → 2).', 'Math.Round(3.14159, 2) // 3.14'),
  'Math.Floor': d('Math.Floor(double x) → double', 'Rounds down to the whole number below.', 'Math.Floor(2.9) // 2'),
  'Math.Ceiling': d('Math.Ceiling(double x) → double', 'Rounds up to the whole number above.', 'Math.Ceiling(2.1) // 3'),
  'Math.PI': d('Math.PI', 'π — the ratio of a circle’s circumference to its diameter, 3.14159…', 'double area = Math.PI * r * r;'),
  'int.Parse': d('int.Parse(string s) → int', 'Turns text like "42" into the number 42. Throws a FormatException if the text is not a whole number.', 'int age = int.Parse(Console.ReadLine()!);'),
  'int.TryParse': d('int.TryParse(string s, out int result) → bool', 'Tries to turn text into a whole number. Returns false instead of crashing when it can’t.', 'if (int.TryParse(text, out int n)) { … }'),
  'double.Parse': d('double.Parse(string s) → double', 'Turns text like "3.5" into a decimal number.', 'double price = double.Parse(Console.ReadLine()!);'),
  'double.TryParse': d('double.TryParse(string s, out double result) → bool', 'Tries to turn text into a decimal number; false if it isn’t one.'),
  'Convert.ToInt32': d('Convert.ToInt32(value) → int', 'Turns text, a double or a bool into an int. A double is rounded to the nearest whole number.', 'int n = Convert.ToInt32("15");'),
  'Convert.ToDouble': d('Convert.ToDouble(value) → double', 'Turns text or another number into a double.'),
  'string.Join': d('string.Join(string separator, values) → string', 'Glues the values into one text, with the separator between each pair.', 'string.Join(", ", names) // "Ali, Sara"'),
  'string.IsNullOrEmpty': d('string.IsNullOrEmpty(string? s) → bool', 'True when s is null or "". A safe check before using text from ReadLine.'),
  'string.IsNullOrWhiteSpace': d('string.IsNullOrWhiteSpace(string? s) → bool', 'True when s is null, "" or only spaces.'),
  'string.Format': d('string.Format(string format, values) → string', 'Puts the values into the {0}, {1}… slots. An interpolated $"…{x}…" string does the same.', 'string.Format("{0} is {1}", name, age)'),
  'string.Length': d('s.Length → int', 'How many characters the text has. A property: no brackets.', '"hello".Length // 5'),
  'string.Split': d('s.Split(char separator) → string[]', 'Breaks the text into pieces at each separator.', 'string[] parts = line.Split(\',\');'),
  'string.Substring': d('s.Substring(int start, int length) → string', 'The piece of text starting at start (counting from 0), length characters long.', '"Warsha".Substring(0, 3) // "War"'),
  List: d('List<T>', 'A list that grows as you Add to it. Read item i with list[i]; Count says how many.', 'List<int> marks = new List<int>();'),
  'List.Add': d('list.Add(T item)', 'Adds the item to the end of the list.'),
  'List.Count': d('list.Count → int', 'How many items the list holds. A property: no brackets.'),
  Dictionary: d('Dictionary<TKey, TValue>', 'Stores values under keys, like a phone book. Read one with dict[key].', 'var ages = new Dictionary<string, int>();'),
  'Dictionary.TryGetValue': d('dict.TryGetValue(TKey key, out TValue value) → bool', 'Looks the key up without crashing when it is missing.', 'if (ages.TryGetValue("Ali", out int a)) { … }'),
  'Dictionary.ContainsKey': d('dict.ContainsKey(TKey key) → bool', 'True when the key is there.'),
  HashSet: d('HashSet<T>', 'A collection with no duplicates; Contains is fast.'),
  Queue: d('Queue<T>', 'First in, first out: Enqueue at the back, Dequeue from the front.'),
  Stack: d('Stack<T>', 'Last in, first out: Push on top, Pop from the top.'),
  StringBuilder: d('StringBuilder (System.Text)', 'Builds text piece by piece without making a new string each time. Finish with ToString().', 'var sb = new StringBuilder();'),
  Random: d('Random', 'Makes random numbers. Make one and reuse it.', 'var rnd = new Random();\nint dice = rnd.Next(1, 7);'),
  'Random.Next': d('rnd.Next(int min, int max) → int', 'A random whole number from min up to max - 1 (max is left out).', 'rnd.Next(1, 7) // 1 to 6'),
  'DateTime.Now': d('DateTime.Now → DateTime', 'The current date and time on this computer.', 'Console.WriteLine(DateTime.Now.Year);'),
  'Array.Sort': d('Array.Sort(array)', 'Sorts the array in place, smallest first.', 'Array.Sort(numbers);'),
  'Array.Reverse': d('Array.Reverse(array)', 'Reverses the order of the array in place.'),
  'Array.IndexOf': d('Array.IndexOf(array, value) → int', 'Where the value first appears, or -1 when it is not there.'),
  'File.ReadAllText': d('File.ReadAllText(string path) → string', 'Reads the whole file into one string.', 'string text = File.ReadAllText("data.txt");'),
  'File.ReadAllLines': d('File.ReadAllLines(string path) → string[]', 'Reads the file into an array, one line per element.', 'foreach (string line in File.ReadAllLines("data.txt")) { … }'),
  'File.WriteAllText': d('File.WriteAllText(string path, string text)', 'Writes the text to the file, replacing what was there.'),
  'File.AppendAllText': d('File.AppendAllText(string path, string text)', 'Adds the text to the end of the file (creating it if needed).'),
  'File.Exists': d('File.Exists(string path) → bool', 'True when the file is there.'),
  'Enumerable.Range': d('Enumerable.Range(int start, int count) → IEnumerable<int>', 'count numbers in a row, starting at start.', 'Enumerable.Range(1, 5) // 1 2 3 4 5'),
}
