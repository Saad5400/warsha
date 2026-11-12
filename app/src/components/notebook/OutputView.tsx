import { useEffect, useMemo, useRef, useState } from 'react'
import { joinText, type NbOutput } from '../../notebook/nbformat'
import { parseAnsi } from '../../notebook/ansi'
import { streamDisplay } from '../../notebook/outputs'
import { renderMarkdown, safeUrl } from '../../notebook/markdown'
import { texToMathML } from '../../notebook/tex'
import { COPY } from '../../copy'
import { MD_PROSE, useMarkdownOptions } from './markdownProse'

/**
 * One cell output, nbformat-shaped, drawn the way Jupyter and Colab pick:
 * the richest representation the frontend can show safely.
 *
 * HTML (a pandas DataFrame, IPython.display.HTML, a plotting library's
 * output) is the one representation that is someone else's markup, and a
 * notebook can arrive from anywhere. It renders in an iframe sandboxed with
 * `allow-same-origin` and WITHOUT `allow-scripts` — the browser then runs no
 * script in it at all (no <script>, no onerror=, no javascript: URL), while the
 * same origin lets this side measure its height and theme it. Its styles stay
 * inside the frame, so a notebook's <style> cannot restyle Warsha either.
 */

/** Richest first, as Jupyter's own frontends order them. */
const MIME_ORDER = [
  'application/vnd.jupyter.widget-view+json',
  'text/html',
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/markdown',
  'text/latex',
  'application/json',
  'text/plain',
]

/** Stream text past this is cut, with a note — a runaway print loop must not freeze the tab. */
const MAX_TEXT = 200_000

const PRE =
  'm-0 whitespace-pre-wrap break-words font-code text-[13px] leading-[1.5] text-text-1 ' +
  'max-h-[min(70vh,640px)] overflow-y-auto scroller'

export function Ansi({ text }: { text: string }) {
  const cut = text.length > MAX_TEXT
  const runs = useMemo(() => parseAnsi(cut ? text.slice(-MAX_TEXT) : text), [text, cut])
  return (
    <>
      {cut ? <span className="text-text-3">[… earlier output trimmed …]{'\n'}</span> : null}
      {runs.map((r, i) =>
        r.fg || r.bg || r.bold || r.underline ? (
          <span
            key={i}
            style={{ color: r.fg ?? undefined, backgroundColor: r.bg ?? undefined }}
            className={(r.bold ? 'font-bold ' : '') + (r.underline ? 'underline' : '')}
          >
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  )
}

/** The theme the frame's own stylesheet needs — custom properties do not cross into an iframe. */
function frameStyles(): string {
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  return `
:root{color-scheme:dark}
html,body{margin:0;padding:0;background:transparent;color:${v('--text-1')};font:13px/1.5 ${v('--font-ui')};overflow-y:hidden}
body{overflow-x:auto;padding-bottom:2px}
a{color:${v('--link') || v('--text-1')}}
table,th,td{border:0}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:12.5px;margin:2px 0}
th,td{padding:4px 10px;border-bottom:1px solid ${v('--border-subtle')};text-align:right;white-space:nowrap}
thead th{border-bottom:1px solid ${v('--border-control')};color:${v('--text-1')};font-weight:600}
tbody th{color:${v('--text-2')};font-weight:600}
tbody tr:nth-child(odd){background:color-mix(in srgb, ${v('--surface-3')} 45%, transparent)}
tbody tr:hover{background:${v('--surface-3')}}
img,svg{max-width:100%;height:auto}
pre,code{font-family:${v('--font-code')}}
`
}

function HtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(32)
  const doc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${frameStyles()}</style></head><body>${html}</body></html>`,
    [html],
  )
  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    let ro: ResizeObserver | null = null
    const measure = () => {
      const d = frame.contentDocument
      if (!d?.documentElement) return
      setHeight(Math.max(16, Math.ceil(d.documentElement.scrollHeight)))
    }
    const onLoad = () => {
      // Scripts never run in here, but a link is followed by the browser: every one goes through
      // the markdown sanitizer, so a javascript:/data: URL in a notebook's HTML is inert.
      for (const a of frame.contentDocument?.querySelectorAll('a, area') ?? []) {
        for (const attr of ['href', 'xlink:href']) {
          const v = a.getAttribute(attr)
          if (v === null) continue
          const safe = safeUrl(v, {}, false)
          if (safe && !safe.startsWith('#')) a.setAttribute(attr, safe)
          else if (!safe) a.removeAttribute(attr)
        }
        a.setAttribute('rel', 'noopener noreferrer')
      }
      measure()
      const d = frame.contentDocument
      if (d?.body) {
        ro = new ResizeObserver(measure)
        ro.observe(d.body)
      }
    }
    frame.addEventListener('load', onLoad)
    return () => {
      frame.removeEventListener('load', onLoad)
      ro?.disconnect()
    }
  }, [doc])
  return (
    <iframe
      ref={ref}
      title={COPY.nbOutputLabel}
      // No allow-scripts: nothing in here ever runs. allow-same-origin only lets us measure it and
      // vet its links. Popups stay sandboxed too (no escape), so nothing a link opens can script.
      sandbox="allow-same-origin allow-popups"
      srcDoc={doc}
      style={{ height }}
      className="block w-full border-0 bg-transparent"
    />
  )
}

function ImageOut({ mime, data, meta }: { mime: string; data: string; meta: Record<string, unknown> | undefined }) {
  const src =
    mime === 'image/svg+xml'
      ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`
      : `data:${mime};base64,${data.replace(/\s+/g, '')}`
  const w = typeof meta?.width === 'number' ? meta.width : undefined
  return (
    // An <img> never runs script, which is why even an SVG output is safe here.
    <img src={src} alt="" style={w ? { width: w } : undefined} className="block h-auto max-w-full rounded-sm bg-white/0" />
  )
}

function RichOut({ output }: { output: NbOutput }) {
  const data = (output.data ?? {}) as Record<string, unknown>
  const meta = (output.metadata ?? {}) as Record<string, Record<string, unknown> | undefined>
  const mdOpts = useMarkdownOptions()
  const mime = MIME_ORDER.find((m) => m in data) ?? Object.keys(data)[0]
  if (!mime) return null
  const value = data[mime]
  const text = typeof value === 'string' || Array.isArray(value) ? joinText(value) : ''
  switch (mime) {
    case 'application/vnd.jupyter.widget-view+json':
      return (
        <div>
          <p className="m-0 mb-1 text-meta text-text-3">{COPY.nbWidgets}</p>
          {'text/plain' in data ? <pre className={PRE}><Ansi text={joinText(data['text/plain'])} /></pre> : null}
        </div>
      )
    case 'text/html':
      return <HtmlFrame html={text} />
    case 'image/svg+xml':
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
      return <ImageOut mime={mime} data={text} meta={meta[mime]} />
    case 'text/markdown':
      return <div className={MD_PROSE} dangerouslySetInnerHTML={{ __html: renderMarkdown(text, mdOpts) }} />
    case 'text/latex': {
      const m = /^\s*\$\$([\s\S]*)\$\$\s*$/.exec(text) ?? /^\s*\$([\s\S]*)\$\s*$/.exec(text)
      // renderMarkdown/texToMathML build markup from escaped text only.
      return m ? (
        <div className="overflow-x-auto py-1 text-text-1" dangerouslySetInnerHTML={{ __html: texToMathML(m[1], true) }} />
      ) : (
        <div className={MD_PROSE} dangerouslySetInnerHTML={{ __html: renderMarkdown(text, mdOpts) }} />
      )
    }
    case 'application/json':
      return <pre className={PRE}>{JSON.stringify(value, null, 2)}</pre>
    default:
      return (
        <pre className={PRE}>
          <Ansi text={text} />
        </pre>
      )
  }
}

export function OutputView({ output }: { output: NbOutput }) {
  switch (output.output_type) {
    case 'stream': {
      const err = output.name === 'stderr'
      return (
        <pre
          data-stream={err ? 'stderr' : 'stdout'}
          className={PRE + (err ? ' -mx-2 px-2 bg-danger-soft/60 border-s-2 border-danger' : '')}
        >
          <Ansi text={streamDisplay(joinText(output.text))} />
        </pre>
      )
    }
    case 'error': {
      const tb = Array.isArray(output.traceback) ? (output.traceback as string[]).join('\n') : `${output.ename}: ${output.evalue}`
      return (
        <pre data-error="" className={PRE + ' -mx-2 px-2 py-1 bg-danger-soft border-s-2 border-danger'}>
          <Ansi text={tb} />
        </pre>
      )
    }
    case 'display_data':
    case 'execute_result':
      return <RichOut output={output} />
    default:
      return null
  }
}
