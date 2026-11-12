/* Notebooks built for the QA checks (notebook-check.mjs part Q, notebook-visuals.mjs):
 * the student-eye QA report's 240-cell notebook and one notebook holding every
 * finding's case. Generated, so nothing binary is committed. */
import { deflateSync } from 'node:zlib'

/** A w×h solid PNG (base64), so an image output's natural size is known. */
export function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([60, 140, 220], y * (w * 3 + 1) + 1 + x * 3)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}
const nbJson = (cells) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' } }, cells: cells.map((c, i) => ({ id: `q${i}`, metadata: {}, ...c })) }, null, 1)
const md = (source) => ({ cell_type: 'markdown', source })
const code = (source, outputs = [], extra = {}) => ({ cell_type: 'code', source, outputs, execution_count: outputs.length ? 1 : null, ...extra })

/** The QA report's 240-cell notebook: 200 code cells with short outputs, 40 markdown cells. */
export function longNotebook() {
  const cells = []
  for (let i = 0; i < 40; i++) {
    cells.push(md(`## Section ${i}\nSome explanation with $x^{${i % 7}}$ math and \`code\`.`))
    for (let j = 0; j < 5; j++) cells.push(code(`x${i * 5 + j} = ${j}\nfor k in range(3):\n    print('row', k, x${i * 5 + j})`, [{ output_type: 'stream', name: 'stdout', text: 'row 0 0\nrow 1 0\nrow 2 0\n' }]))
  }
  return nbJson(cells)
}

export function qaNotebook() {
  const wide = '<table><thead><tr>' + Array.from({ length: 14 }, (_, i) => `<th>column_${i}</th>`).join('') + '</tr></thead><tbody>' + Array.from({ length: 4 }, (_, r) => '<tr>' + Array.from({ length: 14 }, (_, i) => `<td>${r * 100 + i}.123</td>`).join('') + '</tr>').join('') + '</tbody></table>'
  return nbJson([
    md('# QA notes\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nSee [the docs](https://example.com).\n\n```python\nprint("hi")\n```\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$'),
    code('import sys\nprint("100%|██████████| 10/10", file=sys.stderr)', [{ output_type: 'stream', name: 'stderr', text: '100%|██████████| 10/10\n' }]),
    code('# an image with no width metadata', [{ output_type: 'display_data', data: { 'image/png': png(40, 25), 'text/plain': '<Image>' }, metadata: {} }]),
    code('#@title Load the data { display-mode: "form" }\nx = 1', [], { metadata: { cellView: 'form' } }),
    code('# a wide table', [{ output_type: 'display_data', data: { 'text/html': wide, 'text/plain': 'table' }, metadata: {} }]),
    code('y = 2'),
    code('1 / 0'),
    code('print("later")', [{ output_type: 'stream', name: 'stdout', text: 'from an earlier run\n' }], { execution_count: 9 }),
  ])
}

/** New project ▸ Import files ▸ this .ipynb. Resolves with the click time of Import. */
export async function importNotebook(page, file, lang = 'en') {
  const btn = page.locator('button', { hasText: lang === 'en' ? /^New project$/ : /مشروع جديد/ }).first()
  await btn.waitFor({ timeout: 60000 })
  await btn.click()
  // The Import card is the picker's last button (its label is translated).
  await page.locator('dialog[open]').getByRole('button', { name: lang === 'en' ? /^Import files/ : /^استيراد/ }).first().click()
  await page.locator('input[type=file]').first().setInputFiles(file)
  const t = Date.now()
  await page.locator('dialog[open]').getByRole('button', { name: lang === 'en' ? /^Import$/ : /^استيراد$/ }).click()
  return t
}

