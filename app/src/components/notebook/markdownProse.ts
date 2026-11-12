import { useEffect, useMemo, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { syntaxHighlighting, type LanguageSupport } from '@codemirror/language'
import { highlightCode } from '@lezer/highlight'
import { loadLanguage, syntaxColors } from '../../editor/setup'
import { escapeHtml, type MarkdownOptions } from '../../notebook/markdown'

/**
 * Typography for rendered markdown (text cells, Markdown outputs). The HTML is
 * generated (notebook/markdown.ts), so it is styled from the container with
 * descendant variants rather than per-element classes — still utilities, still
 * tokens. Reading measure follows the cell, not a fixed column: a notebook's
 * text sits beside its code.
 */
export const MD_PROSE =
  'nb-md min-w-0 break-words text-[15px] leading-[1.65] text-text-1 ' +
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ' +
  '[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-[24px] [&_h1]:leading-[1.25] [&_h1]:font-semibold ' +
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-[20px] [&_h2]:leading-[1.3] [&_h2]:font-semibold ' +
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-[17px] [&_h3]:font-semibold ' +
  '[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-[15px] [&_h4]:font-semibold ' +
  '[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:ps-6 [&_ol]:ps-6 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:my-0.5 ' +
  '[&_li.task]:list-none [&_li.task]:-ms-5 ' +
  '[&_a]:text-link [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_code]:font-code [&_code]:text-[0.88em] [&_code]:bg-surface-3 [&_code]:rounded-sm [&_code]:px-1 [&_code]:py-px ' +
  '[&_pre]:my-2 [&_pre]:p-3 [&_pre]:bg-surface-2 [&_pre]:border [&_pre]:border-border-subtle [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:text-[13px] [&_pre]:leading-[1.5] ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre]:[direction:ltr] [&_pre]:text-left ' +
  '[&_blockquote]:my-2 [&_blockquote]:ps-3 [&_blockquote]:border-s-2 [&_blockquote]:border-border-control [&_blockquote]:text-text-2 ' +
  '[&_hr]:my-4 [&_hr]:border-0 [&_hr]:h-px [&_hr]:bg-border-subtle ' +
  '[&_img]:max-w-full [&_img]:h-auto ' +
  '[&_.md-table]:my-2 [&_.md-table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[14px] ' +
  '[&_th]:px-3 [&_th]:py-1.5 [&_th]:border [&_th]:border-border-subtle [&_th]:bg-surface-2 [&_th]:font-semibold ' +
  '[&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-border-subtle ' +
  '[&_.md-math]:my-3 [&_.md-math]:overflow-x-auto [&_math]:text-[1.05em]'

let python: LanguageSupport | null = null
let styled = false

/** syntaxColors' classes exist only once an editor has mounted them; do it once for markdown code blocks too. */
function ensureSyntaxStyles() {
  if (styled) return
  styled = true
  new EditorView({ extensions: [syntaxHighlighting(syntaxColors)] }).destroy()
}

function highlightPython(code: string): string | null {
  if (!python) return null
  ensureSyntaxStyles()
  let html = ''
  highlightCode(
    code,
    python.language.parser.parse(code),
    syntaxColors,
    (text, classes) => {
      html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text)
    },
    () => {
      html += '\n'
    },
  )
  return html
}

/** Markdown options for a cell: Python code blocks highlighted (once the grammar is loaded), attachments resolved. */
export function useMarkdownOptions(attachments?: Record<string, Record<string, string>>): MarkdownOptions {
  const [ready, setReady] = useState(!!python)
  useEffect(() => {
    if (python) return
    void loadLanguage('python').then((s) => {
      python = s
      setReady(true)
    })
  }, [])
  return useMemo<MarkdownOptions>(() => ({
    highlight: (code, lang) => (/^(py|python3?|ipython3?|)$/.test(lang) ? highlightPython(code) : null),
    attachment: (name) => {
      const a = attachments?.[name]
      if (!a) return null
      const mime = Object.keys(a).find((m) => m.startsWith('image/'))
      return mime ? `data:${mime};base64,${String(a[mime]).replace(/\s+/g, '')}` : null
    },
  }), [ready, attachments])
}
