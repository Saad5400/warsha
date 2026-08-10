import {
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
import { recordable, withUsageBoost } from './usage'

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
 * On top of that, ranking reads the situation: statement snippets and
 * declaration-only keywords show only at the start of a statement. Mid-expression
 * (after `=`, `(`, a comma or an operator) they are withheld, the way VS Code
 * won't offer `class` inside `int x = …` — and so are they while you name a
 * variable after its type (`Scanner sc…`), where `scanner` would otherwise
 * outrank the name and paste `Scanner …` a second time.
 *
 * On top of *that*, the popup learns: accepting a completion bumps a per-label
 * counter (usage.ts), and a small bounded boost from that counter is added on
 * every later query — so a student's own habits settle the ties. Pick `sout` a
 * couple of times and it leads `souf` the next time you type `sou`. The boost is
 * capped well below a single fuzzy-match step, so it only reorders options that
 * already match about equally well; it never floats a worse match up the list.
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
  snip('switchy', 'String ${size} = switch (${count}) {\n\tcase 0 -> "${none}";\n\tdefault -> "${many}";\n};', 'a switch that returns a value'),
  snip('text', '"""\n${}\n"""', 'a multi-line text block'),
  // Control flow & structure (IntelliJ live-template abbreviations).
  snip('if', 'if (${condition}) {\n\t${}\n}', 'if'),
  snip('do', 'do {\n\t${}\n} while (${condition});', 'do / while'),
  snip('interface', 'interface ${Name} {\n\t${}\n}', 'an interface'),
  snip('enum', 'enum ${Name} {\n\t${VALUES}\n}', 'a fixed set of named values'),
  snip('ctor', 'public ${ClassName}(${}) {\n\t${}\n}', 'a constructor'),
  snip('arr', '${int}[] ${name} = new ${int}[${size}];', 'a fixed-size array'),
  snip('array', '${int}[] ${name} = {${}};', 'a new array with values'),
  snip('soutv', 'System.out.println("${name} = " + ${name});', 'print a variable with its name'),
  snip('psfs', 'public static final String ${NAME} = ${"value"};', 'a String constant'),
  snip('psfi', 'public static final int ${NAME} = ${0};', 'an int constant'),
  snip('mainsc', 'public static void main(String[] args) {\n\tScanner ${sc} = new Scanner(System.in);\n\t${}\n}', 'main with a Scanner ready'),
  // Accessors & overrides (what IntelliJ makes with Alt+Insert).
  snip('getter', 'public ${Type} get${Name}() {\n\treturn ${field};\n}', 'a getter method'),
  snip('setter', 'public void set${Name}(${Type} ${value}) {\n\tthis.${field} = ${value};\n}', 'a setter method'),
  snip('toString', '@Override\npublic String toString() {\n\treturn ${"..."};\n}', 'a toString override'),
  snip('equals', '@Override\npublic boolean equals(Object o) {\n\tif (this == o) return true;\n\tif (o == null || getClass() != o.getClass()) return false;\n\t${ClassName} other = (${ClassName}) o;\n\treturn ${};\n}', 'an equals override'),
  snip('hashCode', '@Override\npublic int hashCode() {\n\treturn Objects.hash(${fields});\n}', 'a hashCode override'),
  // Functional & modern Java.
  snip('lambda', '(${args}) -> ${}', 'a lambda'),
  snip('fic', '@FunctionalInterface\ninterface ${Name} {\n\t${Type} ${method}(${});\n}', 'a functional interface'),
  snip('foreachl', '${items}.forEach(${item} -> System.out.println(${item}));', 'run a lambda on each item'),
  snip('streamp', '${items}.stream()\n\t.filter(${x} -> ${true})\n\t.map(${x} -> ${x})\n\t.collect(Collectors.toList());', 'filter, map, then collect'),
  snip('comparator', '${items}.sort(Comparator.comparing(${p} -> ${p.getKey()}));', 'sort by a key'),
  snip('optional', 'Optional<${String}> ${result} = Optional.ofNullable(${value});\n${result}.ifPresent(${v} -> ${});', 'a value that might be missing'),
  snip('recordc', 'record ${Point}(${int x}, ${int y}) {\n\t${Point} {\n\t\tif (${x < 0}) {\n\t\t\tthrow new IllegalArgumentException("${must be positive}");\n\t\t}\n\t}\n}', 'a record that checks its values'),
  snip('sealedi', 'sealed interface ${Shape} permits ${Circle}, ${Square} {\n\t${}\n}', 'a type with a fixed set of subtypes'),
  // Errors & files.
  snip('throwex', 'throw new ${IllegalArgumentException}("${message}");${}', 'stop with an error'),
  snip('customex', 'class ${MyException} extends ${Exception} {\n\t${MyException}(String message) {\n\t\tsuper(message);\n\t}\n}', 'your own exception type'),
  snip('tryr', 'try (${BufferedReader br} = new BufferedReader(new FileReader("${data.txt}"))) {\n\t${}\n} catch (IOException e) {\n\tSystem.out.println(e.getMessage());\n}', 'open a resource and close it for you'),
  snip('readfile', 'try (BufferedReader ${br} = new BufferedReader(new FileReader("${data.txt}"))) {\n\tString ${line};\n\twhile ((${line} = ${br}.readLine()) != null) {\n\t\t${}\n\t}\n} catch (IOException e) {\n\tSystem.out.println(e.getMessage());\n}', 'read a file line by line'),
  snip('writefile', 'try (PrintWriter ${pw} = new PrintWriter(new FileWriter("${out.txt}"))) {\n\t${pw}.println(${});\n} catch (IOException e) {\n\tSystem.out.println(e.getMessage());\n}', 'write to a file'),
  snip('readlines', 'List<String> ${lines} = Files.readAllLines(Paths.get("${data.txt}"));\nfor (String ${line} : ${lines}) {\n\t${}\n}', 'read every line of a file'),
  snip('scanfile', 'Scanner ${sc} = new Scanner(new File("${data.txt}"));\nwhile (${sc}.hasNextLine()) {\n\t${}\n}', 'read a file with Scanner'),
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
  // Control flow.
  snip('if', 'if ${condition}:\n\t${}', 'do something only if true'),
  snip('elif', 'elif ${condition}:\n\t${}', 'another branch to check'),
  snip('ternary', '${a} if ${condition} else ${b}', 'one value or another'),
  snip('whiletrue', 'while True:\n\t${}\n\tif ${condition}:\n\t\tbreak', 'loop until you break out'),
  snip('forenum', 'for ${i}, ${item} in enumerate(${items}):\n\t${}', 'loop with positions'),
  snip('forelse', 'for ${item} in ${items}:\n\t${}\nelse:\n\t${}', 'loop, with an else if nothing broke'),
  // Files & functions.
  snip('with', 'with open("${data.txt}") as ${f}:\n\t${}', 'open a file, closed for you'),
  snip('withw', 'with open("${out.txt}", "w") as ${f}:\n\t${f}.write(${})', 'open a file to write'),
  snip('defd', 'def ${name}(${}):\n\t"""${what it does}"""\n\t${}', 'a function with a docstring'),
  snip('lambda', 'lambda ${x}: ${x}', 'a tiny nameless function'),
  // Comprehensions.
  snip('comp', '[${expr} for ${x} in ${items}]', 'build a list in one line'),
  snip('dcomp', '{${k}: ${v} for ${item} in ${items}}', 'build a dict in one line'),
  // Classes.
  snip('classr', 'class ${Name}:\n\tdef __init__(self, ${value}):\n\t\tself.${value} = ${value}\n\n\tdef __repr__(self):\n\t\treturn f"${Name}({self.${value}})"', 'a class with __init__ and __repr__'),
  snip('property', '@property\ndef ${name}(self):\n\treturn self._${name}', 'read a method like an attribute'),
  // Errors.
  snip('tryf', 'try:\n\t${}\nexcept ${Exception} as e:\n\tprint(e)\nfinally:\n\t${}', 'try / except / finally'),
  snip('trye', 'try:\n\t${}\nexcept ${Exception} as e:\n\tprint(e)\nelse:\n\t${}', 'try / except / else'),
  // Advanced.
  snip('match', 'match ${value}:\n\tcase ${pattern}:\n\t\t${}\n\tcase _:\n\t\t${}', 'match a value against patterns'),
  snip('gen', 'def ${name}(${}):\n\tfor ${item} in ${items}:\n\t\tyield ${item}', 'a function that yields values one by one'),
  snip('deco', 'def ${my_decorator}(func):\n\tdef wrapper(*args, **kwargs):\n\t\t${}\n\t\treturn func(*args, **kwargs)\n\treturn wrapper', 'wrap a function to add behaviour'),
  snip('async', 'async def ${name}(${}):\n\t${}', 'a function you can await'),
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
  // System — the input/output streams (the caught System.in gap) and its statics.
  ['System.in', 'the keyboard input stream — hand it to a Scanner'],
  ['System.out', 'the normal output stream'],
  ['System.err', 'the error output stream'],
  ['System.exit', 'stop the whole program now'],
  ['System.currentTimeMillis', 'milliseconds since 1970 — time how long code takes'],
  ['System.nanoTime', 'a high-resolution timer, in nanoseconds'],
  ['System.arraycopy', 'copy part of one array into another'],
  ['System.getProperty', 'a system setting, like "user.dir"'],
  ['System.lineSeparator', 'the line break for this system'],
  ['System.getenv', 'an environment variable'],
  // String / Character / number statics.
  ['String.format', 'fill in the blanks, like printf, and get the text back'],
  ['String.join', 'glue pieces together with a separator between them'],
  ['Character.isDigit', 'is this character a digit?'],
  ['Character.isLetter', 'is this character a letter?'],
  ['Character.isLetterOrDigit', 'a letter or a digit?'],
  ['Character.isWhitespace', 'a space, tab or newline?'],
  ['Character.isUpperCase', 'is this a capital letter?'],
  ['Character.isLowerCase', 'is this a small letter?'],
  ['Character.toUpperCase', 'the capital form of a character'],
  ['Character.toLowerCase', 'the small form of a character'],
  ['Character.getNumericValue', 'the digit a character stands for'],
  ['Integer.valueOf', 'text (or an int) as an Integer'],
  ['Integer.toBinaryString', 'a whole number in base 2, as text'],
  ['Integer.toHexString', 'a whole number in base 16, as text'],
  ['Integer.compare', 'order two whole numbers'],
  ['Long.parseLong', 'text as a whole number'],
  ['Boolean.parseBoolean', 'text as true or false'],
  ['Math.floor', 'round down to a whole number'],
  ['Math.ceil', 'round up to a whole number'],
  ['Math.cbrt', 'cube root'],
  ['Math.log', 'natural logarithm (base e)'],
  ['Math.log10', 'logarithm base 10'],
  ['Math.exp', 'e to a power'],
  ['Math.sin', 'sine of an angle in radians'],
  ['Math.cos', 'cosine of an angle in radians'],
  ['Math.tan', 'tangent of an angle in radians'],
  ['Math.toRadians', 'degrees as radians'],
  ['Math.toDegrees', 'radians as degrees'],
  ['Math.hypot', 'the hypotenuse, √(x²+y²)'],
  ['Math.signum', 'the sign of a number: -1, 0 or 1'],
  ['Math.floorDiv', 'divide two ints and round down'],
  ['Math.floorMod', 'the remainder that matches floorDiv'],
  ['Math.PI', 'the circle constant, 3.14159…'],
  ['Math.E', "Euler's number, 2.71828…"],
  ['hashCode', 'a number that stands for this object'],
  ['getClass', 'what class this object is'],
  // Collections & modern Java — class names (auto-import attaches for non-java.lang).
  ['TreeMap', 'a map that keeps its keys in order'],
  ['LinkedHashMap', 'a map that remembers insertion order'],
  ['TreeSet', 'a set that keeps its items in order'],
  ['LinkedHashSet', 'a set that remembers insertion order'],
  ['ArrayDeque', 'a fast double-ended queue or stack'],
  ['Deque', 'a double-ended queue — add and take from both ends'],
  ['Queue', 'a line — first in, first out'],
  ['Stack', 'a pile — last in, first out'],
  ['PriorityQueue', 'a queue that always serves the smallest first'],
  ['Iterator', 'steps through a collection one item at a time'],
  ['Comparator', 'a custom sort order'],
  ['Comparable', 'a type that knows its own order'],
  ['IntStream', 'a pipeline over whole numbers'],
  // File reading & writing.
  ['BufferedReader', 'reads a file quickly, line by line'],
  ['BufferedWriter', 'writes to a file quickly'],
  ['PrintWriter', 'writes text to a file, like System.out'],
  ['FileReader', 'reads a file character by character'],
  ['FileWriter', 'writes characters to a file'],
  ['InputStreamReader', 'bridges raw bytes to characters'],
  ['File', 'a file or folder on disk'],
  ['Files', 'ready-made helpers for reading and writing files'],
  ['Path', 'the location of a file'],
  ['Paths', 'builds a Path from text'],
  // Exceptions.
  ['Exception', 'something went wrong'],
  ['RuntimeException', 'an error you need not declare'],
  ['IllegalArgumentException', 'a method was given a bad value'],
  ['NullPointerException', 'used something that was null'],
  ['ArrayIndexOutOfBoundsException', 'reached past the end of an array'],
  ['NumberFormatException', 'text was not a valid number'],
  ['ArithmeticException', 'a bad calculation, like dividing by zero'],
  ['IOException', 'a file could not be read or written'],
  ['FileNotFoundException', 'the file was not there'],
  // Qualified static calls (auto-import their owner).
  ['Paths.get', 'build a Path from text'],
  ['Files.readAllLines', 'read a whole file as a list of lines'],
  ['Files.readString', 'read a whole file into one String'],
  ['Files.lines', 'read a file as a stream of lines'],
  ['Files.writeString', 'write text to a file'],
  ['Files.write', 'write a list of lines to a file'],
  ['Files.exists', 'does this file exist?'],
  ['Collections.reverse', 'flip a list back to front'],
  ['Collections.shuffle', 'mix a list into random order'],
  ['Collections.max', 'the largest item in a list'],
  ['Collections.min', 'the smallest item in a list'],
  ['Collections.frequency', 'how many times an item appears'],
  ['Collections.binarySearch', 'find a key in a sorted list'],
  ['Arrays.fill', 'set every slot to the same value'],
  ['Arrays.asList', 'an array as a fixed list'],
  ['Arrays.copyOf', 'a copy of an array, resized'],
  ['Arrays.copyOfRange', 'a copy of part of an array'],
  ['Arrays.stream', 'start a pipeline over an array'],
  ['Arrays.binarySearch', 'find a key in a sorted array'],
  ['Arrays.deepToString', 'a nested array as text'],
  ['Comparator.comparing', 'order by a key you pick out'],
  ['Comparator.naturalOrder', 'the built-in order, smallest first'],
  ['Comparator.reverseOrder', 'the built-in order, reversed'],
  ['Collectors.toSet', 'gather into a set, no repeats'],
  ['Collectors.toMap', 'gather into a map of keys to values'],
  ['Collectors.partitioningBy', 'split into a true group and a false group'],
  ['Collectors.summingInt', 'add up a number from each item'],
  ['Collectors.averagingDouble', 'average a number from each item'],
  ['Collectors.mapping', 'transform items, then gather them'],
  ['IntStream.range', 'the whole numbers from a up to b'],
  ['IntStream.rangeClosed', 'the whole numbers from a to b, b included'],
  ['Stream.of', 'a stream of these items'],
  ['Stream.iterate', 'build a stream step by step'],
  ['Stream.generate', 'an endless stream from a supplier'],
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
  // More built-in functions (beginner → advanced).
  ['map', 'run a function over every item'],
  ['filter', 'keep only items that pass a test'],
  ['any', 'is any of them true?'],
  ['all', 'are all of them true?'],
  ['pow', 'to the power of'],
  ['divmod', 'the quotient and remainder together'],
  ['chr', 'the character for a code number'],
  ['ord', 'the code number for a character'],
  ['hex', 'a number in base 16'],
  ['oct', 'a number in base 8'],
  ['bin', 'a number in binary'],
  ['repr', 'exact text form, for the console'],
  ['open', 'open a file to read or write'],
  ['iter', 'make an iterator to step through'],
  ['next', 'the next item from an iterator'],
  ['frozenset', 'a set that cannot change'],
  ['bytes', 'raw bytes of data'],
  ['bytearray', 'raw bytes you can change'],
  ['slice', 'a reusable [start:stop:step]'],
  ['hash', 'a number that stands for a value'],
  ['id', 'the identity number of an object'],
  ['callable', 'can you call it like a function?'],
  ['hasattr', 'does it have this attribute?'],
  ['getattr', 'read an attribute by its name'],
  ['setattr', 'set an attribute by its name'],
  ['vars', 'attributes of an object as a dict'],
  ['dir', 'the names you can use on it'],
  ['super', 'reach the parent class'],
  ['property', 'read a method like an attribute'],
  ['staticmethod', 'a method needing no self'],
  ['classmethod', 'a method taking the class'],
  // Dunder methods a class commonly defines.
  ['__str__', 'text form for people'],
  ['__repr__', 'exact text form for the console'],
  ['__len__', 'what len() returns'],
  ['__eq__', 'what == means'],
  ['__lt__', 'what < means, for sorting'],
  ['__hash__', 'let it go in a set or dict'],
  ['__iter__', 'make it loopable'],
  ['__next__', 'hand back the next item'],
  ['__enter__', 'start of a with block'],
  ['__exit__', 'end of a with block'],
  ['__call__', 'call the object like a function'],
  ['__getitem__', 'what obj[key] does'],
  ['__setitem__', 'what obj[key] = value does'],
  ['__contains__', 'what "in" asks'],
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
  // math — more functions and constants.
  ['pow', 'math', 'x to the power of y, as a float'],
  ['isqrt', 'math', 'integer square root'],
  ['comb', 'math', 'combinations, n choose k'],
  ['perm', 'math', 'permutations of n taken k'],
  ['log', 'math', 'natural log, or log to a base'],
  ['log2', 'math', 'log base 2'],
  ['log10', 'math', 'log base 10'],
  ['exp', 'math', 'e to the power x'],
  ['sin', 'math', 'sine, angle in radians'],
  ['cos', 'math', 'cosine, angle in radians'],
  ['tan', 'math', 'tangent, angle in radians'],
  ['radians', 'math', 'degrees to radians'],
  ['degrees', 'math', 'radians to degrees'],
  ['hypot', 'math', 'length of the hypotenuse'],
  ['dist', 'math', 'distance between two points'],
  ['fabs', 'math', 'absolute value, as a float'],
  ['trunc', 'math', 'drop the decimal part'],
  ['isnan', 'math', 'is it not-a-number?'],
  ['isinf', 'math', 'is it infinity?'],
  ['pi', 'math', 'the number pi, 3.14159…'],
  ['e', 'math', "euler's number, 2.71828…"],
  ['inf', 'math', 'infinity'],
  ['nan', 'math', 'not a number'],
  ['tau', 'math', 'tau, two pi'],
  // random — more.
  ['random', 'random', 'a random decimal from 0 to 1'],
  ['choices', 'random', 'k random items, repeats allowed'],
  ['sample', 'random', 'k random items, no repeats'],
  ['randrange', 'random', 'a random number from a range'],
  ['seed', 'random', 'fix the sequence for repeatable runs'],
  ['getrandbits', 'random', 'a random integer with n bits'],
  // os.
  ['getcwd', 'os', 'the current working folder'],
  ['listdir', 'os', 'names of files in a folder'],
  ['mkdir', 'os', 'make one new folder'],
  ['makedirs', 'os', 'make a folder and any parents'],
  ['remove', 'os', 'delete a file'],
  ['rename', 'os', 'rename or move a file'],
  ['getenv', 'os', 'read an environment variable'],
  ['system', 'os', 'run a shell command'],
  ['walk', 'os', 'visit every folder underneath'],
  ['environ', 'os', 'all environment variables'],
  ['sep', 'os', 'the path separator for this system'],
  ['name', 'os', 'the operating-system family name'],
  // os.path (labels become os.path.join, etc.).
  ['join', 'os.path', 'join path pieces with the right slash'],
  ['exists', 'os.path', 'does this path exist?'],
  ['isfile', 'os.path', 'is it a file?'],
  ['isdir', 'os.path', 'is it a folder?'],
  ['basename', 'os.path', 'the last part of a path'],
  ['dirname', 'os.path', 'the folder part of a path'],
  ['split', 'os.path', 'split into folder and name'],
  ['splitext', 'os.path', 'split off the file extension'],
  ['abspath', 'os.path', 'the full absolute path'],
  // sys.
  ['argv', 'sys', 'the command-line arguments'],
  ['exit', 'sys', 'stop the program now'],
  ['stdin', 'sys', 'standard input stream'],
  ['stdout', 'sys', 'standard output stream'],
  ['stderr', 'sys', 'standard error stream'],
  ['path', 'sys', 'where python looks for modules'],
  ['version', 'sys', 'the python version, as text'],
  ['maxsize', 'sys', 'the largest practical integer'],
  ['platform', 'sys', 'the operating system name'],
  // json.
  ['dumps', 'json', 'turn data into a json string'],
  ['loads', 'json', 'read data from a json string'],
  ['dump', 'json', 'write data as json to a file'],
  ['load', 'json', 'read data from a json file'],
  // datetime (classes).
  ['datetime', 'datetime', 'a date and time together'],
  ['date', 'datetime', 'a calendar date'],
  ['timedelta', 'datetime', 'a length of time'],
  // time.
  ['time', 'time', 'seconds since 1970, a timestamp'],
  ['sleep', 'time', 'pause for a number of seconds'],
  ['perf_counter', 'time', 'a precise timer for measuring'],
  ['localtime', 'time', 'break a timestamp into parts'],
  ['strftime', 'time', 'format a time as text'],
  ['ctime', 'time', 'a timestamp as readable text'],
  // collections (classes).
  ['Counter', 'collections', 'count how often each item appears'],
  ['defaultdict', 'collections', 'a dict with a default for missing keys'],
  ['deque', 'collections', 'a list fast at both ends'],
  ['namedtuple', 'collections', 'a tuple with named fields'],
  ['OrderedDict', 'collections', 'a dict that remembers insertion order'],
  // itertools.
  ['count', 'itertools', 'count up forever from a start'],
  ['cycle', 'itertools', 'loop over items forever'],
  ['repeat', 'itertools', 'the same value, again and again'],
  ['chain', 'itertools', 'join several iterables end to end'],
  ['combinations', 'itertools', 'all ways to choose k items'],
  ['permutations', 'itertools', 'all orderings of k items'],
  ['product', 'itertools', 'every combination across iterables'],
  ['groupby', 'itertools', 'group neighbouring equal items'],
  ['accumulate', 'itertools', 'running totals'],
  ['islice', 'itertools', 'slice an iterator'],
  ['zip_longest', 'itertools', 'zip, filling in the short one'],
  // functools.
  ['reduce', 'functools', 'fold a sequence into one value'],
  ['lru_cache', 'functools', 'remember past results (decorator)'],
  ['cache', 'functools', 'remember past results, no size limit'],
  ['partial', 'functools', 'preset some arguments of a function'],
  ['wraps', 'functools', "keep a wrapped function's name (decorator)"],
  ['cmp_to_key', 'functools', 'turn an old-style compare into a key'],
  // re.
  ['match', 're', 'match a pattern at the start'],
  ['search', 're', 'find a pattern anywhere'],
  ['findall', 're', 'every match, as a list'],
  ['finditer', 're', 'every match, one at a time'],
  ['sub', 're', 'replace what the pattern matches'],
  ['compile', 're', 'prepare a pattern to reuse'],
  ['fullmatch', 're', 'match the whole string'],
  // statistics.
  ['mean', 'statistics', 'the average'],
  ['median', 'statistics', 'the middle value'],
  ['mode', 'statistics', 'the most common value'],
  ['stdev', 'statistics', 'sample standard deviation'],
  ['variance', 'statistics', 'sample variance'],
  ['pstdev', 'statistics', 'standard deviation of a whole population'],
  // string (constants).
  ['ascii_lowercase', 'string', "the letters 'a' to 'z'"],
  ['ascii_uppercase', 'string', "the letters 'A' to 'Z'"],
  ['ascii_letters', 'string', 'lower plus upper case letters'],
  ['digits', 'string', "the digits '0' to '9'"],
  ['punctuation', 'string', 'all the punctuation marks'],
  // heapq.
  ['heappush', 'heapq', 'add an item to the heap'],
  ['heappop', 'heapq', 'remove the smallest item'],
  ['heapify', 'heapq', 'turn a list into a heap in place'],
  ['nlargest', 'heapq', 'the n biggest items'],
  ['nsmallest', 'heapq', 'the n smallest items'],
  // bisect.
  ['bisect', 'bisect', 'where to insert to stay sorted'],
  ['bisect_left', 'bisect', 'insert point, left of equals'],
  ['bisect_right', 'bisect', 'insert point, right of equals'],
  ['insort', 'bisect', 'insert keeping the list sorted'],
  // typing (annotations).
  ['List', 'typing', 'a list of a given type'],
  ['Dict', 'typing', 'a dict of key and value types'],
  ['Optional', 'typing', 'a value or None'],
  ['Union', 'typing', 'one of several types'],
  ['Tuple', 'typing', 'a tuple of given types'],
  ['Any', 'typing', 'any type at all'],
  ['Callable', 'typing', 'a function type'],
  // pathlib (class).
  ['Path', 'pathlib', 'a filesystem path object'],
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
  // System family.
  'System.in': d('System.in', 'The keyboard input stream — the raw source of what the user types. You rarely touch it directly; you hand it to a Scanner.', 'Scanner sc = new Scanner(System.in);'),
  'System.out': d('System.out', 'The normal output stream. You call print, println or printf on it to show things.', 'System.out.println("Hi!");'),
  'System.err': d('System.err', 'The error output stream — for warnings and error messages, kept separate from normal output.'),
  'System.exit': d('System.exit(code)', 'Stops the whole program right now. 0 means all went well; anything else signals a problem.', 'System.exit(0);'),
  'System.currentTimeMillis': d('System.currentTimeMillis() → long', 'The number of milliseconds since 1 January 1970. Read it before and after some code to time how long it took.'),
  'System.nanoTime': d('System.nanoTime() → long', 'A very precise timer in nanoseconds. Only the difference between two readings means anything — it is not a wall clock.'),
  'System.arraycopy': d('System.arraycopy(src, from, dst, to, count)', 'Copies count items from one array into another — the fast, low-level way to shift or duplicate array contents.'),
  'System.getProperty': d('System.getProperty(name) → String', 'Looks up a setting about the machine and Java, like "user.dir" (the current folder) or "os.name".'),
  'System.lineSeparator': d('System.lineSeparator() → String', 'The line break this system uses — "\\n" on Linux and Mac, "\\r\\n" on Windows.'),
  'System.getenv': d('System.getenv(name) → String', 'The value of an environment variable, or null if it is not set.'),
  // String statics & methods.
  'String.format': d('String.format(format, values…) → String', 'Builds text with the blanks filled in, exactly like printf — but hands the String back instead of printing it. %s, %d, %.2f, %n.', 'String line = String.format("%s: %d", name, score);'),
  'String.join': d('String.join(sep, parts…) → String', 'Glues pieces of text together with your separator between each pair.', 'String.join(", ", "a", "b", "c")  // "a, b, c"'),
  lastIndexOf: d('text.lastIndexOf(piece) → int', 'Where the piece appears last, counting from 0 — or -1 if it is not there. The mirror of indexOf.'),
  replaceAll: d('text.replaceAll(regex, repl) → String', 'Swaps every match of a pattern (a regular expression) for new text. For plain text, replace is simpler and safer.', '"a1b2".replaceAll("[0-9]", "*")  // "a*b*"'),
  replaceFirst: d('text.replaceFirst(regex, repl) → String', 'Like replaceAll, but changes only the first match of the pattern.'),
  matches: d('text.matches(regex) → boolean', 'True when the whole text fits the pattern (a regular expression) from start to end.', '"07700".matches("[0-9]+")  // true'),
  compareToIgnoreCase: d('a.compareToIgnoreCase(b) → int', 'Orders two texts alphabetically, treating capitals and small letters the same.'),
  toCharArray: d('text.toCharArray() → char[]', 'The text broken into an array of single characters, so you can loop over them with a for-each.', 'for (char c : word.toCharArray()) { … }'),
  getBytes: d('text.getBytes() → byte[]', 'The text as its raw bytes. You meet this when saving text to a file or sending it over a network.'),
  chars: d('text.chars() → IntStream', 'The characters as a stream of numbers (their code points) — handy for counting or filtering with stream methods.'),
  intern: d('text.intern() → String', 'Returns the one shared copy of this exact text from a common pool. An advanced tool you will rarely need.'),
  // StringBuilder (qualified keys avoid clashing with String bare names).
  'StringBuilder.delete': d('sb.delete(from, to) → StringBuilder', 'Removes the characters from index from up to (but not including) to.'),
  'StringBuilder.replace': d('sb.replace(from, to, text) → StringBuilder', 'Swaps the characters between from and to for the new text, which can be a different length.'),
  'StringBuilder.indexOf': d('sb.indexOf(text) → int', 'Where the text first appears in what you have built, or -1.'),
  'StringBuilder.substring': d('sb.substring(from, to) → String', 'A piece of what you have built so far, as a String.'),
  'StringBuilder.setLength': d('sb.setLength(n)', 'Forces the length to n: shorter cuts the end off, longer pads with \\u0000. setLength(0) empties it.'),
  'StringBuilder.capacity': d('sb.capacity() → int', 'How many characters it can hold before it has to grow. Usually you can ignore this.'),
  'StringBuilder.reverse': d('sb.reverse() → StringBuilder', 'Turns everything built so far back to front — the quick way to reverse a String via a StringBuilder.'),
  'StringBuilder.insert': d('sb.insert(i, x) → StringBuilder', 'Slides x into position i, pushing the rest along.'),
  'StringBuilder.deleteCharAt': d('sb.deleteCharAt(i) → StringBuilder', 'Removes the single character at index i.'),
  'StringBuilder.setCharAt': d('sb.setCharAt(i, c)', 'Replaces just the character at index i with c.'),
  // Character.
  'Character.isDigit': d('Character.isDigit(c) → boolean', 'True when the character is a digit, 0 to 9 — handy for checking input one character at a time.', "Character.isDigit('7')  // true"),
  'Character.isLetter': d('Character.isLetter(c) → boolean', 'True when the character is a letter.'),
  'Character.isLetterOrDigit': d('Character.isLetterOrDigit(c) → boolean', 'True when the character is a letter or a digit — the usual test for "part of a word".'),
  'Character.isWhitespace': d('Character.isWhitespace(c) → boolean', 'True for a space, tab or newline.'),
  'Character.isUpperCase': d('Character.isUpperCase(c) → boolean', 'True when the character is a capital letter.'),
  'Character.isLowerCase': d('Character.isLowerCase(c) → boolean', 'True when the character is a small letter.'),
  'Character.toUpperCase': d('Character.toUpperCase(c) → char', 'The capital form of the character; unchanged if it is not a letter.'),
  'Character.toLowerCase': d('Character.toLowerCase(c) → char', 'The small form of the character; unchanged if it is not a letter.'),
  'Character.getNumericValue': d('Character.getNumericValue(c) → int', "The number a character stands for: '7' gives 7. Nicer than subtracting '0' by hand."),
  // Number types.
  'Integer.valueOf': d('Integer.valueOf(text) → Integer', 'Like parseInt, but hands back an Integer object rather than a plain int. Usually parseInt is what you want.'),
  'Integer.toBinaryString': d('Integer.toBinaryString(n) → String', 'The number written in base 2 (ones and zeros), as text.', 'Integer.toBinaryString(5)  // "101"'),
  'Integer.toHexString': d('Integer.toHexString(n) → String', 'The number written in base 16, as text.', 'Integer.toHexString(255)  // "ff"'),
  'Integer.compare': d('Integer.compare(a, b) → int', 'Orders two numbers: negative if a < b, 0 if equal, positive if a > b. Handy inside a comparator.'),
  'Integer.MAX_VALUE': d('Integer.MAX_VALUE', 'The biggest int Java can hold, 2147483647. Go past it and the number silently wraps round to a negative.'),
  'Integer.MIN_VALUE': d('Integer.MIN_VALUE', 'The smallest int Java can hold, -2147483648.'),
  'Long.parseLong': d('Long.parseLong(text) → long', 'Turns text into a long — a whole number that can be far bigger than an int holds.'),
  'Long.valueOf': d('Long.valueOf(text) → Long', 'Like parseLong, but hands back a Long object.'),
  'Long.compare': d('Long.compare(a, b) → int', 'Orders two long numbers: negative, zero or positive.'),
  'Double.compare': d('Double.compare(a, b) → int', 'Orders two decimals: negative, 0 or positive — and copes with the awkward cases like NaN.'),
  'Double.isNaN': d('Double.isNaN(x) → boolean', 'True when x is "not a number" — the result of things like 0.0 / 0.0. You cannot test this with ==.'),
  'Double.isInfinite': d('Double.isInfinite(x) → boolean', 'True when x is positive or negative infinity, say after dividing by zero.'),
  'Boolean.parseBoolean': d('Boolean.parseBoolean(text) → boolean', 'Turns text into a boolean: "true" (any capitalisation) becomes true, everything else false.'),
  'Boolean.valueOf': d('Boolean.valueOf(text) → Boolean', 'Turns text into a Boolean object; "true" in any capitalisation becomes true.'),
  // Math.
  'Math.floor': d('Math.floor(x) → double', 'Rounds down to the whole number below: 3.9 becomes 3.0, and -1.1 becomes -2.0.'),
  'Math.ceil': d('Math.ceil(x) → double', 'Rounds up to the whole number above: 3.1 becomes 4.0.'),
  'Math.cbrt': d('Math.cbrt(x) → double', 'The cube root: Math.cbrt(27) is 3.'),
  'Math.log': d('Math.log(x) → double', 'The natural logarithm, base e. For base 10 use Math.log10.'),
  'Math.log10': d('Math.log10(x) → double', 'The logarithm base 10: Math.log10(1000) is 3.'),
  'Math.exp': d('Math.exp(x) → double', 'e raised to the power x — the opposite of Math.log.'),
  'Math.sin': d('Math.sin(angle) → double', 'The sine of an angle given in radians. Use Math.toRadians first if you have degrees.'),
  'Math.cos': d('Math.cos(angle) → double', 'The cosine of an angle given in radians.'),
  'Math.tan': d('Math.tan(angle) → double', 'The tangent of an angle given in radians.'),
  'Math.toRadians': d('Math.toRadians(degrees) → double', 'Turns degrees into radians, which is what sin, cos and tan expect.'),
  'Math.toDegrees': d('Math.toDegrees(radians) → double', 'Turns radians back into degrees.'),
  'Math.hypot': d('Math.hypot(x, y) → double', 'The length of the hypotenuse, √(x² + y²) — the straight-line distance across a right triangle with these two sides.'),
  'Math.signum': d('Math.signum(x) → double', 'The sign of a number: -1.0 for negatives, 0.0 for zero, 1.0 for positives.'),
  'Math.floorDiv': d('Math.floorDiv(a, b) → int', 'Divides and rounds down towards the smaller number — unlike / which rounds towards zero. The difference shows with negatives.'),
  'Math.floorMod': d('Math.floorMod(a, b) → int', 'The remainder that goes with floorDiv, always taking the sign of b. Great for wrapping around, like clock arithmetic.', 'Math.floorMod(-1, 7)  // 6'),
  'Math.PI': d('Math.PI', 'The constant π, about 3.14159 — the ratio of a circle to its diameter.', 'double area = Math.PI * r * r;'),
  'Math.E': d('Math.E', "The constant e, about 2.71828 — Euler's number, the base of natural logarithms."),
  // Object methods & small backfills.
  hashCode: d('thing.hashCode() → int', 'A number that stands in for the object, used by HashMap and HashSet to find things fast. Equal objects must return the same hashCode.'),
  getClass: d('thing.getClass() → Class', 'The class the object really is at run time — useful for checking or printing its type.'),
  nextBoolean: d('r.nextBoolean() → boolean', 'A random true or false, like flipping a coin. Comes from a Random.'),
  Arrays: d('Arrays', 'A toolbox of static helpers for plain arrays — Arrays.sort, Arrays.toString, Arrays.fill and more. You never make an Arrays.'),
  Collections: d('Collections', 'Static helpers for lists and other collections — Collections.sort, reverse, shuffle, max, min. You never make a Collections.'),
  concat: d('a.concat(b) → String', 'Glues text b onto the end of text a and hands back the new String. The + operator does the same thing.'),
  // Collections — types.
  LinkedList: d('new LinkedList<Type>()', 'A list that is quick to add to or take from either end — good when you push and pop a lot. Reaching a middle item by position is slower than an ArrayList.', 'LinkedList<Integer> q = new LinkedList<>();'),
  TreeMap: d('new TreeMap<Key, Value>()', 'Like a HashMap, but it keeps its keys in sorted order, so looping over it goes smallest key first. It can also find the nearest key above or below one.', 'TreeMap<String, Integer> scores = new TreeMap<>();'),
  LinkedHashMap: d('new LinkedHashMap<Key, Value>()', 'A HashMap that remembers the order you put things in, so looping over it comes back in that same order.'),
  HashSet: d('new HashSet<Type>()', 'A bag of items with no repeats and no set order. Fast at answering "have I seen this before?"', 'HashSet<String> seen = new HashSet<>();'),
  TreeSet: d('new TreeSet<Type>()', 'A set with no repeats that also keeps its items in sorted order, and can find the nearest item above or below one.'),
  LinkedHashSet: d('new LinkedHashSet<Type>()', 'A set with no repeats that remembers the order you added things in.'),
  ArrayDeque: d('new ArrayDeque<Type>()', 'A double-ended queue: add and take from both the front and the back. The usual pick for a queue or a stack.', 'ArrayDeque<Integer> stack = new ArrayDeque<>();'),
  Deque: d('Deque<Type>', 'A double-ended queue — a queue and a stack in one. Make one with new ArrayDeque<>().'),
  Queue: d('Queue<Type>', 'A line: items leave in the order they arrived (first in, first out). offer adds to the back, poll takes from the front.'),
  Stack: d('new Stack<Type>()', 'A pile: the last thing you push is the first thing you pop (last in, first out). Many now prefer ArrayDeque for this.', 'Stack<Integer> s = new Stack<>();'),
  PriorityQueue: d('new PriorityQueue<Type>()', 'A queue that always hands back the smallest item next, whatever order you added them in. Pass a Comparator for a different order.', 'PriorityQueue<Integer> pq = new PriorityQueue<>();'),
  Iterator: d('Iterator<Type>', 'Steps through a collection one item at a time: hasNext asks if more are left, next gives the following one.', 'while (it.hasNext()) { … it.next() … }'),
  Comparator: d('Comparator<Type>', 'A custom order for sorting. Build one with Comparator.comparing, then chain reversed or thenComparing onto it.', 'names.sort(Comparator.comparing(String::length));'),
  Comparable: d('class X implements Comparable<X>', 'A type that knows its own natural order, by giving a compareTo method — then sort works with no extra Comparator.'),
  IntStream: d('IntStream', 'A stream of whole numbers, great for counting: IntStream.range(0, n) walks 0 up to n, and sum or average finish it off.', 'IntStream.rangeClosed(1, 5).sum();  // 15'),
  Stream: d('Stream<Type>', "A pipeline over a set of items. Start it with a collection's stream(), chain map and filter, then finish with collect or toList."),
  // Collection & stream methods.
  getOrDefault: d('map.getOrDefault(key, fallback)', 'The value stored under the key — or the fallback you give, when the key is not there. Saves a containsKey check.', 'counts.getOrDefault(word, 0)'),
  putIfAbsent: d('map.putIfAbsent(key, value)', 'Stores the value only if the key has nothing yet; leaves an existing value alone.'),
  computeIfAbsent: d('map.computeIfAbsent(key, k -> new…)', 'If the key is missing, work out a value and store it; either way you get the value back. The tidy way to build a map of lists.', 'groups.computeIfAbsent(letter, k -> new ArrayList<>()).add(word);'),
  merge: d('map.merge(key, value, (old, val) -> …)', 'Puts the value in if the key is new, otherwise combines it with what is there. A neat one-liner for tallying.', 'counts.merge(word, 1, Integer::sum);'),
  keySet: d('map.keySet() → Set', 'All the keys, as a set you can loop over.', 'for (String k : ages.keySet()) …'),
  values: d('map.values() → Collection', 'All the values, in the same order as the keys.'),
  entrySet: d('map.entrySet() → Set', 'Every key and value together, so a loop can read both at once.', 'for (var e : ages.entrySet()) System.out.println(e.getKey() + " " + e.getValue());'),
  containsValue: d('map.containsValue(value) → boolean', 'True if some key maps to this value. Slower than containsKey — it has to look at them all.'),
  addAll: d('a.addAll(b) → boolean', 'Adds every item of collection b into a. For sets this makes a union.'),
  retainAll: d('a.retainAll(b) → boolean', 'Keeps only the items of a that are also in b, dropping the rest. For sets this is an intersection.'),
  removeAll: d('a.removeAll(b) → boolean', 'Removes from a every item that is also in b. For sets this is a difference.'),
  removeIf: d('list.removeIf(x -> …) → boolean', 'Drops every item for which your test is true, in one pass.', 'nums.removeIf(n -> n < 0);'),
  iterator: d('coll.iterator() → Iterator', 'Hands you an Iterator to step through the items yourself — the machinery a for-each loop uses under the hood.'),
  hasNext: d('it.hasNext() → boolean', 'True while the iterator still has an item left to give.'),
  offer: d('queue.offer(item) → boolean', 'Adds the item to the queue. Like add, but returns false instead of throwing if a bounded queue is full.'),
  poll: d('queue.poll()', 'Takes the next item out and hands it to you — or null if the queue is empty. The safe partner to peek.'),
  peek: d('queue.peek()', 'Shows the next item without removing it — or null if there is nothing waiting.'),
  push: d('deque.push(item)', 'Puts the item on the front, stack-style. pop takes it back off.'),
  pop: d('deque.pop()', 'Takes the front item off, stack-style — the last one you pushed.'),
  addFirst: d('deque.addFirst(item)', 'Adds the item to the front.'),
  addLast: d('deque.addLast(item)', 'Adds the item to the back.'),
  pollFirst: d('deque.pollFirst()', 'Takes the front item out, or null if empty.'),
  pollLast: d('deque.pollLast()', 'Takes the back item out, or null if empty.'),
  compareTo: d('a.compareTo(b) → int', 'Compares for order: a negative number when a comes first, zero when they tie, positive when b comes first.', '"apple".compareTo("banana")  // negative'),
  reversed: d('comparator.reversed() → Comparator', 'The same order flipped, so what was first is now last.', 'Comparator.comparing(Person::getAge).reversed()'),
  thenComparing: d('comparator.thenComparing(keyFn) → Comparator', 'Breaks ties: when two items match on the first key, this second key decides.', 'comparing(Person::getLast).thenComparing(Person::getFirst)'),
  flatMap: d('stream.flatMap(x -> stream) → Stream', 'Turns each item into a little stream, then joins them all into one — handy for a list of lists.'),
  mapToInt: d('stream.mapToInt(x -> …) → IntStream', 'Turns each item into an int, giving a number stream you can sum or average.', 'words.stream().mapToInt(String::length).sum();'),
  boxed: d('intStream.boxed() → Stream<Integer>', 'Turns a stream of plain int into a stream of Integer objects, so you can collect it into a List.'),
  distinct: d('stream.distinct() → Stream', 'Drops repeats, keeping one of each.'),
  limit: d('stream.limit(n) → Stream', 'Keeps only the first n items and stops.'),
  skip: d('stream.skip(n) → Stream', 'Throws away the first n items and keeps the rest.'),
  anyMatch: d('stream.anyMatch(x -> …) → boolean', 'True as soon as one item passes your test.'),
  allMatch: d('stream.allMatch(x -> …) → boolean', 'True only if every item passes your test.'),
  noneMatch: d('stream.noneMatch(x -> …) → boolean', 'True when no item passes your test.'),
  findFirst: d('stream.findFirst() → Optional', 'The first item left in the pipeline, wrapped in an Optional in case there are none.'),
  toArray: d('stream.toArray() → Object[]', 'Gathers the pipeline into an array instead of a collection.'),
  sum: d('intStream.sum() → int', 'Adds every number in the stream together.', 'IntStream.rangeClosed(1, 100).sum();'),
  average: d('intStream.average() → OptionalDouble', 'The mean of the numbers, wrapped in an Optional in case the stream was empty.'),
  iterate: d('Stream.iterate(seed, x -> …)', 'Builds a stream by starting at seed and applying your function again and again. Pair it with limit so it stops.', 'Stream.iterate(1, n -> n * 2).limit(10);'),
  generate: d('Stream.generate(supplier)', 'An endless stream where each item comes from calling your supplier. Use limit to take just some.'),
  range: d('IntStream.range(start, end) → IntStream', 'The whole numbers from start up to — but not including — end.', 'IntStream.range(0, 5)  // 0,1,2,3,4'),
  rangeClosed: d('IntStream.rangeClosed(start, end) → IntStream', 'The whole numbers from start to end, with end included this time.', 'IntStream.rangeClosed(1, 5)  // 1,2,3,4,5'),
  orElseGet: d('opt.orElseGet(() -> …)', 'The value inside — or, when empty, one worked out by your function. Unlike orElse, the fallback is only built if it is actually needed.'),
  orElseThrow: d('opt.orElseThrow()', 'The value inside — or, when it is empty, throws an exception instead of handing back a fallback.'),
  ifPresentOrElse: d('opt.ifPresentOrElse(v -> …, () -> …)', 'Runs the first action with the value if there is one, otherwise runs the second — an if/else for an Optional.'),
  // I/O — types.
  File: d('new File(path)', 'Points at a file or folder on disk by its path — a handle you can ask questions like exists(), or hand to a Scanner or FileReader. Making one does not create the file.', 'File f = new File("data.txt");'),
  BufferedReader: d('new BufferedReader(new FileReader(path))', 'The usual way to read a text file: wrap a FileReader so you can pull whole lines with readLine, fast. Close it when done — try-with-resources does that for you.', 'BufferedReader br = new BufferedReader(new FileReader("data.txt"));'),
  BufferedWriter: d('new BufferedWriter(new FileWriter(path))', 'The usual way to write a text file line by line: write your text, call newLine between lines, and close at the end.', 'BufferedWriter bw = new BufferedWriter(new FileWriter("out.txt"));'),
  PrintWriter: d('new PrintWriter(new FileWriter(path))', 'Writes to a file with the same println and printf you know from System.out. Close it, or wrap it in try-with-resources, so your text is actually saved.', 'PrintWriter pw = new PrintWriter(new FileWriter("out.txt"));'),
  FileReader: d('new FileReader(path)', 'Reads a text file one character at a time. Almost always wrapped in a BufferedReader so you can read whole lines instead.'),
  FileWriter: d('new FileWriter(path)', 'Writes characters to a text file, making or replacing it. Pass true as a second argument to add onto the end instead.', 'FileWriter fw = new FileWriter("out.txt", true);  // append'),
  InputStreamReader: d('new InputStreamReader(System.in)', 'Turns a raw byte stream like System.in into characters. Wrapped in a BufferedReader, it is the no-Scanner way to read typed input.', 'var br = new BufferedReader(new InputStreamReader(System.in));'),
  Files: d('Files', 'Static file helpers you never make an instance of — Files.readString, Files.readAllLines and Files.writeString take a Path and do the whole read or write in one call.'),
  Path: d('Path', 'The location of a file, made with Paths.get("data.txt") or Path.of(...). The Files helpers take a Path rather than a plain String.'),
  Paths: d('Paths.get(text)', 'The factory for Path objects: Paths.get("folder/data.txt") turns a path in text into the Path that Files expects.'),
  // I/O — methods.
  readLine: d('br.readLine() → String', 'Reads one whole line from the file, without the line break — and gives back null once there are no lines left, which is how you know to stop.', 'String line;\nwhile ((line = br.readLine()) != null) { … }'),
  write: d('writer.write(text)', 'Writes the text to the file. It does not add a line break — call newLine() or write "\\n" yourself.'),
  newLine: d('bw.newLine()', 'Writes a line break, so the next write starts on a fresh line.'),
  flush: d('writer.flush()', 'Pushes anything still waiting in the buffer out to the file now, rather than at close time.'),
  read: d('reader.read() → int', 'Reads a single character as its code number, or -1 once the file has no more. Usually you wrap the reader in a BufferedReader and use readLine instead.'),
  createNewFile: d('file.createNewFile() → boolean', 'Makes a new empty file, returning true if it made one and false if it was already there. Can throw IOException.'),
  getName: d('file.getName() → String', "Just the file's own name, without any of the folders leading to it."),
  exists: d('file.exists() → boolean', 'True if the file or folder is actually there on disk. Worth checking before you try to read it.'),
  printStackTrace: d('e.printStackTrace()', 'Prints the error and the trail of calls that led to it — the red text you see when a program crashes. Handy while debugging.'),
  'BufferedReader.close': d('br.close()', 'Closes the file and frees it. try-with-resources does this for you, which is why it is the tidy way to read a file.'),
  'PrintWriter.close': d('pw.close()', 'Closes the file. It flushes first, so everything you wrote is safely saved — forgetting to close can lose the last lines.'),
  'BufferedWriter.close': d('bw.close()', 'Closes the file, flushing anything still buffered first so nothing is lost.'),
  'FileWriter.close': d('fw.close()', 'Closes the file so your writes are saved and the file is free for others.'),
  // I/O — statics.
  'Paths.get': d('Paths.get(path) → Path', 'Turns a file path in text into the Path object that Files and the readers expect.', 'Path p = Paths.get("data.txt");'),
  'Files.readAllLines': d('Files.readAllLines(path) → List<String>', 'Reads the whole file and hands you its lines as a list — the quickest way to read a small file. Needs a Path and can throw IOException.', 'List<String> lines = Files.readAllLines(Paths.get("data.txt"));'),
  'Files.readString': d('Files.readString(path) → String', 'Reads the entire file into a single String in one call (Java 11+).', 'String text = Files.readString(Paths.get("data.txt"));'),
  'Files.lines': d('Files.lines(path) → Stream<String>', 'Reads the file as a stream of lines, so you can filter or map without loading it all at once. Best used in try-with-resources so it closes.'),
  'Files.writeString': d('Files.writeString(path, text)', 'Writes the text to the file in one call, making or replacing it (Java 11+).', 'Files.writeString(Paths.get("out.txt"), "Hello");'),
  'Files.write': d('Files.write(path, lines)', 'Writes a list of lines to the file, one per line, making or replacing it.'),
  'Files.exists': d('Files.exists(path) → boolean', 'True if there is a file or folder at that path.'),
  // Comparator / Collections / Arrays statics.
  'Comparator.comparing': d('Comparator.comparing(keyFn)', 'Builds a sort order from a key you pick out of each item. Chain reversed or thenComparing to refine it.', 'people.sort(Comparator.comparing(Person::getAge));'),
  'Comparator.naturalOrder': d('Comparator.naturalOrder()', "The items' own built-in order, smallest first — the same order sort uses with no comparator."),
  'Comparator.reverseOrder': d('Comparator.reverseOrder()', "The items' built-in order, flipped — largest first."),
  'Collections.reverse': d('Collections.reverse(list)', 'Flips the list end to end, in place.'),
  'Collections.shuffle': d('Collections.shuffle(list)', 'Mixes the list into a random order, in place — handy for dealing cards.'),
  'Collections.max': d('Collections.max(collection)', 'The largest item, by natural order.'),
  'Collections.min': d('Collections.min(collection)', 'The smallest item, by natural order.'),
  'Collections.frequency': d('Collections.frequency(collection, item) → int', 'How many times the item appears in the collection.'),
  'Collections.binarySearch': d('Collections.binarySearch(list, key) → int', "Finds the key's position in a list that is already sorted — much faster than checking each item, but the list must be in order first."),
  'Arrays.fill': d('Arrays.fill(array, value)', 'Sets every slot of the array to the same value.'),
  'Arrays.asList': d('Arrays.asList(a, b, c) → List', 'Wraps some values, or an array, as a fixed-size List. You can set items but not add or remove.'),
  'Arrays.copyOf': d('Arrays.copyOf(array, newLength) → array', 'A copy of the array at a new length — padded with zeros if longer, cut short if smaller.'),
  'Arrays.copyOfRange': d('Arrays.copyOfRange(array, from, to) → array', 'A copy of just the slice from index from up to — but not including — to.'),
  'Arrays.stream': d('Arrays.stream(array) → Stream', "Starts a stream pipeline over the array's items.", 'Arrays.stream(nums).sum();'),
  'Arrays.binarySearch': d('Arrays.binarySearch(array, key) → int', "Finds the key's index in an already-sorted array, fast. Sort the array first."),
  'Arrays.deepToString': d('Arrays.deepToString(grid) → String', 'Readable text for an array of arrays, like [[1, 2], [3, 4]] — where plain toString would only show the outer level.'),
  // Streams — statics.
  'IntStream.range': d('IntStream.range(start, end) → IntStream', 'The whole numbers from start up to — but not including — end. A stream version of a counting for-loop.', 'IntStream.range(0, arr.length).forEach(i -> …);'),
  'IntStream.rangeClosed': d('IntStream.rangeClosed(start, end) → IntStream', 'The whole numbers from start to end, end included.', 'IntStream.rangeClosed(1, 5).sum();  // 15'),
  'Stream.of': d('Stream.of(a, b, c) → Stream', 'A stream straight from a handful of values, no collection needed.'),
  'Stream.iterate': d('Stream.iterate(seed, x -> …)', 'Builds a stream from a starting value by applying your function over and over. Add limit so it stops.', 'Stream.iterate(1, n -> n * 2).limit(10);'),
  'Stream.generate': d('Stream.generate(supplier)', 'An endless stream whose items each come from calling your supplier. Pair with limit.'),
  'Collectors.toSet': d('Collectors.toSet()', 'Gathers a stream into a Set, dropping repeats. Handed to collect(…).'),
  'Collectors.toMap': d('Collectors.toMap(keyFn, valFn)', 'Gathers a stream into a Map, using one function for each key and another for each value.', '.collect(Collectors.toMap(Person::id, Person::name))'),
  'Collectors.partitioningBy': d('Collectors.partitioningBy(x -> test)', 'Splits the stream into two groups in a Map: true for the items that pass, false for the rest.'),
  'Collectors.counting': d('Collectors.counting()', 'Counts items — most useful as the downstream of groupingBy, to count per group.', 'groupingBy(Person::getCity, counting())'),
  'Collectors.summingInt': d('Collectors.summingInt(x -> …)', 'Adds up a number taken from each item — often the downstream of groupingBy.'),
  'Collectors.averagingDouble': d('Collectors.averagingDouble(x -> …)', 'Averages a number taken from each item.'),
  'Collectors.mapping': d('Collectors.mapping(x -> …, downstream)', 'Transforms each item first, then hands the results to another collector — usually inside groupingBy.'),
  // Exceptions.
  Exception: d('catch (Exception e)', 'The general "something went wrong" type. Catching Exception catches almost anything — a useful safety net, though catching the specific type you expect is clearer.'),
  RuntimeException: d('extends RuntimeException', 'The family of errors Java does not force you to declare or catch, like NullPointerException. They usually mean a bug to fix, not a case to handle.'),
  IllegalArgumentException: d('throw new IllegalArgumentException(msg)', 'Thrown when a method is handed a value it cannot accept — a negative age, an empty name. Throw it yourself to reject bad input early.', 'if (age < 0) throw new IllegalArgumentException("age cannot be negative");'),
  NullPointerException: d('NullPointerException', 'The classic crash: you used a variable that was null as if it held an object — called a method on it, or read a field. Check for null first, or avoid leaving things null.'),
  ArrayIndexOutOfBoundsException: d('ArrayIndexOutOfBoundsException', 'You reached for a position that is not in the array — like index 5 of a 3-item array, or -1. Positions run 0 to length − 1.'),
  NumberFormatException: d('NumberFormatException', 'Integer.parseInt or Double.parseDouble was given text that is not a number, like "abc" or "". Check the text, or catch this around the parse.'),
  ArithmeticException: d('ArithmeticException', 'A calculation that cannot be done, most often dividing a whole number by zero.', 'int x = 5 / 0;  // ArithmeticException'),
  IOException: d('catch (IOException e)', 'The "something went wrong with a file or stream" type — the file was missing, or reading failed. Java makes you either catch it or declare throws IOException.'),
  FileNotFoundException: d('FileNotFoundException', 'A kind of IOException: the file you tried to open is not there, or you are not allowed to. Check the path and that the file exists.'),
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
  sorted: d('sorted(items, key=…, reverse=…)', 'A new list with the items in order, smallest first. Pass key= a function to sort by something else, or reverse=True for biggest first. The original stays as it was.', 'sorted(words, key=len, reverse=True)'),
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
  // Built-in functions.
  map: d('map(fn, items)', 'Runs a function over every item and hands back the results. Wrap it in list() to see them.', 'list(map(str, [1, 2, 3]))  # ["1", "2", "3"]'),
  filter: d('filter(test, items)', 'Keeps only the items your test says True for. Wrap it in list() to see them.', 'list(filter(lambda n: n > 0, nums))'),
  any: d('any(items) → bool', 'True if at least one item is truthy — a quick "is any of these the case?".', 'any(n < 0 for n in nums)'),
  all: d('all(items) → bool', 'True only when every item is truthy — "are all of these the case?". An empty run counts as True.', 'all(n > 0 for n in nums)'),
  pow: d('pow(base, exp, mod)', 'base to the power of exp — the same as base ** exp. A third argument gives the remainder mod that number.', 'pow(2, 10)  # 1024'),
  divmod: d('divmod(a, b) → (q, r)', 'The whole-number quotient and the remainder together, in one go.', 'divmod(17, 5)  # (3, 2)'),
  chr: d('chr(code) → str', 'The character for a number code: chr(65) is "A".'),
  ord: d('ord(char) → int', 'The number code behind a single character: ord("A") is 65. The opposite of chr.'),
  hex: d('hex(n) → str', 'A whole number written in base 16, as text starting with 0x: hex(255) is "0xff".'),
  oct: d('oct(n) → str', 'A whole number written in base 8, as text starting with 0o.'),
  bin: d('bin(n) → str', 'A whole number written in binary, as text starting with 0b: bin(5) is "0b101".'),
  repr: d('repr(x) → str', 'A precise text form meant for you the programmer — it shows the quotes and detail that str() hides.'),
  open: d('open(path, mode) → file', 'Opens a file so you can read or write it. Use "r" to read, "w" to write, "a" to add. Best used inside a with block, which closes it for you.', 'with open("data.txt") as f:'),
  iter: d('iter(items)', 'Turns something you can loop over into an iterator — the thing next() pulls from, one item at a time.'),
  next: d('next(iterator, default)', 'Pulls the next value out of an iterator. Give a default to get that instead of an error when it runs dry.'),
  frozenset: d('frozenset(items) → frozenset', 'A set that can never change once made — so it is safe to use as a dict key or to put inside another set.'),
  bytes: d('bytes(x) → bytes', 'Raw bytes — the form text takes on disk or over a network. Turn text into bytes with .encode(), and back with .decode().'),
  bytearray: d('bytearray(x) → bytearray', 'Like bytes, but you can change the individual bytes in place.'),
  slice: d('slice(start, stop, step)', 'The range you put inside square brackets, saved as a reusable object: items[slice(0, 5)] is the same as items[0:5].'),
  hash: d('hash(x) → int', 'A number that stands for a value — how sets and dicts find things quickly. Works only on unchangeable values.'),
  id: d('id(x) → int', 'A number unique to this exact object while it lives — handy for checking whether two names point at the very same thing.'),
  callable: d('callable(x) → bool', 'True if you can call x like a function with ().'),
  hasattr: d('hasattr(obj, name) → bool', 'True if the object has an attribute by that name.'),
  getattr: d('getattr(obj, name, default)', 'Reads an attribute whose name you hold as text. Give a default to avoid an error when it is missing.', 'getattr(user, "age", 0)'),
  setattr: d('setattr(obj, name, value)', 'Sets an attribute whose name you hold as text — the same as obj.name = value, but the name can be worked out while the program runs.'),
  vars: d('vars(obj)', 'The attributes an object is storing, handed back as a dict — a peek inside it.'),
  dir: d('dir(x)', 'A list of the names you can use on x — its methods and attributes. Good for exploring something new.'),
  super: d('super()', 'Reaches the parent class from inside a method — most often super().__init__(…) to run the parent setup first.', 'super().__init__(name)'),
  property: d('@property', 'Turns a method into something you read like a plain attribute — obj.area instead of obj.area(). Put it just above the method.'),
  staticmethod: d('@staticmethod', 'Marks a method that needs neither self nor the class — a plain function that lives on the class for tidiness.'),
  classmethod: d('@classmethod', 'Marks a method that takes the class (cls) instead of an instance — handy for extra ways to build one.', 'def from_text(cls, s): ...'),
  // Dunder methods a class commonly defines.
  __str__: d('def __str__(self) → str', 'What print() and str() show for your object. Make it the friendly, readable version.', 'def __str__(self):\n    return self.name'),
  __repr__: d('def __repr__(self) → str', 'The version shown in the console and by repr() — aim for something exact, ideally how you would rebuild the object.', 'def __repr__(self):\n    return f"Point({self.x}, {self.y})"'),
  __len__: d('def __len__(self) → int', 'What len() returns for your object. Give back how many things it holds.'),
  __eq__: d('def __eq__(self, other) → bool', 'Decides what == means for your objects — usually comparing the fields that matter.', 'def __eq__(self, other):\n    return self.id == other.id'),
  __lt__: d('def __lt__(self, other) → bool', 'Decides what < means, which is all sorted() needs to put your objects in order.'),
  __hash__: d('def __hash__(self) → int', 'Lets your object go into a set or act as a dict key. Base it on the same fields as __eq__.'),
  __iter__: d('def __iter__(self)', 'Makes your object something you can loop over with for. Return an iterator — often you just yield the items straight from here.'),
  __next__: d('def __next__(self)', 'Hands back the next item each time, and raises StopIteration when there are none left. The engine behind a for loop.'),
  __enter__: d('def __enter__(self)', 'Runs at the top of a with block; whatever you return becomes the "as" value. The setup half of a context manager.'),
  __exit__: d('def __exit__(self, *exc)', 'Runs when a with block ends, even after an error — the place to clean up, like closing a file.'),
  __call__: d('def __call__(self, …)', 'Lets you call the object itself like a function: obj() runs this.'),
  __getitem__: d('def __getitem__(self, key)', 'What obj[key] does — the square-bracket lookup, for anything you want to behave like a list or dict.'),
  __setitem__: d('def __setitem__(self, key, value)', 'What obj[key] = value does — storing by square brackets.'),
  __contains__: d('def __contains__(self, item) → bool', 'What the in keyword asks: whether item is inside your object.'),
  // str / set / dict method backfills.
  isdigit: d('text.isdigit() → bool', 'True when every character is a digit, 0 to 9 — a quick check before int().', '"42".isdigit()  # True'),
  isalpha: d('text.isalpha() → bool', 'True when every character is a letter.'),
  isalnum: d('text.isalnum() → bool', 'True when every character is a letter or a digit.'),
  isupper: d('text.isupper() → bool', 'True when all the letters are capitals.'),
  islower: d('text.islower() → bool', 'True when all the letters are lower case.'),
  title: d('text.title() → str', 'A copy with The First Letter Of Each Word Capitalised.'),
  capitalize: d('text.capitalize() → str', 'A copy with just the first letter capitalised and the rest lower case.'),
  zfill: d('text.zfill(width) → str', 'Pads the text on the left with zeros until it is that wide.', '"7".zfill(3)  # "007"'),
  lstrip: d('text.lstrip() → str', 'A copy with spaces trimmed off the start only.'),
  rstrip: d('text.rstrip() → str', 'A copy with spaces trimmed off the end only.'),
  add: d('s.add(x)', 'Puts x into the set. If it is already there, nothing changes.'),
  discard: d('s.discard(x)', 'Takes x out if it is there — and quietly does nothing if it is not.'),
  union: d('a.union(b) → set', 'Everything in either set, with no repeats.'),
  intersection: d('a.intersection(b) → set', 'Only the items found in both sets.'),
  difference: d('a.difference(b) → set', 'The items in this set that are not in the other.'),
  issubset: d('a.issubset(b) → bool', 'True when every item of a is also in b.'),
  issuperset: d('a.issuperset(b) → bool', 'True when a holds every item of b.'),
  clear: d('items.clear()', 'Empties it out completely — nothing left inside.'),
  copy: d('items.copy()', 'A fresh copy you can change without touching the original.'),
  remove: d('items.remove(x)', 'Takes the first x out. Errors if it is not there.'),
  setdefault: d('pairs.setdefault(key, default)', 'The value under the key — and if the key is missing, adds it with this default first.'),
  popitem: d('pairs.popitem()', 'Takes the last key/value pair out and hands it back.'),
  fromkeys: d('dict.fromkeys(keys, value)', 'A new dict with each key set to the same starting value.', 'dict.fromkeys("abc", 0)  # {"a":0,"b":0,"c":0}'),
  'math.factorial': d('math.factorial(n) → int', 'n! — n × (n−1) × … × 1: factorial(5) is 120. Needs import math.'),
  'math.gcd': d('math.gcd(a, b) → int', 'The greatest common divisor — the biggest number that divides both.'),
  // math — the rest.
  'math.pow': d('math.pow(x, y) → float', 'x to the power of y, always as a decimal: math.pow(2, 10) is 1024.0. For whole-number powers, x ** y stays an int.'),
  'math.isqrt': d('math.isqrt(n) → int', 'The whole-number square root, rounded down: math.isqrt(17) is 4. No decimals, no rounding error.'),
  'math.comb': d('math.comb(n, k) → int', 'How many ways to choose k things from n when order does not matter — "n choose k".', 'math.comb(5, 2)  # 10'),
  'math.perm': d('math.perm(n, k) → int', 'How many ways to arrange k things out of n when order matters.'),
  'math.log': d('math.log(x, base) → float', 'The logarithm of x. With one argument it is the natural log (base e); give a base for anything else.', 'math.log(8, 2)  # 3.0'),
  'math.log2': d('math.log2(x) → float', 'The logarithm of x to base 2.'),
  'math.log10': d('math.log10(x) → float', 'The logarithm of x to base 10.'),
  'math.exp': d('math.exp(x) → float', 'e raised to the power x — the opposite of math.log.'),
  'math.sin': d('math.sin(x) → float', 'The sine of angle x, where x is in radians. Use math.radians to convert from degrees first.', 'math.sin(math.radians(90))  # 1.0'),
  'math.cos': d('math.cos(x) → float', 'The cosine of angle x, in radians.'),
  'math.tan': d('math.tan(x) → float', 'The tangent of angle x, in radians.'),
  'math.radians': d('math.radians(deg) → float', 'Turns an angle in degrees into radians, which is what sin, cos and tan expect.'),
  'math.degrees': d('math.degrees(rad) → float', 'Turns an angle in radians back into degrees.'),
  'math.hypot': d('math.hypot(x, y) → float', 'The length of the slanted side of a right triangle with sides x and y — the square root of x²+y².', 'math.hypot(3, 4)  # 5.0'),
  'math.dist': d('math.dist(p, q) → float', 'The straight-line distance between two points, each given as coordinates.', 'math.dist([0, 0], [3, 4])  # 5.0'),
  'math.fabs': d('math.fabs(x) → float', 'The distance from zero, always as a decimal. abs() does the same and keeps ints as ints.'),
  'math.trunc': d('math.trunc(x) → int', 'Drops the decimal part towards zero: trunc(3.9) is 3, trunc(-3.9) is -3.'),
  'math.isnan': d('math.isnan(x) → bool', 'True when x is "not a number" — the odd value some calculations produce instead of a real answer.'),
  'math.isinf': d('math.isinf(x) → bool', 'True when x is infinity, positive or negative.'),
  'math.e': d('math.e', "Euler's number, about 2.71828 — the base of the natural logarithm."),
  'math.inf': d('math.inf', 'Infinity — larger than any real number. Handy as a starting "worst so far" in a search.'),
  'math.nan': d('math.nan', '"Not a number" — the result of an undefined calculation. Nothing equals nan, not even nan.'),
  'math.tau': d('math.tau', 'The number tau, about 6.28318 — a full turn in radians, the same as 2 times math.pi.'),
  // random — the rest.
  'random.choices': d('random.choices(seq, k=1) → list', 'Picks k items at random, and can pick the same one more than once. Pass weights= to make some items likelier.', 'random.choices([1, 2, 3], k=5)'),
  'random.sample': d('random.sample(seq, k) → list', 'Picks k different items at random — no repeats. k cannot be bigger than the sequence.', 'random.sample(range(1, 50), 6)'),
  'random.randrange': d('random.randrange(stop) → int', 'A random whole number from 0 up to — but not including — stop, just like range.'),
  'random.seed': d('random.seed(n)', 'Fixes the random sequence so the "random" numbers come out the same every run — useful for testing.'),
  'random.getrandbits': d('random.getrandbits(n) → int', 'A random whole number built from n random bits (0 up to 2ⁿ − 1).'),
  // os.
  'os.getcwd': d('os.getcwd() → str', 'The folder your program is running in right now, as a full path. Needs import os.'),
  'os.listdir': d('os.listdir(path) → list', 'The names of everything inside a folder. With no argument it lists the current folder.'),
  'os.mkdir': d('os.mkdir(path)', 'Makes one new folder. The parent folder must already exist — use os.makedirs for a whole chain.'),
  'os.makedirs': d('os.makedirs(path)', 'Makes a folder and any missing parent folders along the way.'),
  'os.remove': d('os.remove(path)', 'Deletes a file. There is no undo, so be sure of the path.'),
  'os.rename': d('os.rename(old, new)', 'Renames a file or folder — and moves it, if the new path is elsewhere.'),
  'os.getenv': d('os.getenv(name, default) → str', 'The value of an environment variable, or the default (None) when it is not set.'),
  'os.system': d('os.system(command) → int', 'Runs a command in the shell, as if you typed it in a terminal. Returns the exit code.'),
  'os.walk': d('os.walk(top)', 'Walks a folder and everything beneath it, handing you each folder with its subfolders and files.', 'for folder, subs, files in os.walk("."):'),
  'os.environ': d('os.environ', 'A dictionary of every environment variable. os.environ["HOME"] reads one.'),
  'os.sep': d('os.sep', 'The character that separates folders in a path on this system — "/" on Linux and Mac.'),
  'os.name': d('os.name', "A short name for the operating-system family: 'posix' on Linux and Mac, 'nt' on Windows."),
  // os.path.
  'os.path.join': d('os.path.join(a, b, …) → str', 'Joins path pieces with the right separator for this system — safer than gluing strings with "/".', 'os.path.join("data", "in.txt")'),
  'os.path.exists': d('os.path.exists(path) → bool', 'True if something — a file or a folder — is at that path.'),
  'os.path.isfile': d('os.path.isfile(path) → bool', 'True if the path points to a file.'),
  'os.path.isdir': d('os.path.isdir(path) → bool', 'True if the path points to a folder.'),
  'os.path.basename': d('os.path.basename(path) → str', 'Just the last part of a path — the file or folder name.', 'os.path.basename("a/b/c.txt")  # "c.txt"'),
  'os.path.dirname': d('os.path.dirname(path) → str', 'The folder part of a path, without the final name.'),
  'os.path.split': d('os.path.split(path) → tuple', 'Splits a path into its folder part and its final name, as a pair.'),
  'os.path.splitext': d('os.path.splitext(path) → tuple', 'Splits off the file extension: ("report", ".txt").'),
  'os.path.abspath': d('os.path.abspath(path) → str', 'The full absolute path, worked out from the current folder.'),
  // sys.
  'sys.argv': d('sys.argv → list', 'The words typed after "python" on the command line. sys.argv[0] is the script name; the real arguments start at [1].'),
  'sys.exit': d('sys.exit(code=0)', 'Stops the program straight away. A code of 0 means all went well; anything else signals an error.'),
  'sys.stdin': d('sys.stdin', 'Standard input — where input() reads from. You can loop over it line by line.'),
  'sys.stdout': d('sys.stdout', 'Standard output — where print() writes.'),
  'sys.stderr': d('sys.stderr', 'The error stream — a separate channel for warnings and errors, kept apart from normal output.'),
  'sys.path': d('sys.path → list', 'The folders Python searches when you import something.'),
  'sys.version': d('sys.version → str', 'The running Python version, as readable text.'),
  'sys.maxsize': d('sys.maxsize → int', 'The largest size Python uses for lists and indexes — a handy stand-in for "very large".'),
  'sys.platform': d('sys.platform → str', "A short name for the operating system: 'linux', 'darwin' (Mac) or 'win32'."),
  // json.
  'json.dumps': d('json.dumps(data) → str', 'Turns Python data — dicts, lists, numbers, strings — into a JSON string. Pass indent=2 to make it readable.', 'json.dumps({"name": "Sara"})'),
  'json.loads': d('json.loads(text) → data', 'Reads a JSON string back into Python data.', "json.loads('{\"n\": 1}')  # {'n': 1}"),
  'json.dump': d('json.dump(data, file)', 'Writes Python data as JSON straight into an open file.'),
  'json.load': d('json.load(file) → data', 'Reads JSON from an open file back into Python data.'),
  // datetime.
  'datetime.datetime': d('datetime.datetime(year, month, day, …)', 'A moment in time — a date together with a clock time. Reach it as datetime.datetime after import datetime, or import it directly with "from datetime import datetime".'),
  'datetime.date': d('datetime.date(year, month, day)', 'A calendar date on its own, with no time of day.'),
  'datetime.timedelta': d('datetime.timedelta(days=, hours=, …)', 'A length of time. Add or subtract one from a date to move it.', 'tomorrow = today + timedelta(days=1)'),
  'datetime.now': d('datetime.now() → datetime', "The current date and time, from the computer's clock.", 'from datetime import datetime\nnow = datetime.now()'),
  'datetime.today': d('datetime.today() → datetime', 'The current date and time — much like now().'),
  'datetime.strptime': d('datetime.strptime(text, fmt) → datetime', 'Reads a datetime out of text, following a format you describe with codes like %Y-%m-%d.', 'datetime.strptime("2026-08-10", "%Y-%m-%d")'),
  'datetime.strftime': d('dt.strftime(fmt) → str', 'Formats a datetime as text using codes: %Y year, %m month, %d day, %H hour, %M minute.', 'now.strftime("%Y-%m-%d")'),
  'datetime.fromisoformat': d('datetime.fromisoformat(text) → datetime', 'Reads a standard ISO datetime like "2026-08-10T14:30".'),
  'datetime.isoformat': d('dt.isoformat() → str', 'This datetime written the standard ISO way.'),
  'datetime.weekday': d('dt.weekday() → int', 'Which day of the week it is: Monday is 0, Sunday is 6.'),
  'date.today': d('date.today() → date', "Today's date, with no time attached.", 'from datetime import date\ntoday = date.today()'),
  'date.fromisoformat': d('date.fromisoformat(text) → date', 'Reads a date written the standard way, "YYYY-MM-DD".'),
  'date.strftime': d('d.strftime(fmt) → str', 'Formats a date as text: d.strftime("%d/%m/%Y").'),
  'date.isoformat': d('d.isoformat() → str', 'The date as standard text, "YYYY-MM-DD".'),
  'date.weekday': d('d.weekday() → int', 'Which day of the week it is: Monday is 0, Sunday is 6.'),
  // time.
  'time.time': d('time.time() → float', 'The number of seconds since the start of 1970 — a timestamp. Subtract two to measure elapsed time.'),
  'time.sleep': d('time.sleep(seconds)', 'Pauses the program for that many seconds. Give a decimal for less than a second.', 'time.sleep(0.5)'),
  'time.perf_counter': d('time.perf_counter() → float', 'A high-precision timer, meant only for measuring how long something takes.', 'start = time.perf_counter()'),
  'time.localtime': d('time.localtime() → struct_time', 'Breaks a timestamp into readable parts — year, month, day, hour, and so on.'),
  'time.strftime': d('time.strftime(fmt) → str', 'Formats the current time as text using codes like %Y and %H.', 'time.strftime("%H:%M:%S")'),
  'time.ctime': d('time.ctime() → str', 'The current time as friendly text, like "Mon Aug 10 14:30:00 2026".'),
  // collections.
  'collections.Counter': d('Counter(iterable)', 'Counts how often each item appears and hands you a dict-like tally. Needs "from collections import Counter".', 'Counter("banana")  # a:3, n:2, b:1'),
  'collections.defaultdict': d('defaultdict(default_factory)', 'A dictionary that invents a starting value for a missing key instead of raising an error — defaultdict(int) starts each key at 0, defaultdict(list) at [].', 'counts = defaultdict(int)'),
  'collections.deque': d('deque(iterable)', 'A list-like queue that is fast to add to and take from at both ends. Great for a queue or a sliding window.', 'from collections import deque'),
  'collections.namedtuple': d('namedtuple("Name", fields)', 'Builds a small tuple type whose slots have names, so you write point.x instead of point[0].', 'Point = namedtuple("Point", "x y")'),
  'collections.OrderedDict': d('OrderedDict()', 'A dictionary that remembers the order keys were added. Plain dicts do this too now, so you rarely need it.'),
  'Counter.most_common': d('c.most_common(n) → list', 'The n most frequent items, each with its count, most common first. No n gives them all.', 'Counter("banana").most_common(1)  # [("a", 3)]'),
  'Counter.elements': d('c.elements()', 'Goes back through each item, repeated as many times as its count.'),
  'Counter.update': d('c.update(iterable)', 'Counts more items in, adding to the totals already there.'),
  'Counter.subtract': d('c.subtract(iterable)', 'Takes counts away, item by item.'),
  'deque.append': d('dq.append(x)', 'Adds x to the right-hand end.'),
  'deque.appendleft': d('dq.appendleft(x)', 'Adds x to the left-hand end — the cheap move a plain list cannot do.'),
  'deque.pop': d('dq.pop() → item', 'Removes and returns the right-hand item.'),
  'deque.popleft': d('dq.popleft() → item', 'Removes and returns the left-hand item — the front of a queue.'),
  'deque.rotate': d('dq.rotate(n)', 'Shifts every item n places to the right (negative n shifts left).'),
  // itertools.
  'itertools.count': d('itertools.count(start, step) → iterator', 'Counts upward forever, from start, in steps. Pair it with zip, or break out of the loop yourself.', 'for i in itertools.count(1): ...'),
  'itertools.cycle': d('itertools.cycle(iterable) → iterator', 'Loops over the items again and again, without end.'),
  'itertools.repeat': d('itertools.repeat(x, times) → iterator', 'Gives back the same value, "times" times — or forever with no count.'),
  'itertools.chain': d('itertools.chain(a, b, …) → iterator', 'Runs through several iterables one after another, as if they were joined.', 'list(itertools.chain([1, 2], [3, 4]))'),
  'itertools.combinations': d('itertools.combinations(iterable, k) → iterator', 'Every way to choose k items, where order does not matter and nothing repeats.', 'list(itertools.combinations("abc", 2))'),
  'itertools.permutations': d('itertools.permutations(iterable, k) → iterator', 'Every ordering of k items — here order does matter.'),
  'itertools.product': d('itertools.product(a, b) → iterator', 'Every pairing across the iterables — like nested for-loops flattened out.', 'list(itertools.product([1, 2], "ab"))'),
  'itertools.groupby': d('itertools.groupby(iterable, key) → iterator', 'Groups neighbouring items that share a key. Sort by the same key first, or the groups get split up.'),
  'itertools.accumulate': d('itertools.accumulate(iterable) → iterator', 'Running totals: each value plus everything before it.', 'list(itertools.accumulate([1, 2, 3]))  # [1, 3, 6]'),
  'itertools.islice': d('itertools.islice(iterable, stop) → iterator', 'Takes a slice of any iterator, the way [a:b] slices a list — but works on endless ones too.'),
  'itertools.zip_longest': d('itertools.zip_longest(a, b, fillvalue=None) → iterator', 'Like zip, but keeps going to the end of the longest one, filling gaps with fillvalue.'),
  // functools.
  'functools.reduce': d('functools.reduce(fn, iterable, start) → value', 'Folds a sequence down to one value by combining items two at a time.', 'reduce(lambda a, b: a * b, [1, 2, 3, 4])  # 24'),
  'functools.lru_cache': d('@functools.lru_cache', "A decorator that remembers a function's results, so calling it again with the same arguments is instant. Great for slow recursion.", '@lru_cache\ndef fib(n): ...'),
  'functools.cache': d('@functools.cache', 'Like lru_cache with no size limit — remembers every result (Python 3.9+).'),
  'functools.partial': d('functools.partial(fn, *args) → function', 'Makes a new function with some of its arguments already filled in.'),
  'functools.wraps': d('@functools.wraps(fn)', 'Used inside your own decorators so the wrapped function keeps its real name and docstring.'),
  'functools.cmp_to_key': d('functools.cmp_to_key(compare)', 'Turns an old two-item compare function into a key= you can hand to sorted().'),
  // re.
  're.match': d('re.match(pattern, text)', 'Tries to match the pattern at the very start of the text. Returns a match object, or None. Needs import re.'),
  're.search': d('re.search(pattern, text)', 'Looks for the pattern anywhere in the text, and returns the first match — or None.', 're.search(r"\\d+", "room 12")'),
  're.findall': d('re.findall(pattern, text) → list', 'Every piece of the text the pattern matches, as a list of strings.', 're.findall(r"\\d+", "a1b22")  # ["1", "22"]'),
  're.finditer': d('re.finditer(pattern, text)', 'Every match, one match object at a time — use it when you need positions, not just the text.'),
  're.sub': d('re.sub(pattern, repl, text) → str', 'Replaces every match of the pattern with repl, and gives back the new text.', 're.sub(r"\\s+", " ", messy)'),
  're.split': d('re.split(pattern, text) → list', 'Splits the text wherever the pattern matches.'),
  're.compile': d('re.compile(pattern)', 'Prepares a pattern once so you can reuse it many times without rewriting it.'),
  're.fullmatch': d('re.fullmatch(pattern, text)', 'Matches only if the pattern covers the whole text, start to end.'),
  'Match.group': d('m.group(n=0) → str', 'The text that matched. group(0) is the whole match; group(1) is the first bracketed part.', 'm.group(1)'),
  'Match.groups': d('m.groups() → tuple', 'All the bracketed groups, in order, as a tuple.'),
  'Match.start': d('m.start() → int', 'The position in the text where the match begins.'),
  'Match.end': d('m.end() → int', 'The position just after the match ends.'),
  'Match.span': d('m.span() → tuple', 'The start and end positions together, as a pair.'),
  'Match.groupdict': d('m.groupdict() → dict', 'The named groups as a dictionary, name to matched text.'),
  // statistics.
  'statistics.mean': d('statistics.mean(data) → float', 'The average — the total divided by how many. Needs import statistics.', 'statistics.mean([2, 4, 6])  # 4'),
  'statistics.median': d('statistics.median(data) → float', 'The middle value once the numbers are in order — less thrown off by one huge value than the mean.'),
  'statistics.mode': d('statistics.mode(data)', 'The value that appears most often.'),
  'statistics.stdev': d('statistics.stdev(data) → float', 'How spread out a sample of numbers is — the sample standard deviation.'),
  'statistics.variance': d('statistics.variance(data) → float', 'The spread of a sample, squared — standard deviation is its square root.'),
  'statistics.pstdev': d('statistics.pstdev(data) → float', 'Standard deviation when your data is the whole population, not just a sample.'),
  // string constants.
  'string.ascii_lowercase': d('string.ascii_lowercase', "The 26 lower-case letters, 'a' to 'z', as one string. Needs import string."),
  'string.ascii_uppercase': d('string.ascii_uppercase', "The 26 upper-case letters, 'A' to 'Z'."),
  'string.ascii_letters': d('string.ascii_letters', 'All the letters, lower-case then upper-case, in one string.'),
  'string.digits': d('string.digits', "The ten digits, '0' to '9', as one string."),
  'string.punctuation': d('string.punctuation', 'Every punctuation mark, as one string — handy for stripping them out.'),
  // heapq.
  'heapq.heappush': d('heapq.heappush(heap, item)', 'Adds an item to a heap — a list kept so the smallest is always at heap[0]. Needs import heapq.'),
  'heapq.heappop': d('heapq.heappop(heap) → item', 'Removes and returns the smallest item, keeping the heap in order.'),
  'heapq.heapify': d('heapq.heapify(list)', 'Rearranges an ordinary list into a heap, in place — do this once before pushing and popping.'),
  'heapq.nlargest': d('heapq.nlargest(n, iterable) → list', 'The n biggest items, largest first.', 'heapq.nlargest(3, scores)'),
  'heapq.nsmallest': d('heapq.nsmallest(n, iterable) → list', 'The n smallest items, smallest first.'),
  // bisect.
  'bisect.bisect': d('bisect.bisect(sorted, x) → int', 'Where x would go to keep a sorted list sorted — the same as bisect_right. Needs import bisect.'),
  'bisect.bisect_left': d('bisect.bisect_left(sorted, x) → int', 'The insert point for x, to the left of any equal items.'),
  'bisect.bisect_right': d('bisect.bisect_right(sorted, x) → int', 'The insert point for x, to the right of any equal items.'),
  'bisect.insort': d('bisect.insort(sorted, x)', 'Inserts x into a sorted list at the right spot, so it stays sorted.', 'bisect.insort(scores, 87)'),
  // typing.
  'typing.List': d('List[int]', 'A hint that a value is a list of a certain type, e.g. List[int]. Needs "from typing import List". Modern Python can also write list[int] directly.'),
  'typing.Dict': d('Dict[str, int]', 'A hint for a dict, giving the key type then the value type.'),
  'typing.Optional': d('Optional[str]', 'A hint that a value is either the given type or None — Optional[str] means "a string or nothing".'),
  'typing.Union': d('Union[int, str]', 'A hint that a value is one of several types. Modern Python writes this as int | str.'),
  'typing.Tuple': d('Tuple[int, str]', 'A hint for a tuple, giving the type of each slot.'),
  'typing.Any': d('Any', 'A hint meaning "any type is allowed here" — it switches type checking off for that value.'),
  'typing.Callable': d('Callable[[int], str]', 'A hint for a function value: the argument types in a list, then the return type.'),
  // pathlib.
  'pathlib.Path': d('Path("folder/file.txt")', 'A tidy way to work with file paths as objects: join them with /, and ask them things like .exists(). Needs "from pathlib import Path".', 'Path("data") / "in.txt"'),
  'Path.exists': d('p.exists() → bool', 'True if the file or folder at this path is really there.'),
  'Path.is_file': d('p.is_file() → bool', 'True if the path points to a file.'),
  'Path.is_dir': d('p.is_dir() → bool', 'True if the path points to a folder.'),
  'Path.read_text': d('p.read_text() → str', 'Reads the whole file and hands you its text — no open() needed.', 'Path("in.txt").read_text()'),
  'Path.write_text': d('p.write_text(text)', 'Writes text into the file, creating or replacing it in one step.'),
  'Path.glob': d('p.glob(pattern)', 'Finds paths inside a folder that match a pattern like "*.txt".', 'for f in Path(".").glob("*.py"):'),
  'Path.mkdir': d('p.mkdir(parents=False, exist_ok=False)', 'Makes the folder. Pass parents=True to create missing parents, exist_ok=True to stay quiet if it is already there.'),
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
    // Accepting any of these records the use, so a student's favourites climb.
  ].map((o) => recordable(lang, o))
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

/**
 * Is the caret where a fresh statement can begin? That is the only place a
 * statement snippet (`sout`, `scanner`, `fori`) or a declaration-only keyword
 * (`class`, `public`) belongs, so everywhere else they are withheld. Two "else"
 * cases matter:
 *   - mid-expression, after `=` `(` `,` `[` or an operator — the way VS Code
 *     won't offer `class` inside `int x = …`; and
 *   - right after a type, while you are naming a variable (`Scanner sc|`), where
 *     the `scanner` snippet would otherwise outrank the name you are typing and
 *     paste a *second* `Scanner …` on top of the one you already wrote.
 *
 * Conservative on purpose: only an empty line-so-far (indentation trimmed) or a
 * hard statement boundary — `{` `}` `;` — counts as a start. Anything else before
 * the word, an identifier or an operator alike, holds the statement set back, so
 * it shows exactly where a statement can open and nowhere it would shadow a name.
 */
function atStatementStart(state: EditorState, wordFrom: number): boolean {
  const line = state.doc.lineAt(wordFrom)
  const pre = state.sliceDoc(line.from, wordFrom).replace(/\s+$/, '')
  return pre === '' || '{};'.includes(pre[pre.length - 1])
}

/** Snippets that belong *inside* an expression, not at a statement start — a
 *  lambda, a comprehension, a ternary, an f-string. These are the exception to
 *  the "snippets are withheld mid-expression" rule below, so they surface exactly
 *  where they are written (after `=`, `(`, a comma). Their labels do not collide
 *  with a `Type name` pattern, so they never shadow a variable you are naming. */
const EXPRESSION_SNIPPETS: Record<CompletionLang, ReadonlySet<string>> = {
  java: new Set(['lambda']),
  python: new Set(['fstr', 'lambda', 'ternary', 'comp', 'dcomp']),
}

const statementOnly = (lang: CompletionLang, o: Completion): boolean =>
  (o.type === 'snippet' && !EXPRESSION_SNIPPETS[lang].has(o.label)) ||
  (o.type === 'keyword' && STATEMENT_ONLY[lang].has(o.label))

/**
 * The `[validFor, match]` pair `completeFromList` would pick for a set of labels
 * — mirrored here (its own copy is private) so the option list can be re-boosted
 * by usage on every query while the token-matching stays byte-for-byte the same.
 * Plain word labels get the fast path; a dotted label (`System.out.println`,
 * `Math.abs`) falls back to a character-class built from every label.
 */
function listMatchers(options: readonly Completion[]): [RegExp, RegExp] {
  if (options.every((o) => /^\w+$/.test(o.label))) return [/\w*$/, /\w+$/]
  const first: Record<string, true> = Object.create(null)
  const rest: Record<string, true> = Object.create(null)
  for (const { label } of options) {
    first[label[0]] = true
    for (let i = 1; i < label.length; i++) rest[label[i]] = true
  }
  const source = charClass(first) + charClass(rest) + '*$'
  return [new RegExp('^' + source), new RegExp(source)]
}
/** A regex character class over the given chars, `\w` folded and the rest escaped
 *  — the shape `completeFromList`'s own `toSet` produces. */
function charClass(chars: Record<string, true>): string {
  let flat = Object.keys(chars).join('')
  const words = /\w/.test(flat)
  if (words) flat = flat.replace(/\w/g, '')
  return `[${words ? '\\w' : ''}${flat.replace(/[^\w\s]/g, '\\$&')}]`
}

/** Snippets, keywords and the API dictionary, re-ranked by what this student uses
 *  most (see usage.ts). Fires from the first character, since an abbreviation only
 *  pays off before you finish typing it. Steps aside in a `.` context, and — unless
 *  you asked explicitly — drops statement snippets and declaration keywords anywhere
 *  but the start of a statement, so they never shadow the variable name you are
 *  typing after a type. */
function staticSource(lang: CompletionLang): CompletionSource {
  const all = staticOptions(lang)
  const rest = all.filter((o) => !statementOnly(lang, o))
  const [validFor, match] = listMatchers(all)
  return (ctx: CompletionContext) => {
    if (memberContext(ctx.state, ctx.pos)) return null
    const token = ctx.matchBefore(match)
    if (!ctx.explicit && !token) return null
    const wordFrom = token ? token.from : ctx.pos
    const pool = !ctx.explicit && !atStatementStart(ctx.state, wordFrom) ? rest : all
    return { from: wordFrom, options: withUsageBoost(lang, pool), validFor }
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

/** Module functions offered after `os.` / `json.` / `re.` …, derived from
 *  `PYTHON_MODULE_API` so the two never drift. A module with a richer hand-written
 *  receiver (math, random, datetime…) overrides these inside memberSource. Nested
 *  paths (os.path) are skipped — a receiver is a single identifier, not `os.path`. */
function pythonModuleMembers(): Record<string, Completion[]> {
  const out: Record<string, Completion[]> = {}
  for (const [label, module, detail] of PYTHON_MODULE_API) {
    if (module.includes('.')) continue
    ;(out[module] ??= []).push({ label, type: 'function', detail, boost: 30, ...docInfo('python', `${module}.${label}`) })
  }
  return out
}

export function completionSources(lang: CompletionLang | null, projectWords: () => readonly string[]): CompletionSource[] {
  const collect = makeIdentifierCollector(lang, projectWords)
  // In a `.` context the member source owns the popup; the plain identifier source
  // stands down (the member source itself calls `collect` as its own fallback).
  const ident = ifNotIn(NOT_IN, (ctx: CompletionContext) =>
    lang && memberContext(ctx.state, ctx.pos) ? null : collect(ctx),
  )
  if (!lang) return [ident]
  const moduleMembers = lang === 'python' ? pythonModuleMembers() : undefined
  return [
    ifNotIn(NOT_IN, memberSource(lang, collect, moduleMembers)),
    ifNotIn(NOT_IN, importStatementSource(lang)),
    ifNotIn(NOT_IN, staticSource(lang)),
    ident,
  ]
}
