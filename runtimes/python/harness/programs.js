/* Test programs for the harness. The `template` scenario is NOT here -- it is
 * generated verbatim from content/templates/python-starter by build.mjs. */

export const PROGRAMS = {
  'input-twice': {
    label: 'input() twice',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `a = int(input("first number: "))
b = int(input("second number: "))
print(f"{a} + {b} = {a + b}")
`,
      },
    ],
  },

  'partial-prompt': {
    label: 'partial-line prompts',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `import sys

print("Each case must show its text BEFORE the input box appears.")
print("None of these call flush().")

a = input("A) input('prompt: ') -> ")
print("   got", repr(a))

print("B) print(end='') then bare input() -> ", end="")
b = input()
print("   got", repr(b))

sys.stdout.write("C) sys.stdout.write() then bare input() -> ")
c = input()
print("   got", repr(c))

print("D) partials:", end="")
print(" one", end="")
print(" two", end="")
d = input(" -> ")
print("   got", repr(d))

print("all reads completed, no EOFError")
`,
      },
    ],
  },

  traceback: {
    label: 'uncaught exception',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `from helpers.boom import explode

print("about to fail")
explode(0)
print("never reached")
`,
      },
      {
        path: 'helpers/boom.py',
        content: `def explode(factor):
    if factor <= 0:
        raise ValueError(f"factor must be positive, got {factor}")
    return factor
`,
      },
    ],
  },

  /* A warning, which is the cheapest way to catch stale linecache state.
   *
   * One interpreter serves every run, so the source line printed under a
   * warning is fetched from a cache that outlives the program. This scenario is
   * only meaningful when something else ran FIRST -- the self-test runs it
   * straight after `traceback`, whose main.py has a different line 3. If the
   * cache is not cleared per run, the warning prints that other program's line.
   * Keep line 3 as the warn() call, and keep this after `traceback`. */
  warning: {
    label: 'warning (stale source line)',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `import warnings

warnings.warn("this API is going away", DeprecationWarning)
print("still running")
`,
      },
    ],
  },

  'infinite-loop': {
    label: 'infinite loop',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `print("spinning forever -- press Stop to kill me")
n = 0
while True:
    n += 1
    if n % 2_000_000 == 0:
        print("still alive, iteration", n)
`,
      },
    ],
  },
}
