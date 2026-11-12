/**
 * IPython syntax → Python, with line N of the output always line N of the
 * input — the invariant tracebacks, breakpoints and the debugger's stop arrow
 * all depend on. Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { statementStarts, transformCell } from '../../src/notebook/magics.ts'

const lines = (s: string) => s.split('\n')

/** Every transform must keep the line count — checked for every case below. */
function t(source: string) {
  const out = transformCell(source)
  assert.equal(lines(out.code).length, lines(source).length, `line count changed for:\n${source}`)
  return out
}

test('plain Python passes through untouched', () => {
  const src = 'x = 1\nfor i in range(3):\n    print(i % 2)\n'
  const out = t(src)
  assert.equal(out.code, src)
  assert.deepEqual(out.magicLines, [])
  assert.equal(out.cellMagic, null)
})

test('line magics become helper calls at the same indentation, carrying their line', () => {
  const out = t('import time\n%time total = sum(range(10))\nif True:\n    %who\n%matplotlib inline')
  assert.deepEqual(lines(out.code), [
    'import time',
    '_warsha_k.line_magic("time", "total = sum(range(10))", 2)',
    'if True:',
    '    _warsha_k.line_magic("who", "", 4)',
    '_warsha_k.line_magic("matplotlib", "inline", 5)',
  ])
  assert.deepEqual(out.magicLines, [2, 4, 5])
})

test('shell commands, captured shell, and capture-assignment', () => {
  const out = t('!ls -la\nfiles = !ls\n!!pwd\nnames = %who_ls')
  assert.deepEqual(lines(out.code), [
    '_warsha_k.system("ls -la")',
    'files = _warsha_k.system("ls", capture=True)',
    '_warsha_k.system("pwd", capture=True)',
    'names = _warsha_k.line_magic("who_ls", "", 4)',
  ])
})

test('every spelling of pip is collected for install-before-run', () => {
  const out = t('!pip install -q seaborn\n%pip install requests==2.31\n!python -m pip install tqdm\nimport seaborn')
  assert.deepEqual(out.pip, ['install -q seaborn', 'install requests==2.31', 'install tqdm'])
  assert.deepEqual(lines(out.code).slice(0, 3), ['_warsha_k.pip(0)', '_warsha_k.pip(1)', '_warsha_k.pip(2)'])
  assert.equal(lines(out.code)[3], 'import seaborn')
})

test('help: obj?, obj??, ?obj, dotted names', () => {
  const out = t('len?\n??str.split\npd.DataFrame.head?')
  assert.deepEqual(lines(out.code), [
    '_warsha_k.pinfo("len", False)',
    '_warsha_k.pinfo("str.split", True)',
    '_warsha_k.pinfo("pd.DataFrame.head", False)',
  ])
})

test('no rewrite inside strings, brackets, or continuations', () => {
  const src = [
    'doc = """',
    '!not a shell command',
    '%not a magic',
    '"""',
    'values = [',
    '    1,',
    ']',
    'total = 1 + \\',
    '    2',
    "s = '%d' % 3",
    'print("!")  # !comment',
  ].join('\n')
  const out = t(src)
  assert.equal(out.code, src)
  assert.deepEqual(out.magicLines, [])
})

test('a % operator, != and %= are Python, not magics', () => {
  const src = 'a = 7 % 3\nb = a != 2\na %= 2\nc = (a\n%2)'
  assert.equal(t(src).code, src)
})

test('a Python-body cell magic: the header goes blank, the body keeps its lines and its own magics', () => {
  const src = '%%time\nx = sum(range(100))\n!echo hi\nx'
  const out = t(src)
  assert.deepEqual(out.cellMagic, { name: 'time', args: '', body: 'x = sum(range(100))\n!echo hi\nx', python: true })
  assert.deepEqual(lines(out.code), ['', 'x = sum(range(100))', '_warsha_k.system("echo hi")', 'x'])
  assert.deepEqual(out.magicLines, [1, 3])
})

test('a data cell magic: nothing to compile, body kept raw', () => {
  const src = '%%writefile helpers/greet.py\ndef greet(name):\n    !not-a-command\n    return f"hi {name}"\n'
  const out = t(src)
  assert.equal(out.cellMagic?.name, 'writefile')
  assert.equal(out.cellMagic?.args, 'helpers/greet.py')
  assert.equal(out.cellMagic?.python, false)
  assert.equal(out.cellMagic?.body, 'def greet(name):\n    !not-a-command\n    return f"hi {name}"\n')
  assert.equal(out.code.trim(), '')
  assert.deepEqual(out.magicLines, [1, 2, 3, 4, 5])
})

test('%% past line 1 is reported as an unknown line magic, not swallowed', () => {
  const out = t('x = 1\n%%time')
  assert.equal(lines(out.code)[1], '_warsha_k.line_magic("%time", "", 2)')
})

test('quotes and backslashes in magic arguments become valid Python literals', () => {
  const out = t('!echo "a \\ b" \'c\'')
  assert.equal(out.code, '_warsha_k.system("echo \\"a \\\\ b\\" \'c\'")')
})

test('statementStarts tracks triple quotes across lines', () => {
  assert.deepEqual(statementStarts(["x = '''", 'a', "'''", 'y']), [true, false, false, true])
  assert.deepEqual(statementStarts(['f(', ')', 'g']), [true, false, true])
})
