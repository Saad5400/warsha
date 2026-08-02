/* Compiles src/bootstrap/*.java against a real Java 8 target.
 *
 * The bootstrap is compiled in the browser by ECJ on CheerpJ's Java 8 runtime,
 * where a mistake surfaces as an opaque "bootstrap failed to compile" during
 * load(). Checking it here catches syntax errors and, more usefully, any
 * accidental use of a post-8 API or language feature -- `--release 8` fails on
 * those, where plain `-source 8` would not.
 *
 * Skips itself (exit 0) when no local JDK is available, so it never blocks a
 * contributor who does not have one; the browser remains the real test.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function javac() {
  try {
    execFileSync('javac', ['-version'], { stdio: 'ignore' })
    return 'javac'
  } catch {
    return null
  }
}

const compiler = javac()
if (!compiler) {
  console.log('check-bootstrap: no local javac, skipping (the browser load() is the real test)')
  process.exit(0)
}

const jar = join(here, 'ecj.jar')
if (!existsSync(jar)) {
  console.log('check-bootstrap: no ecj.jar, skipping -- run ./fetch-compiler.sh to enable this check')
  process.exit(0)
}

// Globbed, not listed: a new bootstrap class that nothing here compiles would
// be checked for the first time in a browser, as "bootstrap failed to compile".
const sourceDir = join(here, 'src/bootstrap')
const sources = readdirSync(sourceDir)
  .filter((name) => name.endsWith('.java'))
  .sort()
  .map((name) => join(sourceDir, name))
if (!sources.length) throw new Error(`no .java files in ${sourceDir}`)

const out = mkdtempSync(join(tmpdir(), 'warsha-bootstrap-'))
try {
  execFileSync(compiler, ['--release', '8', '-Xlint:all', '-cp', jar, '-d', out, ...sources], {
    stdio: 'inherit',
  })
  console.log(`check-bootstrap: ${sources.length} bootstrap sources compile clean against --release 8`)
} finally {
  rmSync(out, { recursive: true, force: true })
}
