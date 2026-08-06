/*
 * Pre-build React into a first-party, on-device asset for the Web preview.
 *
 * Why: a student's `main.tsx` that `import`s `react` / `react-dom/client` must
 * bundle into ONE self-contained module the preview can inline — the same
 * "inline everything, never link" rule Tailwind and esbuild already follow (a
 * linked or CDN script is cross-origin to the sandboxed iframe's opaque origin
 * and COEP blocks it). React and react-dom must also share a SINGLE react
 * instance or hooks break, so both are bundled here in one esbuild pass (esbuild
 * dedupes react to one copy), exposed as three namespaces, and wrapped in thin
 * shims that give the bare specifiers their normal static named exports.
 *
 * Output: public/warsha-react.json (gitignored, staged by `npm run assets`),
 * a { version, files } bundle the in-browser bundler (runtime/bundle.ts) fetches
 * once, drops into its virtual filesystem, and resolves `react`, `react-dom`,
 * `react-dom/client` and `react/jsx-runtime` against.
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import * as esbuild from 'esbuild-wasm'

const require = createRequire(import.meta.url)
const OUT = new URL('../public/warsha-react.json', import.meta.url)
const NODE_ENV = { 'process.env.NODE_ENV': '"production"' }

/** Tracks whatever react version is installed rather than a hardcoded list that
 *  rots. Drops `__`-prefixed internals. */
const names = (spec) =>
  Object.keys(require(spec))
    .filter((k) => k !== '__esModule' && !k.startsWith('__'))
    .sort()

const version = require('react/package.json').version

async function main() {
  await esbuild.initialize({})

  // One pass → one shared react instance. Three namespace exports carry the
  // whole surface of each entry point.
  const core = (
    await esbuild.build({
      stdin: {
        contents: `export * as react from 'react'
export * as reactJsxRuntime from 'react/jsx-runtime'
export * as reactDomClient from 'react-dom/client'
export * as reactDom from 'react-dom'`,
        resolveDir: process.cwd(),
        loader: 'js',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      minify: true,
      define: NODE_ENV,
      logLevel: 'warning',
    })
  ).outputFiles[0].text

  // Thin shims turn each namespace back into normal named exports, so
  // `import { useState } from 'react'` works as expected.
  const shim = (ns, exportNames, withDefault) =>
    `import { ${ns} as _ } from './core.js'\n` +
    (withDefault ? `export default _\n` : '') +
    `export const ${exportNames.map((n) => `${n} = _.${n}`).join(', ')}\n`

  const files = {
    'core.js': core,
    'react.js': shim('react', names('react'), true),
    'jsx-runtime.js': shim('reactJsxRuntime', names('react/jsx-runtime'), false),
    'react-dom-client.js': shim('reactDomClient', names('react-dom/client'), false),
    'react-dom.js': shim('reactDom', names('react-dom'), true),
  }

  writeFileSync(OUT, JSON.stringify({ version, files }))
  const kb = (JSON.stringify(files).length / 1024).toFixed(0)
  console.log(`warsha-react.json: react ${version}, ${kb} KB`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
