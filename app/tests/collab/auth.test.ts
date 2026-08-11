/**
 * Bearer selection (COLLAB-SYNC-CONTRACT §7.4): the session token wins when a
 * user is signed in, else the anonymous device/dev token carries the request —
 * so anonymous work keeps flowing and a sign-in silently upgrades every call.
 * Pure function, no DOM. Run with: `node --test tests/collab/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { selectToken } from '../../src/collab/auth.ts'
import { setPrefsFresh } from '../../src/fs/prefs.ts'

test('selectToken: session token wins when signed in', () => {
  assert.equal(selectToken('sess_abc', 'dev_xyz'), 'sess_abc')
})

test('selectToken: falls back to the device/dev token when signed out', () => {
  assert.equal(selectToken(null, 'dev_xyz'), 'dev_xyz')
  assert.equal(selectToken(undefined, 'dev_xyz'), 'dev_xyz')
})

test('selectToken: undefined when neither exists (no-backend offline)', () => {
  assert.equal(selectToken(null, undefined), undefined)
})

test('selectToken: a session token beats even a missing device token', () => {
  assert.equal(selectToken('sess_only', undefined), 'sess_only')
})

/**
 * M3: token writes must not clobber a sibling tab's tokens. `setPrefsFresh` merges
 * onto a FRESH read of localStorage, not this tab's (stale) module cache — so tab
 * B minting a deviceToken cannot null out the sessionToken tab A just persisted.
 * A plain whole-object `setPrefs` would have serialised B's cache (no token) and
 * reverted A's write; this proves the fresh-merge path preserves it.
 */
test('setPrefsFresh: a second tab\'s token write preserves the first tab\'s token (M3)', () => {
  const KEY = 'warsha.prefs.v1'
  const backing = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
    clear: () => backing.clear(),
  }
  // Tab A signed in and persisted its session token straight to localStorage; this
  // tab's (B's) module cache never saw it (it was minted after B loaded).
  backing.set(KEY, JSON.stringify({ sessionToken: 'sess_A', sessionUser: { id: 'a', email: 'a@x' } }))

  // Tab B mints an anonymous device token — the exact write ensureDeviceToken makes.
  setPrefsFresh({ deviceToken: 'dev_B' })

  const saved = JSON.parse(backing.get(KEY)!) as { sessionToken?: string; deviceToken?: string }
  assert.equal(saved.sessionToken, 'sess_A', "tab A's session token survived tab B's write")
  assert.equal(saved.deviceToken, 'dev_B', "tab B's device token landed")
})
