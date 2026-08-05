/* RETIRED (W4-A, VS Code-parity overhaul).
 *
 * This harness froze the computed styles the bespoke CSS produced BEFORE the
 * Tailwind migration (v1 theme: amber accent, #1a1d23 surfaces, 44px tabs) and
 * asserted the migration was pixel-neutral against them. That job is done, and
 * the values it froze are two theme generations stale — the v4 "Dark Modern"
 * sweep moved every one of them on purpose, so keeping the assertions alive
 * would mean re-typing the whole theme here a third time.
 *
 * What replaced it, by responsibility:
 *   - computed color/geometry assertions  -> audit.mjs (density-aware, v4 values)
 *   - tab strip / active-tab treatment    -> audit.mjs + files-verify.mjs
 *   - eyeball evidence at high DPI        -> pixel-crops.mjs (+ measurements.json)
 *
 * The file stays as a stub so anything that invokes the suite by name reports
 * "retired" instead of failing on stale values.
 */
console.log('shots-migration.mjs is retired — see audit.mjs / files-verify.mjs / pixel-crops.mjs (W4-A).')
process.exit(0)
