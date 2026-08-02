// Shared helpers for the render scripts.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Playwright is not bundled with this skill — it is resolved from whichever
 * project you are working in, so the browser version matches that project.
 * Install with `npm i -D playwright` if it is missing.
 */
export function loadChromium() {
    const bases = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))];

    for (const base of bases) {
        for (const pkg of ['playwright', 'playwright-core']) {
            try {
                return createRequire(path.join(base, 'index.js'))(pkg).chromium;
            } catch {
                // Try the next candidate.
            }
        }
    }

    throw new Error('Could not resolve playwright. Run `npm i -D playwright` in the project you are rendering for.');
}

/**
 * Sandboxes and CI images often ship a Chromium that does not match the
 * Playwright build's expected revision; CHROMIUM points at the one that exists.
 */
export function launch(chromium) {
    return chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
}

/**
 * Inlines every woff2 in `dir` as base64 @font-face rules. Headless renders
 * frequently have no network, and a font that silently fails to load changes
 * every metric in the layout — so never rely on a remote stylesheet.
 *
 * Understands @fontsource naming (`<family>-<subset>-<weight>-<style>.woff2`)
 * and falls back to weight 400 / normal for anything else.
 */
export function fontCss(dir, family) {
    if (!dir) {
        return '';
    }

    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.woff2'));

    if (files.length === 0) {
        throw new Error(`No .woff2 files in ${dir}`);
    }

    const name = family || deriveFamily(files[0]);

    return files.map((file) => {
        const weight = file.match(/-(\d{3})-/)?.[1] ?? '400';
        const style = /italic/i.test(file) ? 'italic' : 'normal';
        const data = fs.readFileSync(path.join(dir, file)).toString('base64');

        return `@font-face{font-family:'${name}';font-style:${style};font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    }).join('\n');
}

function deriveFamily(file) {
    return file
        .replace(/-[a-z-]*-?\d{3}-(normal|italic)\.woff2$/i, '')
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

/** Minimal flag parser: `--key value` and `--flag`. */
export function parseArgs(argv) {
    const positional = [];
    const flags = {};

    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) {
            positional.push(argv[i]);
            continue;
        }

        const key = argv[i].slice(2);
        const next = argv[i + 1];

        if (next === undefined || next.startsWith('--')) {
            flags[key] = true;
        } else {
            flags[key] = next;
            i++;
        }
    }

    return { positional, flags };
}

export function usage(lines) {
    console.error(lines.join('\n'));
    process.exit(1);
}
