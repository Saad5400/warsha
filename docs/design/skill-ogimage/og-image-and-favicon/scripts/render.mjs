// Render an HTML file to a PNG at exact pixel dimensions.
//
//   node render.mjs <input.html> <output.png> [options]
//     --width  N       canvas width in CSS px (default 1200)
//     --height N       canvas height in CSS px (default 630)
//     --scale  N       rasterisation factor (default 2)
//     --fonts  <dir>   directory of .woff2 files to inline as @font-face
//     --font-family    family name for those files (usually worth passing)
//     --full-page      capture the whole document instead of the viewport
//
// Layout happens at the requested CSS size while rasterisation happens at
// `--scale`, then `scale: 'css'` downsamples back — so the PNG is exactly
// width x height and noticeably crisper than a 1x capture.
//
// If the HTML contains the token __FONT_CSS__ it is replaced with the font
// rules; otherwise they are prepended in a <style> block.
//
// Env: CHROMIUM (path to a Chromium binary, when Playwright's own is missing).
import fs from 'node:fs';
import path from 'node:path';
import { fontCss, launch, loadChromium, parseArgs, usage } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [source, out] = positional;

if (!source || !out) {
    usage([
        'Usage: node render.mjs <input.html> <output.png> [options]',
        '  --width N --height N --scale N --fonts <dir> --font-family <name> --full-page',
    ]);
}

const width = Number(flags.width ?? 1200);
const height = Number(flags.height ?? 630);
const scale = Number(flags.scale ?? 2);

const css = fontCss(flags.fonts, flags['font-family']);
const raw = fs.readFileSync(source, 'utf8');
const html = raw.includes('__FONT_CSS__')
    ? raw.replace('__FONT_CSS__', css)
    : `<style>${css}</style>${raw}`;

const chromium = loadChromium();
const browser = await launch(chromium);
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
const page = await context.newPage();

// Serve the processed HTML from a sibling of the source rather than via
// setContent, so relative references (a logo, a background image) still
// resolve the way they do for the author.
const staged = path.join(path.dirname(path.resolve(source)), `.render-${path.basename(source)}`);
fs.writeFileSync(staged, html);

try {
    await page.goto(`file://${staged}`, { waitUntil: 'load' });
    await page.evaluate(async () => {
        await document.fonts.ready;
    });

    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    await page.screenshot({ path: out, type: 'png', scale: 'css', fullPage: Boolean(flags['full-page']) });
} finally {
    fs.rmSync(staged, { force: true });
    await browser.close();
}

console.log(`Wrote ${out} (${width}x${height})`);
