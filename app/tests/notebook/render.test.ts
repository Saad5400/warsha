/**
 * Markdown (safe by construction), math → MathML, ANSI, and the output model.
 * Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMarkdown, renderInline } from '../../src/notebook/markdown.ts'
import { texToMathML } from '../../src/notebook/tex.ts'
import { parseAnsi, stripAnsi } from '../../src/notebook/ansi.ts'
import { addOutput, appendStream, foldCarriageReturns } from '../../src/notebook/outputs.ts'
import { maskMagicsForFormat } from '../../src/notebook/magics.ts'

test('markdown: headings, emphasis, code, lists, tables, quotes', () => {
  const html = renderMarkdown('# Title\n\nSome **bold**, *em*, `x = 1` and ~~old~~.\n\n- a\n- b\n  - nested\n\n1. one\n2. two\n\n| n | sq |\n|---|---:|\n| 2 | 4 |\n\n> quote\n\n```python\nprint(1)\n```')
  assert.match(html, /<h1 id="nb-title" dir="auto">Title<\/h1>/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<em>em<\/em>/)
  assert.match(html, /<code>x = 1<\/code>/)
  assert.match(html, /<del>old<\/del>/)
  assert.match(html, /<ul dir="auto"><li>a<\/li><li>b<ul dir="auto"><li>nested<\/li><\/ul><\/li><\/ul>/)
  assert.match(html, /<ol dir="auto"><li>one<\/li><li>two<\/li><\/ol>/)
  assert.match(html, /<th>n<\/th><th style="text-align:right">sq<\/th>/)
  assert.match(html, /<blockquote dir="auto"><p dir="auto">quote<\/p><\/blockquote>/)
  assert.match(html, /<pre><code data-lang="python">print\(1\)<\/code><\/pre>/)
})

test('markdown: snake_case and 2*3*4 are not emphasis; code spans are literal', () => {
  assert.doesNotMatch(renderInline('my_var_name'), /<em>/)
  assert.equal(renderInline('`a*b*c`'), '<code>a*b*c</code>')
})

test('markdown: script and event handlers never survive', () => {
  const evil = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))\n\n<a href="javascript:alert(1)">y</a>\n\n<iframe src="https://e.vil"></iframe>')
  assert.doesNotMatch(evil, /<script/i)
  assert.doesNotMatch(evil, /onerror/i)
  assert.doesNotMatch(evil, /href="javascript/i)
  assert.doesNotMatch(evil, /<iframe/i)
  assert.match(evil, /&lt;script&gt;/)
})

test('markdown: allowed inline HTML is rebuilt, images and attachments resolve', () => {
  const html = renderMarkdown('Line<br>two <b>bold</b> <img src="https://x.org/a.png" width="40" style="position:fixed">\n\n![pic](attachment:pic.png)', {
    attachment: (n) => (n === 'pic.png' ? 'data:image/png;base64,AAAA' : null),
  })
  assert.match(html, /Line<br>two <b>bold<\/b> <img src="https:\/\/x.org\/a.png" width="40">/)
  assert.match(html, /<img src="data:image\/png;base64,AAAA" alt="pic">/)
})

test('math: inline and display become MathML', () => {
  const html = renderMarkdown('Energy $E = mc^2$ and\n\n$$\\frac{a}{b} + \\sqrt{x}$$')
  assert.match(html, /<math><semantics><mrow><mi>E<\/mi><mo>=<\/mo><mi>m<\/mi><msup><mi>c<\/mi><mn>2<\/mn><\/msup>/)
  assert.match(html, /<math display="block">.*<mfrac><mi>a<\/mi><mi>b<\/mi><\/mfrac>.*<msqrt><mi>x<\/mi><\/msqrt>/)
  assert.doesNotMatch(renderInline('costs $5 and $6'), /<math/, 'prices are not math')
})

test('tex: big operators, greek, matrices, unknown commands are visible errors', () => {
  assert.match(texToMathML('\\sum_{i=1}^{n} \\alpha_i', true), /<munderover><mo largeop="true" movablelimits="false">∑<\/mo>/)
  assert.match(texToMathML('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', true), /<mtable><mtr><mtd><mn>1<\/mn><\/mtd><mtd><mn>2<\/mn><\/mtd><\/mtr><mtr>/)
  assert.match(texToMathML('\\nosuch{x}', false), /<merror>/)
  assert.doesNotMatch(texToMathML('<script>', false), /<script/)
})

test('ansi: colours become runs, escapes vanish', () => {
  const runs = parseAnsi('\u001b[0;31mZeroDivisionError\u001b[0m: division by zero')
  assert.equal(runs[0].fg, 'var(--ansi-red)')
  assert.equal(runs[0].text, 'ZeroDivisionError')
  assert.equal(runs[1].fg, null)
  assert.equal(stripAnsi('\u001b[2K\u001b[90m━━\u001b[0m done'), '━━ done')
})

test('outputs: streams merge, carriage returns fold, display updates in place', () => {
  let o = appendStream([], 'stdout', 'a\n')
  o = appendStream(o, 'stdout', 'b')
  assert.equal(o.length, 1)
  // One string per open stream (nbformat allows it); re-splitting into lines per chunk was quadratic.
  assert.equal(o[0].text, 'a\nb')
  o = appendStream(o, 'stderr', 'x')
  assert.equal(o.length, 2)
  assert.equal(foldCarriageReturns('10%\r50%\r100%\ndone'), '100%\ndone')
  let d = addOutput([], 'display', { output_type: 'display_data', data: { 'text/plain': '1' }, metadata: {}, transient: { display_id: 'p' } })
  d = addOutput(d, 'update', { output_type: 'display_data', data: { 'text/plain': '2' }, metadata: {}, transient: { display_id: 'p' } })
  assert.equal(d.length, 1)
  assert.deepEqual(d[0].data, { 'text/plain': '2' })
})

test('format masking: magic lines survive a formatter untouched', () => {
  const m = maskMagicsForFormat('!pip install x\nfor i in range(2):\n    %time f(i)\nx=1')!
  assert.equal(m.masked, '# warsha-magic-0\nfor i in range(2):\n    # warsha-magic-1\nx=1')
  // A formatter would rewrite x=1 → x = 1 and keep the comments where they are.
  assert.equal(m.restore('# warsha-magic-0\nfor i in range(2):\n    # warsha-magic-1\nx = 1\n'), '!pip install x\nfor i in range(2):\n    %time f(i)\nx = 1\n')
  assert.equal(maskMagicsForFormat('%%html\n<b>x</b>'), null)
})
