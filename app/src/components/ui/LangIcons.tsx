/**
 * Language marks for Java and Python.
 *
 * These replace the "J" and "Py" letter badges. Two letters in a coloured box
 * is a label, not an icon: it has to be *read*, which is the opposite of what a
 * badge is for, and it tells a student nothing they did not already know.
 *
 * Both marks are drawn monochrome, in currentColor, to match this UI: it is a
 * black/white theme whose only sanctioned chroma is the four semantic tones,
 * and a full-colour brand logo sitting in it read as a foreign object. So each
 * is the recognised *shape* of its language's mark — the two-snake glyph, the
 * steaming cup — in a single ink, the way a monochrome favicon or a status-bar
 * glyph is. The shape carries the recognition; the colour never did the
 * identifying work in a badge this small. Python is vendored from Devicon's
 * MIT-licensed set (github.com/devicons/devicon), recorded with citation under
 * "Language icons" in docs/legal/THIRD-PARTY.md; the Java cup is our own
 * drawing (see IconJava).
 *
 * One caveat worth keeping visible: the PSF's trademark policy treats a
 * recoloured Python logo as a *derived* logo, distinct from the unaltered mark
 * its nominative-use permission covers. We are choosing the house-style
 * monochrome deliberately for visual coherence; if strict PSF-mark fidelity is
 * ever required, restore the two-colour `python-original` here and give the
 * Python badge its own non-currentColor path.
 *
 * Python is scaled into a 14-unit optical box on a 20 grid; the Java cup is
 * drawn to the same optical weight directly. Both were checked at 24/20/16px on
 * dark badge surfaces — the sizes FileBadge.tsx actually renders.
 *
 * Every icon is aria-hidden; the accessible name lives on the row or button.
 */
import { type SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'> & { size?: number }

/**
 * Java's steaming cup, purpose-drawn as a bold single-ink mark. Devicon's
 * `java-plain` cup is too wispy to survive at 16px — it collapsed to a faint
 * smudge in the tab strip — so this is redrawn in the stroked house style of
 * IconWeb/IconC: solid enough to read small, monochrome by default.
 */
export const IconJava = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M4 8.2h9.2v3.1a3.6 3.6 0 0 1-3.6 3.6H7.6A3.6 3.6 0 0 1 4 11.3Z" />
    <path d="M13.2 8.9h1.5a2.1 2.1 0 0 1 0 4.2h-1.1" />
    <path d="M8.2 3.1c-1 1-.2 1.9 0 2.6M11 3.1c-1 1-.2 1.9 0 2.6" />
    <path d="M4.4 17.4h8.4" />
  </svg>
)

/**
 * Two-snake Python shape in one ink (currentColor) — monochrome by design,
 * see the file header for the PSF-mark trade-off.
 */
export const IconPython = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <g transform="translate(2.973 3.010) scale(0.127272)">
      <path
        fill="currentColor"
        d="M55.023-0.077c-25.971,0-26.25,10.081-26.25,12.156c0,3.148,0,12.594,0,12.594h26.75v3.781c0,0-27.852,0-37.375,0c-7.949,0-17.938,4.833-17.938,26.25c0,19.673,7.792,27.281,15.656,27.281c2.335,0,9.344,0,9.344,0s0-9.765,0-13.125c0-5.491,2.721-15.656,15.406-15.656c15.91,0,19.971,0,26.531,0c3.902,0,14.906-1.696,14.906-14.406c0-13.452,0-17.89,0-24.219C82.054,11.426,81.515-0.077,55.023-0.077z M40.273,8.392c2.662,0,4.813,2.15,4.813,4.813c0,2.661-2.151,4.813-4.813,4.813s-4.813-2.151-4.813-4.813C35.46,10.542,37.611,8.392,40.273,8.392z"
      />
      <path
        fill="currentColor"
        d="M55.397,109.923c25.959,0,26.282-10.271,26.282-12.156c0-3.148,0-12.594,0-12.594H54.897v-3.781c0,0,28.032,0,37.375,0c8.009,0,17.938-4.954,17.938-26.25c0-23.322-10.538-27.281-15.656-27.281c-2.336,0-9.344,0-9.344,0s0,10.216,0,13.125c0,5.491-2.631,15.656-15.406,15.656c-15.91,0-19.476,0-26.532,0c-3.892,0-14.906,1.896-14.906,14.406c0,14.475,0,18.265,0,24.219C28.366,100.497,31.562,109.923,55.397,109.923z M70.148,101.454c-2.662,0-4.813-2.151-4.813-4.813s2.15-4.813,4.813-4.813c2.661,0,4.813,2.151,4.813,4.813S72.809,101.454,70.148,101.454z"
      />
    </g>
  </svg>
)

/**
 * The Web mark: a `</>` — there's no single vendor logo for "HTML+CSS+JS", and
 * angle brackets are the universal shorthand for markup/code. currentColor,
 * like the others.
 */
export const IconWeb = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M7 6.5 3.5 10 7 13.5" />
    <path d="M13 6.5 16.5 10 13 13.5" />
    <path d="M11 5 9 15" />
  </svg>
)

/**
 * C#'s brand IS its letterform (same logic as IconWeb's `</>`), so a geometric
 * "C#" is the mark, not a placeholder. The strokes lean like a musical ♯ so it
 * doesn't read as a hashtag.
 */
export const IconCSharp = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M9 7.3A3.5 3.5 0 1 0 9 12.7" />
    <path d="M12.7 6.9 12 13.1" />
    <path d="M15.5 6.9 14.8 13.1" />
    <path d="M11.4 9.3 15.9 9.3" />
    <path d="M11.1 10.9 15.6 10.9" />
  </svg>
)

/**
 * C's brand IS its letterform too (IconWeb/IconCSharp precedent) — a clean
 * stroked "C" is the mark, not a placeholder.
 */
export const IconC = ({ size = 20, ...rest }: IconProps) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    <path d="M13.4 7A4.5 4.5 0 1 0 13.4 13" />
  </svg>
)

export type IconLang = 'java' | 'python' | 'web' | 'csharp' | 'c'

export function LangIcon({ lang, ...rest }: { lang: IconLang } & IconProps) {
  if (lang === 'java') return <IconJava {...rest} />
  if (lang === 'web') return <IconWeb {...rest} />
  if (lang === 'csharp') return <IconCSharp {...rest} />
  if (lang === 'c') return <IconC {...rest} />
  return <IconPython {...rest} />
}

/* ---- bare file icons ------------------------------------------------------ *
 * Tab strip, breadcrumbs and (at desk) the explorer tree use a colored 16px
 * icon instead of the chip badge — VS Code/Seti parity, and a deliberate
 * exception to this file's monochrome rule (chips stay single-ink). The hex
 * fills are a sanctioned palette here, like setup.ts's syntax colours — never
 * reused elsewhere. Letterform marks (JS, TS, #, {}, M↓) follow IconCSharp's
 * precedent: brand IS the letterform.
 */

const Mark = ({ size = 20, ...rest }: IconProps & { children?: React.ReactNode }) => (
  <svg
    viewBox="0 0 20 20"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  />
)

/** The "JS" letterform: J's stem-and-hook beside the S-curve. */
const IconJSMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M8.6 6v6.3a2.3 2.3 0 0 1-4.6 0" />
    <path d="M15.8 6.8C15.1 5.9 11.7 6 11.8 7.9C11.9 9.9 16 9 16 11.1C16 13.1 12.5 13.3 11.6 12.2" />
  </Mark>
)

/** The "TS" letterform: same S as JS, T in place of the J. */
const IconTSMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M3.4 6.3h5.2M6 6.3v7.4" />
    <path d="M15.8 6.8C15.1 5.9 11.7 6 11.8 7.9C11.9 9.9 16 9 16 11.1C16 13.1 12.5 13.3 11.6 12.2" />
  </Mark>
)

/** Markup's angle-bracket pair — IconWeb's shape without the slash. */
const IconHtmlMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M7.5 6.5 4 10l3.5 3.5" />
    <path d="M12.5 6.5 16 10l-3.5 3.5" />
  </Mark>
)

/** The selector hash. */
const IconCssMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M8.3 5.5 6.9 14.5M13.1 5.5l-1.4 9" />
    <path d="M5.4 8.6h9.8M4.8 11.4h9.8" />
  </Mark>
)

/** The brace pair. */
const IconJsonMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M7.6 4.6c-1.6 0-2.2.9-2.2 2.1v1.4c0 1-.5 1.9-1.8 1.9 1.3 0 1.8.9 1.8 1.9v1.4c0 1.2.6 2.1 2.2 2.1" />
    <path d="M12.4 4.6c1.6 0 2.2.9 2.2 2.1v1.4c0 1 .5 1.9 1.8 1.9-1.3 0-1.8.9-1.8 1.9v1.4c0 1.2-.6 2.1-2.2 2.1" />
  </Mark>
)

/** Markdown's M-and-down-arrow. */
const IconMarkdownMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M2.8 13.2V6.8l2.7 3.1 2.7-3.1v6.4" />
    <path d="M13.6 6.8v6.2M11.3 10.9l2.3 2.3 2.3-2.3" />
  </Mark>
)

/** The plain-document outline for txt and anything unrecognised. */
const IconDocMark = (p: IconProps) => (
  <Mark {...p}>
    <path d="M5 3.25h6.5L15 6.75v10A1 1 0 0 1 14 17.75H6a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1Z" />
    <path d="M11.25 3.5v3.25h3.5M7.75 11h4.5M7.75 13.75h3" />
  </Mark>
)

/** ext → brand ink. VS Code Seti fills, except java's brighter brand orange. */
const FILE_FILLS: Record<string, string> = {
  py: '#519aba',
  java: '#f89820',
  cs: '#68217a',
  c: '#649ad2',
  h: '#8aa8c4',
  js: '#cbcb41',
  mjs: '#cbcb41',
  jsx: '#cbcb41',
  ts: '#519aba',
  tsx: '#519aba',
  html: '#e37933',
  htm: '#e37933',
  css: '#519aba',
  json: '#cbcb41',
  md: '#519aba',
}

/** txt and unknown extensions: the neutral document grey. */
const DOC_FILL = '#c5c5c5'

/**
 * Bare colored icon keyed by extension. Every glyph draws in currentColor, so
 * the fill rides in as inline `color` — overridable via `style` if needed.
 */
export function FileIcon({ ext, size = 16, style, ...rest }: { ext: string } & IconProps) {
  const props = { size, style: { color: FILE_FILLS[ext] ?? DOC_FILL, ...style }, ...rest }
  switch (ext) {
    case 'py':
      return <IconPython {...props} />
    case 'java':
      return <IconJava {...props} />
    case 'cs':
      return <IconCSharp {...props} />
    case 'c':
    case 'h':
      return <IconC {...props} />
    case 'js':
    case 'mjs':
    case 'jsx':
      return <IconJSMark {...props} />
    case 'ts':
    case 'tsx':
      return <IconTSMark {...props} />
    case 'html':
    case 'htm':
      return <IconHtmlMark {...props} />
    case 'css':
      return <IconCssMark {...props} />
    case 'json':
      return <IconJsonMark {...props} />
    case 'md':
      return <IconMarkdownMark {...props} />
    default:
      return <IconDocMark {...props} />
  }
}
