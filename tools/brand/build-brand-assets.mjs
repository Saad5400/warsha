// Regenerate every brand raster from its committed source.
//
//   node tools/brand/build-brand-assets.mjs
//
// Sources (edit these, never the PNGs this script writes):
//   docs/design/mark.svg                       clean-silhouette tier, #tile + #glyph
//   docs/design/brand-v3/mark-glitch-dark.png  the founder's actual mark (glitch texture)
//   docs/design/og-image.html                  the 1200x630 social card
//   docs/design/fonts/*.woff2                  subset faces, inlined into the card at render
//
// Artifacts (all written to app/public/, all committed):
//   favicon.svg  favicon.ico  apple-touch-icon.png
//   icon-192.png  icon-512.png  icon-maskable-512.png  og-image.png
//
// BRAND V3 TWO-TIER SPLIT. The founder's real mark is a glitched raster —
// scan-line noise over two bracket jaws and a centred pill — and that texture
// only reads above roughly 180px; measured on the source PNG, it thins into
// noise below that. So the icon set is generated from two different sources
// depending on size, not one:
//
//   Under 180px (favicon.svg, the favicon.ico frames at 16/32/48) -> rendered
//   from docs/design/mark.svg, a clean unglitched redraw of the same
//   brackets-and-pill structure. This tier keeps its own rounded plate — the
//   mark supplies its own corners and sits on browser chrome.
//
//   180px and up (apple-touch-icon, icon-192, icon-512, icon-maskable-512) ->
//   the actual mark-glitch-dark.png, resized down through Chromium (never
//   upscaled — its native 1254px comfortably covers every size here). It is
//   already a full-bleed square (pure black background, no transparency) at
//   native resolution, which is exactly what apple-touch/PWA icons want: iOS
//   composites transparency onto black and rounds the corners itself, and
//   Android crops to a circle or squircle. No separate maskable treatment is
//   needed either — the glyph in the source PNG only occupies ~56% width by
//   ~50% height of its own canvas (measured, not eyeballed), which already
//   sits comfortably inside the maskable spec's central 80% safe zone.
//
// Chromium comes from CHROMIUM or /usr/bin/google-chrome; playwright-core is
// resolved from tools/qa, which is where this repo already keeps it.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const design = path.join(root, 'docs/design');
const out = path.join(root, 'app/public');

const require = createRequire(path.join(root, 'tools/qa/index.js'));
const { chromium } = require('playwright-core');

const markSvg = fs.readFileSync(path.join(design, 'mark.svg'), 'utf8');

for (const id of ['tile', 'glyph']) {
  if (!markSvg.includes(`id="${id}"`)) {
    throw new Error(`docs/design/mark.svg has no element with id="${id}" — the raster variants are derived by reshaping those two nodes.`);
  }
}

// mark.svg ships verbatim as favicon.svg, which the browser parses as strict
// XML — where two consecutive hyphens inside a comment are illegal. Inlined in
// HTML the lenient parser hides this, so the only symptom is a favicon that
// silently fails to load. Caught here instead.
for (const comment of markSvg.match(/<!--[\s\S]*?-->/g) ?? []) {
  if (comment.slice(4, -3).includes('--')) {
    throw new Error('docs/design/mark.svg has a comment containing "--", which is illegal in XML and will break favicon.svg. Write token names in prose.');
  }
}

/** PNG-payload ICO. Every browser since IE11 reads this form. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
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

  return Buffer.concat([header, ...directory, ...entries.map((e) => e.data)]);
}

/** Inline every subset face as base64. A headless render has no network, and a
 *  font that silently fails to load changes every metric in the layout. */
function fontCss() {
  const dir = path.join(design, 'fonts');

  return fs.readdirSync(dir).filter((f) => f.endsWith('.woff2')).map((file) => {
    const [family] = file.split('-');
    const weight = file.match(/-(\d{3})-/)?.[1] ?? '400';
    const data = fs.readFileSync(path.join(dir, file)).toString('base64');

    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
  }).join('\n');
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome' });
const written = [];

// ---- icons ----------------------------------------------------------------

const iconPage = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 });

/**
 * Clean-silhouette tier, under 180px. Reshaping happens in the DOM rather
 * than by rewriting the SVG text, so the source stays the single authored
 * artifact and nothing depends on how it happens to be formatted.
 */
async function raster(size) {
  await iconPage.setViewportSize({ width: size, height: size });
  await iconPage.setContent(
    `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${markSvg}`,
    { waitUntil: 'load' }
  );

  return iconPage.screenshot({ type: 'png', scale: 'css', omitBackground: true });
}

const glitchMark = fs.readFileSync(path.join(design, 'brand-v3/mark-glitch-dark.png'));
const glitchMarkDataUri = `data:image/png;base64,${glitchMark.toString('base64')}`;

/**
 * Glitch tier, 180px and up. Just the source PNG resized down through
 * Chromium's own image scaling — never upscaled, see the header comment for
 * why no fullBleed/inset handling is needed here.
 */
async function rasterGlitch(size) {
  await iconPage.setViewportSize({ width: size, height: size });
  await iconPage.setContent(
    `<style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px;overflow:hidden}img{display:block;width:${size}px;height:${size}px}</style><img src="${glitchMarkDataUri}">`,
    { waitUntil: 'load' }
  );

  return iconPage.screenshot({ type: 'png', scale: 'css' });
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'favicon.svg'), markSvg);
written.push('favicon.svg');

for (const [file, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-maskable-512.png', 512],
]) {
  fs.writeFileSync(path.join(out, file), await rasterGlitch(size));
  written.push(`${file} (${size}x${size})`);
}

const icoSizes = [16, 32, 48];
const entries = [];
for (const size of icoSizes) {
  entries.push({ size, data: await raster(size) });
}
fs.writeFileSync(path.join(out, 'favicon.ico'), buildIco(entries));
written.push(`favicon.ico (${icoSizes.join(', ')})`);

await iconPage.close();

// ---- Open Graph card ------------------------------------------------------

const OG = { width: 1200, height: 630 };
const source = path.join(design, 'og-image.html');
const staged = path.join(design, '.render-og-image.html');

fs.writeFileSync(staged, fs.readFileSync(source, 'utf8').replace('__FONT_CSS__', fontCss()));

const ogPage = await browser.newPage({ viewport: OG, deviceScaleFactor: 2 });

try {
  await ogPage.goto(`file://${staged}`, { waitUntil: 'load' });
  await ogPage.evaluate(() => document.fonts.ready);

  // Layout at 1200x630, rasterise at 2x, then `scale: 'css'` downsamples back —
  // exactly the declared dimensions, and noticeably crisper than a 1x capture.
  await ogPage.screenshot({ path: path.join(out, 'og-image.png'), type: 'png', scale: 'css' });
  written.push(`og-image.png (${OG.width}x${OG.height})`);
} finally {
  fs.rmSync(staged, { force: true });
}

await browser.close();

console.log(written.map((line) => `Wrote app/public/${line}`).join('\n'));
