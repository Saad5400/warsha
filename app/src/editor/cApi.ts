import type { BuiltinDoc } from './completions'
import type { ApiRow, SnippetRow } from './csharpApi'

/**
 * C IntelliSense data — the stdio programs of a first C course (clang, one
 * `main.c`): snippets, the standard-library dictionary with doc cards, and the
 * header each function needs. Pure data; completions.ts registers it. C has no
 * methods, so `x.` / `p->` only offers the fields of the file's own structs
 * (typeIndex.ts scans them).
 */

const d = (signature: string, doc: string, example?: string): BuiltinDoc => ({ signature, doc, example })

/* ------------------------------------------------------------------ snippets */

/** Same-line braces, like the course's `main.c`. `printf` / `malloc` / `fopen` share a
 *  label with the dictionary function: at a statement start the full idiom leads, mid-expression only the function shows. */
export const C_SNIPPETS: readonly SnippetRow[] = [
  ['main', 'int main(void) {\n\t${}\n\treturn 0;\n}', 'the main function'],
  ['for', 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', 'count from 0'],
  ['fori', 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', 'count from 0'],
  ['while', 'while (${condition}) {\n\t${}\n}', 'repeat while true'],
  ['do', 'do {\n\t${}\n} while (${condition});', 'do / while'],
  ['if', 'if (${condition}) {\n\t${}\n}', 'if'],
  ['else', 'else {\n\t${}\n}', 'else'],
  ['switch', 'switch (${value}) {\n\tcase ${1}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', 'match a value'],
  ['struct', 'struct ${Name} {\n\t${int field};\n};', 'a struct'],
  ['typedef', 'typedef struct {\n\t${int field};\n} ${Name};', 'a struct with a short name'],
  ['printf', 'printf("${%d}\\n", ${value});', 'print a value and a newline'],
  ['pf', 'printf("${%d}\\n", ${value});', 'print a value and a newline'],
  ['scanf', 'scanf("${%d}", &${value});', 'read a value into a variable'],
  ['sf', 'scanf("${%d}", &${value});', 'read a value into a variable'],
  ['include', '#include <${stdio.h}>', 'use a library header'],
  ['inc', '#include <${stdio.h}>', 'use a library header'],
  ['func', '${int} ${name}(${}) {\n\t${}\n}', 'a function'],
  ['malloc', '${int} *${p} = malloc(${n} * sizeof(${int}));\nif (${p} == NULL) {\n\tprintf("Out of memory\\n");\n\treturn 1;\n}\n${}\nfree(${p});', 'reserve memory, check it, free it'],
  ['fopen', 'FILE *${fp} = fopen("${data.txt}", "${r}");\nif (${fp} == NULL) {\n\tprintf("Could not open the file\\n");\n\treturn 1;\n}\n${}\nfclose(${fp});', 'open a file, check it, close it'],
]

/* ------------------------------------------------------------ dictionary */

export const C_API: readonly ApiRow[] = [
  // stdio.h
  ['printf', 'print with a format'],
  ['scanf', 'read values the user types'],
  ['puts', 'print a line of text'],
  ['putchar', 'print one character'],
  ['getchar', 'read one character'],
  ['fgets', 'read a line into a buffer'],
  ['fopen', 'open a file'],
  ['fclose', 'close a file'],
  ['fprintf', 'print with a format, to a file'],
  ['fscanf', 'read values from a file'],
  ['sprintf', 'format into a string'],
  ['snprintf', 'format into a string, safely'],
  ['stdin', 'the keyboard, as a file', 'variable'],
  ['EOF', 'the "end of input" value', 'constant'],
  // stdlib.h
  ['malloc', 'reserve memory'],
  ['calloc', 'reserve memory, all zeros'],
  ['realloc', 'resize reserved memory'],
  ['free', 'give memory back'],
  ['exit', 'stop the program'],
  ['atoi', 'text to a whole number'],
  ['atof', 'text to a decimal number'],
  ['rand', 'a random whole number'],
  ['srand', 'seed the random numbers'],
  ['abs', 'distance from zero'],
  ['qsort', 'sort an array'],
  ['RAND_MAX', 'the largest rand() value', 'constant'],
  // string.h
  ['strlen', 'how many characters'],
  ['strcpy', 'copy a string'],
  ['strncpy', 'copy at most n characters'],
  ['strcat', 'add a string onto the end'],
  ['strcmp', 'compare two strings'],
  ['strncmp', 'compare the first n characters'],
  ['strchr', 'find a character'],
  ['strstr', 'find a piece of text'],
  ['memset', 'fill memory with one byte'],
  ['memcpy', 'copy a block of memory'],
  // math.h
  ['sqrt', 'square root'],
  ['pow', 'a number to a power'],
  ['fabs', 'distance from zero, for decimals'],
  ['floor', 'round down'],
  ['ceil', 'round up'],
  ['round', 'round to the nearest'],
  ['sin', 'sine, in radians'],
  ['cos', 'cosine, in radians'],
  // ctype.h
  ['isdigit', 'is it 0-9?'],
  ['isalpha', 'is it a letter?'],
  ['isspace', 'a space, tab or newline?'],
  ['toupper', 'the capital version'],
  ['tolower', 'the lower-case version'],
  // time.h
  ['time', 'seconds since 1970'],
]

/** The header each dictionary name lives in — accepting it adds the `#include` if the file lacks it. */
export const C_HEADERS: Readonly<Record<string, string>> = Object.fromEntries(
  (
    [
      ['stdio.h', 'printf scanf puts putchar getchar fgets fopen fclose fprintf fscanf sprintf snprintf stdin EOF'],
      ['stdlib.h', 'malloc calloc realloc free exit atoi atof rand srand abs qsort RAND_MAX'],
      ['string.h', 'strlen strcpy strncpy strcat strcmp strncmp strchr strstr memset memcpy'],
      ['math.h', 'sqrt pow fabs floor ceil round sin cos'],
      ['ctype.h', 'isdigit isalpha isspace toupper tolower'],
      ['time.h', 'time'],
    ] as const
  ).flatMap(([header, names]) => names.split(' ').map((n) => [n, header])),
)

/** What `#include <|` offers. */
export const C_STD_HEADERS: readonly (readonly [string, string])[] = [
  ['stdio.h', 'printf, scanf, files'],
  ['stdlib.h', 'malloc, free, atoi, rand'],
  ['string.h', 'strlen, strcpy, strcmp'],
  ['math.h', 'sqrt, pow, floor'],
  ['ctype.h', 'isdigit, toupper'],
  ['time.h', 'time, for srand'],
  ['stdbool.h', 'bool, true, false'],
  ['limits.h', 'INT_MAX, INT_MIN'],
]

/* ----------------------------------------------------------------- docs */

export const C_DOCS: Record<string, BuiltinDoc> = {
  printf: d('int printf(const char *format, ...)', 'Prints text, filling each % slot with the next value: %d whole number, %f decimal, %c character, %s string. \\n ends the line.', 'printf("%s is %d\\n", name, age);'),
  scanf: d('int scanf(const char *format, ...)', 'Reads what the user types into variables — pass each one’s address with &. A string (char array) needs no &. Returns how many values it read.', 'scanf("%d", &age);'),
  puts: d('int puts(const char *s)', 'Prints the text and a newline.', 'puts("Hello");'),
  putchar: d('int putchar(int c)', 'Prints one character.', "putchar('A');"),
  getchar: d('int getchar(void)', 'Reads one character the user types (EOF at the end of input).'),
  fgets: d('char *fgets(char *buf, int size, FILE *stream)', 'Reads one line (keeping the \\n) into buf, at most size - 1 characters. Safer than scanf("%s") for text with spaces. NULL at the end of input.', 'fgets(line, sizeof line, stdin);'),
  fopen: d('FILE *fopen(const char *path, const char *mode)', 'Opens a file: mode "r" to read, "w" to write (replacing), "a" to add to the end. NULL if it could not be opened — always check.', 'FILE *fp = fopen("data.txt", "r");'),
  fclose: d('int fclose(FILE *fp)', 'Closes a file opened with fopen, saving what was written.'),
  fprintf: d('int fprintf(FILE *fp, const char *format, ...)', 'printf, but into a file.', 'fprintf(fp, "%d\\n", score);'),
  fscanf: d('int fscanf(FILE *fp, const char *format, ...)', 'scanf, but from a file. Returns how many values it read, or EOF at the end.'),
  sprintf: d('int sprintf(char *buf, const char *format, ...)', 'printf, but into a char array. The array must be big enough — snprintf is safer.'),
  snprintf: d('int snprintf(char *buf, size_t size, const char *format, ...)', 'Formats into buf, never writing more than size characters.', 'snprintf(msg, sizeof msg, "Hi %s", name);'),
  malloc: d('void *malloc(size_t size)', 'Reserves size bytes of memory and returns a pointer to it, or NULL. Give it back with free when done.', 'int *a = malloc(n * sizeof(int));'),
  calloc: d('void *calloc(size_t count, size_t size)', 'Like malloc, for count items of size bytes each, all set to zero.'),
  realloc: d('void *realloc(void *p, size_t size)', 'Grows or shrinks memory from malloc, keeping its contents. Returns the new pointer (or NULL).'),
  free: d('void free(void *p)', 'Gives back memory from malloc / calloc / realloc. Do not use p afterwards.'),
  exit: d('void exit(int status)', 'Ends the program at once. 0 means success.'),
  atoi: d('int atoi(const char *s)', 'Turns text like "42" into the number 42 (0 if it is not a number).'),
  atof: d('double atof(const char *s)', 'Turns text like "3.5" into a double.'),
  rand: d('int rand(void)', 'A random whole number from 0 to RAND_MAX. rand() % 6 + 1 is a dice roll. Seed once with srand(time(NULL)).'),
  srand: d('void srand(unsigned seed)', 'Seeds rand so each run is different.', 'srand(time(NULL));'),
  abs: d('int abs(int x)', 'The number without its minus sign. For doubles use fabs.'),
  qsort: d('void qsort(void *base, size_t n, size_t size, int (*compare)(const void *, const void *))', 'Sorts an array, using your compare function to order two elements.'),
  strlen: d('size_t strlen(const char *s)', 'How many characters before the closing \\0.', 'strlen("hello") // 5'),
  strcpy: d('char *strcpy(char *dest, const char *src)', 'Copies src into dest (dest must be big enough). You cannot copy strings with =.'),
  strncpy: d('char *strncpy(char *dest, const char *src, size_t n)', 'Copies at most n characters. May leave dest without a closing \\0.'),
  strcat: d('char *strcat(char *dest, const char *src)', 'Adds src onto the end of dest (dest must have room).'),
  strcmp: d('int strcmp(const char *a, const char *b)', '0 when the strings are equal, negative when a comes first, positive when b does. You cannot compare strings with ==.', 'if (strcmp(answer, "yes") == 0) { … }'),
  strncmp: d('int strncmp(const char *a, const char *b, size_t n)', 'strcmp on the first n characters only.'),
  strchr: d('char *strchr(const char *s, int c)', 'A pointer to the first c in s, or NULL.'),
  strstr: d('char *strstr(const char *s, const char *part)', 'A pointer to where part first appears in s, or NULL.'),
  memset: d('void *memset(void *p, int value, size_t n)', 'Sets n bytes to value — usually 0 to clear an array.', 'memset(counts, 0, sizeof counts);'),
  memcpy: d('void *memcpy(void *dest, const void *src, size_t n)', 'Copies n bytes from src to dest.'),
  sqrt: d('double sqrt(double x)', 'The square root of x. Link with -lm on some systems.', 'sqrt(16.0) // 4.0'),
  pow: d('double pow(double x, double y)', 'x to the power y.', 'pow(2, 10) // 1024.0'),
  fabs: d('double fabs(double x)', 'abs for doubles.'),
  floor: d('double floor(double x)', 'Rounds down.', 'floor(2.9) // 2.0'),
  ceil: d('double ceil(double x)', 'Rounds up.', 'ceil(2.1) // 3.0'),
  round: d('double round(double x)', 'Rounds to the nearest whole number; halves go away from zero.'),
  isdigit: d('int isdigit(int c)', 'Non-zero (true) when c is 0-9.'),
  isalpha: d('int isalpha(int c)', 'Non-zero (true) when c is a letter.'),
  isspace: d('int isspace(int c)', 'Non-zero (true) for a space, tab or newline.'),
  toupper: d('int toupper(int c)', 'The capital version of a letter; anything else is returned unchanged.'),
  tolower: d('int tolower(int c)', 'The lower-case version of a letter.'),
  time: d('time_t time(time_t *t)', 'Seconds since 1 January 1970. time(NULL) is the usual seed for srand.'),
  EOF: d('EOF', 'The value getchar / scanf / fscanf return at the end of input (-1).'),
  stdin: d('FILE *stdin', 'The keyboard, as a file — pass it to fgets.', 'fgets(line, sizeof line, stdin);'),
}
