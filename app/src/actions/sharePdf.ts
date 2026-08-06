/**
 * "Share as PDF" — the whole project as one print-styled document, for the
 * student handing work in. Every file, not just the open one: a cover header
 * (project name, date, contents list), then each file's code with line
 * numbers and syntax colour, paginated onto A4 pages with page numbers.
 *
 * Built as real DOM pages and rasterised (html-to-image, the share-image
 * pipeline) rather than laid out as PDF text. That choice is what makes the
 * output faithful: any Unicode a student put in a name or a string renders
 * exactly as the browser renders it, with no font embedding, no RTL shaping
 * work, and pixel-identical colour. The cost — text in the PDF is an image —
 * is acceptable for a submission document that exists to be read and printed.
 *
 * Colours are the VS Code Light+ palette (`printHighlightStyle`): a
 * submission is paper, and paper is light — the editor's dark canvas would
 * print as a toner-soaked rectangle. Everything is styled with literal inline
 * values rather than Tailwind utilities, deliberately: the page must look
 * identical whatever theme the app is in, and literal styles also sidestep
 * the var()-resolution hole that forced share-image's freezeComputedStyles.
 *
 * `jspdf` and `html-to-image` are dynamic imports — nobody pays for either
 * until they click Share.
 */
import type { FsSnapshot } from '../fs/types'
import { highlightCss, highlightLines, printHighlightStyle, type Segment } from './highlight'
import { deliverFile, type Delivered } from './deliver'

// A4 at CSS 96dpi. Rasterised at 2× (≈150dpi on paper), sharp on any screen.
const PAGE_W = 794
const PAGE_H = 1123
const MARGIN = 56
const FOOTER_H = 40
/** Past this the document has stopped being a submission and become a dump —
 *  the last page says so and points at the .zip export. */
const MAX_PAGES = 60
/** Files past this size get plain (uncoloured) text: parsing megabytes for a
 *  document capped at MAX_PAGES anyway would stall the click for nothing. */
const MAX_HIGHLIGHT_BYTES = 200_000

const INK = '#1F2328'
const INK_SOFT = '#57606A'
const INK_FAINT = '#8C959F'
const RULE = '#D0D7DE'
const RULE_SOFT = '#E7EBF0'
const BRAND = '#0067C0'
const SANS = "'Segoe UI', system-ui, -apple-system, sans-serif"
const MONO = "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace"

function el(tag: string, styles: Partial<CSSStyleDeclaration>): HTMLElement {
  const node = document.createElement(tag)
  Object.assign(node.style, styles)
  return node
}

interface PageSet {
  /** The off-screen staging container pages mount into — they must be in the
   *  real DOM while blocks land, or every overflow measurement reads 0. */
  wrap: HTMLElement
  pages: HTMLElement[]
  /** The block area of the newest page; append content here. */
  content: HTMLElement
  full: boolean
}

function addPage(set: PageSet): void {
  if (set.pages.length >= MAX_PAGES) {
    set.full = true
    return
  }
  const page = el('div', {
    width: `${PAGE_W}px`,
    height: `${PAGE_H}px`,
    position: 'relative',
    overflow: 'hidden',
    boxSizing: 'border-box',
    background: '#FFFFFF',
    color: INK,
    fontFamily: SANS,
    // Restated per page: each page rasterises on its own and html-to-image
    // clones just that node, so direction must live on it too (see `wrap` below).
    direction: 'ltr',
    textAlign: 'left',
  })
  const content = el('div', {
    boxSizing: 'border-box',
    height: `${PAGE_H - FOOTER_H}px`,
    overflow: 'hidden',
    padding: `${MARGIN}px ${MARGIN}px 0`,
  })
  page.appendChild(content)
  set.wrap.appendChild(page)
  set.pages.push(page)
  set.content = content
}

/** True when `content` holds more than it can show. */
function overflows(content: HTMLElement): boolean {
  return content.scrollHeight > content.clientHeight
}

/**
 * Appends `block`; if it doesn't fit, opens a new page and carries it over
 * with `keepWith` (a header that must not be stranded alone). Returns false
 * once the page cap is hit.
 */
function place(set: PageSet, block: HTMLElement, keepWith?: HTMLElement | null): boolean {
  if (set.full) return false
  set.content.appendChild(block)
  if (!overflows(set.content)) return true
  // A block taller than a whole page stays put and gets clipped —
  // pathological, but better than an infinite page loop.
  const carry = keepWith && keepWith.parentElement === set.content && keepWith.nextElementSibling === block
  addPage(set)
  if (set.full) {
    block.remove()
    if (carry) keepWith.remove()
    return false
  }
  if (carry) set.content.appendChild(keepWith)
  set.content.appendChild(block)
  return true
}

const LANG_LABELS: Array<[RegExp, string]> = [
  [/\.java$/i, 'Java'],
  [/\.py$/i, 'Python'],
  [/\.cs$/i, 'C#'],
  [/\.html?$/i, 'HTML'],
  [/\.css$/i, 'CSS'],
  [/\.(ts|tsx|mts|cts)$/i, 'TypeScript'],
  [/\.(m?js|cjs|jsx)$/i, 'JavaScript'],
]

function langLabel(path: string): string {
  for (const [re, label] of LANG_LABELS) if (re.test(path)) return label
  const dot = path.lastIndexOf('.')
  return dot > 0 ? path.slice(dot + 1).toUpperCase() : ''
}

function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split('\n').length
}

/** The cover header: brand row, project name, meta line, contents table. */
function buildHeader(projectName: string, files: FsSnapshot['files'], date: string): HTMLElement {
  const header = el('div', { marginBottom: '28px' })

  const brandRow = el('div', {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottom: `2px solid ${BRAND}`,
    paddingBottom: '10px',
    marginBottom: '18px',
  })
  const brand = el('div', {
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.18em',
    color: BRAND,
    textTransform: 'uppercase',
  })
  brand.textContent = 'Warsha'
  const dateEl = el('div', { fontSize: '11px', color: INK_SOFT })
  dateEl.textContent = date
  brandRow.append(brand, dateEl)
  header.appendChild(brandRow)

  const title = el('div', { fontSize: '26px', fontWeight: '600', lineHeight: '1.25' })
  title.textContent = projectName
  header.appendChild(title)

  const totalLines = files.reduce((sum, f) => sum + countLines(f.content), 0)
  const meta = el('div', { fontSize: '12px', color: INK_SOFT, marginTop: '6px' })
  meta.textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'} · ${totalLines} ${totalLines === 1 ? 'line' : 'lines'} of code`
  header.appendChild(meta)

  const contents = el('div', { marginTop: '18px', borderTop: `1px solid ${RULE}` })
  for (const f of files) {
    const row = el('div', {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: '5px 0',
      borderBottom: `1px solid ${RULE_SOFT}`,
    })
    const path = el('span', { fontFamily: MONO, fontSize: '11px' })
    path.textContent = f.path
    const lines = el('span', { fontSize: '10px', color: INK_FAINT })
    const n = countLines(f.content)
    lines.textContent = `${n} ${n === 1 ? 'line' : 'lines'}`
    row.append(path, lines)
    contents.appendChild(row)
  }
  header.appendChild(contents)
  return header
}

function buildFileHeader(path: string): HTMLElement {
  const head = el('div', {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottom: `1.5px solid ${RULE}`,
    padding: '16px 0 6px',
    marginBottom: '8px',
  })
  const name = el('span', { fontFamily: MONO, fontSize: '12.5px', fontWeight: '600' })
  name.textContent = path
  const lang = el('span', {
    fontSize: '9.5px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    color: INK_SOFT,
    textTransform: 'uppercase',
  })
  lang.textContent = langLabel(path)
  head.append(name, lang)
  return head
}

function buildCodeRow(lineNo: number, segments: Segment[], gutterCh: number): HTMLElement {
  const row = el('div', {
    display: 'flex',
    fontFamily: MONO,
    fontSize: '11px',
    lineHeight: '1.55',
  })
  const num = el('span', {
    flex: 'none',
    minWidth: `${gutterCh}ch`,
    marginRight: '14px',
    textAlign: 'right',
    color: INK_FAINT,
  })
  num.textContent = String(lineNo)
  const code = el('span', {
    flex: '1',
    minWidth: '0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    tabSize: '4',
    color: INK,
  })
  if (segments.length === 0) code.appendChild(document.createTextNode(' '))
  for (const seg of segments) {
    if (seg.cls) {
      const span = document.createElement('span')
      span.className = seg.cls
      span.textContent = seg.text
      code.appendChild(span)
    } else {
      code.appendChild(document.createTextNode(seg.text))
    }
  }
  row.appendChild(code)
  row.insertBefore(num, code)
  return row
}

/** Footers go on last, once the page count is known. */
function addFooters(pages: HTMLElement[], projectName: string): void {
  pages.forEach((page, i) => {
    const footer = el('div', {
      position: 'absolute',
      left: `${MARGIN}px`,
      right: `${MARGIN}px`,
      bottom: '18px',
      display: 'flex',
      justifyContent: 'space-between',
      borderTop: `1px solid ${RULE_SOFT}`,
      paddingTop: '6px',
      fontSize: '9.5px',
      color: INK_FAINT,
    })
    const name = el('span', {})
    name.textContent = projectName
    const num = el('span', {})
    num.textContent = `Page ${i + 1} of ${pages.length}`
    footer.append(name, num)
    page.appendChild(footer)
  })
}

/**
 * Renders every file into a paginated PDF and delivers it (share sheet or
 * download, see deliver.ts). Files sort by path, so folders group and repeat
 * exports read identically.
 */
export async function shareProjectAsPdf(
  projectName: string,
  snapshot: FsSnapshot,
  fileName: string,
): Promise<Delivered> {
  const files = [...snapshot.files].sort((a, b) => a.path.localeCompare(b.path))
  if (files.length === 0) throw new Error('nothing to export')

  // Highlighted before any DOM exists; a parse failure in one file falls back
  // to plain text instead of sinking the whole document.
  const highlighted = await Promise.all(
    files.map(async (f): Promise<Segment[][]> => {
      if (f.content.length > MAX_HIGHLIGHT_BYTES) return plainLines(f.content)
      try {
        return await highlightLines(f.content, f.path, printHighlightStyle)
      } catch {
        return plainLines(f.content)
      }
    }),
  )

  // Same invisible-but-real staging as the share-image card: attached to the
  // document so fonts and layout are real, opacity 0 so it is never seen.
  const wrap = el('div', {
    position: 'fixed',
    left: '0',
    top: '0',
    opacity: '0',
    pointerEvents: 'none',
    // Forced LTR: built inside the live document, so an Arabic session's
    // `dir="rtl"` would otherwise reverse every row here. Code stays LTR
    // regardless of app language — same rule as the editor (editor/setup.ts).
    direction: 'ltr',
    textAlign: 'left',
  })
  wrap.dir = 'ltr'
  const style = document.createElement('style')
  style.textContent = highlightCss(printHighlightStyle)
  wrap.appendChild(style)
  document.body.appendChild(wrap)

  try {
    const set: PageSet = { wrap, pages: [], content: document.createElement('div'), full: false }
    addPage(set)

    // Pinned to English like the rest of this document — the browser's locale
    // would render the date in Arabic month names and digits, one stray
    // translated line in an English submission.
    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
    place(set, buildHeader(projectName, files, date))

    let truncated = false
    outer: for (const [i, f] of files.entries()) {
      const header = buildFileHeader(f.path)
      if (!place(set, header)) {
        truncated = true
        break
      }
      const lines = highlighted[i]!
      const gutterCh = String(lines.length).length
      for (const [lineIdx, segments] of lines.entries()) {
        // The header travels with its first line so no file starts as a
        // dangling title at the foot of a page.
        const keepWith = lineIdx === 0 ? header : null
        if (!place(set, buildCodeRow(lineIdx + 1, segments, gutterCh), keepWith)) {
          truncated = true
          break outer
        }
      }
    }
    if (truncated) {
      const note = el('div', { marginTop: '14px', fontSize: '11px', fontStyle: 'italic', color: INK_SOFT })
      note.textContent = `Stopped at ${MAX_PAGES} pages — this project is longer than a PDF should be. Export a .zip for the complete files.`
      set.content.appendChild(note)
    }

    addFooters(set.pages, projectName)

    const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')])
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
    const w = pdf.internal.pageSize.getWidth()
    const h = pdf.internal.pageSize.getHeight()
    for (const [i, page] of set.pages.entries()) {
      const dataUrl = await toPng(page, { pixelRatio: 2, backgroundColor: '#FFFFFF' })
      if (i > 0) pdf.addPage()
      pdf.addImage(dataUrl, 'PNG', 0, 0, w, h)
    }

    const blob = pdf.output('blob')
    return await deliverFile(new File([blob], fileName, { type: 'application/pdf' }))
  } finally {
    wrap.remove()
  }
}

function plainLines(content: string): Segment[][] {
  return content.split('\n').map((line) => (line ? [{ text: line, cls: null }] : []))
}
