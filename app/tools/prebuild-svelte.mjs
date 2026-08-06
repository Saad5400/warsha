/*
 * Pre-build Svelte's runtime into a first-party, on-device asset for the Web
 * preview — the same idea as tools/prebuild-react.mjs, adapted to Svelte 5.
 *
 * A student's `App.svelte` is compiled to JS in the browser (by svelte/compiler,
 * run inside the bundler — see runtime/bundle.ts), and that output imports from
 * `svelte/internal/client` (and a side-effect `svelte/internal/disclose-version`);
 * their `main.js` imports `mount` from `svelte`. None of those resolve in a browser
 * esbuild with no node_modules, so the runtime is bundled here into files the
 * bundler drops into its virtual filesystem and resolves those specifiers against.
 *
 * Unlike React (whose react-dom is CJS and forced a single-pass/namespace-shim
 * dance), Svelte is pure ESM, so we bundle the three entry points with esbuild
 * **code-splitting**: the shared runtime state lands in ONE chunk both entries
 * import, which is exactly the single-instance guarantee Svelte's scheduler needs,
 * and each entry re-exports its real names natively (including reserved-word names
 * like `await`/`if` that a hand-written `export const` shim cannot).
 *
 * Output: public/warsha-svelte.json (gitignored, staged by `npm run assets`),
 * a { version, files } bundle where `files` is keyed by basename (the entries plus
 * the shared chunk, whose relative `./chunk-*.js` imports resolve once all files
 * sit together in the bundler's virtual directory).
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import * as esbuild from 'esbuild-wasm'

const require = createRequire(import.meta.url)
const OUT = new URL('../public/warsha-svelte.json', import.meta.url)
const version = require('svelte/package.json').version

async function main() {
  await esbuild.initialize({})

  // Three entry points, code-split: the shared runtime (scheduler, reactivity)
  // is deduped into one chunk → a single Svelte instance, as the runtime requires.
  const built = await esbuild.build({
    entryPoints: {
      svelte: 'svelte',
      'internal-client': 'svelte/internal/client',
      'disclose-version': 'svelte/internal/disclose-version',
    },
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    write: false,
    outdir: 'out',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  })

  const files = {}
  for (const f of built.outputFiles) files[f.path.split('/').pop()] = f.text

  writeFileSync(OUT, JSON.stringify({ version, files }))
  const kb = (JSON.stringify(files).length / 1024).toFixed(0)
  console.log(`warsha-svelte.json: svelte ${version}, ${kb} KB (${Object.keys(files).length} files)`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
