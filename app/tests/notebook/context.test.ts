/**
 * The cell-context seam (editor/textContext.ts): a cell editor holds one cell,
 * yet `df.` must know what cell 1 made `df`. The REAL completion sources run
 * against `cells above + this cell`; their results must come back in the
 * cell's own coordinates. Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { ensureSyntaxTree } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { completionSources } from '../../src/editor/completions.ts'
import { textContext, contextual } from '../../src/editor/textContext.ts'
import { memberAt } from '../../src/editor/members.ts'
import { pythonTables } from '../../src/editor/completions.ts'

const sources = completionSources('python', () => [])

/** What the popup offers at ‸ in a cell whose earlier cells are `above`. */
function offered(above: string, cellWithCaret: string) {
  const pos = cellWithCaret.indexOf('‸')
  const doc = cellWithCaret.replace('‸', '')
  const ctxFn = () => above
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions: [python(), textContext.of(ctxFn)] })
  ensureSyntaxTree(state, doc.length, 5000)
  const ctx = new CompletionContext(state, pos, true)
  const rows: { label: string; from: number; detail?: string }[] = []
  for (const source of sources) {
    const r = source(ctx)
    if (!r || r instanceof Promise) continue
    for (const o of r.options) rows.push({ label: o.label, from: r.from, detail: o.detail })
  }
  return { rows, pos, doc }
}

const CELL1 = 'import pandas as pd\nimport numpy as np\ndf = pd.read_csv("scores.csv")\nnames = ["a", "b"]'

test('df defined in an earlier cell: df. offers DataFrame members', () => {
  const { rows } = offered(CELL1, 'df.he‸')
  const head = rows.find((r) => r.label === 'head')
  assert.ok(head, 'head offered')
  assert.ok(head!.detail, 'from the member source (it has a detail), not the word fallback')
  assert.equal(head!.from, 3, 'replacement range is in the cell\'s own coordinates')
})

test('a list from an earlier cell gets list members; a module alias gets module members', () => {
  assert.ok(offered(CELL1, 'names.app‸').rows.some((r) => r.label === 'append' && r.detail))
  assert.ok(offered(CELL1, 'np.ara‸').rows.some((r) => r.label === 'arange'))
})

test('names declared above are offered as identifiers, mapped back to the cell', () => {
  const { rows } = offered('total_score = 10\n', 'print(total_s‸)')
  const hit = rows.find((r) => r.label === 'total_score')
  assert.ok(hit)
  assert.equal(hit!.from, 6)
})

test('without earlier cells nothing changes', () => {
  const { rows } = offered('', 'df.he‸')
  assert.ok(!rows.some((r) => r.label === 'head' && r.detail))
})

test('contextual(): identity without the facet, shifted state with it', () => {
  const plain = EditorState.create({ doc: 'x = 1' })
  assert.equal(contextual(plain, 2).state, plain)
  const get = () => 'a = 1'
  const st = EditorState.create({ doc: 'a.', extensions: [python(), textContext.of(get)] })
  const c = contextual(st, 2)
  assert.equal(c.state.doc.toString(), 'a = 1\n\na.')
  assert.equal(c.pos, 2 + c.offset)
  // Hover resolution (members.memberAt) reads the same virtual text.
  const st2 = EditorState.create({ doc: 'df.head()', extensions: [python(), textContext.of(() => CELL1)] })
  const c2 = contextual(st2, 4)
  assert.equal(memberAt('python', c2.state, 3 + c2.offset, 7 + c2.offset, pythonTables())?.owner !== undefined, true)
})
