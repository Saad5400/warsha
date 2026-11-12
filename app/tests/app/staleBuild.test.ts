/**
 * ui/staleBuild.ts — the self-heal that reloads a page older than its deploy.
 *
 * The browser half (a tab left open across a real deploy) is
 * tools/qa/deploy-upgrade-check.mjs. What cannot be staged with one server is
 * pinned here: a rollout where two builds are served at once, which must not
 * bounce a tab between them, and the save that has to happen before any reload.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
let served = '/assets/index-NEW.js'
let reloads = 0
let saves = 0
let online = true

const g = globalThis as Record<string, unknown>
g.sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
}
g.location = { href: 'https://warsha.test/p/1', reload: () => void reloads++ }
g.document = {
  querySelector: () => ({ src: 'https://warsha.test/assets/index-OLD.js' }),
}
g.fetch = async () => {
  if (!online) throw new TypeError('Failed to fetch')
  return new Response(`<script type="module" crossorigin src="${served}"></script>`)
}

const { reloadIfStale, setStaleBuildSaver } = await import('../../src/ui/staleBuild')

beforeEach(() => {
  store.clear()
  served = '/assets/index-NEW.js'
  reloads = 0
  saves = 0
  online = true
  setStaleBuildSaver(async () => void saves++)
})

test('reloads onto a newer deploy, saving first', async () => {
  assert.equal(await reloadIfStale(), true)
  assert.equal(reloads, 1)
  assert.equal(saves, 1)
})

test('does nothing when the page is the deployed build', async () => {
  served = '/assets/index-OLD.js'
  assert.equal(await reloadIfStale(), false)
  assert.equal(reloads, 0)
})

test('does nothing offline: staleness cannot be known', async () => {
  online = false
  assert.equal(await reloadIfStale(), false)
  assert.equal(reloads, 0)
})

test('never reloads onto the same build twice — no loop', async () => {
  assert.equal(await reloadIfStale(), true)
  assert.equal(await reloadIfStale(), false)
  assert.equal(reloads, 1)
})

test('a rollout serving two builds at once cannot ping-pong the tab', async () => {
  served = '/assets/index-A.js'
  assert.equal(await reloadIfStale(), true)
  served = '/assets/index-B.js'
  assert.equal(await reloadIfStale(), true)
  // Back to A while the overlap lasts: A was already tried, so no third reload.
  served = '/assets/index-A.js'
  assert.equal(await reloadIfStale(), false)
  assert.equal(reloads, 2)
})

test('a build tried long ago may be tried again', async () => {
  store.set('warsha.staleReload', JSON.stringify({ '/assets/index-NEW.js': Date.now() - 11 * 60_000 }))
  assert.equal(await reloadIfStale(), true)
})

test('concurrent failures share one check and at most one reload', async () => {
  const results = await Promise.all([reloadIfStale(), reloadIfStale(), reloadIfStale()])
  assert.deepEqual(results, [true, true, true])
  assert.equal(reloads, 1)
})
