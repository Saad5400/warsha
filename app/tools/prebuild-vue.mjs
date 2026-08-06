/*
 * Pre-build Vue's runtime into a first-party, on-device asset for the Web preview
 * — the same idea as tools/prebuild-react.mjs, adapted to Vue 3.
 *
 * A student's `App.vue` is compiled to JS in the browser (by @vue/compiler-sfc,
 * run inside the bundler — see runtime/bundle.ts), and both the compiled `<script
 * setup>` and its inlined render function import from `vue`; their `main.js`
 * imports `createApp` from `vue`. That specifier cannot resolve in a browser
 * esbuild with no node_modules, so the runtime is bundled here into a single
 * self-contained `vue.js` the bundler drops into its virtual filesystem.
 *
 * One entry point is enough: `vue` re-exports its whole public surface, and one
 * file means one instance (Vue's reactivity, like React's hooks, breaks with two
 * copies). The `__VUE_*` feature flags are defined so the build has no dangling
 * `process.env`/flag references at runtime, and production drops dev-only warnings.
 *
 * Output: public/warsha-vue.json (gitignored, staged by `npm run assets`),
 * a { version, files } bundle with the one `vue.js` file.
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import * as esbuild from 'esbuild-wasm'

const require = createRequire(import.meta.url)
const OUT = new URL('../public/warsha-vue.json', import.meta.url)
const version = require('vue/package.json').version

async function main() {
  await esbuild.initialize({})

  const built = await esbuild.build({
    entryPoints: { vue: 'vue' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: true,
    write: false,
    outdir: 'out',
    define: {
      'process.env.NODE_ENV': '"production"',
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    logLevel: 'warning',
  })

  const files = {}
  for (const f of built.outputFiles) files[f.path.split('/').pop()] = f.text

  writeFileSync(OUT, JSON.stringify({ version, files }))
  const kb = (JSON.stringify(files).length / 1024).toFixed(0)
  console.log(`warsha-vue.json: vue ${version}, ${kb} KB`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
