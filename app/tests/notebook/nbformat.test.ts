/**
 * The .ipynb round trip. The bar is byte-for-byte: a notebook exported from
 * Colab (nbformat 4.0, ids in metadata, `cells` LAST, indent 2) or written by
 * Jupyter (4.5, sorted keys, indent 1) must serialise back to exactly the text
 * that was read when nothing was edited — and an edit must touch only the
 * field it edits. Fixtures are hand-built to each tool's on-disk shape.
 * Run with: `npm run test:notebook`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  cellPath,
  clearAllOutputs,
  convertCell,
  createNotebook,
  duplicateCell,
  cellIds,
  joinText,
  newCell,
  notebookCode,
  outputsCollapsed,
  parseCellPath,
  parseNotebook,
  serializeNotebook,
  setOutputsCollapsed,
  splitLines,
  withoutOutputs,
  NotebookParseError,
} from '../../src/notebook/nbformat.ts'

const fixture = (name: string) => readFileSync(`tests/notebook/fixtures/${name}`, 'utf8')
const COLAB = fixture('colab-export.ipynb')
const JUPYTER = fixture('jupyter-4.5.ipynb')

test('round trip: an untouched Colab export is byte-identical', () => {
  assert.equal(serializeNotebook(parseNotebook(COLAB)), COLAB)
})

test('round trip: an untouched Jupyter 4.5 notebook is byte-identical', () => {
  assert.equal(serializeNotebook(parseNotebook(JUPYTER)), JUPYTER)
})

test('Colab: ids come from metadata.id, cells, outputs and counts are read', () => {
  const nb = parseNotebook(COLAB)
  assert.deepEqual(
    nb.cells.map((c) => c.id),
    ['Xk3fA9bQ1Lzu', 'p0Lq2_xYz-Ab', 'hQ8vR2sT9uWx', 'Zz9yY8xX7wWv', 'eRr0rCell123', 'emptyCell000'],
  )
  assert.deepEqual(
    nb.cells.map((c) => c.type),
    ['markdown', 'code', 'code', 'code', 'code', 'code'],
  )
  assert.equal(nb.cells[0].source, '# Lab 3 — درس البيانات\n\nLoad the scores and plot them. $E = mc^2$')
  assert.equal(nb.cells[2].executionCount, 2)
  assert.equal(nb.cells[5].executionCount, null)
  assert.equal(nb.cells[5].source, '')
  assert.equal(nb.cells[4].outputs[0].output_type, 'error')
  assert.equal(nb.indent, 2)
})

test('Colab: editing one cell rewrites only that cell, keeps Colab metadata and key order', () => {
  const nb = parseNotebook(COLAB)
  nb.cells[2] = { ...nb.cells[2], source: 'df = pd.DataFrame({"a": [1, 2, 3]})\ndf', outputs: [], executionCount: null }
  const text = serializeNotebook(nb)
  const back = JSON.parse(text)
  // Still nbformat 4.0: no top-level cell id is introduced (the 4.0 schema forbids one).
  assert.equal(back.nbformat_minor, 0)
  assert.ok(!('id' in back.cells[2]))
  assert.equal(back.cells[2].metadata.id, 'hQ8vR2sT9uWx')
  assert.deepEqual(back.cells[2].metadata.colab, { base_uri: 'https://localhost:8080/', height: 112 })
  assert.deepEqual(back.cells[2].source, ['df = pd.DataFrame({"a": [1, 2, 3]})\n', 'df'])
  assert.deepEqual(back.cells[2].outputs, [])
  assert.equal(back.cells[2].execution_count, null)
  // Key order of the edited cell is Colab's, and `cells` is still the last top-level key.
  assert.deepEqual(Object.keys(back.cells[2]), ['cell_type', 'source', 'metadata', 'execution_count', 'outputs'])
  assert.deepEqual(Object.keys(back), ['nbformat', 'nbformat_minor', 'metadata', 'cells'])
  assert.deepEqual(back.metadata.colab, { provenance: [], toc_visible: true, authorship_tag: 'ABX9TyN3x' })
  // Every other cell is untouched, byte for byte.
  const orig = JSON.parse(COLAB)
  for (const i of [0, 1, 3, 4, 5]) assert.deepEqual(back.cells[i], orig.cells[i])
})

test('Jupyter 4.5: attachments, tags, raw cells and stream outputs survive; a new cell gets an id', () => {
  const nb = parseNotebook(JUPYTER)
  assert.equal(nb.cells[2].type, 'markdown')
  assert.ok((nb.cells[2].raw.attachments as Record<string, unknown>)['pic.png'])
  assert.equal(nb.cells[3].type, 'raw')
  const added = newCell('code', 'x = 1', cellIds(nb))
  nb.cells.splice(1, 0, added)
  const back = JSON.parse(serializeNotebook(nb))
  assert.equal(back.cells[1].id, added.id)
  assert.match(added.id, /^[0-9a-f]{8}$/)
  // nbformat's own key order for a brand-new code cell.
  assert.deepEqual(Object.keys(back.cells[1]), ['cell_type', 'execution_count', 'id', 'metadata', 'outputs', 'source'])
  assert.deepEqual(back.cells[1].source, ['x = 1'])
  assert.deepEqual(back.cells[3].attachments, JSON.parse(JUPYTER).cells[2].attachments)
  assert.equal(back.cells[2].outputs[1].name, 'stderr')
})

test('a string source stays a string; a list source stays a list', () => {
  const text = JSON.stringify({ cells: [{ cell_type: 'code', execution_count: null, id: 'aaaa', metadata: {}, outputs: [], source: 'a\nb' }], metadata: {}, nbformat: 4, nbformat_minor: 5 }, null, 1)
  const nb = parseNotebook(text)
  nb.cells[0] = { ...nb.cells[0], source: 'a\nb\nc' }
  assert.equal(JSON.parse(serializeNotebook(nb)).cells[0].source, 'a\nb\nc')
  assert.equal(serializeNotebook(parseNotebook(text)), text) // no trailing newline in, none out
})

test('a notebook without ids gets stable ones that survive a reload', () => {
  const text = JSON.stringify({ cells: [{ cell_type: 'code', metadata: {}, outputs: [], source: ['print(1)'], execution_count: null }], metadata: {}, nbformat: 4, nbformat_minor: 4 }, null, 1) + '\n'
  const once = serializeNotebook(parseNotebook(text))
  const id = parseNotebook(once).cells[0].id
  assert.equal(JSON.parse(once).cells[0].metadata.id, id)
  assert.equal(parseNotebook(serializeNotebook(parseNotebook(once))).cells[0].id, id)
})

test('duplicate ids are re-minted so every cell path stays unique', () => {
  const text = JSON.stringify({ cells: [0, 1].map(() => ({ cell_type: 'code', id: 'same', metadata: {}, outputs: [], source: [], execution_count: null })), metadata: {}, nbformat: 4, nbformat_minor: 5 })
  const ids = parseNotebook(text).cells.map((c) => c.id)
  assert.equal(new Set(ids).size, 2)
  assert.equal(ids[0], 'same')
})

test('new notebooks are nbformat 4.5 with the python3 kernelspec and ids', () => {
  const nb = createNotebook([{ type: 'markdown', source: '# Hi' }, { type: 'code', source: 'print("hi")' }])
  const back = JSON.parse(serializeNotebook(nb))
  assert.equal(back.nbformat, 4)
  assert.equal(back.nbformat_minor, 5)
  assert.equal(back.metadata.kernelspec.name, 'python3')
  assert.deepEqual(Object.keys(back), ['cells', 'metadata', 'nbformat', 'nbformat_minor'])
  assert.ok(back.cells.every((c: { id: string }) => /^[0-9a-f]{8}$/.test(c.id)))
  assert.ok(!('outputs' in back.cells[0]))
  assert.ok(serializeNotebook(nb).startsWith('{\n "cells": [\n  {\n   "cell_type": "markdown"'))
})

test('convert, duplicate, collapse, clear', () => {
  const nb = parseNotebook(COLAB)
  const code = nb.cells[2]
  const md = convertCell(code, 'markdown')
  assert.equal(md.outputs.length, 0)
  const back = JSON.parse(serializeNotebook({ ...nb, cells: [md] }))
  assert.ok(!('outputs' in back.cells[0]) && !('execution_count' in back.cells[0]))
  const dup = duplicateCell(code, cellIds(nb))
  assert.notEqual(dup.id, code.id)
  assert.equal(dup.source, code.source)
  assert.equal(dup.outputs.length, 0)
  assert.equal(JSON.parse(serializeNotebook({ ...nb, cells: [dup] })).cells[0].metadata.id, dup.id)
  const folded = setOutputsCollapsed(code, true)
  assert.equal(outputsCollapsed(folded), true)
  assert.equal(outputsCollapsed(setOutputsCollapsed(folded, false)), false)
  assert.deepEqual(Object.keys(setOutputsCollapsed(folded, false).raw.metadata as object), ['id', 'colab', 'outputId'])
  const cleared = clearAllOutputs(nb)
  assert.ok(cleared.cells.every((c) => c.outputs.length === 0 && c.executionCount === null))
  assert.ok(withoutOutputs(COLAB).length < COLAB.length)
})

test('cell paths: built from ids, parsed back, ordinary paths are not cells', () => {
  assert.equal(cellPath('labs/week 3.ipynb', 'p0Lq2_xYz-Ab'), 'labs/week 3.ipynb#cell=p0Lq2_xYz-Ab')
  assert.deepEqual(parseCellPath('labs/week 3.ipynb#cell=p0Lq2_xYz-Ab'), { notebook: 'labs/week 3.ipynb', cellId: 'p0Lq2_xYz-Ab' })
  assert.equal(parseCellPath('main.py'), null)
  assert.equal(parseCellPath('nb.ipynb'), null)
})

test('multiline helpers and the code view', () => {
  assert.deepEqual(splitLines('a\nb\n'), ['a\n', 'b\n'])
  assert.deepEqual(splitLines(''), [])
  assert.equal(joinText(['a\n', 'b']), 'a\nb')
  const code = notebookCode(COLAB)
  assert.ok(code.includes('import pandas as pd') && code.includes('plt.show()'))
  assert.ok(!code.includes('iVBORw0KGgo'), 'outputs never reach the code view')
  assert.equal(notebookCode('not json'), '')
})

test('parse errors say what is wrong', () => {
  assert.throws(() => parseNotebook('{'), NotebookParseError)
  assert.throws(() => parseNotebook('{"nbformat": 3, "worksheets": []}'), /nbformat 3/)
  assert.throws(() => parseNotebook('[]'), /not a notebook/)
})
