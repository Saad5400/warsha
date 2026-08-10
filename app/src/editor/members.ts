import type { EditorState } from '@codemirror/state'
import type { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete'
import type { LangId } from '../runtime'
import { recordable, withUsageBoost } from './usage'

/**
 * The third gap: `variable.` should offer that variable's methods. There is
 * no language server here, so "the variable's type" is a guess from scanning
 * the document as text — `Scanner sc = new Scanner(...)` makes `sc` a
 * Scanner, `xs = [...]` makes `xs` a Python list. Wrong or absent for
 * anything cleverer (reassignment, a method's return type, a parameter) — a
 * beginner course's own code rarely is.
 *
 * The scan only ever looks at the text *before* the dot the student just
 * typed, and only when a `name.` context is actually detected (bounded
 * look-back below), so it never runs on every keystroke of an unrelated
 * line. The single-slot memo further skips re-scanning while the student
 * types the member name itself, since the text before the dot has not moved.
 */

const method = (label: string, detail: string): Completion => ({ label, type: 'method', detail, boost: 30 })

export const JAVA_MEMBERS: Record<string, readonly Completion[]> = {
  Scanner: [
    method('nextLine', 'String — read one whole line'),
    method('nextInt', 'int — read a whole number'),
    method('nextDouble', 'double — read a decimal number'),
    method('next', 'String — read one word'),
    method('hasNextLine', 'boolean — is there another line?'),
    method('hasNextInt', 'boolean — is the next thing a number?'),
    method('hasNext', 'boolean — is there anything left to read?'),
    method('close', 'void — stop reading'),
  ],
  String: [
    method('length', 'int — how many characters'),
    method('charAt', 'char, at(int) — the character at a position'),
    method('substring', 'String, (int, int) — a piece of the text'),
    method('equals', 'boolean, (Object) — are these the same?'),
    method('equalsIgnoreCase', 'boolean, (String) — the same, ignoring capitals'),
    method('toUpperCase', 'String — ALL CAPITALS'),
    method('toLowerCase', 'String — all lower case'),
    method('trim', 'String — remove spaces at both ends'),
    method('split', 'String[], (String) — break text into pieces'),
    method('contains', 'boolean, (CharSequence) — does it contain this?'),
    method('indexOf', 'int, (String) — where this appears, or -1'),
    method('replace', 'String, (CharSequence, CharSequence) — swap one piece for another'),
    method('isEmpty', 'boolean — is it empty?'),
    method('isBlank', 'boolean — empty or only spaces? (Java 11+)'),
    method('strip', 'String — remove spaces at both ends (Java 11+)'),
    method('repeat', 'String, (int) — the text repeated n times (Java 11+)'),
    method('lines', 'Stream<String> — split into lines (Java 11+)'),
    method('formatted', 'String, (args…) — fill in the blanks, like printf (Java 15+)'),
    method('compareTo', 'int, (String) — alphabetical order'),
    method('startsWith', 'boolean, (String) — does it start with this?'),
    method('endsWith', 'boolean, (String) — does it end with this?'),
    method('concat', 'String, (String) — glue text onto the end'),
    method('lastIndexOf', 'int, (String) — where this last appears, or -1'),
    method('replaceAll', 'String, (regex, repl) — swap every match of a pattern'),
    method('replaceFirst', 'String, (regex, repl) — swap the first match of a pattern'),
    method('matches', 'boolean, (regex) — does the whole text fit this pattern?'),
    method('compareToIgnoreCase', 'int, (String) — alphabetical order, ignoring capitals'),
    method('toCharArray', 'char[] — the text as an array of characters'),
    method('getBytes', 'byte[] — the text as raw bytes'),
    method('chars', 'IntStream — the characters as a stream of code points'),
    method('intern', 'String — the one shared copy of this exact text'),
    method('toString', 'String — this text'),
  ],
  ArrayList: [
    method('add', 'boolean, (E) — put something in'),
    method('get', 'E, (int) — the item at a position'),
    method('set', 'E, (int, E) — replace the item at a position'),
    method('size', 'int — how many items'),
    method('remove', 'E, (int) — take something out'),
    method('isEmpty', 'boolean — is it empty?'),
    method('contains', 'boolean, (Object) — is this in the list?'),
    method('indexOf', 'int, (Object) — where an item is'),
    method('clear', 'void — remove everything'),
    method('forEach', 'void, (action) — do something with each item'),
    method('stream', 'Stream<E> — start a pipeline over the items'),
    method('addAll', 'boolean, (Collection) — add all of another collection'),
    method('removeIf', 'boolean, (predicate) — drop every item that matches'),
    method('sort', 'void, (Comparator) — put the list in order'),
    method('lastIndexOf', 'int, (Object) — where an item last appears, or -1'),
    method('subList', 'List<E>, (int, int) — a view of part of the list'),
    method('retainAll', 'boolean, (Collection) — keep only items also in another'),
    method('removeAll', 'boolean, (Collection) — remove any item also in another'),
    method('replaceAll', 'void, (operator) — change every item in place'),
    method('toArray', 'Object[] — the items as an array'),
    method('iterator', 'Iterator<E> — step through the items one by one'),
  ],
  HashMap: [
    method('put', 'V, (K, V) — store a value under a key'),
    method('get', 'V, (Object) — the value for a key'),
    method('getOrDefault', 'V, (Object, V) — the value for a key, or a fallback'),
    method('containsKey', 'boolean, (Object) — is this key in there?'),
    method('containsValue', 'boolean, (Object) — is this value in there?'),
    method('remove', 'V, (Object) — take a pair out'),
    method('size', 'int — how many pairs'),
    method('isEmpty', 'boolean — is it empty?'),
    method('keySet', 'Set<K> — all the keys'),
    method('values', 'Collection<V> — all the values'),
    method('entrySet', 'Set<Map.Entry<K,V>> — every key and value'),
    method('putIfAbsent', 'V, (K, V) — store only if the key is new'),
    method('merge', 'V, (K, V, fn) — combine a new value with any existing one'),
    method('computeIfAbsent', 'V, (K, fn) — fill a missing key using a function'),
    method('computeIfPresent', 'V, (K, fn) — update a key only if it is there'),
    method('compute', 'V, (K, fn) — work out a new value from the old one'),
    method('putAll', 'void, (Map) — copy in all of another map'),
    method('replace', 'V, (K, V) — change a value only if the key exists'),
    method('forEach', 'void, (action) — do something with each pair'),
    method('clear', 'void — remove every pair'),
  ],
  Math: [
    method('abs', 'double, (double) — distance from zero'),
    method('max', '(double, double) — the larger of two'),
    method('min', '(double, double) — the smaller of two'),
    method('pow', 'double, (double, double) — to the power of'),
    method('sqrt', 'double, (double) — square root'),
    method('cbrt', 'double, (double) — cube root'),
    method('round', 'long, (double) — to the nearest whole number'),
    method('floor', 'double, (double) — round down'),
    method('ceil', 'double, (double) — round up'),
    method('random', 'double — a random number from 0 to 1'),
    method('log', 'double, (double) — natural logarithm (base e)'),
    method('log10', 'double, (double) — logarithm base 10'),
    method('exp', 'double, (double) — e to this power'),
    method('sin', 'double, (double) — sine of an angle in radians'),
    method('cos', 'double, (double) — cosine of an angle in radians'),
    method('tan', 'double, (double) — tangent of an angle in radians'),
    method('toRadians', 'double, (double) — degrees as radians'),
    method('toDegrees', 'double, (double) — radians as degrees'),
    method('hypot', 'double, (double, double) — the hypotenuse, √(x²+y²)'),
    method('signum', 'double, (double) — the sign: -1, 0 or 1'),
    method('floorDiv', 'int, (int, int) — divide and round down'),
    method('floorMod', 'int, (int, int) — the remainder, matching floorDiv'),
    { label: 'PI', type: 'constant', detail: '3.14159…, the circle constant', boost: 30 },
    { label: 'E', type: 'constant', detail: "2.71828…, Euler's number", boost: 30 },
  ],
  Arrays: [
    method('sort', 'void, (int[]) — put an array in order'),
    method('toString', 'String, (int[]) — an array as text'),
    method('fill', 'void, (int[], val) — set every slot to the same value'),
    method('asList', 'List<T>, (T...) — an array as a list'),
    method('equals', 'boolean, (a, b) — are these two arrays the same?'),
    method('copyOf', 'T[], (arr, int) — a copy, resized'),
    method('copyOfRange', 'T[], (arr, int, int) — a copy of part of an array'),
    method('binarySearch', 'int, (arr, key) — find a key in a sorted array'),
    method('stream', 'Stream, (arr) — start a pipeline over an array'),
    method('deepToString', 'String, (arr[][]) — a nested array as text'),
  ],
  Random: [
    method('nextInt', 'int, (int) — a random whole number below this'),
    method('nextDouble', 'double — a random decimal from 0 to 1'),
    method('nextBoolean', 'boolean — a random true or false'),
    method('nextLong', 'long — a random whole number'),
    method('nextFloat', 'float — a random decimal from 0 to 1'),
    method('nextGaussian', 'double — a random number around 0, bell-curved'),
    method('setSeed', 'void, (long) — restart the sequence from a seed'),
    method('ints', 'IntStream, (n, lo, hi) — a stream of random whole numbers'),
    method('doubles', 'DoubleStream, (n) — a stream of random decimals'),
  ],
  StringBuilder: [
    method('append', 'StringBuilder, (x) — add to the end'),
    method('toString', 'String — this text so far'),
    method('length', 'int — how many characters'),
    method('reverse', 'StringBuilder — back to front'),
    method('insert', 'StringBuilder, (int, x) — add at a position'),
    method('deleteCharAt', 'StringBuilder, (int) — remove one character'),
    method('delete', 'StringBuilder, (int, int) — remove a range of characters'),
    method('replace', 'StringBuilder, (int, int, String) — swap a range for new text'),
    method('indexOf', 'int, (String) — where this appears, or -1'),
    method('substring', 'String, (int, int) — a piece of the text so far'),
    method('charAt', 'char, (int) — the character at a position'),
    method('setCharAt', 'void, (int, char) — replace one character'),
    method('setLength', 'void, (int) — grow or trim to this length'),
    method('capacity', 'int — how much room it has before growing'),
  ],
  // Modern Java (9–17). These are the static-factory holders, so `List.` /
  // `Optional.` / `Collectors.` offer what a Java 17 course actually types.
  List: [
    method('of', 'List<E>, (E...) — a fixed list of these items'),
    method('copyOf', 'List<E>, (Collection) — a fixed copy of another collection'),
  ],
  Map: [
    method('of', 'Map<K,V>, (k, v, …) — a fixed map of these pairs'),
    method('copyOf', 'Map<K,V>, (Map) — a fixed copy of another map'),
    method('entry', 'Entry<K,V>, (k, v) — one key/value pair'),
  ],
  Set: [
    method('of', 'Set<E>, (E...) — a fixed set of these items, no repeats'),
    method('copyOf', 'Set<E>, (Collection) — a fixed copy, no repeats'),
  ],
  Optional: [
    method('of', 'Optional<T>, (T) — wrap a value that is definitely there'),
    method('ofNullable', 'Optional<T>, (T) — wrap a value that might be null'),
    method('empty', 'Optional<T> — an Optional holding nothing'),
    method('isPresent', 'boolean — is there a value?'),
    method('isEmpty', 'boolean — is it empty?'),
    method('get', 'T — the value (throws if empty)'),
    method('orElse', 'T, (T) — the value, or this fallback'),
    method('ifPresent', 'void, (action) — run code only if there is a value'),
    method('map', 'Optional<U>, (fn) — transform the value if present'),
    method('flatMap', 'Optional<U>, (fn) — transform into another Optional and flatten'),
    method('filter', 'Optional<T>, (predicate) — keep the value only if it passes'),
    method('orElseGet', 'T, (supplier) — the value, or one worked out on demand'),
    method('orElseThrow', 'T, (supplier) — the value, or throw your exception'),
    method('ifPresentOrElse', 'void, (action, empty) — one path if present, another if not'),
  ],
  Stream: [
    method('of', 'Stream<T>, (T...) — a stream of these items'),
    method('empty', 'Stream<T> — a stream with no items'),
    method('iterate', 'Stream<T>, (seed, fn) — build a stream step by step'),
    method('generate', 'Stream<T>, (supplier) — an endless stream from a supplier'),
    method('concat', 'Stream<T>, (a, b) — join two streams end to end'),
  ],
  Collectors: [
    method('toList', 'Collector — gather into a list'),
    method('toSet', 'Collector — gather into a set, no repeats'),
    method('joining', 'Collector, (sep) — glue the pieces into one String'),
    method('groupingBy', 'Collector, (fn) — group items by a key'),
    method('counting', 'Collector — count the items in each group'),
    method('toMap', 'Collector, (keyFn, valFn) — gather into a map'),
    method('partitioningBy', 'Collector, (predicate) — split into true and false groups'),
    method('summingInt', 'Collector, (fn) — add up a number from each item'),
    method('averagingDouble', 'Collector, (fn) — the average of a number from each item'),
    method('mapping', 'Collector, (fn, downstream) — transform, then gather'),
    method('toUnmodifiableList', 'Collector — gather into a read-only list'),
  ],
  Collections: [
    method('sort', 'void, (List) — put a list in order'),
    method('reverse', 'void, (List) — flip a list back to front'),
    method('shuffle', 'void, (List) — mix a list randomly'),
    method('max', 'T, (Collection) — the largest item'),
    method('min', 'T, (Collection) — the smallest item'),
    method('emptyList', 'List<T> — a fixed empty list'),
    method('frequency', 'int, (Collection, Object) — how many times an item appears'),
    method('unmodifiableList', 'List<T>, (List) — a read-only view of a list'),
    method('nCopies', 'List<T>, (int, T) — a list of the same item repeated'),
    method('binarySearch', 'int, (List, key) — find a key in a sorted list'),
    method('swap', 'void, (List, int, int) — swap two items by position'),
    method('fill', 'void, (List, T) — set every slot to the same value'),
    method('addAll', 'boolean, (List, T...) — add several items at once'),
  ],
  Integer: [
    method('parseInt', 'int, (String) — text as a whole number'),
    method('valueOf', 'Integer, (String) — text as an Integer'),
    method('toString', 'String, (int) — a number as text'),
    method('toBinaryString', 'String, (int) — a number in base 2, as text'),
    method('toHexString', 'String, (int) — a number in base 16, as text'),
    method('compare', 'int, (int, int) — order two numbers: negative, 0 or positive'),
    { label: 'MAX_VALUE', type: 'constant', detail: 'the largest int', boost: 30 },
    { label: 'MIN_VALUE', type: 'constant', detail: 'the smallest int', boost: 30 },
  ],
  Long: [
    method('parseLong', 'long, (String) — text as a whole number'),
    method('valueOf', 'Long, (String) — text as a Long'),
    method('toString', 'String, (long) — a number as text'),
    method('compare', 'int, (long, long) — order two numbers'),
    { label: 'MAX_VALUE', type: 'constant', detail: 'the largest long', boost: 30 },
    { label: 'MIN_VALUE', type: 'constant', detail: 'the smallest long', boost: 30 },
  ],
  Double: [
    method('parseDouble', 'double, (String) — text as a decimal number'),
    method('valueOf', 'Double, (String) — text as a Double'),
    method('toString', 'String, (double) — a decimal as text'),
    method('compare', 'int, (double, double) — order two numbers'),
    method('isNaN', 'boolean, (double) — is this "not a number"?'),
    method('isInfinite', 'boolean, (double) — is this infinity?'),
    { label: 'MAX_VALUE', type: 'constant', detail: 'the largest double', boost: 30 },
    { label: 'MIN_VALUE', type: 'constant', detail: 'the smallest positive double', boost: 30 },
  ],
  Boolean: [
    method('parseBoolean', 'boolean, (String) — text as true or false'),
    method('valueOf', 'Boolean, (String) — text as a Boolean'),
    method('toString', 'String, (boolean) — true or false as text'),
    method('compare', 'int, (boolean, boolean) — order two booleans, false first'),
    { label: 'TRUE', type: 'constant', detail: 'the boxed true', boost: 30 },
    { label: 'FALSE', type: 'constant', detail: 'the boxed false', boost: 30 },
  ],
  Character: [
    method('isDigit', 'boolean, (char) — is this a digit 0-9?'),
    method('isLetter', 'boolean, (char) — is this a letter?'),
    method('isLetterOrDigit', 'boolean, (char) — a letter or a digit?'),
    method('isWhitespace', 'boolean, (char) — a space, tab or newline?'),
    method('isUpperCase', 'boolean, (char) — is this a capital letter?'),
    method('isLowerCase', 'boolean, (char) — is this a small letter?'),
    method('toUpperCase', 'char, (char) — the capital form of this character'),
    method('toLowerCase', 'char, (char) — the small form of this character'),
    method('getNumericValue', 'int, (char) — the digit a character stands for'),
  ],
  System: [
    { label: 'in', type: 'variable', detail: 'InputStream — the keyboard input stream', boost: 30 },
    { label: 'out', type: 'variable', detail: 'PrintStream — the normal output stream', boost: 30 },
    { label: 'err', type: 'variable', detail: 'PrintStream — the error output stream', boost: 30 },
    method('exit', 'void, (int) — stop the whole program now'),
    method('currentTimeMillis', 'long — milliseconds since 1970'),
    method('nanoTime', 'long — a high-resolution timer, in nanoseconds'),
    method('arraycopy', 'void, (src, from, dst, to, n) — copy part of one array into another'),
    method('getProperty', 'String, (String) — a system setting, like "user.dir"'),
    method('lineSeparator', 'String — the line break for this system'),
    method('getenv', 'String, (String) — an environment variable'),
  ],
  // What `System.out.` / `System.err.` offer — a student writing them out in
  // full still gets the print family, not just word-based guesses.
  PrintStream: [
    method('println', 'void, (value) — print a line'),
    method('print', 'void, (value) — print with no line break'),
    method('printf', 'void, (format, args…) — print with a format'),
    method('format', 'PrintStream, (format, args…) — print with a format'),
    method('flush', 'void — push everything out now'),
  ],
  LinkedList: [
    method('add', 'boolean, (E) — add to the end'),
    method('addFirst', 'void, (E) — add to the front'),
    method('addLast', 'void, (E) — add to the end'),
    method('get', 'E, (int) — the item at a position'),
    method('getFirst', 'E — the first item'),
    method('getLast', 'E — the last item'),
    method('removeFirst', 'E — take the first item out'),
    method('removeLast', 'E — take the last item out'),
    method('remove', 'E, (int) — take an item out by position'),
    method('offer', 'boolean, (E) — add to the end (queue style)'),
    method('poll', 'E — take the first item out, or null if empty'),
    method('peek', 'E — look at the first item without removing it'),
    method('push', 'void, (E) — add to the front (stack style)'),
    method('pop', 'E — take the first item off (stack style)'),
    method('size', 'int — how many items'),
    method('isEmpty', 'boolean — is it empty?'),
    method('contains', 'boolean, (Object) — is this in the list?'),
    method('indexOf', 'int, (Object) — where an item is, or -1'),
    method('clear', 'void — remove everything'),
    method('forEach', 'void, (action) — do something with each item'),
    method('iterator', 'Iterator<E> — step through the items'),
    method('stream', 'Stream<E> — start a pipeline over the items'),
  ],
  TreeMap: [
    method('put', 'V, (K, V) — store a value under a key'),
    method('get', 'V, (Object) — the value for a key'),
    method('getOrDefault', 'V, (Object, V) — the value for a key, or a fallback'),
    method('containsKey', 'boolean, (Object) — is this key in there?'),
    method('remove', 'V, (Object) — take a pair out'),
    method('size', 'int — how many pairs'),
    method('isEmpty', 'boolean — is it empty?'),
    method('keySet', 'Set<K> — all the keys, in order'),
    method('values', 'Collection<V> — all the values, by key order'),
    method('entrySet', 'Set<Map.Entry<K,V>> — every pair, in key order'),
    method('firstKey', 'K — the smallest key'),
    method('lastKey', 'K — the largest key'),
    method('floorKey', 'K, (K) — the largest key at or below this one'),
    method('ceilingKey', 'K, (K) — the smallest key at or above this one'),
    method('higherKey', 'K, (K) — the smallest key strictly above this'),
    method('lowerKey', 'K, (K) — the largest key strictly below this'),
    method('firstEntry', 'Map.Entry<K,V> — the pair with the smallest key'),
    method('lastEntry', 'Map.Entry<K,V> — the pair with the largest key'),
    method('headMap', 'SortedMap<K,V>, (K) — the pairs below a key'),
    method('tailMap', 'SortedMap<K,V>, (K) — the pairs from a key up'),
    method('forEach', 'void, (action) — do something with each pair'),
  ],
  LinkedHashMap: [
    method('put', 'V, (K, V) — store a value under a key'),
    method('get', 'V, (Object) — the value for a key'),
    method('getOrDefault', 'V, (Object, V) — the value for a key, or a fallback'),
    method('putIfAbsent', 'V, (K, V) — store only if the key is new'),
    method('containsKey', 'boolean, (Object) — is this key in there?'),
    method('remove', 'V, (Object) — take a pair out'),
    method('size', 'int — how many pairs'),
    method('isEmpty', 'boolean — is it empty?'),
    method('keySet', 'Set<K> — all the keys, in insertion order'),
    method('values', 'Collection<V> — all the values, in insertion order'),
    method('entrySet', 'Set<Map.Entry<K,V>> — every pair, in insertion order'),
    method('merge', 'V, (K, V, fn) — combine a new value with any existing one'),
    method('computeIfAbsent', 'V, (K, fn) — fill a missing key using a function'),
    method('forEach', 'void, (action) — do something with each pair'),
    method('clear', 'void — remove every pair'),
  ],
  HashSet: [
    method('add', 'boolean, (E) — put something in (ignored if already there)'),
    method('remove', 'boolean, (Object) — take something out'),
    method('contains', 'boolean, (Object) — is this in the set?'),
    method('size', 'int — how many items'),
    method('isEmpty', 'boolean — is it empty?'),
    method('clear', 'void — remove everything'),
    method('addAll', 'boolean, (Collection) — add all of another collection (a union)'),
    method('retainAll', 'boolean, (Collection) — keep only items also in another (an intersection)'),
    method('removeAll', 'boolean, (Collection) — remove any item also in another (a difference)'),
    method('containsAll', 'boolean, (Collection) — are all of these in the set?'),
    method('forEach', 'void, (action) — do something with each item'),
    method('iterator', 'Iterator<E> — step through the items'),
    method('stream', 'Stream<E> — start a pipeline over the items'),
  ],
  TreeSet: [
    method('add', 'boolean, (E) — put something in, keeping order'),
    method('remove', 'boolean, (Object) — take something out'),
    method('contains', 'boolean, (Object) — is this in the set?'),
    method('size', 'int — how many items'),
    method('isEmpty', 'boolean — is it empty?'),
    method('clear', 'void — remove everything'),
    method('first', 'E — the smallest item'),
    method('last', 'E — the largest item'),
    method('floor', 'E, (E) — the largest item at or below this one'),
    method('ceiling', 'E, (E) — the smallest item at or above this one'),
    method('higher', 'E, (E) — the smallest item strictly above this'),
    method('lower', 'E, (E) — the largest item strictly below this'),
    method('pollFirst', 'E — take the smallest item out'),
    method('pollLast', 'E — take the largest item out'),
    method('headSet', 'SortedSet<E>, (E) — the items below one'),
    method('tailSet', 'SortedSet<E>, (E) — the items from one up'),
    method('forEach', 'void, (action) — do something with each item'),
    method('iterator', 'Iterator<E> — step through the items in order'),
  ],
  LinkedHashSet: [
    method('add', 'boolean, (E) — put something in (ignored if already there)'),
    method('remove', 'boolean, (Object) — take something out'),
    method('contains', 'boolean, (Object) — is this in the set?'),
    method('size', 'int — how many items'),
    method('isEmpty', 'boolean — is it empty?'),
    method('clear', 'void — remove everything'),
    method('addAll', 'boolean, (Collection) — add all of another collection'),
    method('forEach', 'void, (action) — do something with each item, in insertion order'),
    method('iterator', 'Iterator<E> — step through the items, in insertion order'),
    method('stream', 'Stream<E> — start a pipeline over the items'),
  ],
  ArrayDeque: [
    method('offer', 'boolean, (E) — add to the end'),
    method('poll', 'E — take from the front, or null if empty'),
    method('peek', 'E — look at the front without removing it'),
    method('push', 'void, (E) — add to the front (stack style)'),
    method('pop', 'E — take from the front (stack style)'),
    method('addFirst', 'void, (E) — add to the front'),
    method('addLast', 'void, (E) — add to the end'),
    method('offerFirst', 'boolean, (E) — add to the front'),
    method('offerLast', 'boolean, (E) — add to the end'),
    method('pollFirst', 'E — take from the front, or null'),
    method('pollLast', 'E — take from the end, or null'),
    method('peekFirst', 'E — look at the front'),
    method('peekLast', 'E — look at the end'),
    method('getFirst', 'E — the front item (error if empty)'),
    method('getLast', 'E — the end item (error if empty)'),
    method('removeFirst', 'E — take the front item out'),
    method('removeLast', 'E — take the end item out'),
    method('size', 'int — how many items'),
    method('isEmpty', 'boolean — is it empty?'),
    method('contains', 'boolean, (Object) — is this in there?'),
    method('clear', 'void — remove everything'),
    method('forEach', 'void, (action) — do something with each item'),
    method('iterator', 'Iterator<E> — step through the items'),
  ],
  Stack: [
    method('push', 'E, (E) — put something on top'),
    method('pop', 'E — take the top item off'),
    method('peek', 'E — look at the top without removing it'),
    method('empty', 'boolean — is the stack empty?'),
    method('isEmpty', 'boolean — is it empty?'),
    method('size', 'int — how many items'),
    method('search', 'int, (Object) — how far down an item is, or -1'),
    method('contains', 'boolean, (Object) — is this in there?'),
    method('get', 'E, (int) — the item at a position'),
    method('clear', 'void — remove everything'),
  ],
  PriorityQueue: [
    method('offer', 'boolean, (E) — add an item, keeping the smallest ready'),
    method('add', 'boolean, (E) — add an item'),
    method('poll', 'E — take the smallest item out, or null if empty'),
    method('peek', 'E — look at the smallest item without removing it'),
    method('remove', 'boolean, (Object) — take a specific item out'),
    method('size', 'int — how many items'),
    method('isEmpty', 'boolean — is it empty?'),
    method('contains', 'boolean, (Object) — is this in there?'),
    method('clear', 'void — remove everything'),
    method('forEach', 'void, (action) — do something with each item'),
    method('iterator', 'Iterator<E> — step through the items (no order promised)'),
  ],
  Iterator: [
    method('hasNext', 'boolean — is there another item?'),
    method('next', 'E — the next item, and move forward'),
    method('remove', 'void — take out the item just returned'),
  ],
  Comparator: [
    method('comparing', 'Comparator<T>, (keyFn) — order by a key you pick out'),
    method('comparingInt', 'Comparator<T>, (keyFn) — order by an int key'),
    method('comparingDouble', 'Comparator<T>, (keyFn) — order by a decimal key'),
    method('naturalOrder', 'Comparator<T> — the built-in order, smallest first'),
    method('reverseOrder', 'Comparator<T> — the built-in order, reversed'),
    method('reversed', 'Comparator<T> — this order, flipped'),
    method('thenComparing', 'Comparator<T>, (keyFn) — break ties with another key'),
    method('thenComparingInt', 'Comparator<T>, (keyFn) — break ties with an int key'),
  ],
  IntStream: [
    method('range', 'IntStream, (int, int) — the whole numbers from a up to b'),
    method('rangeClosed', 'IntStream, (int, int) — the whole numbers from a to b, b included'),
    method('of', 'IntStream, (int...) — a stream of these numbers'),
    method('iterate', 'IntStream, (seed, fn) — build a number stream step by step'),
    method('generate', 'IntStream, (supplier) — an endless number stream'),
    method('sum', 'int — add every number up'),
    method('average', 'OptionalDouble — the mean of the numbers'),
    method('boxed', 'Stream<Integer> — turn the ints into Integer objects'),
    method('mapToObj', 'Stream<U>, (fn) — turn each number into an object'),
  ],
  File: [
    method('exists', 'boolean — does this file or folder exist?'),
    method('getName', 'String — just the file name, no folders'),
    method('getPath', 'String — the path as you gave it'),
    method('getAbsolutePath', 'String — the full path from the root'),
    method('isDirectory', 'boolean — is this a folder?'),
    method('isFile', 'boolean — is this a normal file?'),
    method('length', 'long — the size in bytes'),
    method('delete', 'boolean — remove the file, true if it worked'),
    method('createNewFile', 'boolean, throws IOException — make an empty file'),
    method('mkdir', 'boolean — make this folder'),
    method('mkdirs', 'boolean — make this folder and any missing parents'),
    method('listFiles', 'File[] — the files inside this folder'),
    method('renameTo', 'boolean, (File) — rename or move the file'),
    method('canRead', 'boolean — are we allowed to read it?'),
    method('canWrite', 'boolean — are we allowed to write it?'),
  ],
  BufferedReader: [
    method('readLine', 'String — read one whole line, or null at the end of the file'),
    method('lines', 'Stream<String> — all the remaining lines as a stream'),
    method('read', 'int — read one character, or -1 at the end'),
    method('ready', 'boolean — is a line waiting to be read?'),
    method('close', 'void — close the file when you are done'),
  ],
  BufferedWriter: [
    method('write', 'void, (String) — write some text'),
    method('newLine', 'void — start a new line'),
    method('flush', 'void — push everything out to the file now'),
    method('close', 'void — close the file when you are done'),
  ],
  PrintWriter: [
    method('println', 'void, (value) — write a line'),
    method('print', 'void, (value) — write with no line break'),
    method('printf', 'PrintWriter, (format, args…) — write with a format'),
    method('write', 'void, (String) — write some text'),
    method('format', 'PrintWriter, (format, args…) — write with a format'),
    method('flush', 'void — push everything out to the file now'),
    method('close', 'void — close the file when you are done'),
  ],
  FileWriter: [
    method('write', 'void, (String) — write some text to the file'),
    method('append', 'Writer, (char) — add a character to the end'),
    method('flush', 'void — push everything out to the file now'),
    method('close', 'void — close the file when you are done'),
  ],
  FileReader: [
    method('read', 'int — read one character, or -1 at the end'),
    method('close', 'void — close the file when you are done'),
  ],
  InputStreamReader: [
    method('read', 'int — read one character, or -1 at the end'),
    method('close', 'void — stop reading'),
  ],
  Files: [
    method('readAllLines', 'List<String>, (Path) — read the whole file as a list of lines'),
    method('readString', 'String, (Path) — read the whole file into one String (Java 11+)'),
    method('lines', 'Stream<String>, (Path) — the file as a stream of lines'),
    method('writeString', 'Path, (Path, text) — write text to a file, replacing it (Java 11+)'),
    method('write', 'Path, (Path, lines) — write a list of lines to a file'),
    method('readAllBytes', 'byte[], (Path) — read the whole file as raw bytes'),
    method('exists', 'boolean, (Path) — does this file exist?'),
    method('notExists', 'boolean, (Path) — is this file definitely missing?'),
    method('isDirectory', 'boolean, (Path) — is this a folder?'),
    method('isRegularFile', 'boolean, (Path) — is this a normal file?'),
    method('size', 'long, (Path) — the file size in bytes'),
    method('createFile', 'Path, (Path) — make an empty file'),
    method('createDirectories', 'Path, (Path) — make a folder and any missing parents'),
    method('delete', 'void, (Path) — remove the file'),
    method('deleteIfExists', 'boolean, (Path) — remove the file if it is there'),
    method('copy', 'Path, (from, to) — copy a file'),
    method('move', 'Path, (from, to) — move or rename a file'),
  ],
  Paths: [
    method('get', 'Path, (String, more…) — build a Path from text'),
  ],
  Path: [
    method('of', 'Path, (String, more…) — build a Path from text (Java 11+)'),
    method('getFileName', 'Path — just the file name, no folders'),
    method('getParent', 'Path — the folder this sits in'),
    method('resolve', 'Path, (String) — add a piece onto the end of the path'),
    method('toAbsolutePath', 'Path — the full path from the root'),
    method('toFile', 'File — this path as an old-style File'),
    method('getNameCount', 'int — how many parts the path has'),
    method('toString', 'String — the path as text'),
  ],
}

export const PYTHON_MEMBERS: Record<string, readonly Completion[]> = {
  str: [
    method('upper', '() — ALL CAPITALS'),
    method('lower', '() — all lower case'),
    method('strip', '() — remove spaces at both ends'),
    method('split', '(sep) — break text into pieces'),
    method('join', '(iterable) — glue pieces together with this between them'),
    method('replace', '(old, new) — swap one piece for another'),
    method('startswith', '(s) — does it start with this?'),
    method('endswith', '(s) — does it end with this?'),
    method('find', '(s) — where this appears, or -1'),
    method('format', '(*args) — fill in the blanks'),
    method('index', '(s) — where this appears'),
    method('count', '(s) — how many times it appears'),
    method('isdigit', '() — is it all digits?'),
    method('isalpha', '() — is it all letters?'),
    method('title', '() — Title Case'),
    method('capitalize', '() — Capitalize the first letter'),
    method('zfill', '(n) — pad with leading zeros'),
    method('rstrip', '(chars) — remove spaces (or chars) from the right'),
    method('lstrip', '(chars) — remove spaces (or chars) from the left'),
    method('isalnum', '() — is it all letters or digits?'),
    method('isspace', '() — is it all spaces?'),
    method('islower', '() — is it all lower case?'),
    method('isupper', '() — is it all CAPITALS?'),
    method('swapcase', '() — swap CAPS and lower case'),
    method('casefold', '() — lower case for comparing'),
    method('rfind', '(s) — where this last appears, or -1'),
    method('rindex', '(s) — where this last appears (error if missing)'),
    method('center', '(width) — pad both sides to a width'),
    method('ljust', '(width) — pad the right to a width'),
    method('rjust', '(width) — pad the left to a width'),
    method('partition', '(sep) — split into before, sep, after'),
    method('rpartition', '(sep) — split at the last sep'),
    method('splitlines', '() — split into a list of lines'),
    method('expandtabs', '(n) — turn tabs into spaces'),
    method('encode', '(encoding) — text to bytes'),
    method('removeprefix', '(s) — drop this from the start (3.9+)'),
    method('removesuffix', '(s) — drop this from the end (3.9+)'),
  ],
  list: [
    method('append', '(x) — add to the end'),
    method('extend', '(iterable) — add all of another list'),
    method('insert', '(i, x) — add at a position'),
    method('pop', '(i=-1) — take an item out, and return it'),
    method('remove', '(x) — take the first match out'),
    method('sort', '(key=, reverse=) — put in order'),
    method('reverse', '() — turn back to front'),
    method('index', '(x) — where an item is'),
    method('count', '(x) — how many times it appears'),
    method('clear', '() — remove everything'),
    method('copy', '() — a shallow copy'),
  ],
  dict: [
    method('keys', '() — all the keys'),
    method('values', '() — all the values'),
    method('items', '() — every key and value'),
    method('get', '(k, default) — the value for a key, or a fallback'),
    method('update', '(other) — merge in more pairs'),
    method('pop', '(k) — take a pair out, and return its value'),
    method('setdefault', '(k, default) — get a key, setting it if missing'),
    method('popitem', '() — take out the last pair, and return it'),
    method('fromkeys', '(keys, value) — a new dict built from keys'),
    method('clear', '() — remove everything'),
    method('copy', '() — a shallow copy'),
  ],
  set: [
    method('add', '(x) — put something in'),
    method('remove', '(x) — take something out (error if missing)'),
    method('discard', '(x) — take something out (no error if missing)'),
    method('union', '(other) — everything in either set'),
    method('intersection', '(other) — only what is in both sets'),
    method('difference', '(other) — what is only in this set'),
    method('issubset', '(other) — is every item also in other?'),
    method('issuperset', '(other) — does this hold all of other?'),
    method('symmetric_difference', '(other) — what is in just one set'),
    method('isdisjoint', '(other) — do they share nothing?'),
    method('update', '(other) — add all items from another set'),
    method('clear', '() — remove everything'),
    method('pop', '() — take an arbitrary item out'),
    method('copy', '() — a shallow copy'),
  ],
  math: [
    method('sqrt', '(x) — square root'),
    method('floor', '(x) — round down'),
    method('ceil', '(x) — round up'),
    method('pow', '(x, y) — to the power of'),
    method('factorial', '(n) — n!'),
    method('gcd', '(a, b) — greatest common divisor'),
    method('isqrt', '(n) — integer square root'),
    method('comb', '(n, k) — combinations, n choose k'),
    method('perm', '(n, k) — permutations of n taken k'),
    method('log', '(x, base=e) — natural log, or log to a base'),
    method('log2', '(x) — log base 2'),
    method('log10', '(x) — log base 10'),
    method('exp', '(x) — e to the power x'),
    method('sin', '(x) — sine, x in radians'),
    method('cos', '(x) — cosine, x in radians'),
    method('tan', '(x) — tangent, x in radians'),
    method('radians', '(deg) — degrees to radians'),
    method('degrees', '(rad) — radians to degrees'),
    method('hypot', '(x, y) — length of the hypotenuse'),
    method('dist', '(p, q) — distance between two points'),
    method('fabs', '(x) — absolute value, as a float'),
    method('trunc', '(x) — drop the decimal part'),
    method('isnan', '(x) — is it not-a-number?'),
    method('isinf', '(x) — is it infinity?'),
    { label: 'pi', type: 'constant', detail: '3.14159…', boost: 30 },
    { label: 'e', type: 'constant', detail: "2.71828…, Euler's number", boost: 30 },
    { label: 'inf', type: 'constant', detail: 'infinity', boost: 30 },
    { label: 'tau', type: 'constant', detail: '6.28318…, two pi', boost: 30 },
    { label: 'nan', type: 'constant', detail: 'not a number', boost: 30 },
  ],
  random: [
    method('randint', '(a, b) — a random whole number from a to b'),
    method('random', '() — a random decimal from 0 to 1'),
    method('choice', '(seq) — a random item from a list'),
    method('choices', '(seq, k=1) — k random items, repeats allowed'),
    method('shuffle', '(seq) — mix a list randomly, in place'),
    method('uniform', '(a, b) — a random decimal in a range'),
    method('sample', '(seq, k) — k random items, no repeats'),
    method('randrange', '(stop) — a random number from a range'),
    method('seed', '(n) — fix the sequence for repeatable runs'),
    method('getrandbits', '(n) — a random integer with n bits'),
  ],
  tuple: [
    method('count', '(x) — how many times it appears'),
    method('index', '(x) — where an item is'),
  ],
  file: [
    method('read', '(size) — the whole file, or size characters'),
    method('readline', '() — one line, newline included'),
    method('readlines', '() — every line as a list'),
    method('write', '(text) — add text to the file'),
    method('writelines', '(lines) — write a list of lines'),
    method('seek', '(pos) — jump to a position'),
    method('tell', '() — the current position'),
    method('flush', '() — push writes out now'),
    method('close', '() — finish with the file'),
  ],
  bytes: [
    method('decode', '(encoding) — bytes back to text'),
    method('hex', '() — as a hex string'),
  ],
  deque: [
    method('append', '(x) — add to the right end'),
    method('appendleft', '(x) — add to the left end'),
    method('pop', '() — take an item off the right'),
    method('popleft', '() — take an item off the left'),
    method('extend', '(iterable) — add many to the right'),
    method('extendleft', '(iterable) — add many to the left'),
    method('rotate', '(n) — shift items around by n'),
    method('clear', '() — remove everything'),
  ],
  Counter: [
    method('most_common', '(n) — the n most frequent, with counts'),
    method('elements', '() — each item repeated by its count'),
    method('update', '(iterable) — add more counts'),
    method('subtract', '(iterable) — take counts away'),
  ],
  datetime: [
    method('now', '() — the current date and time'),
    method('today', '() — the current date and time'),
    method('strptime', '(text, fmt) — read a datetime from text'),
    method('strftime', '(fmt) — format this datetime as text'),
    method('fromisoformat', '(text) — read an ISO datetime'),
    method('isoformat', '() — this datetime as ISO text'),
    method('weekday', '() — Monday is 0, Sunday is 6'),
  ],
  date: [
    method('today', "() — today's date"),
    method('fromisoformat', '(text) — read a date like 2026-08-10'),
    method('strftime', '(fmt) — format this date as text'),
    method('isoformat', '() — the date as YYYY-MM-DD text'),
    method('weekday', '() — Monday is 0, Sunday is 6'),
  ],
  Match: [
    method('group', '(n=0) — the matched text (or group n)'),
    method('groups', '() — all the captured groups'),
    method('start', '() — where the match begins'),
    method('end', '() — where the match ends'),
    method('span', '() — start and end as a pair'),
    method('groupdict', '() — named groups as a dict'),
  ],
  Path: [
    method('exists', '() — does this path exist?'),
    method('is_file', '() — is it a file?'),
    method('is_dir', '() — is it a folder?'),
    method('read_text', '() — read the whole file as text'),
    method('write_text', '(text) — write text to the file'),
    method('glob', '(pattern) — find matching paths inside'),
    method('mkdir', '(parents=False) — make this folder'),
    method('iterdir', '() — the entries in this folder'),
    method('joinpath', '(*parts) — add path pieces on'),
    method('with_suffix', '(ext) — swap the file extension'),
    { label: 'name', type: 'constant', detail: 'the file name with extension', boost: 30 },
    { label: 'stem', type: 'constant', detail: 'the file name without extension', boost: 30 },
    { label: 'suffix', type: 'constant', detail: 'the file extension', boost: 30 },
    { label: 'parent', type: 'constant', detail: 'the containing folder', boost: 30 },
  ],
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Types you call statically (`List.of`, `Optional.of`, `Math.abs`, `System.out`)
 *  — the class name itself is the receiver, no `new` and no variable to infer. */
const JAVA_STATIC_HOLDERS = new Set([
  'Math', 'Arrays', 'Collections', 'List', 'Map', 'Set', 'Optional', 'Collectors', 'Stream', 'IntStream',
  'Integer', 'Long', 'Double', 'Boolean', 'Character', 'System', 'Objects', 'Comparator', 'Files', 'Paths', 'Path',
])

function inferJavaType(doc: string, name: string): string | null {
  if (JAVA_STATIC_HOLDERS.has(name)) return name
  // `System.out.` / `System.err.` — the receiver name is `out`/`err`, and the
  // text right before the dot proves which. `doc` is everything up to the dot.
  if ((name === 'out' || name === 'err') && new RegExp(`\\bSystem\\.${name}$`).test(doc)) return 'PrintStream'
  const esc = escapeRe(name)
  // `name = new Type(` — covers `Type name = new Type(…)`, `var name = new Type(…)`
  // and any later reassignment (the last one wins). Resolves whenever a member
  // list exists for Type; anything else (a bare `int[]`, an unknown class) falls
  // through. Generalised from a fixed list so a new member receiver just works.
  const ctor = new RegExp(`\\b${esc}\\s*=\\s*new\\s+([A-Z][A-Za-z0-9_$]*)\\b`, 'g')
  let type: string | null = null
  let m: RegExpExecArray | null
  while ((m = ctor.exec(doc))) type = m[1]
  if (type && JAVA_MEMBERS[type]) return type
  if (new RegExp(`\\bString\\s+${esc}\\s*=`).test(doc)) return 'String'
  // `Path p = Paths.get(...)` — a Path comes from a factory, not `new`, so infer it
  // from the declared type.
  if (new RegExp(`\\bPath\\s+${esc}\\s*=`).test(doc)) return 'Path'
  return null
}

function inferPythonType(doc: string, name: string): string | null {
  const esc = escapeRe(name)
  // An imported module — `import os`, `from datetime import datetime`. The name is
  // returned whether or not we carry members for it; memberSource falls back when
  // there is nothing to offer, so an unknown module is harmless.
  if (new RegExp(`^\\s*(?:import|from)\\s+${esc}\\b`, 'm').test(doc)) return name
  const re = new RegExp(`\\b${esc}\\s*=\\s*([^\\n]+)`, 'g')
  let rhs: string | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(doc))) rhs = m[1].trim()
  if (!rhs) return null
  if (/^(?:rb|br|b)["']/.test(rhs)) return PYTHON_MEMBERS['bytes'] ? 'bytes' : null
  if (/^(?:[fr]{1,2})?["']/.test(rhs)) return 'str'
  if (rhs.startsWith('[')) return 'list'
  // `(a, b)` is a tuple; `(a + b)` is just a grouped expression — a comma tells them apart.
  if (rhs.startsWith('(')) return /,/.test(rhs) && PYTHON_MEMBERS['tuple'] ? 'tuple' : null
  if (rhs.startsWith('{')) {
    if (rhs === '{}') return 'dict'
    const close = rhs.lastIndexOf('}')
    const body = close === -1 ? rhs.slice(1) : rhs.slice(1, close)
    return /:/.test(body) ? 'dict' : 'set'
  }
  if (/^input\s*\(/.test(rhs)) return 'str' // `name = input(...)` — the classic first line
  if (/^open\s*\(/.test(rhs)) return PYTHON_MEMBERS['file'] ? 'file' : null
  if (/^re\.(?:match|search|fullmatch)\s*\(/.test(rhs)) return PYTHON_MEMBERS['Match'] ? 'Match' : null
  if (/^datetime(?:\.\w+)?\s*\(/.test(rhs)) return PYTHON_MEMBERS['datetime'] ? 'datetime' : null
  if (/^date(?:\.\w+)?\s*\(/.test(rhs)) return PYTHON_MEMBERS['date'] ? 'date' : null
  // `x = Thing(...)` — a constructor / factory we carry members for (Counter,
  // deque, Path, str, list, set, …).
  const call = /^([A-Za-z_][\w]*)\s*\(/.exec(rhs)
  if (call && PYTHON_MEMBERS[call[1]]) return call[1]
  return null
}

/** One-slot memo: the text before a given dot does not change while the member name after it is being typed. */
let memoKey = ''
let memoResult: string | null = null

function resolveReceiverType(lang: LangId, state: EditorState, name: string, dotPos: number): string | null {
  const key = `${lang}:${dotPos}:${name}`
  if (key === memoKey) return memoResult
  const doc = state.sliceDoc(0, dotPos)
  memoResult = lang === 'java' ? inferJavaType(doc, name) : inferPythonType(doc, name)
  memoKey = key
  return memoResult
}

const RECEIVER = /([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)?$/
/** Identifiers longer than this cannot be receivers worth resolving; bounds the look-back slice. */
const LOOKBACK = 80

export interface Receiver {
  /** The identifier before the dot — the thing whose members we want. */
  name: string
  /** What has been typed after the dot so far. */
  partial: string
  /** Where the member name starts — the completion's replace range. */
  from: number
  /** The position of the dot itself. */
  dotPos: number
}

/**
 * Is the caret sitting right after `receiver.`? Returns the pieces if so, else
 * `null`. Import / package lines are excluded — `import java.util.` is a path,
 * not a member access, and belongs to the import-statement source. Shared so
 * the other completion sources can step aside and leave a `.` context to the
 * member source alone (no `sout` or `class` after a dot).
 */
export function memberContext(state: EditorState, pos: number): Receiver | null {
  const line = state.doc.lineAt(pos)
  if (/^\s*(?:import|from|package)\b/.test(state.sliceDoc(line.from, pos))) return null
  const text = state.sliceDoc(Math.max(0, pos - LOOKBACK), pos)
  const m = RECEIVER.exec(text)
  if (!m) return null
  const partial = m[2] ?? ''
  return { name: m[1], partial, from: pos - partial.length, dotPos: pos - partial.length - 1 }
}

/* --------------------------------------------- rank a member list by what fits */

/** A rough "what type is wanted right where this call sits" — enough to float the
 *  obvious member to the top, never a real type checker. Java only. */
type Expected = 'int' | 'double' | 'String' | 'boolean' | 'char' | null

/** The return type a member advertises: the leading token of its `detail`, before
 *  the first comma or em dash. `null` when it does not lead with one (Python
 *  members, constants, generics like `Set<Map.Entry<…>>`). */
function returnType(detail: string | undefined): string | null {
  if (!detail) return null
  const tok = detail.split('—')[0].split(',')[0].trim().replace(/<.*>$/, '')
  return /^[A-Za-z_$][\w$]*$/.test(tok) ? tok : null
}

/** What type does the code seem to want, just left of the receiver? */
function expectedTypeBefore(state: EditorState, receiverStart: number): Expected {
  const line = state.doc.lineAt(receiverStart)
  const pre = state.sliceDoc(line.from, receiverStart).replace(/\s+$/, '')
  const assignOf = (t: string) => new RegExp(`\\b(?:${t})\\s+[A-Za-z_$][\\w$]*\\s*=$`).test(pre)
  if (assignOf('int|long|short|byte')) return 'int'
  if (assignOf('double|float')) return 'double'
  if (assignOf('String')) return 'String'
  if (assignOf('boolean')) return 'boolean'
  if (assignOf('char')) return 'char'
  // A condition: `if (`, `while (`, or right after a boolean operator.
  if (/(?:\bif|\bwhile)\s*\($/.test(pre) || /(?:&&|\|\||!)$/.test(pre)) return 'boolean'
  return null
}

function matchesExpected(expected: Expected, ret: string | null): boolean {
  if (!expected || !ret) return false
  switch (expected) {
    case 'int': return ['int', 'long', 'short', 'byte', 'Integer'].includes(ret)
    case 'double': return ['double', 'float', 'int', 'long', 'Double', 'Integer'].includes(ret)
    case 'String': return ret === 'String'
    case 'boolean': return ret === 'boolean' || ret === 'Boolean'
    case 'char': return ret === 'char'
  }
}

/** Members whose return type fits what's wanted float up (+15); when a value is
 *  wanted, `void` members sink (−8). Untouched when nothing is expected, and the
 *  shared constant objects are only cloned for the members that actually move. */
function rankByExpected(members: readonly Completion[], expected: Expected): Completion[] {
  if (!expected) return [...members]
  return members.map((m) => {
    const base = m.boost ?? 0
    const ret = returnType(m.detail)
    const boost = matchesExpected(expected, ret) ? base + 15 : ret === 'void' ? base - 8 : base
    return boost === base ? m : { ...m, boost }
  })
}

/** When the receiver's type is a mystery, this stands in — plain identifiers from
 *  the file, so a `.` after an unknown variable still offers *something* useful. */
export type MemberFallback = (ctx: CompletionContext) => CompletionResult | null

export function memberSource(
  lang: LangId,
  fallback?: MemberFallback,
  /** Extra Python receivers derived from the module dictionary (`os.`, `json.`,
   *  `re.`…), so a `module.` dot offers that module's functions. A receiver in
   *  the hand-written table wins over a derived one of the same name. */
  extra?: Record<string, readonly Completion[]>,
): CompletionSource {
  // Wrap each member once so accepting it records the use (usage.ts); the
  // per-query usage boost is added below, after expected-type ranking.
  const table = lang === 'java' ? JAVA_MEMBERS : { ...(extra ?? {}), ...PYTHON_MEMBERS }
  const wrapped: Record<string, readonly Completion[]> = {}
  for (const key in table) wrapped[key] = table[key].map((m) => recordable(lang, m))
  return (ctx: CompletionContext): CompletionResult | null => {
    const rc = memberContext(ctx.state, ctx.pos)
    if (!rc) return null
    const typeKey = resolveReceiverType(lang, ctx.state, rc.name, rc.dotPos)
    const members = typeKey ? wrapped[typeKey] : undefined
    if (!members) return fallback ? fallback(ctx) : null
    const options =
      lang === 'java' ? rankByExpected(members, expectedTypeBefore(ctx.state, rc.dotPos - rc.name.length)) : [...members]
    return { from: rc.from, options: withUsageBoost(lang, options), validFor: /^[\w$]*$/ }
  }
}
