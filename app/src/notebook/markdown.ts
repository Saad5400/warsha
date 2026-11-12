/**
 * Markdown cells → HTML, safe by construction.
 *
 * Every block carries `dir="auto"`: a notebook is often half English, half
 * Arabic, and each paragraph should run in its own script's direction whatever
 * the interface language is.
 *
 * Every character of the source is escaped and only this file's own tags are
 * emitted; the small set of inline HTML notebooks actually use (<br>, <b>,
 * <img>, <a>, <sub>, <kbd>, …) is rebuilt from an allowlist of tags and
 * attributes rather than passed through. So a notebook from anywhere — a
 * shared link, an imported Colab file — cannot run script in Warsha's origin
 * through a markdown cell. URLs are limited to http(s), mailto, in-page
 * anchors, relative paths, `data:image/*` and the cell's own `attachment:`s.
 *
 * Covers CommonMark's everyday core plus GitHub's tables, strikethrough and
 * task lists, and math: `$…$`, `$$…$$`, `\(…\)`, `\[…\]` (→ MathML, tex.ts).
 * No dependency: the bundle stays as it is, and there is no markdown library
 * already installed to reuse.
 */
import { texToMathML } from './tex'

export interface MarkdownOptions {
  /** `attachment:name` → a data: URL from the cell's attachments. */
  attachment?(name: string): string | null
  /** Highlighted HTML for a fenced block, or null to show it plain. */
  highlight?(code: string, lang: string): string | null
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function safeUrl(raw: string, opts: MarkdownOptions, image: boolean): string | null {
  const url = raw.trim().replace(/^<|>$/g, '')
  if (url.startsWith('attachment:')) return opts.attachment?.(url.slice('attachment:'.length)) ?? null
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url)) return image ? url : null
  if (/^(https?:|mailto:)/i.test(url)) return url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null // javascript:, vbscript:, file:, …
  return url
}

/* ------------------------------------------------------------ inline */

const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins', 'sub', 'sup', 'kbd', 'mark', 'small', 'code', 'br', 'span', 'img', 'a', 'font', 'center', 'p', 'div', 'hr'])
const VOID = new Set(['br', 'img', 'hr'])

/** One HTML tag from the source, rebuilt from the allowlist — or escaped when it is not on it. */
function sanitizeTag(tag: string, opts: MarkdownOptions): string {
  const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>$/.exec(tag)
  if (!m) return escapeHtml(tag)
  const [, close, rawName, rest] = m
  const name = rawName.toLowerCase()
  if (!INLINE_TAGS.has(name)) return escapeHtml(tag)
  const out = name === 'font' || name === 'center' ? (name === 'center' ? 'div' : 'span') : name
  if (close) return VOID.has(out) ? '' : `</${out}>`
  const attrs: string[] = []
  if (name === 'center') attrs.push('style="text-align:center"')
  for (const a of rest.matchAll(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = a[1].toLowerCase()
    const value = a[3] ?? a[4] ?? a[5] ?? ''
    if ((key === 'href' && name === 'a') || (key === 'src' && name === 'img')) {
      const url = safeUrl(value, opts, name === 'img')
      if (url) attrs.push(`${key}="${escapeHtml(url)}"`)
    } else if (['alt', 'title', 'width', 'height'].includes(key)) {
      attrs.push(`${key}="${escapeHtml(value)}"`)
    } else if (key === 'align' && /^(left|right|center)$/i.test(value)) {
      attrs.push(`style="text-align:${value.toLowerCase()}"`)
    }
  }
  if (name === 'a') attrs.push('target="_blank" rel="noopener noreferrer"')
  return `<${out}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
}

/** Inline spans. Code spans and math are cut out first so nothing inside them is formatted. */
export function renderInline(src: string, opts: MarkdownOptions = {}): string {
  const held: string[] = []
  const hold = (html: string) => `\u0000${held.push(html) - 1}\u0000`
  let s = src
  // Code spans (any run of backticks, matched by an equal run).
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code: string) => hold(`<code>${escapeHtml(code.replace(/^ (.*) $/, '$1'))}</code>`))
  // Math.
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => hold(texToMathML(tex, false)))
  s = s.replace(/(^|[^\\$])\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/g, (_, pre: string, tex: string) => pre + hold(texToMathML(tex, false)))
  // Backslash escapes.
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>$])/g, (_, c: string) => hold(escapeHtml(c)))
  // Inline HTML tags, sanitized; and autolinks.
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) => hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`))
  s = s.replace(/<\/?[a-zA-Z][^<>]*>/g, (tag) => hold(sanitizeTag(tag, opts)))
  // Images, then links.
  s = s.replace(/!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"([^"]*)")?\s*\)/g, (_, alt: string, url: string, title?: string) => {
    const safe = safeUrl(url, opts, true)
    return safe ? hold(`<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`) : escapeHtml(alt)
  })
  s = s.replace(/\[([^\]]+)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"([^"]*)")?\s*\)/g, (_, text: string, url: string, title?: string) => {
    const safe = safeUrl(url, opts, false)
    const inner = renderInline(text, opts)
    if (!safe) return hold(inner)
    const external = /^(https?:|mailto:)/i.test(safe)
    return hold(`<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`)
  })
  // Bare URLs.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, (_, pre: string, url: string) => pre + hold(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`))
  s = escapeHtml(s)
  // Emphasis on the escaped text (markers are not touched by escaping).
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
  s = s.replace(/(^|[^\w*])\*(?=\S)([\s\S]*?\S)\*(?!\*)/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
  // Hard breaks: two trailing spaces or a backslash before a newline.
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => held[Number(i)])
}

/* ------------------------------------------------------------- blocks */

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

interface ListItem {
  lines: string[]
}

export function renderMarkdown(src: string, opts: MarkdownOptions = {}): string {
  return renderBlocks(src.replace(/\r\n?/g, '\n').split('\n'), opts)
}

function renderBlocks(lines: string[], opts: MarkdownOptions): string {
  const out: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p dir="auto">${renderInline(para.join('\n').trim(), opts)}</p>`)
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      flush()
      i++
      continue
    }

    // Fenced code.
    const fence = /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)/.exec(line)
    if (fence) {
      flush()
      const marker = fence[2]
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(marker)) body.push(lines[i++])
      i++
      const code = body.join('\n')
      const lang = fence[3].toLowerCase()
      const hl = opts.highlight?.(code, lang)
      out.push(`<pre><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${hl ?? escapeHtml(code)}</code></pre>`)
      continue
    }

    // Display math: $$…$$ or \[…\], possibly over several lines.
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      flush()
      const close = trimmed.startsWith('$$') ? '$$' : '\\]'
      let text = trimmed.slice(2)
      if (text.includes(close)) text = text.slice(0, text.indexOf(close))
      else {
        i++
        while (i < lines.length && !lines[i].includes(close)) text += '\n' + lines[i++]
        if (i < lines.length) text += '\n' + lines[i].slice(0, lines[i].indexOf(close))
      }
      i++
      out.push(`<div class="md-math">${texToMathML(text.trim(), true)}</div>`)
      continue
    }

    // ATX heading.
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(trimmed)
    if (h) {
      flush()
      const html = renderInline(h[2], opts)
      out.push(`<h${h[1].length} id="${escapeHtml(slug(html))}" dir="auto">${html}</h${h[1].length}>`)
      i++
      continue
    }

    // Setext heading (the paragraph above, underlined).
    if (para.length && /^(=+|-+)\s*$/.test(trimmed)) {
      const level = trimmed[0] === '=' ? 1 : 2
      const html = renderInline(para.join(' ').trim(), opts)
      para = []
      out.push(`<h${level} id="${escapeHtml(slug(html))}" dir="auto">${html}</h${level}>`)
      i++
      continue
    }

    // Horizontal rule.
    if (/^([-*_])(\s*\1){2,}\s*$/.test(trimmed)) {
      flush()
      out.push('<hr>')
      i++
      continue
    }

    // Blockquote.
    if (trimmed.startsWith('>')) {
      flush()
      const body: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) body.push(lines[i++].trim().replace(/^>\s?/, ''))
      out.push(`<blockquote dir="auto">${renderBlocks(body, opts)}</blockquote>`)
      continue
    }

    // Table: a header row, then a |---|:---:| delimiter row.
    if (trimmed.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flush()
      const cells = (row: string) => {
        const r = row.trim().replace(/^\|/, '').replace(/\|$/, '')
        return r.split(/(?<!\\)\|/).map((c) => c.trim())
      }
      const head = cells(line)
      const aligns = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''))
      const style = (k: number) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : '')
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) body.push(cells(lines[i++]))
      out.push(
        `<div class="md-table"><table dir="auto"><thead><tr>${head.map((c, k) => `<th${style(k)}>${renderInline(c, opts)}</th>`).join('')}</tr></thead>` +
          `<tbody>${body.map((r) => `<tr>${head.map((_, k) => `<td${style(k)}>${renderInline(r[k] ?? '', opts)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      )
      continue
    }

    // Lists (nested by indentation).
    const item = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line)
    if (item && (!para.length || item[1].length === 0)) {
      flush()
      const ordered = /\d/.test(item[2])
      const start = ordered ? parseInt(item[2], 10) : 1
      const base = item[1].length
      const items: ListItem[] = []
      while (i < lines.length) {
        const l = lines[i]
        const m = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(l)
        if (m && m[1].length === base && /\d/.test(m[2]) === ordered) {
          items.push({ lines: [m[3]] })
          i++
          continue
        }
        if (!l.trim()) {
          // A blank line continues the list only if the next line is still inside it.
          const nxt = lines[i + 1]
          if (nxt !== undefined && (/^\s+\S/.test(nxt) && nxt.search(/\S/) > base)) {
            items[items.length - 1]?.lines.push('')
            i++
            continue
          }
          break
        }
        if (l.search(/\S/) > base && items.length) {
          items[items.length - 1].lines.push(l.slice(Math.min(base + 2, l.search(/\S/))))
          i++
          continue
        }
        break
      }
      const tag = ordered ? 'ol' : 'ul'
      const lis = items.map((it) => {
        let first = it.lines[0]
        let check = ''
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(first)
        if (task) {
          check = `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> `
          first = task[2]
        }
        const inner = it.lines.length === 1 ? renderInline(first, opts) : renderBlocks([first, ...it.lines.slice(1)], opts).replace(/^<p dir="auto">([\s\S]*?)<\/p>\n?/, '$1')
        return `<li${task ? ' class="task"' : ''}>${check}${inner}</li>`
      })
      out.push(`<${tag} dir="auto"${ordered && start !== 1 ? ` start="${start}"` : ''}>${lis.join('')}</${tag}>`)
      continue
    }

    // Indented code (4 spaces), only outside a paragraph.
    if (!para.length && /^( {4}|\t)/.test(line)) {
      const body: string[] = []
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^( {4}|\t)/, ''))
      while (body.length && !body[body.length - 1].trim()) body.pop()
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }

    para.push(line)
    i++
  }
  flush()
  return out.join('\n')
}
