// Judge candidate marks at the sizes they will actually be seen.
//
//   node contact-sheet.mjs <out.png> <mark1.svg> [mark2.svg ...] [options]
//     --sizes 96,64,48,32,24,16   pixel sizes to render (default as shown)
//     --label "Acme"              wordmark text for the lockup column
//     --dir rtl                   sheet direction (default ltr)
//     --fonts <dir> --font-family <name>   inline a font for the label
//
// Everything looks good at 512px. Marks die at 16px, they die against dark
// backgrounds, they die under the circular mask app launchers apply, and they
// die by accidentally reading as a face — none of which you can see while
// drawing. Render every candidate here before picking one.
import fs from 'node:fs';
import path from 'node:path';
import { fontCss, launch, loadChromium, parseArgs, usage } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [out, ...marks] = positional;

if (!out || marks.length === 0) {
    usage([
        'Usage: node contact-sheet.mjs <out.png> <mark1.svg> [mark2.svg ...] [options]',
        '  --sizes 96,64,48,32,24,16  --label "Acme"  --dir rtl  --fonts <dir> --font-family <name>',
    ]);
}

const sizes = String(flags.sizes ?? '96,64,48,32,24,16').split(',').map(Number);
const label = flags.label ?? '';
const dir = flags.dir ?? 'ltr';
const css = fontCss(flags.fonts, flags['font-family']);
const family = flags['font-family'] ?? 'system-ui';

const rows = marks.map((file) => {
    const uri = `data:image/svg+xml;base64,${fs.readFileSync(file).toString('base64')}`;

    return `<div class="row">
      <div class="name">${path.basename(file)}</div>
      <div class="cells">
        ${sizes.map((s) => `<div class="cell"><img src="${uri}" width="${s}" height="${s}"><small>${s}</small></div>`).join('')}
        <div class="cell"><img class="circle" src="${uri}" width="64" height="64"><small>masked</small></div>
        <div class="cell dark"><img src="${uri}" width="40" height="40"></div>
        <div class="cell muted"><img src="${uri}" width="24" height="24"></div>
        ${label ? `<div class="lockup"><img src="${uri}" width="32" height="32"><span>${label}</span></div>` : ''}
      </div>
    </div>`;
}).join('');

const html = `<!DOCTYPE html><html lang="en" dir="${dir}"><head><meta charset="utf-8"><style>
${css}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{width:1400px;background:#fff;color:#0f172a;padding:32px 36px;font-family:'${family}',system-ui,sans-serif}
h1{font-size:16px;font-weight:600;color:#475569;margin-bottom:18px}
.row{display:flex;align-items:center;gap:28px;padding:20px 0;border-bottom:1px solid #e2e8f0}
.name{width:210px;font-size:13px;font-weight:600;word-break:break-all}
.cells{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.cell{display:flex;flex-direction:column;align-items:center;gap:6px}
.cell small{font-size:10px;color:#94a3b8}
.circle{border-radius:9999px}
.dark{background:#0f172a;border-radius:10px;padding:10px}
.muted{background:#f1f5f9;border-radius:10px;padding:10px}
.lockup{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:700;padding:9px 14px;border:1px solid #e2e8f0;border-radius:12px}
img{display:block}
</style></head><body><h1>Candidate marks at real sizes — check 16px legibility, dark backgrounds, circular masking, and accidental faces</h1>${rows}</body></html>`;

const staged = path.join(path.dirname(path.resolve(out)), '.contact-sheet.html');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(staged, html);

const chromium = loadChromium();
const browser = await launch(chromium);
const context = await browser.newContext({ viewport: { width: 1400, height: 200 }, deviceScaleFactor: 2 });
const page = await context.newPage();

try {
    await page.goto(`file://${staged}`, { waitUntil: 'load' });
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
    await page.screenshot({ path: out, type: 'png', fullPage: true, scale: 'css' });
} finally {
    fs.rmSync(staged, { force: true });
    await browser.close();
}

console.log(`Wrote ${out} — open it and look before choosing.`);
