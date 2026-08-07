import {
  completeFromList,
  ifNotIn,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import type { EditorState } from '@codemirror/state'
import { JAVA_IMPORTS, applyWithImport, importInsertion, importStatementSource, pyImportInsertion } from './imports'
import { memberContext, memberSource } from './members'

/** Narrower than `LangId` — web files get highlighting but no curated
 *  dictionary, so `completionSources` takes this type and `null` for the rest. */
export type CompletionLang = 'java' | 'python'

/**
 * Completions and snippets — the "where is the IntelliSense?" layer.
 *
 * Four sources per language, each contributing to one ranked popup:
 *
 *   1. **Snippets** (`boost: 60`) — `sout`, `psvm`, `fori`. Deliberately the same
 *      abbreviations IntelliJ and VS Code use, because a student who has seen a
 *      teacher type `sout` in class will try `sout` here, and the muscle memory
 *      is worth more than any name we could invent.
 *   2. **Keywords + a small beginner API dictionary** (`boost: 20` / `10`) — the
 *      names from the first four weeks of a course, each with a plain-English
 *      `detail`. Still a hand-written list, not a language server.
 *   3. **Members after a dot** (members.ts) — `sc.` offers Scanner's methods, and
 *      ranks them by the type the line seems to want (`int n = sc.` floats
 *      `nextInt`). A `.` context is *exclusive*: the other three sources step
 *      aside so no `class` or `sout` shows up after a dot.
 *   4. **Identifiers already in the file / project** — every word you have
 *      written, ranked by how likely you want it *here*: near the caret beats far
 *      away, a name declared in this file beats a bare word, this file beats the
 *      rest of the project. Keywords and dictionary names are dropped so the
 *      documented completion always represents them.
 *
 * On top of that, ranking reads the situation: mid-expression (after `=`, `(`, a
 * comma or an operator) the declaration-only keywords and statement snippets are
 * withheld, the way VS Code won't offer `class` inside `int x = …`.
 *
 * None of this is semantic analysis — types are guessed from the text (see
 * members.ts) and "how likely you want it" is proximity, not scope resolution.
 * Wrong in the ways every heuristic here is wrong; right for a first-year course.
 *
 * Snippet templates use `${name}` for a tab stop and a leading tab per level;
 * CodeMirror expands each tab to the editor's `indentUnit` and re-indents to the
 * line the snippet lands on. Tab / Shift-Tab walk the stops, Escape leaves them.
 */

/* ------------------------------------------------------------------ snippets */

const snip = (label: string, template: string, detail: string): Completion =>
  snippetCompletion(template, { label, detail, type: 'snippet', boost: 60 })

/** Java. `sout` / `souf` / `psvm` are IntelliJ's abbreviations, on purpose. */
export const JAVA_SNIPPETS: readonly Completion[] = [
  snip('sout', 'System.out.println(${});', 'print a line'),
  snip('souf', 'System.out.printf("${%s}%n", ${value});', 'print with a format'),
  snip('serr', 'System.err.println(${});', 'print to the error stream'),
  snip('psvm', 'public static void main(String[] args) {\n\t${}\n}', 'the main method'),
  snip('main', 'public static void main(String[] args) {\n\t${}\n}', 'the main method'),
  snip('fori', 'for (int i = 0; i < ${count}; i++) {\n\t${}\n}', 'count from 0'),
  snip('foreach', 'for (${String} ${item} : ${items}) {\n\t${}\n}', 'loop over a list or array'),
  snip('while', 'while (${condition}) {\n\t${}\n}', 'repeat while true'),
  snip('ifelse', 'if (${condition}) {\n\t${}\n} else {\n\t\n}', 'if / else'),
  snip('class', 'class ${Name} {\n\t${}\n}', 'a class'),
  snip('method', 'public ${void} ${name}(${}) {\n\t\n}', 'a method'),
  snip('scanner', 'Scanner ${sc} = new Scanner(System.in);', 'read what the user types'),
  snip('try', 'try {\n\t${}\n} catch (${Exception} e) {\n\tSystem.out.println(e.getMessage());\n}', 'try / catch'),
  snip('var', 'var ${name} = ${value};', 'let Java work out the type'),
  snip('record', 'record ${Name}(${int field}) {}', 'a short data-holding class'),
  snip('switch', 'switch (${value}) {\n\tcase ${label} -> ${};\n\tdefault -> ${};\n}', 'match a value, arrow form'),
  snip('text', '"""\n${}\n"""', 'a multi-line text block'),
]

export const PYTHON_SNIPPETS: readonly Completion[] = [
  snip('main', 'if __name__ == "__main__":\n\t${}', 'run this when the file runs'),
  snip('def', 'def ${name}(${}):\n\t${}', 'a function'),
  snip('fori', 'for i in range(${n}):\n\t${}', 'count from 0'),
  snip('foreach', 'for ${item} in ${items}:\n\t${}', 'loop over a list'),
  snip('while', 'while ${condition}:\n\t${}', 'repeat while true'),
  snip('ifelse', 'if ${condition}:\n\t${}\nelse:\n\t', 'if / else'),
  snip('class', 'class ${Name}:\n\tdef __init__(self, ${}):\n\t\t${}', 'a class'),
  snip('input', '${name} = input("${What is your name?} ")', 'ask the user for something'),
  snip('tryex', 'try:\n\t${}\nexcept ${Exception} as e:\n\tprint(e)', 'try / except'),
  snip('fstr', 'f"${text} {${value}}"', 'put a value inside text'),
]

/* ------------------------------------------------------------------ keywords */

const KEYWORDS: Record<CompletionLang, readonly string[]> = {
  java: `abstract assert boolean break byte case catch char class continue default do double else enum extends
final finally float for if implements import instanceof int interface long new package private protected public
return short static super switch this throw throws try void while true false null
var record sealed permits yield`.split(/\s+/),
  python: `and as assert async await break class continue def del elif else except False finally for from global
if import in is lambda None nonlocal not or pass raise return True try while with yield`.split(/\s+/),
}

/* ------------------------------------------------- beginner API dictionaries */

/** `[label, detail]`. Kept to what a first-year course actually uses. */
const JAVA_API: readonly (readonly [string, string])[] = [
  ['System.out.println', 'print a line'],
  ['System.out.print', 'print with no line break'],
  ['System.out.printf', 'print with a format'],
  ['System.err.println', 'print to the error stream'],
  ['println', 'print a line'],
  ['print', 'print with no line break'],
  ['printf', 'print with a format'],
  ['Scanner', 'reads what the user types'],
  ['nextLine', 'read one whole line'],
  ['nextInt', 'read a whole number'],
  ['nextDouble', 'read a decimal number'],
  ['next', 'read one word'],
  ['hasNextLine', 'is there another line?'],
  ['hasNextInt', 'is the next thing a number?'],
  ['length', 'how many characters'],
  ['charAt', 'the character at a position'],
  ['substring', 'a piece of the text'],
  ['equals', 'are these the same?'],
  ['equalsIgnoreCase', 'the same, ignoring capitals'],
  ['toUpperCase', 'ALL CAPITALS'],
  ['toLowerCase', 'all lower case'],
  ['trim', 'remove spaces at both ends'],
  ['split', 'break text into pieces'],
  ['contains', 'does it contain this?'],
  ['indexOf', 'where this appears, or -1'],
  ['replace', 'swap one piece for another'],
  ['isEmpty', 'is it empty?'],
  ['toString', 'this object as text'],
  ['String.valueOf', 'a number as text'],
  ['Integer.parseInt', 'text as a whole number'],
  ['Double.parseDouble', 'text as a decimal number'],
  ['Math.abs', 'distance from zero'],
  ['Math.max', 'the larger of two'],
  ['Math.min', 'the smaller of two'],
  ['Math.pow', 'to the power of'],
  ['Math.sqrt', 'square root'],
  ['Math.round', 'to the nearest whole number'],
  ['Math.random', 'a random number from 0 to 1'],
  ['ArrayList', 'a list that can grow'],
  ['add', 'put something in'],
  ['get', 'the item at a position'],
  ['set', 'replace the item at a position'],
  ['size', 'how many items'],
  ['remove', 'take something out'],
  ['HashMap', 'pairs of key and value'],
  ['put', 'store a value under a key'],
  ['containsKey', 'is this key in there?'],
  ['getMessage', 'what went wrong, as text'],
  ['Random', 'a source of random numbers'],
  ['nextBoolean', 'a random true or false'],
  ['Arrays', 'helpers for working with arrays'],
  ['Arrays.sort', 'put an array in order'],
  ['Arrays.toString', 'an array as text'],
  ['StringBuilder', 'text you can build up piece by piece'],
  ['append', 'add to the end'],
  ['HashSet', 'a set with no repeats'],
  ['LinkedList', 'a list good at adding and removing from the ends'],
  ['Collections', 'helpers for working with lists'],
  ['Collections.sort', 'put a list in order'],
  // Modern Java (9–17): the idioms a Java 17 course actually reaches for.
  ['List.of', 'a fixed list of these items'],
  ['Map.of', 'a fixed map of these key/value pairs'],
  ['Set.of', 'a fixed set of these items'],
  ['Optional', 'a value that might be missing'],
  ['Optional.of', 'wrap a value that is definitely there'],
  ['Optional.ofNullable', 'wrap a value that might be null'],
  ['Optional.empty', 'an Optional holding nothing'],
  ['isPresent', 'is there a value inside?'],
  ['orElse', 'the value, or this fallback'],
  ['ifPresent', 'do something only if there is a value'],
  ['stream', 'start a pipeline over the items'],
  ['map', 'transform every item'],
  ['filter', 'keep only the items that pass a test'],
  ['collect', 'gather the pipeline back into a collection'],
  ['forEach', 'do something with each item'],
  ['reduce', 'combine every item into one'],
  ['count', 'how many items'],
  ['sorted', 'the items in order'],
  ['toList', 'gather the pipeline into a list'],
  ['Collectors', 'ready-made ways to gather a stream'],
  ['Collectors.toList', 'gather into a list'],
  ['Collectors.joining', 'glue the pieces into one String'],
  ['Collectors.groupingBy', 'group items by a key'],
  ['isBlank', 'is it empty or only spaces?'],
  ['strip', 'remove spaces at both ends'],
  ['repeat', 'the text repeated n times'],
  ['lines', 'split the text into its lines'],
  ['formatted', 'fill in the blanks, like printf'],
]

const PYTHON_API: readonly (readonly [string, string])[] = [
  ['print', 'show something'],
  ['input', 'ask the user for something'],
  ['len', 'how many'],
  ['range', 'a run of numbers'],
  ['str', 'as text'],
  ['int', 'as a whole number'],
  ['float', 'as a decimal number'],
  ['bool', 'as True or False'],
  ['list', 'as a list'],
  ['dict', 'as pairs of key and value'],
  ['set', 'as a set, with no repeats'],
  ['tuple', 'as a tuple that cannot change'],
  ['sum', 'add them all up'],
  ['min', 'the smallest'],
  ['max', 'the largest'],
  ['abs', 'distance from zero'],
  ['round', 'to the nearest whole number'],
  ['sorted', 'in order'],
  ['reversed', 'back to front'],
  ['enumerate', 'each item with its position'],
  ['zip', 'pair two lists up'],
  ['type', 'what kind of thing is this'],
  ['isinstance', 'is it this kind of thing?'],
  ['upper', 'ALL CAPITALS'],
  ['lower', 'all lower case'],
  ['strip', 'remove spaces at both ends'],
  ['split', 'break text into pieces'],
  ['join', 'glue pieces together'],
  ['replace', 'swap one piece for another'],
  ['startswith', 'does it start with this?'],
  ['endswith', 'does it end with this?'],
  ['find', 'where this appears, or -1'],
  ['format', 'fill in the blanks'],
  ['append', 'add to the end of a list'],
  ['extend', 'add all of another list'],
  ['insert', 'add at a position'],
  ['pop', 'take the last one out'],
  ['sort', 'put a list in order'],
  ['reverse', 'turn a list back to front'],
  ['index', 'where an item is'],
  ['count', 'how many times it appears'],
  ['keys', 'all the keys'],
  ['values', 'all the values'],
  ['items', 'every key and value'],
  ['get', 'the value for a key'],
  ['update', 'merge in more pairs'],
  ['self', 'this object, inside a class'],
  ['__init__', 'set a new object up'],
]

/** Offered as `math.sqrt` so the fuzzy matcher still finds plain `sqrt`;
 *  `apply` inserts `import math` if the file doesn't have it yet. */
const PYTHON_MODULE_API: readonly (readonly [string, string, string])[] = [
  ['sqrt', 'math', 'square root'],
  ['floor', 'math', 'round down'],
  ['ceil', 'math', 'round up'],
  ['factorial', 'math', 'n!'],
  ['gcd', 'math', 'greatest common divisor'],
  ['randint', 'random', 'a random whole number from a to b'],
  ['choice', 'random', 'a random item from a list'],
  ['shuffle', 'random', 'mix a list randomly, in place'],
  ['uniform', 'random', 'a random decimal in a range'],
]

/* ------------------------------------------------------------ built-in docs */

/**
 * Shared verbatim between hoverDocs.ts's hover card and the completion info
 * panel. Keyed by bare name (`println`), or by `Receiver.name` (`Math.abs`)
 * where the name is only ever written qualified — `builtinDoc` tries that first.
 */
export interface BuiltinDoc {
  /** The call shape, rendered in --font-code. */
  signature: string
  /** One or two sentences, student voice (copy.ts's tone rules). */
  doc: string
  /** A one-line example, only where it earns its place. */
  example?: string
}

const d = (signature: string, doc: string, example?: string): BuiltinDoc => ({ signature, doc, example })

export const JAVA_DOCS: Record<string, BuiltinDoc> = {
  println: d('System.out.println(value)', 'Prints the value, then moves to the next line.', 'System.out.println("Hello!");'),
  print: d('System.out.print(value)', 'Prints the value and stays on the same line — the next print carries on right after it.'),
  printf: d('System.out.printf(format, values…)', 'Prints text with blanks filled in: %s for text, %d for whole numbers, %.2f for two decimals, %n for a new line.', 'System.out.printf("Hi %s, you are %d%n", name, age);'),
  Scanner: d('new Scanner(System.in)', 'Reads what the user types. Make one, then ask it for a line, a word or a number.', 'Scanner sc = new Scanner(System.in);'),
  nextLine: d('sc.nextLine() → String', 'Reads one whole line — everything the user typed before pressing Enter.'),
  nextInt: d('sc.nextInt() → int', 'Reads a whole number. If the user types something that is not a number, the program stops with an error.'),
  nextDouble: d('sc.nextDouble() → double', 'Reads a decimal number, like 3.5.'),
  next: d('sc.next() → String', 'Reads one word — it stops at the first space.'),
  hasNextLine: d('sc.hasNextLine() → boolean', 'True while there is another line waiting to be read.'),
  hasNextInt: d('sc.hasNextInt() → boolean', 'True if the next thing waiting is a whole number — check this before nextInt.'),
  close: d('sc.close()', 'Tells the Scanner you are done reading. Usually the last line of main.'),
  String: d('String name = "text"', 'A piece of text, wrapped in double quotes. Compare two with equals, not ==.'),
  length: d('text.length() → int', 'How many characters the text has, spaces included.', '"hello".length()  // 5'),
  charAt: d('text.charAt(i) → char', 'The character at position i. Positions start at 0, so charAt(0) is the first one.'),
  substring: d('text.substring(start, end) → String', 'A piece of the text, from start up to — but not including — end.', '"warsha".substring(0, 3)  // "war"'),
  equals: d('a.equals(b) → boolean', 'True when the two values are exactly the same. Use this for text — == asks a different question.'),
  equalsIgnoreCase: d('a.equalsIgnoreCase(b) → boolean', 'The same check, ignoring capitals: "Yes" matches "yes".'),
  toUpperCase: d('text.toUpperCase() → String', 'A copy of the text in ALL CAPITALS. The original does not change.'),
  toLowerCase: d('text.toLowerCase() → String', 'A copy of the text in all lower case. The original does not change.'),
  trim: d('text.trim() → String', 'A copy with the spaces at both ends removed — handy on what a user typed.'),
  split: d('text.split(separator) → String[]', 'Breaks the text into pieces at every separator, and gives you them as an array.', '"a,b,c".split(",")  // ["a", "b", "c"]'),
  contains: d('text.contains(piece) → boolean', 'True if the piece appears anywhere in the text.'),
  indexOf: d('text.indexOf(piece) → int', 'Where the piece first appears, counting from 0 — or -1 if it is not there.'),
  replace: d('text.replace(old, new) → String', 'A copy with every old piece swapped for the new one.'),
  isEmpty: d('text.isEmpty() → boolean', 'True when there is nothing in it at all.'),
  startsWith: d('text.startsWith(piece) → boolean', 'True if the text begins with that piece.'),
  endsWith: d('text.endsWith(piece) → boolean', 'True if the text ends with that piece.'),
  toString: d('thing.toString() → String', 'The thing as text — useful for printing it.'),
  'String.valueOf': d('String.valueOf(x) → String', 'Turns a number (or anything else) into text.'),
  'Integer.parseInt': d('Integer.parseInt(text) → int', 'Turns text like "42" into the number 42, so you can do math with it.', 'int age = Integer.parseInt(sc.nextLine());'),
  'Double.parseDouble': d('Double.parseDouble(text) → double', 'Turns text like "3.5" into the decimal number 3.5.'),
  Math: d('Math', 'Ready-made math helpers. You never make a Math — just call Math.sqrt, Math.max and friends directly.'),
  'Math.abs': d('Math.abs(x)', 'The distance from zero: Math.abs(-5) is 5.'),
  'Math.max': d('Math.max(a, b)', 'The larger of the two.'),
  'Math.min': d('Math.min(a, b)', 'The smaller of the two.'),
  'Math.pow': d('Math.pow(base, exponent) → double', 'base to the power of exponent: Math.pow(2, 10) is 1024.'),
  'Math.sqrt': d('Math.sqrt(x) → double', 'The square root: Math.sqrt(16) is 4.'),
  'Math.round': d('Math.round(x) → long', 'x to the nearest whole number: 2.6 becomes 3.'),
  'Math.random': d('Math.random() → double', 'A random decimal from 0 up to (but never quite) 1. Scale it up for bigger ranges.', 'int dice = (int) (Math.random() * 6) + 1;'),
  ArrayList: d('new ArrayList<Type>()', 'A list that grows as you add to it. Say what goes inside between the < >.', 'ArrayList<String> names = new ArrayList<>();'),
  add: d('list.add(item)', 'Puts the item at the end of the list.'),
  get: d('list.get(i)', 'The item at position i. Positions start at 0.'),
  set: d('list.set(i, item)', 'Replaces the item at position i with a new one.'),
  size: d('list.size() → int', 'How many items the list holds right now.'),
  remove: d('list.remove(i)', 'Takes the item at position i out. Everything after it moves up one place.'),
  HashMap: d('new HashMap<Key, Value>()', 'Stores pairs: look something up by its key, get its value back.', 'HashMap<String, Integer> ages = new HashMap<>();'),
  put: d('map.put(key, value)', 'Stores the value under that key. Using the same key again replaces the old value.'),
  containsKey: d('map.containsKey(key) → boolean', 'True if something is stored under that key.'),
  getMessage: d('e.getMessage() → String', 'What went wrong, as text — the useful line inside a catch block.'),
  Random: d('new Random()', 'A source of random numbers. Make one, then ask it with nextInt.', 'Random r = new Random();'),
  StringBuilder: d('new StringBuilder()', 'Text you build up piece by piece with append — faster than + in a loop.'),
  append: d('sb.append(x)', 'Adds x onto the end of the text being built.'),
  'Arrays.sort': d('Arrays.sort(array)', 'Puts the array in order, smallest first. Changes the array itself.'),
  'Arrays.toString': d('Arrays.toString(array) → String', 'The whole array as readable text, like [1, 2, 3] — printing an array directly shows gibberish.'),
  'Collections.sort': d('Collections.sort(list)', 'Puts the list in order, smallest first. Changes the list itself.'),
  // Modern Java (9–17).
  var: d('var name = value;', 'Lets Java work out the type from the value on the right, so you do not write it twice. Local variables only — the type is still fixed once set.', 'var names = new ArrayList<String>();'),
  'List.of': d('List.of(a, b, c) → List', 'A ready-made list of exactly these items — quick to write and safe to read, but fixed: you cannot add to it or remove from it.', 'var days = List.of("Sat", "Sun");'),
  'Map.of': d('Map.of(k1, v1, k2, v2) → Map', 'A ready-made map of these key/value pairs. Fixed — good for a lookup table you will not change.'),
  'Set.of': d('Set.of(a, b, c) → Set', 'A ready-made set of these items, with no repeats. Fixed.'),
  Optional: d('Optional<Type>', 'A box that either holds a value or is empty — a clear way to say "there might be nothing here" instead of returning null.'),
  'Optional.of': d('Optional.of(value) → Optional', 'Wraps a value that is definitely there. Throws if you hand it null — use ofNullable when null is possible.'),
  'Optional.ofNullable': d('Optional.ofNullable(value) → Optional', 'Wraps a value that might be null: you get an empty Optional back instead of a crash.'),
  'Optional.empty': d('Optional.empty() → Optional', 'An Optional with nothing inside.'),
  isPresent: d('opt.isPresent() → boolean', 'True when the Optional holds a value.'),
  orElse: d('opt.orElse(fallback)', 'The value inside — or the fallback you give, when it is empty.'),
  ifPresent: d('opt.ifPresent(value -> …)', 'Runs your code with the value, but only if there is one.'),
  stream: d('list.stream() → Stream', 'Starts a pipeline over the items. Chain map, filter and collect onto it, then gather the result at the end.', 'names.stream().filter(n -> n.length() > 3).toList();'),
  map: d('stream.map(x -> …) → Stream', 'Transforms every item into something new, keeping the same count.', '.map(n -> n.toUpperCase())'),
  filter: d('stream.filter(x -> …) → Stream', 'Keeps only the items for which your test is true; drops the rest.', '.filter(n -> n > 0)'),
  collect: d('stream.collect(Collectors.toList())', 'Gathers a pipeline back into a real collection at the end.'),
  forEach: d('list.forEach(x -> …)', 'Does something with each item in turn — a shorter for-each loop.'),
  reduce: d('stream.reduce(start, (a, b) -> …)', 'Folds every item into a single value, like adding them all up.'),
  count: d('stream.count() → long', 'How many items made it to the end of the pipeline.'),
  sorted: d('stream.sorted() → Stream', 'The items in order. Pass a Comparator for a custom order.'),
  toList: d('stream.toList() → List', 'Gathers the pipeline straight into a fixed List (Java 16+).'),
  Collectors: d('Collectors', 'Ready-made recipes for the end of a stream — collect(Collectors.toList()), joining, groupingBy.'),
  'Collectors.toList': d('Collectors.toList()', 'Gathers a stream into a List. Handed to collect(…).'),
  'Collectors.joining': d('Collectors.joining(", ")', 'Glues a stream of texts into one String, with your separator between them.'),
  'Collectors.groupingBy': d('Collectors.groupingBy(x -> key)', 'Sorts items into a Map of lists, keyed by whatever you return.'),
  isBlank: d('text.isBlank() → boolean', 'True when the text is empty or only spaces (Java 11+).'),
  strip: d('text.strip() → String', 'A copy with the spaces trimmed off both ends — the Unicode-aware trim (Java 11+).'),
  repeat: d('text.repeat(n) → String', 'The text joined to itself n times: "ab".repeat(3) is "ababab" (Java 11+).'),
  lines: d('text.lines() → Stream', 'Splits the text into its lines, as a stream (Java 11+).'),
  formatted: d('text.formatted(values…) → String', 'Fills the blanks in the text, like printf: "Hi %s".formatted(name) (Java 15+).'),
}

export const PYTHON_DOCS: Record<string, BuiltinDoc> = {
  print: d('print(value, …)', 'Shows the value in the console, then moves to the next line. Give it several values and they come out separated by spaces.', 'print("Hello!")'),
  input: d('input(prompt) → str', 'Shows the prompt and waits for the user to type a line. What comes back is always text — wrap it in int() if you need a number.', 'name = input("What is your name? ")'),
  range: d('range(start, stop)', 'The numbers from start up to — but not including — stop. With one value it starts at 0: range(5) is 0, 1, 2, 3, 4.', 'for i in range(5):'),
  len: d('len(x) → int', 'How many things are in it — characters in text, items in a list.', 'len("hello")  # 5'),
  str: d('str(x) → str', 'x as text. Numbers need this before you can glue them onto other text with +.'),
  int: d('int(x) → int', 'x as a whole number. The usual wrap around input() when you asked for a number.', 'age = int(input("Age? "))'),
  float: d('float(x) → float', 'x as a decimal number, like 3.5.'),
  bool: d('bool(x) → bool', 'x as True or False. Empty things and zero count as False.'),
  list: d('list(x) → list', 'x as a list you can change — handy on a range or a string.'),
  dict: d('dict()', 'Pairs of key and value: look something up by its key, get its value back.', 'ages = {"Sara": 19}'),
  tuple: d('tuple(x) → tuple', 'x as a tuple — like a list, but it cannot change afterwards.'),
  set: d('set(x) → set', 'x as a set: no repeats, no order. Good for "have I seen this before?"'),
  sum: d('sum(numbers)', 'Adds them all up.', 'sum([1, 2, 3])  # 6'),
  min: d('min(values)', 'The smallest of them.'),
  max: d('max(values)', 'The largest of them.'),
  abs: d('abs(x)', 'The distance from zero: abs(-5) is 5.'),
  round: d('round(x, digits) → number', 'x to the nearest whole number — or give digits to keep some decimals.', 'round(3.14159, 2)  # 3.14'),
  sorted: d('sorted(items) → list', 'A new list with the items in order, smallest first. The original stays as it was.'),
  reversed: d('reversed(items)', 'The items back to front. Wrap it in list() to see them.'),
  enumerate: d('enumerate(items)', 'Each item together with its position — for loops that need both.', 'for i, name in enumerate(names):'),
  zip: d('zip(a, b)', 'Pairs two lists up: the first of each, then the second of each, and so on.'),
  type: d('type(x)', 'What kind of thing x is — str, int, list… Good for detective work.'),
  isinstance: d('isinstance(x, kind) → bool', 'True if x is that kind of thing: isinstance(x, int).'),
  upper: d('text.upper() → str', 'A copy of the text in ALL CAPITALS. The original does not change.'),
  lower: d('text.lower() → str', 'A copy of the text in all lower case. The original does not change.'),
  strip: d('text.strip() → str', 'A copy with the spaces at both ends removed — handy on what a user typed.'),
  split: d('text.split(separator) → list', 'Breaks the text into pieces — at spaces, or at the separator you give it.', '"a,b,c".split(",")  # ["a", "b", "c"]'),
  join: d('glue.join(pieces) → str', 'Glues a list of texts together, with the glue between each pair.', '", ".join(names)'),
  replace: d('text.replace(old, new) → str', 'A copy with every old piece swapped for the new one.'),
  find: d('text.find(piece) → int', 'Where the piece first appears, counting from 0 — or -1 if it is not there.'),
  startswith: d('text.startswith(piece) → bool', 'True if the text begins with that piece.'),
  endswith: d('text.endswith(piece) → bool', 'True if the text ends with that piece.'),
  format: d('text.format(values…) → str', 'Fills the {} blanks in the text with your values. An f-string does the same with less typing: f"Hi {name}".'),
  append: d('items.append(x)', 'Adds x to the end of the list.'),
  extend: d('items.extend(more)', 'Adds every item of another list onto the end of this one.'),
  insert: d('items.insert(i, x)', 'Puts x in at position i. Everything from there on moves along one place.'),
  pop: d('items.pop() → item', 'Takes the last item out and hands it to you. Give a position to take that one instead.'),
  sort: d('items.sort()', 'Puts the list in order, smallest first. Changes the list itself — sorted() makes a copy instead.'),
  reverse: d('items.reverse()', 'Turns the list back to front, in place.'),
  index: d('items.index(x) → int', 'Where x first appears in the list, counting from 0.'),
  count: d('items.count(x) → int', 'How many times x appears.'),
  keys: d('pairs.keys()', 'All the keys in the dictionary — loop over them with for.'),
  values: d('pairs.values()', 'All the values in the dictionary.'),
  items: d('pairs.items()', 'Every key and value together — for loops that need both.', 'for name, age in ages.items():'),
  get: d('pairs.get(key, fallback)', 'The value stored under the key — or the fallback (normally None) instead of an error when the key is missing.'),
  update: d('pairs.update(other)', 'Merges another dictionary in. Keys that already exist get the new values.'),
  self: d('self', 'The object the method was called on. Always the first parameter of a method inside a class.'),
  __init__: d('def __init__(self, …):', 'Runs when a new object is made — the place to set up its starting values.', 'def __init__(self, name):\n    self.name = name'),
  'math.sqrt': d('math.sqrt(x) → float', 'The square root: math.sqrt(16) is 4.0. Needs import math.'),
  'math.floor': d('math.floor(x) → int', 'x rounded down to a whole number: 3.9 becomes 3.'),
  'math.ceil': d('math.ceil(x) → int', 'x rounded up to a whole number: 3.1 becomes 4.'),
  'math.pi': d('math.pi', 'The number π, 3.14159… Needs import math.'),
  'random.randint': d('random.randint(a, b) → int', 'A random whole number from a to b — both ends included. Needs import random.', 'dice = random.randint(1, 6)'),
  'random.choice': d('random.choice(items)', 'One random item from the list.'),
  'random.shuffle': d('random.shuffle(items)', 'Mixes the list into a random order, in place.'),
  'random.random': d('random.random() → float', 'A random decimal from 0 up to (but never quite) 1.'),
  'random.uniform': d('random.uniform(a, b) → float', 'A random decimal between a and b.'),
}

const BUILTIN_DOCS: Record<CompletionLang, Record<string, BuiltinDoc>> = {
  java: JAVA_DOCS,
  python: PYTHON_DOCS,
}

/** Tries the qualified spelling first (`Math` + `abs` → `Math.abs`), then the
 *  bare name. Null means no card — nothing to say, nothing shown. */
export function builtinDoc(lang: CompletionLang, word: string, receiver?: string): BuiltinDoc | null {
  const docs = BUILTIN_DOCS[lang]
  return (receiver ? docs[`${receiver}.${word}`] : undefined) ?? docs[word] ?? null
}

/** The same doc a completion label maps to (`System.out.println` → `println`). */
function docForLabel(lang: CompletionLang, label: string): BuiltinDoc | null {
  return BUILTIN_DOCS[lang][label] ?? BUILTIN_DOCS[lang][label.slice(label.lastIndexOf('.') + 1)] ?? null
}

/**
 * Shared DOM between the hover widget and completion info panel, so they
 * can't drift apart. Styled by `chromeTheme` in setup.ts (`.cm-docs-*`).
 * `boldLead` bolds the first sentence, for user doc comments.
 */
export function renderDocCard(entry: BuiltinDoc, opts?: { boldLead?: boolean }): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-docs'
  const sig = root.appendChild(document.createElement('div'))
  sig.className = 'cm-docs-signature'
  sig.textContent = entry.signature
  const body = root.appendChild(document.createElement('div'))
  body.className = 'cm-docs-body'
  const lead = opts?.boldLead ? /^[\s\S]*?[.!?](?=\s|$)/.exec(entry.doc) : null
  if (lead) {
    const strong = body.appendChild(document.createElement('strong'))
    strong.textContent = lead[0]
    body.appendChild(document.createTextNode(entry.doc.slice(lead[0].length)))
  } else {
    body.textContent = entry.doc
  }
  if (entry.example) {
    const ex = root.appendChild(document.createElement('div'))
    ex.className = 'cm-docs-example'
    ex.textContent = entry.example
  }
  return root
}

/* ------------------------------------------------------------------- sources */

const WORD_BEFORE = /[\w$]+/
/** Words shorter than this are noise; they match half the file. */
const MIN_IDENT_CHARS = 2

/** The docs card as a completion's `info` panel — the same card the hover shows. */
const docInfo = (lang: CompletionLang, label: string): Pick<Completion, 'info'> => {
  const entry = docForLabel(lang, label)
  return entry ? { info: () => renderDocCard(entry) } : {}
}

/** A dictionary class that needs an import gets one attached to its completion, in the same edit.
 *  A qualified static call (`List.of`, `Collectors.toList`) imports its leading class too. */
const javaApiCompletion = (label: string, detail: string, type: string): Completion => {
  const owner = label.includes('.') ? label.slice(0, label.lastIndexOf('.')) : label
  const fqcn = JAVA_IMPORTS[owner]
  if (!fqcn) return { label, detail, type, boost: 10, ...docInfo('java', label) }
  return {
    label,
    detail: `${detail} — auto-imports ${fqcn}`,
    type,
    boost: 10,
    apply: applyWithImport((s) => importInsertion(s, fqcn)),
    ...docInfo('java', label),
  }
}

/** `sqrt` → the completion is `math.sqrt`, and accepting it also inserts `import math` if needed. */
const pythonModuleCompletion = ([label, module, detail]: readonly [string, string, string]): Completion => ({
  label: `${module}.${label}`,
  detail: `${detail} — auto-imports ${module}`,
  type: 'function',
  boost: 10,
  apply: applyWithImport((s) => pyImportInsertion(s, module)),
  ...docInfo('python', `${module}.${label}`),
})

const staticOptions = (lang: CompletionLang): Completion[] => {
  const api = lang === 'java' ? JAVA_API : PYTHON_API
  const snippets = lang === 'java' ? JAVA_SNIPPETS : PYTHON_SNIPPETS
  const apiCompletions = api.map(([label, detail]): Completion => {
    const type = label.includes('.') ? 'method' : /^[A-Z]/.test(label) ? 'class' : 'function'
    return lang === 'java'
      ? javaApiCompletion(label, detail, type)
      : { label, detail, type, boost: 10, ...docInfo('python', label) }
  })
  return [
    ...snippets,
    ...apiCompletions,
    ...(lang === 'python' ? PYTHON_MODULE_API.map(pythonModuleCompletion) : []),
    ...KEYWORDS[lang].map((label): Completion => ({ label, type: 'keyword', boost: 20 })),
  ]
}

/* ------------------------------------------------- what the situation wants */

const IDENT = /[A-Za-z_$][\w$]*/g

/** Names the dictionary already owns (keywords + the bare API names). We never
 *  surface these as bare identifiers, so the documented, higher-ranked completion
 *  always stands for them — a scanned `println` must not shadow the real one. */
const RESERVED: Record<CompletionLang, ReadonlySet<string>> = {
  java: reservedFor('java'),
  python: reservedFor('python'),
}
function reservedFor(lang: CompletionLang): Set<string> {
  const s = new Set<string>(KEYWORDS[lang])
  for (const [label] of lang === 'java' ? JAVA_API : PYTHON_API) s.add(label.slice(label.lastIndexOf('.') + 1))
  if (lang === 'python') for (const [label] of PYTHON_MODULE_API) s.add(label)
  return s
}

/** Keywords that only ever open a statement — never valid where a value goes, so
 *  they (and every statement snippet) are withheld mid-expression. */
const STATEMENT_ONLY: Record<CompletionLang, ReadonlySet<string>> = {
  java: new Set(
    'class interface enum extends implements permits sealed package import public private protected abstract static final void'.split(
      ' ',
    ),
  ),
  python: new Set('def class import from pass global nonlocal del elif except finally as with assert raise async await'.split(' ')),
}

type IdentRole = 'variable' | 'function' | 'class'

/** Best-effort "this name was declared here", for the icon and a small ranking
 *  nudge. Reads text before the caret; a false positive only ever nudges ranking. */
function declaredNames(lang: CompletionLang, doc: string): Map<string, IdentRole> {
  const out = new Map<string, IdentRole>()
  const add = (name: string, role: IdentRole) => {
    if (name && !out.has(name)) out.set(name, role)
  }
  if (lang === 'java') {
    const T = '(?:int|long|short|byte|double|float|boolean|char|String|var|[A-Z][A-Za-z0-9_$]*)'
    for (const m of doc.matchAll(/\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'class')
    // `Type name` in a declaration / parameter / for-each (the name is followed by = ; , ) or :).
    for (const m of doc.matchAll(new RegExp(`\\b${T}(?:<[^<>;{}()]*>)?(?:\\[\\])?\\s+([a-z_$][\\w$]*)\\s*(?=[=;,):])`, 'g')))
      add(m[1], 'variable')
    // `returnType name(` — a method declaration (a preceding type rules out a bare call).
    for (const m of doc.matchAll(new RegExp(`\\b${T}(?:<[^<>;{}()]*>)?(?:\\[\\])?\\s+([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')))
      if (!out.has(m[1])) add(m[1], 'function')
  } else {
    for (const m of doc.matchAll(/\bdef\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'function')
    for (const m of doc.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1], 'class')
    for (const m of doc.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*(?:[-+*/%|&^@]|\/\/|\*\*|>>|<<)?=(?!=)/gm)) add(m[1], 'variable')
    for (const m of doc.matchAll(/\bfor\s+([A-Za-z_$][\w$]*)\s+in\b/g)) add(m[1], 'variable')
    for (const m of doc.matchAll(/\bdef\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g))
      for (const p of m[1].split(',')) {
        const n = p.trim().split(/[:=]/)[0].trim()
        if (n && n !== 'self' && /^[A-Za-z_$][\w$]*$/.test(n)) add(n, 'variable')
      }
  }
  return out
}

/** Nearer the caret is likelier what you want. Distance is in characters, so it
 *  needs no line math; a name only seen after the caret gets nothing. */
function proximityBonus(dist: number): number {
  return dist <= 40 ? 10 : dist <= 200 ? 7 : dist <= 600 ? 4 : dist <= 2000 ? 2 : 0
}

/** Is the caret inside an expression (after `=`, `(`, a comma or an operator)?
 *  Only the confident cases flip; everything else stays "statement position", so
 *  the full keyword/snippet set still shows and nothing wanted is ever hidden. */
function inExpression(state: EditorState, wordFrom: number): boolean {
  const line = state.doc.lineAt(wordFrom)
  const pre = state.sliceDoc(line.from, wordFrom).replace(/\s+$/, '')
  return pre !== '' && '=(,[+-*/%<>!&|?~^'.includes(pre[pre.length - 1])
}

const suppressedInExpression = (lang: CompletionLang, o: Completion): boolean =>
  o.type === 'snippet' || (o.type === 'keyword' && STATEMENT_ONLY[lang].has(o.label))

/** Snippets, keywords and the API dictionary. Fires from the first character,
 *  since an abbreviation only pays off before you finish typing it. Steps aside in
 *  a `.` context, and drops declaration-only keywords / snippets mid-expression. */
function staticSource(lang: CompletionLang): CompletionSource {
  const all = staticOptions(lang)
  const full = completeFromList(all)
  const expr = completeFromList(all.filter((o) => !suppressedInExpression(lang, o)))
  return (ctx: CompletionContext) => {
    if (memberContext(ctx.state, ctx.pos)) return null
    const before = ctx.matchBefore(WORD_BEFORE)
    if (!ctx.explicit && !before) return null
    return inExpression(ctx.state, before ? before.from : ctx.pos) ? expr(ctx) : full(ctx)
  }
}

/**
 * Every identifier you have written, ranked by how likely you want it *here*:
 * nearer the caret beats farther, a name declared in this file beats a bare word,
 * this file beats the rest of the project. Doubles as the member source's fallback
 * when a receiver's type can't be guessed.
 */
function makeIdentifierCollector(
  lang: CompletionLang | null,
  projectWords: () => readonly string[],
): (ctx: CompletionContext) => CompletionResult | null {
  const reserved = lang ? RESERVED[lang] : null
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(WORD_BEFORE)
    if (!before || (before.to === before.from && !ctx.explicit)) return null
    if (!ctx.explicit && before.to - before.from < MIN_IDENT_CHARS) return null

    const cursor = before.from
    const doc = ctx.state.doc.sliceString(0)
    const declared = lang ? declaredNames(lang, doc.slice(0, cursor)) : null

    // name -> nearest distance (chars) of an occurrence *before* the caret; a name
    // only seen after the caret lands at Infinity — offered, but no proximity.
    const nearest = new Map<string, number>()
    let m: RegExpExecArray | null
    IDENT.lastIndex = 0
    while ((m = IDENT.exec(doc))) {
      const w = m[0]
      if (w.length <= 2) continue
      if (m.index < cursor) {
        const d = cursor - m.index
        const prev = nearest.get(w)
        if (prev === undefined || d < prev) nearest.set(w, d)
      } else if (!nearest.has(w)) {
        nearest.set(w, Infinity)
      }
    }
    // The half-typed word itself is never a useful suggestion.
    nearest.delete(before.text)

    const options: Completion[] = []
    for (const [w, dist] of nearest) {
      if (reserved?.has(w)) continue
      const role: IdentRole = declared?.get(w) ?? (/^[A-Z]/.test(w) ? 'class' : 'variable')
      const boost = Math.min(4 + (declared?.has(w) ? 8 : 0) + proximityBonus(dist), 24)
      options.push({ label: w, type: role, boost })
    }
    // The rest of the project: a faint, flat boost, and only names not already local.
    for (const w of projectWords()) {
      if (w.length <= 2 || w === before.text || nearest.has(w) || reserved?.has(w)) continue
      nearest.set(w, 0) // mark seen so a word shared by two files isn't offered twice
      options.push({ label: w, type: /^[A-Z]/.test(w) ? 'class' : 'variable', boost: 1 })
    }

    return { from: before.from, options, validFor: /^[\w$]*$/ }
  }
}

/** Pull identifiers out of arbitrary source text — used across the project. */
export function wordsInSource(text: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  IDENT.lastIndex = 0
  while ((m = IDENT.exec(text))) if (m[0].length > 2) out.push(m[0])
  return out
}

/** Node types where a popup is never wanted — typing a sentence inside
 *  `println("...")` shouldn't offer `nextDouble`. */
const NOT_IN = ['String', 'TemplateString', 'FormatString', 'Comment', 'LineComment', 'BlockComment']

export function completionSources(lang: CompletionLang | null, projectWords: () => readonly string[]): CompletionSource[] {
  const collect = makeIdentifierCollector(lang, projectWords)
  // In a `.` context the member source owns the popup; the plain identifier source
  // stands down (the member source itself calls `collect` as its own fallback).
  const ident = ifNotIn(NOT_IN, (ctx: CompletionContext) =>
    lang && memberContext(ctx.state, ctx.pos) ? null : collect(ctx),
  )
  if (!lang) return [ident]
  return [
    ifNotIn(NOT_IN, memberSource(lang, collect)),
    ifNotIn(NOT_IN, importStatementSource(lang)),
    ifNotIn(NOT_IN, staticSource(lang)),
    ident,
  ]
}
