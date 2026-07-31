import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentOnInput, bracketMatching, indentUnit, type LanguageSupport } from '@codemirror/language'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  acceptCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { langForPath, type LangId } from '../runtime'

/**
 * CodeMirror wiring, kept out of the React component so the component stays a
 * ~40-line mount/unmount shell. Editor *chrome* colours come from Design's
 * tokens via .cm-* rules in index.css; oneDark supplies only syntax colours.
 */

const JAVA_WORDS =
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null String System out println print Scanner ArrayList HashMap List Map Integer Double Boolean Object Exception Override toString equals hashCode length size get set add'.split(
    ' ',
  )
const PY_WORDS =
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print input len range str int float bool list dict set tuple enumerate zip sum min max abs round sorted open self __init__ super'.split(
    ' ',
  )

const WORD = /[A-Za-z_$][\w$]*/g

function wordCompletions(words: string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/[\w$]+/)
    if (!before || (before.from === before.to && !ctx.explicit)) return null
    const seen = new Set<string>()
    const doc = ctx.state.doc.sliceString(0)
    let m: RegExpExecArray | null
    WORD.lastIndex = 0
    while ((m = WORD.exec(doc))) if (m[0].length > 2) seen.add(m[0])
    for (const w of words) seen.add(w)
    seen.delete(before.text)
    return {
      from: before.from,
      options: [...seen].map((label) => ({ label, type: words.includes(label) ? 'keyword' : 'variable' })),
      validFor: /^[\w$]*$/,
    }
  }
}

const wordsFor = (lang: LangId | null) => (lang === 'java' ? JAVA_WORDS : lang === 'python' ? PY_WORDS : [])

/** Lezer grammars are the bulk of the bundle, so they load on demand. */
const langCache = new Map<LangId, LanguageSupport>()
async function loadLanguage(lang: LangId): Promise<LanguageSupport> {
  const cached = langCache.get(lang)
  if (cached) return cached
  const support =
    lang === 'java' ? (await import('@codemirror/lang-java')).java() : (await import('@codemirror/lang-python')).python()
  langCache.set(lang, support)
  return support
}

export interface EditorController {
  open(path: string, content: string): void
  closeFile(path: string): void
  renamePath(from: string, to: string): void
  setFontSize(px: number): void
  focus(): void
  currentPath(): string | null
  destroy(): void
}

export function createEditor(
  parent: HTMLElement,
  opts: { fontSize: number; onChange(path: string, content: string): void; onSave(): void },
): EditorController {
  const fontTheme = new Compartment()
  const langConf = new Compartment()
  const states = new Map<string, EditorState>()
  let path: string | null = null
  let applying = false
  let fontSize = opts.fontSize

  const themeFor = (px: number) =>
    EditorView.theme({
      '&': { fontSize: `${px}px`, height: '100%' },
      // Room to scroll the last line clear of the console and the keyboard.
      '.cm-content': { paddingBottom: '40vh' },
    })

  const extensions = (lang: LangId | null) => [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    indentUnit.of('    '),
    autocompletion({ override: [wordCompletions(wordsFor(lang))], activateOnTyping: true, maxRenderedOptions: 24 }),
    // Wrap rather than scroll horizontally: a wrapped line is readable on a
    // phone, a horizontally-scrolling one is not.
    EditorView.lineWrapping,
    keymap.of([
      { key: 'Tab', run: acceptCompletion },
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          opts.onSave()
          return true
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    oneDark,
    fontTheme.of(themeFor(fontSize)),
    langConf.of(lang && langCache.has(lang) ? [langCache.get(lang)!] : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && path && !applying) opts.onChange(path, u.state.doc.toString())
    }),
  ]

  const stateFor = (p: string, content: string) =>
    EditorState.create({ doc: content, extensions: extensions(langForPath(p)) })

  const view = new EditorView({ parent, state: stateFor('', '') })

  const ensureLanguage = (p: string) => {
    const lang = langForPath(p)
    if (!lang || langCache.has(lang)) return
    void loadLanguage(lang).then((support) => {
      if (path === p) view.dispatch({ effects: langConf.reconfigure([support]) })
    })
  }

  return {
    open(p, content) {
      if (path === p) {
        if (view.state.doc.toString() !== content) {
          applying = true
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
          applying = false
        }
        return
      }
      if (path) states.set(path, view.state)
      path = p
      const saved = states.get(p)
      // Reuse the cached state (cursor, scroll, undo history) when the file has
      // not changed underneath us.
      const next = saved && saved.doc.toString() === content ? saved : stateFor(p, content)
      applying = true
      view.setState(next)
      applying = false
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(fontSize)) })
      ensureLanguage(p)
    },
    closeFile(p) {
      states.delete(p)
      if (path === p) {
        path = null
        applying = true
        view.setState(stateFor('', ''))
        applying = false
      }
    },
    renamePath(from, to) {
      const st = states.get(from)
      if (st) {
        states.delete(from)
        states.set(to, st)
      }
      if (path === from) path = to
    },
    setFontSize(px) {
      fontSize = px
      view.dispatch({ effects: fontTheme.reconfigure(themeFor(px)) })
    },
    focus: () => view.focus(),
    currentPath: () => path,
    destroy: () => view.destroy(),
  }
}
