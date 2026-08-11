/**
 * Doc model — round-trip, minimal-diff merge, and the structural mutators.
 * Pure yjs, no DOM. Run with: `node --test tests/collab/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import type { FsSnapshot } from '../../src/fs/types.ts'
import {
  snapshotToYdoc,
  ydocToSnapshot,
  replaceYText,
  ydCreateFile,
  ydCreateFolder,
  ydRemove,
  ydMove,
  filesMap,
  metaMap,
  readMeta,
  readLinkAccess,
} from '../../src/collab/doc.ts'

const snap: FsSnapshot = {
  files: [
    { path: 'src/Main.java', content: 'class Main {}\n' },
    { path: 'README.md', content: '# hi\n' },
  ],
  dirs: ['src', 'empty'],
}

test('FsSnapshot ↔ Y.Doc round-trips', () => {
  const doc = new Y.Doc()
  snapshotToYdoc(snap, doc, { name: 'Proj', entry: 'src/Main.java' })
  const back = ydocToSnapshot(doc)
  assert.deepEqual(
    back.files,
    [...snap.files].sort((a, b) => a.path.localeCompare(b.path)),
  )
  // ancestors of files are implied dirs; 'empty' is a real empty dir.
  assert.ok(back.dirs.includes('src'))
  assert.ok(back.dirs.includes('empty'))
  const meta = readMeta(doc)
  assert.equal(meta.name, 'Proj')
  assert.equal(meta.entry, 'src/Main.java')
  assert.equal(meta.schema, 1)
  // No owner-authored link access until one is published (H2).
  assert.equal(meta.linkAccess, null)
})

test('readLinkAccess: owner-authored link access round-trips, junk reads as null (H2)', () => {
  const doc = new Y.Doc()
  // Absent until the owner publishes one.
  assert.equal(readLinkAccess(doc), null)
  assert.equal(readMeta(doc).linkAccess, null)
  for (const value of ['editor', 'viewer', 'none'] as const) {
    metaMap(doc).set('linkAccess', value)
    assert.equal(readLinkAccess(doc), value)
    assert.equal(readMeta(doc).linkAccess, value)
  }
  // A peer writing garbage into meta must not resolve to a real role (defensive).
  metaMap(doc).set('linkAccess', 'bogus')
  assert.equal(readLinkAccess(doc), null)
})

test('re-seeding an existing doc is idempotent (no duplicate keys)', () => {
  const doc = new Y.Doc()
  snapshotToYdoc(snap, doc)
  snapshotToYdoc(snap, doc)
  assert.equal([...filesMap(doc).keys()].length, snap.files.length)
})

test('replaceYText is a minimal splice — a concurrent remote edit survives', () => {
  // Two peers on the same file. A "Format"-style whole-doc replace on peer A
  // must not wipe peer B's concurrent append (contract edge #2).
  const a = new Y.Doc()
  ydCreateFile(a, 'f.txt', 'line1\nline2\n')
  const b = new Y.Doc()
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

  replaceYText(filesMap(a).get('f.txt')!, 'LINE1\nline2\n') // reformat first line
  filesMap(b).get('f.txt')!.insert(filesMap(b).get('f.txt')!.length, 'line3\n') // append

  // Exchange both ways.
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))

  const textA = filesMap(a).get('f.txt')!.toString()
  const textB = filesMap(b).get('f.txt')!.toString()
  assert.equal(textA, textB) // converged
  assert.equal(textA, 'LINE1\nline2\nline3\n') // both edits present, neither clobbered
})

test('ydMove rekeys a file (new Y.Text, old key gone) and remaps a folder', () => {
  const doc = new Y.Doc()
  snapshotToYdoc({ files: [{ path: 'src/A.java', content: 'A' }], dirs: ['src'] }, doc)
  const mapping = ydMove(doc, 'src', 'app')
  assert.equal(mapping.get('src/A.java'), 'app/A.java')
  const files = filesMap(doc)
  assert.ok(!files.has('src/A.java'))
  assert.equal(files.get('app/A.java')!.toString(), 'A')
})

test('create/remove mutators reflect in the snapshot and are idempotent', () => {
  const doc = new Y.Doc()
  ydCreateFile(doc, 'a.txt', 'hi')
  ydCreateFile(doc, 'a.txt', 'hi') // idempotent
  ydCreateFolder(doc, 'lib')
  assert.equal(ydocToSnapshot(doc).files.length, 1)
  assert.ok(ydocToSnapshot(doc).dirs.includes('lib'))
  ydRemove(doc, 'a.txt')
  ydRemove(doc, 'a.txt') // idempotent
  assert.equal(ydocToSnapshot(doc).files.length, 0)
})
