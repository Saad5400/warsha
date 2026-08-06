/**
 * "Share as image…" (top-right ⋯ menu) — render the active file's code as a
 * carbon.now.sh-style card and hand it to the OS share sheet (or a download).
 *
 * Founder requirement, non-negotiable: the image is always rendered at full
 * desktop scale with no line wrapping, regardless of the device it was made
 * on. A phone student's export must not look like it was made on a phone.
 * That is what the off-screen container below is for — it is attached to the
 * real DOM (so fonts, CSS variables and layout are all real), but positioned
 * far outside the viewport with no width constraint of its own, so a 140-
 * column line renders 140 columns wide instead of wrapping at 390px.
 *
 * Syntax colours are CodeMirror's own: the same Lezer grammars the editor
 * uses are parsed headlessly (see actions/highlight.ts, which owns the lazy
 * grammar loading and its rationale), and the actual generated stylesheet is
 * lifted from `oneDarkHighlightStyle.module` rather than re-guessed — see
 * `highlightCss()`. No EditorView is ever created; this module does not
 * depend on one already being mounted.
 *
 * `html-to-image` is a dynamic import for the ordinary reason: nobody pays
 * for it until they click Share.
 */
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { splitPath } from '../fs/project'
import { highlightCss, highlightLines } from './highlight'
import { deliverFile, type Delivered } from './deliver'

/** Past this many lines the card truncates and says how many more — a
 *  screenshot is a snippet, not the whole file. */
const MAX_LINES = 60
/** carbon.now.sh's sweet spot — readable but wide enough that typical lines
 *  don't wrap. A floor only: a longer line still renders at full width, uncapped. */
const MIN_BODY_WIDTH = 640

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  return node
}

const DOT_COLORS = ['#FF5F56', '#FFBD2E', '#27C93F']

/** Builds the off-screen card. Pass `card` (not `wrap`) to `toPng` —
 *  capturing `wrap` also captures its own `opacity: 0` and silently produces
 *  a blank PNG. */
async function buildCard(path: string, source: string): Promise<{ wrap: HTMLDivElement; card: HTMLDivElement }> {
  const lines = await highlightLines(source, path, oneDarkHighlightStyle)
  const shown = lines.slice(0, MAX_LINES)
  const hidden = lines.length - shown.length

  // `opacity-0` + `pointer-events-none` at (0,0), not a huge negative offset —
  // `position: fixed` already keeps it out of flow, so an offset buys nothing.
  // `toPng()` must capture `card`, never `wrap` (whose opacity would get rasterised).
  const wrap = el('div', 'fixed left-0 top-0 opacity-0 pointer-events-none')
  // Forced LTR: built inside the live document, so an Arabic session would
  // otherwise reverse every row via inherited `dir="rtl"`. Code is always
  // LTR, like the editor it's a picture of (editor/setup.ts). Set before
  // freezeComputedStyles() below so `direction` gets frozen too.
  wrap.dir = 'ltr'
  wrap.style.direction = 'ltr'
  wrap.style.textAlign = 'left'
  const style = document.createElement('style')
  style.textContent = highlightCss(oneDarkHighlightStyle)
  wrap.appendChild(style)

  const card = el(
    'div',
    'inline-flex flex-col overflow-hidden rounded-lg bg-surface-3 shadow-raised',
  )
  wrap.appendChild(card)

  const header = el('div', 'flex items-center gap-4 px-4 py-3')
  const dots = el('div', 'flex items-center gap-[7px]')
  for (const color of DOT_COLORS) {
    const dot = el('span', 'block size-[11px] rounded-full')
    dot.style.backgroundColor = color
    dots.appendChild(dot)
  }
  header.appendChild(dots)
  const name = el('span', 'flex-1 text-center text-meta font-medium text-text-2')
  name.textContent = splitPath(path).name
  header.appendChild(name)
  // Balances the dots so the filename is optically centred, not just centred
  // between the header's own edges.
  const spacer = el('div', 'w-[46px]')
  header.appendChild(spacer)
  card.appendChild(header)

  const body = el(
    'div',
    `min-w-[${MIN_BODY_WIDTH}px] bg-surface-1 px-6 py-5 font-code text-code whitespace-pre`,
  )
  const gutterWidth = String(lines.length).length
  for (const [i, segments] of shown.entries()) {
    const row = el('div', 'flex leading-[1.6]')
    const num = el('span', 'mr-4 flex-none text-right text-text-3 select-none tabular-nums')
    num.style.minWidth = `${gutterWidth}ch`
    num.textContent = String(i + 1)
    row.appendChild(num)
    const code = el('span', 'text-text-1')
    if (segments.length === 0) code.appendChild(document.createTextNode(' '))
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
    body.appendChild(row)
  }
  if (hidden > 0) {
    const more = el('div', 'mt-2 text-meta text-text-3 italic')
    more.textContent = `+${hidden} more line${hidden === 1 ? '' : 's'}`
    body.appendChild(more)
  }
  card.appendChild(body)

  const footer = el('div', 'flex justify-end px-4 py-2 text-micro tracking-wide text-text-3/70')
  footer.textContent = 'warsha'
  card.appendChild(footer)

  document.body.appendChild(wrap)
  // Every style here resolves through Tailwind's `var(--token)`, but
  // html-to-image rasterises through an SVG <foreignObject> painted via a
  // fresh `Image()`, where var() no longer resolves — everything would render
  // blank without freezing computed values to literal inline styles first.
  freezeComputedStyles(wrap)
  return { wrap, card }
}

/**
 * Walks `root` and every descendant, replacing each one's live
 * (`var()`-bearing) style with the literal values the cascade resolved them
 * to right now.
 *
 * Two passes, deliberately: `getComputedStyle()` returns a *live* object, so
 * a combined read-write pass can let writing property N change what property
 * N+1 reads later on the same node — this once flattened every
 * syntax-highlighted span in the card to one colour. Snapshot first, then apply.
 */
function freezeComputedStyles(root: HTMLElement): void {
  const nodes = [root, ...root.querySelectorAll('*')].filter((n): n is HTMLElement => n instanceof HTMLElement)
  const snapshots = nodes.map((node) => {
    const computed = getComputedStyle(node)
    const pairs: [string, string][] = []
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i]!
      pairs.push([prop, computed.getPropertyValue(prop)])
    }
    return pairs
  })
  nodes.forEach((node, i) => {
    for (const [prop, value] of snapshots[i]!) node.style.setProperty(prop, value)
  })
}

/**
 * Renders `source` to a PNG and delivers it — share sheet or download (see
 * deliver.ts, including why a cancelled share resolves rather than throws).
 */
export async function shareFileAsImage(path: string, source: string): Promise<Delivered> {
  // buildCard and the html-to-image import share one try/finally, so a failed
  // dynamic import can never leave `wrap` orphaned.
  const { wrap, card } = await buildCard(path, source)
  try {
    const { toPng } = await import('html-to-image')
    // `card`, not `wrap` — capturing an ancestor also captures its own opacity:0.
    // 2x pixel ratio: sharp on Retina/iPad without ballooning a 40-line
    // snippet into a multi-megabyte image.
    const dataUrl = await toPng(card, { pixelRatio: 2, backgroundColor: undefined })
    const blob = await (await fetch(dataUrl)).blob()
    const fileName = `${splitPath(path).name}.png`
    return await deliverFile(new File([blob], fileName, { type: 'image/png' }))
  } finally {
    wrap.remove()
  }
}
