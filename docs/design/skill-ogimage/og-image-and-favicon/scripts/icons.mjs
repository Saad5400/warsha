// Emit a full icon set from one mark SVG.
//
//   node icons.mjs <mark.svg> <out-dir> [options]
//     --inset 0.82     glyph scale inside platform-masked icons (default 0.82)
//     --ico 16,32,48   sizes packed into favicon.ico
//     --no-ico         skip favicon.ico
//
// The mark must expose two ids so the masked variants can be derived:
//   <rect id="tile" .../>   the background plate (carries the corner radius)
//   <g id="glyph"> ... </g> everything drawn on top of it
//
// Writes: favicon.svg, favicon.ico, apple-touch-icon.png (180),
//         icon-192.png, icon-512.png
//
// Two treatments, because the consumers differ. The favicon supplies its own
// rounded corners. Home-screen and PWA icons are cropped by the platform — often
// to a circle — so their tile must reach every edge while the glyph stays inside
// the central safe zone. That is what --inset buys.
//
// Env: CHROMIUM (path to a Chromium binary, when Playwright's own is missing).
import fs from 'node:fs';
import path from 'node:path';
import { launch, loadChromium, parseArgs, usage } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [source, outDir] = positional;

if (!source || !outDir) {
    usage([
        'Usage: node icons.mjs <mark.svg> <out-dir> [--inset 0.82] [--ico 16,32,48] [--no-ico]',
        'The mark SVG needs <rect id="tile"> and <g id="glyph">.',
    ]);
}

const svg = fs.readFileSync(source, 'utf8');

for (const id of ['tile', 'glyph']) {
    if (!svg.includes(`id="${id}"`)) {
        throw new Error(`${source} has no element with id="${id}" — see the usage note in this script.`);
    }
}

const inset = Number(flags.inset ?? 0.82);
const icoSizes = flags['no-ico'] ? [] : String(flags.ico ?? '16,32,48').split(',').map(Number);

/** PNG-payload ICO. Every browser since IE11 reads this form. */
function buildIco(entries) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);

    let offset = 6 + entries.length * 16;
    const directory = entries.map(({ size, data }) => {
        const row = Buffer.alloc(16);
        row.writeUInt8(size >= 256 ? 0 : size, 0);
        row.writeUInt8(size >= 256 ? 0 : size, 1);
        row.writeUInt16LE(1, 4);
        row.writeUInt16LE(32, 6);
        row.writeUInt32LE(data.length, 8);
        row.writeUInt32LE(offset, 12);
        offset += data.length;

        return row;
    });

    return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.data)]);
}

const chromium = loadChromium();
const browser = await launch(chromium);
const context = await browser.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 });
const page = await context.newPage();

/**
 * Reshaping happens in the DOM rather than by rewriting the SVG text, so the
 * source stays the single authored artifact and nothing depends on how it
 * happens to be formatted.
 */
async function raster(size, masked) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
        `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
        { waitUntil: 'load' }
    );

    if (masked) {
        await page.evaluate((scale) => {
            const root = document.querySelector('svg');
            const [, , vbWidth, vbHeight] = (root.getAttribute('viewBox') ?? '0 0 64 64').split(/[\s,]+/).map(Number);

            // Full-bleed plate: the platform draws the corners.
            document.getElementById('tile').setAttribute('rx', '0');

            const glyph = document.getElementById('glyph');
            const shift = `translate(${(vbWidth * (1 - scale)) / 2} ${(vbHeight * (1 - scale)) / 2}) scale(${scale})`;
            glyph.setAttribute('transform', `${shift} ${glyph.getAttribute('transform') ?? ''}`.trim());
        }, inset);
    }

    return page.screenshot({ type: 'png', scale: 'css', omitBackground: true });
}

fs.mkdirSync(outDir, { recursive: true });

const written = [];

fs.writeFileSync(path.join(outDir, 'favicon.svg'), svg);
written.push('favicon.svg');

for (const [file, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
    fs.writeFileSync(path.join(outDir, file), await raster(size, true));
    written.push(`${file} (${size}x${size})`);
}

if (icoSizes.length > 0) {
    const entries = [];
    for (const size of icoSizes) {
        entries.push({ size, data: await raster(size, false) });
    }
    fs.writeFileSync(path.join(outDir, 'favicon.ico'), buildIco(entries));
    written.push(`favicon.ico (${icoSizes.join(', ')})`);
}

await browser.close();

console.log(written.map((line) => `Wrote ${path.join(outDir, line)}`).join('\n'));
