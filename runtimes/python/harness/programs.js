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

  /* asyncio.run() cannot work in this runner (see worker.js's asyncio guard and
   * INTEGRATION.md): the coroutine awaits something, so if the guard did not
   * replace run()/run_until_complete()/run_forever() outright, this would
   * schedule a Task that fires later, out of band -- see `asyncio-clean-after`,
   * which exists solely to catch that bleed. */
  'asyncio-run': {
    label: 'asyncio.run() (not supported)',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `import asyncio

print("before asyncio.run")


async def main():
    print("inside coroutine, before await -- should never run")
    await asyncio.sleep(0.01)
    print("inside coroutine, after await -- should never run")
    raise ValueError("boom from inside the coroutine -- should never run")


asyncio.run(main())
print("after asyncio.run -- should never run")
`,
      },
    ],
  },

  /* Deliberately the plainest possible program. Its ONLY job is to run right
   * after `asyncio-run` and come back byte-identical to what it would print on
   * its own -- any leftover "Task exception was never retrieved", the
   * coroutine's "boom from inside the coroutine", or a second copy of the
   * guard's RuntimeError landing here is the exact bleed this scenario exists
   * to catch. */
  'asyncio-clean-after': {
    label: 'clean run after asyncio.run()',
    entry: 'main.py',
    files: [
      {
        path: 'main.py',
        content: `print("clean run, should be pristine")
`,
      },
    ],
  },
}
