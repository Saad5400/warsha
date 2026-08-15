/**
 * Runs the collab unit tests (tests/collab/*.test.ts).
 *
 * This Node build ships without the built-in TypeScript stripper, and its test
 * runner ignores node_modules, so we bundle each test to a temp dir with the
 * (already-installed) esbuild CLI and point `node --test` at the output. Pure
 * Node + yjs — no browser, no DOM.
 *
 * Usage: `npm run test:collab`
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const names = ['doc', 'blobSync', 'materialize', 'auth', 'headlessSync']
const out = mkdtempSync(join(tmpdir(), 'warsha-collab-'))
const esbuild = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'esbuild.cmd' : 'esbuild')

const built = spawnSync(
  esbuild,
  [
    ...names.map((n) => join(root, 'tests', 'collab', `${n}.test.ts`)),
    '--bundle',
    '--platform=node',
    '--format=esm',
    `--outdir=${out}`,
    '--out-extension:.js=.mjs',
    '--log-level=warning',
  ],
  { stdio: 'inherit' },
)
if (built.status !== 0) process.exit(built.status ?? 1)

const res = spawnSync(process.execPath, ['--test', ...names.map((n) => join(out, `${n}.test.mjs`))], {
  stdio: 'inherit',
})
process.exit(res.status ?? 1)
