// Pull a webfont's woff2 files out of npm so a headless render can inline them.
//
//   node fetch-font.mjs <package> <out-dir> [options]
//     --weights 400,600,700     default: every weight in the package
//     --subsets latin,arabic    default: every subset in the package
//     --styles normal,italic    default: normal only
//
//   node fetch-font.mjs @fontsource/inter ./fonts --weights 400,600,700 --subsets latin
//
// Most sites load their font from Google Fonts or Bunny at runtime, which a
// sandboxed render usually cannot reach — and a missing font silently changes
// every metric in the layout. @fontsource republishes the same families to npm,
// so this fetches them once into a directory that render.mjs can inline.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, usage } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [pkg, outDir] = positional;

if (!pkg || !outDir) {
    usage([
        'Usage: node fetch-font.mjs <package> <out-dir> [--weights 400,600,700] [--subsets latin] [--styles normal,italic]',
        'Example: node fetch-font.mjs @fontsource/inter ./fonts --weights 400,600,700 --subsets latin',
    ]);
}

const weights = flags.weights ? String(flags.weights).split(',') : null;
const subsets = flags.subsets ? String(flags.subsets).split(',') : null;
const styles = String(flags.styles ?? 'normal').split(',');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-font-'));
const tarball = execFileSync('npm', ['pack', pkg, '--silent'], { cwd: work, encoding: 'utf8' }).trim().split('\n').pop();
execFileSync('tar', ['xzf', tarball], { cwd: work });

const files = path.join(work, 'package/files');

if (!fs.existsSync(files)) {
    throw new Error(`${pkg} does not look like an @fontsource package (no package/files directory).`);
}

fs.mkdirSync(outDir, { recursive: true });

const copied = fs.readdirSync(files).filter((file) => {
    if (!file.endsWith('.woff2')) {
        return false;
    }

    const weight = file.match(/-(\d{3})-/)?.[1];

    if (weights && !weights.includes(weight)) {
        return false;
    }

    if (!styles.some((style) => file.endsWith(`-${style}.woff2`))) {
        return false;
    }

    // Anchored so `latin` does not also match `latin-ext`.
    return !subsets || subsets.some((subset) => new RegExp(`-${subset}-\\d{3}-`).test(file));
});

for (const file of copied) {
    fs.copyFileSync(path.join(files, file), path.join(outDir, file));
}

fs.rmSync(work, { recursive: true, force: true });

if (copied.length === 0) {
    throw new Error('No files matched those weights/subsets/styles. Run without filters to see what the package ships.');
}

console.log(`Wrote ${copied.length} file(s) to ${outDir}:\n${copied.map((f) => `  ${f}`).join('\n')}`);
