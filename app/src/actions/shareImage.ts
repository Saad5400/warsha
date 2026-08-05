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
import { deliverFile } from './deliver'

/** Past this many lines the card stops and says how many more there were —
 *  a screenshot is a snippet, not a scroll of the whole file. */
const MAX_LINES = 60
/** carbon.now.sh's own sweet spot: narrow enough to read, wide enough that a
 *  typical line does not wrap even though wrapping is off. Purely a floor —
 *  a longer line still renders at its own full width, never clipped. */
const MIN_BODY_WIDTH = 640

let highlightCss: string | null = null
/** The literal CSS rules CodeMirror generated for its own one-dark highlight
 *  classes (`.ͼp { color: ... }`, etc) — computed once, then reused as a
 *  plain `<style>` block inside the off-screen card. */
function highlightStyleCss(): string {
  if (highlightCss === null) highlightCss = oneDarkHighlightStyle.module?.getRules() ?? ''
  return highlightCss
}

interface Segment {
  text: string
  cls: string | null
}

/** Mirrors `editor/setup.ts`'s own `langCache` — a second, independent cache
 *  rather than a shared import, because sharing one would mean either this
 *  module reaching into the editor's internals or the editor exposing a
 *  loader it has no other reason to. Loaded grammars are tiny to hold twice. */
const langCache = new Map<LangId, LRLanguage>()
async function loadLanguage(lang: LangId): Promise<LRLanguage> {
  const cached = langCache.get(lang)
  if (cached) return cached
  const language =
    lang === 'java' ? (await import('@codemirror/lang-java')).javaLanguage : (await import('@codemirror/lang-python')).pythonLanguage
  langCache.set(lang, language)
  return language
}

/** One file's source, tokenised into per-line segments. A token that spans a
 *  newline (a block comment, a triple-quoted string) is split at each `\n`
 *  into same-class segments on the lines it actually covers — building one
 *  HTML string and cutting it on `\n` instead would leave an unbalanced,
 *  still-open span dangling across line boundaries. */
async function highlightLines(code: string, lang: LangId | null): Promise<Segment[][]> {
  const lines: Segment[][] = [[]]
  const push = (text: string, cls: string | null) => {
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1]!.push({ text: part, cls })
    })
  }
  if (!lang) {
    push(code, null)
    return lines
  }
  const language = await loadLanguage(lang)
  const tree = language.parser.parse(code)
  let pos = 0
  highlightTree(tree, oneDarkHighlightStyle, (from, to, cls) => {
    if (from > pos) push(code.slice(pos, from), null)
    push(code.slice(from, to), cls)
    pos = to
  })
  if (pos < code.length) push(code.slice(pos), null)
  return lines
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  return node
}

const DOT_COLORS = ['#FF5F56', '#FFBD2E', '#27C93F']

/** Builds the off-screen card and attaches it to `document.body`.
 *  `card` is what to hand to `toPng` — the visible, styled element. `wrap` is
 *  what to remove afterwards: `card`'s invisible positioning container, kept
 *  separate because capturing `wrap` itself captures its own `opacity: 0`
 *  (needed so the card is never visible to the student, however briefly) —
 *  passing it to `toPng` produced a technically-successful, silently blank
 *  PNG, with no error to say why. */
async function buildCard(path: string, source: string): Promise<{ wrap: HTMLDivElement; card: HTMLDivElement }> {
  const lines = await highlightLines(source, langForPath(path))
  const shown = lines.slice(0, MAX_LINES)
  const hidden = lines.length - shown.length

  // Invisible and untouchable, not off-canvas: `opacity-0` + `pointer-events-none`
  // at (0, 0) rather than a huge negative offset. `position: fixed` already
  // keeps it out of document flow/scroll regardless of position, so there is
  // nothing an offset would buy — and `toPng()` is called on `card` below,
  // never on `wrap`, which is the part that actually matters: `wrap`'s own
  // opacity is exactly what must NOT be what gets rasterised.
  const wrap = el('div', 'fixed left-0 top-0 opacity-0 pointer-events-none')
  const style = document.createElement('style')
  style.textContent = highlightStyleCss()
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
  // Every colour, size and radius on this card comes from a Tailwind utility
  // that resolves through `var(--token)` (index.css's `@theme inline`, per
  // ARCHITECTURE §4) — and html-to-image rasterises by serialising the node
  // into an SVG <foreignObject> and painting THAT through a fresh `Image()`,
  // a context where `var()` no longer resolves against this page's `:root`.
  // Without this, the card renders as a same-colour blank rectangle: every
  // `var()` falls through to its property's initial value, which is
  // `transparent` for colour and `0` for a dimension. Freezing every
  // computed value as a literal inline style, while the card is still in
  // this document and every var() still resolves normally, is what makes the
  // capture pixel-faithful regardless of that limitation.
  freezeComputedStyles(wrap)
  return { wrap, card }
}

/**
 * See the comment above the one call site. Walks `root` and every
 * descendant, replacing each one's live (`var()`-bearing) style with the
 * literal values the cascade actually resolved them to right now.
 *
 * Two passes, deliberately — read every value first, apply second. A single
 * combined pass (read this node's computed style, write it, move on) is
 * subtly wrong: `getComputedStyle()` returns a *live* `CSSStyleDeclaration`,
 * so writing property N of M through it can change what property N+1 reads
 * back before this same node is even done, if the two interact (in
 * practice, this is exactly what made every syntax-highlighted span in the
 * card render in one flat colour — some property alphabetically after
 * `color` was overwriting the paint colour with a now-stale computed value).
 * Snapshotting first means every read sees the same pre-freeze style.
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
 * Render `path`'s `source` to a PNG and hand it to the OS share sheet
 * (`navigator.share` with a file, the iPad path) or, failing that, trigger a
 * download. Resolves either way; a cancelled share sheet is not a failure and
 * does not throw (`AbortError` is swallowed), so callers should not toast on
 * every rejection blindly — see `isCancelled`.
 */
export async function shareFileAsImage(path: string, source: string): Promise<'shared' | 'downloaded'> {
  // Built and attached to the DOM first, on its own — `buildCard` and the
  // `html-to-image` import are then wrapped in the same try/finally that
  // removes it, so a failed dynamic import can never leave `wrap` orphaned.
  const { wrap, card } = await buildCard(path, source)
  try {
    const { toPng } = await import('html-to-image')
    // `card`, not `wrap`: `wrap` is the thing with `opacity: 0` on it (so the
    // card is never visible to the student, however briefly), and capturing
    // an ancestor's own opacity captures the 0 right along with it.
    // Two device pixels per CSS pixel: sharp on a Retina/iPad display without
    // ballooning a 40-line snippet into a multi-megabyte image.
    const dataUrl = await toPng(card, { pixelRatio: 2, backgroundColor: undefined })
    const blob = await (await fetch(dataUrl)).blob()
    const fileName = `${splitPath(path).name}.png`
    const file = new File([blob], fileName, { type: 'image/png' })

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: fileName })
        return 'shared'
      } catch (e) {
        if (isCancelled(e)) return 'shared'
        // Fall through to the download path — some browsers advertise
        // canShare() for files and then reject the actual share() call.
      }
    }

    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
    return 'downloaded'
  } finally {
    wrap.remove()
  }
}

function isCancelled(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}
